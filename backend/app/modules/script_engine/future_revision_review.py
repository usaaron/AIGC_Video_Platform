"""Server-owned evidence for reviewing an unwritten suffix against saved history."""
from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping

from app.modules.script_engine.planning_review_cache import quality_episode_projection


def _saved_draft(episode: Mapping) -> dict | None:
    raw = episode.get('workingDraftJson')
    try:
        draft = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        draft = None
    return draft if isinstance(draft, dict) else (episode.get('generationRun') or {}).get('draft_master_script')


def _saved_execution(workspace: Mapping) -> list[dict]:
    """Project saved execution as real body text, excluding huge run metadata.

    Re-reviewing a completed planning revision must see subsequent saved bodies
    and local source clarifications, not just the original boundary episode.
    These excerpts are evidence to assess, never an automatic PASS or rewrite.
    """
    episodes = sorted((row for row in workspace.get('episodes', [])
                       if isinstance(row, dict) and row.get('status') == 'saved'
                       and not row.get('hasLocalDraftEdits') and not row.get('sourceAmendment')),
                      key=lambda row: row['episodeNumber'])
    result = []
    for episode in episodes:
        draft = _saved_draft(episode)
        if not isinstance(draft, dict):
            continue
        scenes = []
        for scene in draft.get('scenes', []):
            entries = []
            for ref in scene.get('body_order', []):
                try:
                    kind, index = ref.split(':'); index = int(index)
                    if index < 0:
                        continue
                    if kind == 'action':
                        entries.append({'ref': ref, 'action': scene['character_actions'][index]})
                    elif kind == 'dialogue':
                        line = scene['dialogues'][index]
                        entries.append({'ref': ref, 'speaker': line['character_name'], 'text': line['text']})
                except (ValueError, TypeError, KeyError, IndexError):
                    continue
            scenes.append({'scene_number': scene.get('scene_number'), 'scene_heading': scene.get('scene_heading'),
                           'ordered_body': entries})
        result.append({'episode_number': episode['episodeNumber'], 'scenes': scenes,
                       'continuity_state_updates': draft.get('continuity_state_updates', [])})
    return result


def future_revision_context(workspace: Mapping[str, object], *, completing: bool = False) -> dict | None:
    revision = workspace.get("planningRevision")
    if not isinstance(revision, dict) or revision.get("status") not in ({"active", "completed"} if completing else {"active"}):
        return None
    start = revision["startEpisode"]
    plans = sorted(workspace.get("episodeRoadmaps") or [], key=lambda row: row["episode_number"])
    boundary = next((item for item in workspace.get("episodes", []) if item.get("episodeNumber") == start - 1), None)
    if boundary is None:
        raise ValueError("Future review requires the actually saved preceding screenplay.")
    raw = boundary.get("workingDraftJson")
    if isinstance(raw, str):
        try:
            draft = json.loads(raw)
        except ValueError:
            draft = None
    else:
        draft = raw
    if not isinstance(draft, dict):
        draft = (boundary.get("generationRun") or {}).get("draft_master_script")
    if not isinstance(draft, dict):
        raise ValueError("Future review requires readable saved boundary screenplay evidence.")
    identity = {
        "revision_id": revision["revisionId"],
        "planning_revision_epoch": workspace.get("planningRevisionEpoch", 0),
        "start_episode": start,
        "end_episode": max(row["episode_number"] for row in plans),
    }
    # Hash the complete saved body, but show its ending and continuity rather than
    # multiplying an entire screenplay into each existing review group.
    saved_execution = _saved_execution(workspace)
    recent_execution = saved_execution[-10:]
    # A material used now may have been obtained much earlier than the recent
    # window. Preserve the older acted text, in order, without run metadata or
    # treating a planning summary as proof that the action occurred. Compact
    # tuples avoid multiplying technical ref keys across the saved prefix.
    historical_execution = [{
        'episode_number': row['episode_number'],
        'scenes': [{
            'scene_number': scene['scene_number'],
            'scene_heading': scene['scene_heading'],
            'ordered_body': [entry['action'] if 'action' in entry else
                             [entry['speaker'], entry['text']]
                             for entry in scene['ordered_body']],
        } for scene in row['scenes']],
    } for row in saved_execution[:-10]]
    evidence = {
        **identity, "story_bible_version": workspace.get("storyBibleVersion"),
        "plans": [quality_episode_projection(row).model_dump(mode="json") for row in plans],
        "boundary_body": draft,
        "historical_findings": (revision.get("originalAudit") or {}).get("findings", []),
    }
    identity["evidence_signature"] = hashlib.sha256(json.dumps(
        evidence, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    return {
        **identity,
        "saved_boundary_episode": {
            "episode_number": start - 1,
            **{key: draft.get(key) for key in (
                "synopsis", "character_state_updates", "relationship_state_updates",
                "continuity_state_updates", "story_line_updates", "setup_payoff_updates",
                "continuation_hook", "next_episode_question",
            )},
            "last_scene": (draft.get("scenes") or [None])[-1],
        },
        "historical_findings": evidence["historical_findings"],
        # These excerpts participate in the service's prompt execution
        # fingerprint. Keep them out of the frozen boundary signature: adding
        # the next saved episode must not revoke the still-valid suffix audit.
        "recent_saved_execution": recent_execution,
        "historical_saved_execution": historical_execution,
    }


SCOPE_IDENTITY_FIELDS = ("revision_id", "planning_revision_epoch", "start_episode", "end_episode", "evidence_signature")


def scope_matches_workspace(scope: object, workspace: Mapping[str, object]) -> bool:
    if not isinstance(scope, dict):
        return False
    try:
        expected = future_revision_context(workspace, completing=True)
    except (ValueError, TypeError, KeyError):
        return False
    return expected is not None and all(scope.get(key) == expected[key] for key in SCOPE_IDENTITY_FIELDS)
