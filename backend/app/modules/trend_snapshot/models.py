from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class TrendSnapshotGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: str = Field(min_length=3, max_length=120)
    lookback_runs: int = Field(default=5, ge=1, le=50)
    metadata: dict[str, Any] = Field(default_factory=dict)


class TrendTagSignal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ontology_node_id: str = Field(min_length=3, max_length=120)
    occurrences: int = Field(ge=1)
    share_of_runs: float = Field(ge=0.0, le=1.0)


class TrendSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()))
    job_id: str = Field(min_length=3, max_length=120)
    platform_profile_id: str = Field(min_length=3, max_length=80)
    run_history_ids: list[str] = Field(default_factory=list, min_length=1, max_length=50)
    lookback_runs: int = Field(ge=1, le=50)
    successful_run_count: int = Field(ge=0)
    skipped_run_count: int = Field(ge=0)
    failed_run_count: int = Field(ge=0)
    total_imported_records: int = Field(ge=0)
    total_duplicate_skips: int = Field(ge=0)
    average_preference_score: float | None = Field(default=None, ge=0.0, le=1.0)
    average_commercial_score: float | None = Field(default=None, ge=0.0, le=1.0)
    average_platform_fit_score: float | None = Field(default=None, ge=0.0, le=1.0)
    top_mapped_tags: list[TrendTagSignal] = Field(default_factory=list, max_length=10)
    top_content_spec_tags: list[TrendTagSignal] = Field(default_factory=list, max_length=10)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: dict[str, Any] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list, max_length=20)


class TrendSnapshotResponse(BaseModel):
    data: TrendSnapshot


class TrendSnapshotListResponse(BaseModel):
    data: list[TrendSnapshot]


class ErrorResponse(BaseModel):
    detail: str
