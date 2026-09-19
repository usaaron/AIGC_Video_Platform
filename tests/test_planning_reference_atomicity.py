import copy
import json

import pytest

from app.modules.script_engine.long_story_models import (
    EpisodePlanBatchGenerationOutput,
    StoryPlanNodeChildOutput,
    StoryPlanNodeDecompositionOutput,
    StoryPlanNodeGenerationOutput,
)
from app.modules.script_engine.story_planning_service import (
    normalize_episode_plan_generation_item,
    planning_payload_for_validation,
)


NOAH_REFERENCE = (
    "诺亚两年前缺席的真正原因是临场怯场；他不再用“那段编曲不适合我”掩盖，"
    "成为关系修复的关键。"
)
ENGLISH_REFERENCE = (
    'Noah missed the show because of stage fright; he stops saying "the arrangement '
    'was wrong for me", and takes responsibility.'
)
MIXED_REFERENCE = "Noah 向 Lena 承认：不是编曲不合适，而是自己怯场；Lena 仍保留拒绝权。"


def normalize_through(path: str, reference_value: object) -> dict:
    payload = {
        "episode_number": 3,
        "episode_goal": "诺亚说出缺席真相",
        "entry_state": "莉娜仍以为是编曲争执",
        "central_conflict": "诺亚必须承担当年的选择",
        "protagonist_decision": "他决定正面承认怯场",
        "exit_state": "莉娜知道真相但保留自己的判断",
        "setup_refs": copy.deepcopy(reference_value),
        "payoff_refs": copy.deepcopy(reference_value),
        "character_refs": "character.noah，character.lena; character.june",
        "story_line_refs": ["storyline.main; sl_relationship", {"ref": "sl_accountability"}],
    }
    return normalize_payload(path, payload)


def normalize_payload(path: str, payload: dict) -> dict:
    if path == "top_node":
        return planning_payload_for_validation(payload, StoryPlanNodeGenerationOutput)
    if path == "child_node":
        return planning_payload_for_validation(payload, StoryPlanNodeChildOutput)
    if path == "decomposition":
        return planning_payload_for_validation(
            {"children": [payload]}, StoryPlanNodeDecompositionOutput
        )["children"][0]
    if path == "episode_batch":
        return planning_payload_for_validation(
            {"episode_plans": [payload]}, EpisodePlanBatchGenerationOutput
        )["episode_plans"][0]
    assert path == "episode_single"
    return normalize_episode_plan_generation_item(payload, expected_episode_number=3)


PATHS = ["top_node", "child_node", "decomposition", "episode_batch", "episode_single"]


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ([NOAH_REFERENCE], [NOAH_REFERENCE]),
        (NOAH_REFERENCE, [NOAH_REFERENCE]),
        (ENGLISH_REFERENCE, [ENGLISH_REFERENCE]),
        (MIXED_REFERENCE, [MIXED_REFERENCE]),
        ([NOAH_REFERENCE, ENGLISH_REFERENCE, MIXED_REFERENCE],
         [NOAH_REFERENCE, ENGLISH_REFERENCE, MIXED_REFERENCE]),
        (json.dumps([NOAH_REFERENCE, ENGLISH_REFERENCE], ensure_ascii=False),
         [NOAH_REFERENCE, ENGLISH_REFERENCE]),
        ([{"ref": NOAH_REFERENCE}, {"setup_id": ENGLISH_REFERENCE}, {"payoff_id": MIXED_REFERENCE}],
         [NOAH_REFERENCE, ENGLISH_REFERENCE, MIXED_REFERENCE]),
        (json.dumps([{"ref": NOAH_REFERENCE}, {"id": "setup.stage_fright"}], ensure_ascii=False),
         [NOAH_REFERENCE, "setup.stage_fright"]),
    ],
)
def test_approved_prose_references_survive_each_real_normalization_path_and_replay(
    path: str, value: object, expected: list[str]
) -> None:
    original = copy.deepcopy(value)
    normalized = normalize_through(path, value)

    assert normalized["setup_refs"] == expected
    assert normalized["payoff_refs"] == expected
    assert normalized["character_refs"] == ["character.noah", "character.lena", "character.june"]
    assert normalized["story_line_refs"] == ["storyline.main", "sl_relationship", "sl_accountability"]
    # A later validator/retry must not turn a previously accepted whole reference
    # into several new identities, including references extracted from dicts.
    assert normalize_payload(path, normalized) == normalized
    assert value == original


@pytest.mark.parametrize("path", PATHS)
def test_only_unambiguously_technical_scalar_refs_keep_delimiter_compatibility(path: str) -> None:
    normalized = normalize_through(path, "setup.stage_fright； payoff.stage_truth,setup_old_letter payoff:promise")
    expected = ["setup.stage_fright", "payoff.stage_truth", "setup_old_letter", "payoff:promise"]
    assert normalized["setup_refs"] == expected
    assert normalized["payoff_refs"] == expected
    assert normalize_payload(path, normalized) == normalized

    # An array has already assigned one identity per element. Even an unusual
    # delimited element is preserved for reference validation, never guessed apart.
    array = ["setup.stage_fright;payoff.stage_truth"]
    assert normalize_through(path, array)["setup_refs"] == array


@pytest.mark.parametrize("path", PATHS)
def test_mixed_id_and_prose_scalar_is_not_split_into_claimed_reference_identities(path: str) -> None:
    for text in [
        "setup.stage_fright; Noah admits why he missed the show.",
        "setup.stage_fright；诺亚承认怯场，莉娜保留判断。",
        "Noah; Lena, June Sam",
    ]:
        normalized = normalize_through(path, text)
        assert normalized["setup_refs"] == [text]
        assert normalized["payoff_refs"] == [text]


def test_legacy_aliases_extract_reference_objects_without_losing_complete_prose() -> None:
    normalized = planning_payload_for_validation(
        {"子节点": {
            "伏笔引用": [{"ref": NOAH_REFERENCE, "description": "不能覆盖ref的说明"}],
            "回收引用": [{"value": ENGLISH_REFERENCE}],
            "角色引用": [{"character_ref": "character.noah"}],
            "故事线引用": [{"story_line_id": "sl_main"}],
        }},
        StoryPlanNodeChildOutput,
    )
    assert normalized["setup_refs"] == [NOAH_REFERENCE]
    assert normalized["payoff_refs"] == [ENGLISH_REFERENCE]
    assert normalized["character_refs"] == ["character.noah"]
    assert normalized["story_line_refs"] == ["sl_main"]
