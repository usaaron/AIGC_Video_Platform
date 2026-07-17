from __future__ import annotations

from app.modules.script_engine.models import (
    GenerationStrategy,
    PromptLibraryItem,
    PromptRetrievalRequest,
    PromptRetrievalResult,
)
from app.modules.script_engine.repository import (
    GenerationStrategyRepository,
    PromptLibraryRepository,
)
from app.modules.script_engine.service import MissingPromptLibraryItemError


class MissingPromptRetrievalStrategyError(ValueError):
    """Raised when prompt retrieval cannot find the requested generation strategy."""


class PromptRetrievalService:
    def __init__(
        self,
        *,
        generation_strategy_repository: GenerationStrategyRepository,
        prompt_library_repository: PromptLibraryRepository,
    ) -> None:
        self._generation_strategy_repository = generation_strategy_repository
        self._prompt_library_repository = prompt_library_repository

    def resolve(self, payload: PromptRetrievalRequest) -> PromptRetrievalResult:
        generation_strategy = self._generation_strategy_repository.get(
            payload.generation_strategy_id
        )
        if generation_strategy is None:
            raise MissingPromptRetrievalStrategyError(
                f"GenerationStrategy '{payload.generation_strategy_id}' was not found."
            )
        return self.resolve_for_strategy(generation_strategy)

    def resolve_for_strategy(
        self,
        generation_strategy: GenerationStrategy,
    ) -> PromptRetrievalResult:
        prompt_items = self._prompt_library_repository.list_by_ids(
            generation_strategy.prompt_ids
        )
        self._ensure_all_prompt_ids_resolved(
            generation_strategy.prompt_ids,
            prompt_items,
        )
        return PromptRetrievalResult(
            generation_strategy_id=generation_strategy.id,
            strategy_name=generation_strategy.name,
            prompt_ids=generation_strategy.prompt_ids,
            prompts=prompt_items,
            retrieval_mode="exact_ids",
            notes=[
                "Current MVP prompt retrieval uses exact GenerationStrategy.prompt_ids resolution.",
                "Future phases may extend retrieval with tag, audience and platform matching.",
            ],
        )

    def _ensure_all_prompt_ids_resolved(
        self,
        expected_prompt_ids: list[str],
        prompt_items: list[PromptLibraryItem],
    ) -> None:
        found_ids = {item.id for item in prompt_items}
        missing_ids = [
            prompt_id for prompt_id in expected_prompt_ids if prompt_id not in found_ids
        ]
        if missing_ids:
            raise MissingPromptLibraryItemError(
                f"PromptLibraryItem '{missing_ids[0]}' was not found."
            )
