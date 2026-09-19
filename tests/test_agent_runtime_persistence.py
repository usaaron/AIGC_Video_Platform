from __future__ import annotations

import pytest
from sqlalchemy import func
from sqlmodel import SQLModel, select

from app.database import create_database_runtime
from app.modules.agent_runtime.models import AgentRunPolicy, AgentRunStatus, AgentToolKind
from app.modules.agent_runtime.repository import (
    AgentRunInProgressError,
    AgentRunPersistenceConflictError,
)
from app.modules.agent_runtime.persistence import AgentStepRecordTable
from app.modules.agent_runtime.service import AgentRunService
from app.modules.script_engine.llm_adapter import LLMRequestError
from app.modules.script_engine.script_post_editor import InvalidScriptPostEditError


def test_agent_run_persists_steps_and_replays_validated_checkpoint() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=2,
        max_model_tool_calls=1,
        allowed_tools=frozenset({"draft", "inspect"}),
    )
    calls = 0

    first = service.start_session(
        agent_name="episode_roadmap",
        subject_ref="project.1:episode-1",
        policy=policy,
        request_key="agent-request.persist.1",
        input_fingerprint="1" * 64,
        project_id="project.1",
        episode_number=1,
    )
    assert first.session is not None

    def draft() -> dict[str, str]:
        nonlocal calls
        calls += 1
        return {"episode": "one", "content": "validated"}

    first.session.call_tool(
        "draft",
        kind=AgentToolKind.model,
        operation=draft,
        checkpoint_serializer=lambda value: ("roadmap.v1", value),
        checkpoint_loader=lambda value: value,
    )
    first.session.fail(RuntimeError("transient"))

    resumed = service.start_session(
        agent_name="episode_roadmap",
        subject_ref="project.1:episode-1",
        policy=policy,
        request_key="agent-request.persist.1",
        input_fingerprint="1" * 64,
        project_id="project.1",
        episode_number=1,
    )
    assert resumed.session is not None
    replayed = resumed.session.call_tool(
        "draft",
        kind=AgentToolKind.model,
        operation=draft,
        checkpoint_loader=lambda value: value,
    )
    resumed.session.call_tool(
        "inspect",
        kind=AgentToolKind.deterministic,
        operation=lambda: None,
    )
    assert replayed == {"episode": "one", "content": "validated"}
    assert calls == 1
    completed = resumed.session.complete(
        result_type="roadmap.v1",
        result_payload={"item": replayed},
    )
    assert completed.status == AgentRunStatus.completed

    replay = service.start_session(
        agent_name="episode_roadmap",
        subject_ref="project.1:episode-1",
        policy=policy,
        request_key="agent-request.persist.1",
        input_fingerprint="1" * 64,
        project_id="project.1",
        episode_number=1,
    )
    assert replay.session is None
    assert replay.result_payload == {"item": replayed}

    stored = service.get_run(completed.run_id)
    assert stored is not None
    assert stored.attempt_count == 2
    assert stored.result_type == "roadmap.v1"
    assert all(step.error_type != "transient" for step in stored.tool_executions)
    with runtime.session() as session:
        checkpoint_count = session.exec(
            select(func.count())
            .select_from(AgentStepRecordTable)
            .where(AgentStepRecordTable.checkpoint_payload.is_not(None))
        ).one()
    assert checkpoint_count == 1


def test_failed_tool_preserves_validated_in_progress_recovery_checkpoint() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=1,
        allowed_tools=frozenset({"finalize_episode_script"}),
    )
    started = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-9",
        policy=policy,
        request_key="agent-request.editor-progress.episode-9",
        input_fingerprint="9" * 64,
        project_id="project.1",
        episode_number=9,
    )
    assert started.session is not None

    def fail_after_checkpoint() -> None:
        assert started.session is not None
        started.session.save_current_tool_checkpoint(
            tool_name="finalize_episode_script",
            checkpoint_type="episode_script_editor_progress.v1",
            checkpoint_payload={"completed_attempt_count": 1},
        )
        raise RuntimeError("transport failed after a valid editor pass")

    with pytest.raises(RuntimeError, match="valid editor pass"):
        started.session.call_tool(
            "finalize_episode_script",
            kind=AgentToolKind.model,
            operation=fail_after_checkpoint,
        )
    started.session.fail(RuntimeError("transport failed"))

    assert service.load_tool_recovery_checkpoint(
        started.record.run_id,
        "finalize_episode_script",
        "episode_script_editor_progress.v1",
    ) == {"completed_attempt_count": 1}


def test_running_agent_request_reports_in_progress_before_refreshed_input_conflict() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=0,
        allowed_tools=frozenset({"inspect"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-1",
        policy=policy,
        request_key="agent-request.persist.2",
        input_fingerprint="2" * 64,
    )

    with pytest.raises(AgentRunInProgressError):
        service.start_session(
            agent_name="episode_script",
            subject_ref="project.1:episode-1",
            policy=policy,
            request_key="agent-request.persist.2",
            input_fingerprint="3" * 64,
        )
    # Once the original run is no longer active, genuine input replacement is
    # still rejected unless it satisfies a narrow checkpoint refresh policy.
    assert first.session is not None
    first.session.complete(result_type="test_result.v1", result_payload={"ok": True})
    with pytest.raises(AgentRunPersistenceConflictError):
        service.start_session(
            agent_name="episode_script",
            subject_ref="project.1:episode-1",
            policy=policy,
            request_key="agent-request.persist.2",
            input_fingerprint="3" * 64,
        )


def test_failed_empty_episode_run_can_refresh_input_and_resume() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=1,
        allowed_tools=frozenset({"generate_pre_edit_episode_script"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-46",
        policy=policy,
        request_key="agent-request.generation-job.empty.episode-46",
        input_fingerprint="a" * 64,
        project_id="project.1",
        episode_number=46,
    )
    assert first.session is not None
    first.session.fail(RuntimeError("upstream request failed before output"))

    refreshed = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-46",
        policy=policy,
        request_key="agent-request.generation-job.empty.episode-46",
        input_fingerprint="b" * 64,
        project_id="project.1",
        episode_number=46,
    )

    assert refreshed.session is not None
    assert refreshed.record.run_id == first.record.run_id
    assert refreshed.record.attempt_count == 2
    assert refreshed.record.input_fingerprint == "b" * 64


def test_failed_episode_run_with_persistence_cannot_refresh_input() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=0,
        allowed_tools=frozenset({"persist"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-47",
        policy=policy,
        request_key="agent-request.generation-job.persisted.episode-47",
        input_fingerprint="c" * 64,
        project_id="project.1",
        episode_number=47,
    )
    assert first.session is not None
    first.session.call_tool(
        "persist",
        kind=AgentToolKind.persistence,
        operation=lambda: None,
    )
    first.session.fail(RuntimeError("later validation failed"))

    with pytest.raises(AgentRunPersistenceConflictError):
        service.start_session(
            agent_name="episode_script",
            subject_ref="project.1:episode-47",
            policy=policy,
            request_key="agent-request.generation-job.persisted.episode-47",
            input_fingerprint="d" * 64,
            project_id="project.1",
            episode_number=47,
        )


def test_resumed_agent_receives_a_fresh_step_budget() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=2,
        max_model_tool_calls=0,
        allowed_tools=frozenset({"inspect", "persist"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-2",
        policy=policy,
        request_key="agent-request.persist.3",
        input_fingerprint="4" * 64,
    )
    assert first.session is not None
    first.session.call_tool(
        "inspect",
        kind=AgentToolKind.deterministic,
        operation=lambda: None,
    )
    first.session.call_tool(
        "persist",
        kind=AgentToolKind.persistence,
        operation=lambda: None,
    )
    first.session.fail(RuntimeError("retry this bounded attempt"))

    resumed = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-2",
        policy=policy,
        request_key="agent-request.persist.3",
        input_fingerprint="4" * 64,
    )
    assert resumed.session is not None
    resumed.session.call_tool(
        "inspect",
        kind=AgentToolKind.deterministic,
        operation=lambda: None,
    )
    resumed.session.call_tool(
        "persist",
        kind=AgentToolKind.persistence,
        operation=lambda: None,
    )

    assert resumed.session.record.attempt_count == 2
    assert [step.attempt for step in resumed.session.record.tool_executions] == [
        1,
        1,
        2,
        2,
    ]


def test_resumed_agent_uses_current_policy() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    old_policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=1,
        allowed_tools=frozenset({"legacy_draft"}),
    )
    current_policy = AgentRunPolicy(
        max_steps=3,
        max_model_tool_calls=2,
        allowed_tools=frozenset({"draft", "finalize", "inspect"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-3",
        policy=old_policy,
        request_key="agent-request.persist.policy-upgrade",
        input_fingerprint="5" * 64,
    )
    assert first.session is not None
    first.session.fail(RuntimeError("upgrade on retry"))

    resumed = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-3",
        policy=current_policy,
        request_key="agent-request.persist.policy-upgrade",
        input_fingerprint="5" * 64,
    )

    assert resumed.session is not None
    assert resumed.session.record.policy == current_policy


def test_duplicate_running_agent_request_is_not_started_twice() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=0,
        allowed_tools=frozenset({"inspect"}),
    )
    service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-4",
        policy=policy,
        request_key="agent-request.persist.concurrent",
        input_fingerprint="6" * 64,
    )

    with pytest.raises(AgentRunInProgressError):
        service.start_session(
            agent_name="episode_script",
            subject_ref="project.1:episode-4",
            policy=policy,
            request_key="agent-request.persist.concurrent",
            input_fingerprint="6" * 64,
        )


def test_new_runtime_instance_immediately_recovers_the_previous_process_lease() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    first_process = AgentRunService(runtime, instance_id="runtime-before-restart")
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=0,
        allowed_tools=frozenset({"inspect"}),
    )
    started = first_process.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-4",
        policy=policy,
        request_key="agent-request.persist.process-restart",
        input_fingerprint="a" * 64,
        project_id="project.1",
        episode_number=4,
    )
    assert started.session is not None

    restarted_process = AgentRunService(runtime, instance_id="runtime-after-restart")
    recovered = restarted_process.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-4",
        policy=policy,
        request_key="agent-request.persist.process-restart",
        input_fingerprint="a" * 64,
        project_id="project.1",
        episode_number=4,
    )

    assert recovered.session is not None
    assert recovered.record.run_id == started.record.run_id
    assert recovered.record.attempt_count == 2
    assert recovered.record.owner_instance_id == "runtime-after-restart"


def test_different_request_keys_cannot_generate_the_same_episode_concurrently() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=0,
        allowed_tools=frozenset({"inspect"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-5",
        policy=policy,
        request_key="agent-request.persist.episode-lease-a",
        input_fingerprint="7" * 64,
        project_id="project.1",
        episode_number=5,
    )
    assert first.session is not None

    with pytest.raises(AgentRunInProgressError) as caught:
        service.start_session(
            agent_name="episode_script",
            subject_ref="project.1:episode-5",
            policy=policy,
            request_key="agent-request.persist.episode-lease-b",
            input_fingerprint="8" * 64,
            project_id="project.1",
            episode_number=5,
        )

    assert caught.value.run_id == first.record.run_id
    assert caught.value.same_request is False


def test_same_job_revision_key_reuses_a_saved_episode_checkpoint() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=2,
        max_model_tool_calls=1,
        allowed_tools=frozenset({"draft", "finalize"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-16",
        policy=policy,
        request_key="agent-request.generation-job.test.revision-15.episode-16",
        input_fingerprint="b" * 64,
        project_id="project.1",
        episode_number=16,
    )
    assert first.session is not None
    first.session.call_tool(
        "draft",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "pre-edit"},
        checkpoint_serializer=lambda value: ("episode_script_pre_edit_run.v2", value),
        checkpoint_loader=lambda value: value,
    )
    first.session.fail(RuntimeError("GPT finalization failed"))

    resumed = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-16",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-16",
        input_fingerprint="b" * 64,
        project_id="project.1",
        episode_number=16,
    )
    assert resumed.session is not None
    checkpoint = resumed.session.call_tool(
        "draft",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "regenerated"},
        checkpoint_loader=lambda value: value,
    )

    assert resumed.record.run_id == first.record.run_id
    assert resumed.record.attempt_count == 2
    assert checkpoint == {"checkpoint": "pre-edit"}


def test_empty_stable_run_can_reuse_compatible_legacy_checkpoint() -> None:
    from datetime import datetime, timedelta, timezone

    from app.modules.agent_runtime.persistence import AgentRunRecordTable

    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=2,
        max_model_tool_calls=1,
        allowed_tools=frozenset({"draft", "finalize"}),
    )
    legacy = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-16",
        policy=policy,
        request_key="agent-request.generation-job.test.revision-15.episode-16",
        input_fingerprint="c" * 64,
        project_id="project.1",
        episode_number=16,
    )
    assert legacy.session is not None
    legacy.session.call_tool(
        "draft",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "pre-edit"},
        checkpoint_serializer=lambda value: ("episode_script_pre_edit_run.v2", value),
        checkpoint_loader=lambda value: value,
    )
    legacy.session.fail(RuntimeError("GPT finalization failed"))

    stable = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-16",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-16",
        input_fingerprint="c" * 64,
        project_id="project.1",
        episode_number=16,
    )
    assert stable.session is not None
    expired_at = datetime.now(timezone.utc) - timedelta(minutes=40)
    with runtime.session() as session:
        table = session.get(AgentRunRecordTable, stable.record.run_id)
        assert table is not None
        table.updated_at = expired_at
        table.payload = {**table.payload, "updated_at": expired_at.isoformat()}

    resumed = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-16",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-16",
        input_fingerprint="c" * 64,
        project_id="project.1",
        episode_number=16,
    )
    assert resumed.session is not None
    calls = 0

    def regenerate() -> dict[str, str]:
        nonlocal calls
        calls += 1
        return {"checkpoint": "regenerated"}

    checkpoint = resumed.session.call_tool(
        "draft",
        kind=AgentToolKind.model,
        operation=regenerate,
        checkpoint_loader=lambda value: value,
    )

    assert resumed.record.run_id == stable.record.run_id
    assert checkpoint == {"checkpoint": "pre-edit"}
    assert calls == 0


def test_incompatible_checkpoint_version_is_not_replayed() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=1,
        allowed_tools=frozenset({"draft"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-17",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-17",
        input_fingerprint="d" * 64,
        project_id="project.1",
        episode_number=17,
    )
    assert first.session is not None
    first.session.call_tool(
        "draft",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "old"},
        checkpoint_serializer=lambda value: ("episode_script_pre_edit_run.v1", value),
        checkpoint_loader=lambda value: value,
        expected_checkpoint_type="episode_script_pre_edit_run.v1",
    )
    first.session.fail(RuntimeError("upgrade workflow"))

    resumed = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-17",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-17",
        input_fingerprint="d" * 64,
        project_id="project.1",
        episode_number=17,
    )
    assert resumed.session is not None
    regenerated = resumed.session.call_tool(
        "draft",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "new"},
        checkpoint_loader=lambda value: value,
        expected_checkpoint_type="episode_script_pre_edit_run.v2",
    )

    assert regenerated == {"checkpoint": "new"}


def test_post_edit_failure_can_refresh_input_and_reuse_pre_edit_checkpoint() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=2,
        max_model_tool_calls=1,
        allowed_tools={"generate_pre_edit_episode_script", "finalize"},
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-19",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-19",
        input_fingerprint="e" * 64,
        project_id="project.1",
        episode_number=19,
    )
    assert first.session is not None
    first.session.call_tool(
        "generate_pre_edit_episode_script",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "pre-edit"},
        checkpoint_serializer=lambda value: ("episode_script_pre_edit_run.v2", value),
        checkpoint_loader=lambda value: value,
        expected_checkpoint_type="episode_script_pre_edit_run.v2",
    )
    first.session.fail(InvalidScriptPostEditError("finalization failed"))

    refreshed = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-19",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-19",
        input_fingerprint="f" * 64,
        project_id="project.1",
        episode_number=19,
    )
    assert refreshed.session is not None
    recovered = refreshed.session.call_tool(
        "generate_pre_edit_episode_script",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "regenerated"},
        checkpoint_loader=lambda value: value,
        expected_checkpoint_type="episode_script_pre_edit_run.v2",
    )

    assert refreshed.record.attempt_count == 2
    assert refreshed.record.input_fingerprint == "f" * 64
    assert recovered == {"checkpoint": "pre-edit"}


def test_completed_episode_result_replays_after_browser_context_refresh() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=0,
        allowed_tools=frozenset({"inspect"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-20",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-20",
        input_fingerprint="3" * 64,
        project_id="project.1",
        episode_number=20,
    )
    assert first.session is not None
    first.session.complete(
        result_type="episode_script_run.v1",
        result_payload={"draft_run": {"checkpoint": "completed"}},
    )

    replayed = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-20",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-20",
        input_fingerprint="4" * 64,
        project_id="project.1",
        episode_number=20,
    )

    assert replayed.session is None
    assert replayed.record.run_id == first.record.run_id
    assert replayed.result_payload == {
        "draft_run": {"checkpoint": "completed"},
    }


def test_finalize_value_error_can_refresh_input_and_reuse_pre_edit_checkpoint() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=2,
        max_model_tool_calls=2,
        allowed_tools={"generate_pre_edit_episode_script", "finalize_episode_script"},
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-21",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-21",
        input_fingerprint="5" * 64,
        project_id="project.1",
        episode_number=21,
    )
    assert first.session is not None
    first.session.call_tool(
        "generate_pre_edit_episode_script",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "pre-edit"},
        checkpoint_serializer=lambda value: ("episode_script_pre_edit_run.v2", value),
        checkpoint_loader=lambda value: value,
        expected_checkpoint_type="episode_script_pre_edit_run.v2",
    )
    finalization_error = ValueError("fixed deterministic finalization bug")

    def fail_finalization() -> dict[str, str]:
        raise finalization_error

    with pytest.raises(ValueError, match="fixed deterministic"):
        first.session.call_tool(
            "finalize_episode_script",
            kind=AgentToolKind.model,
            operation=fail_finalization,
        )
    first.session.fail(finalization_error)

    refreshed = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-21",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-21",
        input_fingerprint="6" * 64,
        project_id="project.1",
        episode_number=21,
    )
    assert refreshed.session is not None
    recovered = refreshed.session.call_tool(
        "generate_pre_edit_episode_script",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "regenerated"},
        checkpoint_loader=lambda value: value,
        expected_checkpoint_type="episode_script_pre_edit_run.v2",
    )

    assert refreshed.record.attempt_count == 2
    assert refreshed.record.input_fingerprint == "6" * 64
    assert recovered == {"checkpoint": "pre-edit"}


def test_unscoped_value_error_cannot_refresh_saved_pre_edit_input() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=2,
        max_model_tool_calls=1,
        allowed_tools={"generate_pre_edit_episode_script", "finalize_episode_script"},
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-22",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-22",
        input_fingerprint="7" * 64,
        project_id="project.1",
        episode_number=22,
    )
    assert first.session is not None
    first.session.call_tool(
        "generate_pre_edit_episode_script",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "pre-edit"},
        checkpoint_serializer=lambda value: ("episode_script_pre_edit_run.v2", value),
        checkpoint_loader=lambda value: value,
        expected_checkpoint_type="episode_script_pre_edit_run.v2",
    )
    first.session.fail(ValueError("outside finalization"))

    with pytest.raises(
        AgentRunPersistenceConflictError,
        match="reused with different input",
    ):
        service.start_session(
            agent_name="episode_script",
            subject_ref="project.1:episode-22",
            policy=policy,
            request_key="agent-request.generation-job.test.episode-22",
            input_fingerprint="8" * 64,
            project_id="project.1",
            episode_number=22,
        )


def test_post_edit_gateway_failure_can_refresh_input_and_reuse_pre_edit_checkpoint() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=2,
        max_model_tool_calls=1,
        allowed_tools={"generate_pre_edit_episode_script", "finalize"},
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-33",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-33",
        input_fingerprint="1" * 64,
        project_id="project.1",
        episode_number=33,
    )
    assert first.session is not None
    first.session.call_tool(
        "generate_pre_edit_episode_script",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "validated-deepseek-draft"},
        checkpoint_serializer=lambda value: ("episode_script_pre_edit_run.v2", value),
        checkpoint_loader=lambda value: value,
        expected_checkpoint_type="episode_script_pre_edit_run.v2",
    )
    first.session.fail(
        LLMRequestError(
            "GPT gateway timed out",
            status_code=503,
            category="upstream_gateway",
            recoverable=True,
        )
    )

    refreshed = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-33",
        policy=policy,
        request_key="agent-request.generation-job.test.episode-33",
        input_fingerprint="2" * 64,
        project_id="project.1",
        episode_number=33,
    )
    assert refreshed.session is not None
    recovered = refreshed.session.call_tool(
        "generate_pre_edit_episode_script",
        kind=AgentToolKind.model,
        operation=lambda: {"checkpoint": "regenerated"},
        checkpoint_loader=lambda value: value,
        expected_checkpoint_type="episode_script_pre_edit_run.v2",
    )

    assert refreshed.record.attempt_count == 2
    assert refreshed.record.input_fingerprint == "2" * 64
    assert recovered == {"checkpoint": "validated-deepseek-draft"}


def test_completed_episode_run_releases_the_episode_lease() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=0,
        allowed_tools=frozenset({"inspect"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-6",
        policy=policy,
        request_key="agent-request.persist.completed-lease-a",
        input_fingerprint="9" * 64,
        project_id="project.1",
        episode_number=6,
    )
    assert first.session is not None
    first.session.complete(result_type="episode_script_run.v1", result_payload={})

    second = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-6",
        policy=policy,
        request_key="agent-request.persist.completed-lease-b",
        input_fingerprint="a" * 64,
        project_id="project.1",
        episode_number=6,
    )

    assert second.session is not None
    assert second.record.run_id != first.record.run_id


def test_superseded_agent_cannot_publish_a_late_result() -> None:
    from datetime import datetime, timedelta, timezone

    from app.modules.agent_runtime.persistence import AgentRunRecordTable

    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=0,
        allowed_tools=frozenset({"inspect"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-7",
        policy=policy,
        request_key="agent-request.persist.stale-lease-a",
        input_fingerprint="b" * 64,
        project_id="project.1",
        episode_number=7,
    )
    assert first.session is not None

    expired_at = datetime.now(timezone.utc) - timedelta(minutes=40)
    with runtime.session() as session:
        table = session.get(AgentRunRecordTable, first.record.run_id)
        assert table is not None
        table.updated_at = expired_at
        table.payload = {**table.payload, "updated_at": expired_at.isoformat()}

    second = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-7",
        policy=policy,
        request_key="agent-request.persist.stale-lease-b",
        input_fingerprint="c" * 64,
        project_id="project.1",
        episode_number=7,
    )
    assert second.session is not None

    with pytest.raises(AgentRunPersistenceConflictError, match="active lease"):
        first.session.complete(
            result_type="episode_script_run.v1",
            result_payload={"late": True},
        )

    completed = second.session.complete(
        result_type="episode_script_run.v1",
        result_payload={"late": False},
    )
    assert completed.status == AgentRunStatus.completed


def test_old_failed_request_cannot_resume_over_a_new_episode_owner() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    policy = AgentRunPolicy(
        max_steps=1,
        max_model_tool_calls=0,
        allowed_tools=frozenset({"inspect"}),
    )
    first = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-8",
        policy=policy,
        request_key="agent-request.persist.failed-owner-a",
        input_fingerprint="d" * 64,
        project_id="project.1",
        episode_number=8,
    )
    assert first.session is not None
    first.session.fail(RuntimeError("retry later"))

    second = service.start_session(
        agent_name="episode_script",
        subject_ref="project.1:episode-8",
        policy=policy,
        request_key="agent-request.persist.failed-owner-b",
        input_fingerprint="e" * 64,
        project_id="project.1",
        episode_number=8,
    )
    assert second.session is not None

    with pytest.raises(AgentRunInProgressError) as caught:
        service.start_session(
            agent_name="episode_script",
            subject_ref="project.1:episode-8",
            policy=policy,
            request_key="agent-request.persist.failed-owner-a",
            input_fingerprint="d" * 64,
            project_id="project.1",
            episode_number=8,
        )

    assert caught.value.run_id == second.record.run_id
    assert caught.value.same_request is False


@pytest.mark.parametrize("has_checkpoint", [False, True])
def test_restarted_script_worker_refreshes_only_an_empty_abandoned_run(has_checkpoint):
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    policy = AgentRunPolicy(max_steps=2, max_model_tool_calls=1, allowed_tools={"draft"})
    request = dict(agent_name="episode_script", subject_ref="project.1:episode-2",
                   policy=policy, request_key="agent-request.restart.episode-2",
                   project_id="project.1", episode_number=2)
    first = AgentRunService(runtime, instance_id="old-process").start_session(
        **request, input_fingerprint="1" * 64,
    )
    assert first.session is not None
    if has_checkpoint:
        first.session.call_tool(
            "draft", kind=AgentToolKind.model, operation=lambda: {"saved": True},
            checkpoint_serializer=lambda value: ("draft.v1", value),
        )
    restarted = AgentRunService(runtime, instance_id="new-process")
    if has_checkpoint:
        with pytest.raises(AgentRunPersistenceConflictError, match="different input"):
            restarted.start_session(**request, input_fingerprint="2" * 64)
    else:
        recovered = restarted.start_session(**request, input_fingerprint="2" * 64)
        assert recovered.session is not None
        assert recovered.record.run_id == first.record.run_id
        assert recovered.record.input_fingerprint == "2" * 64
        assert recovered.record.attempt_count == 2
