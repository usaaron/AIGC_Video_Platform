import json

import pytest

from app.modules.script_engine.episode_plan_contracts import validate_episode_plan_prefix
from app.modules.script_engine.long_story_models import EpisodePlanGenerationItem, StoryPlanExpansionStatus
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_story_planning_service import (
    build_active_lineage_story_bible, build_active_lineage_story_node,
    build_active_lineage_episode_item,
)


@pytest.mark.parametrize("chunk", [[1, 2, 3, 4], [1], [5, 6, 7, 8]])
def test_transport_scope_does_not_rewrite_story_settlement(chunk):
    node = build_active_lineage_story_node(
        node_id="node.boundary", version=1, start_episode=1, end_episode=8,
        expansion_status=StoryPlanExpansionStatus.episode_ready,
    )
    contract = StoryPlanningService._build_episode_plan_prompt(
        node=node, story_bible=build_active_lineage_story_bible(),
        start_episode=1, end_episode=8, knowledge_context="",
    )
    prompt = StoryPlanningService._build_segmented_episode_roadmap_prompt(
        contract_prompt=contract, all_episode_numbers=list(range(1, 9)),
        current_episode_numbers=chunk, accepted_plans=[],
    )
    assert f"<response_episode_numbers>{json.dumps(chunk)}</response_episode_numbers>" in prompt
    assert '"full_narrative_range":[1,8]' in prompt
    assert '"settlement_episode":8' in prompt
    assert node.unit_story_beats[-1] in prompt
    assert "The batch must complete" not in prompt
    assert "replace every response-count or full-range" not in prompt
    if chunk[-1] != 8:
        assert "narrative settlement remains at Episode 8" in prompt
        assert "Do not execute or claim the terminal unit-story beat" in prompt


def test_first_chunk_cannot_consume_the_terminal_event_and_leave_empty_episode_slots():
    node = build_active_lineage_story_node(
        node_id="node.boundary", version=1, start_episode=1, end_episode=8,
        expansion_status=StoryPlanExpansionStatus.episode_ready,
    )
    first = EpisodePlanGenerationItem.model_validate(build_active_lineage_episode_item())
    bible = build_active_lineage_story_bible()
    valid = first.model_copy(update={"source_unit_story_beats": [node.unit_story_beats[0]]})
    validate_episode_plan_prefix([valid], node=node, story_bible=bible, require_complete=False)
    premature = first.model_copy(update={"source_unit_story_beats": [node.unit_story_beats[-1]]})
    with pytest.raises(StoryPlanningInputError, match="terminal unit-story beat.*Episode 8"):
        validate_episode_plan_prefix([premature], node=node, story_bible=bible, require_complete=False)
    assert premature.source_unit_story_beats == [node.unit_story_beats[-1]]
