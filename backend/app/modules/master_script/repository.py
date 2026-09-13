from app.document_repository import DocumentRepository
from app.modules.master_script.models import MasterScript


class MasterScriptRepository(DocumentRepository[MasterScript]):
    model_type = MasterScript
    namespace = "master_scripts"
