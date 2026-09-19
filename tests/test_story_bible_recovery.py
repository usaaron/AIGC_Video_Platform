"""Checkpoint storage tests use isolated SQLite only, never a model or live DB."""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import event
from sqlmodel import SQLModel, select

from app.database import create_database_runtime
from app.document_repository import ModuleDocumentRecord
from app.modules.script_engine.long_story_models import (
    StoryBible, StoryBibleDraftRequest, StoryBibleGenerationOutput, StoryProject,
    StoryProjectWorkspaceSave,
)
from app.modules.script_engine.long_story_persistence import (
    StoryBibleVersionRecord, StoryProjectRecord, StoryProjectWorkspaceSnapshotRecord,
)
from app.modules.script_engine.long_story_repository import LongStoryRepository
from app.modules.script_engine.long_story_service import LongStoryNotFoundError, LongStoryService
from app.modules.script_engine.story_bible_contracts import story_bible_non_chinese_fields
from app.modules.script_engine.story_bible_recovery import (
    RECOVERY_NAMESPACE,
    StoryBibleRecoveryConflictError,
    StoryBibleRecoveryKey,
    story_bible_request_fingerprint,
)


def request(**updates):
    return StoryBibleDraftRequest.model_validate({
        "story_project_id": "project.recovery",
        "content_spec_id": "spec.recovery",
        "generation_strategy_id": "strategy.recovery",
        "creative_prompt": "主角追查旧案，保留作者确认的故事事实。",
        "confirmed_synopsis": "主角找到证据，面对阻力，坚持公开真相。",
        **updates,
    })


def candidate():
    # Synthetic failure, never a reconstruction of the unsaved R155 text.
    return StoryBibleGenerationOutput(
        project_title="旧案真相",
        core_premise="The witness must preserve the original evidence.",
        series_goal="主角守住证据并最终公开旧案的完整真相。",
        theme="真相与代价",
        central_conflict="主角坚持公开真相，对手阻止证人出面作证。",
        ending_direction="主角公开完整证据并承担选择带来的代价。",
        character_refs=["character.witness"],
        character_registry=[{"character_ref": "character.witness", "name": "林知", "role": "证人"}],
        story_lines=[{
            "story_line_id": "line.evidence", "title": "守住证据", "story_line_type": "main",
            "premise": "证人确认旧案证据的来源。", "planned_resolution": "完整证据获得公开核验。",
            "character_refs": ["character.witness"],
        }],
    )


def bible(output=None, **updates):
    return StoryBible.model_validate({
        **(output or candidate()).model_dump(mode="json"),
        "story_bible_id": "bible.recovery",
        "story_project_id": "project.recovery",
        "content_spec_id": "spec.recovery",
        **updates,
    })


def key(payload=None, **updates):
    payload = payload or request()
    return StoryBibleRecoveryKey(
        story_project_id=payload.story_project_id,
        request_fingerprint=story_bible_request_fingerprint(payload),
        **updates,
    )


@pytest.fixture
def storage(tmp_path):
    url = f"sqlite:///{tmp_path / 'story-bible-recovery.db'}"
    runtime = create_database_runtime(url)
    SQLModel.metadata.create_all(runtime.engine)
    service = LongStoryService(runtime)
    service.save_project(StoryProject(
        project_id="project.recovery", title="候选恢复测试", content_spec_id="spec.recovery",
        planned_episode_count=72,
    ))
    yield runtime, service, url
    runtime.engine.dispose()


def domain_state(runtime):
    with runtime.session() as session:
        return {
            model.__tablename__: [row.model_dump(mode="json") for row in session.exec(select(model)).all()]
            for model in (StoryProjectRecord, StoryBibleVersionRecord, StoryProjectWorkspaceSnapshotRecord)
        }


def persist_bible(runtime, output):
    with runtime.session() as session:
        return LongStoryRepository(session).save_story_bible(output)


def activate(service, output):
    project = service.get_project(output.story_project_id)
    service.save_project(project.model_copy(update={
        "revision": project.revision + 1,
        "active_story_bible_id": output.story_bible_id,
        "active_story_bible_version": output.version,
    }))


def test_pending_survives_new_runtime_without_becoming_a_saved_bible(storage):
    runtime, service, url = storage
    before = domain_state(runtime)
    repo = service.story_bible_recovery_repository()
    saved = repo.save_pending(key(), candidate(), stage="initial", unresolved_fields=["core_premise"])
    assert story_bible_non_chinese_fields(saved.candidate) == ["core_premise"]
    runtime.engine.dispose()
    restarted = create_database_runtime(url)
    try:
        restored_service = LongStoryService(restarted)
        restored = restored_service.story_bible_recovery_repository().get_pending(key())
        assert restored == saved
        assert isinstance(restored.candidate, StoryBibleGenerationOutput)
        with pytest.raises(LongStoryNotFoundError):
            restored_service.get_story_bible("project.recovery", "bible.recovery")
        assert domain_state(restarted) == before
        # Returned objects are detached: caller mutations cannot change the DB.
        restored.candidate.world_rules.append("只修改内存，不修改候选。")
        assert repo.get_pending(key()).candidate.world_rules == []
    finally:
        restarted.engine.dispose()


@pytest.mark.parametrize("updates", [
    {"confirmed_synopsis": "作者改变了当前确认梗概的因果与结局。"},
    {"synopsis_review_notes": ["必须保留证人身份。"]},
    {"author_instruction": "只整理原文，不添加情节。"},
    {"preserve_source_document": True},
    {"generation_strategy_id": "strategy.new"},
    {"target_episode_count": 60},
    {"content_spec_id": "spec.new"},
    {"reference_materials": [{"file_name": "资料.txt", "purpose": "story_reference", "extracted_text": "作者原始故事资料。"}]},
])
def test_changed_input_never_reuses_previous_candidate(storage, updates):
    _, service, _ = storage
    repo = service.story_bible_recovery_repository()
    original = repo.save_pending(key(), candidate(), stage="initial")
    changed_key = key(request(**updates))
    assert changed_key.request_fingerprint != original.key.request_fingerprint
    assert repo.get_pending(changed_key) is None
    assert repo.get_pending(key()) == original


def test_fingerprint_includes_resolved_context_without_storing_it(storage):
    runtime, service, _ = storage
    context = {"prompt": "完整提示词：保留原文", "strategy": {"temperature": 0.2, "max_tokens": 9000}}
    first = story_bible_request_fingerprint(request(), generation_context=context)
    reordered = {"strategy": {"max_tokens": 9000, "temperature": 0.2}, "prompt": context["prompt"]}
    assert first == story_bible_request_fingerprint(request(), generation_context=reordered)
    assert first != story_bible_request_fingerprint(request(), generation_context={**context, "prompt": "新提示词"})
    service.story_bible_recovery_repository().save_pending(
        StoryBibleRecoveryKey(story_project_id="project.recovery", request_fingerprint=first),
        candidate(), stage="initial",
    )
    with runtime.session() as session:
        rows = session.exec(select(ModuleDocumentRecord)).all()
        assert len(rows) == 2  # head and one history revision; no prompt/raw response.
        assert all("完整提示词" not in str(row.payload) for row in rows)


def test_changed_project_or_active_base_cannot_resume_or_write(storage):
    runtime, service, _ = storage
    repo = service.story_bible_recovery_repository()
    initial = repo.save_pending(key(), candidate(), stage="initial")
    active = persist_bible(runtime, bible(status="approved", approved_at=datetime.now(timezone.utc)))
    activate(service, active)
    assert repo.get_pending(key()) is None
    assert LongStoryService(runtime).story_bible_recovery_repository().get_pending(key()) is None
    with pytest.raises(StoryBibleRecoveryConflictError, match="base has changed"):
        repo.save_pending(key(), candidate(), stage="language_patch", previous=initial)
    active_key = key(base_story_bible_id=active.story_bible_id, base_story_bible_version=1)
    active_checkpoint = repo.save_pending(active_key, candidate(), stage="initial")
    other_id = key(base_story_bible_id="bible.other", base_story_bible_version=1)
    assert repo.get_pending(other_id) is None
    assert repo.get_pending(key(request(story_project_id="project.other"))) is None
    next_base = persist_bible(runtime, bible(version=2, status="approved", approved_at=datetime.now(timezone.utc)))
    activate(service, next_base)
    assert repo.get_pending(active_key) is None
    assert repo.list_history(active_key) == [active_checkpoint]
    assert repo.list_history(key()) == [initial]


def test_patch_progress_retains_history_and_rejects_stale_updates(storage):
    runtime, service, _ = storage
    before = domain_state(runtime)
    first_repo = service.story_bible_recovery_repository()
    other_repo = LongStoryService(runtime).story_bible_recovery_repository()
    initial = first_repo.save_pending(key(), candidate(), stage="initial", unresolved_fields=["core_premise"])
    repaired = candidate().model_copy(update={"core_premise": "证人保留原始证据并坚持公开完整真相。"})
    patched = other_repo.save_pending(key(), repaired, stage="language_patch", previous=initial)
    assert patched.attempt == initial.attempt == 1
    assert patched.revision == 2
    with pytest.raises(StoryBibleRecoveryConflictError, match="superseded"):
        first_repo.save_pending(key(), candidate(), stage="old_patch", previous=initial)
    with pytest.raises(StoryBibleRecoveryConflictError, match="Resume"):
        first_repo.save_pending(key(), candidate(), stage="initial")
    assert first_repo.list_history(key()) == [initial, patched]
    assert first_repo.get_pending(key()) == patched
    assert domain_state(runtime) == before
    # Identical retry does not duplicate full candidate snapshots.
    assert first_repo.save_pending(key(), repaired, stage="language_patch", previous=patched) == patched
    assert len(first_repo.list_history(key())) == 2


def test_invalid_schema_and_cross_input_update_preserve_previous(storage):
    _, service, _ = storage
    repo = service.story_bible_recovery_repository()
    initial = repo.save_pending(key(), candidate(), stage="initial")
    invalid = candidate().model_copy(update={"character_refs": ["character.foreign"]})
    with pytest.raises(ValidationError):
        repo.save_pending(key(), invalid, stage="patch", previous=initial)
    with pytest.raises(StoryBibleRecoveryConflictError):
        repo.save_pending(key(request(author_instruction="改变要求")), candidate(), stage="patch", previous=initial)
    assert repo.get_pending(key()) == initial
    assert repo.list_history(key()) == [initial]


def test_saved_marker_requires_persisted_draft_and_never_approves(storage):
    runtime, service, _ = storage
    repo = service.story_bible_recovery_repository()
    initial = repo.save_pending(key(), candidate(), stage="initial", unresolved_fields=["core_premise"])
    formal = bible(candidate().model_copy(update={"core_premise": "证人保留原始证据并坚持公开完整真相。"}))
    with pytest.raises(StoryBibleRecoveryConflictError, match="persisted"):
        repo.mark_saved(initial, saved_story_bible=formal)
    persist_bible(runtime, formal)
    before = domain_state(runtime)
    saved = repo.mark_saved(initial, saved_story_bible=formal)
    assert saved.status == "saved" and saved.saved_story_bible_version == 1
    assert saved.candidate.core_premise == formal.core_premise
    assert saved.unresolved_fields == []
    assert repo.get_pending(key()) is None
    assert repo.mark_saved(initial, saved_story_bible=formal) == saved
    assert repo.mark_saved(saved, saved_story_bible=formal) == saved
    assert domain_state(runtime) == before
    assert service.get_project("project.recovery").active_story_bible_id is None
    assert service.get_story_bible("project.recovery", "bible.recovery").status.value == "draft"
    # Explicit new attempt preserves the prior input's completed history.
    next_attempt = repo.save_pending(key(), candidate(), stage="initial")
    assert next_attempt.attempt == 2 and next_attempt.revision == 3
    assert [item.status for item in repo.list_history(key())] == ["pending", "saved", "pending"]
    with pytest.raises(StoryBibleRecoveryConflictError):
        repo.mark_saved(initial, saved_story_bible=formal)


@pytest.mark.parametrize("kind", ["different_content", "foreign_project", "approved"])
def test_saved_marker_rejects_foreign_or_unapproved_receipt(storage, kind):
    runtime, service, _ = storage
    repo = service.story_bible_recovery_repository()
    initial = repo.save_pending(key(), candidate(), stage="initial")
    formal = bible()
    if kind == "foreign_project":
        service.save_project(StoryProject(project_id="project.other", title="其他项目", planned_episode_count=72))
        formal = bible(story_project_id="project.other")
    elif kind == "approved":
        formal = bible(status="approved", approved_at=datetime.now(timezone.utc))
    persist_bible(runtime, formal)
    if kind == "different_content":
        formal = formal.model_copy(update={"theme": "未经保存的主题"})
    before = domain_state(runtime)
    with pytest.raises(StoryBibleRecoveryConflictError):
        repo.mark_saved(initial, saved_story_bible=formal)
    assert repo.get_pending(key()) == initial
    assert domain_state(runtime) == before


def test_head_and_history_roll_back_together_on_storage_failure(storage):
    runtime, service, _ = storage
    repo = service.story_bible_recovery_repository()
    initial = repo.save_pending(key(), candidate(), stage="initial")

    def fail_history(_connection, _cursor, statement, parameters, _context, _executemany):
        if statement.startswith("INSERT INTO module_documents") and any(
            isinstance(item, str) and item.endswith(".r2") for item in parameters
        ):
            raise RuntimeError("injected history write failure")

    event.listen(runtime.engine, "before_cursor_execute", fail_history)
    try:
        with pytest.raises(RuntimeError, match="injected"):
            repo.save_pending(key(), candidate(), stage="patch", previous=initial)
    finally:
        event.remove(runtime.engine, "before_cursor_execute", fail_history)
    assert repo.get_pending(key()) == initial
    assert repo.list_history(key()) == [initial]


def test_base_key_requires_complete_version_pair():
    with pytest.raises(ValidationError, match="together"):
        key(base_story_bible_id="bible.recovery")
    with pytest.raises(ValidationError, match="together"):
        key(base_story_bible_version=1)


def accepted_candidate():
    return candidate().model_copy(update={"core_premise": "证人保留原始证据并坚持公开完整真相。"})


def test_atomic_first_draft_completes_checkpoint_and_rejects_duplicate(storage):
    runtime, service, url = storage
    repo = service.story_bible_recovery_repository()
    checkpoint = repo.save_pending(key(), accepted_candidate(), stage="validated_candidate")
    saved = service.save_generated_story_bible_draft(
        bible(accepted_candidate()), recovery_checkpoint=checkpoint,
    )
    assert saved.version == 1 and saved.status.value == "draft"
    assert service.get_project("project.recovery").active_story_bible_id is None
    assert repo.get_pending(key()) is None
    assert [item.status for item in repo.list_history(key())] == ["pending", "saved"]
    before = domain_state(runtime)
    restarted = create_database_runtime(url)
    try:
        with pytest.raises(StoryBibleRecoveryConflictError, match="superseded"):
            LongStoryService(restarted).save_generated_story_bible_draft(
                bible(accepted_candidate()), recovery_checkpoint=checkpoint,
            )
    finally:
        restarted.engine.dispose()
    assert domain_state(runtime) == before


@pytest.mark.parametrize("existing", [False, True])
def test_completion_failure_rolls_back_formal_draft_and_workspace(storage, existing):
    runtime, service, _ = storage
    recovery_key = key()
    if existing:
        active = persist_bible(runtime, bible(
            accepted_candidate(), status="approved", approved_at=datetime.now(timezone.utc),
        ))
        activate(service, active)
        recovery_key = key(base_story_bible_id=active.story_bible_id, base_story_bible_version=1)
    service.save_workspace_snapshot(StoryProjectWorkspaceSave(
        project_id="project.recovery", client_instance_id="client.recovery", revision=1,
        workspace_payload={"id": "project.recovery", "episodes": [], "storyLines": [{"id": "keep.original"}]},
    ))
    repo = service.story_bible_recovery_repository()
    checkpoint = repo.save_pending(recovery_key, accepted_candidate(), stage="validated_candidate")
    before = domain_state(runtime)

    def fail_completion(_connection, _cursor, statement, parameters, _context, _executemany):
        if statement.startswith("INSERT INTO module_documents") and any(
            isinstance(item, str) and item.endswith(".r2") for item in parameters
        ):
            raise RuntimeError("completion history unavailable")

    event.listen(runtime.engine, "before_cursor_execute", fail_completion)
    try:
        with pytest.raises(RuntimeError, match="completion history unavailable"):
            service.save_generated_story_bible_draft(
                bible(accepted_candidate()), recovery_checkpoint=checkpoint,
            )
    finally:
        event.remove(runtime.engine, "before_cursor_execute", fail_completion)
    assert domain_state(runtime) == before
    assert repo.get_pending(recovery_key) == checkpoint
    assert repo.list_history(recovery_key) == [checkpoint]
    saved = service.save_generated_story_bible_draft(
        bible(accepted_candidate()), recovery_checkpoint=checkpoint,
    )
    assert saved.version == (2 if existing else 1)
    assert repo.list_history(recovery_key)[-1].status == "saved"


@pytest.mark.parametrize("changed", ["checkpoint", "base", "project"])
def test_atomic_save_checks_current_checkpoint_and_base_before_writes(storage, changed):
    runtime, service, _ = storage
    repo = service.story_bible_recovery_repository()
    checkpoint = repo.save_pending(key(), accepted_candidate(), stage="validated_candidate")
    formal = bible(accepted_candidate())
    if changed == "checkpoint":
        repo.save_pending(key(), accepted_candidate(), stage="newer_stage", previous=checkpoint)
    elif changed == "base":
        active = persist_bible(runtime, bible(
            accepted_candidate(), status="approved", approved_at=datetime.now(timezone.utc),
        ))
        activate(service, active)
    else:
        service.save_project(StoryProject(
            project_id="project.other", title="其他项目", content_spec_id="spec.recovery", planned_episode_count=72,
        ))
        formal = bible(accepted_candidate(), story_project_id="project.other")
    before = domain_state(runtime)
    history = repo.list_history(key())
    writes = []

    def record_writes(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")):
            writes.append(statement)

    event.listen(runtime.engine, "before_cursor_execute", record_writes)
    try:
        with pytest.raises(StoryBibleRecoveryConflictError):
            service.save_generated_story_bible_draft(formal, recovery_checkpoint=checkpoint)
    finally:
        event.remove(runtime.engine, "before_cursor_execute", record_writes)
    # Existing SQLite project locking uses a no-op UPDATE before validation.
    # No domain mutation or checkpoint write may occur for a stale caller.
    assert all(statement.startswith(
        "UPDATE story_projects SET revision=story_projects.revision WHERE",
    ) for statement in writes)
    assert domain_state(runtime) == before
    assert repo.list_history(key()) == history
