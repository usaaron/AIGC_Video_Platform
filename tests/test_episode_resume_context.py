import json

import pytest

from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.models import EpisodeGenerationContext


def context_with_state(*, checkpoint_episode=67, recall_episode=67, capsule_summary="材料仍待核验。"):
    state = {
        "entity_key": "item.paper", "entity_type": "item", "entity_name": "原始纸档",
        "state_domain": "possession", "current_state": "原件由知微保管，照片核对件未移交。",
        "future_constraint": "原载体去向未确认，署名不证明参数修改人。",
        "change_cause": "此前既有照片的整页打印。", "evidence_episode_number": 67,
        "evidence_scene_numbers": [2],
    }
    context = EpisodeGenerationContext(
        generation_mode="sequential", episode_number=68, total_episodes=72,
        previous_episode_summary="作者修正：原始纸档不是监督员收到的新原件。",
        previous_episode_handoff="末场仍只核时间，不重新演出。",
        provisional_continuity_checkpoint=json.dumps({
            "version": "provisional", "through_episode_number": checkpoint_episode,
            "world_states": [state],
        }),
        memory_recall={"through_episode_number": recall_episode, "status": "sufficient", "capsules": [{
            "capsule_id": "memory.paper", "memory_type": "hard_fact", "summary": capsule_summary,
            "entity_refs": ["item.paper"], "source_episode": recall_episode,
        }]},
    )
    return context, state


def compile_context(context):
    return ScriptGenerationService._episode_execution_context_payload(context, model_context_tokens=128_000)


def test_resume_context_keeps_saved_non_final_fact_and_more_precise_state():
    context, state = context_with_state()
    before = context.model_dump()
    compiled = compile_context(context)
    assert compiled["previous_episode_summary"] == context.previous_episode_summary
    assert compiled["previous_episode_handoff"] == context.previous_episode_handoff
    assert compiled["continuity_world_state_index"]["world_states"] == [state]
    assert context.model_dump() == before


def test_resume_context_does_not_duplicate_a_fully_recalled_world_state():
    _, state = context_with_state()
    summary = "；".join(state[key] for key in ("current_state", "future_constraint", "change_cause"))
    context, _ = context_with_state(capsule_summary=summary)
    assert "continuity_world_state_index" not in compile_context(context)


@pytest.mark.parametrize("checkpoint_episode,recall_episode", [(66,67),(67,66)])
def test_resume_context_does_not_mix_state_from_different_boundaries(checkpoint_episode, recall_episode):
    context, _ = context_with_state(checkpoint_episode=checkpoint_episode, recall_episode=recall_episode)
    assert "continuity_world_state_index" not in compile_context(context)


def test_resume_context_rejects_future_world_state_inside_older_checkpoint():
    context, _ = context_with_state()
    checkpoint = json.loads(context.provisional_continuity_checkpoint)
    checkpoint["world_states"][0]["evidence_episode_number"] = 68
    context = context.model_copy(update={"provisional_continuity_checkpoint": json.dumps(checkpoint)})
    assert "continuity_world_state_index" not in compile_context(context)
