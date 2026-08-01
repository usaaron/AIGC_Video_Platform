import pytest

from app.modules.ontology_node.models import OntologyCategory, OntologyNode
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.script_engine.models import (
    GenerationStrategyCreate,
    PromptLibraryItem,
    PromptType,
)
from app.modules.script_engine.repository import (
    GenerationStrategyRepository,
    PromptLibraryRepository,
)
from app.modules.script_engine.service import (
    DuplicateGenerationStrategyError,
    GenerationStrategyService,
    MissingOntologyNodeError,
    MissingPromptLibraryItemError,
)


def build_strategy_payload() -> dict:
    return {
        "id": "strategy.tiktok.service.v1",
        "name": "TikTok Master Script Strategy",
        "target_platform": "tiktok",
        "target_content_type": "ai_comic_drama",
        "applicable_tags": ["genre.romance_strategy_service"],
        "model_provider": "mock",
        "model_name": "mock-script-generator",
        "temperature": 0.7,
        "top_p": 0.9,
        "max_tokens": 4000,
        "workflow_steps": [
            {
                "step_order": 1,
                "name": "story_planning",
                "description": "Build the initial story plan.",
                "prompt_id": "prompt.story_planning.strategy_service",
            }
        ],
        "prompt_ids": ["prompt.story_planning.strategy_service"],
        "qc_enabled": True,
        "self_check_enabled": True,
        "human_review_required": False,
        "output_schema": {"type": "object"},
        "version": "v1",
        "status": "active",
    }


def seed_dependencies(
    ontology_repository: OntologyNodeRepository,
    prompt_repository: PromptLibraryRepository,
) -> None:
    ontology_repository.save(
        OntologyNode(
            id="genre.romance_strategy_service",
            label="Romance",
            category=OntologyCategory.genre,
            description="Romance genre tag.",
            aliases=[],
            is_active=True,
        )
    )
    prompt_repository.save(
        PromptLibraryItem(
            id="prompt.story_planning.strategy_service",
            name="Story Planning Prompt",
            prompt_type=PromptType.story_planning,
            target_module="script_engine",
            applicable_tags=["genre.romance_strategy_service"],
            target_platform="tiktok",
            target_audience="women 18-34",
            version="v1",
            prompt_template="Plan {content_spec_title}.",
            input_variables=["content_spec_title"],
            output_schema={"type": "object"},
            evaluation_notes=["Open strong."],
        )
    )


def test_generation_strategy_service_creates_strategy_when_dependencies_exist() -> None:
    ontology_repository = OntologyNodeRepository()
    prompt_repository = PromptLibraryRepository()
    seed_dependencies(ontology_repository, prompt_repository)
    service = GenerationStrategyService(
        repository=GenerationStrategyRepository(),
        ontology_node_repository=ontology_repository,
        prompt_library_repository=prompt_repository,
    )

    created = service.create(GenerationStrategyCreate.model_validate(build_strategy_payload()))

    assert created.id == "strategy.tiktok.service.v1"
    assert service.get(created.id) is not None


def test_generation_strategy_service_rejects_missing_prompt_reference() -> None:
    ontology_repository = OntologyNodeRepository()
    prompt_repository = PromptLibraryRepository()
    ontology_repository.save(
        OntologyNode(
            id="genre.romance_strategy_service",
            label="Romance",
            category=OntologyCategory.genre,
            description="Romance genre tag.",
            aliases=[],
            is_active=True,
        )
    )
    service = GenerationStrategyService(
        repository=GenerationStrategyRepository(),
        ontology_node_repository=ontology_repository,
        prompt_library_repository=prompt_repository,
    )

    with pytest.raises(MissingPromptLibraryItemError):
        service.create(GenerationStrategyCreate.model_validate(build_strategy_payload()))


def test_generation_strategy_service_rejects_missing_deepening_prompt_reference() -> None:
    ontology_repository = OntologyNodeRepository()
    prompt_repository = PromptLibraryRepository()
    seed_dependencies(ontology_repository, prompt_repository)
    service = GenerationStrategyService(
        repository=GenerationStrategyRepository(),
        ontology_node_repository=ontology_repository,
        prompt_library_repository=prompt_repository,
    )
    payload = build_strategy_payload()
    payload["deepening_mode"] = "shadow"
    payload["deepening_prompt_ids"] = ["prompt.creative_deepening.missing"]

    with pytest.raises(MissingPromptLibraryItemError):
        service.create(GenerationStrategyCreate.model_validate(payload))


def test_generation_strategy_service_rejects_missing_ontology_reference() -> None:
    prompt_repository = PromptLibraryRepository()
    prompt_repository.save(
        PromptLibraryItem(
            id="prompt.story_planning.strategy_service",
            name="Story Planning Prompt",
            prompt_type=PromptType.story_planning,
            target_module="script_engine",
            applicable_tags=[],
            target_platform="tiktok",
            target_audience="women 18-34",
            version="v1",
            prompt_template="Plan {content_spec_title}.",
            input_variables=["content_spec_title"],
            output_schema={"type": "object"},
            evaluation_notes=["Open strong."],
        )
    )
    service = GenerationStrategyService(
        repository=GenerationStrategyRepository(),
        ontology_node_repository=OntologyNodeRepository(),
        prompt_library_repository=prompt_repository,
    )

    with pytest.raises(MissingOntologyNodeError):
        service.create(GenerationStrategyCreate.model_validate(build_strategy_payload()))


def test_generation_strategy_service_rejects_duplicate_ids() -> None:
    ontology_repository = OntologyNodeRepository()
    prompt_repository = PromptLibraryRepository()
    seed_dependencies(ontology_repository, prompt_repository)
    service = GenerationStrategyService(
        repository=GenerationStrategyRepository(),
        ontology_node_repository=ontology_repository,
        prompt_library_repository=prompt_repository,
    )
    payload = GenerationStrategyCreate.model_validate(build_strategy_payload())

    service.create(payload)

    with pytest.raises(DuplicateGenerationStrategyError):
        service.create(payload)
