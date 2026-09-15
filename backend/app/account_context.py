"""Request-bound storage identity, including revocation in copied task contexts."""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import hashlib
import json
import os
from threading import RLock
from typing import Generic, TypeVar


class AccountContextError(RuntimeError):
    pass


def account_isolation_required() -> bool:
    return bool(
        os.getenv("SCRIPT_MASTER_ACCOUNT_ISOLATION", "false").casefold() in {"true", "1", "yes"}
        or os.getenv("HOST_INTEGRATION_REQUIRED", "false").casefold() in {"true", "1", "yes"}
        or os.getenv("HOST_INTEGRATION_SECRET", "").strip()
        or os.getenv("SCRIPT_MASTER_SHARED_SECRET", "").strip()
    )


def account_schema(tenant_id: str, actor_id: str) -> str:
    # JSON framing avoids ambiguous pairs; 224 bits fit PostgreSQL's 63-byte limit.
    identity = json.dumps([tenant_id, actor_id], ensure_ascii=True, separators=(",", ":"))
    return "sm_ac_" + hashlib.sha256(identity.encode()).hexdigest()[:56]


@dataclass
class StorageScope:
    required: bool = False
    schema: str | None = None
    active: bool = True


storage_scope: ContextVar[StorageScope | None] = ContextVar("script_master_storage_scope", default=None)


def current_schema() -> str | None:
    scope = storage_scope.get()
    if scope is None:
        return None
    if not scope.active:
        raise AccountContextError("The request storage context has ended.")
    if scope.required and scope.schema is None:
        raise AccountContextError("An authorized account storage context is required.")
    return scope.schema


@contextmanager
def system_storage(schema: str = "public") -> Iterator[None]:
    """Explicit boundary for trusted startup/catalog/feed work, never client input."""
    if schema not in {"public", "sm_feed"}:
        raise ValueError("Unknown system storage schema.")
    scope = StorageScope(schema=schema)
    token = storage_scope.set(scope)
    try:
        yield
    finally:
        scope.active = False
        storage_scope.reset(token)


T = TypeVar("T")


class AccountLocalRepository(Generic[T]):
    """Keep legacy experimental memory repositories separate per account.

    These features retain their existing process-local durability. Durable domain
    repositories use PostgreSQL instead; neither request identity nor a Session is
    captured in service caches.
    """

    def __init__(self, factory: Callable[[], T]) -> None:
        self._factory = factory
        self._repositories: dict[str | None, T] = {}
        self._lock = RLock()

    def _repository(self) -> T:
        key = current_schema()
        with self._lock:
            if key not in self._repositories:
                self._repositories[key] = self._factory()
            return self._repositories[key]

    def __getattr__(self, name: str):
        # Resolve at invocation, so a cached bound method cannot retain an actor.
        def invoke(*args, **kwargs):
            return getattr(self._repository(), name)(*args, **kwargs)
        return invoke
