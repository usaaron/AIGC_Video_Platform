from app.modules.ontology_node.models import OntologyNode, OntologyNodeCreate
from app.modules.ontology_node.repository import OntologyNodeRepository


class DuplicateOntologyNodeError(ValueError):
    """Raised when an ontology node id already exists."""


class OntologyNodeService:
    def __init__(self, repository: OntologyNodeRepository) -> None:
        self._repository = repository

    def create(self, payload: OntologyNodeCreate) -> OntologyNode:
        if self._repository.get(payload.id) is not None:
            raise DuplicateOntologyNodeError(f"OntologyNode '{payload.id}' already exists.")

        ontology_node = OntologyNode.model_validate(payload.model_dump())
        return self._repository.save(ontology_node)

    def get(self, ontology_node_id: str) -> OntologyNode | None:
        return self._repository.get(ontology_node_id)

    def list(self) -> list[OntologyNode]:
        return self._repository.list()
