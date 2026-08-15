import os
from functools import lru_cache

from fastapi import HTTPException, status

from app.database import (
    DatabaseConfigurationError,
    DatabaseRuntime,
    create_database_runtime,
    database_url_from_env,
)
from app.llm_runtime import (
    build_creative_llm_adapter_from_env,
    build_continuity_llm_adapter_from_env,
    build_dialogue_polish_adapter_from_env,
    build_episode_plan_llm_adapter_from_env,
    build_llm_adapter_from_env,
    build_planning_llm_adapter_from_env,
    build_script_generation_adapter_from_env,
    build_script_editor_llm_adapter_from_env,
    build_script_repair_llm_adapter_from_env,
    build_story_architect_llm_adapter_from_env,
    build_story_bible_llm_adapter_from_env,
)
from app.modules.asset.repository import AssetRepository
from app.modules.asset.service import AssetService
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.content_spec.service import ContentSpecService
from app.modules.data_intelligence.service import DataIntelligenceService
from app.modules.master_script.repository import MasterScriptRepository
from app.modules.master_script.service import MasterScriptService
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.ontology_node.service import OntologyNodeService
from app.modules.orchestrator.repository import OrchestrationPlanRepository
from app.modules.orchestrator.service import OrchestratorService
from app.modules.platform_profile.repository import PlatformProfileRepository
from app.modules.platform_profile.service import PlatformProfileService
from app.modules.retrieval.service import RetrievalService
from app.modules.scheduled_ingestion.dedup_repository import IngestionDedupRepository
from app.modules.scheduled_ingestion.history_repository import DataIngestionRunHistoryRepository
from app.modules.scheduled_ingestion.repository import DataIngestionJobRepository
from app.modules.scheduled_ingestion.service import ScheduledIngestionService
from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.llm_adapter import (
    FailingLLMAdapter,
    MissingLLMConfigurationError,
)
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.story_planning_service import StoryPlanningService
from app.modules.script_engine.bilingual_view import BilingualScriptViewService
from app.modules.script_engine.prompt_retrieval import PromptRetrievalService
from app.modules.script_engine.revision_planner import RubricRevisionPlanner
from app.modules.script_engine.revision_service import ScriptRevisionService
from app.modules.script_engine.repository import (
    GenerationStrategyRepository,
    PromptLibraryRepository,
)
from app.modules.script_engine.service import (
    GenerationStrategyService,
    PromptLibraryService,
)
from app.modules.trend_snapshot.repository import TrendSnapshotRepository
from app.modules.trend_snapshot.service import TrendSnapshotService
from evaluation.benchmark_runner import (
    BenchmarkResultRepository,
    BenchmarkRunner,
    BenchmarkService,
)
from evaluation.prompt_evaluation_runner import (
    PromptEvaluationResultRepository,
    PromptEvaluationRunner,
    PromptEvaluationService,
)

platform_profile_repository = PlatformProfileRepository()
ontology_node_repository = OntologyNodeRepository()
asset_repository = AssetRepository()
prompt_library_repository = PromptLibraryRepository()
generation_strategy_repository = GenerationStrategyRepository()
content_spec_repository = ContentSpecRepository(
    database_runtime_factory=lambda: _optional_content_spec_database_runtime()
)
master_script_repository = MasterScriptRepository()
orchestration_plan_repository = OrchestrationPlanRepository()
data_ingestion_job_repository = DataIngestionJobRepository()
data_ingestion_run_history_repository = DataIngestionRunHistoryRepository()
ingestion_dedup_repository = IngestionDedupRepository()
trend_snapshot_repository = TrendSnapshotRepository()
benchmark_result_repository = BenchmarkResultRepository()
benchmark_runner = BenchmarkRunner()
prompt_evaluation_result_repository = PromptEvaluationResultRepository()
prompt_evaluation_runner = PromptEvaluationRunner()


def _llm_service_cache_key() -> tuple[tuple[str, str], ...]:
    """Share model pools until the process environment actually changes."""

    return tuple(
        sorted(
            (name, value)
            for name, value in os.environ.items()
            if name.startswith("LLM_")
            or name
            in {
                "SCRIPT_CREATIVE_DEEPENING_ENABLED",
                "SCRIPT_GPT_POST_EDIT_ENABLED",
            }
        )
    )


@lru_cache(maxsize=1)
def get_long_story_database_runtime() -> DatabaseRuntime:
    database_url = database_url_from_env()
    if database_url is None:
        raise DatabaseConfigurationError(
            "DATABASE_URL is required for durable PostgreSQL persistence."
        )
    return create_database_runtime(database_url)


def _optional_content_spec_database_runtime() -> DatabaseRuntime | None:
    try:
        return get_long_story_database_runtime()
    except DatabaseConfigurationError:
        return None


def get_long_story_service() -> LongStoryService:
    try:
        runtime = get_long_story_database_runtime()
    except DatabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return LongStoryService(runtime)


def get_story_planning_service() -> StoryPlanningService:
    return _get_story_planning_service(_llm_service_cache_key())


@lru_cache(maxsize=8)
def _get_story_planning_service(
    _cache_key: tuple[tuple[str, str], ...],
) -> StoryPlanningService:
    try:
        llm_adapter = build_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        llm_adapter = FailingLLMAdapter(exc)
    try:
        decomposition_llm_adapter = build_planning_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        decomposition_llm_adapter = FailingLLMAdapter(exc)
    try:
        creative_llm_adapter = build_creative_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        creative_llm_adapter = FailingLLMAdapter(exc)
    try:
        story_bible_llm_adapter = build_story_bible_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        story_bible_llm_adapter = FailingLLMAdapter(exc)
    try:
        story_architect_llm_adapter = build_story_architect_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        story_architect_llm_adapter = FailingLLMAdapter(exc)
    try:
        episode_plan_llm_adapter = build_episode_plan_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        episode_plan_llm_adapter = FailingLLMAdapter(exc)
    return StoryPlanningService(
        long_story_service=get_long_story_service(),
        content_spec_repository=content_spec_repository,
        generation_strategy_repository=generation_strategy_repository,
        llm_adapter=llm_adapter,
        decomposition_llm_adapter=decomposition_llm_adapter,
        creative_llm_adapter=creative_llm_adapter,
        story_bible_llm_adapter=story_bible_llm_adapter,
        story_architect_llm_adapter=story_architect_llm_adapter,
        episode_plan_llm_adapter=episode_plan_llm_adapter,
    )


def get_platform_profile_service() -> PlatformProfileService:
    return PlatformProfileService(repository=platform_profile_repository)


def get_ontology_node_service() -> OntologyNodeService:
    return OntologyNodeService(repository=ontology_node_repository)


def get_asset_service() -> AssetService:
    return AssetService(
        repository=asset_repository,
        ontology_node_repository=ontology_node_repository,
        platform_profile_repository=platform_profile_repository,
    )


def get_prompt_library_service() -> PromptLibraryService:
    return PromptLibraryService(
        repository=prompt_library_repository,
        ontology_node_repository=ontology_node_repository,
    )


def get_generation_strategy_service() -> GenerationStrategyService:
    return GenerationStrategyService(
        repository=generation_strategy_repository,
        ontology_node_repository=ontology_node_repository,
        prompt_library_repository=prompt_library_repository,
    )


def get_prompt_retrieval_service() -> PromptRetrievalService:
    return PromptRetrievalService(
        generation_strategy_repository=generation_strategy_repository,
        prompt_library_repository=prompt_library_repository,
    )


def get_script_generation_service() -> ScriptGenerationService:
    return _get_script_generation_service(_llm_service_cache_key())


@lru_cache(maxsize=8)
def _get_script_generation_service(
    _cache_key: tuple[tuple[str, str], ...],
) -> ScriptGenerationService:
    try:
        primary_llm_adapter = build_script_generation_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        primary_llm_adapter = FailingLLMAdapter(exc)
    try:
        primary_repair_llm_adapter = build_script_repair_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        primary_repair_llm_adapter = FailingLLMAdapter(exc)
    try:
        script_editor_llm_adapter = build_script_editor_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        script_editor_llm_adapter = FailingLLMAdapter(exc)
    try:
        continuity_llm_adapter = build_continuity_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        continuity_llm_adapter = FailingLLMAdapter(exc)
    return ScriptGenerationService(
        content_spec_repository=content_spec_repository,
        generation_strategy_repository=generation_strategy_repository,
        platform_profile_repository=platform_profile_repository,
        prompt_retrieval_service=get_prompt_retrieval_service(),
        orchestrator_service=get_orchestrator_service(),
        retrieval_service=get_retrieval_service(),
        llm_adapter=primary_llm_adapter,
        repair_llm_adapter=primary_repair_llm_adapter,
        initial_fallback_llm_adapter=primary_repair_llm_adapter,
        contract_fallback_llm_adapter=primary_repair_llm_adapter,
        continuity_llm_adapter=continuity_llm_adapter,
        script_editor_llm_adapter=script_editor_llm_adapter,
        script_editor_enabled=_env_flag(
            "SCRIPT_GPT_POST_EDIT_ENABLED",
            default=True,
        ),
        revision_planner=get_revision_planner(),
        creative_deepening_enabled=_env_flag(
            "SCRIPT_CREATIVE_DEEPENING_ENABLED",
            default=False,
        ),
    )


def _env_flag(name: str, *, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().casefold() in {"1", "true", "yes", "on"}


def get_bilingual_script_view_service() -> BilingualScriptViewService:
    try:
        llm_adapter = build_dialogue_polish_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        llm_adapter = FailingLLMAdapter(exc)

    return BilingualScriptViewService(
        generation_strategy_repository=generation_strategy_repository,
        llm_adapter=llm_adapter,
    )


def get_retrieval_service() -> RetrievalService:
    return RetrievalService(
        asset_repository=asset_repository,
        orchestration_plan_repository=orchestration_plan_repository,
    )


def get_content_spec_service() -> ContentSpecService:
    return ContentSpecService(
        repository=content_spec_repository,
        platform_profile_repository=platform_profile_repository,
        ontology_node_repository=ontology_node_repository,
    )


def get_data_intelligence_service() -> DataIntelligenceService:
    return DataIntelligenceService(
        content_spec_repository=content_spec_repository,
        platform_profile_repository=platform_profile_repository,
        ontology_node_repository=ontology_node_repository,
    )


def get_scheduled_ingestion_service() -> ScheduledIngestionService:
    return ScheduledIngestionService(
        repository=data_ingestion_job_repository,
        history_repository=data_ingestion_run_history_repository,
        dedup_repository=ingestion_dedup_repository,
        platform_profile_repository=platform_profile_repository,
        data_intelligence_service=get_data_intelligence_service(),
    )


def get_trend_snapshot_service() -> TrendSnapshotService:
    return TrendSnapshotService(
        repository=trend_snapshot_repository,
        data_ingestion_job_repository=data_ingestion_job_repository,
        run_history_repository=data_ingestion_run_history_repository,
    )


def get_benchmark_service() -> BenchmarkService:
    return BenchmarkService(
        runner=benchmark_runner,
        repository=benchmark_result_repository,
    )


def get_prompt_evaluation_service() -> PromptEvaluationService:
    return PromptEvaluationService(
        runner=prompt_evaluation_runner,
        repository=prompt_evaluation_result_repository,
    )


def get_revision_planner() -> RubricRevisionPlanner:
    return RubricRevisionPlanner()


def get_script_revision_service() -> ScriptRevisionService:
    return ScriptRevisionService(
        generation_strategy_repository=generation_strategy_repository,
    )


def get_master_script_service() -> MasterScriptService:
    return MasterScriptService(
        repository=master_script_repository,
        content_spec_repository=content_spec_repository,
    )


def get_orchestrator_service() -> OrchestratorService:
    return OrchestratorService(
        repository=orchestration_plan_repository,
        content_spec_repository=content_spec_repository,
        platform_profile_repository=platform_profile_repository,
    )
