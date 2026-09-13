from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html import escape
from threading import Event

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.hongguo_trends import router
from app.database import create_database_runtime
from app.dependencies import get_hongguo_trends_service
from app.document_repository import ModuleDocumentRecord
from app.modules.hongguo_trends.repository import HongguoTrendsRepository
from app.modules.hongguo_trends.service import HongguoTrendsService
from app.modules.hongguo_trends.models import HongguoTrendsSnapshot
from app.modules.hongguo_trends.taxonomy import TAXONOMY_REVISION
from app.modules.hongguo_trends.source import (
    CATEGORY_URLS,
    RANK_URLS,
    SourceError,
    allowed_fetch_url,
    cover_url,
    parse_categories,
    parse_rank_page,
    rank_url,
)


UPDATED = "9月11日已更新 · 基于红果内观看/互动等综合热度排序"


class Clock:
    def __init__(self):
        self.now = datetime(2026, 9, 11, 14, tzinfo=timezone.utc)

    def __call__(self):
        return self.now

    def advance(self, **kwargs):
        self.now += timedelta(**kwargs)


def work(id="1001", title="山海来信", rank=1, tags=None, **extra):
    return {"seriesId": id, "id": id, "title": title, "rank": rank,
            "tags": tags if tags is not None else ["玄幻", "萌宝", "205"],
            "href": f"/detail?series_id={id}",
            "cover": "https://p6-novel.byteimg.com/novel-pic/cover.image", **extra}


def rank_html(works=None, *, page=1, total=1, updated=UPDATED, next_url=None):
    payload = {"isSuccess": True, "rankList": works if works is not None else [work()],
               "pagination": {"pageNum": page, "totalPages": total,
                              "nextUrl": next_url or f"{RANK_URLS['comic']}?page={page + 1}"}}
    args = escape(json.dumps(["rank_hot-comic-drama/page", payload], ensure_ascii=False), quote=True)
    return (f'<html><head><script>"1月1日已更新"</script></head><body><p>{updated}</p>'
            f'<script async data-script-src="modern-run-router-data-fn" data-fn-args="{args}"></script></body></html>')


def category_html(format="comic", labels=None):
    labels = labels or ["脑洞", "玄幻", "剧情", "末世", "豪门", "奇幻", "科幻", "冒险"]
    path = f"/category/{format}-drama"
    return (f'<nav aria-label="短剧分类"><a href="{path}">全部</a>'
            + "".join(f'<a href="{path}/category-{i}"><span>{label}</span></a>' for i, label in enumerate(labels))
            + '</nav><a href="/detail?series_id=1001">不是分类</a>')


def service(handler, *, repository=None, clock=None):
    def html_handler(request):
        response = handler(request)
        if response.status_code == 200:
            response.headers["Content-Type"] = "text/html; charset=utf-8"
        return response

    return HongguoTrendsService(repository or HongguoTrendsRepository(),
                               client=httpx.Client(transport=httpx.MockTransport(html_handler)),
                               clock=clock or Clock())


def test_parse_real_router_attribute_shape_and_visible_update_label():
    page = parse_rank_page(rank_html([work(title='山海 & "来信"')]), 1)
    assert page.works[0].title == '山海 & "来信"'
    assert page.source_updated_label == UPDATED
    assert page.total_pages == 1


@pytest.mark.parametrize("html", [
    '<script data-script-src="modern-run-router-data-fn" data-fn-args="[]"></script>',
    '<script data-script-src="modern-run-router-data-fn" data-fn-args="not-json"></script>',
    '<script>window.rankList = [];</script>',
    rank_html([]), rank_html(page=2, total=2),
    rank_html([work(rank=0)]), rank_html([work(tags="玄幻")]),
])
def test_malformed_or_wrong_page_is_rejected(html):
    with pytest.raises(SourceError):
        parse_rank_page(html, 1)


def test_all_pages_capped_five_and_no_source_controlled_fetch_urls():
    requests = []

    def handler(request):
        requests.append(str(request.url))
        page = int(request.url.params.get("page", 1))
        return httpx.Response(200, text=rank_html(
            [work(id=str(page), title=f"独立作品{page}", rank=page * 10)], page=page, total=8,
            next_url="http://127.0.0.1/private"))

    snapshot = service(handler).get("comic")
    assert snapshot.status == "fresh"
    assert snapshot.pages_fetched == snapshot.sample_work_count == 5
    assert requests == [rank_url("comic", page) for page in range(1, 6)]
    assert snapshot.recommendations[0].weighted_score == pytest.approx(sum(1 / (page * 10) for page in range(1, 6)), abs=1e-6)


def test_noise_unknown_labels_semantics_and_per_work_alias_deduplication():
    labels = ["修真", "修仙", "修仙", "奇幻", "玄幻", "惊悚", "恐怖", "成长", "剧情", "205",
              "２０６", "100%", "新剧", "完结", "全93集", "", "名" * 21, "萌宝", "囤物资"]
    snapshot = service(lambda _: httpx.Response(200, text=rank_html([work(tags=labels, rank=3)]))).get("comic")
    by_label = {item.label: item for item in snapshot.recommendations}
    assert set(by_label) == {"修真", "奇幻", "玄幻", "惊悚", "恐怖", "成长", "剧情", "萌宝", "囤物资"}
    assert by_label["修真"].tag_id == "theme.cultivation"
    assert by_label["修真"].ranked_work_count == 1
    assert by_label["修真"].weighted_score == pytest.approx(1 / 3, abs=1e-6)
    assert by_label["修真"].raw_labels == ["修真", "修仙"]
    assert by_label["玄幻"].tag_id == "genre.fantasy"
    assert by_label["惊悚"].tag_id == "genre.horror"
    for label in ("奇幻", "恐怖", "成长", "剧情", "萌宝", "囤物资"):
        assert by_label[label].tag_id is None
    assert sorted(item.rank for item in by_label.values()) == list(range(1, len(by_label) + 1))


def test_dedup_ids_explicit_seasons_but_preserve_bare_numbers_and_similar_titles():
    works = [work(id="1", title="山海来信第二季", rank=1), work(id="2", title="山海来信", rank=2),
             work(id="3", title="山海来信第三季", rank=3), work(id="4", title="山海来信2", rank=4),
             work(id="5", title="山海来信：另一封信", rank=5), work(id="4", title="重复ID", rank=6)]
    snapshot = service(lambda _: httpx.Response(200, text=rank_html(works))).get("comic")
    assert snapshot.sample_work_count == 3
    assert all(item.ranked_work_count == 3 for item in snapshot.recommendations)
    assert [item.title for item in snapshot.recommendations[0].sample_works] == ["山海来信第二季", "山海来信2", "山海来信：另一封信"]
    assert [item.rank for item in snapshot.recommendations[0].sample_works] == [1, 4, 5]


def test_cache_one_hour_refresh_and_per_format_isolation():
    requests, clock = [], Clock()

    def handler(request):
        requests.append(str(request.url))
        return httpx.Response(200, text=rank_html())

    feed = service(handler, clock=clock)
    first = feed.get("comic")
    clock.advance(minutes=59)
    assert feed.get("comic") == first
    assert len(requests) == 1
    clock.advance(minutes=1)
    assert feed.get("comic").fetched_at > first.fetched_at
    assert feed.get("ai").format == "ai"
    assert len(requests) == 3


def test_source_aliases_count_once_per_work_without_merging_distinct_compounds():
    labels = ["爱情", "恋爱", "都市爱情", "现代言情", "古风爱情", "古代言情",
              "江湖武侠", "武侠", "动作打斗", "动作", "逆袭", "逆风翻盘", "逆袭翻身",
              "隐藏身份", "马甲文", "古代", "古装", "重生逆袭", "隐藏大佬"]
    snapshot = service(lambda _: httpx.Response(200, text=rank_html([work(tags=labels, rank=2)]))).get("comic")
    assert len(snapshot.recommendations) == 10
    assert all(item.ranked_work_count == 1 and item.weighted_score == 0.5 for item in snapshot.recommendations)
    by_id = {item.tag_id: item for item in snapshot.recommendations if item.tag_id}
    assert by_id["theme.power_growth"].raw_labels == ["逆袭", "逆风翻盘", "逆袭翻身"]
    assert {item.label for item in snapshot.recommendations if item.tag_id is None} == {"重生逆袭", "隐藏大佬"}


@pytest.mark.parametrize("failing", [False, True])
def test_old_taxonomy_refreshes_fresh_cache_and_preserves_failure_backoff(failing):
    repository, clock = HongguoTrendsRepository(), Clock()
    before = service(lambda _: httpx.Response(200, text=rank_html()), repository=repository, clock=clock).get("comic")
    old = HongguoTrendsSnapshot.model_validate(before.model_dump(exclude={"taxonomy_revision"}))
    repository.save(old)
    requests = []

    def handler(request):
        requests.append(str(request.url))
        return httpx.Response(503) if failing else httpx.Response(200, text=rank_html())

    clock.advance(minutes=1)
    feed = service(handler, repository=repository, clock=clock)
    refreshed = feed.get("comic")
    assert len(requests) == 1
    assert refreshed.taxonomy_revision == (0 if failing else TAXONOMY_REVISION)
    assert refreshed.status == ("stale" if failing else "fresh")
    assert refreshed.recommendations == before.recommendations
    assert feed.get("comic") == refreshed
    assert len(requests) == 1


@pytest.mark.parametrize("warm", [False, True])
def test_cold_unavailable_and_stale_failure_persist_backoff_then_recover(warm):
    repository, clock = HongguoTrendsRepository(), Clock()
    calls = []
    failing = False

    def handler(request):
        calls.append(str(request.url))
        if failing:
            raise httpx.ReadTimeout("Upstream unavailable")
        return httpx.Response(200, text=rank_html())

    feed = service(handler, repository=repository, clock=clock)
    before = feed.get("comic") if warm else None
    clock.advance(hours=1)
    failing = True
    failed = feed.get("comic")
    assert failed.status == ("stale" if warm else "unavailable")
    assert failed.stale is warm
    assert failed.fetched_at == (before.fetched_at if before else None)
    assert failed.last_attempt_status == "failed"
    assert failed.next_retry_at == clock() + timedelta(minutes=5)
    if warm:
        assert failed.recommendations == before.recommendations
        assert failed.source_updated_label == before.source_updated_label
    count = len(calls)
    clock.advance(minutes=4)
    # The retry window also applies to new request-scoped service instances.
    assert service(handler, repository=repository, clock=clock).get("comic") == failed
    assert len(calls) == count
    clock.advance(minutes=1)
    failing = False
    recovered = feed.get("comic")
    assert recovered.status == "fresh"
    assert recovered.next_retry_at is None
    assert recovered.last_attempt_status == "succeeded"
    assert len(calls) == count + 1


def test_failed_later_page_never_publishes_partial_snapshot():
    clock, repository = Clock(), HongguoTrendsRepository()
    service(lambda _: httpx.Response(200, text=rank_html()), repository=repository, clock=clock).get("comic")
    clock.advance(hours=1)

    def handler(request):
        if request.url.params.get("page") == "2":
            return httpx.Response(502)
        return httpx.Response(200, text=rank_html([work(title="不应发布的新作品")], total=2))

    stale = service(handler, repository=repository, clock=clock).get("comic")
    assert stale.status == "stale"
    assert stale.pages_fetched == 1
    assert stale.recommendations[0].sample_works[0].title == "山海来信"


def test_singleflight_across_service_instances_and_separate_format_progress():
    entered, release = Event(), Event()
    repository = HongguoTrendsRepository()
    requests = []

    def handler(request):
        requests.append(str(request.url))
        if "comic" in str(request.url):
            entered.set()
            assert release.wait(3)
        return httpx.Response(200, text=rank_html())

    with ThreadPoolExecutor(max_workers=4) as pool:
        first = pool.submit(service(handler, repository=repository).get, "comic")
        assert entered.wait(2)
        second = pool.submit(service(handler, repository=repository).get, "comic")
        independent = pool.submit(service(handler, repository=repository).get, "real")
        try:
            assert independent.result(timeout=2).status == "fresh"
        finally:
            release.set()
        assert first.result(timeout=2) == second.result(timeout=2)
    assert requests.count(RANK_URLS["comic"]) == 1


def test_durable_cache_and_failure_backoff_survive_repository_recreation(tmp_path):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'hongguo.db'}")
    ModuleDocumentRecord.__table__.create(runtime.engine)
    clock = Clock()
    first = HongguoTrendsRepository(lambda: runtime)
    snapshot = service(lambda _: httpx.Response(200, text=rank_html()), repository=first, clock=clock).get("ai")
    assert snapshot.status == "fresh"
    second = HongguoTrendsRepository(lambda: runtime)
    restored = service(lambda _: pytest.fail("Fresh cache performed network I/O"), repository=second, clock=clock).get("ai")
    assert snapshot == restored
    clock.advance(hours=1)
    failed = service(lambda _: httpx.Response(503), repository=second, clock=clock).get("ai")
    third = HongguoTrendsRepository(lambda: runtime)
    assert service(lambda _: pytest.fail("Backoff performed network I/O"), repository=third, clock=clock).get("ai") == failed
    runtime.engine.dispose()


@pytest.mark.parametrize("format", ["real", "comic", "ai"])
def test_categories_actual_navigation_complete_and_format_scoped(format):
    labels = ["爱情", "年代", "剧情", "奇幻", "玄幻", "恐怖", "惊悚", "综艺"]
    html = category_html(format, labels) + category_html("other", ["外国分类"])
    result, updated = parse_categories(html, format)
    assert result == labels
    assert updated is None
    snapshot = service(lambda _: httpx.Response(200, text=html)).get_categories(format)
    assert [item.label for item in snapshot.categories] == labels
    assert snapshot.source_url == CATEGORY_URLS[format]
    assert snapshot.status == "fresh"


@pytest.mark.parametrize("url", [
    "http://hongguoduanju.com/rank/hot-comic-drama",
    "https://hongguoduanju.com.evil.example/rank/hot-comic-drama",
    "https://hongguoduanju.com@evil.example/rank/hot-comic-drama",
    "https://hongguoduanju.com/rank/hot-comic-drama?page=6",
    "https://hongguoduanju.com/rank/hot-comic-drama?page=2&url=http://127.0.0.1",
    "https://hongguoduanju.com/category/comic-drama/creative",
    "http://127.0.0.1/", "file:///etc/passwd",
])
def test_fetch_allowlist_rejects_arbitrary_urls(url):
    assert not allowed_fetch_url(url)
    client = httpx.Client(transport=httpx.MockTransport(lambda _: pytest.fail("Unsafe URL fetched")))
    with pytest.raises(SourceError):
        HongguoTrendsService._read_html(client, url, time.monotonic() + 10)


def test_no_redirect_following_even_when_client_was_configured_to_follow():
    requests = []

    def handler(request):
        requests.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})

    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    snapshot = HongguoTrendsService(HongguoTrendsRepository(), client=client).get("real")
    assert snapshot.status == "unavailable"
    assert requests == [RANK_URLS["real"]]


def test_safe_work_links_and_optional_cover():
    unsafe = work(href="javascript:alert(1)", cover="https://evil.example/cover.png")
    sample = service(lambda _: httpx.Response(200, text=rank_html([unsafe]))).get("comic").recommendations[0].sample_works[0]
    assert sample.url == "https://hongguoduanju.com/detail?series_id=1001"
    assert sample.cover_url is None
    assert cover_url("https://p6-novel.byteimg.com:443/cover") is None
    assert cover_url("javascript:alert(1)") is None
    assert cover_url("https://p6-novel.byteimg.com/cover") is not None


def test_api_contract_categories_recommendations_and_format_validation():
    requests = []

    def handler(request):
        requests.append(str(request.url))
        return httpx.Response(200, text=category_html() if "/category/" in request.url.path else rank_html())

    feed = service(handler)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_hongguo_trends_service] = lambda: feed
    with TestClient(app) as client:
        trends = client.get("/hongguo/trending-tags?format=comic")
        assert trends.status_code == 200
        data = trends.json()["data"]
        assert data["sample_work_count"] == 1
        assert data["status"] == "fresh"
        assert "categories" not in data
        unmapped = next(item for item in data["recommendations"] if item["label"] == "萌宝")
        assert unmapped["tag_id"] is None
        assert set(unmapped["sample_works"][0]) == {"title", "url", "rank", "cover_url"}
        categories = client.get("/hongguo/categories?format=comic")
        assert categories.status_code == 200
        data = categories.json()["data"]
        assert len(data["categories"]) == 8
        assert data["source_updated_label"] is None
        assert "recommendations" not in data
        assert client.get("/hongguo/categories?format=unknown").status_code == 422
        assert client.get("/hongguo/trending-tags?format=https://evil.example").status_code == 422
        assert len(requests) == 2


@pytest.mark.parametrize("path", ["categories", "trending-tags"])
def test_api_cold_unavailable_has_metadata_and_503(path):
    feed = service(lambda _: httpx.Response(503))
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_hongguo_trends_service] = lambda: feed
    with TestClient(app) as client:
        response = client.get(f"/hongguo/{path}")
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "300"
    data = response.json()["data"]
    assert data["status"] == "unavailable"
    assert data["fetched_at"] is None
    assert data["last_attempt_status"] == "failed"
    assert data["next_retry_at"]


def test_refresh_due_only_existing_fixed_keys_respects_ttl_backoff_and_stop():
    clock, repository, stop = Clock(), HongguoTrendsRepository(), Event()
    requests = []
    failing = False

    def handler(request):
        requests.append(str(request.url))
        if failing:
            return httpx.Response(503)
        return httpx.Response(200, text=category_html("real") if "/category/" in request.url.path else rank_html())

    feed = service(handler, repository=repository, clock=clock)
    assert feed.refresh_due() == []
    assert requests == []
    first = feed.get_categories("real")
    feed.get("comic")
    # Legacy skeleton IDs and arbitrary persisted keys are never scheduled.
    repository.save(first.model_copy(update={"id": "real"}))
    repository.save(first.model_copy(update={"id": "categories.v2.other"}))
    clock.advance(minutes=59)
    assert feed.refresh_due() == []
    assert len(requests) == 2
    clock.advance(minutes=1)
    stop.set()
    assert feed.refresh_due(stop) == []
    assert len(requests) == 2
    stop.clear()
    failing = True
    refreshed = feed.refresh_due(stop)
    assert {item.id for item in refreshed} == {"categories.v2.real", "trends.v2.comic"}
    assert all(item.status == "stale" for item in refreshed)
    assert len(requests) == 4
    clock.advance(minutes=4)
    assert feed.refresh_due() == []
    assert len(requests) == 4
    clock.advance(minutes=1)
    failing = False
    assert all(item.status == "fresh" for item in feed.refresh_due())
    assert len(requests) == 6


def test_refresh_due_retries_a_cached_cold_failure_without_fetching_untouched_feeds():
    clock, repository = Clock(), HongguoTrendsRepository()
    service(lambda _: httpx.Response(503), repository=repository, clock=clock).get("ai")
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, text=rank_html())

    feed = service(handler, repository=repository, clock=clock)
    assert feed.refresh_due() == []
    clock.advance(minutes=5)
    refreshed = feed.refresh_due()
    assert len(refreshed) == 1
    assert refreshed[0].status == "fresh"
    assert calls == [RANK_URLS["ai"]]


def test_refresh_due_stops_between_feeds_after_active_request_finishes():
    clock, repository, stop = Clock(), HongguoTrendsRepository(), Event()
    seed = service(lambda _: httpx.Response(200, text=rank_html()), repository=repository, clock=clock)
    seed.get("real")
    seed.get("comic")
    clock.advance(hours=1)
    calls = []

    def handler(request):
        calls.append(str(request.url))
        stop.set()
        return httpx.Response(200, text=rank_html())

    refreshed = service(handler, repository=repository, clock=clock).refresh_due(stop)
    assert len(refreshed) == 1
    assert calls == [RANK_URLS["real"]]
    assert repository.get("trends.v2.comic").fetched_at < refreshed[0].fetched_at


def test_refresh_due_skips_active_format_without_blocking_shutdown():
    clock, repository = Clock(), HongguoTrendsRepository()
    seed = service(lambda _: httpx.Response(200, text=rank_html()), repository=repository, clock=clock)
    seed.get("real")
    seed.get("comic")
    clock.advance(hours=1)
    entered, release = Event(), Event()
    calls = []

    def handler(request):
        calls.append(str(request.url))
        if "real" in request.url.path:
            entered.set()
            assert release.wait(3)
        return httpx.Response(200, text=rank_html())

    feed = service(handler, repository=repository, clock=clock)
    with ThreadPoolExecutor(max_workers=2) as pool:
        active = pool.submit(feed.get, "real")
        assert entered.wait(2)
        try:
            refreshed = pool.submit(feed.refresh_due).result(timeout=2)
            assert [item.format for item in refreshed] == ["comic"]
        finally:
            release.set()
        assert active.result(timeout=2).status == "fresh"
    assert calls.count(RANK_URLS["real"]) == 1


@pytest.mark.parametrize("path", ["categories", "trending-tags"])
def test_api_stale_retains_payload_metadata_and_returns_200(path):
    clock = Clock()
    failing = False

    def handler(request):
        if failing:
            return httpx.Response(502)
        return httpx.Response(200, text=category_html("real") if "/category/" in request.url.path else rank_html())

    feed = service(handler, clock=clock)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_hongguo_trends_service] = lambda: feed
    with TestClient(app) as client:
        before = client.get(f"/hongguo/{path}?format=real").json()["data"]
        clock.advance(hours=1)
        failing = True
        response = client.get(f"/hongguo/{path}?format=real")
        data = response.json()["data"]
        assert response.status_code == 200
        assert data["status"] == "stale"
        assert data["stale"] is True
        assert data["fetched_at"] == before["fetched_at"]
        assert data["source_updated_label"] == before["source_updated_label"]
        assert data["last_attempt_at"] > before["last_attempt_at"]
        assert data["last_attempt_status"] == "failed"
        field = "categories" if path == "categories" else "recommendations"
        assert data[field] == before[field]
        assert client.get(f"/hongguo/{path}?format=real").json()["data"] == data


@pytest.mark.parametrize("failure", ["noise", "changed-page-count", "changed-update-label"])
def test_unusable_or_inconsistent_source_preserves_previous_good_snapshot(failure):
    clock, repository = Clock(), HongguoTrendsRepository()
    before = service(lambda _: httpx.Response(200, text=rank_html()), repository=repository, clock=clock).get("comic")
    clock.advance(hours=1)

    def handler(request):
        page = int(request.url.params.get("page", 1))
        if failure == "noise":
            html = rank_html([work(tags=["205", "完结", "全80集"])])
        else:
            html = rank_html(page=page, total=3 if page == 2 and failure == "changed-page-count" else 2,
                             updated="9月12日已更新" if page == 2 and failure == "changed-update-label" else UPDATED)
        return httpx.Response(200, text=html)

    stale = service(handler, repository=repository, clock=clock).get("comic")
    assert stale.status == "stale"
    assert stale.recommendations == before.recommendations
    assert stale.fetched_at == before.fetched_at


@pytest.mark.parametrize("body,content_type", [
    (b'{"rankList": []}', "application/json"),
    (b"x" * 4_000_001, "text/html"),
    (b"\xff", "text/html"),
])
def test_source_response_type_size_and_encoding_limits(body, content_type):
    with httpx.Client(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, content=body, headers={"Content-Type": content_type}),
    )) as client:
        with pytest.raises(SourceError):
            HongguoTrendsService._read_html(client, RANK_URLS["comic"], time.monotonic() + 10)


def test_source_deadline_checked_before_network():
    with httpx.Client(transport=httpx.MockTransport(lambda _: pytest.fail("Expired request fetched"))) as client:
        with pytest.raises(SourceError):
            HongguoTrendsService._read_html(client, RANK_URLS["comic"], time.monotonic() - 1)


def test_app_refresh_runs_off_request_loop_and_stops_with_lifespan(monkeypatch):
    from app import main as app_main

    started, finished = Event(), Event()

    class Feed:
        def refresh_due(self, stop_event):
            started.set()
            assert stop_event.wait(timeout=3)
            finished.set()

    monkeypatch.setattr(app_main, "get_hongguo_trends_service", Feed)
    with TestClient(app_main.create_app(require_host_context=False)) as client:
        assert started.wait(timeout=2)
        assert client.get("/health/live").status_code == 200
        assert not finished.is_set()
    assert finished.is_set()
