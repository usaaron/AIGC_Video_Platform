"""Honor current semantic findings when an older project resumes production."""

import json
from collections.abc import Mapping

from app.modules.script_engine.planning_review_cache import quality_episode_projection
from app.modules.script_engine.future_revision_review import scope_matches_workspace


_CONTENT_FIELDS = ("synopsis", "protagonist_decision", "episode_payoff", "exit_state")
_SOURCE_FIELDS = ("source_turning_points", "source_unit_story_beats")


def current_story_quality_rejection(episode_number: int, workspace: Mapping[str, object]) -> str | None:
    audit = workspace.get("storyTreeQualityAudit")
    if not isinstance(audit, dict) or audit.get("review_contract_version") not in (3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13):
        return None
    if audit.get("status") != "needs_revision" or audit.get("story_bible_version") != workspace.get("storyBibleVersion"):
        return None
    refs = audit.get("node_refs")
    if not isinstance(refs, list) or any(not isinstance(ref, dict) for ref in refs):
        return None
    keys = {(ref.get("node_id"), ref.get("node_version")) for ref in refs}
    plans = [
        item for item in workspace.get("episodeRoadmaps", [])
        if isinstance(item, dict)
        and item.get("story_bible_version") == audit.get("story_bible_version")
        and (item.get("source_node_id"), item.get("source_node_version")) in keys
    ]
    try:
        reviewed = json.loads(audit.get("reviewed_episode_plans") or "null")
        actual = [{
            **{key: item.get(key) for key in ("source_node_id", "source_node_version", "episode_number")},
            **{key: item.get(key) or "" for key in _CONTENT_FIELDS},
            **{key: item.get(key) or [] for key in _SOURCE_FIELDS},
        } for item in sorted(plans, key=lambda item: item["episode_number"])]
        if audit.get("review_contract_version") in (6, 7, 8, 9):
            for reviewed_item, plan in zip(actual, sorted(plans, key=lambda item: item["episode_number"]), strict=True):
                reviewed_item["scene_execution_plan"] = [{
                    "scene_number": scene["scene_number"],
                    "visible_action": scene["visible_action"],
                    "evidence_requirements": scene.get("evidence_requirements") or [],
                    "exit_state": scene["exit_state"],
                } for scene in plan.get("scene_execution_plan") or []]
                if audit.get("review_contract_version") in (8, 9):
                    reviewed_item["planned_dialogue_line_count"] = plan.get("planned_dialogue_line_count")
                    for scene_evidence, scene in zip(
                        reviewed_item["scene_execution_plan"], plan.get("scene_execution_plan") or [], strict=True,
                    ):
                        scene_evidence.update({
                            "character_refs": scene.get("character_refs") or [],
                            "dialogue_objective": scene.get("dialogue_objective"),
                            "dialogue_line_target": scene.get("dialogue_line_target"),
                        })
        if audit.get("review_contract_version") in (10, 11, 12, 13):
            actual = [quality_episode_projection(plan).model_dump(mode="json")
                      for plan in sorted(plans, key=lambda item: item["episode_number"])]
    except (ValueError, TypeError, KeyError):
        return None
    # A revision must be reviewed anew, never blocked by a superseded verdict.
    if reviewed != actual:
        return None
    current = next((item for item in plans if item.get("episode_number") == episode_number), None)
    if current is None:
        return None
    scope = audit.get("future_revision_review")
    revision = workspace.get("planningRevision") or {}
    if (revision.get("status") == "completed" and isinstance(scope, dict)
            and scope.get("status") == scope.get("boundary_status") == "pass"
            and scope.get("start_episode", 2_001) <= episode_number <= scope.get("end_episode", 0)
            and scope_matches_workspace(scope, workspace)
            and not any(item.get("end_episode", 2_001) >= scope["start_episode"] for item in audit.get("findings", []))):
        # A node can straddle the frozen boundary. Its historical issue remains
        # visible while the independently reviewed suffix is allowed to proceed.
        return None
    for finding in audit.get("findings", []):
        if not isinstance(finding, dict):
            continue
        if (finding.get("node_id"), finding.get("node_version")) != (
            current.get("source_node_id"), current.get("source_node_version"),
        ):
            continue
        return (
            f"第{episode_number}集所属剧情部分「{finding.get('title', '')}」尚未通过剧情审校："
            f"{finding.get('summary', '')} 请先修订规划并重新审校；已保存正文保留。"
        )
    return None
