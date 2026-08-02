from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.modules.content_spec.models import ResolvedCreativeContext
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
    creative_deepening = "creative_deepening"


class GenerationStrategyStatus(str, Enum):
    draft = "draft"
    active = "active"
    deprecated = "deprecated"


class StoryQCStatus(str, Enum):
    placeholder = "placeholder"
    pass_with_notes = "pass_with_notes"
    failed = "failed"


class StoryQCDimension(str, Enum):
    hook_quality = "hook_quality"
    character_agency = "character_agency"
    conflict_escalation = "conflict_escalation"
    emotional_payoff = "emotional_payoff"
    cliffhanger_strength = "cliffhanger_strength"


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


class RevisionExecutionMode(str, Enum):
    controlled = "controlled"
    legacy_fallback = "legacy_fallback"


class ProtectedScopeStatus(str, Enum):
    respected = "respected"
    blocked = "blocked"
    recorded_only = "recorded_only"


class KnowledgeTargetStage(str, Enum):
    draft_generation = "draft_generation"
    creative_deepening = "creative_deepening"


class CreativeDeepeningMode(str, Enum):
    disabled = "disabled"
    shadow = "shadow"


class EpisodeGenerationMode(str, Enum):
    sequential = "sequential"
    full = "full"


class CreativeDeepeningStatus(str, Enum):
    shadow_candidate = "shadow_candidate"
    rejected_preservation = "rejected_preservation"
    technical_failure = "technical_failure"


class CreativeDeepeningChangeType(str, Enum):
    dialogue = "dialogue"
    emotional_expression = "emotional_expression"
    visual_action = "visual_action"
    scene_intensity = "scene_intensity"
    character_expression = "character_expression"
    forbidden = "forbidden"


class CreativeDeepeningComparisonStatus(str, Enum):
    available = "available"
    unavailable = "unavailable"


class KnowledgeApplicabilityConditions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    any_tag_ids: list[str] = Field(default_factory=list, max_length=20)
    any_tag_labels: list[str] = Field(default_factory=list, max_length=20)
    target_platforms: list[str] = Field(default_factory=list, max_length=10)
    platform_profile_ids: list[str] = Field(default_factory=list, max_length=10)

    @field_validator(
        "any_tag_ids",
        "any_tag_labels",
        "target_platforms",
        "platform_profile_ids",
    )
    @classmethod
    def ensure_unique_knowledge_conditions(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Knowledge applicability values must be unique.")
        return values


class StaticKnowledgeItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    knowledge_id: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
    )
    version: str = Field(min_length=1, max_length=40)
    category: str = Field(min_length=3, max_length=80)
    principle: str = Field(min_length=10, max_length=600)
    application_rules: list[str] = Field(min_length=1, max_length=8)
    limitations: list[str] = Field(default_factory=list, max_length=8)
    anti_patterns: list[str] = Field(default_factory=list, max_length=8)
    source_reference: str = Field(min_length=5, max_length=500)

    @field_validator("application_rules", "limitations", "anti_patterns")
    @classmethod
    def ensure_unique_knowledge_guidance(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Knowledge guidance values must be unique.")
        return values


class KnowledgeBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bundle_id: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
    )
    version: str = Field(min_length=1, max_length=40)
    knowledge_ids: list[str] = Field(min_length=1, max_length=8)
    applicable_conditions: KnowledgeApplicabilityConditions = Field(
        default_factory=KnowledgeApplicabilityConditions
    )
    source_reference: str = Field(min_length=5, max_length=500)
    target_stage: KnowledgeTargetStage = KnowledgeTargetStage.draft_generation

    @field_validator("knowledge_ids")
    @classmethod
    def ensure_unique_knowledge_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Knowledge IDs must be unique.")
        return values


class KnowledgeSelectionTrace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selector_version: str = Field(min_length=1, max_length=40)
    target_stage: KnowledgeTargetStage
    requested_bundle_id: str = Field(min_length=3, max_length=120)
    selected_bundle_id: str = Field(min_length=3, max_length=120)
    selected_knowledge_refs: list[str] = Field(min_length=1, max_length=8)
    selection_reason: str = Field(min_length=5, max_length=500)
    warnings: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("selected_knowledge_refs", "warnings")
    @classmethod
    def ensure_unique_selection_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Knowledge selection values must be unique.")
        return values


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
    draft_knowledge_bundle_id: str | None = Field(
        default=None,
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
    )
    deepening_mode: CreativeDeepeningMode = CreativeDeepeningMode.disabled
    deepening_prompt_ids: list[str] = Field(default_factory=list, max_length=5)
    deepening_knowledge_bundle_id: str | None = Field(
        default=None,
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
    )
    deepening_max_tokens: int | None = Field(default=None, ge=128, le=32000)
    deepening_max_expressive_growth_ratio: float = Field(
        default=0.35,
        ge=0.0,
        le=1.0,
    )
    qc_enabled: bool = True
    self_check_enabled: bool = False
    human_review_required: bool = False
    output_schema: dict[str, Any] = Field(default_factory=dict)
    version: str = Field(min_length=1, max_length=40)
    status: GenerationStrategyStatus = GenerationStrategyStatus.draft

    @field_validator("applicable_tags", "prompt_ids", "deepening_prompt_ids")
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
        if self.deepening_mode == CreativeDeepeningMode.shadow and not self.deepening_prompt_ids:
            raise ValueError("Shadow deepening requires deepening_prompt_ids.")
        if set(self.prompt_ids).intersection(self.deepening_prompt_ids):
            raise ValueError("Draft and deepening prompt IDs must remain separate.")
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
    build_purpose: KnowledgeTargetStage = KnowledgeTargetStage.draft_generation
    knowledge_refs: list[str] = Field(default_factory=list, max_length=8)
    creative_context_version: str | None = Field(default=None, min_length=1, max_length=40)


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


class StoryQCDimensionEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension: StoryQCDimension
    score: float = Field(ge=0.0, le=5.0)
    summary: str = Field(min_length=5, max_length=240)
    score_reason: str = Field(min_length=5, max_length=300)
    deduction_reasons: list[str] = Field(default_factory=list, max_length=10)
    scene_refs: list[int] = Field(default_factory=list, max_length=20)
    evidence: list[str] = Field(default_factory=list, max_length=10)
    revision_signals: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("deduction_reasons", "evidence", "revision_signals")
    @classmethod
    def ensure_unique_dimension_strings(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values

    @field_validator("scene_refs")
    @classmethod
    def ensure_unique_dimension_scene_refs(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("Scene refs must be unique.")
        return values


class StoryQCKnowledgeRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    knowledge_id: str = Field(min_length=3, max_length=120)
    dimension: StoryQCDimension
    reason: str = Field(min_length=5, max_length=300)
    evidence: str = Field(min_length=3, max_length=240)


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
    report_version: str | None = Field(default=None, min_length=1, max_length=40)
    explainability_status: str | None = Field(default=None, min_length=3, max_length=80)
    dimension_evaluations: list[StoryQCDimensionEvaluation] = Field(
        default_factory=list,
        max_length=10,
    )
    evidence_summary: list[str] = Field(default_factory=list, max_length=20)
    knowledge_refs: list[StoryQCKnowledgeRef] = Field(default_factory=list, max_length=20)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("evidence_summary")
    @classmethod
    def ensure_unique_evidence_summary(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


class CreativeDeepeningChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    change_type: CreativeDeepeningChangeType
    field_name: str = Field(min_length=2, max_length=120)
    summary: str = Field(min_length=5, max_length=300)
    scene_number: int | None = Field(default=None, ge=1, le=50)


class CreativeDeepeningPreservationCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    check_name: str = Field(min_length=3, max_length=120)
    passed: bool
    details: str = Field(min_length=5, max_length=500)


class CreativeDeepeningQCComparison(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: CreativeDeepeningComparisonStatus
    source_overall_score: float = Field(ge=0.0, le=1.0)
    candidate_overall_score: float | None = Field(default=None, ge=0.0, le=1.0)
    overall_delta: float | None = Field(default=None, ge=-1.0, le=1.0)
    dimension_deltas: dict[str, float] = Field(default_factory=dict)
    summary: str = Field(min_length=5, max_length=500)


class CreativeDeepeningRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_draft_master_script: DraftMasterScript
    resolved_creative_context: ResolvedCreativeContext | None = None
    knowledge_bundle: KnowledgeBundle | None = None
    knowledge_items: list[StaticKnowledgeItem] = Field(default_factory=list, max_length=8)
    knowledge_selection_trace: KnowledgeSelectionTrace | None = None
    max_expressive_growth_ratio: float = Field(default=0.35, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def ensure_bundle_items_align(self) -> "CreativeDeepeningRequest":
        if (
            self.knowledge_bundle is not None
            and self.knowledge_bundle.target_stage
            != KnowledgeTargetStage.creative_deepening
        ):
            raise ValueError(
                "Creative deepening requires a creative_deepening KnowledgeBundle."
            )
        if self.knowledge_bundle is None and self.knowledge_items:
            raise ValueError("Deepening knowledge items require a KnowledgeBundle.")
        if self.knowledge_bundle is None and self.knowledge_selection_trace is not None:
            raise ValueError("Knowledge selection trace requires a KnowledgeBundle.")
        if self.knowledge_bundle is not None:
            item_ids = [item.knowledge_id for item in self.knowledge_items]
            if item_ids != self.knowledge_bundle.knowledge_ids:
                raise ValueError(
                    "Deepening knowledge items must match KnowledgeBundle order."
                )
            if (
                self.knowledge_selection_trace is not None
                and self.knowledge_selection_trace.selected_bundle_id
                != self.knowledge_bundle.bundle_id
            ):
                raise ValueError(
                    "Knowledge selection trace must reference the selected bundle."
                )
        return self


class CreativeDeepeningRun(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: CreativeDeepeningStatus
    service_version: str = Field(default="creative_deepening_service.v1", min_length=3, max_length=80)
    source_draft_master_script_id: str = Field(min_length=3, max_length=120)
    selected_draft_master_script_id: str = Field(min_length=3, max_length=120)
    candidate_draft_master_script: DraftMasterScript | None = None
    knowledge_bundle: KnowledgeBundle | None = None
    knowledge_selection_trace: KnowledgeSelectionTrace | None = None
    prompt_build_result: PromptBuildResult | None = None
    llm_model_info: LLMModelInfo
    llm_raw_output: dict[str, Any] = Field(default_factory=dict)
    change_trace: list[CreativeDeepeningChange] = Field(default_factory=list, max_length=100)
    preservation_checks: list[CreativeDeepeningPreservationCheck] = Field(
        default_factory=list,
        max_length=30,
    )
    candidate_valid_for_comparison: bool = False
    expressive_growth_ratio: float | None = Field(default=None, ge=-1.0, le=5.0)
    latency_seconds: float = Field(ge=0.0)
    token_usage: dict[str, int] | None = None
    candidate_story_qc_report: StoryQCReport | None = None
    comparison_metadata: CreativeDeepeningQCComparison | None = None
    warnings: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("warnings")
    @classmethod
    def ensure_unique_deepening_warnings(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Creative Deepening warnings must be unique.")
        return values


class RevisionDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision_required: bool
    decision_reason: str = Field(min_length=5, max_length=500)
    selected_dimensions: list[StoryQCDimension] = Field(default_factory=list, max_length=5)
    deferred_dimensions: list[StoryQCDimension] = Field(default_factory=list, max_length=5)
    protected_dimensions: list[StoryQCDimension] = Field(default_factory=list, max_length=5)
    primary_scene_refs: list[int] = Field(default_factory=list, max_length=20)
    confidence: float = Field(ge=0.0, le=1.0)

    @field_validator(
        "selected_dimensions",
        "deferred_dimensions",
        "protected_dimensions",
    )
    @classmethod
    def ensure_unique_revision_dimensions(
        cls,
        values: list[StoryQCDimension],
    ) -> list[StoryQCDimension]:
        if len(set(values)) != len(values):
            raise ValueError("Revision dimensions must be unique.")
        return values

    @field_validator("primary_scene_refs")
    @classmethod
    def ensure_valid_primary_scene_refs(cls, values: list[int]) -> list[int]:
        if any(value < 1 for value in values):
            raise ValueError("Scene refs must be positive integers.")
        if len(set(values)) != len(values):
            raise ValueError("Scene refs must be unique.")
        return values


class RevisionStrategy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_dimension: StoryQCDimension
    problem_type: str = Field(min_length=3, max_length=120)
    problem_reason: str = Field(min_length=5, max_length=500)
    revision_goal: str = Field(min_length=5, max_length=500)
    revision_method: str = Field(min_length=5, max_length=500)
    expected_effect: str = Field(min_length=5, max_length=500)
    priority: int = Field(default=1, ge=1, le=100)
    confidence: float = Field(ge=0.0, le=1.0)
    scene_refs: list[int] = Field(default_factory=list, max_length=20)
    do_not_touch: list[str] = Field(default_factory=list, max_length=20)
    knowledge_refs: list[StoryQCKnowledgeRef] = Field(default_factory=list, max_length=20)

    @field_validator("scene_refs")
    @classmethod
    def ensure_valid_strategy_scene_refs(cls, values: list[int]) -> list[int]:
        if any(value < 1 for value in values):
            raise ValueError("Scene refs must be positive integers.")
        if len(set(values)) != len(values):
            raise ValueError("Scene refs must be unique.")
        return values

    @field_validator("do_not_touch")
    @classmethod
    def ensure_unique_protected_targets(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Protected targets must be unique.")
        return values


class RevisionPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy_version: str = Field(
        default="revision_acceptance_policy.v1",
        min_length=3,
        max_length=80,
    )
    max_revision_rounds: int = Field(default=1, ge=1, le=10)
    minimum_improvement_threshold: float = Field(ge=0.0, le=1.0)
    acceptance_threshold: float = Field(ge=0.0, le=1.0)
    regression_limit: int = Field(ge=0, le=20)
    dimension_regression_tolerance: float = Field(default=0.0, ge=0.0, le=1.0)


class AcceptanceDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    acceptance_reason: str = Field(min_length=5, max_length=500)
    targeted_dimension_improvement: dict[StoryQCDimension, float]
    regression_count: int = Field(ge=0, le=20)
    protected_dimension_stability: bool
    stop_reason: str | None = Field(default=None, min_length=3, max_length=240)
    decision_version: str = Field(
        default="revision_acceptance_decision.v1",
        min_length=3,
        max_length=80,
    )
    policy_version: str = Field(
        default="revision_acceptance_policy.v1",
        min_length=3,
        max_length=80,
    )
    revision_round: int = Field(default=1, ge=1, le=10)
    scene_alignment_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    revision_effectiveness: float = Field(default=0.0, ge=0.0, le=1.0)
    regressed_dimensions: list[StoryQCDimension] = Field(
        default_factory=list,
        max_length=10,
    )

    @field_validator("targeted_dimension_improvement")
    @classmethod
    def ensure_valid_dimension_improvements(
        cls,
        values: dict[StoryQCDimension, float],
    ) -> dict[StoryQCDimension, float]:
        if any(value < -1.0 or value > 1.0 for value in values.values()):
            raise ValueError("Dimension improvements must be between -1.0 and 1.0.")
        return values

    @field_validator("regressed_dimensions")
    @classmethod
    def ensure_unique_regressed_dimensions(
        cls,
        values: list[StoryQCDimension],
    ) -> list[StoryQCDimension]:
        if len(set(values)) != len(values):
            raise ValueError("Regressed dimensions must be unique.")
        return values


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
    revision_decision: RevisionDecision | None = None
    revision_strategies: list[RevisionStrategy] = Field(
        default_factory=list,
        max_length=5,
    )
    actions: list[RevisionAction] = Field(default_factory=list, max_length=10)
    must_re_qc: bool = True
    notes: list[str] = Field(default_factory=list, max_length=10)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RevisionSkippedAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action_id: str = Field(min_length=3, max_length=120)
    target_type: RevisionTargetType
    reason: str = Field(min_length=3, max_length=120)
    requested_scene_numbers: list[int] = Field(default_factory=list, max_length=20)


class RevisionProtectedScopeCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope_ref: str = Field(min_length=3, max_length=240)
    status: ProtectedScopeStatus
    note: str = Field(min_length=5, max_length=300)


class RevisionStrategyExecutionContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy_id: str = Field(min_length=3, max_length=160)
    target_dimension: StoryQCDimension
    problem_reason: str = Field(min_length=5, max_length=500)
    revision_goal: str = Field(min_length=5, max_length=500)
    revision_method: str = Field(min_length=5, max_length=500)
    expected_effect: str = Field(min_length=5, max_length=500)
    priority: int = Field(ge=1, le=100)
    confidence: float = Field(ge=0.0, le=1.0)
    scene_refs: list[int] = Field(default_factory=list, max_length=20)
    do_not_touch: list[str] = Field(default_factory=list, max_length=20)
    knowledge_ref_ids: list[str] = Field(default_factory=list, max_length=20)


class RevisionExecutionTrace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    executor_version: str = Field(min_length=3, max_length=120)
    execution_mode: RevisionExecutionMode
    applied_actions: list[str] = Field(default_factory=list, max_length=10)
    skipped_actions: list[RevisionSkippedAction] = Field(default_factory=list, max_length=10)
    modified_scene_numbers: list[int] = Field(default_factory=list, max_length=20)
    protected_scope_checks: list[RevisionProtectedScopeCheck] = Field(
        default_factory=list,
        max_length=30,
    )
    strategy_ids: list[str] = Field(default_factory=list, max_length=5)
    strategy_contexts: list[RevisionStrategyExecutionContext] = Field(
        default_factory=list,
        max_length=5,
    )


class RevisionExecutionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revised_draft_master_script: DraftMasterScript
    execution_trace: RevisionExecutionTrace


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
    execution_trace: RevisionExecutionTrace | None = None
    acceptance_decision: AcceptanceDecision | None = None
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
    target_script_body_characters: int | None = Field(
        default=None,
        ge=300,
        le=10_000,
        description=(
            "Optional effective-character budget for visible actions and dialogue only."
        ),
    )
    resolved_creative_context: ResolvedCreativeContext | None = None
    episode_context: "EpisodeGenerationContext | None" = None


class GenerationBatchContext(BaseModel):
    """Optional lineage for one bounded stage of a longer serialized project."""

    model_config = ConfigDict(extra="forbid")

    batch_number: int = Field(ge=1, le=2000)
    start_episode: int = Field(ge=1, le=2000)
    end_episode: int = Field(ge=1, le=2000)
    batch_instruction: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def ensure_valid_episode_range(self) -> "GenerationBatchContext":
        if self.end_episode < self.start_episode:
            raise ValueError("end_episode must not be lower than start_episode.")
        return self


class EpisodeGenerationContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_mode: EpisodeGenerationMode
    episode_number: int = Field(ge=1, le=2000)
    total_episodes: int = Field(ge=1, le=2000)
    previous_episode_summary: str | None = Field(default=None, max_length=2000)
    previous_episode_question: str | None = Field(default=None, max_length=240)
    episode_instruction: str | None = Field(default=None, max_length=1000)
    project_continuity_summary: str | None = Field(default=None, max_length=4000)
    batch_context: GenerationBatchContext | None = None

    @model_validator(mode="after")
    def ensure_episode_number_within_series(self) -> "EpisodeGenerationContext":
        if self.episode_number > self.total_episodes:
            raise ValueError("episode_number must not exceed total_episodes.")
        if self.episode_number == 1 and (
            self.previous_episode_summary or self.previous_episode_question
        ):
            raise ValueError("Episode 1 cannot reference a previous episode.")
        if self.batch_context is not None:
            if self.batch_context.end_episode > self.total_episodes:
                raise ValueError("Batch end_episode must not exceed total_episodes.")
            if not (
                self.batch_context.start_episode
                <= self.episode_number
                <= self.batch_context.end_episode
            ):
                raise ValueError("episode_number must be within the batch episode range.")
        return self


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
    resolved_creative_context: ResolvedCreativeContext | None = None
    episode_context: EpisodeGenerationContext | None = None
    knowledge_bundle: KnowledgeBundle | None = None
    knowledge_selection_trace: KnowledgeSelectionTrace | None = None
    creative_deepening_run: CreativeDeepeningRun | None = None
    draft_master_script: DraftMasterScript
    story_qc_report: StoryQCReport
    revision_plan: RevisionPlan
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ScriptGenerationDraftResponse(BaseModel):
    data: ScriptGenerationDraftRun


class ScriptDraftReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_generation_run: ScriptGenerationDraftRun
    draft_master_script: DraftMasterScript


class ScriptDraftReviewResponse(BaseModel):
    data: ScriptGenerationDraftRun


class ScriptDraftModificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_generation_run: ScriptGenerationDraftRun
    source_draft_master_script: DraftMasterScript
    instruction: str = Field(min_length=3, max_length=500)


class ScriptDraftModificationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_draft_master_script_id: str = Field(min_length=3, max_length=120)
    instruction: str = Field(min_length=3, max_length=500)
    candidate_generation_run: ScriptGenerationDraftRun


class ScriptDraftModificationResponse(BaseModel):
    data: ScriptDraftModificationResult


class ScriptCreativeDeepeningRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_generation_run: ScriptGenerationDraftRun
    source_draft_master_script: DraftMasterScript


class ScriptCreativeDeepeningResponse(BaseModel):
    data: CreativeDeepeningRun


class BilingualScriptText(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=2, max_length=160)
    source_text: str = Field(min_length=1, max_length=4000)
    translated_text: str = Field(min_length=1, max_length=4000)


class BilingualScriptView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    view_version: str = Field(
        default="bilingual_script_view.v1",
        min_length=3,
        max_length=80,
    )
    source_draft_master_script_id: str = Field(min_length=3, max_length=120)
    source_language: str = Field(min_length=2, max_length=20)
    target_language: str = Field(min_length=2, max_length=20)
    items: list[BilingualScriptText] = Field(min_length=1, max_length=1000)
    llm_model_info: LLMModelInfo
    warnings: list[str] = Field(default_factory=list, max_length=20)


class BilingualScriptViewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_strategy_id: str = Field(min_length=3, max_length=120)
    draft_master_script: DraftMasterScript
    target_language: str = Field(default="zh-CN", min_length=2, max_length=20)


class BilingualScriptViewResponse(BaseModel):
    data: BilingualScriptView
