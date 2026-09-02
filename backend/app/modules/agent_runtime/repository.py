from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlmodel import Session, col, select

from app.modules.agent_runtime.models import (
    AgentRunRecord,
    AgentRunStatus,
    AgentToolExecution,
    AgentToolKind,
    AgentToolStatus,
)
from app.modules.agent_runtime.persistence import (
    AgentRunRecordTable,
    AgentStepRecordTable,
)


MAX_AGENT_RESULT_BYTES = 5_000_000
# A single screenplay model call can legitimately take 10-12 minutes. Keep the
# lease longer than that so a browser refresh cannot start a second owner while
# the original server worker is still producing or finalizing the same episode.
# A restarted backend still takes over immediately through owner_instance_id.
DEFAULT_AGENT_LEASE_SECONDS = 30 * 60
logger = logging.getLogger(__name__)
_REQUEST_REVISION_SEGMENT = re.compile(
    r"\.revision-\d+(?=\.episode-\d+$)",
    re.IGNORECASE,
)


class AgentRunPersistenceConflictError(RuntimeError):
    pass


class AgentRunInProgressError(RuntimeError):
    def __init__(self, run_id: str, *, same_request: bool = True) -> None:
        self.run_id = run_id
        self.same_request = same_request
        super().__init__("The requested Agent run is still in progress.")


@dataclass(frozen=True)
class AgentRunStart:
    record: AgentRunRecord
    result_payload: dict[str, Any] | None = None


class AgentRunRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def start_or_resume(
        self,
        record: AgentRunRecord,
        *,
        lease_seconds: int = DEFAULT_AGENT_LEASE_SECONDS,
    ) -> AgentRunStart:
        existing = self._session.exec(
            select(AgentRunRecordTable).where(
                AgentRunRecordTable.request_key == record.request_key
            )
        ).first()
        if existing is None:
            existing = self._find_compatible_revision_run(record)
        if existing is None:
            self._release_or_reject_episode_lease(
                record,
                lease_seconds=lease_seconds,
            )
            self._session.add(
                AgentRunRecordTable(
                    run_id=record.run_id,
                    request_key=record.request_key,
                    agent_name=record.agent_name,
                    subject_ref=record.subject_ref,
                    project_id=record.project_id,
                    episode_number=record.episode_number,
                    input_fingerprint=record.input_fingerprint,
                    status=record.status.value,
                    attempt_count=record.attempt_count,
                    started_at=record.started_at,
                    updated_at=record.updated_at,
                    completed_at=record.completed_at,
                    failure_type=record.failure_type,
                    result_type=record.result_type,
                    payload=record.model_dump(mode="json"),
                )
            )
            self._session.flush()
            return AgentRunStart(record=record)

        current = self._from_table(existing)
        if current.agent_name != record.agent_name or current.subject_ref != record.subject_ref:
            raise AgentRunPersistenceConflictError(
                "Agent request key does not match the original subject."
            )
        if (
            current.status == AgentRunStatus.completed
            and current.agent_name == "episode_script"
            and current.result_type == "episode_script_run.v1"
            and current.project_id == record.project_id
            and current.episode_number == record.episode_number
            and existing.result_payload is not None
        ):
            # A browser recovery can rebuild continuity after this episode was
            # generated but before the large workspace snapshot was saved. The
            # stable request key identifies the immutable episode result, so
            # replay it instead of rejecting the refreshed browser context.
            return AgentRunStart(
                record=current,
                result_payload=existing.result_payload,
            )
        now = datetime.now(timezone.utc)
        replaced_process = _lease_owned_by_replaced_instance(current, record)
        if current.status == AgentRunStatus.running and not replaced_process and _is_recent(
            current.updated_at,
            now=now,
            lease_seconds=lease_seconds,
        ):
            # Report the actual state before comparing a refreshed browser's
            # derived context fingerprint. The stable request key owns this
            # immutable episode; a second caller should wait and replay it.
            raise AgentRunInProgressError(current.run_id)
        if current.input_fingerprint != record.input_fingerprint:
            refresh_mode = self._input_refresh_mode(current, record)
            if refresh_mode is None:
                raise AgentRunPersistenceConflictError(
                    "Agent request key was reused with different input."
                )
            logger.info(
                "Refreshing Agent input run=%s agent=%s episode=%s mode=%s",
                current.run_id,
                current.agent_name,
                current.episode_number,
                refresh_mode,
            )
            current = current.model_copy(
                update={"input_fingerprint": record.input_fingerprint}
            )
        if current.status == AgentRunStatus.completed:
            if existing.result_payload is None:
                raise AgentRunPersistenceConflictError(
                    "Completed Agent run is missing its validated result checkpoint."
                )
            return AgentRunStart(
                record=current,
                result_payload=existing.result_payload,
            )
        if replaced_process:
            logger.warning(
                "Recovering Agent lease from replaced runtime run=%s old_instance=%s "
                "new_instance=%s",
                current.run_id,
                current.owner_instance_id,
                record.owner_instance_id,
            )

        self._release_or_reject_episode_lease(
            record,
            lease_seconds=lease_seconds,
            exclude_run_id=current.run_id,
        )

        recovered_executions = self._recover_stale_executions(current, now=now)
        resumed = current.model_copy(
            update={
                "status": AgentRunStatus.running,
                "attempt_count": current.attempt_count + 1,
                "policy": record.policy,
                "owner_instance_id": record.owner_instance_id,
                "updated_at": now,
                "completed_at": None,
                "failure_type": None,
                "tool_executions": recovered_executions,
            }
        )
        self._save_record(existing, resumed)
        return AgentRunStart(record=resumed)

    def _input_refresh_mode(
        self,
        current: AgentRunRecord,
        requested: AgentRunRecord,
    ) -> str | None:
        if (
            current.agent_name != requested.agent_name
            or current.subject_ref != requested.subject_ref
        ):
            return None
        if self._can_refresh_post_edit_resume_input(current, requested):
            return "validated_post_edit_checkpoint"
        if self._can_refresh_failed_empty_episode_script(current):
            return "failed_without_checkpoint"
        return None

    def _can_refresh_post_edit_resume_input(
        self,
        current: AgentRunRecord,
        requested: AgentRunRecord,
    ) -> bool:
        """Allow only a saved episode pre-edit checkpoint to cross a context refresh.

        The browser can refresh continuity summaries after a neighboring episode
        is durably saved. That changes the request fingerprint even though the
        failed run's DeepSeek draft is the exact source that GPT finalization
        must resume. Never relax the input contract for a run without this
        validated checkpoint.
        """

        failed_during_finalization = any(
            execution.tool_name == "finalize_episode_script"
            and execution.kind == AgentToolKind.model
            and execution.status == AgentToolStatus.failed
            and execution.error_type == current.failure_type
            for execution in current.tool_executions
        )
        if (
            current.status != AgentRunStatus.failed
            or current.agent_name != "episode_script"
            or requested.agent_name != current.agent_name
            or (
                current.failure_type not in {
                    "InvalidScriptPostEditError",
                    "LLMRequestError",
                    "LLMStructuredOutputError",
                }
                and not failed_during_finalization
            )
        ):
            return False
        checkpoint = self._load_run_tool_checkpoint(
            current.run_id,
            "generate_pre_edit_episode_script",
        )
        return checkpoint is not None and checkpoint[0] == "episode_script_pre_edit_run.v2"

    def _can_refresh_failed_empty_episode_script(
        self,
        current: AgentRunRecord,
    ) -> bool:
        """Allow a fresh input only when a failed script run produced no artifact.

        A failed model call can leave a durable run row behind before returning
        an upstream error. Reusing the same request key is safe in that narrow
        case because there is no validated checkpoint to invalidate and no
        completed persistence step that could have changed the project.
        """

        if (
            current.status != AgentRunStatus.failed
            or current.agent_name != "episode_script"
            or current.result_type is not None
        ):
            return False
        if self._run_has_any_checkpoint(current.run_id):
            return False
        return not any(
            execution.kind == AgentToolKind.persistence
            and execution.status == AgentToolStatus.completed
            for execution in current.tool_executions
        )

    def _run_has_any_checkpoint(self, run_id: str) -> bool:
        return self._session.exec(
            select(AgentStepRecordTable).where(
                AgentStepRecordTable.run_id == run_id,
                AgentStepRecordTable.status == AgentToolStatus.completed.value,
                AgentStepRecordTable.checkpoint_payload.is_not(None),
            )
        ).first() is not None

    def _find_compatible_revision_run(
        self,
        requested: AgentRunRecord,
    ) -> AgentRunRecordTable | None:
        """Reuse a same-job checkpoint created under the legacy revision key."""

        if requested.project_id is None or requested.episode_number is None:
            return None
        request_family = _agent_request_family(requested.request_key)
        candidates = self._session.exec(
            select(AgentRunRecordTable)
            .where(
                AgentRunRecordTable.agent_name == requested.agent_name,
                AgentRunRecordTable.subject_ref == requested.subject_ref,
                AgentRunRecordTable.project_id == requested.project_id,
                AgentRunRecordTable.episode_number == requested.episode_number,
                AgentRunRecordTable.input_fingerprint == requested.input_fingerprint,
            )
            .order_by(col(AgentRunRecordTable.updated_at).desc())
            .limit(20)
        ).all()
        return next(
            (
                candidate
                for candidate in candidates
                if _agent_request_family(candidate.request_key) == request_family
            ),
            None,
        )

    def _release_or_reject_episode_lease(
        self,
        requested: AgentRunRecord,
        *,
        lease_seconds: int,
        exclude_run_id: str | None = None,
    ) -> None:
        if requested.project_id is None or requested.episode_number is None:
            return
        statement = select(AgentRunRecordTable).where(
            AgentRunRecordTable.project_id == requested.project_id,
            AgentRunRecordTable.episode_number == requested.episode_number,
            AgentRunRecordTable.status == AgentRunStatus.running.value,
        )
        if exclude_run_id is not None:
            statement = statement.where(
                AgentRunRecordTable.run_id != exclude_run_id
            )
        active = self._session.exec(statement).first()
        if active is None:
            return
        current = self._from_table(active)
        now = datetime.now(timezone.utc)
        if not _lease_owned_by_replaced_instance(current, requested) and _is_recent(
            current.updated_at,
            now=now,
            lease_seconds=lease_seconds,
        ):
            raise AgentRunInProgressError(current.run_id, same_request=False)

        recovered_executions = self._recover_stale_executions(current, now=now)
        stale = current.model_copy(
            update={
                "status": AgentRunStatus.failed,
                "updated_at": now,
                "completed_at": now,
                "failure_type": "stale_episode_lease_recovered",
                "tool_executions": recovered_executions,
            }
        )
        self._save_record(active, stale)

    def _recover_stale_executions(
        self,
        record: AgentRunRecord,
        *,
        now: datetime,
    ) -> list[AgentToolExecution]:
        recovered: list[AgentToolExecution] = []
        for execution in record.tool_executions:
            if execution.status != AgentToolStatus.running:
                recovered.append(execution)
                continue
            recovered.append(
                execution.model_copy(
                    update={
                        "status": AgentToolStatus.failed,
                        "completed_at": now,
                        "error_type": "stale_run_recovered",
                    }
                )
            )
            table_step = self._session.get(
                AgentStepRecordTable,
                (record.run_id, execution.attempt, execution.step),
            )
            if table_step is not None:
                table_step.status = AgentToolStatus.failed.value
                table_step.completed_at = now
                table_step.error_type = "stale_run_recovered"
        return recovered

    def save_record(
        self,
        record: AgentRunRecord,
        *,
        result_payload: dict[str, Any] | None = None,
    ) -> AgentRunRecord:
        table_record = self._session.get(AgentRunRecordTable, record.run_id)
        if table_record is None:
            raise AgentRunPersistenceConflictError(
                f"Agent run {record.run_id} does not exist."
            )
        if table_record.status != AgentRunStatus.running.value:
            raise AgentRunPersistenceConflictError(
                f"Agent run {record.run_id} no longer owns an active lease."
            )
        if result_payload is not None:
            encoded = json.dumps(
                result_payload,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            if len(encoded) > MAX_AGENT_RESULT_BYTES:
                raise AgentRunPersistenceConflictError(
                    "Agent result checkpoint exceeds the 5 MB limit."
                )
        self._save_record(table_record, record, result_payload=result_payload)
        return record

    def save_step(
        self,
        run_id: str,
        execution: AgentToolExecution,
        *,
        checkpoint_type: str | None = None,
        checkpoint_payload: dict[str, Any] | None = None,
    ) -> None:
        parent = self._session.get(AgentRunRecordTable, run_id)
        if parent is None or parent.status != AgentRunStatus.running.value:
            raise AgentRunPersistenceConflictError(
                f"Agent run {run_id} no longer owns an active lease."
            )
        if checkpoint_payload is not None:
            self._validate_checkpoint_size(checkpoint_payload)
        table_step = self._session.get(
            AgentStepRecordTable,
            (run_id, execution.attempt, execution.step),
        )
        values = {
            "run_id": run_id,
            "attempt": execution.attempt,
            "step": execution.step,
            "tool_name": execution.tool_name,
            "kind": execution.kind.value,
            "status": execution.status.value,
            "started_at": execution.started_at,
            "completed_at": execution.completed_at,
            "elapsed_ms": execution.elapsed_ms,
            "error_type": execution.error_type,
            "checkpoint_type": checkpoint_type or execution.checkpoint_type,
            "checkpoint_payload": checkpoint_payload,
        }
        if table_step is None:
            self._session.add(AgentStepRecordTable(**values))
        else:
            for name, value in values.items():
                if (
                    name in {"checkpoint_type", "checkpoint_payload"}
                    and value is None
                    and getattr(table_step, name) is not None
                ):
                    # A failed/superseded execution still owns the last
                    # validated in-tool checkpoint. Preserve it so a retry can
                    # resume after the last successful model pass.
                    continue
                setattr(table_step, name, value)
        self._session.flush()

    @staticmethod
    def _validate_checkpoint_size(payload: dict[str, Any]) -> None:
        encoded = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        if len(encoded) > MAX_AGENT_RESULT_BYTES:
            raise AgentRunPersistenceConflictError(
                "Agent checkpoint exceeds the 5 MB limit."
            )

    def load_tool_checkpoint(
        self,
        run_id: str,
        tool_name: str,
    ) -> tuple[str, dict[str, Any]] | None:
        checkpoint = self._load_run_tool_checkpoint(run_id, tool_name)
        if checkpoint is not None:
            return checkpoint

        current = self._session.get(AgentRunRecordTable, run_id)
        if (
            current is None
            or current.project_id is None
            or current.episode_number is None
        ):
            return None

        # A process can die after creating the new stable request record but
        # before saving its first checkpoint. In that case an older legacy
        # revision-key run may still hold a validated checkpoint for exactly
        # the same input. Search the request family rather than letting the
        # empty newer record force an expensive model regeneration.
        request_family = _agent_request_family(current.request_key)
        candidates = self._session.exec(
            select(AgentRunRecordTable)
            .where(
                AgentRunRecordTable.run_id != current.run_id,
                AgentRunRecordTable.agent_name == current.agent_name,
                AgentRunRecordTable.subject_ref == current.subject_ref,
                AgentRunRecordTable.project_id == current.project_id,
                AgentRunRecordTable.episode_number == current.episode_number,
                AgentRunRecordTable.input_fingerprint == current.input_fingerprint,
            )
            .order_by(col(AgentRunRecordTable.updated_at).desc())
            .limit(20)
        ).all()
        for candidate in candidates:
            if _agent_request_family(candidate.request_key) != request_family:
                continue
            checkpoint = self._load_run_tool_checkpoint(
                candidate.run_id,
                tool_name,
            )
            if checkpoint is not None:
                logger.info(
                    "Reusing compatible Agent checkpoint run=%s source_run=%s "
                    "tool=%s",
                    current.run_id,
                    candidate.run_id,
                    tool_name,
                )
                return checkpoint
        return None

    def load_tool_recovery_checkpoint(
        self,
        run_id: str,
        tool_name: str,
        checkpoint_type: str,
    ) -> dict[str, Any] | None:
        checkpoint = self._load_run_tool_recovery_checkpoint(
            run_id,
            tool_name,
            checkpoint_type,
        )
        if checkpoint is not None:
            return checkpoint

        current = self._session.get(AgentRunRecordTable, run_id)
        if (
            current is None
            or current.project_id is None
            or current.episode_number is None
        ):
            return None
        request_family = _agent_request_family(current.request_key)
        candidates = self._session.exec(
            select(AgentRunRecordTable)
            .where(
                AgentRunRecordTable.run_id != current.run_id,
                AgentRunRecordTable.agent_name == current.agent_name,
                AgentRunRecordTable.subject_ref == current.subject_ref,
                AgentRunRecordTable.project_id == current.project_id,
                AgentRunRecordTable.episode_number == current.episode_number,
                AgentRunRecordTable.input_fingerprint == current.input_fingerprint,
            )
            .order_by(col(AgentRunRecordTable.updated_at).desc())
            .limit(20)
        ).all()
        for candidate in candidates:
            if _agent_request_family(candidate.request_key) != request_family:
                continue
            checkpoint = self._load_run_tool_recovery_checkpoint(
                candidate.run_id,
                tool_name,
                checkpoint_type,
            )
            if checkpoint is not None:
                return checkpoint
        return None

    def _load_run_tool_recovery_checkpoint(
        self,
        run_id: str,
        tool_name: str,
        checkpoint_type: str,
    ) -> dict[str, Any] | None:
        record = self._session.exec(
            select(AgentStepRecordTable)
            .where(
                AgentStepRecordTable.run_id == run_id,
                AgentStepRecordTable.tool_name == tool_name,
                AgentStepRecordTable.checkpoint_type == checkpoint_type,
                AgentStepRecordTable.checkpoint_payload.is_not(None),
            )
            .order_by(
                col(AgentStepRecordTable.attempt).desc(),
                col(AgentStepRecordTable.step).desc(),
            )
        ).first()
        return record.checkpoint_payload if record is not None else None

    def _load_run_tool_checkpoint(
        self,
        run_id: str,
        tool_name: str,
    ) -> tuple[str, dict[str, Any]] | None:
        record = self._session.exec(
            select(AgentStepRecordTable)
            .where(
                AgentStepRecordTable.run_id == run_id,
                AgentStepRecordTable.tool_name == tool_name,
                AgentStepRecordTable.status == AgentToolStatus.completed.value,
                AgentStepRecordTable.checkpoint_payload.is_not(None),
            )
            .order_by(
                col(AgentStepRecordTable.attempt).desc(),
                col(AgentStepRecordTable.step).desc(),
            )
        ).first()
        if record is None or record.checkpoint_payload is None:
            return None
        return record.checkpoint_type or "agent.checkpoint.v1", record.checkpoint_payload

    def heartbeat(self, run_id: str) -> None:
        record = self._session.get(AgentRunRecordTable, run_id)
        if record is None or record.status != AgentRunStatus.running.value:
            return
        now = datetime.now(timezone.utc)
        payload = dict(record.payload)
        payload["updated_at"] = now.isoformat()
        record.updated_at = now
        record.payload = payload
        self._session.flush()

    def get_run(self, run_id: str) -> AgentRunRecord | None:
        record = self._session.get(AgentRunRecordTable, run_id)
        return self._from_table(record) if record is not None else None

    def list_runs(
        self,
        *,
        project_id: str | None = None,
        episode_number: int | None = None,
        limit: int = 50,
    ) -> list[AgentRunRecord]:
        statement = select(AgentRunRecordTable).order_by(
            col(AgentRunRecordTable.updated_at).desc()
        ).limit(limit)
        if project_id is not None:
            statement = statement.where(AgentRunRecordTable.project_id == project_id)
        if episode_number is not None:
            statement = statement.where(
                AgentRunRecordTable.episode_number == episode_number
            )
        return [self._from_table(row) for row in self._session.exec(statement).all()]

    def delete_project_runs(self, project_id: str) -> int:
        runs = self._session.exec(
            select(AgentRunRecordTable).where(
                AgentRunRecordTable.project_id == project_id
            )
        ).all()
        for run in runs:
            self._session.delete(run)
        self._session.flush()
        return len(runs)

    @staticmethod
    def _from_table(record: AgentRunRecordTable) -> AgentRunRecord:
        return AgentRunRecord.model_validate(record.payload)

    @staticmethod
    def _save_record(
        table_record: AgentRunRecordTable,
        record: AgentRunRecord,
        *,
        result_payload: dict[str, Any] | None = None,
    ) -> None:
        table_record.status = record.status.value
        table_record.attempt_count = record.attempt_count
        table_record.updated_at = record.updated_at
        table_record.completed_at = record.completed_at
        table_record.failure_type = record.failure_type
        table_record.result_type = record.result_type
        if result_payload is not None:
            table_record.result_payload = result_payload
        table_record.payload = record.model_dump(mode="json")


def _agent_request_family(request_key: str) -> str:
    return _REQUEST_REVISION_SEGMENT.sub("", request_key.strip())


def _is_recent(
    value: datetime,
    *,
    now: datetime,
    lease_seconds: int,
) -> bool:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return now - value <= timedelta(seconds=lease_seconds)


def _lease_owned_by_replaced_instance(
    current: AgentRunRecord,
    requested: AgentRunRecord,
) -> bool:
    return bool(
        current.owner_instance_id
        and requested.owner_instance_id
        and current.owner_instance_id != requested.owner_instance_id
    )
