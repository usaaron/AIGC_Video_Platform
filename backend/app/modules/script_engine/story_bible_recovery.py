"""Durable, unapproved Story Bible candidates, separate from saved story versions.

Only schema-valid output belongs here; language/identity failures remain pending.
The caller owns bounded model/patch attempts and must run every quality gate before
saving a real Story Bible. No prompts, raw model responses, or approval are stored.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import Session, select

from app.database import DatabaseRuntime
from app.document_repository import DocumentRepository, ModuleDocumentRecord
from app.modules.script_engine.long_story_models import (
    IDENTIFIER_PATTERN,
    PlanningApprovalStatus,
    StoryBible,
    StoryBibleDraftRequest,
    StoryBibleGenerationOutput,
)
from app.modules.script_engine.long_story_persistence import StoryProjectRecord
from app.modules.script_engine.long_story_repository import LongStoryRepository, LongStoryPersistenceConflictError


RECOVERY_NAMESPACE = "story_bible_recovery.v1"


class StoryBibleRecoveryConflictError(LongStoryPersistenceConflictError):
    """A checkpoint no longer belongs to the current input, base, or attempt."""


def story_bible_request_fingerprint(
    request: StoryBibleDraftRequest,
    *,
    generation_context: Mapping[str, Any] | None = None,
) -> str:
    """Hash the complete request plus resolved prompt/spec/strategy context.

    Pass JSON-compatible context, including the actual prompt and any resolved
    generation configuration that must invalidate reuse. Only the hash is stored.
    Lists retain their order; object key ordering does not affect the fingerprint.
    """
    encoded = json.dumps(
        {
            "contract": RECOVERY_NAMESPACE,
            "request": request.model_dump(mode="json"),
            "generation_context": dict(generation_context or {}),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class StoryBibleRecoveryKey(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    request_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    base_story_bible_id: str | None = Field(
        default=None, min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN,
    )
    base_story_bible_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_base(self) -> StoryBibleRecoveryKey:
        if (self.base_story_bible_id is None) != (self.base_story_bible_version is None):
            raise ValueError("Base Story Bible ID and version must be supplied together.")
        return self

    @property
    def document_id(self) -> str:
        encoded = json.dumps(self.model_dump(mode="json"), sort_keys=True).encode("utf-8")
        return "bible-recovery." + hashlib.sha256(encoded).hexdigest()


class StoryBibleRecoveryCheckpoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    key: StoryBibleRecoveryKey
    candidate: StoryBibleGenerationOutput
    status: Literal["pending", "saved"] = "pending"
    attempt: int = Field(ge=1)
    revision: int = Field(ge=1)
    stage: str = Field(min_length=1, max_length=80)
    unresolved_fields: list[str] = Field(default_factory=list, max_length=1_000)
    created_at: datetime
    updated_at: datetime
    saved_story_bible_id: str | None = None
    saved_story_bible_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_identity(self) -> StoryBibleRecoveryCheckpoint:
        if self.id != self.key.document_id:
            raise ValueError("Checkpoint identity must match its recovery key.")
        if self.status == "saved":
            if not self.saved_story_bible_id or self.saved_story_bible_version is None:
                raise ValueError("A saved checkpoint must reference its persisted Story Bible.")
            if self.unresolved_fields:
                raise ValueError("A saved checkpoint cannot have unresolved fields.")
        elif self.saved_story_bible_id is not None or self.saved_story_bible_version is not None:
            raise ValueError("A pending checkpoint cannot claim a saved Story Bible.")
        if any(not field or len(field) > 240 for field in self.unresolved_fields):
            raise ValueError("Unresolved fields must be non-empty paths of at most 240 characters.")
        return self


class _RecoveryDocuments(DocumentRepository[StoryBibleRecoveryCheckpoint]):
    model_type = StoryBibleRecoveryCheckpoint
    namespace = RECOVERY_NAMESPACE


class StoryBibleRecoveryRepository:
    """One CAS head per input/base, with immutable history for each changed stage.

    ``previous=None`` begins an attempt only when no pending head exists. Resume
    with ``get_pending`` and pass its returned checkpoint as ``previous`` on each
    update. A successful stage must never silently overwrite a concurrent stage.
    """

    def __init__(self, runtime: DatabaseRuntime) -> None:
        self._runtime = runtime
        self._documents = _RecoveryDocuments(lambda: runtime)

    @staticmethod
    def _head(
        session: Session, key: StoryBibleRecoveryKey, *, lock: bool = False,
    ) -> StoryBibleRecoveryCheckpoint | None:
        statement = select(ModuleDocumentRecord).where(
            ModuleDocumentRecord.namespace == RECOVERY_NAMESPACE,
            ModuleDocumentRecord.document_id == key.document_id,
        )
        if lock:
            statement = statement.with_for_update()
        row = session.exec(statement).first()
        return StoryBibleRecoveryCheckpoint.model_validate(row.payload) if row else None

    @staticmethod
    def _base_matches(session: Session, key: StoryBibleRecoveryKey, *, lock: bool = False) -> bool:
        statement = select(StoryProjectRecord).where(
            StoryProjectRecord.project_id == key.story_project_id,
        )
        if lock:
            statement = statement.with_for_update()
        project = session.exec(statement).first()
        return bool(
            project is not None
            and project.status != "archived"
            and project.active_story_bible_id == key.base_story_bible_id
            and project.active_story_bible_version == key.base_story_bible_version
        )

    def get_pending(self, key: StoryBibleRecoveryKey) -> StoryBibleRecoveryCheckpoint | None:
        with self._runtime.session() as session:
            if not self._base_matches(session, key):
                return None
            checkpoint = self._head(session, key)
            return checkpoint if checkpoint and checkpoint.status == "pending" else None

    def list_history(self, key: StoryBibleRecoveryKey) -> list[StoryBibleRecoveryCheckpoint]:
        """Read exact-input history even after its base becomes stale; never resume it."""
        with self._runtime.session() as session:
            ids = session.exec(select(ModuleDocumentRecord.document_id).where(
                ModuleDocumentRecord.namespace == RECOVERY_NAMESPACE,
                ModuleDocumentRecord.document_id.like(key.document_id + ".r%"),
            )).all()
        return sorted(self._documents.list_by_ids(list(ids)), key=lambda item: item.revision)

    def save_pending(
        self,
        key: StoryBibleRecoveryKey,
        candidate: StoryBibleGenerationOutput,
        *,
        stage: str,
        previous: StoryBibleRecoveryCheckpoint | None = None,
        unresolved_fields: list[str] | None = None,
    ) -> StoryBibleRecoveryCheckpoint:
        # model_copy/model_construct can bypass Pydantic validation. Recheck the
        # whole structure before touching durable state, without relaxing language.
        candidate = StoryBibleGenerationOutput.model_validate(candidate.model_dump(mode="json"))
        with self._runtime.session() as session:
            if not self._base_matches(session, key, lock=True):
                raise StoryBibleRecoveryConflictError("Project or active Story Bible base has changed.")
            current = self._head(session, key)
            if previous is not None:
                self._require_previous(current, previous, key)
            elif current is not None and current.status == "pending":
                raise StoryBibleRecoveryConflictError("Resume the pending checkpoint before updating it.")
            now = datetime.now(timezone.utc)
            checkpoint = StoryBibleRecoveryCheckpoint(
                id=key.document_id,
                key=key,
                candidate=candidate,
                attempt=(current.attempt if previous is not None else (current.attempt + 1 if current else 1)),
                revision=current.revision + 1 if current else 1,
                stage=stage,
                unresolved_fields=list(dict.fromkeys(unresolved_fields or [])),
                created_at=current.created_at if previous is not None else now,
                updated_at=now,
            )
            if current is not None and previous is not None and all(
                getattr(current, field) == getattr(checkpoint, field)
                for field in ("candidate", "stage", "unresolved_fields")
            ):
                return current
            self._write(session, checkpoint, current.revision if current else 0)
            return checkpoint

    @staticmethod
    def _require_previous(
        current: StoryBibleRecoveryCheckpoint | None,
        previous: StoryBibleRecoveryCheckpoint,
        key: StoryBibleRecoveryKey,
    ) -> None:
        if (
            current is None or current.status != "pending" or previous.status != "pending"
            or previous.key != key or previous.id != current.id
            or previous.revision != current.revision or previous.attempt != current.attempt
        ):
            raise StoryBibleRecoveryConflictError("Checkpoint was superseded or already saved.")

    def mark_saved(
        self,
        checkpoint: StoryBibleRecoveryCheckpoint,
        *,
        saved_story_bible: StoryBible,
    ) -> StoryBibleRecoveryCheckpoint:
        """Reconcile an already persisted draft (legacy bookkeeping only).

        New generation must use LongStoryService's recovery_checkpoint argument
        so the formal draft and completion marker share a transaction.
        """
        with self._runtime.session() as session:
            return self.mark_saved_in_session(session, checkpoint, saved_story_bible=saved_story_bible)

    def require_pending_in_session(
        self,
        session: Session,
        checkpoint: StoryBibleRecoveryCheckpoint,
        *,
        story_project_id: str,
    ) -> None:
        """Fence a formal save before domain writes, in the caller's transaction.

        Lock in project-then-checkpoint order, matching candidate writes. The
        completion CAS also protects SQLite, which ignores SELECT FOR UPDATE.
        Language and identity acceptance remain the planning service's gates.
        """
        if checkpoint.key.story_project_id != story_project_id:
            raise StoryBibleRecoveryConflictError("Checkpoint belongs to another Story Project.")
        if not self._base_matches(session, checkpoint.key, lock=True):
            raise StoryBibleRecoveryConflictError("Project or active Story Bible base has changed.")
        self._require_previous(
            self._head(session, checkpoint.key, lock=True), checkpoint, checkpoint.key,
        )

    def mark_saved_in_session(
        self,
        session: Session,
        checkpoint: StoryBibleRecoveryCheckpoint,
        *,
        saved_story_bible: StoryBible,
    ) -> StoryBibleRecoveryCheckpoint:
        """Stage completion without committing; failures roll back the formal save.

        Call require_pending_in_session BEFORE writing the draft. Do not recheck
        the active base here: a legitimate regeneration may already have cleared
        it inside this transaction. The saved projection includes final local
        completion, while original candidates remain in history.
        """
        project = session.exec(select(StoryProjectRecord).where(
            StoryProjectRecord.project_id == checkpoint.key.story_project_id,
        ).with_for_update()).first()
        current = self._head(session, checkpoint.key, lock=True)
        persisted = LongStoryRepository(session).get_story_bible(
            saved_story_bible.story_bible_id, version=saved_story_bible.version,
        )
        if (
            project is None or persisted is None
            or persisted.story_project_id != checkpoint.key.story_project_id
            or persisted.status != PlanningApprovalStatus.draft
            or persisted.model_dump(mode="json") != saved_story_bible.model_dump(mode="json")
        ):
            raise StoryBibleRecoveryConflictError("The supplied Story Bible is not a persisted project draft.")
        if (
            current is not None and current.status == "saved"
            and current.attempt == checkpoint.attempt
            and current.revision in {checkpoint.revision, checkpoint.revision + 1}
            and current.saved_story_bible_id == persisted.story_bible_id
            and current.saved_story_bible_version == persisted.version
        ):
            return current
        self._require_previous(current, checkpoint, checkpoint.key)
        assert current is not None
        candidate = StoryBibleGenerationOutput.model_validate({
            name: getattr(persisted, name) for name in StoryBibleGenerationOutput.model_fields
        })
        saved = StoryBibleRecoveryCheckpoint.model_validate({
            **current.model_dump(mode="json"),
            "candidate": candidate.model_dump(mode="json"),
            "status": "saved",
            "stage": "saved",
            "unresolved_fields": [],
            "revision": current.revision + 1,
            "updated_at": datetime.now(timezone.utc),
            "saved_story_bible_id": persisted.story_bible_id,
            "saved_story_bible_version": persisted.version,
        })
        self._write(session, saved, current.revision)
        return saved

    def _write(
        self, session: Session, checkpoint: StoryBibleRecoveryCheckpoint, expected_revision: int,
    ) -> None:
        payload = checkpoint.model_dump(mode="json")
        values = dict(
            namespace=RECOVERY_NAMESPACE,
            document_id=checkpoint.id,
            created_at=checkpoint.created_at,
            updated_at=checkpoint.updated_at,
            payload=payload,
        )
        if expected_revision == 0:
            insert = {"sqlite": sqlite_insert, "postgresql": pg_insert}[self._runtime.engine.dialect.name]
            statement = insert(ModuleDocumentRecord).values(**values).on_conflict_do_nothing(
                index_elements=["namespace", "document_id"],
            )
        else:
            statement = update(ModuleDocumentRecord).where(
                ModuleDocumentRecord.namespace == RECOVERY_NAMESPACE,
                ModuleDocumentRecord.document_id == checkpoint.id,
                ModuleDocumentRecord.payload["revision"].as_integer() == expected_revision,
            ).values(payload=payload, updated_at=checkpoint.updated_at)
        # psycopg can report -1 for a successful INSERT even though the row is
        # present. RETURNING distinguishes a write from a lost compare-and-swap
        # without relying on the driver's optional affected-row count.
        written_id = session.execute(
            statement.returning(ModuleDocumentRecord.document_id)
        ).scalar_one_or_none()
        if written_id is None:
            raise StoryBibleRecoveryConflictError("A newer checkpoint already exists.")
        # Same transaction as the head: no head without history or orphan history.
        session.add(ModuleDocumentRecord(**{
            **values, "document_id": f"{checkpoint.id}.r{checkpoint.revision}",
        }))
        session.flush()
