from __future__ import annotations

import json
from pathlib import Path

from app.modules.asset.models import Asset, AssetContent, AssetType
from app.modules.asset.repository import AssetRepository
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.content_spec.models import TagRef
from app.modules.data_intelligence.service import DataIntelligenceService
from app.modules.master_script.repository import MasterScriptRepository
from app.modules.master_script.models import MasterScriptFinalizeRequest
from app.modules.master_script.service import MasterScriptService
from app.modules.ontology_node.models import OntologyCategory, OntologyNode
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.orchestrator.repository import OrchestrationPlanRepository
from app.modules.orchestrator.service import OrchestratorService
from app.modules.platform_profile.models import PlatformProfile, ProfileRule, PublishingStrategy
from app.modules.platform_profile.repository import PlatformProfileRepository
from app.modules.retrieval.service import RetrievalService
from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.models import (
    GenerationStrategy,
    GenerationStrategyStatus,
    GenerationWorkflowStep,
    PromptLibraryItem,
    PromptType,
    ScriptGenerationDraftRequest,
    ScriptRevisionRequest,
)
from app.modules.script_engine.prompt_retrieval import PromptRetrievalService
from app.modules.script_engine.repository import (
    GenerationStrategyRepository,
    PromptLibraryRepository,
)
from app.modules.script_engine.revision_service import ScriptRevisionService
from evaluation.analysis_evaluation import AnalysisEvaluator
from evaluation.content_spec_evaluation import ContentSpecEvaluator
from evaluation.models import (
    BenchmarkDatasetType,
    BenchmarkHighlights,
    BenchmarkRunRequest,
    BenchmarkRunResult,
    BenchmarkRevisionSummary,
    BenchmarkScenario,
    BenchmarkScoreSummary,
)
from evaluation.prompt_evaluation import PromptEvaluator
from evaluation.script_evaluation import ScriptEvaluator
from evaluation.story_qc_evaluation import StoryQCEvaluator


class MissingBenchmarkDatasetError(ValueError):
    """Raised when a requested benchmark dataset file cannot be found."""


class BenchmarkResultRepository:
    def __init__(self) -> None:
        self._items: dict[str, BenchmarkRunResult] = {}

    def save(self, result: BenchmarkRunResult) -> BenchmarkRunResult:
        self._items[result.id] = result
        return result

    def get(self, result_id: str) -> BenchmarkRunResult | None:
        return self._items.get(result_id)

    def list(self) -> list[BenchmarkRunResult]:
        return list(self._items.values())


class BenchmarkRunner:
    def __init__(self, *, dataset_root: str = "datasets") -> None:
        self._dataset_root = Path(dataset_root)
        self._analysis_evaluator = AnalysisEvaluator()
        self._content_spec_evaluator = ContentSpecEvaluator()
        self._prompt_evaluator = PromptEvaluator()
        self._script_evaluator = ScriptEvaluator()
        self._story_qc_evaluator = StoryQCEvaluator()

    def load_scenario(
        self,
        *,
        dataset_id: str,
        dataset_type: BenchmarkDatasetType,
    ) -> BenchmarkScenario:
        dataset_path = self._dataset_root / dataset_type.value / f"{dataset_id}.json"
        if not dataset_path.exists():
            raise MissingBenchmarkDatasetError(
                f"Benchmark dataset '{dataset_id}' was not found in '{dataset_type.value}'."
            )
        return BenchmarkScenario.model_validate(json.loads(dataset_path.read_text()))

    def run(self, scenario: BenchmarkScenario) -> BenchmarkRunResult:
        (
            data_intelligence_service,
            script_generation_service,
            script_revision_service,
            master_script_service,
        ) = self._build_services()
        pipeline_response = data_intelligence_service.run_records_pipeline(
            scenario.records,
            platform_profile_id="tiktok_benchmark_v1",
            audience_hint=scenario.audience_hint,
            commercial_objective=scenario.commercial_objective,
        )
        draft_run = script_generation_service.generate_draft(
            ScriptGenerationDraftRequest(
                content_spec_id=pipeline_response.content_spec.id,
                generation_strategy_id="strategy.tiktok.benchmark.v1",
                output_language=scenario.records[0].language,
                desired_scene_count=3,
            )
        )
        revision_run = script_revision_service.revise(
            ScriptRevisionRequest(
                draft_master_script=draft_run.draft_master_script,
                revision_plan=draft_run.revision_plan,
            )
        )
        finalization = master_script_service.create_from_draft(
            MasterScriptFinalizeRequest(
                script_generation_draft_run=draft_run,
                script_revision_run=revision_run,
                dialogue_line_count_per_scene=2,
                speaker_name_cycle=["Lead One", "Lead Two"],
            )
        )
        aggregated_topics = self._aggregate_topic_labels(pipeline_response.analysis_results)
        aggregated_genre_tags = self._aggregate_tag_ids(
            pipeline_response.analysis_results, category="Genre"
        )
        aggregated_emotion_tags = self._aggregate_tag_ids(
            pipeline_response.analysis_results, category="Emotion"
        )
        top_analysis = pipeline_response.analysis_results[0]

        analysis_evaluation = self._analysis_evaluator.evaluate(
            benchmark=scenario,
            aggregated_topics=aggregated_topics,
            aggregated_genre_tags=aggregated_genre_tags,
            aggregated_emotion_tags=aggregated_emotion_tags,
            preference_score=top_analysis.preference_score,
            audience_signal_summary=top_analysis.audience_signal_summary,
            commercial_signal_summary=top_analysis.commercial_signal_summary,
            recommended_hook_type=top_analysis.recommended_hook_type,
            recommended_cliffhanger_type=top_analysis.recommended_cliffhanger_type,
        )
        content_spec_evaluation = self._content_spec_evaluator.evaluate(
            benchmark=scenario,
            content_spec=pipeline_response.content_spec,
        )
        prompt_evaluation = self._prompt_evaluator.evaluate(draft_run.prompt_build_result)
        draft_script_evaluation = self._script_evaluator.evaluate(
            draft_run.draft_master_script.model_dump(),
            stage="draft",
        )
        story_qc_evaluation = self._story_qc_evaluator.evaluate(draft_run.story_qc_report)
        revised_draft_script_evaluation = self._script_evaluator.evaluate(
            revision_run.revised_draft_master_script.model_dump(),
            stage="revised_draft",
        )
        revised_story_qc_evaluation = self._story_qc_evaluator.evaluate(
            revision_run.revised_story_qc_report
        )
        final_script_evaluation = self._script_evaluator.evaluate(
            finalization.master_script.model_dump(),
            stage="final",
        )
        revision_improves_over_draft = (
            revised_draft_script_evaluation.score >= draft_script_evaluation.score
            and revision_run.revised_story_qc_report.overall_score
            >= revision_run.original_story_qc_report.overall_score
        )
        final_improves_over_draft = (
            final_script_evaluation.score >= draft_script_evaluation.score
        )
        final_improves_over_revised_draft = (
            final_script_evaluation.score >= revised_draft_script_evaluation.score
        )
        score_summary = self._build_score_summary(
            draft_script_score=draft_script_evaluation.score,
            draft_story_qc_score=draft_run.story_qc_report.overall_score,
            revised_draft_script_score=revised_draft_script_evaluation.score,
            revised_story_qc_score=revision_run.revised_story_qc_report.overall_score,
            final_script_score=final_script_evaluation.score,
        )
        revision_summary = self._build_revision_summary(revision_run)
        highlights = self._build_highlights(
            benchmark_id=scenario.benchmark_id,
            score_summary=score_summary,
            revision_summary=revision_summary,
            revision_improves_over_draft=revision_improves_over_draft,
            final_improves_over_draft=final_improves_over_draft,
            final_improves_over_revised_draft=final_improves_over_revised_draft,
        )
        success = all(
            component.passed
            for component in [
                analysis_evaluation,
                content_spec_evaluation,
                prompt_evaluation,
                draft_script_evaluation,
                story_qc_evaluation,
                revised_draft_script_evaluation,
                revised_story_qc_evaluation,
                final_script_evaluation,
            ]
        ) and revision_improves_over_draft and final_improves_over_draft and final_improves_over_revised_draft
        return BenchmarkRunResult(
            benchmark_id=scenario.benchmark_id,
            dataset_type=scenario.dataset_type,
            analysis_evaluation=analysis_evaluation,
            content_spec_evaluation=content_spec_evaluation,
            prompt_evaluation=prompt_evaluation,
            draft_script_evaluation=draft_script_evaluation,
            story_qc_evaluation=story_qc_evaluation,
            revised_draft_script_evaluation=revised_draft_script_evaluation,
            revised_story_qc_evaluation=revised_story_qc_evaluation,
            final_script_evaluation=final_script_evaluation,
            draft_master_script=draft_run.draft_master_script,
            revised_draft_master_script=revision_run.revised_draft_master_script,
            final_master_script=finalization.master_script,
            prompt_build_result=draft_run.prompt_build_result,
            story_qc_report=draft_run.story_qc_report,
            revised_story_qc_report=revision_run.revised_story_qc_report,
            revision_plan=draft_run.revision_plan,
            script_revision_run=revision_run,
            score_summary=score_summary,
            revision_summary=revision_summary,
            highlights=highlights,
            revision_improves_over_draft=revision_improves_over_draft,
            final_improves_over_draft=final_improves_over_draft,
            final_improves_over_revised_draft=final_improves_over_revised_draft,
            success=success,
        )

    def _build_services(
        self,
    ) -> tuple[
        DataIntelligenceService,
        ScriptGenerationService,
        ScriptRevisionService,
        MasterScriptService,
    ]:
        platform_profile_repository = PlatformProfileRepository()
        ontology_node_repository = OntologyNodeRepository()
        content_spec_repository = ContentSpecRepository()
        asset_repository = AssetRepository()
        orchestration_plan_repository = OrchestrationPlanRepository()
        prompt_library_repository = PromptLibraryRepository()
        generation_strategy_repository = GenerationStrategyRepository()
        master_script_repository = MasterScriptRepository()

        self._seed_platform_profile(platform_profile_repository)
        self._seed_ontology_nodes(ontology_node_repository)
        self._seed_assets(asset_repository)
        self._seed_prompt_strategy(
            prompt_library_repository=prompt_library_repository,
            generation_strategy_repository=generation_strategy_repository,
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
        script_revision_service = ScriptRevisionService(
            generation_strategy_repository=generation_strategy_repository,
        )
        master_script_service = MasterScriptService(
            repository=master_script_repository,
            content_spec_repository=content_spec_repository,
        )
        return (
            data_intelligence_service,
            script_generation_service,
            script_revision_service,
            master_script_service,
        )

    def _seed_platform_profile(
        self,
        repository: PlatformProfileRepository,
    ) -> None:
        repository.save(
            PlatformProfile(
                id="tiktok_benchmark_v1",
                platform_name="TikTok",
                version="v1",
                content_mode="short_video",
                primary_regions=["US"],
                supported_aspect_ratios=["9:16"],
                recommendation_rules=[ProfileRule(code="fast_hook", title="Fast Hook", summary="Open quickly.")],
                creator_rewards=[ProfileRule(code="retention", title="Retention", summary="Retention matters.")],
                ai_policies=[ProfileRule(code="ai_disclosure", title="AI Disclosure", summary="Disclose AI use when appropriate.")],
                community_guidelines=[ProfileRule(code="safety", title="Safety", summary="Avoid harmful content patterns.")],
                best_practices=[ProfileRule(code="vertical_native", title="Vertical Native", summary="Keep it vertical.")],
                publishing_strategy=PublishingStrategy(
                    recommended_posts_per_day=2,
                    preferred_time_windows=["12:00-14:00"],
                    notes=["Benchmark seed profile."],
                ),
                metadata={"source": "benchmark_runner"},
            )
        )

    def _seed_ontology_nodes(self, repository: OntologyNodeRepository) -> None:
        for node_id, label, category, description in (
            ("genre.romance", "Romance", OntologyCategory.genre, "Romance genre."),
            ("genre.drama", "Drama", OntologyCategory.genre, "Drama genre."),
            ("genre.supernatural", "Supernatural", OntologyCategory.genre, "Supernatural genre."),
            ("emotion.revenge", "Revenge", OntologyCategory.emotion, "Revenge emotion."),
            ("hook.fake_marriage", "Fake Marriage", OntologyCategory.hook, "Fake marriage hook."),
            ("theme.werewolf", "Werewolf", OntologyCategory.theme, "Werewolf fantasy theme."),
            ("character.ceo", "CEO", OntologyCategory.character, "CEO power-fantasy archetype."),
        ):
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

    def _seed_assets(self, repository: AssetRepository) -> None:
        shared_tags = [
            TagRef(ontology_node_id="genre.romance", label="Romance", category="Genre", confidence=0.9),
            TagRef(ontology_node_id="genre.drama", label="Drama", category="Genre", confidence=0.88),
            TagRef(ontology_node_id="emotion.revenge", label="Revenge", category="Emotion", confidence=0.92),
            TagRef(ontology_node_id="hook.fake_marriage", label="Fake Marriage", category="Hook", confidence=0.85),
            TagRef(ontology_node_id="theme.werewolf", label="Werewolf", category="Theme", confidence=0.85),
            TagRef(ontology_node_id="character.ceo", label="CEO", category="Character", confidence=0.84),
            TagRef(ontology_node_id="genre.supernatural", label="Supernatural", category="Genre", confidence=0.86),
        ]
        for asset_id, asset_type, title, summary in (
            ("character.lead_pair_benchmark", AssetType.character, "Lead Pair", "Reusable lead pair asset."),
            ("scene.wedding_set_benchmark", AssetType.scene, "Wedding Set", "Reusable wedding reveal scene."),
            ("scene.boardroom_benchmark", AssetType.scene, "Boardroom Set", "Reusable corporate confrontation scene."),
        ):
            repository.save(
                Asset(
                    id=asset_id,
                    asset_type=asset_type,
                    title=title,
                    summary=summary,
                    tags=shared_tags,
                    content=AssetContent(text=summary, payload={"source": "benchmark_runner"}),
                    applicable_platform_profile_ids=["tiktok_benchmark_v1"],
                    metadata={"source": "benchmark_runner"},
                    is_active=True,
                )
            )

    def _seed_prompt_strategy(
        self,
        *,
        prompt_library_repository: PromptLibraryRepository,
        generation_strategy_repository: GenerationStrategyRepository,
    ) -> None:
        prompt_library_repository.save(
            PromptLibraryItem(
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
                evaluation_notes=["Benchmark prompt should keep the opening highly specific."],
            )
        )
        generation_strategy_repository.save(
            GenerationStrategy(
                id="strategy.tiktok.benchmark.v1",
                name="Benchmark TikTok Strategy",
                target_platform="tiktok",
                target_content_type="ai_comic_drama",
                applicable_tags=["genre.romance"],
                model_provider="mock",
                model_name="mock-script-generator",
                workflow_steps=[
                    GenerationWorkflowStep(
                        step_order=1,
                        name="story_planning",
                        description="Build the initial story plan.",
                        prompt_id="prompt.story_planning.benchmark.v1",
                    )
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
                status=GenerationStrategyStatus.active,
            )
        )

    def _aggregate_topic_labels(self, analysis_results: list) -> list[str]:
        topics: list[str] = []
        for result in analysis_results:
            for topic in result.topic_labels:
                if topic not in topics:
                    topics.append(topic)
        return topics

    def _aggregate_tag_ids(self, analysis_results: list, *, category: str) -> list[str]:
        tag_ids: list[str] = []
        for result in analysis_results:
            for tag in result.mapped_tags:
                if tag.category == category and tag.ontology_node_id not in tag_ids:
                    tag_ids.append(tag.ontology_node_id)
        return tag_ids

    def _build_score_summary(
        self,
        *,
        draft_script_score: float,
        draft_story_qc_score: float,
        revised_draft_script_score: float,
        revised_story_qc_score: float,
        final_script_score: float,
    ) -> BenchmarkScoreSummary:
        return BenchmarkScoreSummary(
            draft_script_score=draft_script_score,
            draft_story_qc_score=draft_story_qc_score,
            revised_draft_script_score=revised_draft_script_score,
            revised_story_qc_score=revised_story_qc_score,
            final_script_score=final_script_score,
            revision_script_gain=round(revised_draft_script_score - draft_script_score, 3),
            revision_qc_gain=round(revised_story_qc_score - draft_story_qc_score, 3),
            final_gain_over_draft=round(final_script_score - draft_script_score, 3),
            final_gain_over_revised_draft=round(
                final_script_score - revised_draft_script_score,
                3,
            ),
        )

    def _build_revision_summary(self, revision_run) -> BenchmarkRevisionSummary:
        target_types: list[str] = []
        for action in revision_run.revision_plan.actions:
            target_type = action.target_type.value
            if target_type not in target_types:
                target_types.append(target_type)
        return BenchmarkRevisionSummary(
            action_count=len(revision_run.applied_action_ids),
            applied_action_ids=revision_run.applied_action_ids,
            dominant_target_types=target_types[:3],
            improved=revision_run.improved,
            notes=revision_run.improvement_summary[:],
        )

    def _build_highlights(
        self,
        *,
        benchmark_id: str,
        score_summary: BenchmarkScoreSummary,
        revision_summary: BenchmarkRevisionSummary,
        revision_improves_over_draft: bool,
        final_improves_over_draft: bool,
        final_improves_over_revised_draft: bool,
    ) -> BenchmarkHighlights:
        stage_gains = {
            "revision_script_gain": score_summary.revision_script_gain,
            "revision_qc_gain": score_summary.revision_qc_gain,
            "final_gain_over_draft": score_summary.final_gain_over_draft,
            "final_gain_over_revised_draft": score_summary.final_gain_over_revised_draft,
        }
        strongest_gain_stage = max(stage_gains, key=stage_gains.get)
        pass_flags: list[str] = []
        warnings: list[str] = []
        if revision_improves_over_draft:
            pass_flags.append("revision_improves_over_draft")
        else:
            warnings.append("revision_improvement_missed")
        if final_improves_over_draft:
            pass_flags.append("final_improves_over_draft")
        else:
            warnings.append("final_gain_over_draft_missed")
        if final_improves_over_revised_draft:
            pass_flags.append("final_improves_over_revised_draft")
        else:
            warnings.append("final_gain_over_revised_draft_missed")
        if not revision_summary.applied_action_ids:
            warnings.append("no_revision_actions_applied")

        headline = (
            f"Benchmark '{benchmark_id}' revision stage "
            f"{'improved' if revision_summary.improved else 'did not improve'} the draft; "
            f"final script score is {score_summary.final_script_score:.3f}."
        )
        return BenchmarkHighlights(
            headline=headline,
            strongest_gain_stage=strongest_gain_stage,
            pass_flags=pass_flags,
            warnings=warnings,
        )


class BenchmarkService:
    def __init__(
        self,
        *,
        runner: BenchmarkRunner,
        repository: BenchmarkResultRepository,
    ) -> None:
        self._runner = runner
        self._repository = repository

    def run(self, request: BenchmarkRunRequest) -> BenchmarkRunResult:
        scenario = self._runner.load_scenario(
            dataset_id=request.dataset_id,
            dataset_type=request.dataset_type,
        )
        result = self._runner.run(scenario)
        return self._repository.save(result)

    def list_results(self) -> list[BenchmarkRunResult]:
        return self._repository.list()

    def get_result(self, result_id: str) -> BenchmarkRunResult | None:
        return self._repository.get(result_id)
