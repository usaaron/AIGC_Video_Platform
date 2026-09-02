from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.modules.script_engine.long_story_models import (
    EpisodeArtifact,
    MemoryLayer,
)
from app.modules.script_engine.narrative_events import build_narrative_event_set


NOW = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)


def build_artifact(*, memory_layer: MemoryLayer = MemoryLayer.canonical) -> EpisodeArtifact:
    return EpisodeArtifact(
        artifact_id="artifact.events.episode_001.final",
        story_project_id="story_project.events",
        episode_number=1,
        artifact_kind="final",
        memory_layer=memory_layer,
        content_schema_version="final_master_script.v1",
        content_payload={
            "synopsis": "Mara protects the ledger and loses the paper original.",
            "character_state_updates": [{
                "character_name": "Mara",
                "change_summary": "Mara chooses proof over revenge.",
                "evidence_scene_numbers": [2],
            }],
            "continuity_state_updates": [{
                "entity_key": "item.hidden_ledger",
                "entity_name": "Hidden ledger",
                "current_state": "The paper original is destroyed.",
                "evidence_scene_numbers": [3],
            }],
            "story_line_updates": [{
                "story_line_id": "storyline.hidden_ledger",
                "progress_summary": "The hidden ledger becomes admissible evidence.",
            }],
            "continuation_hook": {
                "ending_hook_summary": "A scheduled upload begins.",
                "evidence_scene_numbers": [4],
            },
        },
        artifact_version=1,
        payload_checksum="a" * 64,
        payload_size_bytes=200,
        created_at=NOW,
    )


def test_event_set_extraction_is_stable_and_evidence_linked() -> None:
    first_set, first_events = build_narrative_event_set(build_artifact())
    second_set, second_events = build_narrative_event_set(build_artifact())

    assert first_set == second_set
    assert first_events == second_events
    assert first_set.event_ids == [event.event_id for event in first_events]
    assert first_set.content_hash
    assert all(event.memory_layer == MemoryLayer.canonical for event in first_events)
    assert all(event.source_artifact_id == "artifact.events.episode_001.final" for event in first_events)
    assert all(event.evidence_refs for event in first_events)
    assert any("scene:2" in ref for ref in first_events[1].evidence_refs)


def test_derived_artifact_cannot_produce_source_events() -> None:
    with pytest.raises(ValueError, match="Only canonical artifacts"):
        build_narrative_event_set(
            build_artifact(memory_layer=MemoryLayer.derived)
        )


def test_narrative_event_models_reject_noncanonical_sources() -> None:
    event_set, events = build_narrative_event_set(build_artifact())
    with pytest.raises(ValidationError, match="canonical source records"):
        type(events[0]).model_validate({
            **events[0].model_dump(mode="json"),
            "memory_layer": MemoryLayer.derived,
        })
    with pytest.raises(ValidationError, match="canonical source records"):
        type(event_set).model_validate({
            **event_set.model_dump(mode="json"),
            "memory_layer": MemoryLayer.derived,
        })
