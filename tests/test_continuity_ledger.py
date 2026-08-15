from tests.test_long_story_repository import build_episode_artifact, build_story_bible

from app.modules.script_engine.continuity_ledger import project_episode_artifact_to_ledger
from app.modules.script_engine.long_story_models import StoryBible


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
