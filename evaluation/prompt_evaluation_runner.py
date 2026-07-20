from __future__ import annotations

import json
from pathlib import Path
from statistics import mean
from time import perf_counter
from typing import Any

from app.modules.asset.models import Asset, AssetContent, AssetType
from app.modules.asset.repository import AssetRepository
from app.modules.asset.service import AssetService
from app.modules.content_spec.models import TagRef
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.data_intelligence.service import DataIntelligenceService
from app.modules.master_script.models import DraftMasterScript
from app.modules.ontology_node.models import OntologyCategory, OntologyNode
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.orchestrator.repository import OrchestrationPlanRepository
from app.modules.orchestrator.service import OrchestratorService
from app.modules.platform_profile.models import PlatformProfile, ProfileRule, PublishingStrategy
from app.modules.platform_profile.repository import PlatformProfileRepository
from app.modules.platform_profile.service import PlatformProfileService
from app.modules.retrieval.service import RetrievalService
from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.models import (
    GenerationStrategyCreate,
    PromptLibraryItemCreate,
    PromptType,
    ScriptGenerationDraftRequest,
)
from app.modules.script_engine.prompt_retrieval import PromptRetrievalService
from app.modules.script_engine.repository import (
    GenerationStrategyRepository,
    PromptLibraryRepository,
)
from app.modules.script_engine.service import (
    GenerationStrategyService,
    PromptLibraryService,
)
from evaluation.benchmark_runner import BenchmarkRunner, MissingBenchmarkDatasetError
from evaluation.models import (
    BenchmarkDatasetType,
    BenchmarkScenario,
    DeterministicCheckResult,
    PromptEvaluationArtifactIds,
    PromptEvaluationDimensionDelta,
    PromptEvaluationDecisionSummary,
    PromptEvaluationReportPaths,
    PromptEvaluationRunRequest,
    PromptEvaluationRunResult,
    PromptEvaluationSampleResult,
    PromptEvaluationStoryQCDimensionInsight,
    PromptEvaluationStabilitySummary,
    PromptEvaluationTokenUsage,
    PromptEvaluationVariantExplainability,
    PromptEvaluationVariantMetrics,
    PromptEvaluationVariantRequest,
    PromptEvaluationVariantResult,
)
from evaluation.script_evaluation import ScriptEvaluator
from evaluation.story_qc_evaluation import StoryQCEvaluator


class PromptEvaluationResultRepository:
    def __init__(self) -> None:
        self._items: dict[str, PromptEvaluationRunResult] = {}

    def save(self, result: PromptEvaluationRunResult) -> PromptEvaluationRunResult:
        self._items[result.id] = result
        return result

    def get(self, result_id: str) -> PromptEvaluationRunResult | None:
        return self._items.get(result_id)

    def list(self) -> list[PromptEvaluationRunResult]:
        return list(self._items.values())


class PromptEvaluationRunner:
    def __init__(self, *, dataset_root: str = "datasets") -> None:
        self._benchmark_runner = BenchmarkRunner(dataset_root=dataset_root)
        self._script_evaluator = ScriptEvaluator()
        self._story_qc_evaluator = StoryQCEvaluator()

    def load_scenario(
        self,
        *,
        dataset_id: str,
        dataset_type: BenchmarkDatasetType,
    ) -> BenchmarkScenario:
        return self._benchmark_runner.load_scenario(
            dataset_id=dataset_id,
            dataset_type=dataset_type,
        )

    def run(self, request: PromptEvaluationRunRequest) -> PromptEvaluationRunResult:
        scenario = self.load_scenario(
            dataset_id=request.dataset_id,
            dataset_type=request.dataset_type,
        )
        runtime = self._build_runtime()
        pipeline_response = runtime.data_intelligence_service.run_records_pipeline(
            scenario.records,
            platform_profile_id="tiktok_benchmark_v1",
            audience_hint=scenario.audience_hint,
            commercial_objective=scenario.commercial_objective,
        )
        content_spec = pipeline_response.content_spec
        variant_results = [
            self._run_variant(
                scenario=scenario,
                content_spec_id=content_spec.id,
                runtime=runtime,
                variant=variant,
            )
            for variant in request.variants
        ]
        explained_variants = self._apply_cross_variant_explainability(variant_results)
        report_paths: PromptEvaluationReportPaths | None = None
        result = PromptEvaluationRunResult(
            evaluation_case_id=request.evaluation_case_id,
            benchmark_dataset_id=scenario.benchmark_id,
            dataset_type=scenario.dataset_type,
            content_spec_id=content_spec.id,
            variants=explained_variants,
            overall_pass=all(variant.pass_fail for variant in explained_variants),
            decision_summary=self._build_run_decision_summary(explained_variants),
            placeholder_notes=[
                "Current Story QC remains a placeholder signal and must not be treated as a final script quality conclusion."
            ],
        )
        if request.save_report:
            report_paths = self._write_report(
                request=request,
                result=result,
            )
            result = result.model_copy(update={"report_paths": report_paths})
        return result

    def _run_variant(
        self,
        *,
        scenario: BenchmarkScenario,
        content_spec_id: str,
        runtime: "_PromptEvaluationRuntime",
        variant: PromptEvaluationVariantRequest,
    ) -> PromptEvaluationVariantResult:
        for prompt_item in variant.prompt_library_items:
            runtime.ensure_prompt_item(prompt_item)
        runtime.ensure_generation_strategy(variant.generation_strategy)

        sample_results: list[PromptEvaluationSampleResult] = []
        for run_index in range(1, variant.repeat_count + 1):
            started_at = perf_counter()
            draft_run = runtime.script_generation_service.generate_draft(
                ScriptGenerationDraftRequest(
                    content_spec_id=content_spec_id,
                    generation_strategy_id=variant.generation_strategy.id,
                    output_language=variant.output_language,
                    desired_scene_count=variant.desired_scene_count,
                )
            )
            latency_ms = round((perf_counter() - started_at) * 1000, 3)
            deterministic_checks = self._build_deterministic_checks(
                scenario=scenario,
                requested_output_language=variant.output_language,
                requested_scene_count=variant.desired_scene_count,
                expected_strategy=variant.generation_strategy,
                draft_run=draft_run,
            )
            script_evaluation = self._script_evaluator.evaluate(
                draft_run.draft_master_script.model_dump(),
                stage=f"prompt_eval_{variant.case_id}",
            )
            story_qc_evaluation = self._story_qc_evaluator.evaluate(
                draft_run.story_qc_report
            )
            story_qc_dimensions = self._extract_story_qc_dimensions(
                draft_run.story_qc_report
            )
            is_mock_provider = draft_run.llm_model_info.provider == "mock"
            failure_reasons = [
                check.check_name
                for check in deterministic_checks
                if not check.passed
                and not (
                    is_mock_provider
                    and check.check_name
                    in {
                        "hook_presence_and_type",
                        "cliffhanger_presence_and_type",
                        "protagonist_agency_visible",
                    }
                )
            ]
            if not script_evaluation.passed:
                failure_reasons.append("script_evaluation_below_threshold")
            sample_results.append(
                PromptEvaluationSampleResult(
                    run_index=run_index,
                    benchmark_dataset_id=scenario.benchmark_id,
                    content_spec_id=content_spec_id,
                    prompt_ids=draft_run.prompt_retrieval_result.prompt_ids,
                    prompt_versions=[
                        prompt.version for prompt in draft_run.prompt_retrieval_result.prompts
                    ],
                    generation_strategy_id=draft_run.generation_strategy_id,
                    generation_strategy_version=draft_run.generation_strategy_version,
                    llm_model_info=draft_run.llm_model_info,
                    deterministic_checks=deterministic_checks,
                    script_evaluation=script_evaluation,
                    story_qc_evaluation=story_qc_evaluation,
                    story_qc_score=draft_run.story_qc_report.overall_score,
                    story_qc_status=draft_run.story_qc_report.status.value,
                    story_qc_is_placeholder=(
                        draft_run.story_qc_report.status.value == "placeholder"
                    ),
                    latency_ms=latency_ms,
                    estimated_cost_usd=self._extract_estimated_cost(
                        draft_run.llm_raw_output
                    ),
                    token_usage=self._extract_token_usage(draft_run.llm_raw_output),
                    story_qc_dimensions=story_qc_dimensions,
                    pass_fail=not failure_reasons,
                    failure_reasons=failure_reasons,
                    artifact_ids=PromptEvaluationArtifactIds(
                        content_spec_id=content_spec_id,
                        orchestration_plan_id=draft_run.orchestration_plan.id,
                        draft_master_script_id=draft_run.draft_master_script.id,
                    ),
                    draft_master_script=draft_run.draft_master_script,
                )
            )

        prompt_versions = sample_results[0].prompt_versions
        prompt_ids = sample_results[0].prompt_ids
        (
            story_qc_dimension_scores,
            story_qc_dimension_summaries,
            story_qc_deduction_reasons,
            story_qc_evidence,
            story_qc_revision_signals,
            story_qc_scene_refs,
        ) = self._aggregate_story_qc_dimensions(sample_results)
        variant_failure_reasons = sorted(
            {
                reason
                for sample in sample_results
                for reason in sample.failure_reasons
            }
        )
        return PromptEvaluationVariantResult(
            case_id=variant.case_id,
            benchmark_dataset_id=scenario.benchmark_id,
            content_spec_id=content_spec_id,
            prompt_ids=prompt_ids,
            prompt_versions=prompt_versions,
            generation_strategy_id=variant.generation_strategy.id,
            generation_strategy_version=variant.generation_strategy.version,
            samples=sample_results,
            story_qc_dimension_scores=story_qc_dimension_scores,
            story_qc_dimension_summaries=story_qc_dimension_summaries,
            story_qc_deduction_reasons=story_qc_deduction_reasons,
            story_qc_evidence=story_qc_evidence,
            story_qc_revision_signals=story_qc_revision_signals,
            story_qc_scene_refs=story_qc_scene_refs,
            metrics_summary=self._build_variant_metrics_summary(sample_results),
            stability_summary=self._build_stability_summary(sample_results),
            explainability=PromptEvaluationVariantExplainability(
                compare_to_case_id=None,
                decision_summary="Pending cross-variant explainability analysis.",
                recommended_action="Wait for cross-variant comparison before making a keep or reject decision.",
            ),
            pass_fail=not variant_failure_reasons,
            failure_reasons=variant_failure_reasons,
        )

    def _build_deterministic_checks(
        self,
        *,
        scenario: BenchmarkScenario,
        requested_output_language: str,
        requested_scene_count: int,
        expected_strategy: GenerationStrategyCreate,
        draft_run,
    ) -> list[DeterministicCheckResult]:
        draft = draft_run.draft_master_script
        prompt_versions = [
            prompt.version for prompt in draft_run.prompt_retrieval_result.prompts
        ]
        recorded_prompt_versions = draft.llm_metadata.get("prompt_versions", [])
        recorded_strategy_version = draft.llm_metadata.get(
            "generation_strategy_version"
        )
        checks = [
            DeterministicCheckResult(
                check_name="draft_schema_valid",
                passed=isinstance(draft, DraftMasterScript),
                expected="DraftMasterScript instance",
                actual=type(draft).__name__,
                note="Draft schema validation is enforced by Pydantic before evaluation.",
            ),
            DeterministicCheckResult(
                check_name="required_fields_complete",
                passed=self._has_required_fields(draft),
                expected="title, hook, synopsis, episode_goal, scenes and target duration must all be present",
                actual=self._summarize_required_fields(draft),
            ),
            DeterministicCheckResult(
                check_name="content_spec_requirement_applied",
                passed=draft.content_spec_id == draft_run.content_spec_id
                and draft.target_duration_seconds
                == draft_run.orchestration_plan.target_duration_seconds,
                expected=(
                    "Draft should preserve content_spec_id and target_duration_seconds from the controlled generation request"
                ),
                actual=(
                    f"content_spec_id={draft.content_spec_id}; "
                    f"target_duration_seconds={draft.target_duration_seconds}"
                ),
            ),
            DeterministicCheckResult(
                check_name="prompt_versions_recorded",
                passed=recorded_prompt_versions == prompt_versions,
                expected=", ".join(prompt_versions) or "no prompt versions",
                actual=", ".join(recorded_prompt_versions)
                if isinstance(recorded_prompt_versions, list)
                else str(recorded_prompt_versions),
            ),
            DeterministicCheckResult(
                check_name="generation_strategy_version_recorded",
                passed=recorded_strategy_version == expected_strategy.version,
                expected=expected_strategy.version,
                actual=str(recorded_strategy_version),
            ),
            DeterministicCheckResult(
                check_name="hook_presence_and_type",
                passed=bool(draft.hook.strip())
                and self._matches_hook_type(
                    draft.hook,
                    scenario.expected_analysis.recommended_hook_type,
                ),
                expected=scenario.expected_analysis.recommended_hook_type,
                actual=draft.hook,
            ),
            DeterministicCheckResult(
                check_name="cliffhanger_presence_and_type",
                passed=draft.scenes[-1].cliffhanger
                and self._matches_cliffhanger_type(
                    draft=draft,
                    expected_type=scenario.expected_analysis.recommended_cliffhanger_type,
                ),
                expected=scenario.expected_analysis.recommended_cliffhanger_type,
                actual=(
                    f"final_scene_cliffhanger={draft.scenes[-1].cliffhanger}; "
                    f"ending_text={self._extract_ending_signal(draft)}"
                ),
            ),
            DeterministicCheckResult(
                check_name="protagonist_agency_visible",
                passed=self._has_visible_agency(draft),
                expected="Lead character should make a visible choice, refusal, reveal or public move",
                actual=self._summarize_agency_evidence(draft),
                note="Mock adapter runs may have weaker agency evidence because they do not produce full character-level reasoning.",
            ),
            DeterministicCheckResult(
                check_name="scene_count_matches_request",
                passed=len(draft.scenes) == requested_scene_count,
                expected=str(requested_scene_count),
                actual=str(len(draft.scenes)),
            ),
            DeterministicCheckResult(
                check_name="output_language_matches_request",
                passed=draft.language == requested_output_language,
                expected=requested_output_language,
                actual=draft.language,
            ),
        ]
        return checks

    def _build_stability_summary(
        self,
        samples: list[PromptEvaluationSampleResult],
    ) -> PromptEvaluationStabilitySummary:
        titles = [sample.draft_master_script.title for sample in samples]
        hooks = [sample.draft_master_script.hook for sample in samples]
        story_qc_scores = [sample.story_qc_score for sample in samples]
        latencies = [sample.latency_ms for sample in samples]
        title_match_ratio = 1.0 if len(set(titles)) == 1 else round(1 / len(set(titles)), 3)
        hook_match_ratio = 1.0 if len(set(hooks)) == 1 else round(1 / len(set(hooks)), 3)
        return PromptEvaluationStabilitySummary(
            run_count=len(samples),
            title_exact_match_ratio=title_match_ratio,
            hook_exact_match_ratio=hook_match_ratio,
            story_qc_score_range=round(max(story_qc_scores) - min(story_qc_scores), 3),
            average_latency_ms=round(mean(latencies), 3),
        )

    def _build_variant_metrics_summary(
        self,
        samples: list[PromptEvaluationSampleResult],
    ) -> PromptEvaluationVariantMetrics:
        deterministic_pass_rates = [
            self._deterministic_pass_rate(sample) for sample in samples
        ]
        script_scores = [sample.script_evaluation.score for sample in samples]
        story_qc_scores = [sample.story_qc_score for sample in samples]
        latencies = [sample.latency_ms for sample in samples]
        costs = [
            sample.estimated_cost_usd
            for sample in samples
            if sample.estimated_cost_usd is not None
        ]
        total_tokens = [
            sample.token_usage.total_tokens
            for sample in samples
            if sample.token_usage is not None and sample.token_usage.total_tokens is not None
        ]
        return PromptEvaluationVariantMetrics(
            average_script_score=round(mean(script_scores), 3),
            average_story_qc_score=round(mean(story_qc_scores), 3),
            average_deterministic_pass_rate=round(mean(deterministic_pass_rates), 3),
            average_latency_ms=round(mean(latencies), 3),
            average_estimated_cost_usd=(
                round(mean(costs), 6) if costs else None
            ),
            average_total_tokens=(
                round(mean(total_tokens), 3) if total_tokens else None
            ),
        )

    def _extract_story_qc_dimensions(
        self,
        report,
    ) -> list[PromptEvaluationStoryQCDimensionInsight]:
        dimensions = getattr(report, "dimension_evaluations", [])
        if not dimensions:
            return []
        return [
            PromptEvaluationStoryQCDimensionInsight(
                dimension=item.dimension.value,
                score=item.score,
                summary=item.summary,
                deduction_reasons=item.deduction_reasons,
                scene_refs=item.scene_refs,
                evidence=item.evidence,
                revision_signals=item.revision_signals,
                available=True,
            )
            for item in dimensions
        ]

    def _aggregate_story_qc_dimensions(
        self,
        samples: list[PromptEvaluationSampleResult],
    ) -> tuple[
        dict[str, float],
        dict[str, str],
        dict[str, list[str]],
        dict[str, list[str]],
        dict[str, list[str]],
        dict[str, list[int]],
    ]:
        score_buckets: dict[str, list[float]] = {}
        summaries: dict[str, str] = {}
        deduction_reasons: dict[str, list[str]] = {}
        evidence: dict[str, list[str]] = {}
        revision_signals: dict[str, list[str]] = {}
        scene_refs: dict[str, list[int]] = {}

        for sample in samples:
            for dimension in sample.story_qc_dimensions:
                score_buckets.setdefault(dimension.dimension, [])
                if dimension.score is not None:
                    score_buckets[dimension.dimension].append(dimension.score)
                if dimension.summary and dimension.dimension not in summaries:
                    summaries[dimension.dimension] = dimension.summary
                deduction_reasons.setdefault(dimension.dimension, [])
                deduction_reasons[dimension.dimension].extend(
                    dimension.deduction_reasons
                )
                evidence.setdefault(dimension.dimension, [])
                evidence[dimension.dimension].extend(dimension.evidence)
                revision_signals.setdefault(dimension.dimension, [])
                revision_signals[dimension.dimension].extend(
                    dimension.revision_signals
                )
                scene_refs.setdefault(dimension.dimension, [])
                scene_refs[dimension.dimension].extend(dimension.scene_refs)

        averaged_scores = {
            dimension: round(mean(scores), 3)
            for dimension, scores in score_buckets.items()
            if scores
        }
        normalized_deduction_reasons = {
            dimension: self._unique_strings(items)[:5]
            for dimension, items in deduction_reasons.items()
            if items
        }
        normalized_evidence = {
            dimension: self._unique_strings(items)[:5]
            for dimension, items in evidence.items()
            if items
        }
        normalized_revision_signals = {
            dimension: self._unique_strings(items)[:5]
            for dimension, items in revision_signals.items()
            if items
        }
        normalized_scene_refs = {
            dimension: sorted(set(items))
            for dimension, items in scene_refs.items()
            if items
        }
        return (
            averaged_scores,
            summaries,
            normalized_deduction_reasons,
            normalized_evidence,
            normalized_revision_signals,
            normalized_scene_refs,
        )

    def _build_dimension_deltas(
        self,
        *,
        baseline: PromptEvaluationVariantResult,
        candidate: PromptEvaluationVariantResult,
    ) -> list[PromptEvaluationDimensionDelta]:
        dimensions = sorted(
            set(baseline.story_qc_dimension_scores)
            | set(candidate.story_qc_dimension_scores)
            | set(baseline.story_qc_dimension_summaries)
            | set(candidate.story_qc_dimension_summaries)
        )
        deltas: list[PromptEvaluationDimensionDelta] = []
        for dimension in dimensions:
            baseline_score = baseline.story_qc_dimension_scores.get(dimension)
            candidate_score = candidate.story_qc_dimension_scores.get(dimension)
            if baseline_score is None or candidate_score is None:
                direction = "unavailable"
                delta = None
            else:
                delta = round(candidate_score - baseline_score, 3)
                if abs(delta) <= 0.01:
                    direction = "unchanged"
                elif delta > 0:
                    direction = "improved"
                else:
                    direction = "regressed"
            deltas.append(
                PromptEvaluationDimensionDelta(
                    dimension=dimension,
                    baseline_score=baseline_score,
                    candidate_score=candidate_score,
                    delta=delta,
                    direction=direction,
                    baseline_summary=baseline.story_qc_dimension_summaries.get(dimension),
                    candidate_summary=candidate.story_qc_dimension_summaries.get(dimension),
                    deduction_reasons=self._unique_strings(
                        candidate.story_qc_deduction_reasons.get(dimension, [])
                        or baseline.story_qc_deduction_reasons.get(dimension, [])
                    )[:5],
                    scene_refs=sorted(
                        set(candidate.story_qc_scene_refs.get(dimension, []))
                        or set(baseline.story_qc_scene_refs.get(dimension, []))
                    ),
                    evidence=self._unique_strings(
                        candidate.story_qc_evidence.get(dimension, [])
                        or baseline.story_qc_evidence.get(dimension, [])
                    )[:5],
                    revision_signals=self._unique_strings(
                        candidate.story_qc_revision_signals.get(dimension, [])
                        or baseline.story_qc_revision_signals.get(dimension, [])
                    )[:5],
                )
            )
        return deltas

    def _summarize_dimension_delta(
        self,
        delta: PromptEvaluationDimensionDelta,
    ) -> str:
        baseline_value = (
            f"{delta.baseline_score:.3f}" if delta.baseline_score is not None else "n/a"
        )
        candidate_value = (
            f"{delta.candidate_score:.3f}" if delta.candidate_score is not None else "n/a"
        )
        delta_value = f"{delta.delta:+.3f}" if delta.delta is not None else "n/a"
        summary = delta.candidate_summary or delta.baseline_summary or "No dimension summary available."
        scene_note = (
            f" Scene refs: {', '.join(str(scene) for scene in delta.scene_refs)}."
            if delta.scene_refs
            else ""
        )
        return (
            f"{delta.dimension}: {baseline_value} -> {candidate_value} "
            f"({delta_value}). {summary}{scene_note}"
        )

    def _strongest_dimension_change(
        self,
        dimension_deltas: list[PromptEvaluationDimensionDelta],
        *,
        direction: str,
    ) -> str | None:
        eligible = [
            delta
            for delta in dimension_deltas
            if delta.direction == direction and delta.delta is not None
        ]
        if not eligible:
            return None
        ranked = sorted(
            eligible,
            key=lambda item: item.delta if item.delta is not None else 0.0,
            reverse=(direction == "improved"),
        )
        return ranked[0].dimension

    def _build_variant_confidence_note(
        self,
        *,
        variant: PromptEvaluationVariantResult,
        baseline: PromptEvaluationVariantResult,
        dimension_deltas: list[PromptEvaluationDimensionDelta],
    ) -> str | None:
        if not dimension_deltas:
            return (
                "Story QC dimension-level explainability is unavailable for this comparison, so the decision falls back to aggregate metrics."
            )
        if abs(
            variant.metrics_summary.average_script_score
            - baseline.metrics_summary.average_script_score
        ) <= 0.01 and abs(
            variant.metrics_summary.average_story_qc_score
            - baseline.metrics_summary.average_story_qc_score
        ) <= 0.01:
            return (
                "Aggregate scores are very close, so keep this comparison as directional evidence rather than a decisive winner."
            )
        if any(sample.story_qc_is_placeholder for sample in variant.samples):
            return (
                "Story QC still contains placeholder signals, so dimension-level gains are useful but not final proof of professional script quality."
            )
        return None

    def _apply_cross_variant_explainability(
        self,
        variants: list[PromptEvaluationVariantResult],
    ) -> list[PromptEvaluationVariantResult]:
        if not variants:
            return variants
        baseline = variants[0]
        explained: list[PromptEvaluationVariantResult] = []
        for variant in variants:
            explainability = self._build_variant_explainability(
                variant=variant,
                baseline=baseline,
            )
            explained.append(
                variant.model_copy(update={"explainability": explainability})
            )
        return self._annotate_recommended_variants(explained)

    def _build_variant_explainability(
        self,
        *,
        variant: PromptEvaluationVariantResult,
        baseline: PromptEvaluationVariantResult,
    ) -> PromptEvaluationVariantExplainability:
        if variant.case_id == baseline.case_id:
            baseline_side_effects = self._build_placeholder_side_effects(variant)
            return PromptEvaluationVariantExplainability(
                compare_to_case_id=None,
                dimension_deltas=[],
                notable_output_changes=[
                    "This is the baseline variant used as the reference for later comparisons."
                ],
                unchanged_metrics=[
                    "baseline_reference",
                ],
                improvements=[],
                regressions=[],
                unchanged_dimensions=["baseline_reference"],
                side_effects=baseline_side_effects,
                decision_summary=(
                    "Baseline variant retained as the comparison anchor for later prompt and strategy changes."
                ),
                comparison_summary=(
                    "Baseline variant retained as the comparison anchor for later prompt and strategy changes."
                ),
                recommended_action=(
                    "Keep as the control variant so future prompt or strategy changes remain measurable."
                ),
                recommendation_reason=(
                    "Baseline variant remains the control reference for later prompt and strategy comparisons."
                ),
                confidence_note=(
                    "Baseline confidence is limited because Story QC still contains placeholder signals."
                ),
            )

        improved_metrics: list[str] = []
        regressed_metrics: list[str] = []
        unchanged_metrics: list[str] = []

        self._append_metric_delta(
            improved_metrics=improved_metrics,
            regressed_metrics=regressed_metrics,
            unchanged_metrics=unchanged_metrics,
            metric_name="average_script_score",
            baseline_value=baseline.metrics_summary.average_script_score,
            current_value=variant.metrics_summary.average_script_score,
            higher_is_better=True,
        )
        self._append_metric_delta(
            improved_metrics=improved_metrics,
            regressed_metrics=regressed_metrics,
            unchanged_metrics=unchanged_metrics,
            metric_name="average_story_qc_score",
            baseline_value=baseline.metrics_summary.average_story_qc_score,
            current_value=variant.metrics_summary.average_story_qc_score,
            higher_is_better=True,
        )
        self._append_metric_delta(
            improved_metrics=improved_metrics,
            regressed_metrics=regressed_metrics,
            unchanged_metrics=unchanged_metrics,
            metric_name="average_deterministic_pass_rate",
            baseline_value=baseline.metrics_summary.average_deterministic_pass_rate,
            current_value=variant.metrics_summary.average_deterministic_pass_rate,
            higher_is_better=True,
        )
        self._append_metric_delta(
            improved_metrics=improved_metrics,
            regressed_metrics=regressed_metrics,
            unchanged_metrics=unchanged_metrics,
            metric_name="average_latency_ms",
            baseline_value=baseline.metrics_summary.average_latency_ms,
            current_value=variant.metrics_summary.average_latency_ms,
            higher_is_better=False,
        )
        self._append_metric_delta(
            improved_metrics=improved_metrics,
            regressed_metrics=regressed_metrics,
            unchanged_metrics=unchanged_metrics,
            metric_name="title_exact_match_ratio",
            baseline_value=baseline.stability_summary.title_exact_match_ratio,
            current_value=variant.stability_summary.title_exact_match_ratio,
            higher_is_better=True,
        )
        self._append_metric_delta(
            improved_metrics=improved_metrics,
            regressed_metrics=regressed_metrics,
            unchanged_metrics=unchanged_metrics,
            metric_name="hook_exact_match_ratio",
            baseline_value=baseline.stability_summary.hook_exact_match_ratio,
            current_value=variant.stability_summary.hook_exact_match_ratio,
            higher_is_better=True,
        )
        self._append_metric_delta(
            improved_metrics=improved_metrics,
            regressed_metrics=regressed_metrics,
            unchanged_metrics=unchanged_metrics,
            metric_name="story_qc_score_range",
            baseline_value=baseline.stability_summary.story_qc_score_range,
            current_value=variant.stability_summary.story_qc_score_range,
            higher_is_better=False,
        )
        self._append_metric_delta(
            improved_metrics=improved_metrics,
            regressed_metrics=regressed_metrics,
            unchanged_metrics=unchanged_metrics,
            metric_name="repeat_validation_coverage",
            baseline_value=float(baseline.stability_summary.run_count),
            current_value=float(variant.stability_summary.run_count),
            higher_is_better=True,
        )

        dimension_deltas = self._build_dimension_deltas(
            baseline=baseline,
            candidate=variant,
        )
        improvements = [
            self._summarize_dimension_delta(delta)
            for delta in dimension_deltas
            if delta.direction == "improved"
        ]
        regressions = [
            self._summarize_dimension_delta(delta)
            for delta in dimension_deltas
            if delta.direction == "regressed"
        ]
        unchanged_dimensions = [
            delta.dimension for delta in dimension_deltas if delta.direction == "unchanged"
        ]
        strongest_improvement = self._strongest_dimension_change(
            dimension_deltas,
            direction="improved",
        )
        largest_regression = self._strongest_dimension_change(
            dimension_deltas,
            direction="regressed",
        )
        notable_output_changes = self._build_notable_output_changes(
            variant=variant,
            baseline=baseline,
        )
        side_effects = self._build_variant_side_effects(
            variant=variant,
            regressed_metrics=regressed_metrics,
            regressions=regressions,
        )
        why_better = self._build_why_better(
            variant=variant,
            improved_metrics=improved_metrics,
            improvements=improvements,
            strongest_improvement=strongest_improvement,
        )
        why_worse = self._build_why_worse(
            variant=variant,
            regressed_metrics=regressed_metrics,
            side_effects=side_effects,
            regressions=regressions,
            largest_regression=largest_regression,
        )
        comparison_summary = self._build_variant_decision_summary(
            variant=variant,
            baseline=baseline,
            improved_metrics=improved_metrics,
            regressed_metrics=regressed_metrics,
            improvements=improvements,
            regressions=regressions,
        )
        decision_summary = comparison_summary
        recommended_action = self._build_variant_recommended_action(
            variant=variant,
            improved_metrics=improved_metrics,
            regressed_metrics=regressed_metrics,
            improvements=improvements,
            regressions=regressions,
        )
        return PromptEvaluationVariantExplainability(
            compare_to_case_id=baseline.case_id,
            dimension_deltas=dimension_deltas,
            notable_output_changes=notable_output_changes,
            improved_metrics=improved_metrics,
            regressed_metrics=regressed_metrics,
            unchanged_metrics=unchanged_metrics,
            improvements=improvements,
            regressions=regressions,
            unchanged_dimensions=unchanged_dimensions,
            strongest_improvement=strongest_improvement,
            largest_regression=largest_regression,
            side_effects=side_effects,
            why_better=why_better,
            why_worse=why_worse,
            comparison_summary=comparison_summary,
            decision_summary=decision_summary,
            recommended_action=recommended_action,
            recommendation_reason=decision_summary,
            confidence_note=self._build_variant_confidence_note(
                variant=variant,
                baseline=baseline,
                dimension_deltas=dimension_deltas,
            ),
        )

    def _append_metric_delta(
        self,
        *,
        improved_metrics: list[str],
        regressed_metrics: list[str],
        unchanged_metrics: list[str],
        metric_name: str,
        baseline_value: float,
        current_value: float,
        higher_is_better: bool,
    ) -> None:
        rounded_baseline = round(baseline_value, 3)
        rounded_current = round(current_value, 3)
        if abs(rounded_current - rounded_baseline) <= 0.001:
            unchanged_metrics.append(
                f"{metric_name}: {rounded_baseline:.3f} -> {rounded_current:.3f}"
            )
            return
        improved = rounded_current > rounded_baseline if higher_is_better else rounded_current < rounded_baseline
        target_list = improved_metrics if improved else regressed_metrics
        target_list.append(
            f"{metric_name}: {rounded_baseline:.3f} -> {rounded_current:.3f}"
        )

    def _build_notable_output_changes(
        self,
        *,
        variant: PromptEvaluationVariantResult,
        baseline: PromptEvaluationVariantResult,
    ) -> list[str]:
        changes: list[str] = []
        if variant.prompt_versions != baseline.prompt_versions:
            changes.append(
                "Prompt version changed from "
                f"{', '.join(baseline.prompt_versions)} to {', '.join(variant.prompt_versions)}."
            )
        if variant.generation_strategy_version != baseline.generation_strategy_version:
            changes.append(
                "GenerationStrategy version changed from "
                f"{baseline.generation_strategy_version} to {variant.generation_strategy_version}."
            )
        baseline_sample = baseline.samples[0]
        current_sample = variant.samples[0]
        if current_sample.draft_master_script.title != baseline_sample.draft_master_script.title:
            changes.append(
                "Draft title changed between variants, indicating output wording or planning changed."
            )
        if current_sample.draft_master_script.hook != baseline_sample.draft_master_script.hook:
            changes.append(
                "Hook text changed between variants, indicating the opening prompt behavior shifted."
            )
        if not changes:
            changes.append(
                "No material output field change was detected beyond repeated execution statistics."
            )
        return changes

    def _build_variant_side_effects(
        self,
        *,
        variant: PromptEvaluationVariantResult,
        regressed_metrics: list[str],
        regressions: list[str],
    ) -> list[str]:
        side_effects: list[str] = []
        side_effects.extend(
            f"Regression detected in {metric.split(':', 1)[0]}."
            for metric in regressed_metrics
        )
        side_effects.extend(
            f"Dimension regression: {item}"
            for item in regressions
        )
        if (
            variant.metrics_summary.average_story_qc_score > 0.0
            and any(sample.story_qc_is_placeholder for sample in variant.samples)
        ):
            side_effects.append(
                "Story QC remains placeholder-driven, so Story QC gains cannot yet be treated as final quality proof."
            )
        if (
            variant.metrics_summary.average_script_score
            == variant.samples[0].script_evaluation.score
            and not regressed_metrics
            and variant.explainability.decision_summary
            if False else False
        ):
            pass
        if (
            not regressed_metrics
            and any(
                not check.passed
                for sample in variant.samples
                for check in sample.deterministic_checks
            )
        ):
            side_effects.append(
                "Some content-semantic checks still fail, so the variant is stable but not yet strong on all benchmark expectations."
            )
        return side_effects

    def _build_placeholder_side_effects(
        self,
        variant: PromptEvaluationVariantResult,
    ) -> list[str]:
        side_effects: list[str] = []
        if any(sample.story_qc_is_placeholder for sample in variant.samples):
            side_effects.append(
                "Story QC remains placeholder-driven, so baseline QC numbers are not final quality truth."
            )
        if any(
            not check.passed
            for sample in variant.samples
            for check in sample.deterministic_checks
        ):
            side_effects.append(
                "Baseline still misses some content-semantic checks, which creates room for future prompt optimization."
            )
        return side_effects

    def _build_why_better(
        self,
        *,
        variant: PromptEvaluationVariantResult,
        improved_metrics: list[str],
        improvements: list[str],
        strongest_improvement: str | None,
    ) -> list[str]:
        reasons: list[str] = []
        if any(metric.startswith("average_script_score") for metric in improved_metrics):
            reasons.append(
                "Script rubric score improved, so the variant is producing measurably stronger draft structure."
            )
        if any(metric.startswith("average_deterministic_pass_rate") for metric in improved_metrics):
            reasons.append(
                "More deterministic checks passed, so the variant is following controllable constraints more reliably."
            )
        if any(metric.startswith("average_latency_ms") for metric in improved_metrics):
            reasons.append(
                "Latency improved without changing the controlled pipeline shape, so the same chain now returns faster."
            )
        if any(metric.startswith("repeat_validation_coverage") for metric in improved_metrics):
            reasons.append(
                "This variant was validated across more repeated runs, so we have stronger stability evidence."
            )
        if any(metric.startswith("story_qc_score_range") for metric in improved_metrics):
            reasons.append(
                "Story QC variance narrowed, which suggests more repeatable behavior across runs."
            )
        if improvements:
            reasons.append(
                f"Story QC dimension comparison improved in {len(improvements)} areas, which adds more actionable quality evidence than a single overall score."
            )
        if strongest_improvement is not None:
            reasons.append(
                f"The strongest dimension-level gain is `{strongest_improvement}`, so this variant is not just scoring higher overall but improving a named story quality dimension."
            )
        return reasons

    def _build_why_worse(
        self,
        *,
        variant: PromptEvaluationVariantResult,
        regressed_metrics: list[str],
        side_effects: list[str],
        regressions: list[str],
        largest_regression: str | None,
    ) -> list[str]:
        reasons: list[str] = []
        if not regressed_metrics:
            if regressions:
                reasons.append(
                    "Dimension-level Story QC comparison shows quality regression even when aggregate metrics do not fully capture it."
                )
            return reasons
        if any(metric.startswith("average_script_score") for metric in regressed_metrics):
            reasons.append(
                "Script rubric score dropped, so the variant likely weakened story quality rather than just changing wording."
            )
        if any(metric.startswith("average_deterministic_pass_rate") for metric in regressed_metrics):
            reasons.append(
                "Deterministic pass rate fell, so the variant is following fewer explicit constraints."
            )
        if any(metric.startswith("average_latency_ms") for metric in regressed_metrics):
            reasons.append(
                "Latency increased, so the variant adds execution cost without clear evidence of better output."
            )
        if regressions:
            reasons.append(
                f"Story QC dimension comparison regressed in {len(regressions)} areas, so at least part of the candidate quality loss is visible at the scene-quality dimension level."
            )
        if largest_regression is not None:
            reasons.append(
                f"The largest named regression is `{largest_regression}`, so this is the first dimension to inspect before promoting the variant."
            )
        if not reasons and side_effects:
            reasons.append(
                "The variant introduces side effects or unresolved checks without clear measurable gains."
            )
        return reasons

    def _build_variant_decision_summary(
        self,
        *,
        variant: PromptEvaluationVariantResult,
        baseline: PromptEvaluationVariantResult,
        improved_metrics: list[str],
        regressed_metrics: list[str],
        improvements: list[str],
        regressions: list[str],
    ) -> str:
        if improved_metrics and not regressed_metrics and improvements and not regressions:
            return (
                f"Compared with baseline `{baseline.case_id}`, this variant improves measurable metrics and also improves Story QC dimensions such as "
                f"{', '.join(item.split(':', 1)[0] for item in improvements[:3])} without introducing a tracked dimension regression."
            )
        if improved_metrics and not regressed_metrics:
            return (
                f"Compared with baseline `{baseline.case_id}`, this variant improves "
                f"{len(improved_metrics)} measurable signals without introducing a hard regression."
            )
        if (improved_metrics or improvements) and (regressed_metrics or regressions):
            return (
                f"Compared with baseline `{baseline.case_id}`, this variant improves "
                f"{len(improved_metrics) + len(improvements)} signals but trades them for "
                f"{len(regressed_metrics) + len(regressions)} regressions."
            )
        if regressed_metrics or regressions:
            return (
                f"Compared with baseline `{baseline.case_id}`, this variant does not show compensating gains and currently regresses measurable signals."
            )
        return (
            f"Compared with baseline `{baseline.case_id}`, this variant changes output wording or metadata but does not yet produce a measurable quality shift."
        )

    def _build_variant_recommended_action(
        self,
        *,
        variant: PromptEvaluationVariantResult,
        improved_metrics: list[str],
        regressed_metrics: list[str],
        improvements: list[str],
        regressions: list[str],
    ) -> str:
        del variant
        if (improved_metrics or improvements) and not (regressed_metrics or regressions):
            return "Keep this variant in the next optimization round and use it as a challenger or replacement candidate."
        if (improved_metrics or improvements) and (regressed_metrics or regressions):
            return "Keep this variant for targeted follow-up only if the regressions can be explained and corrected."
        if regressed_metrics or regressions:
            return "Do not promote this variant yet; investigate the regressions before reusing it."
        return "Keep this variant as a neutral comparison point only if its prompt or strategy change is important to future experiments."

    def _build_run_decision_summary(
        self,
        variants: list[PromptEvaluationVariantResult],
    ) -> PromptEvaluationDecisionSummary:
        best_variant = self._select_best_variant(variants)
        improvement_signals = (
            best_variant.explainability.improved_metrics[:]
            + best_variant.explainability.improvements[:]
        )
        regression_signals = sorted(
            {
                signal
                for variant in variants
                for signal in (
                    variant.explainability.regressed_metrics
                    + variant.explainability.regressions
                )
            }
        )
        side_effects = sorted(
            {
                effect
                for variant in variants
                for effect in variant.explainability.side_effects
            }
        )
        next_targets = self._build_next_optimization_targets(best_variant)
        return PromptEvaluationDecisionSummary(
            best_variant_case_id=best_variant.case_id,
            best_variant_reason=self._build_best_variant_reason(best_variant),
            improvement_signals=improvement_signals,
            regression_signals=regression_signals,
            side_effects=side_effects,
            next_optimization_targets=next_targets,
        )

    def _select_best_variant(
        self,
        variants: list[PromptEvaluationVariantResult],
    ) -> PromptEvaluationVariantResult:
        return max(variants, key=self._variant_rank_key)

    def _variant_rank_key(
        self,
        variant: PromptEvaluationVariantResult,
    ) -> tuple[float, float, float, float, int, int, float]:
        return (
            variant.metrics_summary.average_script_score,
            variant.metrics_summary.average_deterministic_pass_rate,
            variant.stability_summary.title_exact_match_ratio
            + variant.stability_summary.hook_exact_match_ratio,
            -variant.stability_summary.story_qc_score_range,
            self._version_rank(variant.generation_strategy_version),
            variant.stability_summary.run_count,
            -variant.metrics_summary.average_latency_ms,
        )

    def _version_rank(self, version: str) -> int:
        normalized = version.strip().lower()
        digits = "".join(character for character in normalized if character.isdigit())
        return int(digits) if digits else 0

    def _build_best_variant_reason(
        self,
        variant: PromptEvaluationVariantResult,
    ) -> str:
        if variant.explainability.improvements:
            strongest = (
                f" Strongest quality gain: `{variant.explainability.strongest_improvement}`."
                if variant.explainability.strongest_improvement
                else ""
            )
            regression_note = (
                f" Main regression to watch: `{variant.explainability.largest_regression}`."
                if variant.explainability.largest_regression
                else ""
            )
            return (
                f"`{variant.case_id}` is the strongest keep candidate because it improves named Story QC dimensions: "
                f"{'; '.join(variant.explainability.improvements[:3])}.{strongest}{regression_note}"
            )
        if variant.explainability.improved_metrics:
            return (
                f"`{variant.case_id}` is the strongest keep candidate because it leads on measurable comparison signals: "
                f"{'; '.join(variant.explainability.improved_metrics[:3])}."
            )
        return (
            f"`{variant.case_id}` is the strongest keep candidate because it preserves baseline quality while offering the best combination of stability evidence and version maturity."
        )

    def _build_next_optimization_targets(
        self,
        best_variant: PromptEvaluationVariantResult,
    ) -> list[str]:
        targets: list[str] = []
        if best_variant.explainability.regressions:
            targets.extend(best_variant.explainability.regressions[:2])
        rubric = best_variant.samples[0].script_evaluation.artifacts.get("rubric", {})
        if isinstance(rubric, dict):
            categories = rubric.get("categories", [])
            if isinstance(categories, list):
                low_categories = sorted(
                    [
                        category
                        for category in categories
                        if isinstance(category, dict)
                    ],
                    key=lambda category: float(category.get("score", 0.0)),
                )
                for category in low_categories[:3]:
                    name = str(category.get("category_name", "")).strip()
                    suggestions = category.get("revision_suggestions", [])
                    if name:
                        if isinstance(suggestions, list) and suggestions:
                            targets.append(f"{name}: {suggestions[0]}")
                        else:
                            targets.append(f"{name}: improve this rubric category in the next prompt iteration.")
        for check in best_variant.samples[0].deterministic_checks:
            if not check.passed:
                mapped = self._map_failed_check_to_target(check.check_name)
                if mapped is not None:
                    targets.append(mapped)
        deduped: list[str] = []
        for target in targets:
            if target not in deduped:
                deduped.append(target)
        return deduped[:5]

    def _annotate_recommended_variants(
        self,
        variants: list[PromptEvaluationVariantResult],
    ) -> list[PromptEvaluationVariantResult]:
        if not variants:
            return variants
        best_variant = self._select_best_variant(variants)
        annotated: list[PromptEvaluationVariantResult] = []
        for variant in variants:
            is_recommended = variant.case_id == best_variant.case_id
            explainability = variant.explainability.model_copy(
                update={
                    "recommended_variant": is_recommended,
                    "recommendation_reason": (
                        self._build_best_variant_reason(variant)
                        if is_recommended
                        else variant.explainability.recommendation_reason
                        or variant.explainability.decision_summary
                    ),
                    "confidence_note": (
                        variant.explainability.confidence_note
                        or self._build_recommendation_confidence_note(
                            variant=variant,
                            best_variant=best_variant,
                        )
                    ),
                }
            )
            annotated.append(variant.model_copy(update={"explainability": explainability}))
        return annotated

    def _build_recommendation_confidence_note(
        self,
        *,
        variant: PromptEvaluationVariantResult,
        best_variant: PromptEvaluationVariantResult,
    ) -> str | None:
        if variant.case_id == best_variant.case_id:
            return variant.explainability.confidence_note
        score_gap = abs(
            best_variant.metrics_summary.average_script_score
            - variant.metrics_summary.average_script_score
        )
        if score_gap <= 0.01:
            return (
                "This variant is close to the current winner on aggregate score, so keep it as a meaningful challenger even if it is not the default recommendation."
            )
        return variant.explainability.confidence_note

    def _unique_strings(self, values: list[str]) -> list[str]:
        ordered: list[str] = []
        seen: set[str] = set()
        for value in values:
            normalized = value.strip()
            if not normalized:
                continue
            lowered = normalized.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            ordered.append(normalized)
        return ordered

    def _map_failed_check_to_target(self, check_name: str) -> str | None:
        mapping = {
            "hook_presence_and_type": "Hook realization: make the hook match the benchmark hook type more explicitly.",
            "cliffhanger_presence_and_type": "Cliffhanger realization: make the ending pressure match the benchmark cliffhanger type more explicitly.",
            "protagonist_agency_visible": "Protagonist agency: add a clearer refusal, choice, reveal, or public move.",
        }
        return mapping.get(check_name)

    def _deterministic_pass_rate(
        self,
        sample: PromptEvaluationSampleResult,
    ) -> float:
        total = len(sample.deterministic_checks)
        if total == 0:
            return 0.0
        passed = sum(1 for check in sample.deterministic_checks if check.passed)
        return round(passed / total, 3)

    def _build_runtime(self) -> "_PromptEvaluationRuntime":
        platform_profile_repository = PlatformProfileRepository()
        ontology_node_repository = OntologyNodeRepository()
        asset_repository = AssetRepository()
        prompt_library_repository = PromptLibraryRepository()
        generation_strategy_repository = GenerationStrategyRepository()
        content_spec_repository = ContentSpecRepository()
        orchestration_plan_repository = OrchestrationPlanRepository()

        platform_profile_service = PlatformProfileService(
            repository=platform_profile_repository
        )
        prompt_library_service = PromptLibraryService(
            repository=prompt_library_repository,
            ontology_node_repository=ontology_node_repository,
        )
        generation_strategy_service = GenerationStrategyService(
            repository=generation_strategy_repository,
            ontology_node_repository=ontology_node_repository,
            prompt_library_repository=prompt_library_repository,
        )
        asset_service = AssetService(
            repository=asset_repository,
            ontology_node_repository=ontology_node_repository,
            platform_profile_repository=platform_profile_repository,
        )

        self._seed_platform_profile(platform_profile_service)
        self._seed_ontology_nodes(ontology_node_repository)
        self._seed_assets(asset_service)
        self._seed_default_prompt_strategy(
            prompt_library_service=prompt_library_service,
            generation_strategy_service=generation_strategy_service,
        )

        data_intelligence_service = DataIntelligenceService(
            content_spec_repository=content_spec_repository,
            platform_profile_repository=platform_profile_repository,
            ontology_node_repository=ontology_node_repository,
        )
        orchestrator_service = OrchestratorService(
            repository=orchestration_plan_repository,
            content_spec_repository=content_spec_repository,
            platform_profile_repository=platform_profile_repository,
        )
        retrieval_service = RetrievalService(
            asset_repository=asset_repository,
            orchestration_plan_repository=orchestration_plan_repository,
        )
        script_generation_service = ScriptGenerationService(
            content_spec_repository=content_spec_repository,
            generation_strategy_repository=generation_strategy_repository,
            platform_profile_repository=platform_profile_repository,
            prompt_retrieval_service=PromptRetrievalService(
                generation_strategy_repository=generation_strategy_repository,
                prompt_library_repository=prompt_library_repository,
            ),
            orchestrator_service=orchestrator_service,
            retrieval_service=retrieval_service,
        )
        return _PromptEvaluationRuntime(
            data_intelligence_service=data_intelligence_service,
            script_generation_service=script_generation_service,
            prompt_library_service=prompt_library_service,
            generation_strategy_service=generation_strategy_service,
            prompt_library_repository=prompt_library_repository,
            generation_strategy_repository=generation_strategy_repository,
        )

    def _seed_platform_profile(self, service: PlatformProfileService) -> None:
        if service.get("tiktok_benchmark_v1") is not None:
            return
        service.create(
            PlatformProfile(
                id="tiktok_benchmark_v1",
                platform_name="TikTok",
                version="v1",
                content_mode="short_video",
                primary_regions=["US"],
                supported_aspect_ratios=["9:16"],
                recommendation_rules=[
                    ProfileRule(
                        code="fast_hook",
                        title="Fast Hook",
                        summary="Open quickly.",
                    )
                ],
                creator_rewards=[
                    ProfileRule(
                        code="retention",
                        title="Retention",
                        summary="Retention matters.",
                    )
                ],
                ai_policies=[
                    ProfileRule(
                        code="ai_disclosure",
                        title="AI Disclosure",
                        summary="Disclose AI use when appropriate.",
                    )
                ],
                community_guidelines=[
                    ProfileRule(
                        code="safety",
                        title="Safety",
                        summary="Avoid harmful content patterns.",
                    )
                ],
                best_practices=[
                    ProfileRule(
                        code="vertical_native",
                        title="Vertical Native",
                        summary="Keep it vertical.",
                    )
                ],
                publishing_strategy=PublishingStrategy(
                    recommended_posts_per_day=2,
                    preferred_time_windows=["12:00-14:00"],
                    notes=["Prompt evaluation seed profile."],
                ),
                metadata={"source": "prompt_evaluation_runner"},
            )
        )

    def _seed_ontology_nodes(self, repository: OntologyNodeRepository) -> None:
        for node_id, label, category, description in (
            ("genre.romance", "Romance", OntologyCategory.genre, "Romance genre."),
            ("genre.drama", "Drama", OntologyCategory.genre, "Drama genre."),
            (
                "genre.supernatural",
                "Supernatural",
                OntologyCategory.genre,
                "Supernatural genre.",
            ),
            ("emotion.revenge", "Revenge", OntologyCategory.emotion, "Revenge emotion."),
            ("hook.fake_marriage", "Fake Marriage", OntologyCategory.hook, "Fake marriage hook."),
            ("theme.werewolf", "Werewolf", OntologyCategory.theme, "Werewolf fantasy theme."),
            ("character.ceo", "CEO", OntologyCategory.character, "CEO power-fantasy archetype."),
        ):
            if repository.get(node_id) is not None:
                continue
            repository.save(
                OntologyNode(
                    id=node_id,
                    label=label,
                    category=category,
                    description=description,
                    aliases=[],
                    is_active=True,
                )
            )

    def _seed_assets(self, service: AssetService) -> None:
        shared_tags = [
            TagRef(
                ontology_node_id="genre.romance",
                label="Romance",
                category="Genre",
                confidence=0.9,
            ),
            TagRef(
                ontology_node_id="genre.drama",
                label="Drama",
                category="Genre",
                confidence=0.88,
            ),
            TagRef(
                ontology_node_id="emotion.revenge",
                label="Revenge",
                category="Emotion",
                confidence=0.92,
            ),
            TagRef(
                ontology_node_id="hook.fake_marriage",
                label="Fake Marriage",
                category="Hook",
                confidence=0.85,
            ),
            TagRef(
                ontology_node_id="theme.werewolf",
                label="Werewolf",
                category="Theme",
                confidence=0.85,
            ),
            TagRef(
                ontology_node_id="character.ceo",
                label="CEO",
                category="Character",
                confidence=0.84,
            ),
            TagRef(
                ontology_node_id="genre.supernatural",
                label="Supernatural",
                category="Genre",
                confidence=0.86,
            ),
        ]
        for asset_id, asset_type, title, summary in (
            (
                "character.lead_pair_benchmark",
                AssetType.character,
                "Lead Pair",
                "Reusable lead pair asset.",
            ),
            (
                "scene.wedding_set_benchmark",
                AssetType.scene,
                "Wedding Set",
                "Reusable wedding reveal scene.",
            ),
            (
                "scene.boardroom_benchmark",
                AssetType.scene,
                "Boardroom Set",
                "Reusable corporate confrontation scene.",
            ),
        ):
            if service.get(asset_id) is not None:
                continue
            service.create(
                Asset(
                    id=asset_id,
                    asset_type=asset_type,
                    title=title,
                    summary=summary,
                    tags=shared_tags,
                    content=AssetContent(
                        text=summary,
                        payload={"source": "prompt_evaluation_runner"},
                    ),
                    applicable_platform_profile_ids=["tiktok_benchmark_v1"],
                    metadata={"source": "prompt_evaluation_runner"},
                    is_active=True,
                )
            )

    def _seed_default_prompt_strategy(
        self,
        *,
        prompt_library_service: PromptLibraryService,
        generation_strategy_service: GenerationStrategyService,
    ) -> None:
        prompt_library_items = [
            PromptLibraryItemCreate(
                id="prompt.story_planning.benchmark.v1",
                name="Benchmark Story Planning Prompt",
                prompt_type=PromptType.story_planning,
                target_module="script_engine",
                applicable_tags=["genre.romance"],
                target_platform="tiktok",
                target_audience="US female 18-34",
                version="v1",
                prompt_template="Plan {content_spec_title} using assets {retrieved_asset_ids}.",
                input_variables=["content_spec_title", "retrieved_asset_ids"],
                output_schema={
                    "type": "object",
                    "properties": {"title": {"type": "string"}, "hook": {"type": "string"}},
                },
                evaluation_notes=[
                    "Benchmark prompt should keep the opening highly specific."
                ],
            ),
            PromptLibraryItemCreate(
                id="prompt.story_planning.benchmark.v2",
                name="Benchmark Story Planning Prompt V2",
                prompt_type=PromptType.story_planning,
                target_module="script_engine",
                applicable_tags=["genre.romance"],
                target_platform="tiktok",
                target_audience="US female 18-34",
                version="v2",
                prompt_template=(
                    "Plan {content_spec_title}. "
                    "Use assets {retrieved_asset_ids}. "
                    "Force a betrayal hook, public reveal escalation and a clean cliffhanger."
                ),
                input_variables=["content_spec_title", "retrieved_asset_ids"],
                output_schema={
                    "type": "object",
                    "properties": {"title": {"type": "string"}, "hook": {"type": "string"}},
                },
                evaluation_notes=[
                    "Benchmark V2 prompt should push public reveal and cliffhanger specificity."
                ],
            ),
        ]
        for prompt_item in prompt_library_items:
            self._safe_create_prompt(prompt_library_service, prompt_item)

        benchmark_strategies = [
            GenerationStrategyCreate(
                id="strategy.tiktok.benchmark.v1",
                name="Benchmark TikTok Strategy",
                target_platform="tiktok",
                target_content_type="ai_comic_drama",
                applicable_tags=["genre.romance"],
                model_provider="mock",
                model_name="mock-script-generator",
                workflow_steps=[
                    {
                        "step_order": 1,
                        "name": "story_planning",
                        "description": "Build the initial story plan.",
                        "prompt_id": "prompt.story_planning.benchmark.v1",
                    }
                ],
                prompt_ids=["prompt.story_planning.benchmark.v1"],
                qc_enabled=True,
                self_check_enabled=True,
                human_review_required=False,
                output_schema={
                    "type": "object",
                    "properties": {"title": {"type": "string"}, "hook": {"type": "string"}},
                },
                version="v1",
                status="active",
            ),
            GenerationStrategyCreate(
                id="strategy.tiktok.benchmark.v2",
                name="Benchmark TikTok Strategy V2",
                target_platform="tiktok",
                target_content_type="ai_comic_drama",
                applicable_tags=["genre.romance"],
                model_provider="mock",
                model_name="mock-script-generator",
                temperature=0.4,
                top_p=0.85,
                max_tokens=3200,
                workflow_steps=[
                    {
                        "step_order": 1,
                        "name": "story_planning",
                        "description": "Build the initial story plan with stronger cliffhanger control.",
                        "prompt_id": "prompt.story_planning.benchmark.v2",
                    }
                ],
                prompt_ids=["prompt.story_planning.benchmark.v2"],
                qc_enabled=True,
                self_check_enabled=True,
                human_review_required=False,
                output_schema={
                    "type": "object",
                    "properties": {"title": {"type": "string"}, "hook": {"type": "string"}},
                },
                version="v2",
                status="active",
            ),
        ]
        for strategy in benchmark_strategies:
            self._safe_create_generation_strategy(
                generation_strategy_service,
                strategy,
            )

    def _safe_create_prompt(
        self,
        service: PromptLibraryService,
        payload: PromptLibraryItemCreate,
    ) -> None:
        if service.get(payload.id) is not None:
            return
        service.create(payload)

    def _safe_create_generation_strategy(
        self,
        service: GenerationStrategyService,
        payload: GenerationStrategyCreate,
    ) -> None:
        if service.get(payload.id) is not None:
            return
        service.create(payload)

    def _has_required_fields(self, draft: DraftMasterScript) -> bool:
        return all(
            [
                bool(draft.title.strip()),
                bool(draft.hook.strip()),
                bool(draft.synopsis.strip()),
                bool(draft.episode_goal.strip()),
                draft.target_duration_seconds >= 5,
                bool(draft.scenes),
            ]
        )

    def _summarize_required_fields(self, draft: DraftMasterScript) -> str:
        return (
            f"title={bool(draft.title.strip())}; "
            f"hook={bool(draft.hook.strip())}; "
            f"synopsis={bool(draft.synopsis.strip())}; "
            f"episode_goal={bool(draft.episode_goal.strip())}; "
            f"scene_count={len(draft.scenes)}"
        )

    def _matches_hook_type(self, hook_text: str, expected_type: str) -> bool:
        normalized_hook = hook_text.lower()
        normalized_type = expected_type.lower()
        keyword_map = {
            "identity reveal": ["i am", "everyone should know", "this wedding is fake", "real name", "secret"],
            "public humiliation": ["everyone", "livestream", "public", "in front of"],
            "betrayal exposure": ["betray", "expose", "confess", "proof"],
        }
        keywords = keyword_map.get(normalized_type)
        if keywords is None:
            return bool(normalized_hook)
        return any(keyword in normalized_hook for keyword in keywords)

    def _matches_cliffhanger_type(
        self,
        *,
        draft: DraftMasterScript,
        expected_type: str,
    ) -> bool:
        ending_signal = self._extract_ending_signal(draft).lower()
        normalized_type = expected_type.lower()
        keyword_map = {
            "public betrayal escalation": [
                "betray",
                "alive",
                "call",
                "speaker",
                "public",
                "livestream",
                "wrong person",
            ],
            "identity reveal": ["real", "secret", "already married"],
        }
        keywords = keyword_map.get(normalized_type)
        if keywords is None:
            return draft.scenes[-1].cliffhanger
        return any(keyword in ending_signal for keyword in keywords)

    def _extract_ending_signal(self, draft: DraftMasterScript) -> str:
        final_scene = draft.scenes[-1]
        parts = [
            final_scene.beat_summary,
            final_scene.turning_point or "",
            draft.next_episode_question or "",
        ]
        if final_scene.dialogues:
            parts.extend(dialogue.text for dialogue in final_scene.dialogues[:2])
        elif final_scene.dialogue_prompts:
            parts.extend(final_scene.dialogue_prompts[:2])
        return " ".join(part for part in parts if part).strip()

    def _has_visible_agency(self, draft: DraftMasterScript) -> bool:
        evidence = self._summarize_agency_evidence(draft).lower()
        active_keywords = [
            "refuse",
            "reject",
            "reveal",
            "expose",
            "choose",
            "demand",
            "confront",
            "turn",
            "press",
            "pull",
            "announce",
        ]
        return any(keyword in evidence for keyword in active_keywords)

    def _summarize_agency_evidence(self, draft: DraftMasterScript) -> str:
        evidence_parts: list[str] = []
        if draft.characters:
            evidence_parts.append(draft.characters[0].name)
        for scene in draft.scenes:
            evidence_parts.extend(scene.character_actions[:3])
            if scene.dialogues:
                evidence_parts.extend(dialogue.text for dialogue in scene.dialogues[:2])
            else:
                evidence_parts.extend(scene.dialogue_prompts[:2])
            evidence_parts.append(scene.beat_summary)
        return " | ".join(part for part in evidence_parts if part)[:380]

    def _extract_estimated_cost(self, llm_raw_output: dict[str, Any]) -> float | None:
        meta = llm_raw_output.get("_meta", {})
        if not isinstance(meta, dict):
            return None
        cost = meta.get("estimated_cost_usd")
        if isinstance(cost, (int, float)):
            return round(float(cost), 6)
        return None

    def _extract_token_usage(
        self,
        llm_raw_output: dict[str, Any],
    ) -> PromptEvaluationTokenUsage | None:
        meta = llm_raw_output.get("_meta", {})
        if not isinstance(meta, dict):
            return None
        usage = meta.get("usage")
        if not isinstance(usage, dict):
            return None
        return PromptEvaluationTokenUsage(
            prompt_tokens=self._coerce_optional_int(usage.get("prompt_tokens")),
            completion_tokens=self._coerce_optional_int(usage.get("completion_tokens")),
            total_tokens=self._coerce_optional_int(usage.get("total_tokens")),
        )

    def _coerce_optional_int(self, value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return None

    def _write_report(
        self,
        *,
        request: PromptEvaluationRunRequest,
        result: PromptEvaluationRunResult,
    ) -> PromptEvaluationReportPaths:
        report_dir = Path(request.report_dir or "examples/prompt_evaluations/reports")
        report_dir.mkdir(parents=True, exist_ok=True)
        json_path = report_dir / f"{request.evaluation_case_id}.json"
        markdown_path = report_dir / f"{request.evaluation_case_id}.md"
        json_path.write_text(
            json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2)
        )
        markdown_path.write_text(self._render_markdown_report(result))
        return PromptEvaluationReportPaths(
            json_path=str(json_path),
            markdown_path=str(markdown_path),
        )

    def _render_markdown_report(self, result: PromptEvaluationRunResult) -> str:
        lines = [
            f"# Prompt Evaluation Report - {result.evaluation_case_id}",
            "",
            f"- Benchmark Dataset: `{result.benchmark_dataset_id}`",
            f"- ContentSpec ID: `{result.content_spec_id}`",
            f"- Overall Pass: `{result.overall_pass}`",
            "",
            "## Overall Decision",
            "",
            f"- Best Variant: `{result.decision_summary.best_variant_case_id}`",
            f"- Why Keep It: {result.decision_summary.best_variant_reason}",
            "",
            "## Notes",
            "",
        ]
        for note in result.placeholder_notes:
            lines.append(f"- {note}")
        if result.decision_summary.improvement_signals:
            lines.extend(["", "### Improvement Signals", ""])
            for signal in result.decision_summary.improvement_signals:
                lines.append(f"- {signal}")
        if result.decision_summary.regression_signals:
            lines.extend(["", "### Regression Signals", ""])
            for signal in result.decision_summary.regression_signals:
                lines.append(f"- {signal}")
        if result.decision_summary.side_effects:
            lines.extend(["", "### Side Effects", ""])
            for effect in result.decision_summary.side_effects:
                lines.append(f"- {effect}")
        if result.decision_summary.next_optimization_targets:
            lines.extend(["", "### Next Optimization Targets", ""])
            for target in result.decision_summary.next_optimization_targets:
                lines.append(f"- {target}")
        for variant in result.variants:
            lines.extend(
                [
                    "",
                    f"## Variant `{variant.case_id}`",
                    "",
                    f"- Prompt IDs: {', '.join(variant.prompt_ids)}",
                    f"- Prompt Versions: {', '.join(variant.prompt_versions) if variant.prompt_versions else 'n/a'}",
                    f"- GenerationStrategy: `{variant.generation_strategy_id}` ({variant.generation_strategy_version})",
                    f"- Pass: `{variant.pass_fail}`",
                    f"- Decision: {variant.explainability.decision_summary}",
                    f"- Recommended Action: {variant.explainability.recommended_action}",
                    f"- Recommended Variant: `{variant.explainability.recommended_variant}`",
                    f"- Metrics: script={variant.metrics_summary.average_script_score:.3f}, "
                    f"deterministic={variant.metrics_summary.average_deterministic_pass_rate:.3f}, "
                    f"story_qc={variant.metrics_summary.average_story_qc_score:.3f}, "
                    f"latency={variant.metrics_summary.average_latency_ms:.3f} ms",
                    f"- Stability: title={variant.stability_summary.title_exact_match_ratio:.3f}, "
                    f"hook={variant.stability_summary.hook_exact_match_ratio:.3f}, "
                    f"story_qc_range={variant.stability_summary.story_qc_score_range:.3f}",
                ]
            )
            if variant.failure_reasons:
                lines.append(f"- Failure Reasons: {', '.join(variant.failure_reasons)}")
            if variant.explainability.compare_to_case_id is not None:
                lines.append(f"- Compared To: `{variant.explainability.compare_to_case_id}`")
            if variant.explainability.recommendation_reason:
                lines.append(f"- Recommendation Reason: {variant.explainability.recommendation_reason}")
            if variant.explainability.confidence_note:
                lines.append(f"- Confidence Note: {variant.explainability.confidence_note}")
            if variant.explainability.notable_output_changes:
                lines.extend(["", "### Explainability", ""])
                lines.append("#### Notable Output Changes")
                lines.append("")
                for item in variant.explainability.notable_output_changes:
                    lines.append(f"- {item}")
            if variant.explainability.dimension_deltas:
                lines.extend(["", "#### Story QC Dimension Deltas", ""])
                for item in variant.explainability.dimension_deltas:
                    delta_value = (
                        f"{item.delta:+.3f}" if item.delta is not None else "n/a"
                    )
                    baseline_value = (
                        f"{item.baseline_score:.3f}"
                        if item.baseline_score is not None
                        else "n/a"
                    )
                    candidate_value = (
                        f"{item.candidate_score:.3f}"
                        if item.candidate_score is not None
                        else "n/a"
                    )
                    lines.append(
                        f"- `{item.dimension}`: {baseline_value} -> {candidate_value} ({delta_value}, {item.direction})"
                    )
                    if item.candidate_summary:
                        lines.append(f"  Summary: {item.candidate_summary}")
                    if item.scene_refs:
                        lines.append(
                            f"  Scene Refs: {', '.join(str(scene) for scene in item.scene_refs)}"
                        )
                    if item.evidence:
                        lines.append(f"  Evidence: {item.evidence[0]}")
            if variant.explainability.improved_metrics:
                lines.extend(["", "#### Improved Metrics", ""])
                for metric in variant.explainability.improved_metrics:
                    lines.append(f"- {metric}")
            if variant.explainability.regressed_metrics:
                lines.extend(["", "#### Regressed Metrics", ""])
                for metric in variant.explainability.regressed_metrics:
                    lines.append(f"- {metric}")
            if variant.explainability.improvements:
                lines.extend(["", "#### Improved Dimensions", ""])
                for item in variant.explainability.improvements:
                    lines.append(f"- {item}")
            if variant.explainability.regressions:
                lines.extend(["", "#### Regressed Dimensions", ""])
                for item in variant.explainability.regressions:
                    lines.append(f"- {item}")
            if variant.explainability.unchanged_dimensions:
                lines.extend(["", "#### Unchanged Dimensions", ""])
                for item in variant.explainability.unchanged_dimensions:
                    lines.append(f"- {item}")
            if variant.explainability.side_effects:
                lines.extend(["", "#### Side Effects", ""])
                for item in variant.explainability.side_effects:
                    lines.append(f"- {item}")
            if variant.explainability.why_better:
                lines.extend(["", "#### Why Better", ""])
                for item in variant.explainability.why_better:
                    lines.append(f"- {item}")
            if variant.explainability.why_worse:
                lines.extend(["", "#### Why Worse", ""])
                for item in variant.explainability.why_worse:
                    lines.append(f"- {item}")
            for sample in variant.samples:
                lines.extend(
                    [
                        "",
                        f"### Run {sample.run_index}",
                        "",
                        f"- Draft ID: `{sample.artifact_ids.draft_master_script_id}`",
                        f"- Model: `{sample.llm_model_info.provider}` / `{sample.llm_model_info.model_name}`",
                        f"- Latency: `{sample.latency_ms} ms`",
                        f"- Story QC: `{sample.story_qc_score}` ({sample.story_qc_status})",
                        f"- Script Score: `{sample.script_evaluation.score}`",
                        f"- Title: {sample.draft_master_script.title}",
                        f"- Hook: {sample.draft_master_script.hook}",
                        "",
                        "#### Deterministic Checks",
                        "",
                    ]
                )
                for check in sample.deterministic_checks:
                    lines.append(
                        f"- `{check.check_name}`: `{check.passed}` | expected: {check.expected} | actual: {check.actual}"
                    )
                if sample.story_qc_dimensions:
                    lines.extend(["", "#### Story QC Dimensions", ""])
                    for dimension in sample.story_qc_dimensions:
                        score_value = (
                            f"{dimension.score:.3f}"
                            if dimension.score is not None
                            else "n/a"
                        )
                        lines.append(
                            f"- `{dimension.dimension}`: score={score_value} | summary={dimension.summary or 'n/a'}"
                        )
        lines.append("")
        return "\n".join(lines)


class PromptEvaluationService:
    def __init__(
        self,
        *,
        runner: PromptEvaluationRunner,
        repository: PromptEvaluationResultRepository,
    ) -> None:
        self._runner = runner
        self._repository = repository

    def run(self, request: PromptEvaluationRunRequest) -> PromptEvaluationRunResult:
        result = self._runner.run(request)
        return self._repository.save(result)

    def list_results(self) -> list[PromptEvaluationRunResult]:
        return self._repository.list()

    def get_result(self, result_id: str) -> PromptEvaluationRunResult | None:
        return self._repository.get(result_id)


class _PromptEvaluationRuntime:
    def __init__(
        self,
        *,
        data_intelligence_service: DataIntelligenceService,
        script_generation_service: ScriptGenerationService,
        prompt_library_service: PromptLibraryService,
        generation_strategy_service: GenerationStrategyService,
        prompt_library_repository: PromptLibraryRepository,
        generation_strategy_repository: GenerationStrategyRepository,
    ) -> None:
        self.data_intelligence_service = data_intelligence_service
        self.script_generation_service = script_generation_service
        self.prompt_library_service = prompt_library_service
        self.generation_strategy_service = generation_strategy_service
        self.prompt_library_repository = prompt_library_repository
        self.generation_strategy_repository = generation_strategy_repository

    def ensure_prompt_item(self, payload: PromptLibraryItemCreate) -> None:
        if self.prompt_library_repository.get(payload.id) is not None:
            return
        self.prompt_library_service.create(payload)

    def ensure_generation_strategy(self, payload: GenerationStrategyCreate) -> None:
        if self.generation_strategy_repository.get(payload.id) is not None:
            return
        self.generation_strategy_service.create(payload)
