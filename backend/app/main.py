from fastapi import FastAPI

from app.api.routes.assets import router as asset_router
from app.api.routes.benchmarks import router as benchmark_router
from app.api.routes.content_specs import router as content_spec_router
from app.api.routes.data_intelligence import router as data_intelligence_router
from app.api.routes.generation_strategies import router as generation_strategy_router
from app.api.routes.master_scripts import router as master_script_router
from app.api.routes.ontology_nodes import router as ontology_node_router
from app.api.routes.orchestrations import router as orchestration_router
from app.api.routes.platform_profiles import router as platform_profile_router
from app.api.routes.prompt_library import router as prompt_library_router
from app.api.routes.prompt_retrieval import router as prompt_retrieval_router
from app.api.routes.retrieval import router as retrieval_router
from app.api.routes.scheduled_ingestion import router as scheduled_ingestion_router
from app.api.routes.script_generation import router as script_generation_router
from app.api.routes.trend_snapshots import router as trend_snapshot_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="AI Comic Content OS",
        version="0.1.0",
        description="Backend scaffold for the AI Comic Content OS MVP content planning engine.",
    )
    app.include_router(asset_router)
    app.include_router(benchmark_router)
    app.include_router(content_spec_router)
    app.include_router(data_intelligence_router)
    app.include_router(generation_strategy_router)
    app.include_router(master_script_router)
    app.include_router(ontology_node_router)
    app.include_router(orchestration_router)
    app.include_router(platform_profile_router)
    app.include_router(prompt_library_router)
    app.include_router(prompt_retrieval_router)
    app.include_router(retrieval_router)
    app.include_router(scheduled_ingestion_router)
    app.include_router(script_generation_router)
    app.include_router(trend_snapshot_router)
    return app


app = create_app()
