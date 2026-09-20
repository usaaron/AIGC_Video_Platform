from __future__ import annotations

import hashlib

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import select

from app.database import DatabaseRuntime
from app.document_repository import ModuleDocumentRecord
from app.modules.script_engine.long_story_persistence import StoryProjectRecord
from .models import PreproductionStoryboard


class StoryboardConflictError(ValueError):
    pass


class PreproductionRepository:
    """One CAS head and immutable revisions in the shared document table."""

    namespace = "preproduction_storyboards"

    def __init__(self, runtime: DatabaseRuntime):
        self.runtime = runtime

    @staticmethod
    def key(project_id: str, episode_number: int) -> str:
        return hashlib.sha256(f"{project_id}:{episode_number}".encode()).hexdigest()

    def get(self, project_id: str, episode_number: int, revision: int | None = None) -> PreproductionStoryboard | None:
        key = self.key(project_id, episode_number)
        if revision is not None:
            key += f".v{revision}"
        with self.runtime.session() as session:
            record = session.get(ModuleDocumentRecord, (self.namespace, key))
            return PreproductionStoryboard.model_validate(record.payload) if record else None

    def save(self, plan: PreproductionStoryboard, expected_revision: int) -> PreproductionStoryboard:
        key = self.key(plan.story_project_id, plan.episode_number)
        payload = plan.model_dump(mode="json")
        if plan.revision != expected_revision + 1:
            raise StoryboardConflictError("分镜版本必须连续递增。")
        insert = {"sqlite": sqlite_insert, "postgresql": pg_insert}[self.runtime.engine.dialect.name]
        with self.runtime.session() as session:
            # Serialize with project deletion; late generation cannot resurrect it.
            project = session.exec(select(StoryProjectRecord).where(
                StoryProjectRecord.project_id == plan.story_project_id,
            ).with_for_update()).first()
            if project is None:
                raise StoryboardConflictError("项目已不存在，请返回项目列表。")
            if expected_revision == 0:
                statement = insert(ModuleDocumentRecord).values(
                    namespace=self.namespace, document_id=key, payload=payload,
                    created_at=plan.created_at, updated_at=plan.updated_at,
                ).on_conflict_do_nothing(index_elements=["namespace", "document_id"])
            else:
                statement = update(ModuleDocumentRecord).where(
                    ModuleDocumentRecord.namespace == self.namespace,
                    ModuleDocumentRecord.document_id == key,
                    ModuleDocumentRecord.payload["revision"].as_integer() == expected_revision,
                ).values(payload=payload, updated_at=plan.updated_at)
            # PostgreSQL/psycopg does not guarantee rowcount for INSERT. Read
            # the written identity so a first save is not mistaken for a race.
            written_id = session.execute(
                statement.returning(ModuleDocumentRecord.document_id)
            ).scalar_one_or_none()
            if written_id is None:
                raise StoryboardConflictError("分镜已被其他操作更新，请重新加载后再保存。")
            session.add(ModuleDocumentRecord(
                namespace=self.namespace, document_id=f"{key}.v{plan.revision}",
                payload=payload, created_at=plan.updated_at, updated_at=plan.updated_at,
            ))
        return plan
