import pytest
from pydantic import ValidationError

from app.modules.retrieval.models import RetrievalResolveRequest


def test_retrieval_resolve_request_accepts_valid_payload() -> None:
    model = RetrievalResolveRequest.model_validate({"plan_id": "plan_001"})
    assert model.plan_id == "plan_001"


def test_retrieval_resolve_request_rejects_short_plan_id() -> None:
    with pytest.raises(ValidationError):
        RetrievalResolveRequest.model_validate({"plan_id": "x"})
