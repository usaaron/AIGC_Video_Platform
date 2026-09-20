"""Field and source-contract repairs share one bounded proposal repair budget."""
from collections import Counter
from copy import deepcopy
import json
import logging
import re

from pydantic import ValidationError

from app.modules.script_engine.llm_adapter import bind_deepseek_output_recovery, bind_llm_log_context
from app.modules.script_engine.llm_deadline import check_deadline
from .models import SceneProposal
from .repository import StoryboardConflictError

logger = logging.getLogger(__name__)


def _field_schema(schema: dict, path: tuple) -> dict:
    node = schema
    for component in path:
        while True:
            if "$ref" in node:
                node = schema["$defs"][node["$ref"].rsplit("/", 1)[-1]]
                continue
            # Optional structured contracts are object | null. Traverse the
            # one non-null branch without granting repairs to unrelated paths.
            branches = [branch for branch in node.get("anyOf", []) if branch.get("type") != "null"]
            if len(branches) == 1:
                node = branches[0]
                continue
            break
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


def _reference_diagnostics(expected: list[str], actual: list[str]) -> dict:
    expected_counts, actual_counts = Counter(expected), Counter(actual)
    return {
        "expected_order": list(expected),
        "actual_order": list(actual),
        "missing_refs": list((expected_counts - actual_counts).elements()),
        "unexpected_or_duplicate_refs": list((actual_counts - expected_counts).elements()),
        "first_mismatch_index": next((index for index in range(max(len(expected), len(actual)))
                                      if expected[index:index + 1] != actual[index:index + 1]), None),
    }


def _source_repair_guidance(expected: list[str], proposal: SceneProposal, diagnostics: dict) -> dict:
    """Suggest a partition to the model; never mutate or accept a candidate."""
    mismatch = diagnostics["first_mismatch_index"]
    start = max(0, mismatch - 2) if mismatch is not None else 0
    end = mismatch + 3 if mismatch is not None else 0
    groups = []
    # Preserve only the proposed shot sizes when coverage is already exact.
    # Missing/duplicate refs require a fresh model plan, not guessed allocation.
    if not diagnostics["missing_refs"] and not diagnostics["unexpected_or_duplicate_refs"]:
        offset = 0
        for index, shot in enumerate(proposal.shots, 1):
            next_offset = offset + len(shot.source_refs)
            groups.append({"suggested_shot_number": index, "source_refs": expected[offset:next_offset]})
            offset = next_offset
    return {
        "first_mismatch_neighbors": {
            "start_index": start,
            "expected": expected[start:end],
            "actual": diagnostics["actual_order"][start:end],
        },
        "suggested_contiguous_groups": groups,
        "grouping_is_optional": True,
    }


def _log_source_rejection(scene_number: int, diagnostics: dict, *, exhausted: bool) -> None:
    # source_refs is model text; log only canonical identifiers, never a
    # malformed ref containing screenplay text or any full candidate content.
    def safe(refs):
        return [ref if re.fullmatch(r"(?:action|dialogue):[0-9]+", ref) else "<invalid-ref>" for ref in refs]
    summary = {key: safe(value) if isinstance(value, list) else value for key, value in diagnostics.items()}
    logger.warning("Storyboard source reference diagnostics scene=%d exhausted=%s refs=%s",
                   scene_number, exhausted, json.dumps(summary, ensure_ascii=True, separators=(",", ":")))


def validate_scene_proposal(output: dict, *, adapter, strategy, source, scene_number: int,
                            original_prompt: str) -> SceneProposal:
    candidate = deepcopy({key: value for key, value in output.items() if key != "_meta"})
    schema = SceneProposal.model_json_schema()
    source_repair_used = False
    # Keep the existing two repair calls in total. A source repair consumes one
    # of those calls and cannot start another output-recovery or repair loop.
    for attempt in range(3):
        check_deadline()
        try:
            proposal = SceneProposal.model_validate(candidate)
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
                "scene_design": candidate.get("design"),
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
            continue
        refs = [ref for shot in proposal.shots for ref in shot.source_refs]
        if refs == source.body_order:
            return proposal
        diagnostics = _reference_diagnostics(source.body_order, refs)
        _log_source_rejection(scene_number, diagnostics, exhausted=source_repair_used or attempt == 2)
        if source_repair_used or attempt == 2:
            raise StoryboardConflictError(
                "分镜候选仍遗漏、重复或重排了正文引用；有界修复已结束，原分镜已保留，请重试本场。"
            )
        logger.warning(
            "Storyboard source contract mismatch; using one model proposal repair "
            "scene=%d repair=%d/2 expected_refs=%d actual_refs=%d missing=%d unexpected_or_duplicate=%d first_mismatch=%s",
            scene_number, attempt + 1, len(source.body_order), len(refs),
            len(diagnostics["missing_refs"]), len(diagnostics["unexpected_or_duplicate_refs"]),
            diagnostics["first_mismatch_index"],
        )
        repair_prompt = (
            original_prompt
            + "\n\n以下未保存候选未通过正文引用合同。这是本次唯一一次正文引用合同修复。"
            "上方原请求的完整正文、作者指令、导演约束和前场衔接仍为依据。"
            "结合差异重新编排整场镜头，并返回同一Schema的完整JSON。保留候选中与正文一致的可用设计。"
            "所有镜头source_refs按镜头顺序展开后必须与expected_order逐项全等。"
            "必须同步修正action_sequence、起止状态、机位与时长，使实际可见动作和引用对应；"
            "不能只排序、增删source_refs来伪装通过，不能新增或删减正文动作、改写对白、重排事实。"
            "每镜引用必须是expected_order的一段连续片段，相邻镜头依次接续，不跳项、不回头；"
            "连续片段可以混合action和dialogue，不要先聚合所有动作再聚合对白。"
            "若提供suggested_contiguous_groups，它仅按候选每镜引用数量给出连续分组建议，不是已通过的摄影设计。"
            "采用建议时必须按每组正文重新编写整镜可见表演、起止状态、机位与时长，不能沿用与新引用不符的旧镜头文字；"
            "也可根据真实表演节拍另选连续分组和镜数，最终展开仍须与expected_order完全一致。"
            "缺少的正文内容应由相应镜头完整呈现；原文未交代的信息仍放入unresolved_questions。\n"
            + json.dumps({"source_contract_errors": diagnostics, "rejected_proposal": candidate,
                          "repair_guidance": _source_repair_guidance(source.body_order, proposal, diagnostics)},
                         ensure_ascii=False, separators=(",", ":"))
        )
        source_repair_used = True
        model_info = getattr(adapter, "get_model_info", None)
        reserve_repair_output = callable(model_info) and "deepseek" in model_info().model_name.casefold()
        # This bounded edit already contains the complete source and candidate.
        # Reserve its existing output budget for corrected shots: real source
        # repair previously exhausted all 12K tokens without returning any JSON.
        with bind_llm_log_context(stage=f"storyboard.scene_{scene_number}.source_repair"), bind_deepseek_output_recovery(reserve_repair_output):
            repaired = adapter.generate_structured_output_stream(
                repair_prompt, strategy=strategy, output_schema=schema,
            )
        candidate = deepcopy({key: value for key, value in repaired.items() if key != "_meta"}
                             if isinstance(repaired, dict) else repaired)
    raise AssertionError("Unreachable proposal validation state")
