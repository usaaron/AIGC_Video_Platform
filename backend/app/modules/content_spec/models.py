from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.character_identity import CharacterName


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


class CreativeFieldProvenance(str, Enum):
    user_provided = "user_provided"
    ai_inferred = "ai_inferred"


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


class CharacterContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_ref: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-zA-Z0-9_.-]+$",
    )
    name: CharacterName
    role: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, min_length=5, max_length=500)
    motivation: str | None = Field(default=None, min_length=5, max_length=500)
    desire: str | None = Field(default=None, min_length=2, max_length=300)
    fear: str | None = Field(default=None, min_length=2, max_length=300)
    belief: str | None = Field(default=None, min_length=2, max_length=300)
    contradiction: str | None = Field(default=None, min_length=2, max_length=300)
    decision_pattern: str | None = Field(default=None, min_length=2, max_length=300)
    moral_boundaries: list[str] = Field(default_factory=list, max_length=10)
    locked_fields: list[str] = Field(default_factory=list, max_length=12)
    field_sources: dict[str, CreativeFieldProvenance] = Field(default_factory=dict)

    @field_validator("moral_boundaries", "locked_fields")
    @classmethod
    def ensure_unique_character_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Character context list values must be unique.")
        return values

    @model_validator(mode="after")
    def validate_controls_and_complete_provenance(self) -> "CharacterContext":
        source_fields = {
            "name",
            "role",
            "description",
            "motivation",
            "desire",
            "fear",
            "belief",
            "contradiction",
            "decision_pattern",
            "moral_boundaries",
        }
        unknown_locked = set(self.locked_fields) - source_fields
        if unknown_locked:
            raise ValueError(
                "Character locked_fields contains unsupported values: "
                f"{sorted(unknown_locked)}."
            )
        unknown_sources = set(self.field_sources) - source_fields
        if unknown_sources:
            raise ValueError(
                "Character field_sources contains unsupported values: "
                f"{sorted(unknown_sources)}."
            )

        for field_name in source_fields:
            value = getattr(self, field_name)
            is_present = value is not None and value != []
            if is_present:
                self.field_sources.setdefault(
                    field_name,
                    CreativeFieldProvenance.user_provided,
                )
            elif field_name in self.field_sources:
                raise ValueError(
                    f"Character field_sources references empty field '{field_name}'."
                )
        return self


class ResolvedCreativeContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    content_spec_id: str = Field(min_length=3, max_length=120)
    characters: list[CharacterContext] = Field(default_factory=list, max_length=20)
    excluded_tag_ids: list[str] = Field(default_factory=list, max_length=20)
    excluded_patterns: list[str] = Field(default_factory=list, max_length=20)
    resolution_warnings: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("excluded_tag_ids", "excluded_patterns", "resolution_warnings")
    @classmethod
    def ensure_unique_context_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Resolved creative context list values must be unique.")
        return values

    @field_validator("characters")
    @classmethod
    def ensure_unique_character_refs(
        cls,
        characters: list[CharacterContext],
    ) -> list[CharacterContext]:
        refs = [character.character_ref.casefold() for character in characters]
        if len(set(refs)) != len(refs):
            raise ValueError("Character references must be unique.")
        return characters


class CreativeIntentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    title: str = Field(min_length=3, max_length=120)
    audience_goal: TargetGoal
    commercial_goal: TargetGoal
    platform_goal: PlatformGoal
    free_creative_prompt: str = Field(default="", max_length=240)
    quality_level: QualityLevel
    budget_level: BudgetLevel
    selected_tag_ids: list[str] = Field(default_factory=list, max_length=12)
    added_tag_ids: list[str] = Field(default_factory=list, max_length=12)
    excluded_tag_ids: list[str] = Field(default_factory=list, max_length=20)
    excluded_patterns: list[str] = Field(default_factory=list, max_length=20)
    creative_brief: CreativeBrief
    character_contexts: list[CharacterContext] = Field(default_factory=list, max_length=20)
    request_metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator(
        "selected_tag_ids",
        "added_tag_ids",
        "excluded_tag_ids",
        "excluded_patterns",
    )
    @classmethod
    def ensure_unique_intent_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Creative intent list values must be unique.")
        return values

    @model_validator(mode="after")
    def validate_active_tag_boundary(self) -> "CreativeIntentInput":
        active_tag_ids = self.selected_tag_ids + self.added_tag_ids
        normalized = [tag_id.casefold() for tag_id in active_tag_ids]
        if not self.free_creative_prompt.strip() and not active_tag_ids:
            raise ValueError(
                "Creative intent requires a free prompt or at least one active tag."
            )
        if len(normalized) > 12:
            raise ValueError("Creative intent supports at most 12 active tags.")
        if len(set(normalized)) != len(normalized):
            raise ValueError("Selected and added tag IDs must not overlap.")
        return self


class CreativeIntentMappingTrace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_field: str = Field(min_length=2, max_length=120)
    target_field: str = Field(min_length=2, max_length=120)
    reason: str = Field(min_length=5, max_length=300)


class ContentSpecBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=3, max_length=120)
    audience_goal: TargetGoal
    commercial_goal: TargetGoal
    platform_goal: PlatformGoal
    story_goal: str = Field(min_length=5, max_length=240)
    quality_level: QualityLevel
    budget_level: BudgetLevel
    tags: list[TagRef] = Field(default_factory=list, max_length=20)
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


class CreativeIntentResolutionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    content_spec: ContentSpec
    resolved_creative_context: ResolvedCreativeContext
    resolved_tag_refs: list[TagRef] = Field(default_factory=list, max_length=12)
    conflict_warnings: list[str] = Field(default_factory=list, max_length=20)
    requires_user_resolution: bool = False
    mapping_trace: list[CreativeIntentMappingTrace] = Field(default_factory=list, max_length=50)
    request_metadata: dict[str, Any] = Field(default_factory=dict)


class ContentSpecResponse(BaseModel):
    data: ContentSpec


class CreativeIntentResolutionResponse(BaseModel):
    data: CreativeIntentResolutionResult


class ContentSpecListResponse(BaseModel):
    data: list[ContentSpec]


class ErrorResponse(BaseModel):
    detail: str
