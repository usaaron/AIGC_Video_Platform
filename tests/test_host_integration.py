from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.host_integration import HostRequestContext
from app.main import create_app


def test_required_host_adapter_fails_closed_even_with_spoofed_headers():
    with TestClient(create_app(require_host_context=True)) as client:
        response = client.get("/story-projects", headers={
            "X-Tenant-ID": "admin", "X-Actor-ID": "owner", "X-Request-ID": "trace-123",
        })
        assert response.status_code == 503
        assert response.headers["X-Request-ID"] == "trace-123"
        assert client.get("/health/live").status_code == 200
        assert client.get("/health/ready").status_code == 503


def test_authorizer_can_read_body_and_deny_access_before_endpoint_runs():
    authorized = []
    async def authorizer(request: Request):
        payload = await request.json()
        if payload["project_id"] != "allowed":
            raise HTTPException(403, "Project access denied.")
        return HostRequestContext(tenant_id="tenant-1", actor_id="actor-1",
                                  request_id="host-trace-id", permissions={"project.write"})

    # Adapter/body contract independent of the PostgreSQL production gate.
    app = create_app(host_authorizer=authorizer, require_host_context=False)
    @app.post("/test-host-boundary")
    async def operation(request: Request):
        authorized.append(request.state.host_context)
        return await request.json()

    with TestClient(app) as client:
        assert client.post("/test-host-boundary", json={"project_id": "foreign"}).status_code == 403
        result = client.post("/test-host-boundary", json={"project_id": "allowed"})
        assert result.json() == {"project_id": "allowed"}
        assert result.headers["X-Request-ID"] == "host-trace-id"
        assert authorized[0].tenant_id == "tenant-1"
        assert len(authorized) == 1


def test_readiness_checks_migrated_database(monkeypatch):
    runtime = create_database_runtime("sqlite://")
    monkeypatch.setattr("app.main.get_long_story_database_runtime", lambda: runtime)
    try:
        with TestClient(create_app()) as client:
            assert client.get("/health/ready").status_code == 503
            SQLModel.metadata.create_all(runtime.engine)
            assert client.get("/health/ready").json()["status"] == "ready"
    finally:
        runtime.engine.dispose()


def test_required_host_experimental_routes_reject_unavailable_isolated_storage(monkeypatch):
    from app.database import DatabaseConfigurationError
    async def authorizer(request):
        return HostRequestContext(tenant_id="tenant", actor_id="actor", request_id="test-request", permissions={"project.read"})
    def unavailable():
        raise DatabaseConfigurationError("Missing test database")
    monkeypatch.setattr("app.dependencies.get_long_story_database_runtime", unavailable)
    app = create_app(host_authorizer=authorizer, require_host_context=True)
    # No lifespan: this specifically tests the request gate, independent of the
    # startup migration gate (which also fails closed when storage is missing).
    client = TestClient(app)
    try:
        assert client.get("/benchmarks").status_code == 503
    finally:
        client.close()
