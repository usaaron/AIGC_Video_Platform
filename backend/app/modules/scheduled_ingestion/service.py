from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pydantic import ValidationError

from app.modules.data_intelligence.adapters import ManualCSVImportAdapter, ManualJSONImportAdapter
from app.modules.data_intelligence.models import DataPipelineResponse, RawContentRecordInput
from app.modules.data_intelligence.service import DataIntelligenceService
from app.modules.platform_profile.repository import PlatformProfileRepository
from app.modules.scheduled_ingestion.dedup_repository import IngestionDedupRepository
from app.modules.scheduled_ingestion.history_repository import DataIngestionRunHistoryRepository
from app.modules.scheduled_ingestion.models import (
    DataIngestionJob,
    DataIngestionJobCreate,
    DataIngestionRunHistory,
    DataIngestionRunResult,
    DataSourceAdapterType,
    IngestionRunStatus,
    IngestionScheduleType,
)
from app.modules.scheduled_ingestion.repository import DataIngestionJobRepository


class DuplicateDataIngestionJobError(ValueError):
    """Raised when a job id already exists."""


class MissingDataIngestionJobError(ValueError):
    """Raised when a job cannot be found."""


class MissingPlatformProfileError(ValueError):
    """Raised when a referenced platform profile does not exist."""


class AdapterExecutionNotImplementedError(NotImplementedError):
    """Raised when a placeholder adapter is not implemented in MVP."""


class ScheduledIngestionService:
    def __init__(
        self,
        repository: DataIngestionJobRepository,
        history_repository: DataIngestionRunHistoryRepository,
        dedup_repository: IngestionDedupRepository,
        platform_profile_repository: PlatformProfileRepository,
        data_intelligence_service: DataIntelligenceService,
    ) -> None:
        self._repository = repository
        self._history_repository = history_repository
        self._dedup_repository = dedup_repository
        self._platform_profile_repository = platform_profile_repository
        self._data_intelligence_service = data_intelligence_service
        self._manual_json_adapter = ManualJSONImportAdapter()
        self._manual_csv_adapter = ManualCSVImportAdapter()

    def create(self, payload: DataIngestionJobCreate) -> DataIngestionJob:
        if self._repository.get(payload.id) is not None:
            raise DuplicateDataIngestionJobError(
                f"DataIngestionJob '{payload.id}' already exists."
            )

        if self._platform_profile_repository.get(payload.platform_profile_id) is None:
            raise MissingPlatformProfileError(
                f"PlatformProfile '{payload.platform_profile_id}' was not found."
            )

        job = DataIngestionJob.model_validate(
            {
                **payload.model_dump(),
                "next_run_at": self._compute_next_run_at(
                    schedule_type=payload.schedule_type,
                    cron_expression=payload.cron_expression,
                    now=datetime.now(timezone.utc),
                ),
            }
        )
        return self._repository.save(job)

    def get(self, job_id: str) -> DataIngestionJob | None:
        return self._repository.get(job_id)

    def list(self) -> list[DataIngestionJob]:
        return self._repository.list()

    def get_run_history(self, run_history_id: str) -> DataIngestionRunHistory | None:
        return self._history_repository.get(run_history_id)

    def list_run_history_by_job(self, job_id: str) -> list[DataIngestionRunHistory]:
        if self._repository.get(job_id) is None:
            raise MissingDataIngestionJobError(
                f"DataIngestionJob '{job_id}' was not found."
            )
        return self._history_repository.list_by_job(job_id)

    def run(self, job_id: str) -> DataIngestionRunResult:
        job = self._repository.get(job_id)
        if job is None:
            raise MissingDataIngestionJobError(
                f"DataIngestionJob '{job_id}' was not found."
            )

        started_at = datetime.now(timezone.utc)
        try:
            parsed_records = self._parse_job_records(job)
            new_records, skipped_duplicate_keys = self._filter_duplicates(parsed_records)
            now = datetime.now(timezone.utc)

            if not new_records:
                updated_job = self._update_job_state(
                    job=job,
                    last_run_at=now,
                    run_status=IngestionRunStatus.skipped,
                    error_message=None,
                )
                run_history = self._record_run_history(
                    job=updated_job,
                    started_at=started_at,
                    completed_at=now,
                    run_status=IngestionRunStatus.skipped,
                    error_message=None,
                    imported_record_count=0,
                    skipped_duplicate_keys=skipped_duplicate_keys,
                    raw_content_record_ids=[],
                    analysis_result_ids=[],
                    mapped_tag_ids=[],
                    content_spec_tag_ids=[],
                    average_preference_score=None,
                    average_commercial_score=None,
                    average_platform_fit_score=None,
                    content_spec_draft_id=None,
                    content_spec_id=None,
                    notes=[
                        "All candidate records were skipped by deduplication.",
                        "Current dedupe keys use source_item_id and source_url.",
                    ],
                )
                return DataIngestionRunResult(
                    job=updated_job,
                    run_history=run_history,
                    imported_record_count=0,
                    skipped_duplicate_count=len(skipped_duplicate_keys),
                    skipped_duplicate_keys=skipped_duplicate_keys,
                    notes=[
                        "All candidate records were skipped by deduplication.",
                        "Current dedupe keys use source_item_id and source_url.",
                    ],
                )

            pipeline_response = self._data_intelligence_service.run_records_pipeline(
                parsed_records=new_records,
                platform_profile_id=job.platform_profile_id,
                audience_hint=job.audience_hint,
                commercial_objective=job.commercial_objective,
            )
            self._mark_imported(new_records)
            updated_job = self._update_job_state(
                job=job,
                last_run_at=now,
                run_status=IngestionRunStatus.succeeded,
                error_message=None,
            )
            return self._build_run_result(
                updated_job=updated_job,
                started_at=started_at,
                pipeline_response=pipeline_response,
                skipped_duplicate_keys=skipped_duplicate_keys,
            )
        except AdapterExecutionNotImplementedError:
            now = datetime.now(timezone.utc)
            updated_job = self._update_job_state(
                job=job,
                last_run_at=now,
                run_status=IngestionRunStatus.failed,
                error_message="Selected adapter is reserved as a Phase 2 placeholder.",
            )
            self._record_run_history(
                job=updated_job,
                started_at=started_at,
                completed_at=now,
                run_status=IngestionRunStatus.failed,
                error_message="Selected adapter is reserved as a Phase 2 placeholder.",
                imported_record_count=0,
                skipped_duplicate_keys=[],
                raw_content_record_ids=[],
                analysis_result_ids=[],
                mapped_tag_ids=[],
                content_spec_tag_ids=[],
                average_preference_score=None,
                average_commercial_score=None,
                average_platform_fit_score=None,
                content_spec_draft_id=None,
                content_spec_id=None,
                notes=["Placeholder adapter was invoked but is not implemented in MVP."],
            )
            raise
        except (ValidationError, ValueError) as exc:
            now = datetime.now(timezone.utc)
            updated_job = self._update_job_state(
                job=job,
                last_run_at=now,
                run_status=IngestionRunStatus.failed,
                error_message=str(exc),
            )
            self._record_run_history(
                job=updated_job,
                started_at=started_at,
                completed_at=now,
                run_status=IngestionRunStatus.failed,
                error_message=str(exc),
                imported_record_count=0,
                skipped_duplicate_keys=[],
                raw_content_record_ids=[],
                analysis_result_ids=[],
                mapped_tag_ids=[],
                content_spec_tag_ids=[],
                average_preference_score=None,
                average_commercial_score=None,
                average_platform_fit_score=None,
                content_spec_draft_id=None,
                content_spec_id=None,
                notes=["Ingestion run failed before standard pipeline completion."],
            )
            raise

    def _parse_job_records(self, job: DataIngestionJob) -> list[RawContentRecordInput]:
        if job.adapter_type == DataSourceAdapterType.manual_json:
            return self._manual_json_adapter.parse(job.manual_json_records)
        if job.adapter_type == DataSourceAdapterType.manual_csv:
            if job.manual_csv_content is None:
                raise ValueError("manual_csv_content is required for manual_csv jobs.")
            return self._manual_csv_adapter.parse(job.manual_csv_content)
        raise AdapterExecutionNotImplementedError(
            f"Adapter '{job.adapter_type.value}' is reserved for a Phase 2 placeholder."
        )

    def _filter_duplicates(
        self,
        parsed_records: list[RawContentRecordInput],
    ) -> tuple[list[RawContentRecordInput], list[str]]:
        new_records: list[RawContentRecordInput] = []
        skipped_duplicate_keys: list[str] = []
        batch_external_ids: set[str] = set()
        batch_source_urls: set[str] = set()

        for record in parsed_records:
            external_key = record.source_item_id.strip().lower()
            source_url = record.source_url.strip().lower() if record.source_url else None

            is_duplicate = False
            if external_key in batch_external_ids or self._dedup_repository.has_external_id(external_key):
                skipped_duplicate_keys.append(f"external_id:{external_key}")
                is_duplicate = True
            elif source_url and (
                source_url in batch_source_urls
                or self._dedup_repository.has_source_url(source_url)
            ):
                skipped_duplicate_keys.append(f"source_url:{source_url}")
                is_duplicate = True

            if is_duplicate:
                continue

            batch_external_ids.add(external_key)
            if source_url:
                batch_source_urls.add(source_url)
            new_records.append(record)

        return new_records, skipped_duplicate_keys

    def _mark_imported(self, parsed_records: list[RawContentRecordInput]) -> None:
        for record in parsed_records:
            self._dedup_repository.mark_imported(
                external_id=record.source_item_id,
                source_url=record.source_url,
            )

    def _compute_next_run_at(
        self,
        schedule_type: IngestionScheduleType,
        cron_expression: str | None,
        now: datetime,
    ) -> datetime:
        if schedule_type == IngestionScheduleType.daily:
            return now + timedelta(days=1)
        if schedule_type == IngestionScheduleType.weekly:
            return now + timedelta(days=7)
        if schedule_type == IngestionScheduleType.custom_cron:
            if cron_expression is None:
                raise ValueError("cron_expression is required for custom_cron schedules.")
            parts = cron_expression.split()
            if len(parts) != 5:
                raise ValueError("cron_expression must contain 5 fields.")
            minute, hour, day_of_month, month, day_of_week = parts
            if not minute.isdigit() or not hour.isdigit():
                raise ValueError("Current MVP cron support requires numeric minute and hour.")
            if not (0 <= int(minute) <= 59 and 0 <= int(hour) <= 23):
                raise ValueError("Current MVP cron support requires minute 0-59 and hour 0-23.")
            if any(part != "*" for part in (day_of_month, month, day_of_week)):
                raise ValueError(
                    "Current MVP cron support only accepts '<minute> <hour> * * *'."
                )
            next_run = now.replace(
                hour=int(hour),
                minute=int(minute),
                second=0,
                microsecond=0,
            )
            if next_run <= now:
                next_run += timedelta(days=1)
            return next_run
        raise ValueError("Unsupported schedule type.")

    def _update_job_state(
        self,
        job: DataIngestionJob,
        last_run_at: datetime,
        run_status: IngestionRunStatus,
        error_message: str | None,
    ) -> DataIngestionJob:
        updated_job = job.model_copy(
            update={
                "last_run_at": last_run_at,
                "next_run_at": self._compute_next_run_at(
                    schedule_type=job.schedule_type,
                    cron_expression=job.cron_expression,
                    now=last_run_at,
                ),
                "run_status": run_status,
                "error_message": error_message,
                "updated_at": last_run_at,
            }
        )
        return self._repository.save(updated_job)

    def _build_run_result(
        self,
        updated_job: DataIngestionJob,
        started_at: datetime,
        pipeline_response: DataPipelineResponse,
        skipped_duplicate_keys: list[str],
    ) -> DataIngestionRunResult:
        run_history = self._record_run_history(
            job=updated_job,
            started_at=started_at,
            completed_at=updated_job.last_run_at or started_at,
            run_status=updated_job.run_status,
            error_message=updated_job.error_message,
            imported_record_count=len(pipeline_response.raw_content_records),
            skipped_duplicate_keys=skipped_duplicate_keys,
            raw_content_record_ids=[record.id for record in pipeline_response.raw_content_records],
            analysis_result_ids=[result.id for result in pipeline_response.analysis_results],
            mapped_tag_ids=self._collect_mapped_tag_ids(pipeline_response),
            content_spec_tag_ids=[tag.ontology_node_id for tag in pipeline_response.content_spec.tags],
            average_preference_score=self._average_score(
                [result.preference_score for result in pipeline_response.analysis_results]
            ),
            average_commercial_score=self._average_score(
                [result.commercial_score for result in pipeline_response.analysis_results]
            ),
            average_platform_fit_score=self._average_score(
                [result.platform_fit_score for result in pipeline_response.analysis_results]
            ),
            content_spec_draft_id=(
                pipeline_response.content_spec_draft.id
                if pipeline_response.content_spec_draft is not None
                else None
            ),
            content_spec_id=(
                pipeline_response.content_spec.id
                if pipeline_response.content_spec is not None
                else None
            ),
            notes=[
                "Scheduled ingestion ran through the standard DataSourceAdapter and Data Intelligence pipeline.",
            ],
        )
        return DataIngestionRunResult(
            job=updated_job,
            run_history=run_history,
            raw_content_records=pipeline_response.raw_content_records,
            analysis_results=pipeline_response.analysis_results,
            content_spec_draft=pipeline_response.content_spec_draft,
            content_spec=pipeline_response.content_spec,
            imported_record_count=len(pipeline_response.raw_content_records),
            skipped_duplicate_count=len(skipped_duplicate_keys),
            skipped_duplicate_keys=skipped_duplicate_keys,
            notes=[
                "Scheduled ingestion ran through the standard DataSourceAdapter and Data Intelligence pipeline.",
            ],
        )

    def _record_run_history(
        self,
        job: DataIngestionJob,
        started_at: datetime,
        completed_at: datetime,
        run_status: IngestionRunStatus,
        error_message: str | None,
        imported_record_count: int,
        skipped_duplicate_keys: list[str],
        raw_content_record_ids: list[str],
        analysis_result_ids: list[str],
        mapped_tag_ids: list[str],
        content_spec_tag_ids: list[str],
        average_preference_score: float | None,
        average_commercial_score: float | None,
        average_platform_fit_score: float | None,
        content_spec_draft_id: str | None,
        content_spec_id: str | None,
        notes: list[str],
    ) -> DataIngestionRunHistory:
        run_history = DataIngestionRunHistory(
            job_id=job.id,
            adapter_type=job.adapter_type,
            schedule_type=job.schedule_type,
            platform_profile_id=job.platform_profile_id,
            started_at=started_at,
            completed_at=completed_at,
            run_status=run_status,
            error_message=error_message,
            imported_record_count=imported_record_count,
            skipped_duplicate_count=len(skipped_duplicate_keys),
            skipped_duplicate_keys=skipped_duplicate_keys,
            raw_content_record_ids=raw_content_record_ids,
            analysis_result_ids=analysis_result_ids,
            mapped_tag_ids=mapped_tag_ids,
            content_spec_tag_ids=content_spec_tag_ids,
            average_preference_score=average_preference_score,
            average_commercial_score=average_commercial_score,
            average_platform_fit_score=average_platform_fit_score,
            content_spec_draft_id=content_spec_draft_id,
            content_spec_id=content_spec_id,
            notes=notes,
        )
        return self._history_repository.save(run_history)

    def _collect_mapped_tag_ids(
        self,
        pipeline_response: DataPipelineResponse,
    ) -> list[str]:
        return list(dict.fromkeys(
            tag.ontology_node_id
            for result in pipeline_response.analysis_results
            for tag in result.mapped_tags
        ))

    def _average_score(self, values: list[float]) -> float | None:
        if not values:
            return None
        return round(sum(values) / len(values), 3)
