from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.modules.hongguo_trends.models import HongguoFormat
from app.modules.hongguo_trends.taxonomy import source_label


ORIGIN = "https://hongguoduanju.com"
RANK_URLS = {format: f"{ORIGIN}/rank/hot-{format}-drama" for format in ("real", "comic", "ai")}
CATEGORY_URLS = {format: f"{ORIGIN}/category/{format}-drama" for format in ("real", "comic", "ai")}
MAX_PAGES = 5


class SourceError(ValueError):
    pass


def rank_url(format: HongguoFormat, page: int) -> str:
    if format not in RANK_URLS or not 1 <= page <= MAX_PAGES:
        raise SourceError("Invalid ranking page")
    return RANK_URLS[format] + (f"?page={page}" if page != 1 else "")


def allowed_fetch_url(url: str) -> bool:
    return url in set(CATEGORY_URLS.values()) | {
        rank_url(format, page) for format in RANK_URLS for page in range(1, MAX_PAGES + 1)
    }


def work_url(href: object, series_id: str) -> str:
    # Work links are generated from validated numeric IDs, never followed server-side.
    return f"{ORIGIN}/detail?series_id={series_id}"


def cover_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    if (parts.scheme != "https" or parts.username or parts.password or parts.fragment
            or not re.fullmatch(r"p\d+-(?:novel|novel-sign|novel-seo)\.byteimg\.com", parts.netloc)):
        return None
    return value


class RankedWork(BaseModel):
    model_config = ConfigDict(extra="ignore")

    seriesId: str = Field(pattern=r"^[0-9]+$")
    rank: int = Field(strict=True, ge=1, le=10000)
    title: str = Field(min_length=1, max_length=240)
    tags: list[str] = Field(max_length=100)
    href: str | None = None
    cover: str | None = None


@dataclass
class RankPage:
    works: list[RankedWork]
    page_number: int
    total_pages: int
    source_updated_label: str | None


class SourceHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.payloads: list[dict[str, Any]] = []
        self.visible_text: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._hidden = 0
        self._link: tuple[str, list[str]] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag in {"script", "style", "head", "noscript"}:
            self._hidden += 1
        if tag == "script" and attributes.get("data-script-src") == "modern-run-router-data-fn":
            try:
                args = json.loads(attributes.get("data-fn-args") or "null")
            except (ValueError, TypeError):
                return
            if isinstance(args, list) and args and isinstance(args[-1], dict):
                self.payloads.append(args[-1])
        if tag == "a" and not self._hidden:
            self._link = (attributes.get("href") or "", [])

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "head", "noscript"}:
            self._hidden = max(0, self._hidden - 1)
        if tag == "a" and self._link is not None:
            href, parts = self._link
            self.links.append((href, "".join(parts)))
            self._link = None

    def handle_data(self, data: str) -> None:
        if not self._hidden:
            if data.strip():
                self.visible_text.append(" ".join(data.replace("\x00", "").split()))
            if self._link is not None:
                self._link[1].append(data)

    @property
    def updated_label(self) -> str | None:
        # The source's displayed publication label is separate from our fetch timestamp.
        return next((text for text in self.visible_text
                     if re.search(r"\d{1,2}月\d{1,2}日.*更新", text)), None)


def parse_rank_page(html: str, expected_page: int) -> RankPage:
    parser = SourceHTMLParser()
    parser.feed(html)
    payload = next((item for item in parser.payloads if "rankList" in item), None)
    if payload is None or payload.get("isSuccess") is False:
        raise SourceError("Ranking router data unavailable")
    records = payload.get("rankList")
    pagination = payload.get("pagination")
    if not isinstance(records, list) or not records or len(records) > 200 or not isinstance(pagination, dict):
        raise SourceError("Invalid ranking page structure")
    page, total = pagination.get("pageNum"), pagination.get("totalPages")
    if (type(page) is not int or page != expected_page or type(total) is not int
            or total < page or total > 10000):
        raise SourceError("Invalid ranking pagination")
    try:
        works = [RankedWork.model_validate(record) for record in records]
    except ValidationError as exc:
        raise SourceError("Invalid ranked work") from exc
    return RankPage(works, page, total, parser.updated_label)


def parse_categories(html: str, format: HongguoFormat) -> tuple[list[str], str | None]:
    parser = SourceHTMLParser()
    parser.feed(html)
    base_path = urlsplit(CATEGORY_URLS[format]).path
    labels: list[str] = []
    for href, text in parser.links:
        try:
            parts = urlsplit(urljoin(ORIGIN, href))
        except ValueError:
            continue
        if (parts.scheme != "https" or parts.netloc != "hongguoduanju.com"
                or parts.query or parts.fragment
                or not re.fullmatch(re.escape(base_path) + r"/[a-z0-9-]+", parts.path)):
            continue
        label = source_label(text)
        if label and label not in labels:
            labels.append(label)
    if not labels:
        raise SourceError("Category navigation unavailable")
    return labels, parser.updated_label
