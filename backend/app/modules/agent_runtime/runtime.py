from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from datetime import datetime, timezone
from time import perf_counter
from typing import Any, Protocol, TypeVar

from app.modules.agent_runtime.models import (
    AgentRunPolicy,
    AgentRunRecord,
    AgentRunStatus,
    AgentToolExecution,
    AgentToolKind,
    AgentToolStatus,
)


logger = logging.getLogger(__name__)
ResultT = TypeVar("ResultT")
AGENT_HEARTBEAT_INTERVAL_SECONDS = 30


class AgentRunStore(Protocol):
    def save_record(
        self,
        record: AgentRunRecord,
        *,
        result_payload: dict[str, Any] | None = None,
    ) -> AgentRunRecord: ...

    def save_step(
        self,
        record: AgentRunRecord,
        execution: AgentToolExecution,
        *,
        checkpoint_type: str | None = None,
        checkpoint_payload: dict[str, Any] | None = None,
    ) -> None: ...

    def load_tool_checkpoint(
        self,
        run_id: str,
        tool_name: str,
    ) -> tuple[str, dict[str, Any]] | None: ...

    def heartbeat(self, run_id: str) -> None: ...


class AgentPolicyViolationError(RuntimeError):
    """Raised before an agent can exceed a deterministic execution boundary."""


class AgentSession:
    """Executes whitelisted tools with bounded steps and sanitized observability."""

    def __init__(
        self,
        *,
        agent_name: str,
        subject_ref: str,
        policy: AgentRunPolicy,
        record: AgentRunRecord | None = None,
        store: AgentRunStore | None = None,
    ) -> None:
        self._record = record or AgentRunRecord(
            agent_name=agent_name,
            subject_ref=subject_ref,
            policy=policy,
        )
        self._store = store

    @property
    def record(self) -> AgentRunRecord:
        return self._record

    def call_tool(
        self,
        tool_name: str,
        *,
        kind: AgentToolKind,
        operation: Callable[[], ResultT],
        checkpoint_serializer: Callable[[ResultT], tuple[str, dict[str, Any]]] | None = None,
        checkpoint_loader: Callable[[dict[str, Any]], ResultT] | None = None,
        expected_checkpoint_type: str | None = None,
    ) -> ResultT:
        self._require_running()
        policy = self._record.policy
        if tool_name not in policy.allowed_tools:
            raise AgentPolicyViolationError(
                f"Agent '{self._record.agent_name}' cannot call tool '{tool_name}'."
            )
        current_attempt_steps = sum(
            execution.attempt == self._record.attempt_count
            for execution in self._record.tool_executions
        )
        if current_attempt_steps >= policy.max_steps:
            raise AgentPolicyViolationError(
                f"Agent '{self._record.agent_name}' exceeded its step budget."
            )
        if (
            kind == AgentToolKind.model
            and self._record.current_attempt_model_tool_call_count
            >= policy.max_model_tool_calls
        ):
            raise AgentPolicyViolationError(
                f"Agent '{self._record.agent_name}' exceeded its model-call budget."
            )

        if self._store is not None and checkpoint_loader is not None:
            checkpoint = self._store.load_tool_checkpoint(
                self._record.run_id,
                tool_name,
            )
            if checkpoint is not None and (
                expected_checkpoint_type is None
                or checkpoint[0] == expected_checkpoint_type
            ):
                self._record.updated_at = datetime.now(timezone.utc)
                self._store.save_record(self._record)
                return checkpoint_loader(checkpoint[1])
            if checkpoint is not None:
                logger.info(
                    "Ignoring incompatible Agent checkpoint run=%s tool=%s "
                    "expected_type=%s actual_type=%s",
                    self._record.run_id,
                    tool_name,
                    expected_checkpoint_type,
                    checkpoint[0],
                )

        step = current_attempt_steps + 1
        started_at = perf_counter()
        started_at_wall = datetime.now(timezone.utc)
        running_execution = AgentToolExecution(
            attempt=self._record.attempt_count,
            step=step,
            tool_name=tool_name,
            kind=kind,
            status=AgentToolStatus.running,
            started_at=started_at_wall,
        )
        self._record.tool_executions.append(running_execution)
        self._record.updated_at = started_at_wall
        self._persist_step(running_execution)
        try:
            result = self._run_with_heartbeat(operation)
            checkpoint_type = None
            checkpoint_payload = None
            if checkpoint_serializer is not None:
                checkpoint_type, checkpoint_payload = checkpoint_serializer(result)
        except Exception as error:
            finished_at = datetime.now(timezone.utc)
            execution = running_execution.model_copy(
                update={
                    "status": AgentToolStatus.failed,
                    "completed_at": finished_at,
                    "elapsed_ms": round((perf_counter() - started_at) * 1000),
                    "error_type": type(error).__name__,
                }
            )
            self._replace_last_execution(execution)
            self._persist_step(execution)
            raise
        finished_at = datetime.now(timezone.utc)
        execution = running_execution.model_copy(
            update={
                "status": AgentToolStatus.completed,
                "completed_at": finished_at,
                "elapsed_ms": round((perf_counter() - started_at) * 1000),
                "checkpoint_type": checkpoint_type,
            }
        )
        self._replace_last_execution(execution)
        self._persist_step(
            execution,
            checkpoint_type=checkpoint_type,
            checkpoint_payload=checkpoint_payload,
        )
        return result

    def _run_with_heartbeat(self, operation: Callable[[], ResultT]) -> ResultT:
        if self._store is None:
            return operation()
        stopped = threading.Event()

        def renew_lease() -> None:
            while not stopped.wait(AGENT_HEARTBEAT_INTERVAL_SECONDS):
                try:
                    self._store.heartbeat(self._record.run_id)
                except Exception as error:
                    logger.warning(
                        "Agent heartbeat failed run=%s error_type=%s",
                        self._record.run_id,
                        type(error).__name__,
                    )

        worker = threading.Thread(target=renew_lease, daemon=True)
        worker.start()
        try:
            return operation()
        finally:
            stopped.set()
            worker.join(timeout=1)

    def save_current_tool_checkpoint(
        self,
        *,
        tool_name: str,
        checkpoint_type: str,
        checkpoint_payload: dict[str, Any],
    ) -> None:
        """Persist a validated intermediate result without completing the tool."""

        self._require_running()
        if not self._record.tool_executions:
            raise AgentPolicyViolationError("No Agent tool is currently running.")
        execution = self._record.tool_executions[-1]
        if (
            execution.tool_name != tool_name
            or execution.status != AgentToolStatus.running
        ):
            raise AgentPolicyViolationError(
                f"Agent tool '{tool_name}' is not the current running tool."
            )
        checkpointed_execution = execution.model_copy(
            update={"checkpoint_type": checkpoint_type}
        )
        self._replace_last_execution(checkpointed_execution)
        self._persist_step(
            checkpointed_execution,
            checkpoint_type=checkpoint_type,
            checkpoint_payload=checkpoint_payload,
        )

    def complete(
        self,
        *,
        result_type: str | None = None,
        result_payload: dict[str, Any] | None = None,
    ) -> AgentRunRecord:
        self._require_running()
        self._record.status = AgentRunStatus.completed
        self._record.completed_at = datetime.now(timezone.utc)
        self._record.updated_at = self._record.completed_at
        self._record.result_type = result_type
        if self._store is not None:
            self._store.save_record(self._record, result_payload=result_payload)
        self._log_completion()
        return self._record

    def fail(self, error: Exception) -> AgentRunRecord:
        if self._record.status != AgentRunStatus.running:
            return self._record
        self._record.status = AgentRunStatus.failed
        self._record.completed_at = datetime.now(timezone.utc)
        self._record.updated_at = self._record.completed_at
        self._record.failure_type = type(error).__name__
        if self._store is not None:
            self._store.save_record(self._record)
        self._log_completion()
        return self._record

    def _replace_last_execution(self, execution: AgentToolExecution) -> None:
        self._record.tool_executions[-1] = execution

    def _persist_step(
        self,
        execution: AgentToolExecution,
        *,
        checkpoint_type: str | None = None,
        checkpoint_payload: dict[str, Any] | None = None,
    ) -> None:
        self._record.updated_at = datetime.now(timezone.utc)
        if self._store is not None:
            self._store.save_step(
                self._record,
                execution,
                checkpoint_type=checkpoint_type,
                checkpoint_payload=checkpoint_payload,
            )
        logger.info(
            "Agent tool state run=%s agent=%s subject=%s step=%d tool=%s "
            "kind=%s status=%s elapsed_ms=%d error_type=%s",
            self._record.run_id,
            self._record.agent_name,
            self._record.subject_ref,
            execution.step,
            execution.tool_name,
            execution.kind.value,
            execution.status.value,
            execution.elapsed_ms,
            execution.error_type or "none",
        )

    def _require_running(self) -> None:
        if self._record.status != AgentRunStatus.running:
            raise AgentPolicyViolationError(
                f"Agent run '{self._record.run_id}' is already finalized."
            )

    def _log_completion(self) -> None:
        elapsed_ms = 0
        if self._record.completed_at is not None:
            elapsed_ms = round(
                (
                    self._record.completed_at - self._record.started_at
                ).total_seconds()
                * 1000
            )
        logger.info(
            "Agent run finished run=%s agent=%s subject=%s status=%s steps=%d "
            "model_tool_calls=%d elapsed_ms=%d failure_type=%s",
            self._record.run_id,
            self._record.agent_name,
            self._record.subject_ref,
            self._record.status.value,
            len(self._record.tool_executions),
            self._record.model_tool_call_count,
            elapsed_ms,
            self._record.failure_type or "none",
        )
