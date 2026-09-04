from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.script_engine.long_story_models import CreativeReferenceMaterial


class InputReadinessLevel(str, Enum):
    premise = "premise"
    story_bible = "story_bible"
    episode_plan = "episode_plan"
    script = "script"


class RecommendedWorkflowStage(str, Enum):
    story_bible = "story_bible"
    planning = "planning"
    script = "script"


class InputReadinessAnalysisMethod(str, Enum):
    heuristic = "heuristic"
    model_assisted = "model_assisted"


class InputReadinessCapacityStatus(str, Enum):
    sufficient = "sufficient"
    supplement_recommended = "supplement_recommended"
    target_reduce_recommended = "target_reduce_recommended"


class InputReadinessSourceKind(str, Enum):
    premise = "premise"
    story_bible = "story_bible"
    episode_plan = "episode_plan"
    script = "script"
    mixed = "mixed"


class InputReadinessCoverage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    premise: float = Field(ge=0.0, le=1.0)
    story_bible: float = Field(ge=0.0, le=1.0)
    episode_plan: float = Field(ge=0.0, le=1.0)
    script: float = Field(ge=0.0, le=1.0)


class CreativeInputReadinessRequest(BaseModel):
    """Creative input inspected before a Story Project is created.

    Analysis is advisory and cannot mutate workflow state. The existing
    reference material contract is reused so clients do not need a second
    upload representation.
    """

    model_config = ConfigDict(extra="forbid")

    creative_prompt: str = Field(default="", max_length=10_000)
    reference_materials: list[CreativeReferenceMaterial] = Field(
        default_factory=list,
        max_length=8,
    )
    episode_count: int = Field(ge=1, le=2_000)
    target_total_characters: int = Field(default=140_000, ge=1_000, le=10_000_000)

    @model_validator(mode="after")
    def validate_creative_source(self) -> "CreativeInputReadinessRequest":
        if not self.creative_prompt.strip() and not self.reference_materials:
            raise ValueError(
                "Input readiness analysis requires creative_prompt or reference_materials."
            )
        combined_reference_characters = sum(
            len(material.extracted_text) for material in self.reference_materials
        )
        if combined_reference_characters > 120_000:
            raise ValueError(
                "Combined reference material text must not exceed 120000 characters."
            )
        return self


class CreativeInputReadiness(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str = Field(default="input_readiness.v1", pattern=r"^input_readiness\.v\d+$")
    detected_level: InputReadinessLevel
    confidence: float = Field(ge=0.0, le=1.0)
    coverage: InputReadinessCoverage
    evidence: list[str] = Field(default_factory=list, max_length=50)
    missing_items: list[str] = Field(default_factory=list, max_length=100)
    recommended_stage: RecommendedWorkflowStage
    requires_user_confirmation: bool = True
    analysis_method: InputReadinessAnalysisMethod
    source_character_count: int = Field(default=0, ge=0)
    detected_episode_count: int | None = Field(default=None, ge=1, le=2_000)
    source_kinds: list[InputReadinessSourceKind] = Field(default_factory=list, max_length=5)
    estimated_supported_characters: int = Field(default=0, ge=0)
    capacity_status: InputReadinessCapacityStatus = InputReadinessCapacityStatus.sufficient
    recommended_target_total_characters: int | None = Field(default=None, ge=1_000)
    supplement_questions: list[str] = Field(default_factory=list, max_length=12)


class CreativeInputReadinessResponse(BaseModel):
    data: CreativeInputReadiness
