from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any, Generic, TypeVar

from pydantic import BaseModel
from sqlalchemy import JSON, Column, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB, insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import Field, SQLModel, select

from app.database import DatabaseRuntime


class ModuleDocumentRecord(SQLModel, table=True):
    __tablename__ = "module_documents"
    __table_args__ = (Index("ix_module_documents_namespace_created", "namespace", "created_at"),)

    namespace: str = Field(primary_key=True, max_length=80)
    document_id: str = Field(primary_key=True, max_length=120)
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    payload: dict[str, Any] = Field(
        sa_column=Column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    )


DocumentT = TypeVar("DocumentT", bound=BaseModel)


class DocumentRepository(Generic[DocumentT]):
    """Typed module documents; DATABASE_URL selects durable, cache-free storage.

    Documents retain the existing last-write-wins contract. Versioned story
    aggregates and their CAS transactions stay in their domain repositories.
    """

    model_type: type[DocumentT]
    namespace: str

    def __init__(
        self,
        database_runtime_factory: Callable[[], DatabaseRuntime | None] | None = None,
    ) -> None:
        self._database_runtime_factory = database_runtime_factory
        self._items: dict[str, DocumentT] = {}

    def _database_runtime(self) -> DatabaseRuntime | None:
        return self._database_runtime_factory() if self._database_runtime_factory else None

    def save(self, item: DocumentT) -> DocumentT:
        payload = item.model_dump(mode="json")
        document_id = payload["id"]
        runtime = self._database_runtime()
        if runtime is None:
            self._items[document_id] = item.model_copy(deep=True)
        else:
            now = datetime.now(timezone.utc)
            insert = {"postgresql": pg_insert, "sqlite": sqlite_insert}[runtime.engine.dialect.name]
            statement = insert(ModuleDocumentRecord).values(
                namespace=self.namespace, document_id=document_id,
                created_at=now, updated_at=now, payload=payload,
            )
            # Atomic upsert also handles two processes creating the same ID.
            statement = statement.on_conflict_do_update(
                index_elements=["namespace", "document_id"],
                set_={"payload": payload, "updated_at": now},
            )
            with runtime.session() as session:
                session.execute(statement)
        return item

    def get(self, item_id: str) -> DocumentT | None:
        items = self.list_by_ids([item_id])
        return items[0] if items else None

    def list_by_ids(self, item_ids: list[str]) -> list[DocumentT]:
        if not item_ids:
            return []
        runtime = self._database_runtime()
        if runtime is None:
            return [self._items[key].model_copy(deep=True) for key in item_ids if key in self._items]
        with runtime.session() as session:
            records = session.exec(select(ModuleDocumentRecord).where(
                ModuleDocumentRecord.namespace == self.namespace,
                ModuleDocumentRecord.document_id.in_(item_ids),
            )).all()
            by_id = {record.document_id: record.payload for record in records}
        return [self.model_type.model_validate(by_id[key]) for key in item_ids if key in by_id]

    def list(self) -> list[DocumentT]:
        runtime = self._database_runtime()
        if runtime is None:
            return [item.model_copy(deep=True) for item in self._items.values()]
        with runtime.session() as session:
            records = session.exec(select(ModuleDocumentRecord).where(
                ModuleDocumentRecord.namespace == self.namespace,
            ).order_by(ModuleDocumentRecord.created_at, ModuleDocumentRecord.document_id)).all()
            return [self.model_type.model_validate(record.payload) for record in records]
