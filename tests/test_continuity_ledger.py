from tests.test_long_story_repository import build_episode_artifact, build_story_bible

from app.modules.script_engine.continuity_ledger import project_episode_artifact_to_ledger
from app.modules.script_engine.long_story_models import StoryBible


def test_long_series_preserves_early_knowledge_and_replaces_keys_in_recency_order() -> None:
    bible = _story_bible_with_relationship()
    source = build_episode_artifact()
    ledger = None
    for number in range(1, 122):
        updates = [{
            "knowledge_key": f"archive.record_{number}",
            "statement": f"Mara inspected archive record {number}.",
            "status": "known",
        }]
        if number == 121:
            updates.append({
                "knowledge_key": "archive.record_1",
                "statement": "Mara has disproved the first record's claimed date.",
                "status": "disproved",
            })
        artifact = source.model_copy(update={
            "artifact_id": f"artifact.long_series.episode_{number}",
            "episode_number": number,
            "content_payload": {
                "title": f"Episode {number}",
                "synopsis": "Mara investigates the archive.",
                "character_state_updates": [{
                    "character_name": "Mara",
                    "current_goal": "Verify the archive records.",
                    "emotional_state": "Cautious",
                    "knowledge_states": updates,
                }],
            },
        })
        ledger = project_episode_artifact_to_ledger(
            artifact=artifact, story_bible=bible, previous=ledger,
        )
    mara = next(item for item in ledger.character_states if item.character_ref == "character.mara")
    assert len(mara.knowledge_states) == 121
    assert mara.knowledge_states[-1].knowledge_key == "archive.record_1"
    assert mara.knowledge_states[-1].status == "disproved"
    assert any(item.knowledge_key == "archive.record_2" for item in mara.knowledge_states)
    assert len(type(ledger).model_validate_json(ledger.model_dump_json()).character_states[0].knowledge_states) == 121


def _story_bible_with_relationship():
    payload = build_story_bible().model_dump(mode="json")
    payload["character_registry"] = [
        {
            "character_ref": "character.mara",
            "name": "Mara",
            "role": "protagonist",
        },
        {
            "character_ref": "character.adrian",
            "name": "Adrian",
            "role": "supporting",
        },
    ]
    payload["relationships"] = [{
        "relationship_id": "relationship.mara_adrian",
        "source_character_ref": "character.mara",
        "target_character_ref": "character.adrian",
        "relationship_type": "adversaries",
        "initial_state": "They distrust each other.",
        "target_direction": "They become reluctant allies.",
    }]
    return StoryBible.model_validate(payload)


def _relationship_update(source: str, target: str, summary: str) -> dict:
    return {
        "source_character_name": source,
        "target_character_name": target,
        "relationship_type": "reluctant allies",
        "source_to_target": "Trusts the evidence but not the motive.",
        "target_to_source": "Protects the investigation while withholding one fact.",
        "current_state": "They cooperate under pressure.",
        "change_summary": summary,
        "change_cause": "They survive the archive ambush together.",
        "evidence_scene_numbers": [1],
    }


def test_episode_relationship_updates_are_projected_into_the_next_checkpoint() -> None:
    story_bible = _story_bible_with_relationship()
    first = build_episode_artifact().model_copy(update={
        "content_payload": {
            "title": "Episode 1",
            "synopsis": "Mara and Adrian escape the archive.",
            "relationship_state_updates": [
                _relationship_update("Mara", "Adrian", "Distrust becomes conditional cooperation.")
            ],
        }
    })

    ledger = project_episode_artifact_to_ledger(
        artifact=first,
        story_bible=story_bible,
        previous=None,
    )

    relationship = ledger.relationship_states[0]
    assert relationship.relationship_id == "relationship.mara_adrian"
    assert relationship.last_changed_episode == 1
    assert "Mara->Adrian" in relationship.current_state
    assert "Distrust becomes conditional cooperation." in ledger.recent_episode_summaries[0].consequences

    second = first.model_copy(update={
        "artifact_id": "artifact.mainland_demo.episode_002.draft.initial",
        "episode_number": 2,
        "content_payload": {
            "title": "Episode 2",
            "synopsis": "Adrian reveals part of the truth.",
            "relationship_state_updates": [
                _relationship_update("Adrian", "Mara", "Cooperation becomes fragile trust.")
            ],
        },
    })
    updated = project_episode_artifact_to_ledger(
        artifact=second,
        story_bible=story_bible,
        previous=ledger,
    )

    assert len(updated.relationship_states) == 1
    assert updated.relationship_states[0].relationship_id == "relationship.mara_adrian"
    assert updated.relationship_states[0].last_changed_episode == 2
    assert "Adrian->Mara" in updated.relationship_states[0].current_state


def test_explicit_empty_active_constraints_clear_prior_state() -> None:
    story_bible = _story_bible_with_relationship()
    source = build_episode_artifact()
    first = source.model_copy(update={
        "content_payload": {
            "title": "Episode 1",
            "character_state_updates": [{
                "character_name": "Mara",
                "current_goal": "Survive",
                "emotional_state": "Tense",
                "active_constraints": ["Cannot run"],
            }],
        }
    })
    ledger = project_episode_artifact_to_ledger(
        artifact=first, story_bible=story_bible, previous=None,
    )
    second = source.model_copy(update={
        "artifact_id": "artifact.mainland_demo.episode_002.draft.initial",
        "episode_number": 2,
        "content_payload": {
            "title": "Episode 2",
            "character_state_updates": [{
                "character_name": "Mara",
                "current_goal": "Survive",
                "emotional_state": "Calm",
                "active_constraints": [],
            }],
        },
    })
    updated = project_episode_artifact_to_ledger(
        artifact=second, story_bible=story_bible, previous=ledger,
    )
    mara = next(item for item in updated.character_states if item.character_ref == "character.mara")
    assert mara.active_constraints == []
