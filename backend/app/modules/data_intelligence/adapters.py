from __future__ import annotations

import csv
import io
from abc import ABC, abstractmethod
from datetime import datetime

from app.modules.data_intelligence.models import (
    EngagementMetrics,
    RawContentRecordInput,
)


class DataSourceAdapter(ABC):
    @abstractmethod
    def parse(self, source) -> list[RawContentRecordInput]:
        raise NotImplementedError


class ManualJSONImportAdapter(DataSourceAdapter):
    def parse(self, source: list[dict] | list[RawContentRecordInput]) -> list[RawContentRecordInput]:
        records: list[RawContentRecordInput] = []
        for item in source:
            if isinstance(item, RawContentRecordInput):
                records.append(item)
            else:
                records.append(RawContentRecordInput.model_validate(item))
        return records


class ManualCSVImportAdapter(DataSourceAdapter):
    def parse(self, source: str) -> list[RawContentRecordInput]:
        reader = csv.DictReader(io.StringIO(source))
        records: list[RawContentRecordInput] = []
        for row in reader:
            published_at = row.get("published_at") or None
            records.append(
                RawContentRecordInput(
                    source_name=self._get_required_value(row, "source_name"),
                    source_item_id=self._get_required_value(row, "source_item_id"),
                    platform=self._get_required_value(row, "platform"),
                    source_url=row.get("source_url") or None,
                    title=self._get_required_value(row, "title"),
                    body_text=self._get_required_value(row, "body_text"),
                    author_handle=row.get("author_handle", ""),
                    language=self._get_required_value(row, "language"),
                    region=self._get_required_value(row, "region"),
                    published_at=datetime.fromisoformat(published_at) if published_at else None,
                    engagement=EngagementMetrics(
                        view_count=int(row.get("view_count", 0) or 0),
                        like_count=int(row.get("like_count", 0) or 0),
                        comment_count=int(row.get("comment_count", 0) or 0),
                        share_count=int(row.get("share_count", 0) or 0),
                        save_count=int(row.get("save_count", 0) or 0),
                        completion_rate=float(row.get("completion_rate", 0.0) or 0.0),
                    ),
                    metadata={},
                )
            )
        return records

    def _get_required_value(self, row: dict[str, str | None], field_name: str) -> str:
        value = row.get(field_name)
        if value is None or not value.strip():
            raise ValueError(
                f"ManualCSVImportAdapter requires a non-empty '{field_name}' column."
            )
        return value.strip()


class TikTokScraperAdapter(DataSourceAdapter):
    def parse(self, source) -> list[RawContentRecordInput]:
        raise NotImplementedError("TikTokScraperAdapter is reserved for Phase 2.")


class ApifyAdapter(DataSourceAdapter):
    def parse(self, source) -> list[RawContentRecordInput]:
        raise NotImplementedError("ApifyAdapter is reserved for Phase 2.")


class RedditAdapter(DataSourceAdapter):
    def parse(self, source) -> list[RawContentRecordInput]:
        raise NotImplementedError("RedditAdapter is reserved for Phase 2.")


class YouTubeAdapter(DataSourceAdapter):
    def parse(self, source) -> list[RawContentRecordInput]:
        raise NotImplementedError("YouTubeAdapter is reserved for Phase 2.")


class WebtoonAdapter(DataSourceAdapter):
    def parse(self, source) -> list[RawContentRecordInput]:
        raise NotImplementedError("WebtoonAdapter is reserved for Phase 2.")
