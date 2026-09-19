"""Native planning uses local root identity without provider schema transport."""
from copy import deepcopy
import json

import pytest

from app.modules.script_engine.llm_adapter import LLMStructuredOutputError, RealLLMAdapter
from app.modules.script_engine.story_planning_service import StoryPlanningInputError
from tests.test_future_rebuild_generation import rebuild_case


TRUNCATED = '{"episode_plans":[{"episode_number":2,"episode_title":{"chinese":"拒签之外","english":"NO MORE DENIAL"},"synopsis":"尚未闭合'


def native_parser_case(always_truncated=False):
    service, request, response, _old_calls, context = rebuild_case()
    calls = []
    parser = object.__new__(RealLLMAdapter)
    parser._model_name = "offline-native-parser"

    def generated(prompt, *, strategy, output_schema):
        calls.append((prompt, output_schema))
        assert output_schema is None, "local schema must never enable provider schema transport"
        raw = TRUNCATED if always_truncated or len(calls) == 1 else json.dumps(deepcopy(response), ensure_ascii=False)
        try:
            return parser._parse_json_content(raw, output_schema=output_schema)
        except LLMStructuredOutputError as error:
            error.stream_termination = "stream_ended_without_terminal_event"
            raise

    service._episode_plan_llm_adapter.generate_structured_output_stream = generated
    return service, request, calls, context


def test_truncated_title_fragment_uses_existing_one_native_recovery_then_returns_full_approved_episode():
    service, request, calls, context = native_parser_case()
    plans = service.generate_episode_plan_chunk(request)
    assert len(calls) == 2
    assert len(plans) == 1 and plans[0].episode_number == 2
    assert plans[0].entry_state == context["source_evidence"]["entry_state"]
    for prompt, _schema in calls:
        final = prompt.rsplit("【最终完整输出根合同】", 1)[1]
        assert "episode_plans 数组" in final and "[2]" in final
        assert "scene_execution_plan" in final and "不得只返回标题" in final
        assert prompt.rfind("【最终完整输出根合同】") > prompt.rfind("标题传输合同")
    fallback_schema, _ = json.JSONDecoder().raw_decode(calls[1][0].split("AUTHORITATIVE FALLBACK JSON SCHEMA:\n", 1)[1])
    assert fallback_schema["required"] == ["episode_plans"]
    assert fallback_schema["$defs"]["EpisodePlanGenerationItem"]["properties"]["episode_number"]["const"] == 2
    assert service._long_story_service.saved_nodes == []


def test_second_native_fragment_preserves_raw_error_and_stops_without_boundary_guess_or_third_call():
    service, request, calls, _context = native_parser_case(always_truncated=True)
    with pytest.raises(StoryPlanningInputError) as caught:
        service.generate_episode_plan_chunk(request)
    assert len(calls) == 2
    original = caught.value.__cause__
    assert isinstance(original, LLMStructuredOutputError)
    assert original.raw_content == TRUNCATED
    assert original.stream_termination == "stream_ended_without_terminal_event"
    assert "ApprovedEpisodeBoundaries" not in str(caught.value)
    assert service._long_story_service.saved_nodes == []
