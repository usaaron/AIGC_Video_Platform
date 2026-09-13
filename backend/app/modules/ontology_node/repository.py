from app.document_repository import DocumentRepository
from app.modules.ontology_node.models import OntologyNode


class OntologyNodeRepository(DocumentRepository[OntologyNode]):
    model_type = OntologyNode
    namespace = "ontology_nodes"
