from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class RetrievalStatus(str, Enum):
    resolved = "resolved"
    partial = "partial"


class RetrievalResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan_id: str = Field(min_length=3, max_length=80)


class RetrievalCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str = Field(min_length=3, max_length=120)
    asset_type: str = Field(min_length=3, max_length=80)
    title: str = Field(min_length=3, max_length=120)
    summary: str = Field(min_length=5, max_length=240)
    matched_required_tag_ids: list[str] = Field(default_factory=list, max_length=10)
    matched_optional_tag_ids: list[str] = Field(default_factory=list, max_length=10)
    score: float = Field(ge=0.0, le=1.0)
    rationale: list[str] = Field(default_factory=list, max_length=10)


class RetrievalResolvedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(min_length=3, max_length=80)
    asset_type: str = Field(min_length=3, max_length=80)
    reason: str = Field(min_length=5, max_length=240)
    required_tag_ids: list[str] = Field(min_length=1, max_length=10)
    optional_tag_ids: list[str] = Field(default_factory=list, max_length=10)
    candidates: list[RetrievalCandidate] = Field(default_factory=list, max_length=20)


class RetrievalPlanResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan_id: str = Field(min_length=3, max_length=80)
    content_spec_id: str = Field(min_length=3, max_length=80)
    platform_profile_id: str = Field(min_length=3, max_length=80)
    status: RetrievalStatus
    resolved_requests: list[RetrievalResolvedRequest] = Field(default_factory=list, max_length=20)
    unresolved_request_ids: list[str] = Field(default_factory=list, max_length=20)
    notes: list[str] = Field(default_factory=list, max_length=20)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RetrievalPlanResultResponse(BaseModel):
    data: RetrievalPlanResult


class ErrorResponse(BaseModel):
    detail: str
