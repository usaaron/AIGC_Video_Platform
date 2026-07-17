from __future__ import annotations

from collections import Counter

from app.modules.scheduled_ingestion.models import DataIngestionRunHistory, IngestionRunStatus
from app.modules.scheduled_ingestion.repository import DataIngestionJobRepository
from app.modules.scheduled_ingestion.history_repository import DataIngestionRunHistoryRepository
from app.modules.trend_snapshot.models import (
    TrendSnapshot,
    TrendSnapshotGenerateRequest,
    TrendTagSignal,
)
from app.modules.trend_snapshot.repository import TrendSnapshotRepository


class MissingDataIngestionJobError(ValueError):
    """Raised when a referenced ingestion job does not exist."""


class InsufficientRunHistoryError(ValueError):
    """Raised when there is not enough history to build a trend snapshot."""


class TrendSnapshotService:
    def __init__(
        self,
        repository: TrendSnapshotRepository,
        data_ingestion_job_repository: DataIngestionJobRepository,
        run_history_repository: DataIngestionRunHistoryRepository,
    ) -> None:
        self._repository = repository
        self._data_ingestion_job_repository = data_ingestion_job_repository
        self._run_history_repository = run_history_repository

    def generate(self, payload: TrendSnapshotGenerateRequest) -> TrendSnapshot:
        job = self._data_ingestion_job_repository.get(payload.job_id)
        if job is None:
            raise MissingDataIngestionJobError(
                f"DataIngestionJob '{payload.job_id}' was not found."
            )

        histories = sorted(
            self._run_history_repository.list_by_job(payload.job_id),
            key=lambda item: item.completed_at,
            reverse=True,
        )[: payload.lookback_runs]
        if not histories:
            raise InsufficientRunHistoryError(
                f"DataIngestionJob '{payload.job_id}' does not have run history yet."
            )

        successful_histories = [
            item for item in histories if item.run_status == IngestionRunStatus.succeeded
        ]
        snapshot = TrendSnapshot(
            job_id=job.id,
            platform_profile_id=job.platform_profile_id,
            run_history_ids=[item.id for item in histories],
            lookback_runs=payload.lookback_runs,
            successful_run_count=sum(
                1 for item in histories if item.run_status == IngestionRunStatus.succeeded
            ),
            skipped_run_count=sum(
                1 for item in histories if item.run_status == IngestionRunStatus.skipped
            ),
            failed_run_count=sum(
                1 for item in histories if item.run_status == IngestionRunStatus.failed
            ),
            total_imported_records=sum(item.imported_record_count for item in histories),
            total_duplicate_skips=sum(item.skipped_duplicate_count for item in histories),
            average_preference_score=self._average_optional_score(
                [item.average_preference_score for item in successful_histories]
            ),
            average_commercial_score=self._average_optional_score(
                [item.average_commercial_score for item in successful_histories]
            ),
            average_platform_fit_score=self._average_optional_score(
                [item.average_platform_fit_score for item in successful_histories]
            ),
            top_mapped_tags=self._build_tag_signals(
                histories=successful_histories,
                attr_name="mapped_tag_ids",
            ),
            top_content_spec_tags=self._build_tag_signals(
                histories=successful_histories,
                attr_name="content_spec_tag_ids",
            ),
            metadata=payload.metadata,
            notes=[
                "Trend snapshot is generated from ingestion run history, not direct raw scraping.",
                "Current snapshot aggregates recent run outcomes and controlled tag signals.",
            ],
        )
        return self._repository.save(snapshot)

    def get(self, snapshot_id: str) -> TrendSnapshot | None:
        return self._repository.get(snapshot_id)

    def list(self) -> list[TrendSnapshot]:
        return self._repository.list()

    def _average_optional_score(self, values: list[float | None]) -> float | None:
        filtered_values = [value for value in values if value is not None]
        if not filtered_values:
            return None
        return round(sum(filtered_values) / len(filtered_values), 3)

    def _build_tag_signals(
        self,
        histories: list[DataIngestionRunHistory],
        attr_name: str,
    ) -> list[TrendTagSignal]:
        counter: Counter[str] = Counter()
        for history in histories:
            for tag_id in getattr(history, attr_name):
                counter[tag_id] += 1

        total_runs = max(len(histories), 1)
        return [
            TrendTagSignal(
                ontology_node_id=tag_id,
                occurrences=count,
                share_of_runs=round(count / total_runs, 3),
            )
            for tag_id, count in counter.most_common(5)
        ]
