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


class CreativeInputReadinessResponse(BaseModel):
    data: CreativeInputReadiness
