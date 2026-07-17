from __future__ import annotations

from app.modules.script_engine.models import GenerationStrategy, PromptLibraryItem


class PromptLibraryRepository:
    """In-memory repository for Prompt Library items during MVP validation."""

    def __init__(self) -> None:
        self._items: dict[str, PromptLibraryItem] = {}

    def save(self, item: PromptLibraryItem) -> PromptLibraryItem:
        self._items[item.id] = item
        return item

    def get(self, item_id: str) -> PromptLibraryItem | None:
        return self._items.get(item_id)

    def list(self) -> list[PromptLibraryItem]:
        return list(self._items.values())

    def list_by_ids(self, item_ids: list[str]) -> list[PromptLibraryItem]:
        return [item for item_id in item_ids if (item := self._items.get(item_id)) is not None]


class GenerationStrategyRepository:
    """In-memory repository for generation strategy definitions during MVP validation."""

    def __init__(self) -> None:
        self._items: dict[str, GenerationStrategy] = {}

    def save(self, item: GenerationStrategy) -> GenerationStrategy:
        self._items[item.id] = item
        return item

    def get(self, item_id: str) -> GenerationStrategy | None:
        return self._items.get(item_id)

    def list(self) -> list[GenerationStrategy]:
        return list(self._items.values())
