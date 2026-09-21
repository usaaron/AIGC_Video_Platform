"""Recovery affordances come from current server evidence and never mutate state."""
from copy import deepcopy

import pytest
import app.main

from app.modules.quick_script.engine import draft_body_hash, mechanical_review
from app.modules.quick_script.models import QuickIssue, QuickReview
from app.modules.quick_script.recovery import recovery_action
from app.modules.quick_script.repository import QuickRepository
from tests.quick_script_fixtures import add_episode, make_state
from tests.test_quick_mechanical_repair import short_state
from tests.test_quick_script_service import PROJECT_ID, act, make_test_service, ready


def paused(state):
    state.phase, state.status, state.next_step = "paused", "blocked", "review"
    return state


def test_repair_hint_is_response_only_and_does_not_save_or_change_revisions():
    service, _, runtime = make_test_service()
    try:
        project, snapshot, _ = service.repository.transaction(lambda repo: service.repository.load(repo, PROJECT_ID))
        state = paused(short_state())
        state.project_id = PROJECT_ID
        snapshot.workspace_payload["quickWorkflow"] = state.model_dump(mode="json")
        before = deepcopy((project.model_dump(), snapshot.model_dump(), state.model_dump()))
        result = QuickRepository.response(project, snapshot, state)
        assert result.recovery_action == "repair"
        assert result.project_revision == project.revision
        assert (project.model_dump(), snapshot.model_dump(), state.model_dump()) == before
        assert "recovery_action" not in result.state.model_dump()
        assert "recovery_action" not in result.workspace_snapshot.workspace_payload
        assert service.get(PROJECT_ID).state is None  # Response derivation did not persist the fixture.
    finally:
        runtime.engine.dispose()


@pytest.mark.parametrize("change", ["active", "idle", "wrong_phase", "stale_review", "stale_body", "stale_plan", "wrong_pending"])
def test_repair_hint_never_appears_for_busy_or_unverified_state(change):
    state = paused(short_state(number=2))
    episode = state.episodes[-1]
    if change == "active":
        state.active_operation = {"stage": "review"}
    elif change == "idle":
        state.status = "idle"
    elif change == "wrong_phase":
        state.phase = "writing"
    elif change == "stale_review":
        episode.review.source_body_hashes = {"2": "previous-body"}
    elif change == "stale_body":
        episode.draft.scenes[0].character_actions[0] += "作者刚修改此处。"
    elif change == "stale_plan":
        state.plan.main_storyline += "创作安排已经修改。"
    else:
        state.episodes[0].status = "stale"
    assert recovery_action(state) is None


def test_switch_hint_uses_only_latest_matching_structured_failure():
    state = paused(make_state())
    state.next_step = "draft"
    state.blocked_reason = "quick_context_limit 超出上下文，请转标准流程。"
    assert recovery_action(state) is None  # Human/model prose is not authority.
    record = {"status": "failed", "revision": state.revision, "stage": "draft", "episode_number": 1,
              "error_code": "quick_context_limit"}
    state.operation_records = [record]
    assert recovery_action(state) == "switch_standard"
    for field, value in [("revision", state.revision - 1), ("stage", "plan"), ("episode_number", 2),
                         ("error_code", "quick_model_timeout"), ("status", "completed")]:
        state.operation_records = [{**record, field: value}]
        assert recovery_action(state) is None
    state.operation_records = [record, {"status": "completed", "revision": state.revision}]
    assert recovery_action(state) is None
    state.operation_records = [{**record, "error_code": "quick_length_limit"}]
    assert recovery_action(state) == "switch_standard"
    state.next_step = "done"
    state.operation_records = [{**record, "error_code": "quick_result_apply_failed"}]
    assert recovery_action(state) == "switch_standard"
    state.active_operation = {"stage": "draft"}
    assert recovery_action(state) is None


@pytest.mark.parametrize("code", ["ending_mode", "unknown_character"])
def test_metadata_hint_requires_current_review_and_local_reproduction(code):
    state = paused(make_state())
    episode = add_episode(state, status="blocked")
    episode.review = QuickReview(status="blocked", summary="需要调整制作字段。", issues=[
        QuickIssue(code=code, severity="critical", message="制作字段与批准安排不一致。", episode_number=1)],
        source_body_hashes={"1": episode.body_hash})
    assert recovery_action(state) is None  # A model label alone is insufficient.
    if code == "ending_mode":
        episode.draft.ending_mode = type(episode.draft.ending_mode)("series_finale")
    else:
        episode.draft.characters[0].name = "未批准人物"
    episode.body_hash = draft_body_hash(episode.draft)
    episode.review.source_body_hashes = {"1": episode.body_hash}
    assert code in {issue.code for issue in mechanical_review(state, 1, episode.draft)[1]}
    assert recovery_action(state) == "switch_standard"
    episode.review.source_body_hashes = {"1": "older-body"}
    assert recovery_action(state) is None


def test_normal_author_edit_clears_hint_and_preserves_old_failure_as_history():
    service, fake, runtime = make_test_service()
    try:
        ready(service)
        act(service, "advance")
        def fail_review(state, number):
            from app.modules.quick_script.engine import QuickEngineError
            raise QuickEngineError("完整上下文超过当前预算。", code="quick_context_limit")
        fake.review_episode = fail_review
        blocked = act(service, "advance")
        assert blocked.recovery_action == "switch_standard"
        edited = blocked.state.episodes[0].draft.model_dump(mode="json")
        edited["scenes"][0]["character_actions"][0] += "林澈指给保管员核对。"
        saved = act(service, "save_episode", {"episode_number": 1, "draft": edited})
        assert saved.recovery_action is None
        assert service.get(PROJECT_ID).recovery_action is None
        assert any(row.get("error_code") == "quick_context_limit" for row in saved.state.operation_records)
    finally:
        runtime.engine.dispose()
