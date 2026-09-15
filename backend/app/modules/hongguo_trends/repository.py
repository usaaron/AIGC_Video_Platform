from app.document_repository import DocumentRepository
from app.modules.hongguo_trends.models import HongguoTrendsSnapshot
from app.account_context import current_schema, system_storage


class HongguoTrendsRepository(DocumentRepository[HongguoTrendsSnapshot]):
    model_type = HongguoTrendsSnapshot
    namespace = "hongguo_trends"

    def save(self, item):
        current_schema()  # Reject a revoked request before entering trusted feed scope.
        with system_storage("sm_feed"):
            return super().save(item)

    def list_by_ids(self, item_ids):
        current_schema()
        with system_storage("sm_feed"):
            return super().list_by_ids(item_ids)

    def list(self):
        current_schema()
        with system_storage("sm_feed"):
            return super().list()
