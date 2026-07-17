from app.modules.orchestrator.models import OrchestrationPlan


class OrchestrationPlanRepository:
    """In-memory repository used until persistence is introduced."""

    def __init__(self) -> None:
        self._items: dict[str, OrchestrationPlan] = {}

    def save(self, plan: OrchestrationPlan) -> OrchestrationPlan:
        self._items[plan.id] = plan
        return plan

    def get(self, plan_id: str) -> OrchestrationPlan | None:
        return self._items.get(plan_id)

    def list(self) -> list[OrchestrationPlan]:
        return list(self._items.values())
