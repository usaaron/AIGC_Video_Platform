import pytest

from app.modules.script_engine.long_story_models import (
    StoryInspirationBrief, StoryInspirationChatRequest, StoryInspirationMessage,
    StoryInspirationFrontierQuestion, CreativeDecisionRecord,
)
from app.modules.script_engine.story_planning_service import (
    StoryPlanningService, _seed_story_inspiration_source,
)


SOURCE = """角色介绍：
阿莱：前律师，决定保护无辜的送货员。

摩根：前演员，为失去的同伴向商会追讨公道。

大致剧情：两人发生冲突，之后共同对抗商会。最终两人保留各自原则，共同保护城市。"""


def request(**values):
    return StoryInspirationChatRequest(story_project_id="project.source", generation_strategy_id="strategy.source",
                                       creative_prompt=SOURCE, **values)


def test_fallback_uses_both_source_protagonists_and_does_not_ask_for_known_ending():
    payload = request()
    seeded = _seed_story_inspiration_source(payload)
    result = StoryPlanningService._fallback_story_inspiration_turn(seeded)
    assert "阿莱" in result.brief.protagonist_and_goal
    assert "摩根" in result.brief.protagonist_and_goal
    assert "保留各自原则" in result.brief.ending_direction
    assert not any(question.decision_key.startswith(("protagonist_and_goal.", "ending_direction.")) for question in result.questions)
    assert payload.current_brief == StoryInspirationBrief()
    assert not result.ready_to_generate


@pytest.mark.parametrize("status", ["unresolved", "confirmed", "current_direction", "delegated", "conflicted"])
def test_source_handoff_preserves_revised_answers_and_deferred_decisions(status):
    brief = StoryInspirationBrief(protagonist_and_goal="作者改成由送货员主动推动故事。",
        creative_decisions=[CreativeDecisionRecord(decision_key="ending_direction.choice", title="作者保留的结局", status=status)])
    seeded = _seed_story_inspiration_source(request(current_brief=brief))
    assert seeded.current_brief.protagonist_and_goal == brief.protagonist_and_goal
    assert seeded.current_brief.ending_direction == ""
    assert seeded.current_brief.creative_decisions == brief.creative_decisions


def test_current_answer_is_not_displaced_by_an_older_source_during_fallback():
    question = StoryInspirationFrontierQuestion(question_id="Q1", decision_key="ending_direction.foundation",
        title="结局方向", question="你现在想要怎样改变这个结局？", choices=[])
    payload = request(user_message="两人最终离开这座城市。", messages=[StoryInspirationMessage(role="assistant", content="结局可以调整。", questions=[question])])
    seeded = _seed_story_inspiration_source(payload)
    result = StoryPlanningService._fallback_story_inspiration_turn(seeded)
    assert result.brief.ending_direction == payload.user_message


def test_episode_outcomes_cannot_seed_whole_story_ending():
    payload = request().model_copy(update={"creative_prompt": "第1集\n主角：记者要保护证人。\n最终结局：两人被迫分开。\n第2集\n最终两人再次见面。"})
    seeded = _seed_story_inspiration_source(payload)
    assert seeded.current_brief.ending_direction == ""
    assert seeded.current_brief.protagonist_and_goal == ""
