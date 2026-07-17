from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.content_spec.models import ContentSpec
from app.modules.data_intelligence.models import AnalysisResult, RawContentRecordInput

if TYPE_CHECKING:
    from app.modules.master_script.models import DraftMasterScript, MasterScript
    from app.modules.script_engine.models import (
        GenerationStrategyCreate,
        LLMModelInfo,
        PromptBuildResult,
        PromptLibraryItemCreate,
        RevisionPlan,
        ScriptRevisionRun,
        StoryQCReport,
    )


class BenchmarkDatasetType(str, Enum):
    mock = "mock"
    benchmark = "benchmark"


class ExpectedAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topics: list[str] = Field(min_length=1, max_length=10)
    genre_tags: list[str] = Field(default_factory=list, max_length=10)
    emotion_tags: list[str] = Field(default_factory=list, max_length=10)
    audience_signal: str = Field(min_length=10, max_length=240)
    commercial_signal: str = Field(min_length=10, max_length=240)
    preference_score_range: list[float] = Field(min_length=2, max_length=2)
    recommended_hook_type: str = Field(min_length=3, max_length=120)
    recommended_cliffhanger_type: str = Field(min_length=3, max_length=120)

    @field_validator("preference_score_range")
    @classmethod
    def validate_preference_range(cls, value: list[float]) -> list[float]:
        if value[0] > value[1]:
            raise ValueError("Preference score range must be ordered from low to high.")
        return value


class BenchmarkScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")

    benchmark_id: str = Field(min_length=3, max_length=120)
    dataset_type: BenchmarkDatasetType
    title: str = Field(min_length=3, max_length=120)
    audience_hint: str = Field(min_length=3, max_length=240)
    commercial_objective: str = Field(min_length=3, max_length=240)
    records: list[RawContentRecordInput] = Field(min_length=1, max_length=20)
    expected_analysis: ExpectedAnalysis
    manual_notes: list[str] = Field(default_factory=list, max_length=20)


class StoryRubricCategory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_name: str = Field(min_length=3, max_length=120)
    max_score: int = Field(default=5, ge=1, le=10)
    score: float = Field(ge=0.0)
    judgment_standard: str = Field(min_length=10, max_length=300)
    deduction_reasons: list[str] = Field(default_factory=list, max_length=10)
    revision_suggestions: list[str] = Field(default_factory=list, max_length=10)


class StoryRubricResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: str = Field(min_length=3, max_length=80)
    overall_score: float = Field(ge=0.0, le=1.0)
    categories: list[StoryRubricCategory] = Field(min_length=1, max_length=20)
    passed: bool


class ComponentEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    component_name: str = Field(min_length=3, max_length=120)
    score: float = Field(ge=0.0, le=1.0)
    passed: bool
    details: list[str] = Field(default_factory=list, max_length=20)
    artifacts: dict[str, Any] = Field(default_factory=dict)


class BenchmarkScoreSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_script_score: float = Field(ge=0.0, le=1.0)
    draft_story_qc_score: float = Field(ge=0.0, le=1.0)
    revised_draft_script_score: float = Field(ge=0.0, le=1.0)
    revised_story_qc_score: float = Field(ge=0.0, le=1.0)
    final_script_score: float = Field(ge=0.0, le=1.0)
    revision_script_gain: float
    revision_qc_gain: float
    final_gain_over_draft: float
    final_gain_over_revised_draft: float


class BenchmarkRevisionSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action_count: int = Field(ge=0, le=20)
    applied_action_ids: list[str] = Field(default_factory=list, max_length=20)
    dominant_target_types: list[str] = Field(default_factory=list, max_length=10)
    improved: bool
    notes: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("applied_action_ids", "dominant_target_types", "notes")
    @classmethod
    def ensure_unique_summary_strings(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


class BenchmarkHighlights(BaseModel):
    model_config = ConfigDict(extra="forbid")

    headline: str = Field(min_length=5, max_length=240)
    strongest_gain_stage: str = Field(min_length=3, max_length=80)
    pass_flags: list[str] = Field(default_factory=list, max_length=10)
    warnings: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("pass_flags", "warnings")
    @classmethod
    def ensure_unique_highlight_strings(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


class BenchmarkRunResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()))
    benchmark_id: str = Field(min_length=3, max_length=120)
    dataset_type: BenchmarkDatasetType
    analysis_evaluation: ComponentEvaluation
    content_spec_evaluation: ComponentEvaluation
    prompt_evaluation: ComponentEvaluation
    draft_script_evaluation: ComponentEvaluation
    story_qc_evaluation: ComponentEvaluation
    revised_draft_script_evaluation: ComponentEvaluation
    revised_story_qc_evaluation: ComponentEvaluation
    final_script_evaluation: ComponentEvaluation
    draft_master_script: DraftMasterScript
    revised_draft_master_script: DraftMasterScript
    final_master_script: MasterScript
    prompt_build_result: PromptBuildResult
    story_qc_report: StoryQCReport
    revised_story_qc_report: StoryQCReport
    revision_plan: RevisionPlan
    script_revision_run: ScriptRevisionRun
    score_summary: BenchmarkScoreSummary
    revision_summary: BenchmarkRevisionSummary
    highlights: BenchmarkHighlights
    revision_improves_over_draft: bool
    final_improves_over_draft: bool
    final_improves_over_revised_draft: bool
    success: bool
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BenchmarkRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str = Field(min_length=3, max_length=120)
    dataset_type: BenchmarkDatasetType = BenchmarkDatasetType.benchmark


class BenchmarkRunResponse(BaseModel):
    data: BenchmarkRunResult


class BenchmarkRunListResponse(BaseModel):
    data: list[BenchmarkRunResult]


class BenchmarkErrorResponse(BaseModel):
    detail: str


class DeterministicCheckResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    check_name: str = Field(min_length=3, max_length=120)
    passed: bool
    expected: str = Field(min_length=1, max_length=400)
    actual: str = Field(min_length=1, max_length=400)
    note: str | None = Field(default=None, min_length=3, max_length=240)


class PromptEvaluationVariantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
    )
    prompt_library_items: list[PromptLibraryItemCreate] = Field(
        default_factory=list,
        max_length=10,
    )
    generation_strategy: GenerationStrategyCreate
    repeat_count: int = Field(default=1, ge=1, le=5)
    output_language: str = Field(default="en", min_length=2, max_length=20)
    desired_scene_count: int = Field(default=3, ge=2, le=8)


class PromptEvaluationRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evaluation_case_id: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
    )
    dataset_id: str = Field(min_length=3, max_length=120)
    dataset_type: BenchmarkDatasetType = BenchmarkDatasetType.benchmark
    variants: list[PromptEvaluationVariantRequest] = Field(min_length=1, max_length=10)
    save_report: bool = False
    report_dir: str | None = Field(default=None, min_length=3, max_length=240)

    @field_validator("variants")
    @classmethod
    def ensure_unique_variant_case_ids(
        cls,
        values: list[PromptEvaluationVariantRequest],
    ) -> list[PromptEvaluationVariantRequest]:
        case_ids = [value.case_id for value in values]
        normalized = [case_id.strip().lower() for case_id in case_ids]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Prompt evaluation variant case_id values must be unique.")
        return values


class PromptEvaluationTokenUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt_tokens: int | None = Field(default=None, ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)
    total_tokens: int | None = Field(default=None, ge=0)


class PromptEvaluationArtifactIds(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_spec_id: str = Field(min_length=3, max_length=120)
    orchestration_plan_id: str = Field(min_length=3, max_length=120)
    draft_master_script_id: str = Field(min_length=3, max_length=120)


class PromptEvaluationSampleResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sample_id: str = Field(default_factory=lambda: str(uuid4()))
    run_index: int = Field(ge=1, le=20)
    benchmark_dataset_id: str = Field(min_length=3, max_length=120)
    content_spec_id: str = Field(min_length=3, max_length=120)
    prompt_ids: list[str] = Field(min_length=1, max_length=20)
    prompt_versions: list[str] = Field(default_factory=list, max_length=20)
    generation_strategy_id: str = Field(min_length=3, max_length=120)
    generation_strategy_version: str = Field(min_length=1, max_length=40)
    llm_model_info: LLMModelInfo
    deterministic_checks: list[DeterministicCheckResult] = Field(
        min_length=1,
        max_length=20,
    )
    script_evaluation: ComponentEvaluation
    story_qc_evaluation: ComponentEvaluation
    story_qc_score: float = Field(ge=0.0, le=1.0)
    story_qc_status: str = Field(min_length=3, max_length=80)
    story_qc_is_placeholder: bool
    latency_ms: float = Field(ge=0.0, le=300000.0)
    estimated_cost_usd: float | None = Field(default=None, ge=0.0)
    token_usage: PromptEvaluationTokenUsage | None = None
    pass_fail: bool
    failure_reasons: list[str] = Field(default_factory=list, max_length=20)
    artifact_ids: PromptEvaluationArtifactIds
    draft_master_script: DraftMasterScript

    @field_validator("prompt_ids", "prompt_versions", "failure_reasons")
    @classmethod
    def ensure_unique_prompt_eval_string_lists(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


class PromptEvaluationStabilitySummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_count: int = Field(ge=1, le=20)
    title_exact_match_ratio: float = Field(ge=0.0, le=1.0)
    hook_exact_match_ratio: float = Field(ge=0.0, le=1.0)
    story_qc_score_range: float = Field(ge=0.0, le=1.0)
    average_latency_ms: float = Field(ge=0.0, le=300000.0)


class PromptEvaluationVariantMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    average_script_score: float = Field(ge=0.0, le=1.0)
    average_story_qc_score: float = Field(ge=0.0, le=1.0)
    average_deterministic_pass_rate: float = Field(ge=0.0, le=1.0)
    average_latency_ms: float = Field(ge=0.0, le=300000.0)
    average_estimated_cost_usd: float | None = Field(default=None, ge=0.0)
    average_total_tokens: float | None = Field(default=None, ge=0.0)


class PromptEvaluationVariantExplainability(BaseModel):
    model_config = ConfigDict(extra="forbid")

    compare_to_case_id: str | None = Field(default=None, min_length=3, max_length=120)
    notable_output_changes: list[str] = Field(default_factory=list, max_length=20)
    improved_metrics: list[str] = Field(default_factory=list, max_length=20)
    regressed_metrics: list[str] = Field(default_factory=list, max_length=20)
    unchanged_metrics: list[str] = Field(default_factory=list, max_length=20)
    side_effects: list[str] = Field(default_factory=list, max_length=20)
    why_better: list[str] = Field(default_factory=list, max_length=20)
    why_worse: list[str] = Field(default_factory=list, max_length=20)
    decision_summary: str = Field(min_length=5, max_length=400)
    recommended_action: str = Field(min_length=5, max_length=240)

    @field_validator(
        "notable_output_changes",
        "improved_metrics",
        "regressed_metrics",
        "unchanged_metrics",
        "side_effects",
        "why_better",
        "why_worse",
    )
    @classmethod
    def ensure_unique_explainability_lists(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Explainability list values must be unique.")
        return values


class PromptEvaluationVariantResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str = Field(min_length=3, max_length=120)
    benchmark_dataset_id: str = Field(min_length=3, max_length=120)
    content_spec_id: str = Field(min_length=3, max_length=120)
    prompt_ids: list[str] = Field(min_length=1, max_length=20)
    prompt_versions: list[str] = Field(default_factory=list, max_length=20)
    generation_strategy_id: str = Field(min_length=3, max_length=120)
    generation_strategy_version: str = Field(min_length=1, max_length=40)
    samples: list[PromptEvaluationSampleResult] = Field(min_length=1, max_length=20)
    metrics_summary: PromptEvaluationVariantMetrics
    stability_summary: PromptEvaluationStabilitySummary
    explainability: PromptEvaluationVariantExplainability
    pass_fail: bool
    failure_reasons: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("prompt_ids", "prompt_versions", "failure_reasons")
    @classmethod
    def ensure_unique_variant_string_lists(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


class PromptEvaluationReportPaths(BaseModel):
    model_config = ConfigDict(extra="forbid")

    json_path: str = Field(min_length=3, max_length=400)
    markdown_path: str | None = Field(default=None, min_length=3, max_length=400)


class PromptEvaluationDecisionSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    best_variant_case_id: str = Field(min_length=3, max_length=120)
    best_variant_reason: str = Field(min_length=5, max_length=400)
    improvement_signals: list[str] = Field(default_factory=list, max_length=20)
    regression_signals: list[str] = Field(default_factory=list, max_length=20)
    side_effects: list[str] = Field(default_factory=list, max_length=20)
    next_optimization_targets: list[str] = Field(default_factory=list, max_length=20)

    @field_validator(
        "improvement_signals",
        "regression_signals",
        "side_effects",
        "next_optimization_targets",
    )
    @classmethod
    def ensure_unique_decision_lists(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Decision summary list values must be unique.")
        return values


class PromptEvaluationRunResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()))
    evaluation_case_id: str = Field(min_length=3, max_length=120)
    benchmark_dataset_id: str = Field(min_length=3, max_length=120)
    dataset_type: BenchmarkDatasetType
    content_spec_id: str = Field(min_length=3, max_length=120)
    variants: list[PromptEvaluationVariantResult] = Field(min_length=1, max_length=10)
    overall_pass: bool
    decision_summary: PromptEvaluationDecisionSummary
    placeholder_notes: list[str] = Field(default_factory=list, max_length=10)
    report_paths: PromptEvaluationReportPaths | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("placeholder_notes")
    @classmethod
    def ensure_unique_placeholder_notes(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Placeholder notes must be unique.")
        return values


class PromptEvaluationRunResponse(BaseModel):
    data: PromptEvaluationRunResult


class PromptEvaluationRunListResponse(BaseModel):
    data: list[PromptEvaluationRunResult]


from app.modules.master_script.models import DraftMasterScript, MasterScript
from app.modules.script_engine.models import (
    GenerationStrategyCreate,
    LLMModelInfo,
    PromptBuildResult,
    PromptLibraryItemCreate,
    RevisionPlan,
    ScriptRevisionRun,
    StoryQCReport,
)

BenchmarkRunResult.model_rebuild(
    _types_namespace={
        "DraftMasterScript": DraftMasterScript,
        "MasterScript": MasterScript,
        "PromptBuildResult": PromptBuildResult,
        "RevisionPlan": RevisionPlan,
        "ScriptRevisionRun": ScriptRevisionRun,
        "StoryQCReport": StoryQCReport,
    }
)
PromptEvaluationSampleResult.model_rebuild(
    _types_namespace={
        "DraftMasterScript": DraftMasterScript,
        "LLMModelInfo": LLMModelInfo,
    }
)
PromptEvaluationVariantRequest.model_rebuild(
    _types_namespace={
        "GenerationStrategyCreate": GenerationStrategyCreate,
        "PromptLibraryItemCreate": PromptLibraryItemCreate,
    }
)
