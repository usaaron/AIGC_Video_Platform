"""Server evidence for rebuilding only unproduced, source-stale future roadmaps."""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any

from app.modules.script_engine.long_story_models import EpisodePlanGenerationItem
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.planning_revision import active_revision, require_request_epoch, revision_epoch

BUDGET_FIELDS = ("target_duration_seconds", "planned_scene_count", "planned_shot_count", "planned_dialogue_line_count")
SOURCE_FIELDS = ("entry_state", "exit_state", "source_turning_points", "source_unit_story_beats")
RECEIPT_CONTEXT_FIELDS = ("planning_revision_epoch", "revision_id", "source_node_id", "source_node_version", "episode_number", "ending_mode", "evidence_signature", "source_evidence", "budget")


def _fail(message: str) -> None:
    raise LongStoryPersistenceConflictError("Future roadmap rebuild: " + message)


def _json(value: Any) -> Any:
    return value.model_dump(mode="json") if hasattr(value, "model_dump") else value


def signature(value: Any) -> str:
    return hashlib.sha256(json.dumps(_json(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def plan_projection(value: Any) -> dict:
    raw = _json(value)
    return EpisodePlanGenerationItem.model_validate({key: val for key, val in raw.items() if key in EpisodePlanGenerationItem.model_fields}).model_dump(mode="json")


def extract_budget(row: dict) -> dict:
    result = {key: row.get(key) for key in BUDGET_FIELDS}
    if any(type(value) is not int or value < (0 if key == "planned_dialogue_line_count" else 1) for key, value in result.items()):
        _fail("saved production budgets must be explicit integers; no defaults are inferred.")
    scenes = row.get("scene_execution_plan")
    if not isinstance(scenes, list) or len(scenes) != result["planned_scene_count"]:
        _fail("saved scene budgets must cover the original scene count.")
    result["scenes"] = [{key: scene.get(key) for key in ("scene_number", "dialogue_line_target", "shot_target")} for scene in scenes if isinstance(scene, dict)]
    if (len(result["scenes"]) != len(scenes)
            or [s["scene_number"] for s in result["scenes"]] != list(range(1, len(scenes) + 1))
            or any(type(s[k]) is not int or s[k] < (0 if k == "dialogue_line_target" else 1) for s in result["scenes"] for k in s)):
        _fail("saved scene targets must be explicit consecutive integer budgets.")
    if (sum(s["dialogue_line_target"] for s in result["scenes"]) != result["planned_dialogue_line_count"]
            or sum(s["shot_target"] for s in result["scenes"]) != result["planned_shot_count"]):
        _fail("saved scene targets must sum to the saved episode budgets.")
    return result


def verify_rebuild_budget(item: Any, context: dict) -> None:
    """Validate raw output before normalizers, and compiled output after repair."""
    raw, budget = _json(item), context["budget"]
    if not isinstance(raw, dict):
        _fail("rebuild output must contain one episode object.")
    if raw.get("ending_mode", "serial_hook") != context.get("ending_mode", "serial_hook"):
        _fail("rebuild changed the saved ending mode.")
    for field in BUDGET_FIELDS:
        if field == "planned_scene_count" and field not in raw:
            continue  # Existing transport derives only this field from the scene array.
        if type(raw.get(field)) is not int or raw[field] != budget[field]:
            _fail(f"rebuild changed the saved {field}.")
    scenes = raw.get("scene_execution_plan")
    if not isinstance(scenes, list) or len(scenes) != budget["planned_scene_count"]:
        _fail("rebuild changed the saved scene count.")
    for scene, expected in zip(scenes, budget["scenes"]):
        if not isinstance(scene, dict) or any(type(scene.get(key)) is not int or scene[key] != value for key, value in expected.items()):
            _fail("rebuild changed a saved scene number, dialogue target (including zero), or shot target.")


def _rows(workspace: dict) -> dict[int, dict]:
    rows = workspace.get("episodeRoadmaps", [])
    result = {row["episode_number"]: row for row in rows if isinstance(row, dict) and type(row.get("episode_number")) is int}
    if len(result) != len(rows):
        _fail("saved roadmap identities are invalid or duplicated.")
    return result


def _require_active_node(repository: Any, project: Any, node: Any) -> None:
    seen = set()
    current = node
    while current is not None:
        identity = (current.node_id, current.version)
        if identity in seen:
            _fail("source lineage contains a cycle.")
        seen.add(identity)
        latest = repository.get_story_plan_node(current.node_id)
        if (latest is None or latest.version != current.version or latest.story_project_id != project.project_id
                or str(latest.status.value) == "superseded"):
            _fail("source node or ancestor is no longer the current active version.")
        if current.parent_node_id is None:
            if (project.active_story_bible_id != current.story_bible_id
                    or project.active_story_bible_version != current.story_bible_version):
                _fail("source Story Bible is no longer active.")
            break
        parent = repository.get_story_plan_node(current.parent_node_id, version=current.parent_node_version)
        if parent is None or (parent.story_bible_id, parent.story_bible_version) != (node.story_bible_id, node.story_bible_version):
            _fail("source lineage is orphaned.")
        current = parent
    if node.status.value != "approved" or node.expansion_status != "episode_ready":
        _fail("source must be a current approved episode-ready leaf.")


def _evidence(workspace: dict, node: Any, number: int, row: dict) -> dict:
    revision = active_revision(workspace)
    if not revision:
        _fail("an active future planning revision is required.")
    rows = _rows(workspace)
    event = next((event for event in node.episode_developments if event.episode_number == number), None)
    if event is None:
        _fail("the approved source has no event for this episode.")
    source = {key: deepcopy(getattr(event, key)) for key in SOURCE_FIELDS}
    budget = extract_budget(row)
    prefix = [plan_projection(rows[n]) for n in range(node.planned_start_episode, number) if n in rows]
    if len(prefix) != number - node.planned_start_episode:
        _fail("the current source leaf has a missing predecessor roadmap.")
    predecessor = plan_projection(rows[node.planned_start_episode - 1]) if node.planned_start_episode > 1 and node.planned_start_episode - 1 in rows else None
    if node.planned_start_episode > 1 and predecessor is None:
        _fail("the source leaf predecessor must be saved before rebuilding.")
    marker = row.get("source_revision_review") or {}
    evidence = {"contract": "future_roadmap_rebuild.v1", "project_id": workspace.get("id"),
        "planning_revision_epoch": revision_epoch(workspace), "revision_id": revision["revisionId"],
        "source_node": node.model_dump(mode="json"), "episode_number": number, "budget": budget,
        "source_evidence": source, "ending_mode": row.get("ending_mode", "serial_hook"), "accepted_prefix": prefix, "predecessor_plan": predecessor,
        "source_revision_review": {key: marker.get(key) for key in ("previous_version", "current_version")}}
    return {"planning_revision_epoch": revision_epoch(workspace), "revision_id": revision["revisionId"],
        "source_node_id": node.node_id, "source_node_version": node.version, "episode_number": number, "ending_mode": row.get("ending_mode", "serial_hook"),
        "evidence_signature": signature(evidence), "source_evidence": source, "budget": budget,
        "accepted_prefix": prefix, "predecessor_plan": predecessor}


def _verify_receipt(repository: Any, project: Any, workspace: dict, node: Any, row: dict, receipt: dict) -> None:
    if (row.get("source_node_id") != node.node_id or row.get("source_node_version") != node.version
            or row.get("story_bible_version") != node.story_bible_version
            or (row.get("source_revision_review") or {}).get("current_version") != node.version):
        _fail("rebuilt roadmap source identity is stale.")
    _require_approved_predecessor(repository, project, workspace, node)
    expected = _evidence(workspace, node, row["episode_number"], row)
    if any(receipt.get(key) != expected[key] for key in RECEIPT_CONTEXT_FIELDS):
        _fail("rebuilt roadmap evidence is stale; its source, budget, or accepted prefix changed.")
    compiled = plan_projection(row)
    if receipt.get("candidate_signature") != signature(compiled):
        _fail("rebuilt roadmap text changed while retaining its server receipt.")
    verify_rebuild_budget(compiled, expected)
    if any(compiled[key] != expected["source_evidence"][key] for key in SOURCE_FIELDS):
        _fail("rebuilt roadmap must retain exact current approved episode events.")
    saved = repository.get_completed_future_roadmap_rebuild(project.project_id, receipt.get("agent_run_id", ""))
    if (saved is None or saved.get("rebuild_receipt") != receipt
            or saved.get("items") != [compiled]):
        _fail("a matching completed server rebuild result is required.")


def _require_approved_predecessor(repository: Any, project: Any, workspace: dict, node: Any) -> None:
    if node.planned_start_episode <= 1:
        return
    row = _rows(workspace).get(node.planned_start_episode - 1)
    if not row or row.get("status") != "approved" or row.get("source_revision_review"):
        _fail("the preceding leaf ending must be explicitly approved before rebuilding the next leaf.")
    source = repository.get_story_plan_node(row.get("source_node_id", ""))
    if (source is None or source.version != row.get("source_node_version")
            or source.story_bible_version != row.get("story_bible_version")
            or source.planned_end_episode != row["episode_number"]):
        _fail("the approved preceding leaf ending has a stale source identity.")
    _require_active_node(repository, project, source)
    event = next((event for event in source.episode_developments if event.episode_number == row["episode_number"]), None)
    if event is None:
        revision = active_revision(workspace)
        frozen_saved = (revision and row["episode_number"] < revision["startEpisode"]
            and (any(episode.get("episodeNumber") == row["episode_number"] for episode in workspace.get("episodes", []))
                 or repository.list_episode_artifacts(project.project_id, episode_number=row["episode_number"])))
        if not frozen_saved:
            _fail("the preceding leaf ending must have an approved source event.")
    elif any(row.get(key) != getattr(event, key) for key in SOURCE_FIELDS):
        _fail("the preceding leaf ending must retain its exact approved source events.")


def context_from_repository(repository: Any, project: Any, workspace: dict, payload: Any, node: Any) -> dict:
    require_request_epoch(workspace, payload.planning_revision_epoch, episode_number=payload.episode_number)
    revision = active_revision(workspace)
    number = payload.episode_number
    if not revision or number < revision["startEpisode"]:
        _fail("only the active future revision range can be rebuilt.")
    _require_active_node(repository, project, node)
    if not node.planned_start_episode <= number <= node.planned_end_episode:
        _fail("episode is outside the current approved source leaf.")
    if (any(item.get("episodeNumber") == number for item in workspace.get("episodes", []))
            or repository.list_episode_artifacts(project.project_id, episode_number=number)):
        _fail("episodes with saved screenplay artifacts cannot be rebuilt.")
    rows = _rows(workspace)
    row = rows.get(number)
    if not row or row.get("status") != "draft":
        _fail("already approved roadmaps are excluded from future rebuilding.")
    marker = row.get("source_revision_review")
    if (not isinstance(marker, dict) or marker.get("current_version") != node.version
            or row.get("source_node_id") != node.node_id or row.get("source_node_version") != node.version
            or row.get("story_bible_version") != node.story_bible_version):
        _fail("only a roadmap explicitly awaiting review of this source version can be rebuilt.")
    _require_approved_predecessor(repository, project, workspace, node)
    ctx = _evidence(workspace, node, number, row)
    for n in range(node.planned_start_episode, number):
        previous = rows[n]
        if (previous.get("source_node_id") != node.node_id or previous.get("source_node_version") != node.version
                or previous.get("story_bible_version") != node.story_bible_version):
            _fail("accepted prefix must use this current approved source leaf.")
        prior_marker = previous.get("source_revision_review") or {}
        if previous.get("status") == "approved" and not prior_marker:
            continue
        receipt = prior_marker.get("rebuilt")
        if previous.get("status") != "draft" or not isinstance(receipt, dict):
            _fail("save or explicitly approve the preceding rebuilt episode before continuing.")
        _verify_receipt(repository, project, workspace, node, previous, receipt)
    if [plan_projection(item) for item in payload.accepted_plans] != ctx["accepted_prefix"]:
        _fail("accepted prefix must exactly match the current saved episode plans.")
    predecessor = plan_projection(payload.predecessor_plan) if payload.predecessor_plan is not None else None
    if predecessor != ctx["predecessor_plan"]:
        _fail("predecessor must exactly match the current saved prior leaf ending.")
    return ctx


def prepare_future_leaf_rebuild(long_service: Any, payload: Any, node: Any) -> dict | None:
    if not payload.future_rebuild:
        return None
    return long_service.prepare_future_leaf_rebuild_context(payload, node)


def build_rebuild_receipt(context: dict, item: Any, run: Any) -> dict:
    compiled = plan_projection(item)
    verify_rebuild_budget(compiled, context)
    if compiled["episode_number"] != context["episode_number"] or any(compiled[key] != context["source_evidence"][key] for key in SOURCE_FIELDS):
        _fail("output must retain the exact approved episode identity and source events.")
    return {**{key: deepcopy(context[key]) for key in RECEIPT_CONTEXT_FIELDS},
        "candidate_signature": signature(compiled), "agent_request_id": run.request_key, "agent_run_id": run.run_id}


def validate_rebuilt_workspace_rows(repository: Any, project: Any, previous: dict, candidate: dict) -> None:
    """Receipts may be adopted only in the same workspace CAS transaction."""
    rows = candidate.get("episodeRoadmaps")
    if not isinstance(rows, list):
        return  # Legacy workspace shape validation remains with its existing owners.
    receipt_rows = [row for row in rows if isinstance(row, dict) and isinstance(row.get("source_revision_review"), dict)
                    and row["source_revision_review"].get("rebuilt") is not None]
    if not receipt_rows:
        return
    prior_rows = _rows(previous)
    for row in receipt_rows:
        marker = row.get("source_revision_review") or {}
        receipt = marker.get("rebuilt") if isinstance(marker, dict) else None
        if receipt is None:
            continue  # Explicit manual edits discard the receipt and still need approval.
        if not isinstance(receipt, dict):
            _fail("invalid server rebuild receipt.")
        old = prior_rows.get(row["episode_number"])
        if old == row:
            continue
        node = repository.get_story_plan_node(row.get("source_node_id", ""))
        if node is None:
            _fail("rebuilt source leaf no longer exists.")
        _require_active_node(repository, project, node)
        if (row.get("status") != "draft" or old is None or old.get("status") != "draft"
                or not active_revision(candidate) or row["episode_number"] < candidate["planningRevision"]["startEpisode"]
                or any(item.get("episodeNumber") == row["episode_number"] for item in candidate.get("episodes", []))
                or repository.list_episode_artifacts(project.project_id, episode_number=row["episode_number"])):
            _fail("only unproduced pending future drafts may adopt rebuild receipts.")
        if extract_budget(old) != extract_budget(row):
            _fail("adoption must retain the saved production budgets exactly.")
        if {k: v for k, v in (old.get("source_revision_review") or {}).items() if k != "rebuilt"} != {k: v for k, v in marker.items() if k != "rebuilt"}:
            _fail("adoption must preserve the original pending source-review marker.")
        _verify_receipt(repository, project, candidate, node, row, receipt)
