"""Run only against a disposable dedicated PostgreSQL database:

TEST_DATABASE_URL=postgresql+psycopg://... python -m pytest tests/test_account_storage_postgres.py -q
No provider requests, production connections, or credentials are used by tests.
"""

import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from contextvars import copy_context
import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import sys
from time import time
from types import SimpleNamespace
from uuid import uuid4

from fastapi import Request
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.account_context import (
    AccountContextError, StorageScope, account_schema, current_schema, storage_scope, system_storage,
)
from app.account_storage import AccountStorage
from app.database import create_database_runtime
from app.host_integration import environment_host_authorizer
from app.main import create_app
from app.modules.asset.models import Asset
from app.modules.asset.repository import AssetRepository
from app.modules.script_engine.long_story_models import StoryProject
from app.modules.script_engine.long_story_service import LongStoryService
from scripts.prepare_production import prepare


@pytest.fixture
def pg(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL", "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL must point to a disposable PostgreSQL database")
    runtime = create_database_runtime(url)
    assert runtime.engine.dialect.name == "postgresql"
    monkeypatch.setenv("SCRIPT_MASTER_ACCOUNT_ISOLATION", "true")
    monkeypatch.setenv("HOST_INTEGRATION_SECRET", "test-only-signing-secret")
    monkeypatch.setattr("app.dependencies.get_long_story_database_runtime", lambda: runtime)
    monkeypatch.setattr("app.main.get_long_story_database_runtime", lambda: runtime)
    # Feed background loop is exercised without an external HTTP request.
    monkeypatch.setattr("app.main.get_hongguo_trends_service", lambda: SimpleNamespace(refresh_due=lambda stop: None))
    runtime.account_storage.ensure_schema("public", upgrade=True)
    prefix = "isolation-test-" + uuid4().hex
    schemas = set()

    def identity(tenant="org", actor="one"):
        tenant_id = f"{prefix}-{tenant}"
        schema = account_schema(tenant_id, actor)
        schemas.add(schema)
        return tenant_id, actor, schema

    @contextmanager
    def account(tenant="org", actor="one"):
        _, _, schema = identity(tenant, actor)
        scope = StorageScope(required=True, schema=schema)
        token = storage_scope.set(scope)
        try:
            yield schema
        finally:
            scope.active = False
            storage_scope.reset(token)

    def bearer(tenant="org", actor="one", **overrides):
        tenant_id, actor_id, _ = identity(tenant, actor)
        claims = dict(version=1, issuer="seqora", audience="script-master", issuedAt=int(time()),
                      expiresAt=int(time()) + 300, tokenId=uuid4().hex, tenantId=tenant_id,
                      actorId=actor_id, roles=["member"], permissions=["project.read", "project.write"], projectId=None)
        claims.update(overrides)
        payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
        signature = base64.urlsafe_b64encode(hmac.new(b"test-only-signing-secret", payload.encode(), hashlib.sha256).digest()).decode().rstrip("=")
        return {"Authorization": f"Bearer {payload}.{signature}"}

    try:
        yield SimpleNamespace(runtime=runtime, account=account, identity=identity, bearer=bearer)
    finally:
        with runtime.engine.begin() as connection:
            for schema in schemas:
                connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        runtime.engine.dispose()


def asset(title):
    return Asset(id="character.shared", asset_type="character", title=title,
                 summary="Private generated character", tags=[dict(ontology_node_id="genre.test", label="Test", category="Genre")],
                 content={"text": "A private character belonging to this account."})


def project(title):
    return StoryProject(project_id="project.shared", title=title, content_spec_id="spec.shared", planned_episode_count=100)


def test_same_org_and_cross_org_isolate_same_ids_and_survive_new_pool(pg):
    repository = AssetRepository(lambda: pg.runtime)
    service = LongStoryService(pg.runtime)  # One cached service across accounts.
    accounts = [("org", "one"), ("org", "two"), ("other", "one")]
    for tenant, actor in accounts:
        with pg.account(tenant, actor):
            assert repository.get("character.shared") is None
            assert service.list_projects() == ([], 0)
            title = f"{tenant}-{actor}"
            repository.save(asset(title))
            service.save_project(project(title))
    fresh = create_database_runtime(pg.runtime.engine.url.render_as_string(hide_password=False))
    try:
        for tenant, actor in accounts:
            with pg.account(tenant, actor):
                title = f"{tenant}-{actor}"
                assert AssetRepository(lambda: fresh).get("character.shared").title == title
                assert LongStoryService(fresh).list_projects()[0][0].title == title
    finally:
        fresh.engine.dispose()
    with system_storage(), pg.runtime.session() as session:
        assert session.execute(text("SELECT count(*) FROM module_documents WHERE document_id='character.shared'")).scalar() == 0
        assert session.execute(text("SELECT count(*) FROM story_projects WHERE project_id='project.shared'")).scalar() == 0


def test_new_planning_attempts_keep_private_candidates_in_account_schema(pg):
    from app.modules.script_engine.planning_attempts import (
        ATTEMPT_NAMESPACE, PlanningAttemptBinding, PlanningAttemptRecord, PlanningAttemptRepository,
    )

    repository = PlanningAttemptRepository(pg.runtime)
    binding = PlanningAttemptBinding(
        story_project_id="project.shared", parent_node_id="node.shared", parent_node_version=1,
        request_fingerprint="a" * 64, source_fingerprint="b" * 64, operation_id="decompose.shared",
    )
    for actor in ("one", "two"):
        with pg.account(actor=actor):
            assert repository.list_for_binding(binding) == []
            repository.append(PlanningAttemptRecord(
                id="candidate.shared", attempt_id="attempt.shared", binding=binding,
                kind="candidate", artifact="decomposition", candidate={"private_story": actor},
            ))

    fresh = create_database_runtime(pg.runtime.engine.url.render_as_string(hide_password=False))
    try:
        for actor in ("one", "two"):
            with pg.account(actor=actor):
                records = PlanningAttemptRepository(fresh).list_for_binding(binding)
                assert len(records) == 1
                assert records[0].candidate == {"private_story": actor}
    finally:
        fresh.engine.dispose()
    with system_storage(), pg.runtime.session() as session:
        assert session.execute(text(
            "SELECT count(*) FROM module_documents WHERE namespace=:namespace"
        ), {"namespace": ATTEMPT_NAMESPACE}).scalar() == 0


def test_explicit_commit_rollback_and_pool_checkout_reapply_schema(pg):
    with pg.account() as expected, pg.runtime.session() as session:
        assert session.execute(text("SELECT current_schema()")).scalar() == expected
        session.commit()
        assert session.execute(text("SELECT current_schema()")).scalar() == expected
        session.rollback()
        assert session.execute(text("SELECT current_schema()")).scalar() == expected
    with pg.account(actor="two") as expected, pg.runtime.session() as session:
        assert session.execute(text("SELECT current_schema()")).scalar() == expected
    with system_storage(), pg.runtime.session() as session:
        assert session.execute(text("SELECT current_schema()")).scalar() == "public"
    with pytest.raises(AccountContextError):
        with pg.runtime.session():
            pass


def test_foreign_keys_cannot_reference_another_account_parent(pg):
    insert_child = text("""
        INSERT INTO story_bible_versions
            (story_bible_id, version, story_project_id, content_spec_id,
             schema_version, status, created_at, payload)
        VALUES ('bible.shared', 1, 'project.shared', 'spec.shared', 'v1', 'draft', now(), '{}')
    """)
    with pg.account():
        LongStoryService(pg.runtime).save_project(project("Only account one owns parent"))
        with pg.runtime.session() as session:
            session.execute(insert_child)
    with pg.account(actor="two") as schema:
        with pytest.raises(IntegrityError) as error:
            with pg.runtime.session() as session:
                session.execute(insert_child)
        assert error.value.orig.sqlstate == "23503"  # Actual foreign key violation.
        with pg.runtime.session() as session:
            assert session.execute(text("""
                SELECT count(*) FROM pg_constraint c
                JOIN pg_class target ON target.oid = c.confrelid
                WHERE c.contype = 'f' AND c.connamespace = to_regnamespace(:schema)
                  AND target.relnamespace != c.connamespace
            """), {"schema": schema}).scalar() == 0
        LongStoryService(pg.runtime).save_project(project("Account two owns its own parent"))
        with pg.runtime.session() as session:
            session.execute(insert_child)  # Same child ID is valid independently.


def test_revoked_open_transaction_cannot_execute_or_commit(pg):
    with pytest.raises(AccountContextError):
        with pg.account(), pg.runtime.session() as session:
            session.execute(text("INSERT INTO module_documents VALUES ('test', 'revoked', now(), now(), '{}')"))
            storage_scope.get().active = False
            with pytest.raises(AccountContextError):
                session.execute(text("SELECT 1"))
            # The context manager's commit also rejects an already-open txn.
    with pg.account(), pg.runtime.session() as session:
        assert session.execute(text("SELECT count(*) FROM module_documents WHERE document_id='revoked'")).scalar() == 0


def test_concurrent_initialization_migrates_once_and_rolls_back_on_failure(pg, monkeypatch):
    _, _, schema = pg.identity(actor="concurrent")
    storages = [AccountStorage(pg.runtime.engine) for _ in range(3)]
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda manager: manager.ensure_schema(schema), storages))
    # Independent processes do not share the Python lock: this exercises the
    # PostgreSQL advisory transaction lock used across uvicorn workers.
    _, _, cross_process = pg.identity(actor="cross-process")
    program = (
        "import os,sys; from app.database import create_database_runtime; "
        "r=create_database_runtime(os.environ['TEST_DATABASE_URL']); "
        "r.account_storage.ensure_schema(sys.argv[1]); r.engine.dispose()"
    )
    environment = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "backend")}
    children = [subprocess.Popen([sys.executable, "-c", program, cross_process], env=environment,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(2)]
    try:
        for child in children:
            stdout, stderr = child.communicate(timeout=90)
            assert child.returncode == 0, (stdout + stderr)[-2000:]
    finally:
        for child in children:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
    with pg.runtime.engine.connect() as connection:
        assert connection.execute(text(f'SELECT version_num FROM "{schema}".alembic_version')).scalar() == "20260910_0012"
        assert connection.execute(text(f'SELECT count(*) FROM "{schema}".agent_runs')).scalar() == 0
    _, _, failed = pg.identity(actor="failed")
    import app.account_storage as module
    original = module.migrate_connection
    def fail(connection, schema=None):
        original(connection, schema)
        raise RuntimeError("simulated migration failure")
    monkeypatch.setattr(module, "migrate_connection", fail)
    with pytest.raises(RuntimeError, match="simulated"):
        pg.runtime.account_storage.ensure_schema(failed)
    with pg.runtime.engine.connect() as connection:
        assert connection.execute(text("SELECT to_regnamespace(:name)"), {"name": failed}).scalar() is None
    monkeypatch.setattr(module, "migrate_connection", original)
    pg.runtime.account_storage.ensure_schema(failed)


def test_static_seed_both_markets_only_and_upgrade_existing_accounts(pg):
    with pg.account():
        pg.runtime.prepare_account(current_schema())
    with system_storage():
        AssetRepository(lambda: pg.runtime).save(asset("Never copy private public legacy content"))
    try:
        counts, upgraded = prepare(pg.runtime, model_config=SimpleNamespace(provider="openai_compatible", model_name="mock-model"))
        assert counts["platform_profiles"] == 2
        assert upgraded >= 1
        for actor in ("one", "new"):
            with pg.account(actor=actor):
                assets = AssetRepository(lambda: pg.runtime).list()
                assert "character.shared" not in {item.id for item in assets}
                assert {item.metadata["market_profile"] for item in assets} == {"cn_mainland", "overseas_tiktok"}
                with pg.runtime.session() as session:
                    assert session.execute(text("SELECT count(*) FROM story_projects")).scalar() == 0
        with pg.account():
            repository = AssetRepository(lambda: pg.runtime)
            row = repository.list()[0]
            row.title = "Account customization survives upgrade"
            repository.save(row)
        pg.runtime.account_storage.upgrade_all()
        with pg.account():
            assert repository.get(row.id).title == "Account customization survives upgrade"
    finally:
        with system_storage(), pg.runtime.session() as session:
            session.execute(text("DELETE FROM module_documents WHERE namespace='assets' AND document_id='character.shared'"))


def test_real_signed_http_permissions_scopes_and_expiry(pg):
    app = create_app(host_authorizer=environment_host_authorizer(), require_host_context=True)
    with TestClient(app) as client:
        assert client.get("/health/ready").status_code == 200
        assert client.get("/assets").status_code == 401
        assert client.get("/assets", headers={"X-Tenant-ID": "spoof"}).status_code == 401
        assert client.get("/assets", headers=pg.bearer(expiresAt=int(time()) - 1)).status_code == 401
        assert client.get("/assets", headers=pg.bearer(permissions="project.read")).status_code == 401
        read_only = pg.bearer(permissions=["project.read"])
        assert client.post("/script-generation/generate-draft", headers=read_only, json={}).status_code == 403
        assert client.put("/story-projects/project.shared", headers=read_only, json={}).status_code == 403
        assert client.get("/benchmarks", headers=read_only).status_code == 200
        assert client.get("/assets", headers=pg.bearer(permissions=[])).status_code == 403
        for tenant, actor in (("org", "one"), ("org", "two"), ("other", "one")):
            headers = pg.bearer(tenant, actor)
            assert client.get("/story-projects", headers=headers).json()["data"] == []
            response = client.put("/story-projects/project.shared", headers=headers, json=project(f"{tenant}-{actor}").model_dump(mode="json"))
            assert response.status_code == 200, response.text
        for tenant, actor in (("org", "one"), ("org", "two"), ("other", "one")):
            assert client.get("/story-projects", headers=pg.bearer(tenant, actor)).json()["data"][0]["title"] == f"{tenant}-{actor}"
        scoped = pg.bearer(projectId="project.shared")
        assert client.get("/story-projects/project.foreign", headers=scoped).status_code == 403
        assert client.get("/assets?project_id=project.foreign", headers=scoped).status_code == 403
        assert client.get("/assets?project_id=project.shared&project_id=project.foreign", headers=scoped).status_code == 403
        assert client.put("/story-projects/project.shared", headers=scoped, json={"project_id": "project.foreign"}).status_code == 403
        assert client.post("/script-generation/generate-draft", headers=scoped, json={"nested": {"story_project_id": "project.foreign"}}).status_code == 403
        assert client.get("/docs").status_code == 404
    assert storage_scope.get() is None


def test_concurrent_sse_scope_survives_stream_and_cannot_escape_response(pg):
    app = create_app(host_authorizer=environment_host_authorizer(), require_host_context=True)
    captured = []
    repository = AssetRepository(lambda: pg.runtime)
    @app.get("/test-stream")
    async def stream(request: Request):
        captured.append(copy_context())
        identity = request.state.host_context.actor_id
        async def events():
            await asyncio.sleep(0.01)
            await asyncio.to_thread(repository.save, asset(f"Stream-{identity}"))
            await asyncio.sleep(0.01)
            yield "data: " + (await asyncio.to_thread(repository.get, "character.shared")).title + "\n\n"
        return StreamingResponse(events(), media_type="text/event-stream")
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            responses = await asyncio.gather(*[client.get("/test-stream", headers=pg.bearer(actor=actor)) for actor in ("one", "two")])
            assert [response.text for response in responses] == ["data: Stream-one\n\n", "data: Stream-two\n\n"]
    asyncio.run(run())
    for context in captured:
        with pytest.raises(AccountContextError):
            context.run(repository.get, "character.shared")
    assert storage_scope.get() is None
