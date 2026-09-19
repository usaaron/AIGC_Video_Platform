"""Durable, future-only planning revisions; callers hold the project row lock."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime, timezone

from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.produced_plan_amendment import pending_episode_numbers
from app.modules.script_engine.planning_review_cache import CURRENT_REVIEW_CONTRACT_VERSION, quality_episode_projection, quality_node_signature
from app.modules.script_engine.future_revision_review import scope_matches_workspace


def revision_epoch(workspace: Mapping[str, object]) -> int:
    value = workspace.get("planningRevisionEpoch", 0)
    if type(value) is not int or value < 0:
        raise LongStoryPersistenceConflictError("Invalid planning revision epoch.")
    return value


def active_revision(workspace: Mapping[str, object]) -> dict | None:
    marker = workspace.get("planningRevision")
    return marker if isinstance(marker, dict) and marker.get("status") == "active" else None


def require_request_epoch(workspace: Mapping[str, object], requested: int, *, body: bool = False,
                          episode_number: int | None = None) -> None:
    if requested != revision_epoch(workspace):
        raise LongStoryPersistenceConflictError("Planning revision epoch changed; reload before continuing.")
    pending = pending_episode_numbers(workspace)
    if body and pending and (episode_number is None or episode_number >= pending[0]):
        raise LongStoryPersistenceConflictError("Produced planning changed; resolve affected screenplays before generating or recovering later episodes.")
    active = active_revision(workspace)
    if active and body:
        raise LongStoryPersistenceConflictError("Planning revision is active; screenplay generation and recovery are blocked.")
    if active and episode_number is not None and episode_number < active["startEpisode"]:
        raise LongStoryPersistenceConflictError("Planning revision cannot change episodes before its frozen boundary.")


def _fail(message: str) -> None:
    raise LongStoryPersistenceConflictError(f"Planning revision: {message}")


def _timestamp(value: object) -> datetime:
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError("Timezone required")
        return result
    except (ValueError, TypeError):
        _fail("a valid timezone-aware timestamp is required.")


def _roadmaps(workspace: Mapping[str, object]) -> dict[int, dict]:
    rows = workspace.get("episodeRoadmaps", [])
    if not isinstance(rows, list) or any(not isinstance(row, dict) or type(row.get("episode_number")) is not int for row in rows):
        _fail("roadmaps must retain their episode identities.")
    result = {row["episode_number"]: row for row in rows}
    if len(result) != len(rows):
        _fail("duplicate roadmap episode identities are not allowed.")
    return result


def validate_workspace_transition(previous: Mapping[str, object], candidate: Mapping[str, object], *,
                                  source_revision: int, planned_episode_count: int,
                                  saved_through_episode: int, has_running_work: bool, produced_plan_transition: str | None = None) -> str | None:
    """Return start/complete only after validating immutable source and boundaries."""
    old_epoch, new_epoch = revision_epoch(previous), revision_epoch(candidate)
    old, new = previous.get("planningRevision"), candidate.get("planningRevision")
    history, next_history = previous.get("planningRevisionHistory", []), candidate.get("planningRevisionHistory", [])
    if not old and not new and not old_epoch and not new_epoch and history == next_history == []:
        return None
    if produced_plan_transition == "amend":
        if new_epoch != old_epoch + 1 or old != new or history != next_history:
            _fail("execution amendments must retain the separate future revision and history.")
        return "amend"
    if not isinstance(new, dict) or not isinstance(next_history, list):
        _fail("the current revision and its history cannot be removed.")
    starting = new_epoch == old_epoch + 1
    completing = isinstance(old, dict) and old.get("status") == "active" and new.get("status") == "completed"
    if starting:
        if active_revision(previous):
            _fail("finish the current revision before starting another.")
        if has_running_work:
            _fail("running generation or review work must finish before reopening planning.")
        session = previous.get("planningSession") or {}
        if not isinstance(session, dict) or session.get("phase") != "script" or session.get("status") != "approved":
            _fail("only confirmed planning in the script phase can be reopened.")
        expected_history = history + ([old] if isinstance(old, dict) else [])
        if next_history != expected_history:
            _fail("revision history must preserve the prior completed record exactly once.")
        if new.get("status") != "active" or not isinstance(new.get("revisionId"), str) or not new["revisionId"]:
            _fail("a new active revision must identify the next epoch.")
        if new.get("revisionId") in [item.get("revisionId") for item in expected_history if isinstance(item, dict)]:
            _fail("revision identities cannot be reused.")
        if new.get("sourceWorkspaceRevision") != source_revision:
            _fail("source workspace revision is stale; reload before reopening.")
        boundary = new.get("startEpisode")
        if type(boundary) is not int or not saved_through_episode < boundary <= planned_episode_count:
            _fail("start episode must be after all saved screenplays and inside the project.")
        _timestamp(new.get("startedAt"))
        if "completedAt" in new:
            _fail("an active revision cannot already be completed.")
        expected_tail = [row for row in previous.get("episodeRoadmaps", []) if row["episode_number"] >= boundary]
        if new.get("originalRoadmaps") != expected_tail:
            _fail("original future roadmaps must match the saved source exactly.")
        for snapshot, field in (("originalAudit", "storyTreeQualityAudit"), ("originalPlanningSession", "planningSession")):
            if new.get(snapshot) != previous.get(field):
                _fail("original audit and planning session must match the saved source exactly.")
        expected_jobs = [previous["activeGenerationTask"]["jobId"]] if previous.get("activeGenerationTask") else []
        if new.get("invalidatedJobIds", []) != expected_jobs or candidate.get("activeGenerationTask") is not None:
            _fail("reopening must invalidate and retain the identity of the previous generation task.")
        if candidate.get("storyTreeQualityAudit") is not None:
            _fail("a reopened revision requires a new full audit.")
    else:
        if new_epoch != old_epoch or next_history != history or not isinstance(old, dict):
            _fail("epoch and historical snapshots cannot be altered by an ordinary save.")
        mutable = {"status", "completedAt"} if completing else set()
        if {k: v for k, v in old.items() if k not in mutable} != {k: v for k, v in new.items() if k not in mutable}:
            _fail("the original revision record is immutable.")
        if not completing and old != new:
            _fail("invalid revision status transition.")
        boundary = new.get("startEpisode")
        if completing:
            if has_running_work:
                _fail("running planning work must finish before completing the revision.")
            if _timestamp(new.get("completedAt")) < _timestamp(new.get("startedAt")):
                _fail("completion cannot predate the revision.")
    # A completed record protects its historical metadata, not unrelated future
    # authoring workflows. A new planning revision has its own explicit opening.
    if not starting and not completing and not active_revision(previous):
        return None
    if candidate.get("episodes", []) != previous.get("episodes", []):
        # Once closed, normal screenplay saves can resume with the current epoch.
        if starting or completing or active_revision(previous):
            _fail("existing screenplays must be preserved and new screenplay saves are blocked while planning is open.")
    before, after = _roadmaps(previous), _roadmaps(candidate)
    if set(before) != set(after):
        _fail("reopening planning cannot delete or replace the future roadmap range.")
    for number, row in after.items():
        if number < boundary and row != before[number]:
            source = next((e.get("sourceAmendment") for e in previous.get("episodes", []) if e.get("episodeNumber") == number), None)
            status_only_approval = (isinstance(source, dict) and source.get("status") == "revision_required"
                                    and before[number].get("status") == "draft" and row == {**before[number], "status": "approved"})
            if not status_only_approval:
                _fail("roadmaps before the revision boundary are frozen.")
        if starting and number >= boundary and row != {**before[number], "status": "draft"}:
            _fail("opening must preserve each future roadmap as an unapproved draft.")
        if row.get("status") == "approved" and row.get("source_revision_review"):
            _fail("a changed source node must be explicitly reviewed before approving its roadmap.")
    editable = {"planningRevisionEpoch", "planningRevision", "planningRevisionHistory", "episodeRoadmaps",
                "episodePlansReadyThrough", "storyTreeQualityAudit", "activeGenerationTask", "deliveryConfirmation",
                "updatedAt", "serverSync", "deliveryContentRevision", "activeEpisodeNumber"}
    for field in set(previous) | set(candidate):
        if field not in editable and candidate.get(field) != previous.get(field):
            _fail(f"only future planning may change during this revision ({field}).")
    if candidate.get("activeGenerationTask") is not None:
        _fail("generation tasks cannot be restored while the revision is active.")
    session = candidate.get("planningSession") or {}
    if new.get("status") == "active" and (not isinstance(session, dict) or session.get("phase") != "script" or session.get("status") != "approved"):
        _fail("the confirmed planning session is preserved while the separate revision is active.")
    if completing:
        if session.get("phase") != "script" or session.get("status") != "approved":
            _fail("completed revisions must return to approved script planning.")
        require_fresh_complete_audit(candidate, planned_episode_count=planned_episode_count)
    return "start" if starting else "complete" if completing else None


def require_fresh_complete_audit(workspace: Mapping[str, object], *, planned_episode_count: int) -> None:
    audit, revision = workspace.get("storyTreeQualityAudit"), workspace.get("planningRevision")
    plans = _roadmaps(workspace)
    if set(plans) != set(range(1, planned_episode_count + 1)) or any(row.get("status") != "approved" or row.get("source_revision_review") for row in plans.values()):
        _fail("all episodes must retain current, individually approved roadmaps.")
    if not isinstance(audit, dict) or not isinstance(revision, dict) or audit.get("review_contract_version") != CURRENT_REVIEW_CONTRACT_VERSION:
        _fail("a fresh full current-contract audit is required.")
    scope = audit.get("future_revision_review")
    if not scope_matches_workspace(scope, workspace) or scope.get("status") != "pass" or scope.get("boundary_status") != "pass":
        _fail("a fresh server-bound future-range and saved-boundary review PASS is required.")
    if any(item.get("end_episode", 2_001) >= revision["startEpisode"] for item in audit.get("findings", [])):
        _fail("unresolved future-range findings still block completion.")
    if _timestamp(audit.get("created_at")) < _timestamp(revision["startedAt"]):
        _fail("the audit predates this planning revision.")
    if audit.get("story_bible_version") != workspace.get("storyBibleVersion"):
        _fail("the audit Story Bible is stale.")
    refs = {(item.get("source_node_id"), item.get("source_node_version")) for item in plans.values()}
    raw_refs = audit.get("node_refs")
    if not isinstance(raw_refs, list) or any(not isinstance(item, dict) for item in raw_refs):
        _fail("full audit node evidence is missing.")
    audit_refs = {(item.get("node_id"), item.get("node_version")) for item in raw_refs}
    if audit_refs != refs or len(raw_refs) != len(refs) or audit.get("audited_node_count") != len(refs) or audit.get("semantic_sample_count") != len(refs) or audit.get("node_signature") != quality_node_signature(refs):
        _fail("the audit must cover the complete current node frontier.")
    try:
        reviewed = json.loads(audit.get("reviewed_episode_plans") or "null")
        actual = [quality_episode_projection(plans[number]).model_dump(mode="json") for number in sorted(plans)]
    except (TypeError, ValueError, KeyError):
        _fail("full reviewed episode evidence is invalid.")
    if reviewed != actual:
        _fail("the approved roadmaps differ from the audit's exact episode evidence.")
