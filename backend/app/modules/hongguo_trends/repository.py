from app.document_repository import DocumentRepository
from app.modules.hongguo_trends.models import HongguoTrendsSnapshot


class HongguoTrendsRepository(DocumentRepository[HongguoTrendsSnapshot]):
    model_type = HongguoTrendsSnapshot
    namespace = "hongguo_trends"
