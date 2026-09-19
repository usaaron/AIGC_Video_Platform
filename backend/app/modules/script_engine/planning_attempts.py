"""Append-only model candidates, isolated from approved story versions.

Parsed replies retain every narrative field; malformed replies retain the raw
provider text. They are evidence, never an approved node or a reusable PASS.
"""

from __future__ import annotations

import hashlib
import json
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Iterator, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import select

from app.database import DatabaseRuntime
from app.document_repository import ModuleDocumentRecord


ATTEMPT_NAMESPACE = "planning_decomposition_attempts.v1"
logger = logging.getLogger(__name__)


def _stored_error_detail(error: Exception | None) -> str | None:
    if error is None:
        return None
    # Provider/transport messages can echo credentials. Persist their typed
    # status only; requests, headers, URLs and provider error bodies stay out.
    from app.modules.script_engine.llm_adapter import LLMRequestError
    if isinstance(error, LLMRequestError):
        return f"{type(error).__name__}: status={error.status_code} category={error.category}"
    module = type(error).__module__
    if module.startswith("pydantic") or module in {
        "app.modules.script_engine.story_planning_service",
        "app.modules.script_engine.planning_errors",
    }:
        return str(error)
    # Unexpected exceptions have no established safe message contract.
    return type(error).__name__


def planning_attempt_fingerprint(context: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(
        context, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")).hexdigest()


class PlanningAttemptBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    story_project_id: str
    parent_node_id: str
    parent_node_version: int = Field(ge=1)
    request_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    operation_id: str


class PlanningAttemptRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(default_factory=lambda: str(uuid4()))
    attempt_id: str
    binding: PlanningAttemptBinding
    kind: Literal["candidate", "error", "completed", "failed"]
    artifact: str
    candidate: dict[str, Any] | str | None = None
    error_type: str | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PlanningAttemptRepository:
    def __init__(self, runtime: DatabaseRuntime) -> None:
        self.runtime = runtime

    def append(self, record: PlanningAttemptRecord) -> None:
        # Plain INSERT deliberately rejects duplicate IDs; an older candidate
        # cannot be overwritten by a repair or a concurrent request.
        with self.runtime.session() as session:
            session.add(ModuleDocumentRecord(
                namespace=ATTEMPT_NAMESPACE, document_id=record.id,
                created_at=record.created_at, updated_at=record.created_at,
                payload=record.model_dump(mode="json"),
            ))

    def list_for_binding(self, binding: PlanningAttemptBinding) -> list[PlanningAttemptRecord]:
        with self.runtime.session() as session:
            rows = session.exec(select(ModuleDocumentRecord).where(
                ModuleDocumentRecord.namespace == ATTEMPT_NAMESPACE,
                ModuleDocumentRecord.payload["binding"]["story_project_id"].as_string()
                == binding.story_project_id,
                ModuleDocumentRecord.payload["binding"]["parent_node_id"].as_string()
                == binding.parent_node_id,
            ).order_by(ModuleDocumentRecord.created_at, ModuleDocumentRecord.document_id)).all()
            records = [PlanningAttemptRecord.model_validate(row.payload) for row in rows]
        return [record for record in records if record.binding == binding]


class PlanningAttemptRecorder:
    def __init__(self, repository: PlanningAttemptRepository, binding: PlanningAttemptBinding):
        self.repository = repository
        self.binding = binding
        self.attempt_id = str(uuid4())

    def record(self, kind: str, artifact: str, *, candidate=None, error=None) -> None:
        self.repository.append(PlanningAttemptRecord(
            attempt_id=self.attempt_id, binding=self.binding, kind=kind,
            artifact=artifact, candidate=candidate,
            error_type=type(error).__name__ if error is not None else None,
            error=_stored_error_detail(error),
        ))

    def record_error(self, kind: str, artifact: str, error: Exception) -> None:
        try:
            self.record(kind, artifact, candidate=getattr(error, "raw_content", None), error=error)
        except Exception as storage_error:
            # A secondary evidence failure must not replace the exception the
            # caller needs to handle. Do not log either exception's raw text.
            logger.warning("Planning error evidence was not saved error_type=%s storage_error_type=%s",
                           type(error).__name__, type(storage_error).__name__)


_recorder: ContextVar[PlanningAttemptRecorder | None] = ContextVar(
    "planning_attempt_recorder", default=None,
)


@contextmanager
def bind_planning_attempt(
    repository: PlanningAttemptRepository | None, binding: PlanningAttemptBinding,
) -> Iterator[None]:
    recorder = PlanningAttemptRecorder(repository, binding) if repository else None
    token = _recorder.set(recorder)
    try:
        yield
    except Exception as error:
        if recorder:
            recorder.record_error("failed", "decomposition", error)
        raise
    else:
        if recorder:
            recorder.record("completed", "decomposition")
    finally:
        _recorder.reset(token)


def capture_planning_candidate(artifact: str, candidate: dict[str, Any] | str) -> None:
    recorder = _recorder.get()
    if recorder:
        recorder.record("candidate", artifact, candidate=candidate)


def capture_planning_error(artifact: str, error: Exception) -> None:
    recorder = _recorder.get()
    if recorder:
        recorder.record_error("error", artifact, error)


def load_planning_resume_candidates(request_fingerprints: list[str]) -> list[dict[str, Any]]:
    """Read candidates from explicitly compatible requests within this exact scope.

    Callers choose prior request contracts; project, source, parent version and
    operation identity always remain those of the active recorder. A candidate
    still needs the current complete validation before it can become a node.
    """
    recorder = _recorder.get()
    if recorder is None:
        return []
    records: list[PlanningAttemptRecord] = []
    for fingerprint in dict.fromkeys(request_fingerprints):
        binding = PlanningAttemptBinding.model_validate({
            **recorder.binding.model_dump(), "request_fingerprint": fingerprint,
        })
        records.extend(recorder.repository.list_for_binding(binding))
    records.sort(key=lambda record: (record.created_at, record.id))
    return [deepcopy(record.candidate) for record in records
            if record.kind == "candidate" and isinstance(record.candidate, dict)]
