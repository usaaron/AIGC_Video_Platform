from app.modules.content_spec.models import ContentSpec


class ContentSpecRepository:
    """In-memory repository used until the SQLModel/PostgreSQL schema is finalized."""

    def __init__(self) -> None:
        self._items: dict[str, ContentSpec] = {}

    def save(self, content_spec: ContentSpec) -> ContentSpec:
        self._items[content_spec.id] = content_spec
        return content_spec

    def get(self, content_spec_id: str) -> ContentSpec | None:
        return self._items.get(content_spec_id)

    def list(self) -> list[ContentSpec]:
        return list(self._items.values())
