from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ContentSpecStatus(str, Enum):
    draft = "draft"
    approved = "approved"
    archived = "archived"


class QualityLevel(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    premium = "premium"


class BudgetLevel(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class GoalPriority(str, Enum):
    primary = "primary"
    secondary = "secondary"


class TargetGoal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=3, max_length=200)
    priority: GoalPriority = GoalPriority.primary
    success_metric: str = Field(min_length=3, max_length=120)


class PlatformGoal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform_profile_id: str = Field(
        min_length=3,
        max_length=80,
        description="Reference to a platform profile such as tiktok_v1.",
    )
    objective: str = Field(min_length=3, max_length=120)
    target_duration_seconds: int = Field(ge=5, le=600)
    target_aspect_ratio: str = Field(
        default="9:16",
        pattern=r"^\d+:\d+$",
    )


class TagRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ontology_node_id: str = Field(min_length=3, max_length=120)
    label: str = Field(min_length=2, max_length=80)
    category: str = Field(min_length=2, max_length=80)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class CreativeBrief(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hook: str = Field(min_length=5, max_length=240)
    tone: str = Field(min_length=2, max_length=80)
    pacing: str = Field(min_length=2, max_length=80)
    target_emotion: str = Field(min_length=2, max_length=80)
    asset_constraints: list[str] = Field(default_factory=list, max_length=10)
    generation_notes: list[str] = Field(default_factory=list, max_length=10)


class ContentSpecBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=3, max_length=120)
    audience_goal: TargetGoal
    commercial_goal: TargetGoal
    platform_goal: PlatformGoal
    story_goal: str = Field(min_length=5, max_length=240)
    quality_level: QualityLevel
    budget_level: BudgetLevel
    tags: list[TagRef] = Field(default_factory=list, min_length=1, max_length=20)
    creative_brief: CreativeBrief
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("tags")
    @classmethod
    def ensure_unique_tags(cls, tags: list[TagRef]) -> list[TagRef]:
        seen = set()
        for tag in tags:
            key = (tag.category.lower(), tag.ontology_node_id.lower())
            if key in seen:
                raise ValueError(
                    f"Duplicate tag reference detected for '{tag.ontology_node_id}'."
                )
            seen.add(key)
        return tags

    @model_validator(mode="after")
    def ensure_budget_quality_alignment(self) -> "ContentSpecBase":
        if self.quality_level == QualityLevel.premium and self.budget_level == BudgetLevel.low:
            raise ValueError("Premium quality cannot be paired with a low budget level.")
        return self


class ContentSpecCreate(ContentSpecBase):
    pass


class ContentSpec(ContentSpecBase):
    id: str = Field(default_factory=lambda: str(uuid4()))
    status: ContentSpecStatus = ContentSpecStatus.draft
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )


class ContentSpecResponse(BaseModel):
    data: ContentSpec


class ContentSpecListResponse(BaseModel):
    data: list[ContentSpec]


class ErrorResponse(BaseModel):
    detail: str
