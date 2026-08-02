import pytest
from pydantic import ValidationError

from app.modules.retrieval.models import RetrievalResolveRequest, RetrievalResolvedRequest


def test_retrieval_resolve_request_accepts_valid_payload() -> None:
    model = RetrievalResolveRequest.model_validate({"plan_id": "plan_001"})
    assert model.plan_id == "plan_001"


def test_retrieval_resolve_request_rejects_short_plan_id() -> None:
    with pytest.raises(ValidationError):
        RetrievalResolveRequest.model_validate({"plan_id": "x"})


def test_retrieval_resolved_request_accepts_empty_required_tags() -> None:
    model = RetrievalResolvedRequest.model_validate(
        {
            "request_id": "characters_core",
            "asset_type": "character",
            "reason": "Use optional assets when the prompt supplies the creative direction.",
        }
    )

    assert model.required_tag_ids == []
