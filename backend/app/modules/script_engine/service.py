from __future__ import annotations

from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.script_engine.models import (
    GenerationStrategy,
    GenerationStrategyCreate,
    PromptLibraryItem,
    PromptLibraryItemCreate,
)
from app.modules.script_engine.repository import (
    GenerationStrategyRepository,
    PromptLibraryRepository,
)


class DuplicatePromptLibraryItemError(ValueError):
    """Raised when a prompt library item id already exists."""


class MissingOntologyNodeError(ValueError):
    """Raised when a referenced ontology node does not exist."""


class DuplicateGenerationStrategyError(ValueError):
    """Raised when a generation strategy id already exists."""


class MissingPromptLibraryItemError(ValueError):
    """Raised when a referenced prompt library item does not exist."""


class PromptLibraryService:
    def __init__(
        self,
        repository: PromptLibraryRepository,
        ontology_node_repository: OntologyNodeRepository,
    ) -> None:
        self._repository = repository
        self._ontology_node_repository = ontology_node_repository

    def create(self, payload: PromptLibraryItemCreate) -> PromptLibraryItem:
        if self._repository.get(payload.id) is not None:
            raise DuplicatePromptLibraryItemError(
                f"PromptLibraryItem '{payload.id}' already exists."
            )

        for ontology_node_id in payload.applicable_tags:
            if self._ontology_node_repository.get(ontology_node_id) is None:
                raise MissingOntologyNodeError(
                    f"OntologyNode '{ontology_node_id}' was not found."
                )

        item = PromptLibraryItem.model_validate(payload.model_dump())
        return self._repository.save(item)

    def get(self, item_id: str) -> PromptLibraryItem | None:
        return self._repository.get(item_id)

    def list(self) -> list[PromptLibraryItem]:
        return self._repository.list()

    def list_by_ids(self, item_ids: list[str]) -> list[PromptLibraryItem]:
        return self._repository.list_by_ids(item_ids)


class GenerationStrategyService:
    def __init__(
        self,
        repository: GenerationStrategyRepository,
        ontology_node_repository: OntologyNodeRepository,
        prompt_library_repository: PromptLibraryRepository,
    ) -> None:
        self._repository = repository
        self._ontology_node_repository = ontology_node_repository
        self._prompt_library_repository = prompt_library_repository

    def create(self, payload: GenerationStrategyCreate) -> GenerationStrategy:
        if self._repository.get(payload.id) is not None:
            raise DuplicateGenerationStrategyError(
                f"GenerationStrategy '{payload.id}' already exists."
            )

        for ontology_node_id in payload.applicable_tags:
            if self._ontology_node_repository.get(ontology_node_id) is None:
                raise MissingOntologyNodeError(
                    f"OntologyNode '{ontology_node_id}' was not found."
                )

        for prompt_id in payload.prompt_ids + payload.deepening_prompt_ids:
            if self._prompt_library_repository.get(prompt_id) is None:
                raise MissingPromptLibraryItemError(
                    f"PromptLibraryItem '{prompt_id}' was not found."
                )

        item = GenerationStrategy.model_validate(payload.model_dump())
        return self._repository.save(item)

    def get(self, item_id: str) -> GenerationStrategy | None:
        return self._repository.get(item_id)

    def list(self) -> list[GenerationStrategy]:
        return self._repository.list()
