"""Synopsis synthesis is a separate, non-persisting author review operation."""

from copy import deepcopy
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlmodel import SQLModel

from app.api.routes.story_projects import router
from app.database import create_database_runtime
from app.dependencies import get_story_planning_service
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.script_engine.llm_adapter import LLMRequestError, LLMStructuredOutputError, MockLLMAdapter
from app.modules.script_engine.long_story_models import (
    CreativeDecisionRecord,
    StoryBibleDraftRequest,
    StoryInspirationChatRequest,
    StoryProject,
    StorySynopsisDraftRequest,
)
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.repository import GenerationStrategyRepository
from app.modules.script_engine.story_planning_service import (
    StoryPlanningService,
    _seed_story_inspiration_source,
    _story_bible_decisions_for_request,
)
from test_story_planning_service import build_content_spec, build_strategy


@pytest.fixture
def synopsis_client(tmp_path, request):
    class SynopsisAdapter(MockLLMAdapter):
        output = {"text": "沈知微为保护证人公开调查；代价迫使她与搭档共同作证，最终揭开伪造记录。",
                  "review": {"status": "complete", "issues": []}}
        error = None

        def __init__(self):
            self.calls = []

        def generate_structured_output(self, prompt, *, strategy, output_schema=None):
            self.calls.append((prompt, strategy, output_schema))
            if self.error is not None:
                raise self.error
            return deepcopy(self.output)

    class ForbiddenAdapter(MockLLMAdapter):
        def generate_structured_output(self, *args, **kwargs):
            raise AssertionError("Synopsis synthesis and inspiration chat must use their own role budgets.")

    database_path = tmp_path / "synopsis.db"
    runtime = create_database_runtime(f"sqlite:///{database_path}")
    SQLModel.metadata.create_all(runtime.engine)
    specs, strategies = ContentSpecRepository(), GenerationStrategyRepository()
    spec, strategy = specs.save(build_content_spec()), strategies.save(build_strategy())
    stories = LongStoryService(runtime)
    project = stories.save_project(StoryProject(
        project_id="project.synopsis", title="回执之前", content_spec_id=spec.id, planned_episode_count=20,
    ))
    adapter = SynopsisAdapter()
    testing_inspiration = getattr(request, "param", "synopsis") == "inspiration"
    service = StoryPlanningService(long_story_service=stories, content_spec_repository=specs,
        generation_strategy_repository=strategies, llm_adapter=ForbiddenAdapter(),
        inspiration_llm_adapter=adapter if testing_inspiration else ForbiddenAdapter(),
        story_bible_llm_adapter=ForbiddenAdapter() if testing_inspiration else adapter)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_story_planning_service] = lambda: service
    payload = StorySynopsisDraftRequest(story_project_id=project.project_id,
        content_spec_id=spec.id, generation_strategy_id=strategy.id, target_episode_count=20).model_dump(mode="json")
    def database_snapshot():
        with sqlite3.connect(database_path) as connection:
            return tuple(connection.iterdump())

    before = database_snapshot()
    try:
        with TestClient(app) as client:
            yield client, f"/story-projects/{project.project_id}/story-bibles/synopsis-draft", payload, adapter
        assert stories.get_project(project.project_id) == project
        assert database_snapshot() == before
    finally:
        runtime.engine.dispose()


def test_synopsis_route_uses_full_author_manuscript_and_separate_contract(synopsis_client):
    client, url, payload, adapter = synopsis_client
    payload.update({
        "current_text": "手改：她是送货员，不能恢复成调查记者。" + "既有行动与后果。" * 1400 + "手改尾声：她留在港口。",
        "creative_prompt": "旧输入：她是调查记者。",
        "current_brief": {"protagonist_and_goal": "旧摘要：调查记者追查旧案。", "must_keep": ["证人活着"],
                          "must_avoid": ["不能靠巧合破案"], "ending_direction": "留在港口"},
        "messages": [{"role": "assistant", "content": "候选：搭档叛变。"},
                     {"role": "user", "content": "不要叛变；将搭档改为她的姐姐。"}],
    })
    original = deepcopy(payload)
    response = client.post(url, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["text"] == adapter.output["text"]
    assert len(adapter.calls) == 1
    prompt, strategy, schema = adapter.calls[0]
    assert schema["title"] == "StorySynopsisDraftOutput"
    assert set(schema["properties"]) == {"text", "review"}
    assert schema["$defs"]["StorySynopsisReview"]["properties"]["issues"]["maxItems"] == 32
    assert schema["$defs"]["StorySynopsisReviewIssue"]["properties"]["message"]["maxLength"] == 3000
    assert payload["current_text"] in prompt
    assert "不要叛变；将搭档改为她的姐姐。" in prompt
    assert "证人活着" in prompt and "不能靠巧合破案" in prompt
    assert "最新明确作者修改覆盖对应旧事实" in prompt
    assert "历史 brief、早期创作输入和未选候选不能覆盖手改" in prompt
    assert "只能作为 proposal" in prompt and "不能作为事实写进 text" in prompt
    assert "触发事件" in prompt and "行动→对抗/结果→代价" in prompt
    assert "不强制三幕比例、反转数量、人物必须改变性格" in prompt
    assert "不是文学质量PASS" in prompt
    assert strategy.max_tokens == min(build_strategy().max_tokens, 12_000)
    assert payload == original


def test_existing_uploaded_synopsis_is_present_in_full_for_faithful_extraction(synopsis_client):
    client, url, payload, adapter = synopsis_client
    source = "资料开头。" * 1800 + "已有故事梗概：她为救姐姐出庭作证。" + "资料后部。" * 1700 + "原梗概结局：姐妹留下共同生活。"
    payload["reference_materials"] = [
        {"file_name": "story.txt", "purpose": "story_reference", "extracted_text": source},
        {"file_name": "style.txt", "purpose": "style_reference", "extracted_text": "仅风格示例中的角色张三。"},
    ]
    response = client.post(url, json=payload)
    assert response.status_code == 200, response.text
    prompt = adapter.calls[0][0]
    assert source in prompt
    assert "已有故事梗概则优先忠实提取整理" in prompt
    assert "format_template 和 style_reference 只参考格式、风格，不能复制其中人物" in prompt


@pytest.mark.parametrize("market", ["cn_mainland", "overseas_tiktok"])
def test_synopsis_names_follow_current_market_without_changing_source_or_identity(synopsis_client, market):
    client, url, payload, adapter = synopsis_client
    service = client.app.dependency_overrides[get_story_planning_service]()
    spec = service._content_spec_repository.get(payload["content_spec_id"])
    spec.metadata["market_profile"] = market
    service._content_spec_repository.save(spec)
    source = "莱恩与妹妹艾拉共同保护证人，结局两人仍是兄妹。"
    payload["reference_materials"] = [
        {"file_name": "story.txt", "purpose": "story_reference", "extracted_text": source},
    ]
    if market == "overseas_tiktok":
        payload["current_text"] = "Lane与妹妹Eira共同保护证人。"
        payload["messages"] = [{"role": "user", "content": "保留Lane与Eira的英文拼写，二人仍是兄妹。"}]
    original = deepcopy(payload)
    response = client.post(url, json=payload)
    assert response.status_code == 200, response.text
    assert len(adapter.calls) == 1
    prompt = adapter.calls[0][0]
    assert f"WORKFLOW MARKET CONTRACT ({market})" in prompt
    assert source in prompt
    if market == "overseas_tiktok":
        assert "即使本阶段尚无人物登记表" in prompt
        assert "不等于照搬中文来源中的姓名写法" in prompt
        assert "只有中文来源时，先为每个人物确定一个自然、稳定的英文拼写" in prompt
        assert "优先沿用该稳定拼写" in prompt
        assert payload["current_text"] in prompt
        assert "不使用中文译名、括号别名或中英双名" in prompt
        assert "不得改变人物身份、亲属关系、行动、结局" in prompt
        assert "国内路径：沿用已确定的中文人物姓名" not in prompt
    else:
        assert "国内路径：沿用已确定的中文人物姓名" in prompt
        assert "不改成英文名" in prompt
        assert "只有中文来源时，先为每个人物确定" not in prompt
    assert payload == original


def test_review_cannot_drop_deferred_ending_or_promote_unapproved_proposals(synopsis_client):
    client, url, payload, adapter = synopsis_client
    payload["current_brief"] = {
        "unresolved": ["结局等作者以后决定", "结局等作者以后决定"],
        "creative_decisions": [
            {"decision_key": "ending.choice", "title": "结局决定", "value": "保留至终局规划", "status": "unresolved"},
            {"decision_key": "identity.choice", "title": "身份秘密", "status": "current_direction", "ai_permission": "none"},
            {"decision_key": "betrayal.choice", "title": "搭档背叛", "value": "候选方向", "status": "proposed"},
            {"decision_key": "death.choice", "title": "人物生死", "status": "conflicted"},
            {"decision_key": "witness.alive", "title": "证人存活", "value": "始终活着", "status": "confirmed",
             "authority": "canonical", "ai_permission": "none"},
        ],
    }
    original = deepcopy(payload)
    response = client.post(url, json=payload)
    assert response.status_code == 200, response.text
    review = response.json()["data"]["review"]
    assert review["status"] == "draft"
    assert len(review["issues"]) == 5
    assert {item["kind"] for item in review["issues"]} == {"unresolved", "proposal", "conflict"}
    assert sum(item["message"] == "结局等作者以后决定" for item in review["issues"]) == 1
    assert not any("证人存活" in item["message"] for item in review["issues"])
    assert "作者主动暂缓" in adapter.calls[0][0]
    assert payload == original


def test_later_confirmed_record_resolves_only_its_own_prior_decision(synopsis_client):
    client, url, payload, _ = synopsis_client
    payload["current_brief"] = {"creative_decisions": [
        {"decision_key": "ending.choice", "title": "结局决定", "status": "unresolved"},
        {"decision_key": "ending.choice", "title": "结局决定", "status": "confirmed", "value": "姐妹留下"},
    ]}
    response = client.post(url, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["review"] == {"status": "complete", "issues": []}


@pytest.mark.parametrize("kind", ["causality", "conflict", "unresolved", "proposal"])
def test_review_issue_prevents_a_false_complete_label(synopsis_client, kind):
    client, url, payload, adapter = synopsis_client
    adapter.output = {"text": "她作证，之后搭档获得账本。", "review": {
        "status": "complete", "issues": [{"kind": kind, "message": "拿到账本的原因尚未交代。"}],
    }}
    response = client.post(url, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["review"] == {**adapter.output["review"], "status": "draft"}


@pytest.mark.parametrize("bad_output", [
    {"text": "", "review": {"status": "complete", "issues": []}},
    {"text": " \n\t ", "review": {"status": "complete", "issues": []}},
    {"text": "内容"},
    {"text": "内容", "review": {"status": "passed", "issues": []}},
    {"text": "字" * 20_001, "review": {"status": "complete", "issues": []}},
])
def test_invalid_synthesis_errors_once_without_fallback_or_writes(synopsis_client, bad_output):
    client, url, payload, adapter = synopsis_client
    payload["current_text"] = "作者应保留的当前梗概。"
    adapter.output = bad_output
    response = client.post(url, json=payload)
    assert response.status_code == 422, response.text
    assert "已有正文和对话已保留" in response.json()["detail"]
    assert "data" not in response.json()
    assert len(adapter.calls) == 1


@pytest.mark.parametrize(("error", "expected_status"), [
    (LLMStructuredOutputError("truncated", raw_content="{"), 422),
    (LLMRequestError("timeout", category="timeout"), 503),
    (LLMRequestError("budget exhausted", category="deadline"), 503),
    (LLMRequestError("rate limited", status_code=429), 429),
])
def test_provider_failure_is_not_reported_as_a_draft(synopsis_client, error, expected_status):
    client, url, payload, adapter = synopsis_client
    adapter.error = error
    response = client.post(url, json=payload)
    assert response.status_code == expected_status, response.text
    assert "data" not in response.json()
    assert len(adapter.calls) == 1


@pytest.mark.parametrize(("change", "expected_status"), [
    ({"story_project_id": "project.other"}, 409),
    ({"content_spec_id": "content_spec.other"}, 422),
    ({"generation_strategy_id": "strategy.missing"}, 422),
    ({"current_text": "字" * 20_001}, 422),
    ({"creative_prompt": "字" * 10_001}, 422),
    ({"messages": [{"role": "user", "content": "回答"}] * 31}, 422),
    ({"candidate_decision_key": "ending.choice"}, 422),
    ({"reference_materials": [{"file_name": f"source-{index}", "purpose": "story_reference", "extracted_text": "字" * 30_000} for index in range(5)]}, 422),
])
def test_request_contract_rejects_mismatch_and_over_budget_before_model(synopsis_client, change, expected_status):
    client, url, payload, adapter = synopsis_client
    response = client.post(url, json={**payload, **change})
    assert response.status_code == expected_status, response.text
    assert adapter.calls == []


@pytest.mark.parametrize("preserve_source", [False, True])
def test_bible_prompt_uses_entire_confirmed_synopsis_and_review_notes(preserve_source):
    manuscript = "最新梗概前文。" * 2200 + "梗概最后一句：姐姐活着离开。"
    request = StoryBibleDraftRequest(
        story_project_id="project.synopsis", generation_strategy_id="strategy.synopsis",
        creative_prompt="旧输入：姐姐已经死去。", confirmed_synopsis=manuscript,
        synopsis_review_notes=["幕后人物待作者决定", "建议：可探索姐姐主动追查，尚未采用"],
        author_instruction="本轮仅修改故事地点为港口。", preserve_source_document=preserve_source,
    )
    prompt = StoryPlanningService._build_prompt(payload=request, project_title="回执之前",
        content_spec=build_content_spec(), knowledge_context="")
    assert manuscript in prompt
    assert "幕后人物待作者决定" in prompt
    assert "建议：可探索姐姐主动追查，尚未采用" in prompt
    assert "不是故事事实" in prompt
    assert "原文导入也必须遵守该优先级" in prompt
    assert "本轮最新明确修改仍可局部调整" in prompt
    assert "旧输入：姐姐已经死去。" in prompt
    decisions = _story_bible_decisions_for_request(request)
    historical = next(item for item in decisions if item.decision_key == "creative_input.original")
    assert historical.value == request.creative_prompt
    assert historical.authority == "derived"
    assert historical.status == "current_direction"


def test_confirmed_synopsis_does_not_demote_other_author_decisions():
    original = CreativeDecisionRecord(decision_key="creative_input.original", title="用户原始创作输入",
        value="旧初始输入", authority="canonical", status="confirmed")
    protected = CreativeDecisionRecord(decision_key="witness.alive", title="证人必须存活",
        value="证人始终活着", authority="canonical", status="confirmed", locked=True)
    request = StoryBibleDraftRequest(story_project_id="project.synopsis", generation_strategy_id="strategy.synopsis",
        confirmed_synopsis="新梗概", creative_decisions=[original, protected])
    decisions = {item.decision_key: item for item in _story_bible_decisions_for_request(request)}
    assert decisions["witness.alive"] == protected
    assert decisions["creative_input.original"].value == original.value
    assert decisions["creative_input.original"].authority == "derived"
    assert original.authority == "canonical"
    assert _story_bible_decisions_for_request(request.model_copy(update={"confirmed_synopsis": ""})) == [original, protected]


def test_inspiration_round_limit_does_not_claim_full_story_quality():
    request = StoryInspirationChatRequest(story_project_id="project.synopsis", generation_strategy_id="strategy.synopsis",
        messages=[{"role": "user", "content": "以后决定"}] * 12)
    result = StoryPlanningService._fallback_story_inspiration_turn(request)
    assert result.ready_to_generate is True
    assert result.questions == []
    assert "草稿" in result.assistant_message
    assert "不代表故事因果和结局已经完整" in result.assistant_message
    assert "完整总纲" not in result.assistant_message


def test_bible_handoff_notes_and_synopsis_keep_explicit_request_limits():
    accepted = StoryBibleDraftRequest(story_project_id="project.synopsis", generation_strategy_id="strategy.synopsis",
        synopsis_review_notes=[f"作者保留项{index}" for index in range(92)])
    assert len(accepted.synopsis_review_notes) == 92
    with pytest.raises(ValidationError):
        StoryBibleDraftRequest(story_project_id="project.synopsis", generation_strategy_id="strategy.synopsis",
            synopsis_review_notes=["未决"] * 161)


@pytest.mark.parametrize("purpose", ["format_template", "style_reference", "world_setting", "character_reference", "other"])
def test_inspiration_automatic_seed_does_not_promote_other_reference_plots(purpose):
    from test_input_source_handoff import SOURCE

    payload = StoryInspirationChatRequest(story_project_id="project.synopsis", generation_strategy_id="strategy.synopsis",
        reference_materials=[{"file_name": "reference.txt", "purpose": purpose, "extracted_text": SOURCE}])
    original = payload.model_dump(mode="json")
    seeded = _seed_story_inspiration_source(payload)
    assert seeded.current_brief == payload.current_brief
    assert seeded.reference_materials == payload.reference_materials
    assert payload.model_dump(mode="json") == original
    prompt = StoryPlanningService._build_story_inspiration_prompt(
        payload=seeded, project_title="当前故事", content_spec=build_content_spec(),
    )
    assert SOURCE in prompt


@pytest.mark.parametrize("source_type", ["creative_prompt", "story_reference"])
def test_inspiration_automatic_seed_still_uses_actual_story_sources_without_mutation(source_type):
    from test_input_source_handoff import SOURCE

    source = {"creative_prompt": SOURCE} if source_type == "creative_prompt" else {
        "reference_materials": [{"file_name": "story.txt", "purpose": "story_reference", "extracted_text": SOURCE}],
    }
    payload = StoryInspirationChatRequest(story_project_id="project.synopsis", generation_strategy_id="strategy.synopsis", **source)
    original = payload.model_dump(mode="json")
    seeded = _seed_story_inspiration_source(payload)
    assert "阿莱" in seeded.current_brief.protagonist_and_goal
    assert "摩根" in seeded.current_brief.protagonist_and_goal
    assert "保留各自原则" in seeded.current_brief.ending_direction
    assert payload.model_dump(mode="json") == original
    assert seeded.reference_materials == payload.reference_materials


def test_maximum_synopsis_review_and_author_notes_fit_the_next_stage_without_trimming(synopsis_client):
    client, url, payload, adapter = synopsis_client
    payload["current_brief"] = {
        "unresolved": [f"原始未决项{index}" for index in range(12)],
        "must_keep": [f"保留要求{index}" for index in range(12)],
        "must_avoid": [f"避免要求{index}" for index in range(12)],
        "creative_decisions": [{"decision_key": f"reserved.choice{index}", "title": f"作者决定{index}",
            "status": "unresolved", "value": f"仍由作者决定的具体结果{index}"} for index in range(80)],
    }
    model_issues = [{"kind": "causality", "message": f"行动后果问题{index}"} for index in range(32)]
    adapter.output = {"text": "她为保护证人调查记录，尚未决定的结果继续保持开放。",
        "review": {"status": "draft", "issues": model_issues}}
    original = deepcopy(payload)
    response = client.post(url, json=payload)
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert len(result["review"]["issues"]) == 124
    assert result["review"]["issues"][:32] == model_issues
    assert "作者决定79" in result["review"]["issues"][-1]["message"]
    brief = payload["current_brief"]
    notes = [*(f"待作者决定：{item}" for item in brief["unresolved"]),
             *(f"作者要求保留：{item}" for item in brief["must_keep"]),
             *(f"作者要求避免：{item}" for item in brief["must_avoid"]),
             *(item["message"] for item in result["review"]["issues"])]
    handoff = StoryBibleDraftRequest(story_project_id=payload["story_project_id"],
        generation_strategy_id=payload["generation_strategy_id"], confirmed_synopsis=result["text"],
        synopsis_review_notes=notes)
    assert len(handoff.synopsis_review_notes) == 160
    assert handoff.synopsis_review_notes == notes
    assert payload == original


@pytest.mark.parametrize("brief", [
    {"unresolved": ["字" * (3001 - len("待作者决定："))]},
    {"must_keep": ["字" * (3001 - len("作者要求保留："))]},
    {"must_avoid": ["字" * (3001 - len("作者要求避免："))]},
    {"must_keep": ["😀" * 1500]},
    {"creative_decisions": [{"decision_key": "reserved.ending", "title": "结局保留", "status": "unresolved", "value": "😀" * 1500}]},
])
def test_overlong_author_boundary_is_not_trimmed_or_sent_to_model(synopsis_client, brief):
    client, url, payload, adapter = synopsis_client
    payload.update({"current_text": "作者当前应保留的梗概。", "current_brief": brief})
    original = deepcopy(payload)
    response = client.post(url, json=payload)
    assert response.status_code == 422, response.text
    assert "已有正文和对话已保留" in response.json()["detail"]
    assert "本次未调用模型" in response.json()["detail"]
    assert adapter.calls == []
    assert payload == original


def test_exact_note_length_limit_preserves_author_boundary_and_model_message(synopsis_client):
    client, url, payload, adapter = synopsis_client
    boundary = "字" * (3000 - len("作者要求保留："))
    message = "😀" * 1500  # 3000 UTF-16 units, matching the browser contract.
    payload["current_brief"] = {"must_keep": [boundary]}
    adapter.output = {"text": "作者要求保留，当前稿仍可编辑。", "review": {
        "status": "draft", "issues": [{"kind": "causality", "message": message}],
    }}
    response = client.post(url, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["review"]["issues"][0]["message"] == message
    assert payload["current_brief"]["must_keep"] == [boundary]


@pytest.mark.parametrize("issues", [
    [{"kind": "causality", "message": f"具体问题{index}"} for index in range(33)],
    [{"kind": "causality", "message": "字" * 3001}],
    [{"kind": "causality", "message": "😀" * 1501}],
])
def test_over_budget_model_review_fails_instead_of_silently_losing_notes(synopsis_client, issues):
    client, url, payload, adapter = synopsis_client
    adapter.output = {"text": "完整生成文字仍不能掩盖交接失败。", "review": {"status": "draft", "issues": issues}}
    response = client.post(url, json=payload)
    assert response.status_code == 422, response.text
    assert "已有正文和对话已保留" in response.json()["detail"]
    assert len(adapter.calls) == 1
    assert "data" not in response.json()


@pytest.mark.parametrize("synopsis_client", ["inspiration"], indirect=True)
def test_current_synopsis_entire_tail_reaches_inspiration_and_supersedes_earlier_source(synopsis_client):
    from test_input_source_handoff import SOURCE

    client, url, payload, adapter = synopsis_client
    manuscript = "目前主角：送货员独自追查账本。\n" + "作者保留的细节。" * 1400 + "当前尾声：证人存活，告别城市。"
    inspiration = StoryInspirationChatRequest(story_project_id=payload["story_project_id"],
        content_spec_id=payload["content_spec_id"], generation_strategy_id=payload["generation_strategy_id"],
        creative_prompt=SOURCE, current_synopsis=manuscript, user_message="可以生成总纲")
    adapter.output = {"assistant_message": "可以依据当前梗概继续。", "questions": [],
        "brief_patch": {}, "ready_to_generate": True}
    response = client.post(url.replace("synopsis-draft", "inspiration-chat"), json=inspiration.model_dump(mode="json"))
    assert response.status_code == 200, response.text
    prompt = adapter.calls[0][0]
    assert manuscript in prompt
    assert "优先于旧输入、旧brief与参考资料" in prompt
    assert inspiration.current_synopsis == manuscript
    seeded = _seed_story_inspiration_source(inspiration)
    assert "阿莱" not in seeded.current_brief.protagonist_and_goal
    assert "共同保护城市" not in seeded.current_brief.ending_direction


def test_candidate_prompt_also_preserves_complete_current_synopsis():
    from test_grill_candidate_refresh import request

    manuscript = "作者手改当前正文。" * 1400 + "候选必须尊重的尾声：两人保持合作。"
    payload = request().model_copy(update={"current_synopsis": manuscript})
    prompt = StoryPlanningService._build_story_inspiration_candidate_prompt(
        payload=payload, project_title="当前故事", content_spec=build_content_spec(),
    )
    assert manuscript in prompt
    assert "优先于旧输入、旧brief与参考资料" in prompt


def test_inspiration_current_synopsis_is_optional_but_rejects_more_than_20000_characters():
    minimal = {"story_project_id": "project.synopsis", "generation_strategy_id": "strategy.synopsis"}
    assert StoryInspirationChatRequest(**minimal).current_synopsis == ""
    assert len(StoryInspirationChatRequest(**minimal, current_synopsis="字" * 20_000).current_synopsis) == 20_000
    with pytest.raises(ValidationError):
        StoryInspirationChatRequest(**minimal, current_synopsis="字" * 20_001)
