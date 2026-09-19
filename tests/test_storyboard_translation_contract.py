import json

import pytest

from app.modules.master_script.models import LLMGeneratedDraftMasterScript
from app.modules.preproduction.models import SceneProposal
from app.modules.preproduction.production_detail_skill import production_detail_instruction
from app.modules.script_engine.llm_adapter import RealLLMAdapter
from app.modules.script_engine.models import GenerationStrategy
from tests.test_llm_adapter import build_strategy
from tests.test_preproduction import PROJECT, SOURCE, generated, storyboard


def adapter():
    return RealLLMAdapter(provider="openai_compatible", model_name="deepseek-v4-pro",
        api_key="test-only-key", base_url="https://example.test/v1", reasoning_effort="high",
        thinking_mode="enabled", timeout_seconds=600, max_retries=0)


def test_actual_storyboard_service_selects_translation_and_the_real_single_scene_root(storyboard):
    service, captured, _, _ = storyboard
    plan = generated(service)
    schema = captured.last_schema
    assert schema == SceneProposal.model_json_schema()
    assert schema["title"] == "SceneProposal"
    assert set(schema["properties"]) == {"design", "shots", "unresolved_questions"}
    prompt = captured.last_prompt
    assert "只把已写好的本场正文转译为摄影与表演" in prompt
    assert "不要求每一拍新增信息、关系或主动权变化" in prompt
    assert "每条正文引用仍须恰好覆盖一次且保持原顺序" in prompt
    assert "每个节拍都要有目标、阻力、策略变化和结果，至少" not in prompt
    assert "连续推拉物件、移开视线、攥手和停顿若没有新结果，就合并或删去" not in prompt
    assert "逐镜核对引用台词的口播时间" in prompt
    assert "为每个镜头填写 acting_direction" in prompt
    context = json.loads(prompt.splitlines()[-1])
    assert context["scene"]["body_order"] == SOURCE["scenes"][0]["body_order"]
    assert [ref for shot in plan.scenes[0].shots for ref in shot.source_refs] == SOURCE["scenes"][0]["body_order"]
    wire = adapter()._build_chat_payload(prompt=prompt,
        strategy=GenerationStrategy.model_validate(build_strategy()), output_schema=schema)
    contract = wire["messages"][1]["content"]
    assert "one single-scene storyboard proposal" in contract
    assert "not one shot, one design field, or an array item" in contract
    assert "Do not add an episode or scenes wrapper" in contract
    assert "never one scene" not in contract
    assert wire["thinking"] == {"type": "enabled"}
    assert wire["reasoning_effort"] == "high"
    assert wire["max_tokens"] == build_strategy()["max_tokens"]


@pytest.mark.parametrize("schema", [LLMGeneratedDraftMasterScript.model_json_schema(),
    {"title": "SceneProposal", "type": "object", "properties": {"scenes": {"type": "array"}}, "required": ["scenes"]},
    {"title": "NotSceneProposal", "type": "object", "properties": {"design": {}, "shots": {}, "unresolved_questions": {}}, "required": ["design", "shots"]}])
def test_episode_and_other_roots_retain_the_complete_root_contract(schema):
    contract = adapter()._prompt_with_json_contract("整集或其他结构化任务", output_schema=schema)
    assert "never one scene, character, state update, episode, dialogue, child, or array item" in contract
    assert "one single-scene storyboard proposal" not in contract
    assert "Required top-level root fields:" in contract


def test_default_production_detail_mode_keeps_existing_authoring_requirements():
    normal = production_detail_instruction()
    assert normal == production_detail_instruction(storyboard_translation=False)
    assert "每个节拍都要有目标、阻力、策略变化和结果，至少" in normal
    assert "动作必须改变接触机会、物证控制、彼此距离或决策压力" in normal
    assert "本任务只把已写好的本场正文转译" not in normal
