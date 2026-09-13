from app.document_repository import DocumentRepository
from app.modules.asset.models import Asset


class AssetRepository(DocumentRepository[Asset]):
    model_type = Asset
    namespace = "assets"
