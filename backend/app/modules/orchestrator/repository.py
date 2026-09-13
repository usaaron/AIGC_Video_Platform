from app.document_repository import DocumentRepository
from app.modules.orchestrator.models import OrchestrationPlan


class OrchestrationPlanRepository(DocumentRepository[OrchestrationPlan]):
    model_type = OrchestrationPlan
    namespace = "orchestration_plans"
