"""Bounded field repair for otherwise complete storyboard proposals."""
from copy import deepcopy
import json

from pydantic import ValidationError

from app.modules.script_engine.llm_adapter import bind_llm_log_context
from .models import SceneProposal


def _field_schema(schema: dict, path: tuple) -> dict:
    node = schema
    for component in path:
        while "$ref" in node:
            node = schema["$defs"][node["$ref"].rsplit("/", 1)[-1]]
        node = node["items"] if type(component) is int else node["properties"][component]
    return deepcopy(node)


def _value_at(candidate: dict, path: tuple):
    value = candidate
    for component in path:
        try:
            value = value[component]
        except (KeyError, IndexError, TypeError):
            return None
    return value


def validate_scene_proposal(output: dict, *, adapter, strategy, source, scene_number: int) -> SceneProposal:
    candidate = deepcopy({key: value for key, value in output.items() if key != "_meta"})
    schema = SceneProposal.model_json_schema()
    for attempt in range(3):
        try:
            return SceneProposal.model_validate(candidate)
        except ValidationError as error:
            if attempt == 2:
                raise
            errors = error.errors(include_input=False, include_context=False, include_url=False)
            paths = list(dict.fromkeys(tuple(item["loc"]) for item in errors))
            if not paths or len(paths) > 16 or any(not path for path in paths):
                raise
            try:
                variants = [{
                    "type": "object", "additionalProperties": False,
                    "properties": {"path": {"const": list(path)}, "value": _field_schema(schema, path)},
                    "required": ["path", "value"],
                } for path in paths]
            except (KeyError, TypeError):
                # Unknown fields or unrecognized paths must not authorize edits.
                raise error
            repair_schema = {
                "type": "object", "additionalProperties": False, "$defs": schema.get("$defs", {}),
                "properties": {"repairs": {"type": "array", "minItems": len(paths),
                    "maxItems": len(paths), "items": {"oneOf": variants}}},
                "required": ["repairs"],
            }
            affected_shots = sorted({path[1] for path in paths if len(path) > 1 and path[0] == "shots" and type(path[1]) is int})
            context = {
                "validation_errors": errors,
                "requested_repairs": [{"path": list(path), "current_value": _value_at(candidate, path)} for path in paths],
                "affected_shots": [{"index": index, "shot": _value_at(candidate, ("shots", index))} for index in affected_shots],
                "scene_source": source.model_dump(mode="json"),
            }
            prompt = (
                "修复分镜JSON中明确列出的字段，只返回repairs，不重写整场。path必须逐字对应requested_repairs，"
                "每个路径恰好一次。value满足该字段Schema。未列出的字段、镜头编号和正文引用均不允许修改。"
                "超长文字或列表应在保留动作因果、人物意图与已引用原文的前提下精炼合并，不能机械截断或新增剧情。\n"
                + json.dumps(context, ensure_ascii=False, separators=(",", ":"))
            )
            with bind_llm_log_context(stage=f"storyboard.scene_{scene_number}.structure_repair"):
                repaired = adapter.generate_structured_output_stream(
                    prompt, strategy=strategy.model_copy(update={"max_tokens": 4000}), output_schema=repair_schema,
                )
            if not isinstance(repaired, dict) or set(repaired) - {"repairs", "_meta"}:
                raise error
            patches = repaired.get("repairs")
            if not isinstance(patches, list) or len(patches) != len(paths):
                raise error
            seen = set()
            for patch in patches:
                if (not isinstance(patch, dict) or set(patch) != {"path", "value"}
                        or not isinstance(patch["path"], list)
                        or any(type(part) not in (str, int) for part in patch["path"])):
                    raise error
                path = tuple(patch["path"])
                if path not in paths or path in seen:
                    raise error
                seen.add(path)
                parent = candidate
                try:
                    for component in path[:-1]:
                        parent = parent[component]
                    parent[path[-1]] = deepcopy(patch["value"])
                except (KeyError, IndexError, TypeError):
                    raise error
    raise AssertionError("Unreachable proposal validation state")
