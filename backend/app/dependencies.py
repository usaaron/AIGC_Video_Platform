from app.llm_runtime import build_llm_adapter_from_env
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
from app.modules.script_engine.llm_adapter import FailingLLMAdapter, MissingLLMConfigurationError
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
content_spec_repository = ContentSpecRepository()
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
    try:
        llm_adapter = build_llm_adapter_from_env()
    except MissingLLMConfigurationError as exc:
        llm_adapter = FailingLLMAdapter(exc)

    return ScriptGenerationService(
        content_spec_repository=content_spec_repository,
        generation_strategy_repository=generation_strategy_repository,
        platform_profile_repository=platform_profile_repository,
        prompt_retrieval_service=get_prompt_retrieval_service(),
        orchestrator_service=get_orchestrator_service(),
        retrieval_service=get_retrieval_service(),
        llm_adapter=llm_adapter,
        revision_planner=get_revision_planner(),
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
