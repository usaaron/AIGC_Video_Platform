import pytest

from app.modules.input_readiness.source_evidence import SourceDocument, extract_source_facts


@pytest.mark.parametrize("opening", [
    "顾沉舟开局不知道谁伪造了付款单，也不知道最终责任人。",
    "主角最初不知最终真相。",
    "记者开场尚未查明最终责任人。",
])
def test_opening_knowledge_does_not_replace_the_actual_ending(opening):
    ending = "最终两人交出原始材料，姐姐的死亡获得正式复查。"
    facts = extract_source_facts([SourceDocument("creative_prompt", "创作输入", ending + opening)])
    assert [fact.quote for fact in facts if fact.field == "ending_direction"] == [ending]


def test_opening_unknown_without_a_resolution_does_not_invent_an_ending():
    facts = extract_source_facts([SourceDocument(
        "creative_prompt", "创作输入", "顾沉舟开局不知道谁伪造了付款单，也不知道最终责任人。",
    )])
    assert not any(fact.field == "ending_direction" for fact in facts)


def test_opening_and_final_resolution_in_one_sentence_remain_extractable():
    source = "主角起初不知道最终责任人，最终发现伪造者是档案主管并移交原始材料。"
    facts = extract_source_facts([SourceDocument("creative_prompt", "创作输入", source)])
    assert [fact.quote for fact in facts if fact.field == "ending_direction"] == [source]
