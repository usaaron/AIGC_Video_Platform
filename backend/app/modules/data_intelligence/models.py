from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from app.modules.content_spec.models import (
    ContentSpec,
    CreativeBrief,
    TagRef,
)


class EngagementMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    view_count: int = Field(default=0, ge=0)
    like_count: int = Field(default=0, ge=0)
    comment_count: int = Field(default=0, ge=0)
    share_count: int = Field(default=0, ge=0)
    save_count: int = Field(default=0, ge=0)
    completion_rate: float = Field(default=0.0, ge=0.0, le=1.0)


class RawContentRecordInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_name: str = Field(min_length=2, max_length=80)
    source_item_id: str = Field(min_length=2, max_length=120)
    platform: str = Field(min_length=2, max_length=40)
    source_url: str | None = Field(default=None, max_length=500)
    title: str = Field(min_length=3, max_length=240)
    body_text: str = Field(min_length=3, max_length=2000)
    author_handle: str = Field(default="", max_length=120)
    language: str = Field(min_length=2, max_length=20)
    region: str = Field(min_length=2, max_length=40)
    published_at: datetime | None = None
    engagement: EngagementMetrics = Field(default_factory=EngagementMetrics)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RawContentRecord(RawContentRecordInput):
    id: str = Field(default_factory=lambda: str(uuid4()))
    imported_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ExtractedFeatureSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    normalized_text: str = Field(min_length=3)
    token_count: int = Field(ge=1)
    keyword_hits: list[str] = Field(default_factory=list, max_length=20)
    detected_signals: list[str] = Field(default_factory=list, max_length=20)
    evidence_snippets: list[str] = Field(default_factory=list, max_length=20)


class KeywordEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keyword: str = Field(min_length=2, max_length=80)
    source_type: str = Field(min_length=2, max_length=40)
    excerpt: str = Field(min_length=3, max_length=240)
    matched_rule: str = Field(min_length=3, max_length=200)


class ScoreFactor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric_name: str = Field(min_length=3, max_length=80)
    raw_value: float
    normalized_value: float = Field(ge=0.0, le=1.0)
    weight: float = Field(ge=0.0, le=1.0)
    contribution: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(min_length=3, max_length=240)


class ScoreBreakdown(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score_name: str = Field(min_length=3, max_length=80)
    final_score: float = Field(ge=0.0, le=1.0)
    factors: list[ScoreFactor] = Field(default_factory=list, max_length=10)


class MappedTag(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ontology_node_id: str = Field(min_length=3, max_length=120)
    label: str = Field(min_length=2, max_length=80)
    category: str = Field(min_length=2, max_length=80)
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str = Field(min_length=3, max_length=200)


class AnalysisResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()))
    raw_content_record_id: str = Field(min_length=3, max_length=80)
    extracted_features: ExtractedFeatureSet
    mapped_tags: list[MappedTag] = Field(default_factory=list, max_length=20)
    topic_labels: list[str] = Field(default_factory=list, max_length=10)
    keyword_evidence: list[KeywordEvidence] = Field(default_factory=list, max_length=20)
    preference_score: float = Field(ge=0.0, le=1.0)
    preference_score_breakdown: ScoreBreakdown
    commercial_score: float = Field(ge=0.0, le=1.0)
    commercial_score_breakdown: ScoreBreakdown
    platform_fit_score: float = Field(ge=0.0, le=1.0)
    platform_fit_score_breakdown: ScoreBreakdown
    audience_signal_summary: str = Field(min_length=10, max_length=240)
    commercial_signal_summary: str = Field(min_length=10, max_length=240)
    recommended_hook_type: str = Field(min_length=3, max_length=120)
    recommended_cliffhanger_type: str = Field(min_length=3, max_length=120)
    explanation_notes: list[str] = Field(default_factory=list, max_length=10)
    summary: str = Field(min_length=10, max_length=300)


class ContentSpecDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()))
    platform_profile_id: str = Field(min_length=3, max_length=80)
    title: str = Field(min_length=3, max_length=120)
    audience_goal_summary: str = Field(min_length=3, max_length=200)
    commercial_goal_summary: str = Field(min_length=3, max_length=200)
    platform_goal_objective: str = Field(min_length=3, max_length=120)
    target_duration_seconds: int = Field(ge=5, le=600)
    story_goal: str = Field(min_length=5, max_length=240)
    tags: list[TagRef] = Field(min_length=1, max_length=20)
    creative_brief: CreativeBrief
    quality_level: str = Field(min_length=3, max_length=20)
    budget_level: str = Field(min_length=3, max_length=20)
    rationale: list[str] = Field(default_factory=list, max_length=10)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ManualJSONPipelineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform_profile_id: str = Field(min_length=3, max_length=80)
    audience_hint: str = Field(min_length=3, max_length=200)
    commercial_objective: str = Field(min_length=3, max_length=200)
    records: list[RawContentRecordInput] = Field(min_length=1, max_length=50)


class ManualCSVPipelineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform_profile_id: str = Field(min_length=3, max_length=80)
    audience_hint: str = Field(min_length=3, max_length=200)
    commercial_objective: str = Field(min_length=3, max_length=200)
    csv_content: str = Field(min_length=10)


class DataPipelineResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_content_records: list[RawContentRecord]
    analysis_results: list[AnalysisResult]
    content_spec_draft: ContentSpecDraft
    content_spec: ContentSpec
