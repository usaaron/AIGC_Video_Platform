from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.modules.master_script.models import LLMGeneratedDraftMasterScript
from app.modules.script_engine import draft_contract
from app.modules.script_engine.generation_service import InvalidDraftMasterScriptOutputError, ScriptGenerationService
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration
from tests.test_script_generation_service import _mainland_single_scene_payload, seed_dependencies


def _source(allocation=(27,), *, action_count=18):
    source = ScriptGenerationService._normalize_mechanical_draft_contract(
        _mainland_single_scene_payload(action="林夏打开证物箱，取出记录。")
    )
    source = LLMGeneratedDraftMasterScript.model_validate(
        draft_contract.without_metadata(source)
    ).model_dump(mode="json")
    template = source["scenes"][0]
    source["target_duration_seconds"] = 90
    source["scenes"] = []
    for index, dialogue_count in enumerate(allocation):
        scene = deepcopy(template)
        scene["scene_number"] = index + 1
        if index:
            scene["scene_causality"].update({
                "caused_by_scene_number": index,
                "causal_link": "上一场找到记录，因此接着核对日期。",
            })
        count = action_count // len(allocation)
        if index == 0:
            count += action_count % len(allocation)
        scene["character_actions"] = [
            f"林夏翻开第{number + 1}页记录，手指按住日期。"
            for number in range(count)
        ]
        scene["dialogues"] = [
            {
                **deepcopy(template["dialogues"][0]),
                "text": "这份记录的原件一直锁在证物箱里，你先把钥匙交给我再说明是谁改过日期。",
            }
            for _ in range(dialogue_count)
        ]
        _order(scene)
        source["scenes"].append(scene)
    source = ScriptGenerationService._normalize_mainland_scene_slugs(source)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        draft_contract.without_metadata(source)
    )
    assert estimate_screenplay_duration(validated).total_seconds > 115
    return source


def _order(scene):
    scene["body_order"] = [
        *(f"action:{index}" for index in range(len(scene["character_actions"]))),
        *(f"dialogue:{index}" for index in range(len(scene["dialogues"]))),
    ]


def _patch(source, allocation):
    template = source["scenes"][0]["dialogues"][0]
    scenes = []
    for scene, count in zip(source["scenes"], allocation, strict=True):
        patch = {
            "scene_number": scene["scene_number"],
            "character_actions": list(scene["character_actions"]),
            "dialogues": [
                {**deepcopy(template), "text": "把钥匙交给我，到底是谁改过日期？"}
                for _ in range(count)
            ],
        }
        _order(patch)
        scenes.append(patch)
    return {"scenes": scenes}


def _repair(source, patch, *, target_characters=None, verify_production=True):
    service, _ = seed_dependencies()
    strategy = service._generation_strategy_repository.get("strategy.tiktok.service_generation.v1")
    calls = []

    def generate(prompt, **kwargs):
        calls.append((prompt, kwargs))
        return deepcopy(patch)

    def no_extra_call(*args, **kwargs):
        pytest.fail("A dialogue-allocation rejection must preserve the valid draft without another model call")

    service._repair_llm_adapter = SimpleNamespace(generate_structured_output_stream=generate)
    service._contract_fallback_llm_adapter = SimpleNamespace(generate_structured_output=no_extra_call)
    service._production_count_llm_adapter = SimpleNamespace(generate_structured_output=no_extra_call)
    result = service._ensure_mainland_draft_acceptance(
        original_prompt="生成中国大陆漫剧正文。",
        output=deepcopy(source),
        strategy=strategy,
        target_characters=target_characters,
        target_duration_seconds=90,
    )
    assert len(calls) == 1
    if not verify_production:
        return result, calls[0][0]
    # Accepted candidates already meeting counts and runtime need no extra call.
    verified = service._ensure_episode_production_counts(
        output=result,
        strategy=strategy,
        progress_callback=None,
    )
    return verified, calls[0][0]


@pytest.mark.parametrize(
    ("original_allocation", "candidate_allocation", "diagnostic"),
    [
        ((27,), (25,), "27 -> 25"),
        ((27, 0), (27, 1), "0 -> 1"),
        ((14, 13), (15, 12), "14 -> 15"),
    ],
)
def test_duration_patch_cannot_reduce_or_redistribute_valid_dialogue(
    original_allocation, candidate_allocation, diagnostic
):
    source = _source(original_allocation)
    before = deepcopy(source)
    result, prompt = _repair(source, _patch(source, candidate_allocation), verify_production=False)

    assert draft_contract.without_metadata(result) == draft_contract.without_metadata(before)
    assert source == before
    assert result["_meta"]["postprocess_failure_preserved_valid_draft"] is True
    assert result["_meta"]["deferred_postprocess_phases"] == ["acceptance_repair"]
    assert diagnostic in result["_meta"]["deferred_postprocess_diagnostics"][0]
    assert result["_meta"]["duration_warning"] is True
    assert sum(len(scene["dialogues"]) for scene in result["scenes"]) == 27
    assert "不得把合法总数向25条下限压缩" in prompt
    assert "删除重复动作、解释性台词" not in prompt

    # Keeping a recoverable draft does not approve its overlong runtime for
    # delivery. The final production gate must still repair it or reject it.
    service, _ = seed_dependencies()
    strategy = service._generation_strategy_repository.get("strategy.tiktok.service_generation.v1")
    count_calls = []
    unchanged_patch = {"scenes": [
        {key: deepcopy(scene[key]) for key in ("scene_number", "character_actions", "dialogues", "body_order")}
        for scene in result["scenes"]
    ]}

    def unchanged_count_repair(*args, **kwargs):
        count_calls.append(kwargs)
        return deepcopy(unchanged_patch)

    service._production_count_llm_adapter = SimpleNamespace(generate_structured_output_stream=unchanged_count_repair)
    preserved = deepcopy(result)
    with pytest.raises(InvalidDraftMasterScriptOutputError, match="时长"):
        service._ensure_episode_production_counts(output=result, strategy=strategy)
    assert len(count_calls) == 2
    assert result == preserved


@pytest.mark.parametrize("allocation", [(27,), (27, 0)])
def test_duration_patch_accepts_shorter_lines_with_same_per_scene_counts(allocation):
    source = _source(allocation)
    patch = _patch(source, allocation)
    result, prompt = _repair(source, patch)

    assert [len(scene["dialogues"]) for scene in result["scenes"]] == list(allocation)
    assert result["scenes"][0]["dialogues"] == patch["scenes"][0]["dialogues"]
    assert result["scenes"][0]["dialogues"] != source["scenes"][0]["dialogues"]
    assert result["_meta"]["mainland_acceptance_repaired"] is True
    assert result["_meta"]["mainland_acceptance_model_pass_count"] == 1
    assert "postprocess_failure_preserved_valid_draft" not in result["_meta"]
    assert 75 <= result["_meta"]["estimated_duration_seconds"] <= 115
    assert result["_meta"]["episode_dialogue_line_count"] == 27
    assert "第1场27轮" in prompt
    if len(allocation) > 1:
        assert "第2场0轮" in prompt


@pytest.mark.parametrize("original_count", [24, 36])
def test_original_illegal_global_counts_still_receive_existing_count_repair(original_count):
    # A single scene permits at most 35 lines; use two scenes for an oversized episode.
    allocation = (12, 24) if original_count == 36 else (24,)
    corrected = (12, 13) if original_count == 36 else (25,)
    source = _source(allocation)
    result, prompt = _repair(source, _patch(source, corrected))

    assert sum(len(scene["dialogues"]) for scene in result["scenes"]) == 25
    assert result["_meta"]["mainland_acceptance_repaired"] is True
    assert "postprocess_failure_preserved_valid_draft" not in result["_meta"]
    assert "production_counts" in result["_meta"]["mainland_acceptance_repair_reasons"]
    assert "不得把合法总数向25条下限压缩" not in prompt


def test_full_acceptance_prompt_also_preserves_valid_dialogue_allocation():
    source = LLMGeneratedDraftMasterScript.model_validate(
        draft_contract.without_metadata(_source((27, 0)))
    )
    prompt = ScriptGenerationService._build_mainland_acceptance_repair_prompt(
        original_prompt="生成中国大陆漫剧正文。",
        output=source,
        language_issues=["scenes.0.dialogues.0.text"],
        screenplay_issues=[],
        actual_characters=1000,
        guidance=None,
        scene_characters=[900, 100],
        duration_estimate=estimate_screenplay_duration(source),
        duration_issue=True,
        scene_count=2,
        dialogue_count=27,
        shot_count=18,
    )
    assert "第1场27轮、第2场0轮" in prompt
    assert "不得把合法总数向25条下限压缩" in prompt
    assert "不得跨场挪动对白或向原静默场添加对白" in prompt
