import os
from functools import lru_cache

from fastapi import Depends, HTTPException, status

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
    get_episode_plan_chunk_size,
    build_llm_adapter_from_env,
    build_market_routed_role_adapter_from_env,
    build_planning_llm_adapter_from_env,
    build_planning_editor_llm_adapter_from_env,
    build_storyboard_llm_adapter_from_env,
    build_script_generation_adapter_from_env,
    build_script_editor_llm_adapter_from_env,
    build_script_repair_llm_adapter_from_env,
    build_story_architect_llm_adapter_from_env,
    build_story_architect_recovery_llm_adapter_from_env,
    build_story_bible_llm_adapter_from_env,
)
from app.modules.asset.repository import AssetRepository
from app.modules.asset.service import AssetService
from app.modules.agent_runtime.episode_roadmap import EpisodeRoadmapAgent
from app.modules.agent_runtime.episode_script import EpisodeScriptAgent
from app.modules.agent_runtime.story_quality import StoryQualityAgent
from app.modules.agent_runtime.service import AgentRunService
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.content_spec.service import ContentSpecService
from app.modules.data_intelligence.service import DataIntelligenceService
from app.modules.master_script.repository import MasterScriptRepository
from app.modules.master_script.service import MasterScriptService
from app.modules.preproduction.repository import PreproductionRepository
from app.modules.script_engine.author_conflicts import AuthorConflictReviewRepository
from app.modules.preproduction.service import StoryboardService
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
from app.modules.script_engine.long_story_service import LongStoryService, LongStoryNotFoundError
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
from app.modules.hongguo_trends.repository import HongguoTrendsRepository
from app.modules.hongguo_trends.service import HongguoTrendsService
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

platform_profile_repository = PlatformProfileRepository(lambda: _optional_content_spec_database_runtime())
ontology_node_repository = OntologyNodeRepository(lambda: _optional_content_spec_database_runtime())
asset_repository = AssetRepository(lambda: _optional_content_spec_database_runtime())
prompt_library_repository = PromptLibraryRepository(lambda: _optional_content_spec_database_runtime())
generation_strategy_repository = GenerationStrategyRepository(lambda: _optional_content_spec_database_runtime())
content_spec_repository = ContentSpecRepository(
    database_runtime_factory=lambda: _optional_content_spec_database_runtime()
)
master_script_repository = MasterScriptRepository(lambda: _optional_content_spec_database_runtime())
orchestration_plan_repository = OrchestrationPlanRepository(lambda: _optional_content_spec_database_runtime())
data_ingestion_job_repository = DataIngestionJobRepository()
data_ingestion_run_history_repository = DataIngestionRunHistoryRepository()
ingestion_dedup_repository = IngestionDedupRepository()
trend_snapshot_repository = TrendSnapshotRepository()
hongguo_trends_repository = HongguoTrendsRepository(lambda: _optional_content_spec_database_runtime())
author_conflict_repository = AuthorConflictReviewRepository(lambda: _optional_content_spec_database_runtime())
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


def get_storyboard_service() -> StoryboardService:
    try:
        runtime = get_long_story_database_runtime()
    except DatabaseConfigurationError as exc:
        raise HTTPException(503, "分镜持久化服务尚未配置。") from exc
    return StoryboardService(PreproductionRepository(runtime), build_storyboard_llm_adapter_from_env)


def get_story_planning_service() -> StoryPlanningService:
    return _get_story_planning_service(_llm_service_cache_key())


def get_agent_run_service() -> AgentRunService:
    try:
        runtime = get_long_story_database_runtime()
    except DatabaseConfigurationError:
        runtime = None
    return AgentRunService(runtime)


def get_episode_roadmap_agent(
    planning_service: StoryPlanningService = Depends(get_story_planning_service),
    run_service: AgentRunService = Depends(get_agent_run_service),
) -> EpisodeRoadmapAgent:
    return EpisodeRoadmapAgent(
        planning_service=planning_service,
        run_service=run_service,
    )


def get_story_quality_agent(
    planning_service: StoryPlanningService = Depends(get_story_planning_service),
    run_service: AgentRunService = Depends(get_agent_run_service),
) -> StoryQualityAgent:
    return StoryQualityAgent(
        planning_service=planning_service,
        run_service=run_service,
    )


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
    decomposition_llm_adapter = build_market_routed_role_adapter_from_env(
        "STORY_ARCHITECT",
        fallback=decomposition_llm_adapter,
        default_timeout_seconds=600,
        default_max_retries=1,
        default_reasoning_effort="medium",
        default_thinking_mode="disabled",
        default_use_strict_schema=False,
        default_send_response_format=True,
        default_retry_empty_response=False,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=False,
    )
    try:
        creative_llm_adapter = build_creative_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        creative_llm_adapter = FailingLLMAdapter(exc)
    creative_llm_adapter = build_market_routed_role_adapter_from_env(
        "CREATIVE",
        fallback=creative_llm_adapter,
        default_timeout_seconds=300,
        default_max_retries=1,
        default_reasoning_effort="medium",
        default_thinking_mode="enabled",
    )
    inspiration_llm_adapter = build_market_routed_role_adapter_from_env(
        "INSPIRATION",
        fallback=creative_llm_adapter,
        # Inspiration is an interactive turn, not a long-form artifact. Keep
        # medium reasoning for question quality, but never leave the creator
        # waiting through a multi-minute provider request.
        default_timeout_seconds=60,
        default_max_retries=0,
        default_reasoning_effort="medium",
        default_thinking_mode="enabled",
        default_use_strict_schema=False,
        default_send_response_format=True,
        default_retry_empty_response=False,
    )
    try:
        story_bible_llm_adapter = build_story_bible_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        story_bible_llm_adapter = FailingLLMAdapter(exc)
    story_bible_llm_adapter = build_market_routed_role_adapter_from_env(
        "STORY_BIBLE",
        fallback=story_bible_llm_adapter,
        default_timeout_seconds=600,
        # Story Bible requests are long-running. Retry at the shared client
        # boundary instead of replaying the same large request inside the
        # adapter, which can otherwise double the visible wait time.
        default_max_retries=0,
        default_reasoning_effort="medium",
        # The Story Bible prompt and structured contract already carry the
        # planning constraints. Keep hidden reasoning off for this synthesis
        # pass so the model spends its budget on the reviewable outline.
        default_thinking_mode="disabled",
        default_use_strict_schema=False,
        default_send_response_format=True,
        # A successful HTTP response with an empty body is recoverable for the
        # Story Bible role; let the adapter make one bounded protocol retry.
        default_retry_empty_response=True,
    )
    story_bible_editor_llm_adapter = build_market_routed_role_adapter_from_env(
        "STORY_BIBLE_EDITOR",
        fallback=story_bible_llm_adapter,
        default_timeout_seconds=600,
        default_max_retries=1,
        default_reasoning_effort="medium",
        default_thinking_mode="disabled",
        default_use_strict_schema=False,
        default_send_response_format=False,
        default_retry_empty_response=False,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=False,
    )
    try:
        story_architect_llm_adapter = build_story_architect_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        story_architect_llm_adapter = FailingLLMAdapter(exc)
    story_architect_llm_adapter = build_market_routed_role_adapter_from_env(
        "STORY_ARCHITECT",
        fallback=story_architect_llm_adapter,
        default_timeout_seconds=600,
        default_max_retries=1,
        default_reasoning_effort="medium",
        default_thinking_mode="disabled",
        default_use_strict_schema=False,
        default_send_response_format=True,
        default_retry_empty_response=False,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=False,
    )
    try:
        story_architect_recovery_llm_adapter = (
            build_story_architect_recovery_llm_adapter_from_env()
        )
    except MissingLLMConfigurationError as exc:
        story_architect_recovery_llm_adapter = FailingLLMAdapter(exc)
    story_architect_recovery_llm_adapter = build_market_routed_role_adapter_from_env(
        "STORY_ARCHITECT_RECOVERY",
        fallback=story_architect_recovery_llm_adapter,
        default_timeout_seconds=600,
        default_max_retries=1,
        default_reasoning_effort="low",
        default_thinking_mode="disabled",
        default_use_strict_schema=False,
        default_send_response_format=True,
        default_retry_empty_response=False,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=False,
    )
    try:
        episode_plan_llm_adapter = build_episode_plan_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        episode_plan_llm_adapter = FailingLLMAdapter(exc)
    episode_plan_llm_adapter = build_market_routed_role_adapter_from_env(
        "EPISODE_PLAN",
        fallback=episode_plan_llm_adapter,
        default_timeout_seconds=180,
        default_max_retries=0,
        default_reasoning_effort="low",
        default_thinking_mode="disabled",
        default_use_strict_schema=False,
        default_send_response_format=False,
        default_retry_empty_response=False,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=False,
    )
    try:
        planning_editor_llm_adapter = build_planning_editor_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        planning_editor_llm_adapter = FailingLLMAdapter(exc)
    return StoryPlanningService(
        long_story_service=get_long_story_service(),
        content_spec_repository=content_spec_repository,
        generation_strategy_repository=generation_strategy_repository,
        llm_adapter=llm_adapter,
        decomposition_llm_adapter=decomposition_llm_adapter,
        creative_llm_adapter=creative_llm_adapter,
        inspiration_llm_adapter=inspiration_llm_adapter,
        story_bible_llm_adapter=story_bible_llm_adapter,
        story_bible_editor_llm_adapter=story_bible_editor_llm_adapter,
        planning_editor_llm_adapter=planning_editor_llm_adapter,
        story_architect_llm_adapter=story_architect_llm_adapter,
        story_architect_recovery_llm_adapter=(
            story_architect_recovery_llm_adapter
        ),
        episode_plan_llm_adapter=episode_plan_llm_adapter,
        episode_plan_chunk_size=get_episode_plan_chunk_size(),
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


def _load_episode_planning_workspace(project_id: str) -> dict[str, object]:
    try:
        return get_long_story_service().get_workspace_snapshot(project_id).workspace_payload
    except LongStoryNotFoundError:
        return {}


def _load_approved_episode_history(project_id: str) -> list[dict[str, object]]:
    workspace = _load_episode_planning_workspace(project_id)
    return [
        item for item in workspace.get("episodeRoadmaps", [])
        if isinstance(item, dict) and item.get("status") == "approved"
        and (not workspace.get("storyBibleVersion") or not item.get("story_bible_version")
             or item["story_bible_version"] == workspace["storyBibleVersion"])
    ]


def get_episode_script_agent(
    generation_service: ScriptGenerationService = Depends(get_script_generation_service),
    run_service: AgentRunService = Depends(get_agent_run_service),
) -> EpisodeScriptAgent:
    return EpisodeScriptAgent(
        generation_service=generation_service,
        run_service=run_service,
    )


@lru_cache(maxsize=8)
def _get_script_generation_service(
    _cache_key: tuple[tuple[str, str], ...],
) -> ScriptGenerationService:
    try:
        primary_llm_adapter = build_script_generation_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        primary_llm_adapter = FailingLLMAdapter(exc)
    primary_llm_adapter = build_market_routed_role_adapter_from_env(
        "SCRIPT",
        fallback=primary_llm_adapter,
        default_timeout_seconds=600,
        default_max_retries=1,
        default_reasoning_effort="high",
        default_thinking_mode="enabled",
        default_use_strict_schema=False,
        default_send_response_format=False,
        default_retry_empty_response=True,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=True,
    )
    try:
        primary_repair_llm_adapter = build_script_repair_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        primary_repair_llm_adapter = FailingLLMAdapter(exc)
    primary_repair_llm_adapter = build_market_routed_role_adapter_from_env(
        "SCRIPT_REPAIR",
        fallback=primary_repair_llm_adapter,
        default_timeout_seconds=600,
        default_max_retries=1,
        default_reasoning_effort="high",
        default_thinking_mode="enabled",
        default_use_strict_schema=False,
        default_send_response_format=False,
        default_retry_empty_response=True,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=True,
    )
    try:
        script_editor_llm_adapter = build_script_editor_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        script_editor_llm_adapter = FailingLLMAdapter(exc)
    script_editor_llm_adapter = build_market_routed_role_adapter_from_env(
        "SCRIPT_EDITOR",
        fallback=script_editor_llm_adapter,
        default_timeout_seconds=600,
        default_max_retries=1,
        default_reasoning_effort="medium",
        default_thinking_mode="enabled",
    )
    conversation_editor_llm_adapter = build_market_routed_role_adapter_from_env(
        "SCRIPT_CONVERSATION_EDITOR",
        fallback=script_editor_llm_adapter,
        default_timeout_seconds=600,
        default_max_retries=1,
        default_reasoning_effort="medium",
        default_thinking_mode="enabled",
        default_use_strict_schema=False,
        default_send_response_format=False,
        default_retry_empty_response=True,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=True,
    )
    try:
        continuity_llm_adapter = build_continuity_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        continuity_llm_adapter = FailingLLMAdapter(exc)
    continuity_llm_adapter = build_market_routed_role_adapter_from_env(
        "CONTINUITY",
        fallback=continuity_llm_adapter,
        default_timeout_seconds=600,
        default_max_retries=1,
        default_reasoning_effort="high",
        default_thinking_mode="enabled",
    )
    return ScriptGenerationService(
        content_spec_repository=content_spec_repository,
        generation_strategy_repository=generation_strategy_repository,
        platform_profile_repository=platform_profile_repository,
        prompt_retrieval_service=get_prompt_retrieval_service(),
        orchestrator_service=get_orchestrator_service(),
        retrieval_service=get_retrieval_service(),
        llm_adapter=primary_llm_adapter,
        repair_llm_adapter=primary_repair_llm_adapter,
        json_repair_llm_adapter=script_editor_llm_adapter,
        production_count_llm_adapter=script_editor_llm_adapter,
        initial_fallback_llm_adapter=primary_repair_llm_adapter,
        initial_generation_timeout_seconds=_initial_generation_timeout_seconds(),
        episode_plan_history_loader=_load_approved_episode_history,
        episode_plan_workspace_loader=_load_episode_planning_workspace,
        contract_fallback_llm_adapter=primary_repair_llm_adapter,
        continuity_llm_adapter=continuity_llm_adapter,
        script_editor_llm_adapter=script_editor_llm_adapter,
        conversation_editor_llm_adapter=conversation_editor_llm_adapter,
        author_conflict_repository=author_conflict_repository,
        script_editor_enabled=_env_flag(
            "SCRIPT_GPT_POST_EDIT_ENABLED",
            # Generate the screenplay once by default. Deterministic gates and
            # bounded hard-failure repairs remain active; GPT editing is opt-in.
            default=False,
        ),
        revision_planner=get_revision_planner(),
        creative_deepening_enabled=_env_flag(
            "SCRIPT_CREATIVE_DEEPENING_ENABLED",
            default=False,
        ),
    )


def _initial_generation_timeout_seconds() -> int:
    raw = os.getenv("LLM_INITIAL_GENERATION_TIMEOUT_SECONDS", "900").strip()
    try:
        value = int(raw)
    except ValueError as error:
        raise MissingLLMConfigurationError(
            "LLM_INITIAL_GENERATION_TIMEOUT_SECONDS must be a positive integer."
        ) from error
    if value <= 0:
        raise MissingLLMConfigurationError(
            "LLM_INITIAL_GENERATION_TIMEOUT_SECONDS must be a positive integer."
        )
    return value


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
    llm_adapter = build_market_routed_role_adapter_from_env(
        "DIALOGUE",
        fallback=llm_adapter,
        default_timeout_seconds=300,
        default_max_retries=1,
        default_reasoning_effort="high",
        default_thinking_mode="enabled",
    )

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


def get_hongguo_trends_service() -> HongguoTrendsService:
    return HongguoTrendsService(repository=hongguo_trends_repository)


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
