from app.document_repository import DocumentRepository
from app.modules.platform_profile.models import PlatformProfile


class PlatformProfileRepository(DocumentRepository[PlatformProfile]):
    model_type = PlatformProfile
    namespace = "platform_profiles"
