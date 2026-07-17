import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


def build_payload(node_id: str = "genre.romance") -> dict:
    return {
        "id": node_id,
        "label": "Romance",
        "category": "Genre",
        "description": "Romantic relationship-driven stories and emotional arcs.",
        "aliases": ["Love Story"],
        "is_active": True,
    }


@pytest.mark.anyio
async def test_create_ontology_node() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/ontology-nodes",
            json=build_payload("genre.romance_create"),
        )
    assert response.status_code == 201
    assert response.json()["data"]["id"] == "genre.romance_create"


@pytest.mark.anyio
async def test_get_ontology_node_by_id() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        create_response = await client.post(
            "/ontology-nodes",
            json=build_payload("genre.romance_get"),
        )
        created_id = create_response.json()["data"]["id"]
        response = await client.get(f"/ontology-nodes/{created_id}")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == created_id


@pytest.mark.anyio
async def test_create_ontology_node_returns_409_for_duplicate_id() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        payload = build_payload("genre.romance_duplicate")
        first_response = await client.post("/ontology-nodes", json=payload)
        second_response = await client.post("/ontology-nodes", json=payload)
    assert first_response.status_code == 201
    assert second_response.status_code == 409
