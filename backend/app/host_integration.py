"""Trusted host authorization boundary; client headers never establish identity."""

from collections.abc import Awaitable, Callable
import logging
import re
from time import perf_counter
from uuid import uuid4

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Receive, Scope, Send


logger = logging.getLogger(__name__)
HEALTH_PATHS = frozenset({"/health/live", "/health/ready"})


class HostRequestContext(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    tenant_id: str = Field(min_length=1, max_length=120)
    actor_id: str = Field(min_length=1, max_length=120)
    roles: frozenset[str] = frozenset()
    permissions: frozenset[str] = frozenset()
    request_id: str = Field(min_length=1, max_length=120)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=120)


# The host must authenticate AND authorize this operation, including every
# project/content ID in its path, query and body, before returning a context.
HostAuthorizer = Callable[[Request], Awaitable[HostRequestContext]]


async def authorize_host_request(request: Request) -> HostRequestContext | None:
    if request.url.path in HEALTH_PATHS:
        return None
    authorizer = request.app.state.host_authorizer
    if authorizer is None:
        if request.app.state.require_host_context:
            raise HTTPException(503, "Host authorization adapter is not configured.")
        return None
    context = HostRequestContext.model_validate(await authorizer(request))
    request.state.host_context = context
    request.state.request_id = context.request_id
    return context


class RequestObservationMiddleware:
    """Correlate complete HTTP/SSE requests without buffering their bodies."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        supplied_id = Headers(scope=scope).get("x-request-id", "")
        request_id = supplied_id if re.fullmatch(r"[A-Za-z0-9_.:-]{1,120}", supplied_id) else uuid4().hex
        state = scope.setdefault("state", {})
        state["request_id"] = request_id
        started = perf_counter()
        status_code = 500

        async def observe_send(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                MutableHeaders(scope=message)["X-Request-ID"] = state["request_id"]
            await send(message)

        try:
            await self.app(scope, receive, observe_send)
        finally:
            context = state.get("host_context")
            route = scope.get("route")
            logger.info(
                "module_request request_id=%s tenant_id=%s actor_id=%s method=%s "
                "route=%s status=%s elapsed_ms=%s",
                state["request_id"], context.tenant_id if context else "local",
                context.actor_id if context else "local", scope["method"],
                getattr(route, "path", "unmatched"), status_code,
                round((perf_counter() - started) * 1000),
            )
