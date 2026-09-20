"""Durability/approval tests use a fake engine and an isolated SQLite database."""
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlmodel import SQLModel

from app.account_context import account_schema, current_schema, storage_scope
from app.api.routes.quick_script import get_quick_script_service
from app.database import create_database_runtime
from app.dependencies import get_long_story_service
from app.host_integration import HostRequestContext
from app.main import create_app
from app.modules.quick_script.engine import draft_body_hash, synopsis_hash
from app.modules.quick_script.models import (
    QuickActionRequest, QuickDraftResult, QuickIssue, QuickModelCall, QuickPlanResult,
    QuickReview, QuickReviewResult, QuickState, QuickSynopsisResult, utc_now,
)
from app.modules.quick_script.repository import QuickRepository
from app.modules.quick_script.service import QuickInputError, QuickService
from app.modules.script_engine.long_story_models import StoryProject, StoryProjectWorkspaceSave
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.long_story_service import LongStoryService


PROJECT_ID = "project.quick-test"


def model_call(stage):
    return QuickModelCall(stage=stage, provider="isolated-test", model="fake-no-network",
                          input_upper_bound_tokens=100, output_reserve_tokens=100, elapsed_ms=1)


class FakeEngine:
    def __init__(self):
        self.calls = []
        self.fail_review_once = False
        self.block_reviews = False
        self.before_draft = None

    def draft_synopsis(self, state):
        self.calls.append("synopsis")
        return QuickSynopsisResult(synopsis="林晚带着旧账本回到家乡，在朋友帮助下查清隐藏证据并公开真相。", call=model_call("synopsis"))

    def draft_plan(self, state):
        from quick_script_fixtures import make_state
        from app.modules.quick_script.engine import plan_content_hash
        self.calls.append("plan")
        plan = make_state(episode_count=state.settings.episode_count).plan.model_copy(deep=True)
        plan.source_synopsis_hash = synopsis_hash(state.synopsis)
        plan.content_hash = plan_content_hash(plan)
        return QuickPlanResult(plan=plan, call=model_call("plan"))

    def generate_episode(self, state, episode_number):
        from quick_script_fixtures import make_draft
        self.calls.append(f"draft:{episode_number}")
        if self.before_draft:
            self.before_draft()
        draft = make_draft(episode_number=episode_number, total_episodes=state.settings.episode_count)
        return QuickDraftResult(draft=draft, body_hash=draft_body_hash(draft), source_plan_hash=state.plan.content_hash,
            source_episode_hashes={str(e.episode_number): e.body_hash for e in state.episodes},
            metrics={"effective_body_characters": 800}, mechanical_issues=[], call=model_call("draft"))

    def review_episode(self, state, episode_number):
        self.calls.append(f"review:{episode_number}")
        if self.fail_review_once:
            self.fail_review_once = False
            raise RuntimeError("fake provider failure; no external request")
        episode = next(e for e in state.episodes if e.episode_number == episode_number)
        issues = [QuickIssue(code="contradiction", severity="critical", message="钥匙归属矛盾。",
            episode_number=episode_number, scene_number=1)] if self.block_reviews else []
        return QuickReviewResult(review=QuickReview(status="blocked" if issues else "passed", summary="已完成本集检查。",
            issues=issues, source_body_hashes={str(episode_number): episode.body_hash}), call=model_call("review"))

    def repair_episode(self, state, episode_number):
        self.calls.append(f"repair:{episode_number}")
        episode = next(e for e in state.episodes if e.episode_number == episode_number)
        draft = episode.draft.model_copy(deep=True)
        draft.synopsis = "修复后的有效正文仍保留此前人物与故事安排，局部修复结束。"
        return QuickDraftResult(draft=draft, body_hash=draft_body_hash(draft), source_plan_hash=state.plan.content_hash,
            source_episode_hashes=episode.source_episode_hashes, metrics={}, mechanical_issues=[], call=model_call("repair"))

    def review_final(self, state):
        self.calls.append("final_review")
        return QuickReviewResult(review=QuickReview(status="passed", summary="全文检查已完成。",
            source_body_hashes={str(e.episode_number): e.body_hash for e in state.episodes}), call=model_call("final_review"))


def make_test_service(runtime=None):
    runtime = runtime or create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    long = LongStoryService(runtime)
    long.save_project(StoryProject(project_id=PROJECT_ID, title="快速模式隔离测试", planned_episode_count=8,
                                  default_batch_size=2, target_total_characters=8000))
    long.save_workspace_snapshot(StoryProjectWorkspaceSave(project_id=PROJECT_ID, revision=1,
        client_instance_id="quick-test-client", workspace_payload={
            "id": PROJECT_ID, "title": "快速模式隔离测试", "titleSource": "user", "marketProfile": "cn_mainland",
            "creationMode": "quick", "creativePrompt": "一个追查旧账本真相的故事。", "characters": [],
            "referenceMaterials": [], "selectedTagIds": [], "customTags": [],
            "generationSettings": {"mode": "full", "episodeCount": 8, "episodeCountMode": "custom",
                "targetTotalCharacters": 8000, "preferredEpisodeDurationMinutes": 1.5, "storyDensity": "balanced",
                "batchSize": 2, "sceneCount": 3, "failureRetryMode": "automatic", "outputLanguage": "zh",
                "releaseRegion": "cn_mainland", "customInstructions": ""},
            "episodes": [], "generationBatches": [], "activeEpisodeNumber": 1,
            "storyLines": [], "characterRelationships": [], "status": "idea",
            "createdAt": utc_now().isoformat(), "updatedAt": utc_now().isoformat(),
        }))
    engine = FakeEngine()
    return QuickService(QuickRepository(runtime), engine), engine, runtime


@pytest.fixture
def service_fixture():
    service, engine, runtime = make_test_service()
    yield service, engine, runtime
    runtime.engine.dispose()


def act(service, action, payload=None, *, operation_id=None, revision=None):
    current = service.get(PROJECT_ID).state
    return service.action(PROJECT_ID, QuickActionRequest(action=action, operation_id=operation_id or str(uuid4()),
        expected_revision=revision if revision is not None else current.revision if current else 0,
        payload=payload or {}))


def ready(service, episode_count=2):
    act(service, "setup", {"settings": {"episode_count": episode_count, "target_total_characters": 2000}})
    act(service, "draft_synopsis")
    act(service, "confirm_synopsis")
    act(service, "draft_plan")
    return act(service, "confirm_plan")


def test_two_approvals_and_exact_happy_path_stages(service_fixture):
    service, engine, _ = service_fixture
    act(service, "setup", {"settings": {"episode_count": 2, "target_total_characters": 2000}})
    with pytest.raises(QuickInputError, match="梗概"):
        act(service, "advance")
    act(service, "draft_synopsis")
    assert engine.calls == ["synopsis"]
    act(service, "confirm_synopsis")
    act(service, "draft_plan")
    with pytest.raises(QuickInputError, match="创作安排"):
        act(service, "advance")
    act(service, "confirm_plan")
    for _ in range(5):
        response = act(service, "advance")
    assert response.state.phase == "complete"
    assert engine.calls == ["synopsis", "plan", "draft:1", "review:1", "draft:2", "review:2", "final_review"]
    assert len(response.state.model_calls) == 7
    assert len(response.workspace_snapshot.workspace_payload["episodes"]) == 2
    assert response.workspace_snapshot.workspace_payload["episodes"][0]["status"] == "saved"
    assert "deliveryConfirmation" not in response.workspace_snapshot.workspace_payload


def test_cas_idempotent_replay_and_operation_reuse(service_fixture):
    service, engine, _ = service_fixture
    act(service, "setup")
    revision = service.get(PROJECT_ID).state.revision
    op = str(uuid4())
    first = act(service, "draft_synopsis", operation_id=op, revision=revision)
    replay = act(service, "draft_synopsis", operation_id=op, revision=revision)
    assert replay.state.revision == first.state.revision
    assert engine.calls == ["synopsis"]
    with pytest.raises(LongStoryPersistenceConflictError, match="同一操作"):
        act(service, "draft_synopsis", {"instruction": "换一版"}, operation_id=op)
    with pytest.raises(LongStoryPersistenceConflictError, match="版本"):
        act(service, "confirm_synopsis", revision=revision)


def test_saved_body_survives_review_failure_and_resumes_without_generation(service_fixture):
    service, engine, _ = service_fixture
    ready(service)
    before = act(service, "advance")
    saved_hash = before.state.episodes[0].body_hash
    engine.fail_review_once = True
    failed = act(service, "advance")
    assert failed.state.phase == "paused"
    assert failed.state.next_step == "review"
    assert failed.state.episodes[0].body_hash == saved_hash
    # A fresh service instance reads durable progress, rather than browser state.
    recovered = QuickService(service.repository, engine)
    act(recovered, "resume")
    result = act(recovered, "advance")
    assert result.state.episodes[0].status == "passed"
    assert engine.calls.count("draft:1") == 1


def test_one_local_repair_and_recheck_then_pause(service_fixture):
    service, engine, _ = service_fixture
    ready(service)
    engine.block_reviews = True
    for _ in range(4):
        response = act(service, "advance")
    assert response.state.status == "blocked"
    assert response.state.episodes[0].repair_count == 1
    assert engine.calls.count("repair:1") == 1
    assert len(response.state.episodes[0].history) == 1
    with pytest.raises(QuickInputError, match="暂停"):
        act(service, "advance")
    with pytest.raises(QuickInputError, match="先修改正文"):
        act(service, "resume")


@pytest.mark.parametrize("issue_kind", ["global", "missing_scene", "ambiguity"])
def test_unrepairable_review_pauses_for_author_and_can_complete_after_edit(service_fixture, issue_kind):
    service, engine, _ = service_fixture
    ready(service)
    act(service, "advance")
    review_episode = engine.review_episode

    def unresolved_review(state, number):
        result = review_episode(state, number)
        issues = [QuickIssue(code="contradiction", severity="critical", message="本集需要作者核对。",
            episode_number=number, scene_number=None if issue_kind == "global" else 99 if issue_kind == "missing_scene" else 1)]
        if issue_kind == "ambiguity":
            issues.append(QuickIssue(code="unclear_intent", severity="ambiguity", message="人物是否知情需要作者决定。"))
        result.review = QuickReview(status="blocked", summary="请确认正文中的问题后继续。", issues=issues,
                                   source_body_hashes=result.review.source_body_hashes)
        return result

    engine.review_episode = unresolved_review
    response = act(service, "advance")
    assert response.state.status == "blocked"
    assert response.state.next_step == "review"
    assert response.state.episodes[0].repair_attempts == 0
    with pytest.raises(QuickInputError, match="先修改正文"):
        act(service, "resume")
    assert not any(call.startswith("repair:") for call in engine.calls)

    # Saving the author's correction is the only transition that clears the
    # unresolved review; later episodes then continue from the saved prefix.
    draft = response.state.episodes[0].draft.model_dump(mode="json")
    draft["synopsis"] = "作者明确了人物知情范围，保留原件核验的动作与证据。"
    act(service, "save_episode", {"episode_number": 1, "draft": draft})
    engine.review_episode = review_episode
    for _ in range(4):
        response = act(service, "advance")
    assert response.state.phase == "complete"
    assert engine.calls.count("draft:1") == 1


def test_unknown_repair_failure_never_releases_reserved_model_attempt(service_fixture):
    service, engine, _ = service_fixture
    ready(service)
    engine.block_reviews = True
    act(service, "advance")
    act(service, "advance")

    def unknown_repair(state, number):
        engine.calls.append(f"repair:{number}")
        raise RuntimeError("request outcome is unknown")

    engine.repair_episode = unknown_repair
    failed = act(service, "advance")
    assert failed.state.episodes[0].repair_attempts == 1
    assert failed.state.status == "blocked"
    assert act(service, "resume").state.status == "blocked"
    assert engine.calls.count("repair:1") == 1


def test_proven_pretransport_repair_failure_can_resume_without_losing_body(service_fixture):
    from app.modules.quick_script.engine import QuickEngineError
    service, engine, _ = service_fixture
    ready(service)
    engine.block_reviews = True
    draft = act(service, "advance").state.episodes[0].draft
    act(service, "advance")
    repair_episode = engine.repair_episode

    def pretransport_repair(state, number):
        call = model_call("repair")
        call.physical_requests = 0
        raise QuickEngineError("模型连接配置需要修正。", call=call)

    engine.repair_episode = pretransport_repair
    failed = act(service, "advance")
    assert failed.state.episodes[0].repair_attempts == 0
    assert failed.state.episodes[0].draft == draft
    engine.repair_episode = repair_episode
    act(service, "resume")
    repaired = act(service, "advance")
    assert repaired.state.next_step == "recheck"
    assert engine.calls.count("repair:1") == 1


def test_author_edits_keep_versions_and_invalidate_dependent_episodes(service_fixture):
    service, _, _ = service_fixture
    ready(service)
    for _ in range(5):
        result = act(service, "advance")
    original = result.state.episodes[0].draft.model_dump(mode="json")
    first = {**original, "synopsis": "作者第一次修改梗概，保留主要人物的决定和动作细节。"}
    second = {**original, "synopsis": "作者第二次修改梗概，补充主要人物选择的真实后果。"}
    act(service, "save_episode", {"episode_number": 1, "draft": first})
    result = act(service, "save_episode", {"episode_number": 1, "draft": second})
    episode = result.state.episodes[0]
    assert [v["revision"] for v in episode.history] == [1, 2]
    assert episode.history[0]["draft"] == original
    assert episode.history[1]["draft"]["synopsis"] == first["synopsis"]
    assert result.state.episodes[1].status == "stale"
    assert result.state.final_review is None
    assert result.state.next_step == "review"


def test_parallel_generic_title_save_survives_model_result(service_fixture):
    service, engine, runtime = service_fixture
    ready(service)
    def edit_title():
        snapshot = service.get(PROJECT_ID).workspace_snapshot
        workspace = deepcopy(snapshot.workspace_payload)
        workspace["title"] = "并行会话修改的标题"
        LongStoryService(runtime).save_workspace_snapshot(StoryProjectWorkspaceSave(
            **{**snapshot.model_dump(exclude={"payload_checksum", "payload_size_bytes"}),
               "workspace_payload": workspace, "revision": snapshot.revision + 1}))
    engine.before_draft = edit_title
    result = act(service, "advance")
    assert result.workspace_snapshot.workspace_payload["title"] == "并行会话修改的标题"
    assert len(result.state.episodes) == 1


@pytest.mark.parametrize("field,value", [("episodes", [{"episodeNumber": 99}]),
    ("quickWorkflow", None), ("creationMode", "standard"), ("generationSettings", {"episodeCount": 100})])
def test_generic_workspace_put_cannot_overwrite_quick_owned_fields(service_fixture, field, value):
    service, _, runtime = service_fixture
    act(service, "setup")
    snapshot = service.get(PROJECT_ID).workspace_snapshot
    workspace = deepcopy(snapshot.workspace_payload)
    workspace[field] = value
    app = create_app(require_host_context=False)
    app.dependency_overrides[get_long_story_service] = lambda: LongStoryService(runtime)
    client = TestClient(app)
    response = client.put(f"/story-projects/{PROJECT_ID}/workspace", json={
        **snapshot.model_dump(mode="json", exclude={"payload_checksum", "payload_size_bytes"}),
        "workspace_payload": workspace, "revision": snapshot.revision + 1,
    })
    assert response.status_code == 409
    assert service.get(PROJECT_ID).workspace_snapshot.revision == snapshot.revision


def test_switch_standard_preserves_body_versions_and_short_targets(service_fixture):
    service, _, _ = service_fixture
    ready(service)
    before = act(service, "advance").workspace_snapshot.workspace_payload
    after = act(service, "switch_standard").workspace_snapshot.workspace_payload
    assert after["creationMode"] == "standard"
    assert after["episodes"] == before["episodes"]
    assert after["generationSettings"] == before["generationSettings"]
    assert after["quickWorkflow"]["episodes"] == before["quickWorkflow"]["episodes"]


@pytest.mark.parametrize("kind", ["overseas", "existing_body"])
def test_setup_rejects_incompatible_project_without_mutation(service_fixture, kind):
    service, _, runtime = service_fixture
    snapshot = service.get(PROJECT_ID).workspace_snapshot
    workspace = deepcopy(snapshot.workspace_payload)
    if kind == "overseas":
        workspace["marketProfile"] = "overseas_tiktok"
    else:
        workspace["episodes"] = [{"episodeNumber": 1, "workingDraftJson": "existing body"}]
    LongStoryService(runtime).save_workspace_snapshot(StoryProjectWorkspaceSave(
        **{**snapshot.model_dump(exclude={"payload_checksum", "payload_size_bytes"}),
           "workspace_payload": workspace, "revision": snapshot.revision + 1}))
    with pytest.raises(QuickInputError):
        act(service, "setup")
    assert service.get(PROJECT_ID).workspace_snapshot.workspace_payload == workspace


@pytest.mark.parametrize("method,permission", [("GET", "project.read"), ("POST", "project.write")])
def test_routes_bind_account_context_and_reject_foreign_project_before_service(service_fixture, method, permission):
    service, _, _ = service_fixture
    observed = []
    async def authorizer(request):
        return HostRequestContext(tenant_id="quick-org", actor_id="quick-author", project_id=PROJECT_ID,
                                  request_id="quick-host-test", permissions={permission})
    app = create_app(host_authorizer=authorizer, require_host_context=False)
    def dependency():
        observed.append((current_schema(), storage_scope.get()))
        return service
    app.dependency_overrides[get_quick_script_service] = dependency
    client = TestClient(app)
    suffix = "/actions" if method == "POST" else ""
    kwargs = {"json": {"action": "setup", "operation_id": str(uuid4()), "expected_revision": 0}} if method == "POST" else {}
    response = client.request(method, f"/story-projects/{PROJECT_ID}/quick-script{suffix}", **kwargs)
    assert response.status_code == 200, response.text
    assert observed[0][0] == account_schema("quick-org", "quick-author")
    assert observed[0][1].active is False
    response = client.request(method, f"/story-projects/project.foreign/quick-script{suffix}", **kwargs)
    assert response.status_code == 403
    assert len(observed) == 1


def test_switch_unstarted_standard_keeps_unsaved_inputs_and_allows_larger_target(service_fixture):
    service, engine, runtime = service_fixture
    response = act(service, "switch_standard", {"idea": "刚写入但尚未生成的故事想法。", "source_material": "作者补充资料。",
        "settings": {"episode_count": 20, "target_total_characters": 20_000}})
    workspace = response.workspace_snapshot.workspace_payload
    assert response.state.phase == "standard"
    assert response.workspace_snapshot.workspace_payload["quickWorkflow"]["schema_version"] == "quick_script.v1"
    assert workspace["creationMode"] == "standard"
    assert workspace["creativePrompt"] == "刚写入但尚未生成的故事想法。"
    assert workspace["referenceMaterials"][-1]["extractedText"] == "作者补充资料。"
    assert workspace["generationSettings"]["targetTotalCharacters"] == 20_000
    assert LongStoryService(runtime).get_project(PROJECT_ID).planned_episode_count == 20
    assert engine.calls == []


def test_busy_lease_prevents_duplicate_model_request(service_fixture):
    service, engine, _ = service_fixture
    ready(service)
    def attempt_duplicate():
        with pytest.raises(LongStoryPersistenceConflictError, match="仍在执行"):
            act(service, "advance")
    engine.before_draft = attempt_duplicate
    act(service, "advance")
    assert engine.calls.count("draft:1") == 1


def test_recovery_reads_active_stage_and_saved_results_without_another_model_request(service_fixture):
    service, engine, _ = service_fixture
    ready(service)
    observed = []

    def observe_inflight():
        calls_before = list(engine.calls)
        for _ in range(3):
            snapshot = QuickService(service.repository, engine).get(PROJECT_ID)
            observed.append(snapshot.state.active_operation)
            assert snapshot.state.episodes == []
        assert engine.calls == calls_before

    engine.before_draft = observe_inflight
    saved = act(service, "advance")
    assert all(operation["stage"] == "draft" and operation["episode_number"] == 1 for operation in observed)
    assert all(operation["expires_at"] > operation["started_at"] for operation in observed)
    receipt = saved.state.operation_records[-1]
    assert receipt["status"] == "completed"
    assert receipt["stage"] == "draft" and receipt["episode_number"] == 1
    assert "instruction" not in receipt
    fresh = QuickService(service.repository, engine).get(PROJECT_ID)
    assert fresh.state.active_operation is None
    assert fresh.state.next_step == "review"
    assert fresh.state.episodes[0].body_hash == saved.state.episodes[0].body_hash
    assert engine.calls == ["synopsis", "plan", "draft:1"]


def test_known_failure_releases_wait_immediately_and_resume_itself_never_calls_model(service_fixture):
    service, engine, _ = service_fixture
    ready(service)
    act(service, "advance")
    engine.fail_review_once = True
    failed = act(service, "advance")
    assert failed.state.active_operation is None
    assert failed.state.operation_records[-1]["stage"] == "review"
    assert failed.state.operation_records[-1]["status"] == "failed"
    calls_before = list(engine.calls)
    restored = act(service, "resume")
    assert restored.state.status == "idle"
    assert restored.state.next_step == "review"
    assert engine.calls == calls_before


def test_expired_unknown_operation_is_restored_without_running_or_accepting_its_late_result(service_fixture):
    from app.modules.quick_script.engine import source_hash
    service, engine, _ = service_fixture
    ready(service)
    op = "expired-unknown-draft-operation"
    fingerprint = source_hash({"action": "advance", "payload": {}})

    def reserve(repo):
        project, snapshot, state = service.repository.load(repo, PROJECT_ID, lock=True)
        state.status = "busy"
        state.active_operation = {"operation_id": op, "fingerprint": fingerprint, "action": "advance",
            "stage": "draft", "episode_number": 1, "expires_at": (utc_now() - timedelta(seconds=1)).isoformat()}
        return service.repository.save(repo, project, snapshot, state)

    pending = service.repository.transaction(reserve)
    calls_before = list(engine.calls)
    with pytest.raises(LongStoryPersistenceConflictError, match="先恢复"):
        act(service, "advance")
    recovered = act(service, "resume")
    assert recovered.state.active_operation is None
    assert recovered.state.next_step == "draft"
    assert engine.calls == calls_before
    assert any(record["operation_id"] == op and record["status"] == "interrupted" for record in recovered.state.operation_records)
    request = QuickActionRequest(action="advance", operation_id=op, expected_revision=pending.state.revision)
    with pytest.raises(LongStoryPersistenceConflictError, match="失去保存权限"):
        service._finish(PROJECT_ID, request, fingerprint, "draft", None, RuntimeError("late completion"))
    assert service.get(PROJECT_ID).state.revision == recovered.state.revision
    assert service.get(PROJECT_ID).state.episodes == []


def test_failed_repair_consumes_one_attempt_and_retains_failed_candidate(service_fixture):
    from app.modules.quick_script.engine import QuickEngineError
    service, engine, _ = service_fixture
    ready(service)
    engine.block_reviews = True
    act(service, "advance")
    act(service, "advance")
    def fail_repair(state, number):
        engine.calls.append("repair:1")
        raise QuickEngineError("修复输出不完整。", call=model_call("repair"), candidate={"scenes": [{"partial": "已返回的候选"}]})
    engine.repair_episode = fail_repair
    failed = act(service, "advance")
    assert failed.state.episodes[0].repair_attempts == 1
    assert failed.state.episodes[0].repair_count == 1
    assert failed.state.operation_records[-1]["candidate"]["scenes"][0]["partial"] == "已返回的候选"
    assert act(service, "resume").state.status == "blocked"
    with pytest.raises(QuickInputError):
        act(service, "advance")
    assert engine.calls.count("repair:1") == 1


def test_invalid_result_is_saved_as_candidate_and_clears_lease(service_fixture):
    service, engine, _ = service_fixture
    ready(service)
    original = engine.generate_episode
    def stale_body(state, number):
        result = original(state, number)
        result.body_hash = "wrong-body-version"
        return result
    engine.generate_episode = stale_body
    response = act(service, "advance")
    assert response.state.phase == "paused"
    assert response.state.active_operation is None
    assert response.state.episodes == []
    assert response.state.operation_records[-1]["error_code"] == "quick_result_apply_failed"
    assert response.state.operation_records[-1]["candidate"]["draft"]["scenes"]
    assert len(response.state.model_calls) == 3


def test_expired_repair_cannot_issue_another_unknown_outcome_request(service_fixture):
    service, engine, _ = service_fixture
    ready(service)
    engine.block_reviews = True
    act(service, "advance")
    act(service, "advance")
    def reserve(repo):
        project, snapshot, state = service.repository.load(repo, PROJECT_ID, lock=True)
        state.episodes[0].repair_attempts = 1
        state.status = "busy"
        state.active_operation = {"operation_id": "interrupted-repair-operation", "fingerprint": "test",
            "stage": "repair", "expires_at": (utc_now() - timedelta(seconds=1)).isoformat()}
        service.repository.save(repo, project, snapshot, state)
    service.repository.transaction(reserve)
    response = act(service, "resume")
    assert response.state.active_operation is None
    assert response.state.status == "blocked"
    assert not any(name.startswith("repair:") for name in engine.calls)


@pytest.mark.parametrize("episode_count", [1, 2, 8])
def test_real_engine_stages_persist_and_complete_with_mock_provider(service_fixture, episode_count):
    from app.modules.quick_script.engine import QuickScriptEngine
    from app.modules.quick_script.models import QuickPlanContent
    from tests.quick_script_fixtures import make_state, make_llm_draft
    from tests.test_quick_script_engine import FakeAdapter, passed
    service, _, _ = service_fixture
    template = make_state(episode_count=episode_count)
    plan = {key: template.plan.model_dump(mode="json")[key] for key in QuickPlanContent.model_fields}
    outputs = [{"synopsis": template.synopsis}, plan]
    for number in range(1, episode_count + 1):
        outputs.extend([make_llm_draft(number, episode_count), passed()])
    outputs.append(passed())
    adapter = FakeAdapter(*outputs)
    service.engine = QuickScriptEngine(planning_adapter=adapter, script_adapter=adapter, verified_context_tokens=500_000)
    act(service, "setup", {"settings": template.settings.model_dump()})
    act(service, "draft_synopsis")
    act(service, "confirm_synopsis")
    act(service, "draft_plan")
    act(service, "confirm_plan")
    for _ in range(2 * episode_count + 1):
        response = act(service, "advance")
        assert response.state.status != "blocked", response.state.blocked_reason
    assert response.state.phase == "complete"
    assert len(adapter.calls) == 2 * episode_count + 3
    assert sum(call.physical_requests for call in response.state.model_calls) == 2 * episode_count + 3
    assert response.state.episodes[-1].draft.ending_mode.value == "series_finale"
    assert not response.state.episodes[-1].draft.scenes[-1].cliffhanger


@pytest.mark.parametrize("status", ["draft", "confirmed"])
def test_existing_synopsis_alone_is_preserved_as_quick_creation_input(service_fixture, status):
    service, engine, runtime = service_fixture
    snapshot = service.get(PROJECT_ID).workspace_snapshot
    workspace = deepcopy(snapshot.workspace_payload)
    workspace["creativePrompt"] = ""
    workspace["storySynopsis"] = {"text": "林澈核验档案中的原始记录，在朋友帮助下公开火灾真相保护证人。",
                                  "status": status, "source": "user", "version": 1}
    LongStoryService(runtime).save_workspace_snapshot(StoryProjectWorkspaceSave(
        **{**snapshot.model_dump(exclude={"payload_checksum", "payload_size_bytes"}),
           "workspace_payload": workspace, "revision": snapshot.revision + 1}))
    response = act(service, "setup", {"idea": "", "source_material": ""})
    assert response.state.idea == workspace["storySynopsis"]["text"]
    assert response.state.synopsis == workspace["storySynopsis"]["text"]
    assert response.state.synopsis_confirmed is (status == "confirmed")
    if status == "confirmed":
        assert response.state.phase == "plan"
        response = act(service, "draft_plan")
        assert response.state.plan is not None
        assert engine.calls == ["plan"]
    else:
        assert response.state.phase == "synopsis"
        assert engine.calls == []


@pytest.mark.parametrize("changed", ["scene_heading", "character_actions", "dialogues", "character_refs"])
def test_author_scene_edit_distrusts_old_asset_manifest_across_save_and_reload(service_fixture, changed):
    service, _, _ = service_fixture
    ready(service)
    before = act(service, "advance")
    draft = before.state.episodes[0].draft.model_dump(mode="json")
    scene = draft["scenes"][0]
    if changed == "scene_heading":
        scene[changed] = "INT. 审讯室 - 夜"
    elif changed == "character_actions":
        scene[changed][0] = "林澈把透明比对尺移开，取出新的证物袋装好原件。"
    elif changed == "dialogues":
        scene[changed][0]["character_name"] = "证人"
    else:
        scene[changed] = ["character.witness"]
    key = "quick_asset_evidence_invalidated_scenes"
    saved = act(service, "save_episode", {"episode_number": 1, "draft": draft})
    assert saved.state.episodes[0].draft.llm_metadata[key] == [1]
    assert key not in saved.state.episodes[0].history[0]["draft"]["llm_metadata"]
    persisted = service.get(PROJECT_ID).state.episodes[0].draft
    assert persisted.llm_metadata[key] == [1]
    unchanged_body = persisted.model_dump(mode="json")
    unchanged_body["llm_metadata"].pop(key)
    unchanged_body["title"] = "作者修改后的本集标题"
    again = act(service, "save_episode", {"episode_number": 1, "draft": unchanged_body})
    assert again.state.episodes[0].draft.llm_metadata[key] == [1]
    projection = again.workspace_snapshot.workspace_payload["episodes"][0]["generationRun"]["draft_master_script"]
    assert projection["llm_metadata"][key] == [1]


def test_title_only_edit_preserves_existing_scene_evidence(service_fixture):
    service, _, _ = service_fixture
    ready(service)
    before = act(service, "advance")
    draft = before.state.episodes[0].draft.model_dump(mode="json")
    draft["title"] = "作者修改后的本集标题"
    saved = act(service, "save_episode", {"episode_number": 1, "draft": draft})
    assert "quick_asset_evidence_invalidated_scenes" not in saved.state.episodes[0].draft.llm_metadata


def test_local_repair_invalidates_manifest_for_changed_scenes(service_fixture):
    service, engine, _ = service_fixture
    ready(service)
    engine.block_reviews = True
    original_repair = engine.repair_episode

    def repair_body(state, number):
        result = original_repair(state, number)
        result.draft.scenes[0].character_actions[0] = "林澈归还证物袋，只保留已经核实的签名复印件。"
        result.body_hash = draft_body_hash(result.draft)
        return result

    engine.repair_episode = repair_body
    for _ in range(3):
        response = act(service, "advance")
    assert response.state.next_step == "recheck"
    assert response.state.episodes[0].draft.llm_metadata["quick_asset_evidence_invalidated_scenes"] == [1]
