from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.content_spec.models import ContentSpec
from app.modules.data_intelligence.models import (
    AnalysisResult,
    ContentSpecDraft,
    RawContentRecord,
    RawContentRecordInput,
)


class DataSourceAdapterType(str, Enum):
    manual_json = "manual_json"
    manual_csv = "manual_csv"
    tiktok_scraper = "tiktok_scraper"
    apify = "apify"
    reddit = "reddit"
    youtube = "youtube"
    webtoon = "webtoon"


class IngestionScheduleType(str, Enum):
    daily = "daily"
    weekly = "weekly"
    custom_cron = "custom_cron"


class IngestionRunStatus(str, Enum):
    idle = "idle"
    succeeded = "succeeded"
    failed = "failed"
    skipped = "skipped"


class DataIngestionJobBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
    )
    title: str = Field(min_length=3, max_length=120)
    adapter_type: DataSourceAdapterType
    schedule_type: IngestionScheduleType
    cron_expression: str | None = Field(default=None, max_length=120)
    platform_profile_id: str = Field(min_length=3, max_length=80)
    audience_hint: str = Field(min_length=3, max_length=200)
    commercial_objective: str = Field(min_length=3, max_length=200)
    manual_json_records: list[RawContentRecordInput] = Field(default_factory=list, max_length=50)
    manual_csv_content: str | None = Field(default=None, min_length=10)
    source_config: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True

    @model_validator(mode="after")
    def validate_schedule_and_adapter_requirements(self) -> "DataIngestionJobBase":
        if self.schedule_type == IngestionScheduleType.custom_cron and not self.cron_expression:
            raise ValueError("Custom cron schedule requires cron_expression.")

        if self.adapter_type == DataSourceAdapterType.manual_json and not self.manual_json_records:
            raise ValueError("manual_json adapter requires manual_json_records.")

        if self.adapter_type == DataSourceAdapterType.manual_csv and not self.manual_csv_content:
            raise ValueError("manual_csv adapter requires manual_csv_content.")

        return self


class DataIngestionJobCreate(DataIngestionJobBase):
    pass


class DataIngestionJob(DataIngestionJobBase):
    last_run_at: datetime | None = None
    next_run_at: datetime
    run_status: IngestionRunStatus = IngestionRunStatus.idle
    error_message: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DataIngestionJobResponse(BaseModel):
    data: DataIngestionJob


class DataIngestionJobListResponse(BaseModel):
    data: list[DataIngestionJob]


class DataIngestionRunResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job: DataIngestionJob
    run_history: DataIngestionRunHistory
    raw_content_records: list[RawContentRecord] = Field(default_factory=list, max_length=50)
    analysis_results: list[AnalysisResult] = Field(default_factory=list, max_length=50)
    content_spec_draft: ContentSpecDraft | None = None
    content_spec: ContentSpec | None = None
    imported_record_count: int = Field(ge=0)
    skipped_duplicate_count: int = Field(ge=0)
    skipped_duplicate_keys: list[str] = Field(default_factory=list, max_length=100)
    notes: list[str] = Field(default_factory=list, max_length=20)


class DataIngestionRunResultResponse(BaseModel):
    data: DataIngestionRunResult


class DataIngestionRunHistory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()))
    job_id: str = Field(min_length=3, max_length=120)
    adapter_type: DataSourceAdapterType
    schedule_type: IngestionScheduleType
    platform_profile_id: str = Field(min_length=3, max_length=80)
    started_at: datetime
    completed_at: datetime
    run_status: IngestionRunStatus
    error_message: str | None = None
    imported_record_count: int = Field(ge=0)
    skipped_duplicate_count: int = Field(ge=0)
    skipped_duplicate_keys: list[str] = Field(default_factory=list, max_length=100)
    raw_content_record_ids: list[str] = Field(default_factory=list, max_length=50)
    analysis_result_ids: list[str] = Field(default_factory=list, max_length=50)
    mapped_tag_ids: list[str] = Field(default_factory=list, max_length=100)
    content_spec_tag_ids: list[str] = Field(default_factory=list, max_length=20)
    average_preference_score: float | None = Field(default=None, ge=0.0, le=1.0)
    average_commercial_score: float | None = Field(default=None, ge=0.0, le=1.0)
    average_platform_fit_score: float | None = Field(default=None, ge=0.0, le=1.0)
    content_spec_draft_id: str | None = Field(default=None, min_length=3, max_length=80)
    content_spec_id: str | None = Field(default=None, min_length=3, max_length=80)
    notes: list[str] = Field(default_factory=list, max_length=20)


class DataIngestionRunHistoryResponse(BaseModel):
    data: DataIngestionRunHistory


class DataIngestionRunHistoryListResponse(BaseModel):
    data: list[DataIngestionRunHistory]


class ErrorResponse(BaseModel):
    detail: str
