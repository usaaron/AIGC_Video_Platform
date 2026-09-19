"""One durable allowance shared by every physical request of a decomposition.

Only the transport debits this allowance. Repairs, key rotations, model fallback
and repeated HTTP requests therefore cannot each obtain a fresh retry budget.
"""

from __future__ import annotations

import hashlib
import json
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Iterator

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import select

from app.database import DatabaseRuntime
from app.document_repository import ModuleDocumentRecord


PLANNING_CALL_BUDGET_NAMESPACE = "planning_call_budgets.v1"
DEFAULT_PLANNING_CALL_LIMIT = 4


class PlanningCallBudgetExceeded(RuntimeError):
    """Terminal for this operation; deliberately not an LLMRequestError."""

    def __init__(self, *, operation_id: str, used: int, limit: int) -> None:
        self.operation_id = operation_id
        self.used = used
        self.limit = limit
        super().__init__(
            "本次生成已停止，已保存的剧情保持不变。请调整这一部分后再继续；"
            "系统不会自动重复生成。"
        )


_memory_lock = threading.Lock()
_memory_records: dict[str, dict] = {}


def _fingerprint(value: dict) -> str:
    return hashlib.sha256(json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")).hexdigest()


class PlanningCallBudget:
    def __init__(
        self, *, database_runtime: DatabaseRuntime | None, operation_id: str | None,
        project_id: str, parent_node_id: str, parent_node_version: int,
        input_fingerprint: str, limit: int = DEFAULT_PLANNING_CALL_LIMIT,
    ) -> None:
        if limit < 1 or parent_node_version < 1:
            raise ValueError("Planning request limit and parent version must be positive.")
        binding = {
            "project_id": project_id, "parent_node_id": parent_node_id,
            "parent_node_version": parent_node_version,
            "input_fingerprint": input_fingerprint,
        }
        self.operation_id = operation_id or f"decompose-{_fingerprint(binding)}"
        self.binding = {**binding, "operation_id": self.operation_id}
        self.document_id = _fingerprint(self.binding)
        self.runtime = database_runtime
        self.limit = min(limit, DEFAULT_PLANNING_CALL_LIMIT)
        self.used = 0

    def _initial_record(self) -> dict:
        return {"binding": self.binding, "used": 0, "limit": self.limit}

    def _record_usage(self, record: dict) -> tuple[int, int]:
        if record["binding"] != self.binding:
            raise RuntimeError("Planning call budget binding mismatch.")
        used, stored_limit = record["used"], record["limit"]
        if (type(used) is not int or type(stored_limit) is not int
                or not 1 <= stored_limit <= DEFAULT_PLANNING_CALL_LIMIT
                or not 0 <= used <= stored_limit):
            raise RuntimeError("Planning call budget contains invalid usage or limit.")
        limit = min(self.limit, stored_limit)
        self.used, self.limit = used, limit
        return used, limit

    def _check_record(self, record: dict) -> None:
        used, limit = self._record_usage(record)
        if used >= limit:
            raise PlanningCallBudgetExceeded(
                operation_id=self.operation_id, used=used, limit=limit,
            )

    def charge(self) -> None:
        """Reserve one real POST atomically, immediately before opening it."""
        if self.runtime is None:
            # Legacy in-memory service doubles still share an allowance across
            # request contexts. Production supplies its durable runtime.
            with _memory_lock:
                record = _memory_records.setdefault(self.document_id, self._initial_record())
                self._check_record(record)
                self.used += 1
                record.update(used=self.used, limit=self.limit)
            return

        now = datetime.now(timezone.utc)
        insert = {"postgresql": pg_insert, "sqlite": sqlite_insert}[self.runtime.engine.dialect.name]
        with self.runtime.session() as session:
            session.execute(insert(ModuleDocumentRecord).values(
                namespace=PLANNING_CALL_BUDGET_NAMESPACE,
                document_id=self.document_id, created_at=now, updated_at=now,
                payload=self._initial_record(),
            ).on_conflict_do_nothing(index_elements=["namespace", "document_id"]))

        # Each loser rereads in a new transaction. The compare-and-swap on used
        # works across processes as well as hedged requests in copied contexts.
        for _ in range(32):
            with self.runtime.session() as session:
                record = session.exec(select(ModuleDocumentRecord).where(
                    ModuleDocumentRecord.namespace == PLANNING_CALL_BUDGET_NAMESPACE,
                    ModuleDocumentRecord.document_id == self.document_id,
                )).one().payload
                self._check_record(record)
                previous_used = int(record["used"])
                result = session.execute(update(ModuleDocumentRecord).where(
                    ModuleDocumentRecord.namespace == PLANNING_CALL_BUDGET_NAMESPACE,
                    ModuleDocumentRecord.document_id == self.document_id,
                    ModuleDocumentRecord.payload["used"].as_integer() == previous_used,
                ).values(
                    payload={**record, "used": previous_used + 1, "limit": self.limit},
                    updated_at=datetime.now(timezone.utc),
                ).execution_options(synchronize_session=False))
                if result.rowcount == 1:
                    self.used = previous_used + 1
                    return
        # Persistence contention cannot silently become an unmetered POST.
        raise RuntimeError("Unable to reserve the planning request allowance.")

    def remaining(self) -> int:
        """Read the latest allowance without reserving or creating a record.

        This is a scheduling hint, not a reservation: concurrent transports must
        still pass the atomic charge immediately before sending their POST.
        """
        if self.runtime is None:
            with _memory_lock:
                record = _memory_records.get(self.document_id, self._initial_record())
                used, limit = self._record_usage(record)
        else:
            with self.runtime.session() as session:
                row = session.exec(select(ModuleDocumentRecord).where(
                    ModuleDocumentRecord.namespace == PLANNING_CALL_BUDGET_NAMESPACE,
                    ModuleDocumentRecord.document_id == self.document_id,
                )).one_or_none()
                used, limit = self._record_usage(row.payload if row else self._initial_record())
        return max(0, limit - used)

    def raise_if_exhausted(self) -> None:
        """Make a failed final allowed call terminal without another HTTP retry."""
        if self.runtime is None:
            with _memory_lock:
                record = _memory_records.get(self.document_id)
                if record is not None:
                    self._check_record(record)
            return
        with self.runtime.session() as session:
            row = session.exec(select(ModuleDocumentRecord).where(
                ModuleDocumentRecord.namespace == PLANNING_CALL_BUDGET_NAMESPACE,
                ModuleDocumentRecord.document_id == self.document_id,
            )).one_or_none()
            if row is not None:
                self._check_record(row.payload)


_budget: ContextVar[PlanningCallBudget | None] = ContextVar("planning_call_budget", default=None)


@contextmanager
def planning_call_budget_scope(**kwargs) -> Iterator[PlanningCallBudget]:
    budget = PlanningCallBudget(**kwargs)
    current = _budget.get()
    if current is not None:
        if current.document_id != budget.document_id:
            raise RuntimeError("Nested planning operations cannot replace their request allowance.")
        yield current
        return
    token = _budget.set(budget)
    try:
        yield budget
    except PlanningCallBudgetExceeded:
        raise
    except Exception as error:
        try:
            budget.raise_if_exhausted()
        except PlanningCallBudgetExceeded as exhausted:
            raise exhausted from error
        raise
    finally:
        _budget.reset(token)


def charge_planning_model_request() -> None:
    budget = _budget.get()
    if budget is not None:
        budget.charge()


def remaining_planning_model_requests() -> int | None:
    budget = _budget.get()
    return budget.remaining() if budget is not None else None
