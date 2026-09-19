"""Deterministic extraction of source-linked events from canonical artifacts."""

from __future__ import annotations

import hashlib
import json
from typing import Any
from app.modules.script_engine.setup_payoff_provenance import stable_setup_payoff_id

from app.modules.script_engine.long_story_models import (
    EpisodeArtifact,
    MemoryLayer,
    NarrativeEvent,
    NarrativeEventSet,
    NarrativeEventType,
)


EXTRACTOR_POLICY_VERSION = "structured_continuity.v2"


def build_narrative_event_set(artifact: EpisodeArtifact) -> tuple[NarrativeEventSet, list[NarrativeEvent]]:
    """Create stable event records without asking a model to infer new facts."""

    if artifact.effective_memory_layer != MemoryLayer.canonical:
        raise ValueError("Only canonical artifacts can produce narrative events.")

    event_set_id = _event_set_id(artifact)
    events: list[NarrativeEvent] = []

    def add_event(
        event_type: NarrativeEventType,
        summary: str,
        *,
        entity_refs: list[str] | None = None,
        scene_numbers: list[int] | None = None,
        state_mutation: dict[str, Any] | None = None,
    ) -> None:
        cleaned_summary = _clean_summary(summary)
        if not cleaned_summary:
            return
        evidence_refs = _evidence_refs(
            artifact,
            scene_numbers=scene_numbers or [],
        )
        sequence_order = len(events) + 1
        events.append(
            NarrativeEvent(
                event_id=f"event.{_short_hash(artifact.artifact_id)}.{sequence_order:03d}",
                event_set_id=event_set_id,
                story_project_id=artifact.story_project_id,
                episode_number=artifact.episode_number,
                sequence_order=sequence_order,
                source_artifact_id=artifact.artifact_id,
                event_type=event_type,
                summary=cleaned_summary,
                entity_refs=_unique_strings(entity_refs or []),
                evidence_refs=evidence_refs,
                state_mutation=state_mutation,
                memory_layer=MemoryLayer.canonical,
                recorded_at=artifact.created_at,
            )
        )

    payload = artifact.content_payload
    add_event(
        NarrativeEventType.episode_summary,
        _text(payload.get("synopsis")) or _text(payload.get("summary")),
    )

    for update in _dict_list(payload.get("character_state_updates")):
        name = _text(update.get("character_name"))
        summary = (
            _text(update.get("change_summary"))
            or _text(update.get("change_cause"))
            or _text(update.get("current_goal"))
        )
        if name:
            add_event(
                NarrativeEventType.character_state_changed,
                f"{name}: {summary or 'state updated.'}",
                entity_refs=[_text(update.get("character_ref")) or name],
                scene_numbers=_int_list(update.get("evidence_scene_numbers")),
                state_mutation=dict(update),
            )

    for update in _dict_list(payload.get("relationship_state_updates")):
        relationship_id = _text(update.get("relationship_id"))
        summary = (
            _text(update.get("change_summary"))
            or _text(update.get("current_state"))
            or _text(update.get("change_cause"))
        )
        if relationship_id:
            add_event(
                NarrativeEventType.relationship_state_changed,
                f"{relationship_id}: {summary or 'state updated.'}",
                entity_refs=[relationship_id],
                scene_numbers=_int_list(update.get("evidence_scene_numbers")),
                state_mutation=dict(update),
            )

    for update in _dict_list(payload.get("continuity_state_updates")):
        entity_key = _text(update.get("entity_key"))
        entity_name = _text(update.get("entity_name")) or entity_key
        summary = (
            _text(update.get("current_state"))
            or _text(update.get("change_cause"))
            or _text(update.get("transition"))
        )
        if entity_key:
            add_event(
                NarrativeEventType.world_state_changed,
                f"{entity_name}: {summary or 'state updated.'}",
                entity_refs=[entity_key],
                scene_numbers=_int_list(update.get("evidence_scene_numbers")),
                state_mutation=dict(update),
            )

    for update in _dict_list(payload.get("story_line_updates")):
        story_line_id = _text(update.get("story_line_id"))
        summary = (
            _text(update.get("progress_summary"))
            or _text(update.get("status"))
        )
        if story_line_id:
            add_event(
                NarrativeEventType.story_line_progressed,
                f"{story_line_id}: {summary or 'progress updated.'}",
                entity_refs=[story_line_id],
                scene_numbers=_int_list(update.get("evidence_scene_numbers")),
                state_mutation=dict(update),
            )

    for update in _dict_list(payload.get("setup_payoff_updates")):
        source_ref = _text(update.get("source_ref")) or _text(update.get("setup_payoff_ref")) or _text(update.get("setup_payoff_id"))
        setup_payoff_id = stable_setup_payoff_id(source_ref) if source_ref else None
        summary = (
            _text(update.get("description"))
            or _text(update.get("progress_summary"))
            or _text(update.get("status"))
        )
        if setup_payoff_id:
            add_event(
                NarrativeEventType.setup_payoff_updated,
                f"{setup_payoff_id}: {summary or 'status updated.'}",
                entity_refs=[setup_payoff_id],
                scene_numbers=_int_list(update.get("evidence_scene_numbers")),
                state_mutation={**update, "setup_payoff_ref": setup_payoff_id, "source_ref": source_ref if source_ref != setup_payoff_id else update.get("source_ref")},
            )

    hook = payload.get("continuation_hook")
    if isinstance(hook, dict):
        hook_summary = (
            _text(hook.get("ending_hook_summary"))
            or _text(hook.get("next_episode_obligation"))
        )
        if hook_summary:
            add_event(
                NarrativeEventType.hook_emitted,
                hook_summary,
                scene_numbers=_int_list(
                    hook.get("evidence_scene_numbers")
                    or hook.get("response_evidence_scene_numbers")
                ),
                state_mutation=dict(hook),
            )

    if not events:
        add_event(
            NarrativeEventType.episode_summary,
            f"Canonical artifact accepted for episode {artifact.episode_number}.",
        )

    event_payload = [event.model_dump(mode="json") for event in events]
    event_set = NarrativeEventSet(
        event_set_id=event_set_id,
        story_project_id=artifact.story_project_id,
        episode_number=artifact.episode_number,
        source_artifact_id=artifact.artifact_id,
        source_artifact_version=artifact.artifact_version,
        extractor_policy_version=EXTRACTOR_POLICY_VERSION,
        event_ids=[event.event_id for event in events],
        content_hash=hashlib.sha256(
            json.dumps(
                event_payload,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest(),
        memory_layer=MemoryLayer.canonical,
        created_at=artifact.created_at,
    )
    return event_set, events


def _event_set_id(artifact: EpisodeArtifact) -> str:
    return f"event_set.{_short_hash(artifact.artifact_id)}"


def _short_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:20]


def _evidence_refs(artifact: EpisodeArtifact, *, scene_numbers: list[int]) -> list[str]:
    unique_scenes = sorted({scene for scene in scene_numbers if scene > 0})
    if unique_scenes:
        return [
            f"artifact:{artifact.artifact_id}:episode:{artifact.episode_number}:scene:{scene}"
            for scene in unique_scenes[:30]
        ]
    return [f"artifact:{artifact.artifact_id}:episode:{artifact.episode_number}"]


def _dict_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _int_list(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, int) and not isinstance(item, bool)]


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _clean_summary(value: str) -> str:
    return " ".join(value.split())[:800]


def _unique_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = value.strip()
        if not normalized or normalized.casefold() in seen:
            continue
        seen.add(normalized.casefold())
        result.append(normalized)
    return result[:30]
