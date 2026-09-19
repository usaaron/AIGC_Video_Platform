import json

import httpx
import pytest

from app.modules.script_engine.llm_adapter import (
    LLMStructuredOutputError,
    RealLLMAdapter,
    bind_local_output_schema,
)
from app.modules.script_engine.long_story_models import EpisodePlanBatchGenerationOutput
from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.planning_wire_contract import (
    episode_boundary_wire_schema,
    scene_execution_wire_schema,
)


def strategy():
    return GenerationStrategy.model_validate({
        "id": "test.native", "name": "Native planning", "target_platform": "tiktok",
        "target_content_type": "ai_comic_drama", "applicable_tags": [],
        "model_provider": "openai_compatible", "model_name": "gpt-6-astra",
        "temperature": 0.7, "top_p": 0.9, "max_tokens": 4000,
        "workflow_steps": [{"step_order": 1, "name": "planning",
                            "description": "Plan an episode.", "prompt_id": "prompt.test"}],
        "prompt_ids": ["prompt.test"], "qc_enabled": True,
        "self_check_enabled": True, "human_review_required": False,
        "output_schema": {}, "version": "v1", "status": "active",
    })


def native_schema():
    return episode_boundary_wire_schema(scene_execution_wire_schema(
        EpisodePlanBatchGenerationOutput.model_json_schema()
    ))


def adapter_for_text(text, requests, *, stream=True):
    def handler(request):
        requests.append(json.loads(request.content))
        if stream:
            event = {"type": "response.output_text.delta", "delta": text}
            return httpx.Response(200, text=f"data: {json.dumps(event)}\n\n",
                                 headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"output_text": text})

    return RealLLMAdapter(
        provider="openai_compatible", model_name="gpt-6-astra", api_key="test",
        base_url="https://example.test/v1", wire_api="responses", max_retries=0,
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.parametrize("content", [
    '{"chinese":"拒签之外","english":null}',
    '{"episode_plans":[{"episode_number":56,"episode_title":{"chinese":"拒签之外","english":null},',
    '{"chinese":"拒签之外","english":null',
    '{"episode_number":56,"episode_title":{"chinese":"拒签之外","english":null}}',
    'preface {"scene_execution_plan":[{"chinese":"拒签之外"}]} trailing',
])
def test_native_stream_rejects_fragments_without_losing_raw_or_retrying(content):
    requests = []
    adapter = adapter_for_text(content, requests)
    with bind_local_output_schema(native_schema()):
        with pytest.raises(LLMStructuredOutputError) as caught:
            adapter.generate_structured_output_stream("native plan", strategy=strategy())
    assert caught.value.raw_content == content
    assert caught.value.stream_termination == "stream_ended_without_terminal_event"
    assert len(requests) == 1
    assert "text" not in requests[0] and "response_format" not in requests[0]


@pytest.mark.parametrize("stream", [True, False])
def test_native_complete_root_is_unchanged_and_does_not_alter_wire_contract(stream):
    # Artifact validation remains the planning service's responsibility; the
    # adapter only preserves the explicitly supplied root and episode identity.
    value = {"episode_plans": [{"episode_number": 56, "episode_title": {"chinese": "拒签之外", "english": None}}]}
    content = json.dumps(value, ensure_ascii=False)
    requests = []
    adapter = adapter_for_text(content, requests, stream=stream)
    call = adapter.generate_structured_output_stream if stream else adapter.generate_structured_output
    baseline = call("same prompt", strategy=strategy())
    with bind_local_output_schema(native_schema()):
        actual = call("same prompt", strategy=strategy())
    assert {k: v for k, v in actual.items() if k != "_meta"} == value
    assert actual == baseline
    assert requests[0] == requests[1]
    assert len(requests) == 2  # Exactly one provider request per invocation.


def test_local_root_requires_explicit_identity_and_restores_outer_context():
    content = '{"episode_title":"拒签之外"}'
    requests = []
    adapter = adapter_for_text(content, requests, stream=False)
    root = {"type": "object", "properties": {
        "episode_number": {"type": "integer"}, "episode_title": {"type": "string"},
    }, "required": ["episode_number", "episode_title"]}
    with bind_local_output_schema(root):
        with bind_local_output_schema(None):
            assert adapter._parse_json_content(content) == {"episode_title": "拒签之外"}
        with pytest.raises(LLMStructuredOutputError, match="episode_number") as caught:
            adapter.generate_structured_output("native plan", strategy=strategy())
        assert caught.value.raw_content == content
    assert adapter._parse_json_content(content) == {"episode_title": "拒签之外"}
    assert len(requests) == 1


def test_regular_explicit_schema_behavior_is_not_changed_by_native_binding():
    adapter = adapter_for_text("unused", [])
    content = '{"episode_title":"legacy fragment"}'
    root = {"type": "object", "properties": {"episode_number": {"type": "integer"}},
            "required": ["episode_number"]}
    baseline = adapter._parse_json_content(content, output_schema=root)
    with bind_local_output_schema(native_schema()):
        assert adapter._parse_json_content(content, output_schema=root) == baseline


@pytest.mark.parametrize("field", ["parsed", "content"])
def test_native_nonstream_gateway_object_also_crosses_local_root_check(field):
    adapter = adapter_for_text("unused", [])
    with bind_local_output_schema(native_schema()):
        adapter._wire_api = "chat_completions"
        with pytest.raises(LLMStructuredOutputError) as caught:
            adapter._extract_structured_output({"choices": [{"message": {
                field: {"chinese": "拒签之外", "english": None}
            }}]})
    assert json.loads(caught.value.raw_content) == {"chinese": "拒签之外", "english": None}
