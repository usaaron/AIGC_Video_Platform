from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from app.database import DatabaseRuntime
from app.modules.agent_runtime.models import (
    AgentRunPolicy,
    AgentRunRecord,
    AgentToolExecution,
)
from app.modules.agent_runtime.repository import (
    AgentRunInProgressError,
    AgentRunPersistenceConflictError,
    AgentRunRepository,
)
from app.modules.agent_runtime.runtime import AgentSession


@dataclass(frozen=True)
class AgentSessionStart:
    record: AgentRunRecord
    session: AgentSession | None
    result_payload: dict[str, Any] | None = None


class AgentRunPersistenceUnavailableError(RuntimeError):
    pass


class AgentRunService:
    """Transaction boundary for sanitized Agent state and checkpoints."""

    def __init__(
        self,
        database_runtime: DatabaseRuntime | None,
        *,
        instance_id: str | None = None,
    ) -> None:
        self._database_runtime = database_runtime
        configured_instance_id = (
            instance_id
            if instance_id is not None
            else os.getenv("AGENT_RUNTIME_INSTANCE_ID")
        )
        self._instance_id = configured_instance_id.strip() if configured_instance_id else None

    @property
    def available(self) -> bool:
        return self._database_runtime is not None

    def _runtime(self) -> DatabaseRuntime:
        if self._database_runtime is None:
            raise AgentRunPersistenceUnavailableError(
                "Agent persistence requires DATABASE_URL."
            )
        return self._database_runtime

    def start_session(
        self,
        *,
        agent_name: str,
        subject_ref: str,
        policy: AgentRunPolicy,
        request_key: str | None,
        input_fingerprint: str,
        project_id: str | None = None,
        episode_number: int | None = None,
        planning_revision_epoch: int = 0,
    ) -> AgentSessionStart:
        record = AgentRunRecord(
            agent_name=agent_name,
            subject_ref=subject_ref,
            request_key=request_key or f"agent-request.{uuid4()}",
            input_fingerprint=input_fingerprint,
            project_id=project_id,
            episode_number=episode_number,
            planning_revision_epoch=planning_revision_epoch,
            owner_instance_id=self._instance_id,
            policy=policy,
        )
        try:
            with self._runtime().session() as session:
                self._lock_and_check_planning(session, record)
                started = AgentRunRepository(session).start_or_resume(record)
        except IntegrityError:
            # A concurrent request may have inserted the same request key after
            # our initial lookup. Re-read it through the normal replay/lease path.
            with self._runtime().session() as session:
                self._lock_and_check_planning(session, record)
                started = AgentRunRepository(session).start_or_resume(record)
        if started.result_payload is not None:
            return AgentSessionStart(
                record=started.record,
                session=None,
                result_payload=started.result_payload,
            )
        return AgentSessionStart(
            record=started.record,
            session=AgentSession(
                agent_name=started.record.agent_name,
                subject_ref=started.record.subject_ref,
                policy=started.record.policy,
                record=started.record,
                store=self,
            ),
        )

    @staticmethod
    def _lock_and_check_planning(session: Any, record: AgentRunRecord) -> None:
        from app.modules.script_engine.long_story_repository import LongStoryRepository, LongStoryPersistenceConflictError
        from app.modules.script_engine.planning_revision import require_request_epoch
        if not record.project_id:
            return
        repository = LongStoryRepository(session)
        repository.get_project_for_update(record.project_id)
        workspace = repository.get_workspace_snapshot(record.project_id)
        try:
            require_request_epoch(workspace.workspace_payload if workspace else {}, record.planning_revision_epoch,
                                  body=record.agent_name == "episode_script",
                                  episode_number=record.episode_number if record.agent_name in {"episode_roadmap", "episode_roadmap_chunk"} else None)
        except LongStoryPersistenceConflictError as exc:
            raise AgentRunPersistenceConflictError(str(exc)) from exc

    def save_record(
        self,
        record: AgentRunRecord,
        *,
        result_payload: dict[str, Any] | None = None,
    ) -> AgentRunRecord:
        with self._runtime().session() as session:
            return AgentRunRepository(session).save_record(
                record,
                result_payload=result_payload,
            )

    def save_step(
        self,
        record: AgentRunRecord,
        execution: AgentToolExecution,
        *,
        checkpoint_type: str | None = None,
        checkpoint_payload: dict[str, Any] | None = None,
    ) -> None:
        with self._runtime().session() as session:
            repository = AgentRunRepository(session)
            repository.save_step(
                record.run_id,
                execution,
                checkpoint_type=checkpoint_type,
                checkpoint_payload=checkpoint_payload,
            )
            repository.save_record(record)

    def load_tool_checkpoint(
        self,
        run_id: str,
        tool_name: str,
    ) -> tuple[str, dict[str, Any]] | None:
        with self._runtime().session() as session:
            return AgentRunRepository(session).load_tool_checkpoint(run_id, tool_name)

    def load_tool_recovery_checkpoint(
        self,
        run_id: str,
        tool_name: str,
        checkpoint_type: str,
    ) -> dict[str, Any] | None:
        with self._runtime().session() as session:
            return AgentRunRepository(session).load_tool_recovery_checkpoint(
                run_id,
                tool_name,
                checkpoint_type,
            )

    def heartbeat(self, run_id: str) -> None:
        with self._runtime().session() as session:
            AgentRunRepository(session).heartbeat(run_id)

    def get_run(self, run_id: str) -> AgentRunRecord | None:
        with self._runtime().session() as session:
            return AgentRunRepository(session).get_run(run_id)

    def list_runs(
        self,
        *,
        project_id: str | None = None,
        episode_number: int | None = None,
        limit: int = 50,
    ) -> list[AgentRunRecord]:
        with self._runtime().session() as session:
            return AgentRunRepository(session).list_runs(
                project_id=project_id,
                episode_number=episode_number,
                limit=limit,
            )

    def delete_project_runs(self, project_id: str) -> int:
        with self._runtime().session() as session:
            return AgentRunRepository(session).delete_project_runs(project_id)


def fingerprint_input(value: BaseModel | dict[str, Any]) -> str:
    payload = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


__all__ = [
    "AgentRunInProgressError",
    "AgentRunPersistenceConflictError",
    "AgentRunPersistenceUnavailableError",
    "AgentRunService",
    "AgentSessionStart",
    "fingerprint_input",
]
