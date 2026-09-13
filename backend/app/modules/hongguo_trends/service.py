from __future__ import annotations

import logging
import re
import time
from collections import defaultdict
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from threading import Event, Lock
from typing import Literal

import httpx
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.modules.hongguo_trends.models import (
    HongguoCategory,
    HongguoFormat,
    HongguoSampleWork,
    HongguoTagRecommendation,
    HongguoTrendsSnapshot,
)
from app.modules.hongguo_trends.repository import HongguoTrendsRepository
from app.modules.hongguo_trends.source import (
    CATEGORY_URLS,
    MAX_PAGES,
    RANK_URLS,
    RankedWork,
    SourceError,
    allowed_fetch_url,
    cover_url,
    parse_categories,
    parse_rank_page,
    rank_url,
    work_url,
)
from app.modules.hongguo_trends.taxonomy import TAG_IDS, TAXONOMY_REVISION, source_label


logger = logging.getLogger(__name__)
# Process-local singleflight survives service recreation. Multiple workers may refresh
# the same durable document concurrently; repository writes remain last-write-wins.
_FORMAT_LOCKS = {format: Lock() for format in RANK_URLS}
_SEASON_SUFFIX = re.compile(r"\s*第[0-9零一二三四五六七八九十百两]+[季部]\s*$")


def _deduplicate_works(works: list[RankedWork]) -> list[RankedWork]:
    ordered = sorted(works, key=lambda work: (work.rank, work.seriesId))
    season_roots = {
        _SEASON_SUFFIX.sub("", work.title.strip()) for work in works
        if _SEASON_SUFFIX.search(work.title.strip())
    }
    seen_ids: set[str] = set()
    seen_franchises: set[str] = set()
    result = []
    for work in ordered:
        if work.seriesId in seen_ids:
            continue
        seen_ids.add(work.seriesId)
        root = _SEASON_SUFFIX.sub("", work.title.strip())
        # No fuzzy titles or bare-number stripping: those can merge unrelated stories.
        if root in season_roots and len(root) >= 3:
            if root in seen_franchises:
                continue
            seen_franchises.add(root)
        result.append(work)
    return result


def build_recommendations(works: list[RankedWork]) -> list[HongguoTagRecommendation]:
    counts: dict[str, int] = defaultdict(int)
    scores: dict[str, float] = defaultdict(float)
    labels: dict[str, list[str]] = defaultdict(list)
    samples: dict[str, list[HongguoSampleWork]] = defaultdict(list)
    for work in works:
        per_work: dict[str, list[str]] = defaultdict(list)
        for raw_tag in work.tags:
            label = source_label(raw_tag)
            if label is None:
                continue
            key = TAG_IDS.get(label) or f"label:{label}"
            if label not in per_work[key]:
                per_work[key].append(label)
        for key, raw_labels in per_work.items():
            counts[key] += 1
            scores[key] += 1 / work.rank
            labels[key].extend(label for label in raw_labels if label not in labels[key])
            if len(samples[key]) < 3:
                samples[key].append(HongguoSampleWork(
                    title=work.title.replace("\x00", "").strip(),
                    url=work_url(work.href, work.seriesId), rank=work.rank,
                    cover_url=cover_url(work.cover),
                ))
    ranked = sorted(counts, key=lambda key: (-scores[key], -counts[key], key))
    return [HongguoTagRecommendation(
        label=labels[key][0], raw_labels=labels[key], tag_id=TAG_IDS.get(labels[key][0]),
        rank=position, ranked_work_count=counts[key], weighted_score=round(scores[key], 6),
        sample_works=samples[key],
    ) for position, key in enumerate(ranked, start=1)]


class HongguoTrendsService:
    def __init__(
        self,
        repository: HongguoTrendsRepository,
        *,
        client: httpx.Client | None = None,
        cache_ttl: timedelta = timedelta(hours=1),
        retry_backoff: timedelta = timedelta(minutes=5),
        clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self._repository = repository
        self._client = client
        self._cache_ttl = cache_ttl
        self._retry_backoff = retry_backoff
        self._clock = clock

    def get(self, format: HongguoFormat) -> HongguoTrendsSnapshot:
        return self._get("trends", format)

    def get_categories(self, format: HongguoFormat) -> HongguoTrendsSnapshot:
        return self._get("categories", format)

    def refresh_due(self, stop_event: Event | None = None) -> list[HongguoTrendsSnapshot]:
        """Refresh only existing, due v2 feeds; never cold-fetch untouched formats.

        Lifecycle callers can run this synchronously in a worker thread. Shutdown
        is checked between feeds; an active fetch retains its 45-second budget
        and 10-second socket timeout. Busy formats are skipped until the next tick.
        """
        refreshed = []
        for format in RANK_URLS:
            for kind in ("categories", "trends"):
                if stop_event is not None and stop_event.is_set():
                    return refreshed
                lock = _FORMAT_LOCKS[format]
                if not lock.acquire(blocking=False):
                    continue
                try:
                    key = f"{kind}.v2.{format}"
                    try:
                        snapshot = self._repository.get(key)
                    except (SQLAlchemyError, ValidationError):
                        logger.warning("Hongguo scheduled cache read failed: %s", key)
                        continue
                    if snapshot is None or not self._is_due(snapshot, self._clock()):
                        continue
                    if stop_event is not None and stop_event.is_set():
                        return refreshed
                    refreshed.append(self._refresh(kind, format, snapshot))
                finally:
                    lock.release()
        return refreshed

    def _is_due(self, snapshot: HongguoTrendsSnapshot, now: datetime) -> bool:
        if snapshot.next_retry_at and now < snapshot.next_retry_at:
            return False
        return (snapshot.taxonomy_revision != TAXONOMY_REVISION
                or snapshot.fetched_at is None or now >= snapshot.fetched_at + self._cache_ttl)

    def _get(self, kind: Literal["trends", "categories"], format: HongguoFormat) -> HongguoTrendsSnapshot:
        if format not in _FORMAT_LOCKS:
            raise ValueError("Unsupported Hongguo format")
        key = f"{kind}.v2.{format}"
        source_url = (RANK_URLS if kind == "trends" else CATEGORY_URLS)[format]
        with _FORMAT_LOCKS[format]:
            now = self._clock()
            try:
                snapshot = self._repository.get(key)
            except SQLAlchemyError:
                logger.warning("Hongguo cache read failed: %s", key)
                return self._failure(None, key, format, source_url, now)
            except ValidationError:
                logger.warning("Hongguo invalid cache document: %s", key)
                snapshot = None
            if snapshot is not None and not self._is_due(snapshot, now):
                return snapshot
            return self._refresh(kind, format, snapshot)

    def _refresh(
        self, kind: Literal["trends", "categories"], format: HongguoFormat,
        snapshot: HongguoTrendsSnapshot | None,
    ) -> HongguoTrendsSnapshot:
        key = f"{kind}.v2.{format}"
        source_url = (RANK_URLS if kind == "trends" else CATEGORY_URLS)[format]
        now = self._clock()
        try:
            fresh = self._fetch(kind, format)
        except (httpx.HTTPError, SourceError, ValidationError):
            logger.warning("Hongguo source refresh failed: %s", key)
            result = self._failure(snapshot, key, format, source_url, self._clock())
        else:
            completed_at = self._clock()
            result = HongguoTrendsSnapshot(
                id=key, format=format, source_url=source_url,
                taxonomy_revision=TAXONOMY_REVISION,
                fetched_at=completed_at, status="fresh", stale=False,
                last_attempt_at=now, last_attempt_status="succeeded",
                next_refresh_at=completed_at + self._cache_ttl, **fresh,
            )
        try:
            return self._repository.save(result)
        except SQLAlchemyError:
            logger.warning("Hongguo cache write failed: %s", key)
            return self._failure(snapshot, key, format, source_url, self._clock())

    def _failure(
        self, snapshot: HongguoTrendsSnapshot | None, key: str, format: HongguoFormat,
        source_url: str, now: datetime,
    ) -> HongguoTrendsSnapshot:
        retry_at = now + self._retry_backoff
        status_fields = {
            "status": "stale" if snapshot and snapshot.fetched_at else "unavailable",
            "stale": bool(snapshot and snapshot.fetched_at),
            "last_attempt_at": now, "last_attempt_status": "failed",
            "next_retry_at": retry_at, "next_refresh_at": retry_at,
        }
        if snapshot:
            return snapshot.model_copy(update=status_fields)
        return HongguoTrendsSnapshot(id=key, format=format, source_url=source_url, **status_fields)

    def _fetch(self, kind: str, format: HongguoFormat) -> dict:
        client = self._client or httpx.Client(
            timeout=10, follow_redirects=False, trust_env=False,
            headers={"Accept": "text/html", "User-Agent": "HongguoPublicRankingFeed/1.0"},
        )
        deadline = time.monotonic() + 45
        try:
            if kind == "categories":
                labels, updated = parse_categories(self._read_html(client, CATEGORY_URLS[format], deadline), format)
                return {"categories": [HongguoCategory(label=label, tag_id=TAG_IDS.get(label)) for label in labels],
                        "source_updated_label": updated}
            first = parse_rank_page(self._read_html(client, rank_url(format, 1), deadline), 1)
            works = list(first.works)
            pages = min(first.total_pages, MAX_PAGES)
            for page in range(2, pages + 1):
                parsed = parse_rank_page(self._read_html(client, rank_url(format, page), deadline), page)
                if parsed.total_pages != first.total_pages or parsed.source_updated_label != first.source_updated_label:
                    raise SourceError("Ranking changed during pagination")
                works.extend(parsed.works)
            works = _deduplicate_works(works)
            recommendations = build_recommendations(works)
            if not recommendations:
                raise SourceError("Ranking contained no meaningful tags")
            return {"recommendations": recommendations, "sample_work_count": len(works),
                    "pages_fetched": pages, "source_updated_label": first.source_updated_label}
        finally:
            if self._client is None:
                client.close()

    @staticmethod
    def _read_html(client: httpx.Client, url: str, deadline: float) -> str:
        if not allowed_fetch_url(url):
            raise SourceError("Source URL is not allowlisted")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SourceError("Source refresh deadline exceeded")
        # Never follow source-controlled pagination URLs or redirects, even with an injected client.
        with client.stream("GET", url, follow_redirects=False, timeout=min(10, remaining)) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "text/html").split(";", 1)[0].lower()
            if content_type not in {"text/html", "application/xhtml+xml"}:
                raise SourceError("Source did not return HTML")
            chunks = []
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 4_000_000 or time.monotonic() > deadline:
                    raise SourceError("Source response exceeded its limits")
                chunks.append(chunk)
        try:
            return b"".join(chunks).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise SourceError("Source returned invalid UTF-8") from exc
