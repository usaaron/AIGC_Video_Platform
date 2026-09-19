"""Keep completed JSON field repairs on the working long-response transport."""

from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.modules.script_engine.llm_adapter import LLMStructuredOutputError
from app.modules.script_engine.long_story_models import (
    StoryPlanNodeChildOutput, StoryPlanNodeDecompositionOutput, StoryPlanNodeGenerationOutput,
)
from app.modules.script_engine.story_planning_service import (
    StoryPlanningInputError, StoryPlanningService,
)
from tests.test_planning_wire_contract import compact_leaf
from tests.test_story_planning_service import build_strategy


class ScriptedTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get_model_info(self):
        return SimpleNamespace(provider="fixed", model_name="fixed-planning-transport")

    def generate_structured_output_stream(self, prompt, *, strategy, output_schema, **_kwargs):
        return self.respond("stream", prompt, strategy, output_schema)

    def generate_structured_output(self, prompt, *, strategy, output_schema):
        return self.respond("non_stream", prompt, strategy, output_schema)

    def respond(self, transport, prompt, strategy, schema):
        self.calls.append((transport, prompt, strategy.max_tokens, deepcopy(schema)))
        assert self.responses, "Repair must not add another model attempt."
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return deepcopy(response)


def service_for(responses):
    adapter = ScriptedTransport(responses)
    service = object.__new__(StoryPlanningService)
    service._llm_adapter = adapter
    service._story_architect_llm_adapter = adapter
    service._story_architect_recovery_llm_adapter = adapter
    return service, adapter


def child_payload():
    return compact_leaf() | {"recommended_next_step": "episode_ready"}


@pytest.mark.parametrize("collection", [False, True])
def test_complete_json_missing_leaf_events_repairs_once_with_stream_and_keeps_full_contract(collection):
    valid = child_payload()
    incomplete = deepcopy(valid)
    incomplete["episode_developments"] = []
    good = {"children": [valid, deepcopy(valid)]} if collection else valid
    bad = {"children": [incomplete, deepcopy(valid)]} if collection else incomplete
    service, adapter = service_for([bad, good])
    output = service._generate_planning_output(
        prompt="已确认事件与完整父级边界必须保留。", strategy=build_strategy(),
        output_model=StoryPlanNodeDecompositionOutput if collection else StoryPlanNodeChildOutput,
        artifact_name="Story Plan Node decomposition node=test" if collection else
                      "Story Plan Node segmented child recovery node=test child=1/2",
    )
    assert [call[0] for call in adapter.calls] == ["stream", "stream"]
    assert "episode_developments must cover the leaf exactly in order" in adapter.calls[1][1]
    assert "已确认事件与完整父级边界必须保留。" in adapter.calls[1][1]
    assert adapter.calls[0][3] == adapter.calls[1][3]
    child = output.children[0] if collection else output
    assert [entry.episode_number for entry in child.episode_developments] == list(range(1, 9))
    assert child.episode_developments[-1].exit_state == valid["exit_state"]


@pytest.mark.parametrize("suffix", ["", " minimal retry"])
def test_segmented_child_uses_stream_without_adding_an_attempt(suffix):
    service, adapter = service_for([child_payload()])
    output = service._generate_planning_output(
        prompt="只展开已确认的当前子段。", strategy=build_strategy(),
        output_model=StoryPlanNodeChildOutput,
        artifact_name="Story Plan Node segmented child recovery node=test child=1/2" + suffix,
    )
    assert [call[0] for call in adapter.calls] == ["stream"]
    assert len(output.episode_developments) == 8


def test_malformed_json_keeps_the_existing_single_nonstream_compatibility_repair():
    malformed = LLMStructuredOutputError("Model returned invalid JSON content.",
        raw_content='{"children":[{"title":"未闭合节点"')
    service, adapter = service_for([malformed, {"children": [child_payload(), child_payload()]}])
    output = service._generate_planning_output(
        prompt="保留原事件。", strategy=build_strategy(),
        output_model=StoryPlanNodeDecompositionOutput,
        artifact_name="Story Plan Node decomposition node=test",
    )
    assert [call[0] for call in adapter.calls] == ["stream", "non_stream"]
    assert malformed.raw_content in adapter.calls[1][1]
    assert len(output.children) == 2


def test_streamed_field_repair_still_rejects_invalid_events_with_the_same_attempt_budget():
    invalid = compact_leaf()
    invalid["episode_developments"] = []
    service, adapter = service_for([invalid, invalid])
    with pytest.raises(StoryPlanningInputError):
        service._generate_planning_output(
            prompt="不得省略逐集事件。", strategy=build_strategy(),
            output_model=StoryPlanNodeGenerationOutput, artifact_name="Story Plan Node",
        )
    assert [call[0] for call in adapter.calls] == ["stream", "stream"]
