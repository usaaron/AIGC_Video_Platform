"""Trusted host authorization boundary; client headers never establish identity."""

from collections.abc import Awaitable, Callable
import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import re
from time import time
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
    project_id: str | None = Field(default=None, max_length=160)
    request_id: str = Field(min_length=1, max_length=120)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=120)


# The host must authenticate AND authorize this operation, including every
# project/content ID in its path, query and body, before returning a context.
HostAuthorizer = Callable[[Request], Awaitable[HostRequestContext]]


def environment_host_authorizer() -> HostAuthorizer | None:
    """Build the production handoff authorizer used by the host application.

    The host puts the signed token in the launch URL fragment. The frontend
    moves it into an Authorization header before making API requests, so the
    token is not sent as a normal request URL or referrer.
    """

    secret = (
        os.getenv("HOST_INTEGRATION_SECRET", "").strip()
        or os.getenv("SCRIPT_MASTER_SHARED_SECRET", "").strip()
    )
    if not secret:
        return None

    async def authorize(request: Request) -> HostRequestContext:
        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer "):
            raise HTTPException(401, "Script Master host authorization is required.")
        token = header.removeprefix("Bearer ").strip()
        claims = _verify_handoff_token(token, secret)
        requested_project_id = _project_id_from_path(request.url.path)
        token_project_id = claims.get("projectId")
        if token_project_id and requested_project_id and token_project_id != requested_project_id:
            raise HTTPException(403, "The host token cannot access this project.")
        return HostRequestContext(
            tenant_id=claims["tenantId"],
            actor_id=claims["actorId"],
            roles=frozenset(claims.get("roles", [])),
            permissions=frozenset(claims.get("permissions", [])),
            project_id=token_project_id,
            request_id=request.headers.get("x-request-id") or claims["tokenId"],
        )

    return authorize


def _verify_handoff_token(token: str, secret: str) -> dict[str, object]:
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        supplied_signature = base64.urlsafe_b64decode(encoded_signature + "===")
        expected_signature = hmac.new(
            secret.encode("utf-8"), encoded_payload.encode("ascii"), hashlib.sha256
        ).digest()
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise ValueError("signature")
        claims = json.loads(base64.urlsafe_b64decode(encoded_payload + "==="))
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(401, "The Script Master host token is invalid.") from None
    if not isinstance(claims, dict):
        raise HTTPException(401, "The Script Master host token is invalid.")
    if claims.get("version") != 1 or claims.get("issuer") != "seqora" or claims.get("audience") != "script-master":
        raise HTTPException(401, "The Script Master host token is invalid.")
    expires_at = claims.get("expiresAt")
    if isinstance(expires_at, bool) or not isinstance(expires_at, int) or expires_at <= int(time()):
        raise HTTPException(401, "The Script Master host token has expired.")
    for field in ("tenantId", "actorId", "tokenId"):
        if not isinstance(claims.get(field), str) or not claims[field]:
            raise HTTPException(401, "The Script Master host token is invalid.")
    if claims.get("projectId") is not None and not isinstance(claims.get("projectId"), str):
        raise HTTPException(401, "The Script Master host token is invalid.")
    return claims


def _project_id_from_path(path: str) -> str | None:
    match = re.search(r"/(?:story-projects|projects)/([^/]+)", path)
    return match.group(1) if match else None


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
