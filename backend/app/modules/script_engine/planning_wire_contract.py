"""One authored event table, with lossless references on the model transport.

The persisted/API models remain unchanged. This projection resolves references;
it never invents, rewrites, redistributes or drops a narrative event.
"""

from __future__ import annotations

from copy import deepcopy
import json
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


EventIndex = Annotated[int, Field(strict=True, ge=1, le=12)]


class _EpisodeEventReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episode_number: int = Field(strict=True, ge=1, le=2_000)
    synopsis: str = Field(min_length=20, max_length=600)
    exit_state: str = Field(min_length=5, max_length=1_500)
    source_event_indices: list[EventIndex] = Field(max_length=12)


class _NodeEventReferences(BaseModel):
    # The remaining node fields are validated by the unchanged public model.
    model_config = ConfigDict(extra="ignore")

    unit_story_beats: list[str] = Field(min_length=1, max_length=12)
    turning_point_indices: list[EventIndex] = Field(min_length=1, max_length=12)
    entry_state: str = Field(min_length=5, max_length=1_500)
    exit_state: str = Field(min_length=5, max_length=1_500)
    planned_start_episode: int = Field(strict=True, ge=1, le=2_000)
    planned_end_episode: int = Field(strict=True, ge=1, le=2_000)
    episode_developments: list[_EpisodeEventReference] = Field(max_length=12)

    @model_validator(mode="before")
    @classmethod
    def reject_competing_event_tables(cls, values: Any) -> Any:
        if isinstance(values, dict) and "turning_points" in values:
            raise ValueError("Use turning_point_indices only; do not supply a second event text table.")
        return values

    @model_validator(mode="after")
    def validate_references(self) -> "_NodeEventReferences":
        beats = self.unit_story_beats
        if any(not beat.strip() for beat in beats) or len(set(beats)) != len(beats):
            raise ValueError("The event table must contain distinct nonempty events.")
        turns = self.turning_point_indices
        if len(set(turns)) != len(turns) or any(index > len(beats) for index in turns):
            raise ValueError("turning_point_indices must be unique 1-based indices into this node's event table.")
        span = self.planned_end_episode - self.planned_start_episode + 1
        if span < 1:
            raise ValueError("The episode range must be ordered.")
        if not 8 <= span <= 12:
            if self.episode_developments:
                raise ValueError("Only an 8-12 episode leaf has episode_developments.")
            return self
        entries = self.episode_developments
        if [entry.episode_number for entry in entries] != list(range(self.planned_start_episode, self.planned_end_episode + 1)):
            raise ValueError("episode_developments must cover the leaf exactly in order.")
        assigned = [index for entry in entries for index in entry.source_event_indices]
        if sorted(assigned) != list(range(1, len(beats) + 1)):
            raise ValueError("Assign each event index exactly once to the episode where it actually happens.")
        if len(beats) not in entries[-1].source_event_indices:
            raise ValueError("The terminal event must belong to the final episode.")
        if entries[-1].exit_state != self.exit_state:
            raise ValueError("The final episode must deliver the node exit_state verbatim.")
        return self


def expand_node_event_references(payload: dict[str, Any]) -> dict[str, Any]:
    """Accept legacy full objects, or strictly resolve a compact model response."""
    entries = payload.get("episode_developments", [])
    uses_references = "turning_point_indices" in payload or (
        isinstance(entries, list) and any(
            isinstance(entry, dict) and "source_event_indices" in entry for entry in entries
        )
    )
    if not uses_references:
        return payload
    refs = _NodeEventReferences.model_validate(payload)
    beats = refs.unit_story_beats
    result = dict(payload)
    result.pop("turning_point_indices", None)
    result["turning_points"] = [beats[index - 1] for index in refs.turning_point_indices]
    developments = []
    previous_state = refs.entry_state
    for entry in refs.episode_developments:
        developments.append({
            "episode_number": entry.episode_number,
            "synopsis": entry.synopsis,
            "entry_state": previous_state,
            "exit_state": entry.exit_state,
            "source_turning_points": [
                beats[index - 1] for index in refs.turning_point_indices
                if index in entry.source_event_indices
            ],
            "source_unit_story_beats": [beats[index - 1] for index in entry.source_event_indices],
        })
        previous_state = entry.exit_state
    result["episode_developments"] = developments
    return result


class _SceneHeadingWire(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    environment: Literal["INT", "EXT"]
    location: str = Field(strict=True, min_length=1, max_length=100)
    time: str = Field(strict=True, min_length=1, max_length=40)


class _EpisodeTitleWire(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    chinese: str = Field(strict=True, min_length=3, max_length=10, pattern=r"^[\u3400-\u9fff]{3,10}$")
    # English titles may use ordinary title punctuation.  Keep the first
    # character alphabetic and reject non-Latin text while allowing punctuation
    # that is meaningful in a short title (comma, full stop, colon, semicolon,
    # question/exclamation marks, apostrophes and hyphens).
    english: str | None = Field(default=None, min_length=2, max_length=80, pattern=r"^[A-Za-z][A-Za-z0-9 &'’.,:;!?\-]*$")


EPISODE_TITLE_WIRE_CONTRACT = (
    '标题传输合同：episode_title 是 {"chinese":"中文短标题","english":"ENGLISH TITLE"} 对象。'
    "chinese 为3—10个汉字；需要双语时 english 只能写英文短标题，这是市场中文规则的标题例外。"
    "仅用中文标题时 english 为 null，不能把中文重复填入英文字段。程序组合显示标题，不输出分隔符。"
)


def expand_episode_title(payload: dict[str, Any]) -> dict[str, Any]:
    title = payload.get("episode_title")
    if not isinstance(title, dict):
        return payload
    parts = _EpisodeTitleWire.model_validate(title)
    return {**payload, "episode_title": f"{parts.english}｜{parts.chinese}" if parts.english else parts.chinese}


SCENE_HEADING_WIRE_CONTRACT = (
    "场景传输合同：scene_heading 是对象，格式为 "
    '{"environment":"INT或EXT","location":"具体地点","time":"具体时段"}。'
    "environment 只能选择 INT（内景）或 EXT（外景）；三个字段均须明确填写。"
    "程序会组合正式场标，不要自行拼写场标字符串。"
)


def expand_scene_heading(payload: dict[str, Any]) -> dict[str, Any]:
    """Render explicitly authored production metadata; never infer an environment."""
    heading = payload.get("scene_heading")
    if not isinstance(heading, dict):
        return payload  # Existing public/stored scene objects remain readable.
    fields = _SceneHeadingWire.model_validate(heading)
    return {**payload, "scene_heading": f"{fields.environment}. {fields.location} - {fields.time}"}


SCENE_ACTION_EXECUTION_CONTRACT = (
    "【场景行动兑现合同】visible_action 把本场应兑现的批准事件写成实际行动，"
    "先落实动作再写退出状态。许可、排期或签字只证明相应许可、安排或记录，"
    "不能代替尚未执行的履行；合理时间跳跃后可用可核验的既往履行证据确认完成。"
    "exit_state 只能记录进入时已成立的事实，以及本场实际行动或履行证据产生的新结果；"
    "不得仅抄集级退出状态，把承诺或安排升级为完成。"
)

SCENE_PARTITION_CONTRACT = (
    "【先编排行动，再统计场数】先确定本集尚未发生、且已获批准的行动及其先后关系，再写场景。"
    "同一时间地点内的一次连续交锋可以包含多个战术变化、人物反应和情绪层次，仍是一场。"
    "只有实际时空转换或独立的新戏剧工作才另起一场；复述、再次确认、正式确认不能单独占一场。"
    "换到走廊或窗口也不能把已完成的同一次拒绝、受理、核验重演。"
    "保持未决条件不要求再演一次条件提出与拒绝；承接前文已成立的决定，只展开本集新增行动。"
    "不先设场数再填内容，不为凑场数拆分同一结果。planned_scene_count 由程序根据实际场景统计，"
    "模型传输不输出这个字段。每场仍须交代充分的动作、知情依据、人物选择、可见证据与结果；"
    "合并场景不得删掉必要戏剧内容，对白与镜头预算依实际行动分配。"
)

EPISODE_BOUNDARY_FIELDS = (
    "entry_state", "exit_state", "source_turning_points", "source_unit_story_beats",
)


def native_episode_output_contract(
    schema: dict[str, Any], boundaries: dict[int, dict[str, Any]] | None = None,
) -> str:
    """Keep field examples subordinate to the full native-JSON response root."""
    properties = schema.get("properties", {})
    if "episode_plans" in properties:
        item_shape = properties["episode_plans"].get("items", {})
        reference = item_shape.get("$ref", "")
        if reference.startswith("#/$defs/"):
            item_shape = schema.get("$defs", {}).get(reference.removeprefix("#/$defs/"), {})
        root = "唯一顶层对象必须包含 episode_plans 数组，每个数组元素是一份完整分集规划。"
    elif {"episode_number", "scene_execution_plan"} <= properties.keys():
        item_shape = schema
        root = "唯一顶层对象必须是一份完整分集规划，包含 episode_number 和 scene_execution_plan。"
    else:
        return ""
    scope = (
        "本次只返回以下明确集号，按此顺序逐项输出且不得遗漏、猜测或增加："
        + json.dumps(sorted(boundaries)) + "。"
        if boundaries else "集号及数量严格遵循本次请求范围。"
    )
    return (
        "\n\n【最终完整输出根合同】" + root + scope
        + "每份规划须完整输出schema的必填字段："
        + json.dumps(item_shape.get("required", []), ensure_ascii=False, separators=(",", ":"))
        + "。标题chinese/english和场标示例都是字段内部对象，预算与来源示例只是输入约束，"
        "均不能单独作为输出根；不得只返回标题、场景、预算或元信息。只返回完整JSON，不写说明。"
    )


def episode_boundary_wire_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Only approved episode boundaries are bound; authored scene claims remain."""
    result = deepcopy(schema)
    for shape in [result, *result.get("$defs", {}).values()]:
        properties = shape.get("properties", {})
        if {"episode_number", "scene_execution_plan"} <= properties.keys():
            for field in EPISODE_BOUNDARY_FIELDS:
                properties.pop(field, None)
            shape["required"] = [field for field in shape.get("required", [])
                                 if field not in EPISODE_BOUNDARY_FIELDS]
    return result


def expand_episode_boundaries(
    payload: dict[str, Any], boundaries: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    """Resolve exact approved inputs, never erase a conflicting authored claim."""
    def expand(item: Any) -> Any:
        if not isinstance(item, dict):
            return item
        number = item.get("episode_number")
        if type(number) is not int or number not in boundaries:
            raise ValueError("Episode boundary binding requires an explicitly requested episode_number.")
        boundary = boundaries[number]
        result = dict(item)
        for field in EPISODE_BOUNDARY_FIELDS:
            if field not in boundary:
                raise ValueError(f"Approved episode {number} has no {field}.")
            if field in item and item[field] != boundary[field]:
                raise ValueError(f"Episode {number} contradicts its approved {field}.")
            result[field] = deepcopy(boundary[field])
        return result

    try:
        if isinstance(payload.get("episode_plans"), list):
            return {**payload, "episode_plans": [expand(item) for item in payload["episode_plans"]]}
        return expand(payload)
    except ValueError as error:
        raise ValidationError.from_exception_data("ApprovedEpisodeBoundaries", [{
            "type": "value_error", "loc": ("episode_boundaries",), "input": payload,
            "ctx": {"error": error},
        }]) from error


def scene_execution_wire_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Expose scene requirements to the initial call as well as any repair."""
    result = deepcopy(schema)
    for shape in [result, *result.get("$defs", {}).values()]:
        properties = shape.get("properties", {})
        if {"episode_number", "scene_execution_plan"} <= properties.keys():
            # These are derived after semantic validation. Asking the model to
            # emit them wastes tokens and suggests it can certify its own work.
            for field in ("execution_ready", "layer_contracts", "planned_scene_count"):
                properties.pop(field, None)
            shape["required"] = [field for field in shape.get("required", [])
                                 if field not in {"execution_ready", "layer_contracts", "planned_scene_count"}]
            # Place narrative work before the production allocation. The public
            # model's metadata-first order is not the model's writing workflow.
            first = ("episode_number", "ending_mode", "episode_title", "synopsis",
                     "episode_goal", "central_conflict", "protagonist_decision", "scene_execution_plan")
            shape["properties"] = {**{key: properties[key] for key in first if key in properties},
                                   **{key: value for key, value in properties.items() if key not in first}}
            properties = shape["properties"]
        if "episode_title" in properties:
            properties["episode_title"] = _EpisodeTitleWire.model_json_schema()
            shape["required"] = list(dict.fromkeys([*shape.get("required", []), "episode_title"]))
        if "scene_execution_plan" in properties:
            properties["scene_execution_plan"].pop("default", None)
            properties["scene_execution_plan"]["minItems"] = 1
            shape["required"] = list(dict.fromkeys([*shape.get("required", []), "scene_execution_plan"]))
        if not {"scene_heading", "scene_objective", "evidence_requirements"} <= properties.keys():
            continue
        properties["scene_heading"] = _SceneHeadingWire.model_json_schema()
        for field in ("opposition", "information_shift", "choice_or_cost"):
            properties[field] = {"type": "string", "minLength": 3, "maxLength": 500}
        properties["evidence_requirements"]["minItems"] = 1
        properties["visible_action"]["description"] = (
            "把本场应兑现的批准事件写成实际行动，先落实动作再写退出状态。"
            "许可、排期或签字只证明相应许可、安排或记录；不能代替尚未执行的履行。"
            "若经合理时间跳跃确认此前已完成，须提供能证明那次实际履行的可见证据。"
        )
        properties["exit_state"]["description"] = (
            "只能记录进入时已成立的事实，以及本场实际行动或履行证据产生的新结果；"
            "不得仅抄集级退出状态，把承诺或安排升级为完成。"
        )
        shape["required"] = list(dict.fromkeys([
            *shape.get("required", []), "opposition", "information_shift", "choice_or_cost", "evidence_requirements",
        ]))
    # Drop only definitions made unreachable by the transport projection.
    # Follow references transitively so every remaining validation rule survives.
    definitions = result.get("$defs", {})
    reachable: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            reference = value.get("$ref", "")
            if isinstance(reference, str) and reference.startswith("#/$defs/"):
                name = reference.removeprefix("#/$defs/")
                if name in definitions and name not in reachable:
                    reachable.add(name)
                    visit(definitions[name])
            for key, child in value.items():
                if key != "$defs":
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(result)
    if definitions:
        result["$defs"] = {key: value for key, value in definitions.items() if key in reachable}
    return result


def planning_wire_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Deliver first-call constraints and remove duplicate node event prose."""
    result = scene_execution_wire_schema(schema)
    definitions = result.get("$defs", {})
    node_shapes = [
        shape for shape in [result, *definitions.values()]
        if {"turning_points", "unit_story_beats", "episode_developments"}
        <= set(shape.get("properties", {}))
    ]
    if not node_shapes:
        return result
    for shape in node_shapes:
        properties = shape["properties"]
        properties.pop("turning_points")
        properties["turning_point_indices"] = {
            "type": "array", "minItems": 1, "maxItems": 12,
            "items": {"type": "integer", "minimum": 1, "maximum": 12},
            "description": "1-based indices selecting important events from this node's unit_story_beats; each index is unique. No repeated event prose.",
        }
        properties["unit_story_beats"]["minItems"] = max(1, properties["unit_story_beats"].get("minItems", 0))
        for name in ("unit_story_beats", "parent_event_bindings", "episode_developments", "planned_start_episode", "planned_end_episode"):
            properties[name].pop("default", None)
        shape["required"] = list(dict.fromkeys([
            *(name for name in shape.get("required", []) if name != "turning_points"),
            "unit_story_beats", "parent_event_bindings", "turning_point_indices", "episode_developments",
            "planned_start_episode", "planned_end_episode",
        ]))
    episode_shape = definitions["EpisodeDevelopment"]
    for name in ("entry_state", "source_turning_points", "source_unit_story_beats"):
        episode_shape["properties"].pop(name)
    episode_shape["properties"]["source_event_indices"] = {
        "type": "array", "maxItems": 12,
        "items": {"type": "integer", "minimum": 1, "maximum": 12},
        "description": "1-based indices of events actually enacted in this episode, from the enclosing node's unit_story_beats. Assign each index exactly once across its episodes. [] is valid for additional intermediate development.",
    }
    episode_shape["required"] = ["episode_number", "synopsis", "exit_state", "source_event_indices"]
    return result


def quality_review_wire_schema(schema: dict[str, Any], node_refs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Bind each verdict to an application-owned reference instead of copying IDs."""
    result = deepcopy(schema)
    evaluation = result["$defs"]["StoryPlanQualityEvaluation"]
    for name in ("node_id", "node_version"):
        evaluation["properties"].pop(name)
    evaluation["required"] = [name for name in evaluation["required"] if name not in {"node_id", "node_version"}]
    result["properties"]["evaluations"] = {
        "type": "object", "additionalProperties": False,
        "properties": {key: {"$ref": "#/$defs/StoryPlanQualityEvaluation"} for key in node_refs},
        "required": list(node_refs),
    }
    return result


def expand_quality_review_references(payload: dict[str, Any], node_refs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    evaluations = payload.get("evaluations")
    if not isinstance(evaluations, dict):
        # Existing stored/test adapters still return the public array contract.
        return payload
    invalid = set(evaluations) != set(node_refs) or any(
        not isinstance(value, dict) or {"node_id", "node_version"} & value.keys()
        for value in evaluations.values()
    )
    if invalid:
        raise ValidationError.from_exception_data("QualityReviewReferences", [{
            "type": "value_error", "loc": ("evaluations",),
            "input": evaluations,
            "ctx": {"error": ValueError("Return exactly the requested review keys; node IDs and versions are bound by the runtime.")},
        }])
    return {**payload, "evaluations": [
        {**evaluations[key], **reference} for key, reference in node_refs.items()
    ]}
