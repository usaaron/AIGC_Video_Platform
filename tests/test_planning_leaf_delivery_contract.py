"""Check the complete first-call leaf contract at the provider request boundary."""

import json
from types import SimpleNamespace

import pytest

from app.modules.script_engine.llm_adapter import RealLLMAdapter
from app.modules.script_engine.long_story_models import (
    StoryBibleGenerationOutput, StoryPlanExpansionStatus, StoryPlanNodeChildOutput,
    StoryPlanNodeDecompositionOutput, StoryPlanNodeGenerationOutput,
)
from app.modules.script_engine.planning_wire_contract import planning_wire_schema
from app.modules.script_engine.story_planning_service import (
    NODE_EPISODE_OWNERSHIP_OUTPUT_CONTRACT, STORY_TREE_LENGTH_TARGET_CONTRACT, StoryPlanningService,
)
from tests.test_story_planning_service import (
    build_active_lineage_story_bible, build_active_lineage_story_node, build_strategy,
)


@pytest.mark.parametrize("model", [StoryPlanNodeDecompositionOutput, StoryPlanNodeChildOutput, StoryPlanNodeGenerationOutput])
@pytest.mark.parametrize("native", [False, True])
def test_first_provider_request_and_bounded_child_transport_include_complete_leaf_contract(model, native):
    # Only construct provider payloads. Neither this adapter nor its transport
    # issues a network request; the returned dictionary is a transport sentinel.
    real = RealLLMAdapter(
        provider="openai_compatible", model_name="deepseek-v4-pro", api_key="offline-fixture",
        base_url="https://offline.invalid", thinking_mode="disabled",
    )
    captured = []

    def capture(prompt, *, strategy, output_schema):
        captured.append(real._build_payload(prompt=prompt, strategy=strategy, output_schema=output_schema))
        return {"transport_sentinel": True}

    adapter = SimpleNamespace(
        get_model_info=real.get_model_info,
        generate_structured_output=capture, generate_structured_output_stream=capture,
    )
    schema = planning_wire_schema(model.model_json_schema())
    StoryPlanningService._generate_structured_planning_response(
        adapter, "Complete ordered source and current parent facts.\n" + STORY_TREE_LENGTH_TARGET_CONTRACT,
        strategy=build_strategy(), output_schema=None if native else schema,
        prompt_schema=schema if native else None,
        artifact_name="Story Plan Node decomposition child repair" if model is StoryPlanNodeChildOutput else "Story Plan Node decomposition",
        allow_stream=model is not StoryPlanNodeChildOutput,
    )
    assert len(captured) == 1
    body = captured[0]
    prompt = body["messages"][-1]["content"]
    assert prompt.count(NODE_EPISODE_OWNERSHIP_OUTPUT_CONTRACT) == 1
    assert prompt.index(NODE_EPISODE_OWNERSHIP_OUTPUT_CONTRACT) > prompt.index(STORY_TREE_LENGTH_TARGET_CONTRACT)
    if native:
        text = prompt.split("AUTHORITATIVE JSON SCHEMA:\n", 1)[1]
        delivered_schema = json.JSONDecoder().raw_decode(text)[0]
    else:
        assert body["response_format"] == {"type": "json_object"}
        delivered_schema = json.loads(prompt.split("<json_contract>\n", 1)[1].split("\n</json_contract>", 1)[0])
    node_shape = delivered_schema["$defs"]["StoryPlanNodeChildOutput"] if model is StoryPlanNodeDecompositionOutput else delivered_schema
    assert "episode_developments" in node_shape["required"]
    assert "default" not in node_shape["properties"]["episode_developments"]
    assert node_shape["properties"]["episode_developments"].get("minItems", 0) == 0  # Expandable branches may return [].
    assert delivered_schema["$defs"]["EpisodeDevelopment"]["required"] == [
        "episode_number", "synopsis", "exit_state", "source_event_indices",
    ]


def test_chapter_overview_limit_excludes_episode_maps_and_downstream_cannot_redistribute():
    parent = build_active_lineage_story_node(
        node_id="parent.scope", version=3, start_episode=25, end_episode=50,
        expansion_status=StoryPlanExpansionStatus.expanded,
    )
    prompt = StoryPlanningService._build_decomposition_prompt(
        parent=parent, story_bible=build_active_lineage_story_bible(), requested_child_count=None,
        max_episode_ready_span=12, knowledge_context="",
    )
    assert "不包含 episode_developments 逐集事件分配" in prompt
    assert "每集梗概及退出状态不占上述350-650字" in prompt
    assert "may not redistribute them across episodes" in prompt
    assert "may distribute and stage approved events" not in prompt
    # Readiness is computed from each output node, not its parent's 26 episodes.
    assert "planned_end_episode - planned_start_episode + 1" in NODE_EPISODE_OWNERSHIP_OUTPUT_CONTRACT
    assert "实际跨度至少16集" in NODE_EPISODE_OWNERSHIP_OUTPUT_CONTRACT


def test_bible_schema_does_not_receive_leaf_generation_instructions():
    seen = []
    adapter = SimpleNamespace(
        get_model_info=lambda: SimpleNamespace(provider="offline", model_name="fixture"),
        generate_structured_output=lambda prompt, **kwargs: seen.append(prompt) or {"transport_sentinel": True},
    )
    StoryPlanningService._generate_structured_planning_response(
        adapter, "Write only the Bible.", strategy=build_strategy(),
        output_schema=StoryBibleGenerationOutput.model_json_schema(), artifact_name="Story Bible", allow_stream=False,
    )
    assert len(seen) == 1
    assert NODE_EPISODE_OWNERSHIP_OUTPUT_CONTRACT not in seen[0]
