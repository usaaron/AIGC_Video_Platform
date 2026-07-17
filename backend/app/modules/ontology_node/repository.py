from app.modules.ontology_node.models import OntologyNode


class OntologyNodeRepository:
    """In-memory repository used until the database schema is finalized."""

    def __init__(self) -> None:
        self._items: dict[str, OntologyNode] = {}

    def save(self, ontology_node: OntologyNode) -> OntologyNode:
        self._items[ontology_node.id] = ontology_node
        return ontology_node

    def get(self, ontology_node_id: str) -> OntologyNode | None:
        return self._items.get(ontology_node_id)

    def list(self) -> list[OntologyNode]:
        return list(self._items.values())
