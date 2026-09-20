"""Language repair cannot replace an already valid bilingual episode contract."""
from copy import deepcopy

import pytest

from app.modules import agent_runtime  # noqa: F401
from app.modules.script_engine.long_story_models import EpisodePlanBatchGenerationOutput
from app.modules.script_engine.story_planning_service import StoryPlanningInputError
from tests.test_story_planning_service import (
    FixedStoryBibleAdapter, build_active_lineage_episode_item,
    build_episode_dramatic_design, build_episode_item_generation_service, build_strategy,
)


def source_batch():
    item = {**build_active_lineage_episode_item(), **build_episode_dramatic_design()}
    item["episode_title"] = "THE SEALED LETTER｜封存的原件"
    item["central_conflict"] = "The rival locks the witness inside the archive."
    item["dramatic_units"][0]["evidence_hint"] = "The witness points to the signed receipt."
    return EpisodePlanBatchGenerationOutput.model_validate({"episode_plans": [item]})


class LanguageAdapter(FixedStoryBibleAdapter):
    def __init__(self, response):
        self.response = response
        self.calls = 0

    def generate_structured_output(self, prompt, *, strategy, output_schema):
        self.calls += 1
        assert "Change only those listed narrative values" in prompt
        return deepcopy(self.response)


def repair(output, response):
    adapter = LanguageAdapter(response)
    service, _ = build_episode_item_generation_service(adapter)
    result = service._ensure_mainland_planning_language(
        original_prompt="正文规划叙述采用中文，保留英文角色名与英文短标题。",
        output=output, strategy=build_strategy(),
        output_model=EpisodePlanBatchGenerationOutput,
        artifact_name="Episode roadmap resumable chunk",
    )
    assert adapter.calls == 1
    return result


def valid_language_response(output):
    result = output.model_dump(mode="json")
    item = result["episode_plans"][0]
    item["central_conflict"] = "对手把证人锁在档案室里，主角必须设法让证人安全离开。"
    item["dramatic_units"][0]["evidence_hint"] = "证人指着有签名的收据，让保管员核对来源。"
    return result


@pytest.mark.parametrize("bad_title", [
    {"chinese": "封存的原件", "english": "中文误入英文标题"},
    {"chinese": "封存的原件", "english": "CHANGED—TITLE"},
    None,
])
def test_language_repair_keeps_title_and_all_unreported_fields(bad_title):
    output = source_batch()
    original = output.model_dump(mode="json")
    response = valid_language_response(output)
    item = response["episode_plans"][0]
    item.update(episode_title=bad_title, target_duration_seconds=1,
                character_refs=["character.wrong"], source_unit_story_beats=["未授权的新事件。"],
                scene_execution_plan=[], synopsis="试图替换已正确的中文梗概。")
    item["dramatic_units"][0]["trigger"] = "未报告字段的改写不得进入原稿。"
    expected = valid_language_response(output)
    result = repair(output, response)
    assert result.model_dump(mode="json") == expected
    assert output.model_dump(mode="json") == original


@pytest.mark.parametrize("failure", ["episode_identity", "missing_field", "still_english", "nested_structure"])
def test_language_repair_rejects_bad_requested_fields_without_mutating_source(failure):
    output = source_batch()
    before = output.model_dump(mode="json")
    response = valid_language_response(output)
    item = response["episode_plans"][0]
    if failure == "episode_identity":
        item["episode_number"] = 2
    elif failure == "missing_field":
        item.pop("central_conflict")
    elif failure == "still_english":
        item["central_conflict"] = "The rival still locks the witness inside."
    else:
        item["dramatic_units"] = []
    with pytest.raises(StoryPlanningInputError):
        repair(output, response)
    assert output.model_dump(mode="json") == before
