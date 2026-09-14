import os
import logging
import asyncio
from contextlib import asynccontextmanager
from threading import Event

from fastapi import Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import DatabaseConfigurationError
from app.dependencies import get_hongguo_trends_service, get_long_story_database_runtime
from app.host_integration import (
    HostAuthorizer,
    RequestObservationMiddleware,
    authorize_host_request,
    environment_host_authorizer,
)

from app.api.routes.assets import router as asset_router
from app.api.routes.agent_runs import router as agent_run_router
from app.api.routes.author_revisions import router as author_revision_router
from app.api.routes.benchmarks import router as benchmark_router
from app.api.routes.content_specs import router as content_spec_router
from app.api.routes.data_intelligence import router as data_intelligence_router
from app.api.routes.generation_strategies import router as generation_strategy_router
from app.api.routes.input_readiness import router as input_readiness_router
from app.api.routes.master_scripts import router as master_script_router
from app.api.routes.preproduction import router as preproduction_router
from app.api.routes.story_projects import router as story_project_router
from app.api.routes.ontology_nodes import router as ontology_node_router
from app.api.routes.orchestrations import router as orchestration_router
from app.api.routes.platform_profiles import router as platform_profile_router
from app.api.routes.prompt_library import router as prompt_library_router
from app.api.routes.prompt_retrieval import router as prompt_retrieval_router
from app.api.routes.retrieval import router as retrieval_router
from app.api.routes.scheduled_ingestion import router as scheduled_ingestion_router
from app.api.routes.script_generation import router as script_generation_router
from app.api.routes.trend_snapshots import router as trend_snapshot_router
from app.api.routes.hongguo_trends import router as hongguo_trends_router


logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    stop = Event()
    wake = asyncio.Event()

    async def refresh_hongguo():
        service = get_hongguo_trends_service()
        while not stop.is_set():
            try:
                await asyncio.to_thread(service.refresh_due, stop)
            except Exception:
                # A background feed failure must not stop serving screenplay requests.
                logger.exception("Hongguo background refresh failed")
            try:
                await asyncio.wait_for(wake.wait(), timeout=60)
            except TimeoutError:
                pass

    task = asyncio.create_task(refresh_hongguo())
    try:
        yield
    finally:
        stop.set()
        wake.set()
        await task


def create_app(
    *, host_authorizer: HostAuthorizer | None = None,
    require_host_context: bool | None = None,
) -> FastAPI:
    app = FastAPI(
        title="AI Comic Content OS",
        version="0.1.0",
        description="Backend scaffold for the AI Comic Content OS MVP content planning engine.",
        dependencies=[Depends(authorize_host_request)],
        lifespan=_lifespan,
    )
    app.state.host_authorizer = host_authorizer
    app.state.require_host_context = (
        os.getenv("HOST_INTEGRATION_REQUIRED", "false").casefold() in {"true", "1", "yes"}
        if require_host_context is None else require_host_context
    )
    app.add_middleware(RequestObservationMiddleware)

    @app.get("/health/live", include_in_schema=False)
    def health_live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready", include_in_schema=False)
    def health_ready() -> JSONResponse:
        checks = {"database": False, "host_authorization": (
            not app.state.require_host_context or app.state.host_authorizer is not None
        )}
        try:
            with get_long_story_database_runtime().session() as session:
                session.execute(text("SELECT 1 FROM module_documents LIMIT 1"))
            checks["database"] = True
        except (DatabaseConfigurationError, SQLAlchemyError):
            pass
        ready = all(checks.values())
        return JSONResponse({"status": "ready" if ready else "unavailable", "checks": checks},
                            status_code=200 if ready else 503)

    @app.exception_handler(RequestValidationError)
    async def request_validation_error_handler(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        """Keep the standard 422 contract while making field drift diagnosable."""

        errors = [
            {
                key: value
                for key, value in error.items()
                if key not in {"input", "url"}
            }
            for error in exc.errors()
        ]
        logger.warning(
            "Request validation failed method=%s path=%s errors=%s",
            request.method,
            request.url.path,
            errors,
        )
        return JSONResponse(
            status_code=422,
            content=jsonable_encoder(
                {"detail": errors},
                custom_encoder={Exception: str},
            ),
        )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_frontend_origins(),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[
            "X-Generation-Retryable",
            "X-Generation-Failure-Class",
            "X-Generation-Error-Type",
            "X-Agent-Run-ID",
            "X-Agent-Run-Attempt",
            "X-Request-ID",
        ],
    )
    app.include_router(asset_router)
    app.include_router(agent_run_router)
    app.include_router(benchmark_router)
    app.include_router(content_spec_router)
    app.include_router(data_intelligence_router)
    app.include_router(generation_strategy_router)
    app.include_router(input_readiness_router)
    app.include_router(master_script_router)
    app.include_router(preproduction_router)
    app.include_router(story_project_router)
    app.include_router(author_revision_router)
    app.include_router(ontology_node_router)
    app.include_router(orchestration_router)
    app.include_router(platform_profile_router)
    app.include_router(prompt_library_router)
    app.include_router(prompt_retrieval_router)
    app.include_router(retrieval_router)
    app.include_router(scheduled_ingestion_router)
    app.include_router(script_generation_router)
    app.include_router(trend_snapshot_router)
    app.include_router(hongguo_trends_router)
    return app


def _frontend_origins() -> list[str]:
    configured = os.getenv(
        "FRONTEND_ORIGINS",
        "http://127.0.0.1:3000,http://localhost:3000",
    )
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


app = create_app(
    host_authorizer=environment_host_authorizer(),
    require_host_context=bool(
        os.getenv("HOST_INTEGRATION_REQUIRED", "false").casefold() in {"true", "1", "yes"}
        or os.getenv("HOST_INTEGRATION_SECRET", "").strip()
        or os.getenv("SCRIPT_MASTER_SHARED_SECRET", "").strip()
    ),
)
