from app.modules.script_engine.planning_body_scale import planning_body_scale_contract
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_episode_development_contract import authored_leaf
from tests.test_story_planning_service import build_active_lineage_story_bible


def test_scale_is_carried_through_decomposition_and_both_roadmap_paths_without_new_events():
    node = authored_leaf().model_copy(update={"estimated_script_body_characters": 11_112})
    bible = build_active_lineage_story_bible()
    before = node.model_dump_json()
    contract = planning_body_scale_contract(node)
    assert "11112有效字符" in contract
    assert "1389字符/集" in contract
    prompts = [
        StoryPlanningService._build_decomposition_prompt(
            parent=node, story_bible=bible, requested_child_count=None,
            max_episode_ready_span=12, knowledge_context="",
        ),
        StoryPlanningService._build_episode_plan_prompt(
            node=node, story_bible=bible, start_episode=1, end_episode=8,
            knowledge_context="",
        ),
        StoryPlanningService._build_episode_plan_item_prompt(
            node=node, story_bible=bible, episode_number=1, accepted_plans=[],
            predecessor_plan=None, knowledge_context="",
        ),
    ]
    for prompt in prompts:
        assert contract in prompt
        assert "规划本身写长不能抵扣正文目标" in prompt
        assert "不提前借用后集事件" in prompt
        assert "25–35" in prompt
    assert node.model_dump_json() == before
    assert node.episode_developments[1].synopsis not in prompts[-1]


def test_missing_allocation_does_not_fabricate_a_numeric_target():
    node = authored_leaf().model_copy(update={"estimated_script_body_characters": None})
    assert planning_body_scale_contract(node) == ""
