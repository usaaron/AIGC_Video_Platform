import pytest

from app.modules.ontology_node.models import OntologyCategory, OntologyNode
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.script_engine.models import PromptLibraryItemCreate
from app.modules.script_engine.repository import PromptLibraryRepository
from app.modules.script_engine.service import (
    DuplicatePromptLibraryItemError,
    MissingOntologyNodeError,
    PromptLibraryService,
)


def build_prompt_library_payload() -> dict:
    return {
        "id": "prompt.story_planning.service",
        "name": "Story Planning Prompt",
        "prompt_type": "story_planning",
        "target_module": "script_engine",
        "applicable_tags": ["genre.romance_service"],
        "target_platform": "tiktok",
        "target_audience": "women 18-34",
        "version": "v1",
        "prompt_template": "Plan {content_spec_title} from {creative_brief_summary}.",
        "input_variables": ["content_spec_title", "creative_brief_summary"],
        "output_schema": {"type": "object"},
        "evaluation_notes": ["Open with immediate emotional conflict."],
    }


def test_prompt_library_service_creates_item_when_dependencies_exist() -> None:
    prompt_repository = PromptLibraryRepository()
    ontology_repository = OntologyNodeRepository()
    ontology_repository.save(
        OntologyNode(
            id="genre.romance_service",
            label="Romance",
            category=OntologyCategory.genre,
            description="Romance genre tag.",
            aliases=[],
            is_active=True,
        )
    )
    service = PromptLibraryService(
        repository=prompt_repository,
        ontology_node_repository=ontology_repository,
    )

    created = service.create(PromptLibraryItemCreate.model_validate(build_prompt_library_payload()))

    assert created.id == "prompt.story_planning.service"
    assert service.list_by_ids([created.id])[0].id == created.id


def test_prompt_library_service_rejects_missing_ontology_node() -> None:
    service = PromptLibraryService(
        repository=PromptLibraryRepository(),
        ontology_node_repository=OntologyNodeRepository(),
    )

    with pytest.raises(MissingOntologyNodeError):
        service.create(PromptLibraryItemCreate.model_validate(build_prompt_library_payload()))


def test_prompt_library_service_rejects_duplicate_ids() -> None:
    prompt_repository = PromptLibraryRepository()
    ontology_repository = OntologyNodeRepository()
    ontology_repository.save(
        OntologyNode(
            id="genre.romance_service",
            label="Romance",
            category=OntologyCategory.genre,
            description="Romance genre tag.",
            aliases=[],
            is_active=True,
        )
    )
    service = PromptLibraryService(
        repository=prompt_repository,
        ontology_node_repository=ontology_repository,
    )
    payload = PromptLibraryItemCreate.model_validate(build_prompt_library_payload())

    service.create(payload)

    with pytest.raises(DuplicatePromptLibraryItemError):
        service.create(payload)
