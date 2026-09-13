from collections.abc import Callable

from sqlmodel import select

from app.database import DatabaseRuntime
from app.modules.content_spec.models import ContentSpec
from app.modules.content_spec.persistence import ContentSpecRecord


class ContentSpecRepository:
    """ContentSpec storage with an in-memory test mode and optional durable runtime."""

    def __init__(
        self,
        database_runtime_factory: Callable[[], DatabaseRuntime | None] | None = None,
    ) -> None:
        self._items: dict[str, ContentSpec] = {}
        self._database_runtime_factory = database_runtime_factory

    def save(self, content_spec: ContentSpec) -> ContentSpec:
        runtime = self._database_runtime()
        if runtime is None:
            self._items[content_spec.id] = content_spec.model_copy(deep=True)
        else:
            payload = content_spec.model_dump(mode="json")
            with runtime.session() as session:
                record = session.get(ContentSpecRecord, content_spec.id)
                values = {
                    "status": content_spec.status.value,
                    "platform_profile_id": content_spec.platform_goal.platform_profile_id,
                    "created_at": content_spec.created_at,
                    "updated_at": content_spec.updated_at,
                    "payload": payload,
                }
                if record is None:
                    session.add(
                        ContentSpecRecord(
                            content_spec_id=content_spec.id,
                            **values,
                        )
                    )
                else:
                    for field_name, value in values.items():
                        setattr(record, field_name, value)
                    session.add(record)
        return content_spec

    def get(self, content_spec_id: str) -> ContentSpec | None:
        runtime = self._database_runtime()
        if runtime is None:
            cached = self._items.get(content_spec_id)
            return cached.model_copy(deep=True) if cached else None
        with runtime.session() as session:
            record = session.get(ContentSpecRecord, content_spec_id)
            if record is None:
                return None
            restored = ContentSpec.model_validate(record.payload)
        return restored

    def list(self) -> list[ContentSpec]:
        runtime = self._database_runtime()
        if runtime is None:
            return [item.model_copy(deep=True) for item in self._items.values()]
        with runtime.session() as session:
            records = session.exec(
                select(ContentSpecRecord).order_by(ContentSpecRecord.created_at)
            ).all()
            restored = [ContentSpec.model_validate(record.payload) for record in records]
        return restored

    def _database_runtime(self) -> DatabaseRuntime | None:
        if self._database_runtime_factory is None:
            return None
        return self._database_runtime_factory()
