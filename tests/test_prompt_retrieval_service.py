import pytest

from app.modules.script_engine.models import (
    GenerationStrategy,
    GenerationStrategyStatus,
    GenerationWorkflowStep,
    PromptLibraryItem,
    PromptRetrievalRequest,
    PromptType,
)
from app.modules.script_engine.prompt_retrieval import (
    MissingPromptRetrievalStrategyError,
    PromptRetrievalService,
)
from app.modules.script_engine.repository import (
    GenerationStrategyRepository,
    PromptLibraryRepository,
)
from app.modules.script_engine.service import MissingPromptLibraryItemError


def seed_prompt_retrieval_dependencies(
    strategy_repository: GenerationStrategyRepository,
    prompt_repository: PromptLibraryRepository,
) -> None:
    prompt_repository.save(
        PromptLibraryItem(
            id="prompt.story_planning.prompt_retrieval_service",
            name="Story Planning Prompt",
            prompt_type=PromptType.story_planning,
            target_module="script_engine",
            applicable_tags=["genre.romance_prompt_retrieval_service"],
            target_platform="tiktok",
            target_audience="women 18-34",
            version="v1",
            prompt_template="Plan {content_spec_title}.",
            input_variables=["content_spec_title"],
            output_schema={"type": "object"},
            evaluation_notes=["Open strong."],
        )
    )
    strategy_repository.save(
        GenerationStrategy(
            id="strategy.tiktok.prompt_retrieval_service.v1",
            name="Prompt Retrieval Strategy",
            target_platform="tiktok",
            target_content_type="ai_comic_drama",
            applicable_tags=["genre.romance_prompt_retrieval_service"],
            model_provider="mock",
            model_name="mock-script-generator",
            workflow_steps=[
                GenerationWorkflowStep(
                    step_order=1,
                    name="story_planning",
                    description="Build the initial story plan.",
                    prompt_id="prompt.story_planning.prompt_retrieval_service",
                )
            ],
            prompt_ids=["prompt.story_planning.prompt_retrieval_service"],
            qc_enabled=True,
            self_check_enabled=True,
            human_review_required=False,
            output_schema={"type": "object"},
            version="v1",
            status=GenerationStrategyStatus.active,
        )
    )


def test_prompt_retrieval_service_resolves_exact_prompt_ids() -> None:
    strategy_repository = GenerationStrategyRepository()
    prompt_repository = PromptLibraryRepository()
    seed_prompt_retrieval_dependencies(strategy_repository, prompt_repository)
    service = PromptRetrievalService(
        generation_strategy_repository=strategy_repository,
        prompt_library_repository=prompt_repository,
    )

    result = service.resolve(
        PromptRetrievalRequest(
            generation_strategy_id="strategy.tiktok.prompt_retrieval_service.v1"
        )
    )

    assert result.generation_strategy_id == "strategy.tiktok.prompt_retrieval_service.v1"
    assert result.prompt_ids == ["prompt.story_planning.prompt_retrieval_service"]
    assert result.prompts[0].id == "prompt.story_planning.prompt_retrieval_service"
    assert result.retrieval_mode == "exact_ids"


def test_prompt_retrieval_service_rejects_missing_strategy() -> None:
    service = PromptRetrievalService(
        generation_strategy_repository=GenerationStrategyRepository(),
        prompt_library_repository=PromptLibraryRepository(),
    )

    with pytest.raises(MissingPromptRetrievalStrategyError):
        service.resolve(PromptRetrievalRequest(generation_strategy_id="missing_strategy"))


def test_prompt_retrieval_service_rejects_missing_prompt_item() -> None:
    strategy_repository = GenerationStrategyRepository()
    strategy_repository.save(
        GenerationStrategy(
            id="strategy.tiktok.prompt_retrieval_missing_prompt.v1",
            name="Missing Prompt Strategy",
            target_platform="tiktok",
            target_content_type="ai_comic_drama",
            applicable_tags=[],
            model_provider="mock",
            model_name="mock-script-generator",
            workflow_steps=[
                GenerationWorkflowStep(
                    step_order=1,
                    name="story_planning",
                    description="Build the initial story plan.",
                    prompt_id="prompt.missing",
                )
            ],
            prompt_ids=["prompt.missing"],
            qc_enabled=True,
            self_check_enabled=True,
            human_review_required=False,
            output_schema={"type": "object"},
            version="v1",
            status=GenerationStrategyStatus.active,
        )
    )
    service = PromptRetrievalService(
        generation_strategy_repository=strategy_repository,
        prompt_library_repository=PromptLibraryRepository(),
    )

    with pytest.raises(MissingPromptLibraryItemError):
        service.resolve(
            PromptRetrievalRequest(
                generation_strategy_id="strategy.tiktok.prompt_retrieval_missing_prompt.v1"
            )
        )
