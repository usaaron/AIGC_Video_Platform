"""Reuse a verdict only across a proven approval-only node version change."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence

from pydantic import ValidationError

from app.modules.script_engine.long_story_models import StoryPlanNode, StoryPlanQualityAudit, StoryPlanQualityEpisode


CURRENT_REVIEW_CONTRACT_VERSION = 13


def quality_episode_projection(roadmap: Mapping[str, object]) -> StoryPlanQualityEpisode:
    """Use the same review fields as the client, including actual scene evidence."""
    return StoryPlanQualityEpisode.model_validate({
        **{key: roadmap.get(key) for key in ("source_node_id", "source_node_version", "episode_number")},
        "planned_dialogue_line_count": roadmap.get("planned_dialogue_line_count"),
        **{key: roadmap.get(key) or "" for key in ("synopsis", "protagonist_decision", "episode_payoff", "exit_state")},
        **{key: roadmap.get(key) or [] for key in ("source_turning_points", "source_unit_story_beats", "continuity_requirements", "dramatic_units")},
        "scene_execution_plan": [{
            "scene_number": scene["scene_number"], "visible_action": scene["visible_action"],
            "evidence_requirements": scene.get("evidence_requirements") or [], "exit_state": scene["exit_state"],
            "forbidden_changes": scene.get("forbidden_changes") or [],
            "character_refs": scene.get("character_refs") or [],
            "dialogue_objective": scene.get("dialogue_objective"),
            "dialogue_line_target": scene.get("dialogue_line_target"),
        } for scene in roadmap.get("scene_execution_plan") or []],
    })


def quality_node_signature(refs: set[tuple[str, int]]) -> str:
    return hashlib.sha256(json.dumps(sorted(refs), ensure_ascii=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def review_after_approval(
    raw_audit: Mapping[str, object],
    previous: Sequence[StoryPlanNode],
    current: Sequence[StoryPlanNode],
    episode_plans: Sequence[StoryPlanQualityEpisode] = (),
    *,
    source_fingerprint: str | None = None,
) -> StoryPlanQualityAudit | None:
    if raw_audit.get("review_contract_version") != CURRENT_REVIEW_CONTRACT_VERSION:
        return None
    try:
        audit = StoryPlanQualityAudit.model_validate({
            key: value for key, value in raw_audit.items() if key in StoryPlanQualityAudit.model_fields
        })
    except ValidationError:
        return None
    # Approval changes lifecycle fields only; it cannot certify new source
    # evidence. Old verdicts without a binding remain saved but require review.
    if not source_fingerprint or audit.reviewed_source_fingerprint != source_fingerprint:
        return None
    old_by_id = {node.node_id: node for node in previous}
    new_by_id = {node.node_id: node for node in current}
    old_refs = {(item.node_id, item.node_version) for item in audit.node_refs}
    if (
        len(old_by_id) != len(previous) or len(new_by_id) != len(current)
        or set(old_by_id) != set(new_by_id) or not current
        or old_refs != {(node.node_id, node.version) for node in previous}
        or len(old_refs) != len(audit.node_refs) or audit.audited_node_count != len(current)
        or audit.node_signature != quality_node_signature(old_refs)
    ):
        return None
    changed = False
    for node_id, old in old_by_id.items():
        new = new_by_id[node_id]
        if (new.story_project_id, new.story_bible_id, new.story_bible_version) != (
            audit.story_project_id, audit.story_bible_id, audit.story_bible_version,
        ):
            return None
        if old == new:
            continue
        if not (old.status.value == "draft" and new.status.value == "approved" and new.version == old.version + 1):
            return None
        # Parent/predecessor versions and every narrative field stay binding.
        # Only the three fields changed by approval itself may differ.
        lifecycle = {"version", "status", "approved_at"}
        if old.model_dump(exclude=lifecycle) != new.model_dump(exclude=lifecycle):
            return None
        changed = True
    if not changed or any((finding.node_id, finding.node_version) not in old_refs for finding in audit.findings):
        return None
    try:
        reviewed = [StoryPlanQualityEpisode.model_validate(item) for item in json.loads(raw_audit.get("reviewed_episode_plans") or "null")]
    except (ValidationError, ValueError, TypeError):
        return None
    if len({item.episode_number for item in reviewed}) != len(reviewed):
        return None
    for item in reviewed:
        if (item.source_node_id, item.source_node_version) not in old_refs:
            return None
    if any((item.node_id, item.node_version) not in old_refs for item in audit.execution_requirements):
        return None
    carried = [item.model_copy(update={"source_node_version": new_by_id[item.source_node_id].version}) for item in reviewed]
    if sorted(carried, key=lambda item: item.episode_number) != sorted(episode_plans, key=lambda item: item.episode_number):
        return None
    refs = [{"node_id": node.node_id, "node_version": node.version} for node in current]
    return StoryPlanQualityAudit.model_validate({
        **audit.model_dump(mode="python"),
        "node_refs": refs,
        "node_signature": quality_node_signature({(node.node_id, node.version) for node in current}),
        "findings": [finding.model_copy(update={"node_version": new_by_id[finding.node_id].version}) for finding in audit.findings],
        "execution_requirements": [item.model_copy(update={"node_version": new_by_id[item.node_id].version})
                                   for item in audit.execution_requirements],
        # Preserve the actual verdict and original review time, including failures.
    })
