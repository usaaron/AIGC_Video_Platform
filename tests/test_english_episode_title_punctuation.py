from pydantic import ValidationError
import pytest

from app.modules.script_engine.episode_plan_contracts import episode_title_quality_issues
from app.modules.script_engine.planning_wire_contract import expand_episode_title


@pytest.mark.parametrize("english", ["DELETION, NOT FULL BLAME", "WHY? BECAUSE: MR. LU; NO!"])
def test_english_episode_title_allows_normal_title_punctuation_end_to_end(english):
    value = {"episode_title": {"chinese": "压证追问", "english": english}}
    assert expand_episode_title(value)["episode_title"] == english + "｜压证追问"
    assert episode_title_quality_issues(value["episode_title"]["english"] + "｜压证追问") == []


def test_english_episode_title_still_rejects_chinese_text():
    with pytest.raises(ValidationError):
        expand_episode_title({"episode_title": {"chinese": "压证追问", "english": "删除, NOT BLAME"}})
    assert "english_format" in episode_title_quality_issues("删除, NOT BLAME｜压证追问")
