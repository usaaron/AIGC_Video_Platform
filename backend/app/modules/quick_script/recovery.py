"""Read-only recovery hints; the action API still validates every transition."""
from __future__ import annotations

from typing import Literal

from app.modules.quick_script.models import QuickEpisode, QuickState


def _current_failure(state: QuickState, pending: QuickEpisode | None) -> bool:
    if not state.operation_records:
        return False
    record = state.operation_records[-1]
    if (record.get("status") != "failed" or record.get("revision") != state.revision
            or record.get("stage") != state.next_step
            or record.get("error_code") not in {
                "quick_context_limit", "quick_length_limit", "quick_result_apply_failed",
            }):
        return False
    if state.next_step == "draft":
        return pending is None and record.get("episode_number") == len(state.episodes) + 1
    if state.next_step in {"review", "repair", "recheck"}:
        return pending is not None and record.get("episode_number") == pending.episode_number
    return state.next_step in {"synopsis", "plan", "final_review"} and record.get("episode_number") is None


def _current_checked_body(state: QuickState, episode: QuickEpisode) -> bool:
    from app.modules.quick_script.engine import draft_body_hash, plan_content_hash, synopsis_hash, validate_quick_plan

    plan = state.plan
    number = episode.episode_number
    if (not 1 <= number <= state.settings.episode_count
            or episode.status != "blocked" or not episode.review or episode.review.status != "blocked"
            or episode.review.source_body_hashes != {str(number): episode.body_hash}
            or episode.body_hash != draft_body_hash(episode.draft)
            or not plan or not state.plan_confirmed or not state.synopsis_confirmed
            or plan.content_hash != plan_content_hash(plan)
            or state.synopsis_hash != synopsis_hash(state.synopsis)
            or plan.source_synopsis_hash != state.synopsis_hash
            or episode.source_plan_hash != plan.content_hash or validate_quick_plan(state, plan)):
        return False
    prior = sorted((item for item in state.episodes if item.episode_number < number), key=lambda item: item.episode_number)
    return ([item.episode_number for item in prior] == list(range(1, number))
            and all(item.status == "passed" and item.body_hash == draft_body_hash(item.draft)
                    and item.source_plan_hash == plan.content_hash for item in prior)
            and episode.source_episode_hashes == {str(item.episode_number): item.body_hash for item in prior})


def recovery_action(state: QuickState | None) -> Literal["repair", "switch_standard"] | None:
    """Expose only a currently actionable, mechanically justified recovery path."""
    if state is None or state.phase != "paused" or state.status != "blocked" or state.active_operation:
        return None
    if state.next_step == "done":
        return "switch_standard"
    pending = next((episode for episode in sorted(state.episodes, key=lambda item: item.episode_number)
                    if episode.status != "passed"), None)
    if _current_failure(state, pending):
        return "switch_standard"
    if not pending or not _current_checked_body(state, pending):
        return None
    from app.modules.quick_script.engine import mechanical_repair_contract, mechanical_review

    if state.next_step == "review" and mechanical_repair_contract(state, pending):
        return "repair"
    if state.next_step in {"review", "recheck"}:
        metadata_codes = {"ending_mode", "unknown_character"}
        reviewed = {issue.code for issue in pending.review.issues if issue.severity == "critical"} & metadata_codes
        reproduced = {issue.code for issue in mechanical_review(state, pending.episode_number, pending.draft)[1]
                      if issue.severity == "critical"}
        if reviewed & reproduced:
            return "switch_standard"
    return None
