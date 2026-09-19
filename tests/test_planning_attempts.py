"""Persist failed decomposition evidence without modifying story versions."""

from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import SQLModel, select

from app.database import create_database_runtime
from app.document_repository import ModuleDocumentRecord
from app.modules.script_engine.llm_adapter import LLMStructuredOutputError
from app.modules.script_engine.planning_attempts import (
    ATTEMPT_NAMESPACE, PlanningAttemptBinding, PlanningAttemptRecord, PlanningAttemptRepository,
    bind_planning_attempt, capture_planning_candidate, capture_planning_error,
    load_planning_resume_candidates,
)
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_planning_repair_transport import ScriptedTransport
from tests.test_story_planning_service import build_strategy


@pytest.fixture
def evidence(tmp_path):
    url = f"sqlite:///{tmp_path / 'attempts.db'}"
    runtime = create_database_runtime(url)
    SQLModel.metadata.create_all(runtime.engine)
    binding = PlanningAttemptBinding(
        story_project_id="project.evidence", parent_node_id="node.parent",
        parent_node_version=3, request_fingerprint="a" * 64,
        source_fingerprint="b" * 64, operation_id="operation.evidence",
    )
    return url, runtime, PlanningAttemptRepository(runtime), binding


def test_failed_raw_and_complete_candidate_survive_restart_and_are_immutable(evidence):
    url, runtime, repository, binding = evidence
    raw = '{"children":[{"title":"原稿未闭合，Eileen 被救'
    candidate = {"children": [{"title": "展开", "unit_story_beats": ["Lina 提供理论；Lane 设计机器。"]}]}
    with pytest.raises(ValueError, match="事件索引缺失"):
        with bind_planning_attempt(repository, binding):
            capture_planning_error("first", LLMStructuredOutputError("JSON incomplete", raw_content=raw))
            capture_planning_candidate("repair", candidate)
            raise ValueError("事件索引缺失")
    candidate["children"][0]["title"] = "later mutation"
    restarted = PlanningAttemptRepository(create_database_runtime(url))
    records = restarted.list_for_binding(binding)
    assert [item.kind for item in records] == ["error", "candidate", "failed"]
    assert records[0].candidate == raw
    assert records[1].candidate["children"][0]["title"] == "展开"
    assert records[-1].error == "ValueError"
    with pytest.raises(IntegrityError):
        restarted.append(records[0])
    assert restarted.list_for_binding(binding) == records
    # Dedicated module documents only: no project, node, script or approval writes.
    with runtime.session() as session:
        assert {row.namespace for row in session.exec(select(ModuleDocumentRecord)).all()} == {ATTEMPT_NAMESPACE}


@pytest.mark.parametrize("change", [
    {"story_project_id": "project.other"}, {"parent_node_version": 4},
    {"source_fingerprint": "c" * 64}, {"request_fingerprint": "d" * 64},
    {"operation_id": "operation.other"},
])
def test_evidence_is_bound_to_exact_source_parent_and_operation(evidence, change):
    _, _, repository, binding = evidence
    with bind_planning_attempt(repository, binding):
        capture_planning_candidate("first", {"children": []})
    assert repository.list_for_binding(binding.model_copy(update=change)) == []


def test_capture_is_context_scoped_and_safe_for_parallel_model_routes(evidence):
    _, _, repository, binding = evidence
    capture_planning_candidate("outside", {"unrelated": True})
    with bind_planning_attempt(repository, binding):
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(copy_context().run, capture_planning_candidate,
                                       f"route-{i}", {"child": i}) for i in range(2)]
            for future in futures:
                future.result()
    capture_planning_candidate("after", {"unrelated": True})
    records = repository.list_for_binding(binding)
    assert len(records) == 3
    assert {item.artifact for item in records} == {"route-0", "route-1", "decomposition"}
    assert len({item.attempt_id for item in records}) == 1


def test_real_structured_boundary_captures_reply_before_validation(evidence):
    _, _, repository, binding = evidence
    reply = {"children": [{"missing_required_fields": "不完整，但不得丢失"}]}
    adapter = ScriptedTransport([reply])
    with bind_planning_attempt(repository, binding):
        result = StoryPlanningService._generate_structured_planning_response(
            adapter, "source", strategy=build_strategy(), output_schema=None,
            artifact_name="Story Plan Node decomposition node=parent",
        )
    assert result["children"] == reply["children"]
    assert repository.list_for_binding(binding)[0].candidate == reply


def test_real_structured_boundary_preserves_malformed_response(evidence):
    _, _, repository, binding = evidence
    raw = '{"children":[{"title":"保留残稿"'
    adapter = ScriptedTransport([LLMStructuredOutputError("invalid JSON", raw_content=raw)])
    with pytest.raises(LLMStructuredOutputError):
        with bind_planning_attempt(repository, binding):
            StoryPlanningService._generate_structured_planning_response(
                adapter, "source", strategy=build_strategy(), output_schema=None,
                artifact_name="Story Plan Node decomposition node=parent",
            )
    assert repository.list_for_binding(binding)[0].candidate == raw


def test_evidence_write_failure_preserves_original_exception_and_candidate_failure_stops(evidence, caplog):
    _, _, repository, binding = evidence

    def unavailable(_):
        raise RuntimeError("database password=must-not-log")

    repository.append = unavailable
    original = LLMStructuredOutputError("original syntax failure", raw_content="partial output")
    with pytest.raises(LLMStructuredOutputError) as caught:
        with bind_planning_attempt(repository, binding):
            capture_planning_error("parse", original)
            raise original
    assert caught.value is original
    assert "must-not-log" not in caplog.text
    with pytest.raises(RuntimeError, match="database password"):
        with bind_planning_attempt(repository, binding):
            capture_planning_candidate("returned reply", {"title": "must persist"})


def test_provider_failure_evidence_does_not_store_echoed_secrets(evidence):
    from app.modules.script_engine.llm_adapter import LLMRequestError
    from app.modules.script_engine.planning_errors import StoryPlanningInputError
    _, _, repository, binding = evidence
    error = LLMRequestError("Authorization: Bearer secret-key; api_key=secret-key",
                            status_code=401, category="provider_http")
    with bind_planning_attempt(repository, binding):
        capture_planning_error("provider", error)
        capture_planning_error("validation", StoryPlanningInputError("第26集遗漏已确认救援事件"))
    saved = repository.list_for_binding(binding)[0]
    assert "secret-key" not in saved.model_dump_json()
    assert saved.error == "LLMRequestError: status=401 category=provider_http"
    assert repository.list_for_binding(binding)[1].error == "第26集遗漏已确认救援事件"


def test_primary_raw_reply_survives_successful_model_fallback(evidence):
    import httpx
    from app.modules.script_engine.llm_adapter import ModelFailoverLLMAdapter
    from tests.test_planning_call_budget import real_adapter
    from tests.test_llm_adapter import build_openai_compatible_response

    _, _, repository, binding = evidence
    raw = '{"title":"primary unfinished'
    primary = real_adapter(lambda _: httpx.Response(200, json=build_openai_compatible_response(raw)),
                           model="primary")
    fallback = real_adapter(lambda _: httpx.Response(200, json=build_openai_compatible_response('{"title":"valid"}')),
                            model="fallback")
    adapter = ModelFailoverLLMAdapter(primary=primary, fallback=fallback)
    with bind_planning_attempt(repository, binding):
        result = adapter.generate_structured_output("offline", strategy=build_strategy())
    assert result["title"] == "valid"
    records = repository.list_for_binding(binding)
    assert any(item.candidate == raw and "model=primary" in item.artifact for item in records)
    assert any(item.kind == "error" and "model=primary" in item.artifact for item in records)


def test_resume_candidates_read_only_exact_prior_requests_in_creation_order(evidence, monkeypatch):
    _, _, repository, binding = evidence
    second = binding.model_copy(update={"request_fingerprint": "c" * 64})
    now = datetime.now(timezone.utc)
    entries = [
        (binding, "candidate", {"children": [{"title": "first"}], "_meta": {"kept": True}}),
        (second, "candidate", "raw output is not a parsed candidate"),
        (second, "error", {"children": [{"title": "error payload"}]}),
        (second, "candidate", {"children": [{"title": "second"}]}),
    ]
    for i, (entry_binding, kind, candidate) in enumerate(entries):
        repository.append(PlanningAttemptRecord(
            attempt_id="prior", binding=entry_binding, kind=kind, artifact="reply",
            candidate=candidate, created_at=now + timedelta(seconds=i),
        ))
    before = repository.list_for_binding(binding) + repository.list_for_binding(second)
    current = binding.model_copy(update={"request_fingerprint": "d" * 64})
    with bind_planning_attempt(repository, current):
        with monkeypatch.context() as patch:
            patch.setattr(repository, "append", lambda _: pytest.fail("resume query must not write"))
            resumed = load_planning_resume_candidates(["c" * 64, "a" * 64, "a" * 64])
            assert [item["children"][0]["title"] for item in resumed] == ["first", "second"]
            assert resumed[0]["_meta"] == {"kept": True}
            resumed[0]["children"][0]["title"] = "caller edit"
            assert load_planning_resume_candidates(["a" * 64])[0]["children"][0]["title"] == "first"
            assert load_planning_resume_candidates([]) == []
    assert repository.list_for_binding(binding) + repository.list_for_binding(second) == before


@pytest.mark.parametrize("change, requested", [
    ({"story_project_id": "project.other"}, "a" * 64),
    ({"parent_node_id": "node.other"}, "a" * 64),
    ({"parent_node_version": 4}, "a" * 64),
    ({"source_fingerprint": "e" * 64}, "a" * 64),
    ({"operation_id": "operation.other"}, "a" * 64),
    ({}, "f" * 64),
])
def test_resume_candidates_cannot_cross_source_parent_operation_or_request(evidence, change, requested):
    _, _, repository, binding = evidence
    repository.append(PlanningAttemptRecord(
        attempt_id="prior", binding=binding, kind="candidate", artifact="reply",
        candidate={"children": [{"title": "unrelated"}]},
    ))
    current = binding.model_copy(update={"request_fingerprint": "d" * 64, **change})
    with bind_planning_attempt(repository, current):
        assert load_planning_resume_candidates([requested]) == []


def test_resume_candidates_without_scope_are_empty(evidence):
    _, _, repository, binding = evidence
    assert load_planning_resume_candidates(["a" * 64]) == []
    with bind_planning_attempt(None, binding):
        assert load_planning_resume_candidates(["a" * 64]) == []
