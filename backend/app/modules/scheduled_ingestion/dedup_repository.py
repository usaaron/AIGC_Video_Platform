class IngestionDedupRepository:
    """Stores imported source fingerprints to avoid duplicate ingestion."""

    def __init__(self) -> None:
        self._external_ids: set[str] = set()
        self._source_urls: set[str] = set()

    def has_external_id(self, external_id: str) -> bool:
        return external_id.strip().lower() in self._external_ids

    def has_source_url(self, source_url: str) -> bool:
        return source_url.strip().lower() in self._source_urls

    def mark_imported(self, external_id: str | None, source_url: str | None) -> None:
        if external_id:
            self._external_ids.add(external_id.strip().lower())
        if source_url:
            self._source_urls.add(source_url.strip().lower())
