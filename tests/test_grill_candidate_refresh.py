import pytest

from app.modules.script_engine.long_story_models import (
    StoryInspirationBrief,
    StoryInspirationChatOutput,
    StoryInspirationChatRequest,
    StoryInspirationFrontierQuestion,
    StoryInspirationMessage,
)
from app.modules.script_engine.story_planning_service import (
    StoryPlanningInputError,
    StoryPlanningService,
    _story_inspiration_candidate_history,
    _story_inspiration_candidate_question,
    _story_inspiration_recommendations_requested,
    _story_inspiration_user_answer_count,
)


def question(**changes):
    return StoryInspirationFrontierQuestion(**{
        "question_id": "Q2",
        "decision_key": "ending_direction.choice",
        "title": "调查结局",
        "question": "调查完成之后，她会怎样处理已经拿到的证据？",
        "choices": ["公开证据：在听证会上当场公开，承担泄密的法律后果。", "保留证据：以撤诉换取证人离开调查。"],
        **changes,
    })


def request(**changes):
    return StoryInspirationChatRequest(**{
        "story_project_id": "project.grill",
        "generation_strategy_id": "strategy.grill",
        "candidate_decision_key": "ending_direction.choice",
        "user_message": "还没想好，给几个不同的方案。",
        "current_brief": StoryInspirationBrief(must_keep=["证人必须活着"], ending_direction=""),
        "messages": [StoryInspirationMessage(role="assistant", content="请确定下一步。", questions=[question()])],
        **changes,
    })


def output(**changes):
    return StoryInspirationChatOutput(**{
        "assistant_message": "这里有几个新的候选。",
        "questions": [question(choices=["重建信任：主角放弃取证，陪证人返回故乡。", "公开认错：主角承认自己的误判，邀请被冤枉者重开调查。"],
                               recommended_choice="重建信任：主角放弃取证，陪证人返回故乡。",
                               recommended_answer="主角已经背弃过证人，这个结果能重新检验两人的信任。")],
        "brief": StoryInspirationBrief(ending_direction="模型擅自决定的结果", must_keep=[]),
        "ready_to_generate": True,
        **changes,
    })


def test_candidates_stay_on_same_decision_and_cannot_overwrite_author_brief():
    payload = request()
    result = StoryPlanningService._ensure_unique_story_inspiration_turn(payload, output())
    assert not result.ready_to_generate
    assert result.brief == payload.current_brief
    assert result.questions[0].question_id == "Q2"
    assert result.questions[0].question == payload.messages[-1].questions[0].question
    assert len(result.questions[0].choices) == 2
    assert result.questions[0].recommended_choice is None
    assert result.questions[0].recommended_answer is None
    assert _story_inspiration_user_answer_count(payload) == 0


def test_refresh_preserves_other_questions_even_when_model_changes_them():
    other = question(question_id="Q1", decision_key="tone_and_pacing.choice", title="叙事节奏")
    payload = request(messages=[StoryInspirationMessage(role="assistant", content="两个决定。", questions=[other, question()])])
    result = StoryPlanningService._ensure_unique_story_inspiration_turn(payload, output())
    assert result.questions[0] == other
    assert result.questions[1].decision_key == "ending_direction.choice"


def test_refresh_rejects_same_plot_with_new_label_and_keeps_old_session_untouched():
    payload = request()
    before = payload.model_dump()
    repeated = question(choices=["不同标题：在听证会上当场公开，承担泄密的法律后果。", "改名方案：以撤诉换取证人离开调查。"])
    with pytest.raises(StoryPlanningInputError, match="重复或数量不足"):
        StoryPlanningService._ensure_unique_story_inspiration_turn(payload, output(questions=[repeated]))
    assert payload.model_dump() == before


def test_refresh_reads_persisted_candidate_history_before_recent_messages():
    payload = request()
    archived = "旧方向：她亲自护送证人出境，从此失去记者的身份。"
    payload.messages[0].candidate_history = {"ending_direction.choice": [archived]}
    assert archived in _story_inspiration_candidate_history(payload)["ending_direction.choice"]
    repeated = question(choices=[archived, "重建信任：主角放弃取证，陪证人返回故乡。"])
    with pytest.raises(StoryPlanningInputError, match="重复或数量不足"):
        StoryPlanningService._ensure_unique_story_inspiration_turn(payload, output(questions=[repeated]))


@pytest.mark.parametrize("message", ["还没想好", "给我几个建议方案", "给我推荐几个方案", "推荐几个选项供我选", "你先给个方案", "换一批", "不要推荐，给我几个方案"])
def test_candidate_request_does_not_authorize_ranking(message):
    assert not _story_inspiration_recommendations_requested(request(user_message=message))


@pytest.mark.parametrize("message", ["帮我推荐一个", "你推荐哪个方案？", "你建议我怎么选？", "你觉得哪个好？"])
def test_only_explicit_preference_request_allows_recommendation(message):
    payload = request(user_message=message)
    result = StoryPlanningService._ensure_unique_story_inspiration_turn(payload, output())
    assert result.questions[0].recommended_choice is not None


def test_unsure_free_text_can_request_candidates_but_explicit_deferral_stays_open():
    assert _story_inspiration_candidate_question(request(candidate_decision_key=None, user_message="结局还没想好")) is not None
    assert _story_inspiration_candidate_question(request(candidate_decision_key=None, user_message="暂时不确定，保留到后续阶段再决定")) is None


def test_refresh_rejects_stale_decision_instead_of_creating_another_question():
    with pytest.raises(StoryPlanningInputError, match="当前创作决定已变化"):
        _story_inspiration_candidate_question(request(candidate_decision_key="ending_direction.stale"))
