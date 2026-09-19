"""The upgraded planning routes must retain the signed host/account boundary."""

import base64
import hashlib
import hmac
import json
from time import time

from fastapi.testclient import TestClient
import pytest

from app.account_context import account_schema, current_schema, storage_scope
from app.dependencies import get_long_story_service, get_story_planning_service
from app.host_integration import environment_host_authorizer
from app.main import create_app
from app.modules.script_engine.long_story_models import StoryProject, StorySynopsisDraftOutput
from app.modules.script_engine.long_story_service import LongStoryNotFoundError


SECRET = "final2-host-boundary-test-secret"
NEW_PLANNING_ROUTES = (
    "/story-projects/project.allowed/story-bibles/synopsis-draft",
    "/story-projects/project.allowed/plan-nodes/node.allowed/episode-plans/1/prepare",
)


def signed_headers(*, actor="one", permissions=("project.read", "project.write"), project_id="project.allowed"):
    claims = {
        "version": 1, "issuer": "seqora", "audience": "script-master",
        "expiresAt": int(time()) + 300, "tokenId": "final2-boundary-test",
        "tenantId": "test-org", "actorId": actor, "projectId": project_id,
        "roles": ["member"], "permissions": list(permissions),
    }
    encoded = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(
        hmac.new(SECRET.encode(), encoded.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    return {"Authorization": f"Bearer {encoded}.{signature}"}


@pytest.fixture
def hosted_app(monkeypatch):
    monkeypatch.setenv("HOST_INTEGRATION_SECRET", SECRET)
    # Exercise the production signature/permission boundary independently of the
    # PostgreSQL startup gate, which has its own disposable database tests.
    app = create_app(host_authorizer=environment_host_authorizer(), require_host_context=False)
    return app


@pytest.mark.parametrize("path", NEW_PLANNING_ROUTES)
@pytest.mark.parametrize("denial", ("unsigned", "read_only", "foreign_path", "foreign_body"))
def test_new_planning_routes_deny_unauthorized_requests_before_service(hosted_app, path, denial):
    calls = []

    def service():
        calls.append("service constructed")
        raise AssertionError("Unauthorized requests must not reach planning or model work")

    hosted_app.dependency_overrides[get_story_planning_service] = service
    headers = signed_headers()
    payload = {"story_project_id": "project.allowed"}
    expected = 403
    if denial == "unsigned":
        headers = {"X-Actor-ID": "one", "X-Tenant-ID": "test-org"}
        expected = 401
    elif denial == "read_only":
        headers = signed_headers(permissions=("project.read",))
    elif denial == "foreign_path":
        path = path.replace("project.allowed", "project.foreign")
    else:
        payload["story_project_id"] = "project.foreign"
    with TestClient(hosted_app) as client:
        response = client.post(path, headers=headers, json=payload)
    assert response.status_code == expected
    assert calls == []


def test_synopsis_generation_inherits_signed_account_and_revokes_context(hosted_app):
    observed = []

    class PlanningService:
        def generate_story_synopsis_draft(self, payload):
            observed.append((current_schema(), storage_scope.get(), payload.story_project_id))
            return StorySynopsisDraftOutput(text="A reviewable synopsis.", review={"status": "draft"})

    hosted_app.dependency_overrides[get_story_planning_service] = PlanningService
    with TestClient(hosted_app) as client:
        for actor in ("one", "two"):
            response = client.post(NEW_PLANNING_ROUTES[0], headers=signed_headers(actor=actor), json={
                "story_project_id": "project.allowed", "generation_strategy_id": "strategy.test",
            })
            assert response.status_code == 200, response.text
            assert observed[-1][0] == account_schema("test-org", actor)
            assert observed[-1][1].active is False
            assert observed[-1][2] == "project.allowed"
    assert observed[0][0] != observed[1][0]
    assert storage_scope.get() is None


@pytest.mark.parametrize("status,include_archived,offset,total,returned", (
    ("planning", False, 0, 1, True),
    ("planning", False, 1, 1, False),
    ("planning", False, 50, 1, False),
    ("archived", False, 0, 0, False),
    ("archived", True, 0, 1, True),
    ("archived", True, 1, 1, False),
))
def test_bound_project_list_scopes_before_pagination(
    hosted_app, status, include_archived, offset, total, returned,
):
    bound = StoryProject(
        project_id="project.allowed", title="Older bound project", planned_episode_count=12, status=status,
    )
    # Sixty newer projects would hide the bound project on an unscoped page.
    projects = [bound.model_copy(update={"project_id": f"project.other-{i}"}) for i in range(60)] + [bound]
    reads = []

    class ProjectService:
        def get_project(self, project_id):
            reads.append((project_id, current_schema()))
            return bound

        def list_projects(self, *, limit, offset, include_archived):
            reads.append("unscoped list")
            return projects[offset:offset + limit], len(projects)

    hosted_app.dependency_overrides[get_long_story_service] = ProjectService
    with TestClient(hosted_app) as client:
        response = client.get("/story-projects", headers=signed_headers(), params={
            "limit": 50, "offset": offset, "include_archived": include_archived,
        })
    assert response.status_code == 200, response.text
    body = response.json()
    assert [project["project_id"] for project in body["data"]] == ([bound.project_id] if returned else [])
    assert (body["total"], body["limit"], body["offset"]) == (total, 50, offset)
    assert reads == [("project.allowed", account_schema("test-org", "one"))]


def test_missing_bound_project_list_does_not_expose_other_projects(hosted_app):
    reads = []

    class ProjectService:
        def get_project(self, project_id):
            reads.append((project_id, current_schema()))
            raise LongStoryNotFoundError("Private details from storage must not reach the response")

        def list_projects(self, **kwargs):
            raise AssertionError("A bound listing must not read other account projects")

    hosted_app.dependency_overrides[get_long_story_service] = ProjectService
    with TestClient(hosted_app) as client:
        response = client.get("/story-projects", headers=signed_headers(actor="two"))
    assert response.status_code == 200
    assert response.json() == {"data": [], "total": 0, "limit": 50, "offset": 0}
    assert reads == [("project.allowed", account_schema("test-org", "two"))]


def test_unbound_project_list_preserves_service_pagination(hosted_app):
    project = StoryProject(project_id="project.other", title="Independent project", planned_episode_count=12)
    reads = []

    class ProjectService:
        def get_project(self, project_id):
            raise AssertionError("An unbound account uses its normal paginated list")

        def list_projects(self, **kwargs):
            reads.append(kwargs)
            return [project], 61

    hosted_app.dependency_overrides[get_long_story_service] = ProjectService
    with TestClient(hosted_app) as client:
        response = client.get("/story-projects", headers=signed_headers(project_id=None), params={
            "limit": 10, "offset": 50, "include_archived": True,
        })
    assert response.status_code == 200
    body = response.json()
    assert [item["project_id"] for item in body["data"]] == [project.project_id]
    assert (body["total"], body["limit"], body["offset"]) == (61, 10, 50)
    assert reads == [{"limit": 10, "offset": 50, "include_archived": True}]
