import pytest
from pydantic import ValidationError

from app.modules.ontology_node.models import OntologyNodeCreate


def build_payload() -> dict:
    return {
        "id": "genre.romance",
        "label": "Romance",
        "category": "Genre",
        "description": "Romantic relationship-driven stories and emotional arcs.",
        "aliases": ["Love Story", "Romantic Drama"],
        "is_active": True,
    }


def test_ontology_node_accepts_valid_payload() -> None:
    model = OntologyNodeCreate.model_validate(build_payload())
    assert model.id == "genre.romance"
    assert model.category.value == "Genre"


def test_ontology_node_rejects_duplicate_aliases() -> None:
    payload = build_payload()
    payload["aliases"].append("love story")

    with pytest.raises(ValidationError, match="Aliases must be unique"):
        OntologyNodeCreate.model_validate(payload)


def test_ontology_node_rejects_mismatched_category_prefix() -> None:
    payload = build_payload()
    payload["id"] = "emotion.romance"

    with pytest.raises(ValidationError, match="must start with 'genre.'"):
        OntologyNodeCreate.model_validate(payload)
