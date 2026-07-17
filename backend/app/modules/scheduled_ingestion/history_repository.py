from __future__ import annotations

from app.modules.scheduled_ingestion.models import DataIngestionRunHistory


class DataIngestionRunHistoryRepository:
    """In-memory repository for ingestion run history snapshots."""

    def __init__(self) -> None:
        self._items: dict[str, DataIngestionRunHistory] = {}

    def save(self, run_history: DataIngestionRunHistory) -> DataIngestionRunHistory:
        self._items[run_history.id] = run_history
        return run_history

    def get(self, run_history_id: str) -> DataIngestionRunHistory | None:
        return self._items.get(run_history_id)

    def list(self) -> list[DataIngestionRunHistory]:
        return list(self._items.values())

    def list_by_job(self, job_id: str) -> list[DataIngestionRunHistory]:
        return [item for item in self._items.values() if item.job_id == job_id]
