import json
import re
from copy import deepcopy

import pytest

from app.modules.script_engine.json_schema_contract import compact_json_schema
from app.modules.script_engine.llm_adapter import RealLLMAdapter
from app.modules.script_engine.models import GenerationStrategy
from tests.test_llm_adapter import build_strategy


def bounded_contract():
    return {
        "title": "Annotations may be removed", "type": "object", "additionalProperties": False,
        "properties": {
            "title": {"type": "string", "minLength": 2, "maxLength": 80, "description": "Title prose"},
            "description": {"type": "string"},
            "events": {"type": "array", "minItems": 1, "maxItems": 12, "default": [], "items": {"$ref": "#/$defs/Event"}},
        },
        "required": ["title", "events"],
        "$defs": {"Event": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "owner": {"type": "integer", "minimum": 1, "maximum": 8},
                "status": {"enum": ["pending", "resolved", "retained"]},
                "description": {"anyOf": [{"type": "string", "pattern": "^事件"}, {"type": "null"}]},
                "evidence": {"const": {"title": "keep this data", "description": "also data"}},
            },
            "required": ["owner", "status", "description"],
        }},
    }


def test_schema_compaction_keeps_property_names_and_all_validation_rules():
    original = bounded_contract()
    before = deepcopy(original)
    compact = compact_json_schema(original)
    assert "title" not in compact
    assert compact["properties"]["title"] == {
        "type": "string", "minLength": 2, "maxLength": 80, "description": "Title prose",
    }
    assert "description" in compact["properties"]
    assert compact["$defs"] == original["$defs"]
    assert compact["properties"]["events"]["maxItems"] == 12
    assert original == before


@pytest.mark.parametrize("model,wire_api,strict", [("deepseek-v4-pro", "chat_completions", True), ("glm-5.2", "responses", False)])
def test_json_only_transport_receives_bounds_enums_and_nested_required_fields(model, wire_api, strict):
    adapter = RealLLMAdapter(provider="openai_compatible", model_name=model, api_key="test-key", base_url="https://example.test/v1", wire_api=wire_api, use_strict_schema=strict)
    schema = bounded_contract()
    build = adapter._build_chat_payload if wire_api == "chat_completions" else adapter._build_responses_payload
    payload = build(prompt="生成故事。", strategy=GenerationStrategy.model_validate(build_strategy()), output_schema=schema)
    prompt = payload["messages"][1]["content"] if wire_api == "chat_completions" else payload["input"][1]["content"]
    delivered = json.loads(re.search(r"<json_contract>\s*(.*?)\s*</json_contract>", prompt, re.S)[1])
    assert delivered == compact_json_schema(schema)
    assert delivered["properties"]["events"]["maxItems"] == 12
    assert delivered["$defs"]["Event"]["properties"]["status"]["enum"] == ["pending", "resolved", "retained"]
    assert delivered["$defs"]["Event"]["required"] == ["owner", "status", "description"]


def test_gemini_request_preserves_spoken_language_and_translation_semantics():
    from app.modules.script_engine.generation_service import ScriptGenerationService

    adapter = RealLLMAdapter(
        provider="openai_compatible", model_name="gemini-3.6-flash", api_key="test-key",
        base_url="https://example.test/v1", use_strict_schema=False,
    )
    schema = ScriptGenerationService._initial_draft_output_schema()
    payload = adapter._build_chat_payload(
        prompt="Write one approved episode.", strategy=GenerationStrategy.model_validate(build_strategy()),
        output_schema=schema,
    )
    prompt = payload["messages"][1]["content"]
    delivered = json.loads(re.search(r"<json_contract>\s*(.*?)\s*</json_contract>", prompt, re.S)[1])
    fields = delivered["$defs"]["DialogueLine"]["properties"]
    original = schema["$defs"]["DialogueLine"]["properties"]
    for name in ("text", "chinese_translation", "intent"):
        assert fields[name]["description"] == original[name]["description"]
    assert "idiomatic spoken English" in fields["text"]["description"]
    assert "same facts, time reference" in fields["chinese_translation"]["description"]
    assert fields["text"]["maxLength"] == original["text"]["maxLength"]
    dialogue_order = list(fields)
    assert dialogue_order.index("text") < dialogue_order.index("chinese_translation") < dialogue_order.index("intent")
    scene_order = list(delivered["$defs"]["LLMGeneratedSceneCard"]["properties"])
    assert scene_order.index("dialogues") < scene_order.index("body_order") < scene_order.index("beat_summary")
