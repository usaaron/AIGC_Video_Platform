from app.modules.content_spec.models import ContentSpec, ContentSpecCreate
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.platform_profile.repository import PlatformProfileRepository


class MissingPlatformProfileError(ValueError):
    """Raised when a referenced platform profile does not exist."""


class MissingOntologyNodeError(ValueError):
    """Raised when a referenced ontology node does not exist."""


class InvalidTagReferenceError(ValueError):
    """Raised when a tag reference does not match its ontology node."""


class ContentSpecService:
    def __init__(
        self,
        repository: ContentSpecRepository,
        platform_profile_repository: PlatformProfileRepository,
        ontology_node_repository: OntologyNodeRepository,
    ) -> None:
        self._repository = repository
        self._platform_profile_repository = platform_profile_repository
        self._ontology_node_repository = ontology_node_repository

    def create(self, payload: ContentSpecCreate) -> ContentSpec:
        platform_profile_id = payload.platform_goal.platform_profile_id
        if self._platform_profile_repository.get(platform_profile_id) is None:
            raise MissingPlatformProfileError(
                f"PlatformProfile '{platform_profile_id}' was not found."
            )

        for tag in payload.tags:
            ontology_node = self._ontology_node_repository.get(tag.ontology_node_id)
            if ontology_node is None:
                raise MissingOntologyNodeError(
                    f"OntologyNode '{tag.ontology_node_id}' was not found."
                )

            if tag.label != ontology_node.label or tag.category != ontology_node.category.value:
                raise InvalidTagReferenceError(
                    "Tag reference does not match its ontology node definition for "
                    f"'{tag.ontology_node_id}'."
                )

        content_spec = ContentSpec.model_validate(payload.model_dump())
        return self._repository.save(content_spec)

    def get(self, content_spec_id: str) -> ContentSpec | None:
        return self._repository.get(content_spec_id)

    def list(self) -> list[ContentSpec]:
        return self._repository.list()
