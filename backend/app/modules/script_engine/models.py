from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.modules.master_script.models import DraftMasterScript
from app.modules.orchestrator.models import OrchestrationPlan
from app.modules.retrieval.models import RetrievalPlanResult


class PromptType(str, Enum):
    story_planning = "story_planning"
    character_development = "character_development"
    dialogue_generation = "dialogue_generation"
    hook_generation = "hook_generation"
    cliffhanger_generation = "cliffhanger_generation"
    tiktok_optimization = "tiktok_optimization"
    story_qc = "story_qc"
    commercial_evaluation = "commercial_evaluation"
    localization = "localization"
    negative_prompt = "negative_prompt"


class GenerationStrategyStatus(str, Enum):
    draft = "draft"
    active = "active"
    deprecated = "deprecated"


class StoryQCStatus(str, Enum):
    placeholder = "placeholder"
    pass_with_notes = "pass_with_notes"
    failed = "failed"


class RevisionPriority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class RevisionTargetType(str, Enum):
    hook = "hook"
    scene_structure = "scene_structure"
    character = "character"
    emotion = "emotion"
    conflict = "conflict"
    dialogue = "dialogue"
    pacing = "pacing"
    commercial = "commercial"
    cliffhanger = "cliffhanger"
    localization = "localization"


class PromptLibraryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
        description="Stable prompt id such as prompt.story_planning.v1.",
    )
    name: str = Field(min_length=3, max_length=120)
    prompt_type: PromptType
    target_module: str = Field(min_length=3, max_length=80)
    applicable_tags: list[str] = Field(default_factory=list, max_length=20)
    target_platform: str | None = Field(default=None, min_length=2, max_length=80)
    target_audience: str | None = Field(default=None, min_length=2, max_length=200)
    version: str = Field(min_length=1, max_length=40)
    prompt_template: str = Field(min_length=10, max_length=5000)
    input_variables: list[str] = Field(default_factory=list, max_length=30)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    evaluation_notes: list[str] = Field(default_factory=list, max_length=20)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("applicable_tags", "input_variables", "evaluation_notes")
    @classmethod
    def ensure_unique_list_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


class PromptLibraryItemCreate(PromptLibraryItem):
    pass


class PromptLibraryItemResponse(BaseModel):
    data: PromptLibraryItem


class PromptLibraryItemListResponse(BaseModel):
    data: list[PromptLibraryItem]


class ErrorResponse(BaseModel):
    detail: str


class GenerationWorkflowStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step_order: int = Field(ge=1, le=20)
    name: str = Field(min_length=3, max_length=80)
    description: str = Field(min_length=5, max_length=240)
    prompt_id: str | None = Field(default=None, min_length=3, max_length=120)
    multi_turn_enabled: bool = False
    structured_output_required: bool = True


class GenerationStrategy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
        description="Stable generation strategy id such as strategy.tiktok.master_script.v1.",
    )
    name: str = Field(min_length=3, max_length=120)
    target_platform: str = Field(min_length=2, max_length=80)
    target_content_type: str = Field(min_length=2, max_length=80)
    applicable_tags: list[str] = Field(default_factory=list, max_length=20)
    model_provider: str = Field(min_length=2, max_length=80)
    model_name: str = Field(min_length=2, max_length=120)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    top_p: float = Field(default=0.9, ge=0.0, le=1.0)
    max_tokens: int = Field(default=3000, ge=128, le=32000)
    workflow_steps: list[GenerationWorkflowStep] = Field(min_length=1, max_length=20)
    prompt_ids: list[str] = Field(min_length=1, max_length=20)
    qc_enabled: bool = True
    self_check_enabled: bool = False
    human_review_required: bool = False
    output_schema: dict[str, Any] = Field(default_factory=dict)
    version: str = Field(min_length=1, max_length=40)
    status: GenerationStrategyStatus = GenerationStrategyStatus.draft

    @field_validator("applicable_tags", "prompt_ids")
    @classmethod
    def ensure_unique_string_lists(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values

    @field_validator("workflow_steps")
    @classmethod
    def ensure_unique_step_order(cls, steps: list[GenerationWorkflowStep]) -> list[GenerationWorkflowStep]:
        orders = [step.step_order for step in steps]
        if len(set(orders)) != len(orders):
            raise ValueError("Workflow step_order values must be unique.")
        return steps

    @model_validator(mode="after")
    def ensure_prompt_references_exist(self) -> "GenerationStrategy":
        declared_ids = set(self.prompt_ids)
        referenced_ids = {
            step.prompt_id
            for step in self.workflow_steps
            if step.prompt_id is not None
        }
        if not referenced_ids.issubset(declared_ids):
            raise ValueError("Workflow step prompt_id values must exist in prompt_ids.")
        return self


class GenerationStrategyCreate(GenerationStrategy):
    pass


class GenerationStrategyResponse(BaseModel):
    data: GenerationStrategy


class GenerationStrategyListResponse(BaseModel):
    data: list[GenerationStrategy]


class PromptBuildContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_spec_id: str = Field(min_length=3, max_length=120)
    content_spec_title: str = Field(min_length=3, max_length=120)
    creative_brief_summary: str = Field(min_length=5, max_length=500)
    platform_profile_id: str = Field(min_length=3, max_length=120)
    audience_profile_summary: str = Field(min_length=3, max_length=300)
    commercial_goal_summary: str = Field(min_length=3, max_length=300)
    retrieved_asset_ids: list[str] = Field(default_factory=list, max_length=30)
    generation_strategy_id: str = Field(min_length=3, max_length=120)
    extra_variables: dict[str, str] = Field(default_factory=dict)

    @field_validator("retrieved_asset_ids")
    @classmethod
    def ensure_unique_asset_ids(cls, asset_ids: list[str]) -> list[str]:
        normalized = [asset_id.strip().lower() for asset_id in asset_ids]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Retrieved asset IDs must be unique.")
        return asset_ids


class PromptRetrievalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_strategy_id: str = Field(min_length=3, max_length=120)


class PromptRetrievalResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_strategy_id: str = Field(min_length=3, max_length=120)
    strategy_name: str = Field(min_length=3, max_length=120)
    prompt_ids: list[str] = Field(min_length=1, max_length=20)
    prompts: list[PromptLibraryItem] = Field(min_length=1, max_length=20)
    retrieval_mode: str = Field(default="exact_ids", min_length=3, max_length=40)
    notes: list[str] = Field(default_factory=list, max_length=10)
    resolved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("prompt_ids", "notes")
    @classmethod
    def ensure_unique_prompt_retrieval_lists(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


class PromptRetrievalResponse(BaseModel):
    data: PromptRetrievalResult


class PromptBuildTrace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_strategy_id: str = Field(min_length=3, max_length=120)
    prompt_ids: list[str] = Field(min_length=1, max_length=20)
    builder_version: str = Field(min_length=1, max_length=40)


class PromptBuildResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt_text: str = Field(min_length=10, max_length=30000)
    rendered_variables: dict[str, str] = Field(default_factory=dict)
    trace: PromptBuildTrace
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class LLMModelInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(min_length=2, max_length=80)
    model_name: str = Field(min_length=2, max_length=120)
    supports_structured_output: bool
    max_context_tokens: int = Field(ge=128, le=2_000_000)


class StoryQCCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    check_name: str = Field(min_length=3, max_length=120)
    passed: bool
    score: float = Field(ge=0.0, le=1.0)
    note: str = Field(min_length=3, max_length=240)


class StoryQCRubricCategory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_name: str = Field(min_length=3, max_length=120)
    score: float = Field(ge=0.0, le=5.0)
    max_score: int = Field(default=5, ge=1, le=10)
    deduction_reasons: list[str] = Field(default_factory=list, max_length=10)
    revision_suggestions: list[str] = Field(default_factory=list, max_length=10)


class StoryQCReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overall_score: float = Field(ge=0.0, le=1.0)
    status: StoryQCStatus
    checks: list[StoryQCCheck] = Field(default_factory=list, max_length=20)
    recommended_actions: list[str] = Field(default_factory=list, max_length=20)
    rubric_overall_score: float | None = Field(default=None, ge=0.0, le=1.0)
    rubric_categories: list[StoryQCRubricCategory] = Field(
        default_factory=list,
        max_length=20,
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RevisionAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action_id: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
    )
    target_type: RevisionTargetType
    priority: RevisionPriority
    title: str = Field(min_length=3, max_length=160)
    rationale: str = Field(min_length=5, max_length=300)
    based_on_checks: list[str] = Field(default_factory=list, max_length=10)
    related_scene_numbers: list[int] = Field(default_factory=list, max_length=20)
    instructions: list[str] = Field(min_length=1, max_length=10)
    expected_impact: str = Field(min_length=5, max_length=240)

    @field_validator("based_on_checks", "instructions")
    @classmethod
    def ensure_unique_revision_strings(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values

    @field_validator("related_scene_numbers")
    @classmethod
    def ensure_unique_scene_numbers(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("Scene numbers must be unique.")
        return values


class RevisionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_master_script_id: str = Field(min_length=3, max_length=120)
    content_spec_id: str = Field(min_length=3, max_length=120)
    generation_strategy_id: str = Field(min_length=3, max_length=120)
    story_qc_status: StoryQCStatus
    overall_priority: RevisionPriority
    focus_summary: str = Field(min_length=5, max_length=240)
    actions: list[RevisionAction] = Field(default_factory=list, max_length=10)
    must_re_qc: bool = True
    notes: list[str] = Field(default_factory=list, max_length=10)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ScriptRevisionPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_master_script: DraftMasterScript
    story_qc_report: StoryQCReport


class ScriptRevisionPlanResponse(BaseModel):
    data: RevisionPlan


class ScriptRevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_master_script: DraftMasterScript
    revision_plan: RevisionPlan


class ScriptRevisionRun(BaseModel):
    model_config = ConfigDict(extra="forbid")

    original_draft_master_script: DraftMasterScript
    revision_plan: RevisionPlan
    revised_draft_master_script: DraftMasterScript
    original_story_qc_report: StoryQCReport
    revised_story_qc_report: StoryQCReport
    applied_action_ids: list[str] = Field(default_factory=list, max_length=10)
    improvement_summary: list[str] = Field(default_factory=list, max_length=10)
    improved: bool
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("applied_action_ids", "improvement_summary")
    @classmethod
    def ensure_unique_revision_run_strings(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


class ScriptRevisionResponse(BaseModel):
    data: ScriptRevisionRun


class ScriptGenerationDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_spec_id: str = Field(min_length=3, max_length=120)
    generation_strategy_id: str = Field(min_length=3, max_length=120)
    output_language: str = Field(min_length=2, max_length=20)
    desired_scene_count: int = Field(default=3, ge=2, le=8)


class ScriptGenerationDraftRun(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_spec_id: str = Field(min_length=3, max_length=120)
    generation_strategy_id: str = Field(min_length=3, max_length=120)
    generation_strategy_version: str = Field(min_length=1, max_length=40)
    orchestration_plan: OrchestrationPlan
    retrieval_result: RetrievalPlanResult
    prompt_retrieval_result: PromptRetrievalResult
    selected_prompt_ids: list[str] = Field(min_length=1, max_length=20)
    prompt_build_result: PromptBuildResult
    llm_model_info: LLMModelInfo
    llm_raw_output: dict[str, Any] = Field(default_factory=dict)
    draft_master_script: DraftMasterScript
    story_qc_report: StoryQCReport
    revision_plan: RevisionPlan
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ScriptGenerationDraftResponse(BaseModel):
    data: ScriptGenerationDraftRun
