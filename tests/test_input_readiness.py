from __future__ import annotations

from typing import Any, Sequence

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.modules.input_readiness.models import (
    CreativeInputReadinessRequest,
    InputReadinessAnalysisMethod,
    InputReadinessLevel,
    RecommendedWorkflowStage,
)
from app.modules.input_readiness.service import CreativeInputReadinessService
from app.modules.script_engine.llm_adapter import LLMAdapter
from app.modules.script_engine.models import GenerationStrategy, LLMModelInfo


def readiness_request(
    text: str,
    *,
    episode_count: int = 3,
) -> CreativeInputReadinessRequest:
    return CreativeInputReadinessRequest.model_validate(
        {
            "creative_prompt": "",
            "reference_materials": [
                {
                    "file_name": "创作资料.txt",
                    "purpose": "story_reference",
                    "purpose_note": "",
                    "extracted_text": text,
                }
            ],
            "episode_count": episode_count,
        }
    )


def test_short_synopsis_keeps_the_existing_story_bible_entry_path() -> None:
    result = CreativeInputReadinessService().analyze(
        CreativeInputReadinessRequest(
            creative_prompt="调查记者发现未婚夫隐瞒矿难真相，她必须在复仇和保护证人之间选择。",
            episode_count=60,
        )
    )

    assert result.detected_level == InputReadinessLevel.premise
    assert result.recommended_stage == RecommendedWorkflowStage.story_bible
    assert result.requires_user_confirmation is True
    assert result.analysis_method == InputReadinessAnalysisMethod.heuristic


def test_complete_story_bible_recommends_planning() -> None:
    result = CreativeInputReadinessService().analyze(
        readiness_request(
            """故事梗概：记者苏晚调查矿难，发现未婚夫家族掩盖真相。
主题：真相与亲密关系中的责任。
主要人物：苏晚是调查记者；顾沉舟是利益继承人也是关键证人。
世界观：当代工业城市，商会控制地方媒体和运输记录。
核心冲突：苏晚必须公开证据，但公开会让证人陷入危险。
故事结构：第一幕获得残缺货单；第二幕追查责任链；第三幕公开听证。
人物弧光：苏晚从拒绝信任任何人，到学会在承担代价的前提下合作。
主线：追查矿难责任链。副线：苏晚与顾沉舟重建有限信任。
最终结局：幕后责任人被公开审判，苏晚保住证人但失去原有关系。""",
            episode_count=60,
        )
    )

    assert result.detected_level == InputReadinessLevel.story_bible
    assert result.recommended_stage == RecommendedWorkflowStage.planning
    assert result.coverage.story_bible >= 0.7
    assert any("总纲结构信号" in item for item in result.evidence)


def test_complete_episode_plan_recommends_script() -> None:
    result = CreativeInputReadinessService().analyze(
        readiness_request(
            """第1集 货单失踪
本集目标：苏晚取得原始货单。中心冲突：保安封锁仓库。
主角决定：公开留下进入记录。本集结果：她取得货单残页。结尾钩子：残页有未婚夫签名。

第2集 假证人
本集目标：核实签名。中心冲突：证人临时翻供。
主角决定：保护证人家属。本集结果：获得录音。结尾钩子：录音指向商会。

第3集 听证会
本集目标：提交完整证据。中心冲突：商会制造替罪者。
主角决定：承担职业风险直播听证。本集结果：责任链公开。结尾钩子：旧案出现新编号。""",
            episode_count=3,
        )
    )

    assert result.detected_level == InputReadinessLevel.episode_plan
    assert result.recommended_stage == RecommendedWorkflowStage.script
    assert result.coverage.episode_plan >= 0.78


def test_partial_episode_plan_stays_in_planning_and_reports_the_gap() -> None:
    result = CreativeInputReadinessService().analyze(
        readiness_request(
            """第1集 货单失踪
本集目标：取得货单。中心冲突：仓库被封锁。本集结果：取得残页。结尾钩子：出现签名。
第2集 假证人
本集目标：核实签名。中心冲突：证人翻供。本集结果：获得录音。结尾钩子：录音被截断。""",
            episode_count=20,
        )
    )

    assert result.detected_level == InputReadinessLevel.episode_plan
    assert result.recommended_stage == RecommendedWorkflowStage.planning
    assert any("目标为 20 集" in item for item in result.missing_items)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("第1集\n第3集", 3),
        ("第01—33集", 33),
        ("E01–E52", 52),
        ("第一集\n第二集\n第十集", 10),
        ("全剧共50集", 50),
    ],
)
def test_detected_episode_count_uses_the_planning_boundary(
    text: str,
    expected: int,
) -> None:
    result = CreativeInputReadinessService().analyze(
        readiness_request(text, episode_count=80)
    )

    assert result.detected_episode_count == expected


def test_declared_episode_range_does_not_fabricate_supplied_episode_coverage() -> None:
    result = CreativeInputReadinessService().analyze(
        readiness_request("第01—33集\n## EP34–EP52", episode_count=52)
    )

    assert result.detected_episode_count == 52
    assert result.evidence == ["检测到资料声明的计划集数为 52 集。"]
    assert result.detected_level == InputReadinessLevel.premise


def test_screenplay_structure_is_detected_as_script() -> None:
    result = CreativeInputReadinessService().analyze(
        readiness_request(
            """第1集 货单
场景一 仓库 夜 内
动作：苏晚躲进货架背后，门外脚步逼近。
苏晚：货单一定还在这里。
顾沉舟：你再往前一步，他们就会发现你。
苏晚：那你为什么还来？
场景二 走廊 夜 内
保安：把所有出口锁上。
苏晚：我已经拍下证据了。
顾沉舟：先活着出去，再谈公开。
""",
            episode_count=10,
        )
    )

    assert result.detected_level == InputReadinessLevel.script
    assert result.recommended_stage == RecommendedWorkflowStage.script
    assert result.coverage.script == 0.1
    assert result.structurally_complete is False
    assert any("目标为 10 集" in item for item in result.missing_items)


def test_scene_plan_labels_are_not_mistaken_for_character_dialogue() -> None:
    result = CreativeInputReadinessService().analyze(
        readiness_request(
            """第1集 货单
场景一：仓库夜内
本集目标：取得货单。
中心冲突：仓库被封锁。
主角决定：留下进入记录。
本集结果：取得货单残页。
结尾钩子：残页出现未婚夫签名。
第2集 假证人
场景一：听证室日内
本集目标：核实签名。
中心冲突：证人翻供。
主角决定：保护证人家属。
本集结果：获得录音。
结尾钩子：录音被人截断。""",
            episode_count=10,
        )
    )

    assert result.detected_level == InputReadinessLevel.episode_plan
    assert result.recommended_stage == RecommendedWorkflowStage.planning


def test_source_character_bios_and_props_are_facts_not_dialogue() -> None:
    text = """故事背景：虚构的旧时代城市，工会控制着港口。
角色介绍：
Alex（阿莱克）：43岁，前律师，决定保护无辜的送货员。
标志性道具：一件旧律师服和一把施工锤。
行为准则：他只惩罚真正伤害他人的人。

Morgan（摩根）：前演员，失去伙伴后开始报复商会。
标志性道具：一架破损的竖琴。
行为准则：拒绝攻击穷苦的人。

大致剧情：两人因商会的送货员发生冲突，后来共同对抗压迫者。最终两人保留各自原则，并共同保护这座城市。"""
    result = CreativeInputReadinessService().analyze(readiness_request(text, episode_count=60))
    assert not any("对白" in item for item in result.evidence)
    assert not any("明确主角及其身份" in item for item in result.missing_items)
    assert {"protagonist_and_goal", "world_setting", "ending_direction", "relationship_direction"}.issubset({fact.field for fact in result.known_facts})
    character_quotes = [fact.quote for fact in result.known_facts if fact.field == "protagonist_and_goal"]
    assert any("Alex" in quote for quote in character_quotes)
    assert any("Morgan" in quote for quote in character_quotes)
    for fact in result.known_facts:
        assert text[fact.start:fact.end] == fact.quote
        assert fact.source_id == "reference_1"
    assert result.estimated_supported_characters == 0
    assert result.recommended_target_total_characters is None
    assert result.capacity_status.value == "not_estimated"


@pytest.mark.parametrize("placeholder", ["", "待补充", "TBD", "暂无", "……"])
def test_empty_bible_template_cannot_claim_completed_content(placeholder: str) -> None:
    text = "\n".join(f"{heading}：{placeholder}" for heading in
                     ("故事梗概", "主题", "主要人物", "世界观", "核心冲突", "故事结构", "人物弧光", "主线", "最终结局"))
    result = CreativeInputReadinessService().analyze(readiness_request(text, episode_count=8))
    assert result.detected_level == InputReadinessLevel.premise
    assert not result.structurally_complete
    assert result.known_facts == []


def test_episode_audit_requires_content_in_each_numbered_row() -> None:
    text = "第1集\n本集目标：取得证据。开场：走进仓库。中心冲突：仓库被封锁。主角决定：继续调查。本集结果：拿到证据。结尾钩子：证据被调包。场景规划：仓库。\n"
    text += "\n".join(f"第{i}集 待补充" for i in range(2, 9))
    result = CreativeInputReadinessService().analyze(readiness_request(text, episode_count=8))
    assert result.detected_level == InputReadinessLevel.episode_plan
    assert result.coverage.episode_plan == 0.125
    assert result.recommended_stage == RecommendedWorkflowStage.planning
    assert result.episode_audit.complete_plan_numbers == [1]
    assert result.episode_audit.incomplete_numbers == list(range(2, 9))
    assert not result.structurally_complete


@pytest.mark.parametrize("numbers,missing,duplicates,outside", [
    (range(2, 10), [1], [], [9]),
    ([1, 1, 2, 3, 4, 5, 6, 7, 8], [], [1], []),
])
def test_episode_audit_detects_gaps_duplicate_numbers_and_out_of_range(numbers, missing, duplicates, outside) -> None:
    text = "\n".join(f"## 第{i}集\n本集目标：取得证据。中心冲突：仓库被封锁。本集结果：找到货单。结尾钩子：发现可疑签名。" for i in numbers)
    result = CreativeInputReadinessService().analyze(readiness_request(text, episode_count=8))
    assert result.episode_audit.missing_numbers == missing
    assert result.episode_audit.duplicate_numbers == duplicates
    assert result.episode_audit.out_of_range_numbers == outside
    assert not result.structurally_complete
    assert result.missing_items


def test_unnumbered_script_does_not_claim_complete_series() -> None:
    text = "INT. ROOM - NIGHT\n阿莱：门锁住了。\n小林：钥匙在这里。\n阿莱：有人来了。\n小林：先躲起来。\n阿莱：快离开这里。\n小林：我来断后。\n阿莱：一起走吧。\n小林：好，我们一起。"
    result = CreativeInputReadinessService().analyze(readiness_request(text, episode_count=8))
    assert result.detected_level == InputReadinessLevel.script
    assert result.episode_audit.unnumbered_script
    assert result.coverage.script == 0
    assert not result.structurally_complete
    assert any("分集边界" in item for item in result.missing_items)


def test_empty_episode_titles_still_report_the_numbered_content_gaps() -> None:
    result = CreativeInputReadinessService().analyze(readiness_request("\n".join(f"第{n}集：待补充" for n in range(1, 9)), episode_count=8))
    assert result.detected_level == InputReadinessLevel.premise
    assert result.coverage.episode_plan == 0
    assert any("仅有集号不计为完成" in item for item in result.missing_items)


class StubLLMAdapter(LLMAdapter):
    def __init__(self, output: dict[str, Any] | Exception) -> None:
        self.output = output

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        raise NotImplementedError

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if isinstance(self.output, Exception):
            raise self.output
        return self.output

    def validate_output(
        self,
        output: dict[str, Any],
        *,
        required_keys: Sequence[str] | None = None,
    ) -> bool:
        return True

    def get_model_info(self) -> LLMModelInfo:
        return LLMModelInfo(
            provider="stub",
            model_name="readiness-test",
            supports_structured_output=True,
            max_context_tokens=128_000,
        )


def test_model_failure_uses_deterministic_result() -> None:
    payload = readiness_request("一个记者发现家族秘密，并决定追查真相。", episode_count=30)
    result = CreativeInputReadinessService(
        StubLLMAdapter(RuntimeError("gateway unavailable"))
    ).analyze(payload)

    assert result.detected_level == InputReadinessLevel.premise
    assert result.analysis_method == InputReadinessAnalysisMethod.heuristic
    assert result.analysis_notice


def test_structural_refresh_never_calls_the_model() -> None:
    class MustNotRun(StubLLMAdapter):
        def generate_structured_output(self, *args, **kwargs):
            pytest.fail("Read-only structural refresh called the model")

    payload = readiness_request("主角：记者必须保护证人。\n最终结局：证人安全地离开城市。")
    result = CreativeInputReadinessService(MustNotRun({})).analyze(payload.model_copy(update={"use_model": False}))
    assert result.analysis_method == InputReadinessAnalysisMethod.heuristic
    assert result.known_facts


def test_model_can_downgrade_structure_and_only_exact_source_quotes_are_retained() -> None:
    text = """故事梗概：记者调查旧案，发现家族掩盖真相。
主题：公开真相的代价。
主要人物：记者必须保护重要证人。
世界观：工厂关闭后的工业城市。
核心冲突：商会封锁证人的去路。
故事结构：第一幕取证；第二幕对抗；第三幕听证。
最终结局：证人安全离开城市。"""
    payload = readiness_request(text)
    assert CreativeInputReadinessService().analyze(payload).detected_level == InputReadinessLevel.story_bible
    result = CreativeInputReadinessService(StubLLMAdapter({
        "detected_level": "premise", "confidence": .95,
        "coverage": {"premise": .8, "story_bible": .2, "episode_plan": 1, "script": 1},
        "known_facts": [
            {"field": "episode_goal", "source_id": "reference_1", "quote": "记者必须保护重要证人。"},
            {"field": "stakes", "quote": "missing source identifier"},
            {"field": "stakes", "source_id": "reference_1", "quote": "公开真相的代价。"},
            {"field": "ending_direction", "source_id": "reference_1", "quote": "主角成为市长。"},
            {"field": "tone_and_pacing", "source_id": "reference_9", "quote": "公开真相的代价。"},
        ],
    })).analyze(payload)
    assert result.detected_level == InputReadinessLevel.premise
    assert result.analysis_method == InputReadinessAnalysisMethod.model_assisted
    assert result.analysis_notice is None
    assert result.coverage.episode_plan == result.coverage.script == 0
    assert any(fact.field == "stakes" for fact in result.known_facts)
    assert not any(fact.field == "tone_and_pacing" or "市长" in fact.quote for fact in result.known_facts)
    assert all(text[fact.start:fact.end] == fact.quote for fact in result.known_facts)


def test_model_cannot_relabel_supplied_plan_as_premise_or_promote_episode_goal_to_story_fact() -> None:
    text = "第1集\n本集目标：记者取得货单。中心冲突：保安封锁仓库。本集结果：记者取得残页。结尾钩子：残页出现未知签名。\n第2集：待补充"
    result = CreativeInputReadinessService(StubLLMAdapter({
        "detected_level": "premise", "confidence": .95,
        "coverage": {"premise": .8, "story_bible": .2, "episode_plan": .01, "script": 0},
        "known_facts": [{"field": "protagonist_and_goal", "source_id": "reference_1", "quote": "记者取得货单。"}],
    })).analyze(readiness_request(text, episode_count=8))
    assert result.analysis_method == InputReadinessAnalysisMethod.model_assisted
    assert result.detected_level == InputReadinessLevel.episode_plan
    assert result.coverage.episode_plan == .125
    assert result.known_facts == []
    assert not result.structurally_complete


def test_model_cannot_upgrade_unstructured_synopsis_to_script() -> None:
    payload = readiness_request(
        "记者发现未婚夫隐瞒真相，她决定寻找证据。",
        episode_count=30,
    )
    model_output = {
        "detected_level": "script",
        "confidence": 0.99,
        "coverage": {
            "premise": 1.0,
            "story_bible": 1.0,
            "episode_plan": 1.0,
            "script": 1.0,
        },
        "evidence": ["模型声称这是完整剧本。"],
        "missing_items": [],
    }
    result = CreativeInputReadinessService(StubLLMAdapter(model_output)).analyze(payload)

    assert result.detected_level == InputReadinessLevel.premise
    assert result.recommended_stage == RecommendedWorkflowStage.story_bible
    assert result.analysis_method == InputReadinessAnalysisMethod.model_assisted


@pytest.mark.anyio
async def test_input_readiness_api_is_available_before_project_creation() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/input-readiness/analyze",
            json={
                "creative_prompt": "记者发现未婚夫隐瞒矿难真相。",
                "reference_materials": [],
                "episode_count": 60,
            },
        )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["detected_level"] == "premise"
    assert body["recommended_stage"] == "story_bible"
    assert body["requires_user_confirmation"] is True


@pytest.mark.anyio
async def test_input_readiness_api_rejects_an_empty_source() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/input-readiness/analyze",
            json={
                "creative_prompt": "",
                "reference_materials": [],
                "episode_count": 60,
            },
        )

    assert response.status_code == 422
    assert "creative_prompt or reference_materials" in str(response.json()["detail"])


def test_input_readiness_route_is_exported_in_openapi() -> None:
    operations = create_app().openapi()["paths"]
    assert "post" in operations["/input-readiness/analyze"]
