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
    assert result.coverage.script > 0.4
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
    payload = CreativeInputReadinessRequest(
        creative_prompt="一个记者发现家族秘密，并决定追查真相。",
        episode_count=30,
    )
    result = CreativeInputReadinessService(
        StubLLMAdapter(RuntimeError("gateway unavailable"))
    ).analyze(payload)

    assert result.detected_level == InputReadinessLevel.premise
    assert result.analysis_method == InputReadinessAnalysisMethod.heuristic


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
