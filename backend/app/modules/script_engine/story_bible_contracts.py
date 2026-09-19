"""Deterministic Story Bible normalization and quality contracts.

These helpers preserve author supplied structure and report mechanical
quality issues. They do not call models or persist planning artifacts.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re

from app.modules.script_engine.long_story_models import (
    IDENTIFIER_PATTERN,
    StoryBibleCharacterInput,
    StoryBibleGenerationOutput,
)
from app.modules.script_engine.mainland_language import story_bible_chinese_issues
from app.modules.script_engine.planning_errors import StoryPlanningInputError


logger = logging.getLogger(__name__)
_TECHNICAL_IDENTIFIER_RE = re.compile(IDENTIFIER_PATTERN)

def _has_story_bible_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return bool(value)
    return True


def _story_bible_candidate_is_substantial(candidate: dict[str, object]) -> bool:
    """Decide whether repair can rely on the returned story instead of source input."""

    narrative_fields = {
        "core_premise",
        "series_goal",
        "theme",
        "central_conflict",
        "ending_direction",
    }
    collection_fields = {
        "character_refs",
        "character_registry",
        "story_lines",
    }
    narrative_count = sum(
        1 for field in narrative_fields if _has_story_bible_value(candidate.get(field))
    )
    collection_count = sum(
        1 for field in collection_fields if _has_story_bible_value(candidate.get(field))
    )
    return (
        narrative_count >= 4
        and collection_count >= 2
        # A concise Story Bible can be well under two thousand characters. The
        # field/collection checks above are the meaningful completeness signal;
        # keep only a small guard against tiny error payloads.
        and len(json.dumps(candidate, ensure_ascii=False, separators=(",", ":"))) >= 1_200
    )


def _story_bible_language_patch_token_budget(
    *,
    field_values: dict[str, object],
    configured_max_tokens: int,
) -> int:
    """Size a bounded patch from its actual values instead of the full schema limits."""

    serialized_chars = len(
        json.dumps(field_values, ensure_ascii=False, separators=(",", ":"))
    )
    estimated_tokens = 800 + len(field_values) * 160 + serialized_chars * 2
    return min(
        configured_max_tokens,
        max(1_600, min(6_000, estimated_tokens)),
    )


def _story_bible_value_at_path(payload: object, path: str) -> object:
    current = payload
    for component in path.split("."):
        if isinstance(current, list):
            if not component.isdigit():
                raise StoryPlanningInputError(
                    f"Story Bible patch path '{path}' contains an invalid list index."
                )
            index = int(component)
            if index >= len(current):
                raise StoryPlanningInputError(
                    f"Story Bible patch path '{path}' is outside the current output."
                )
            current = current[index]
        elif isinstance(current, dict) and component in current:
            current = current[component]
        else:
            raise StoryPlanningInputError(
                f"Story Bible patch path '{path}' does not exist in the current output."
            )
    return current


def _apply_story_bible_text_patch(
    payload: dict[str, object],
    *,
    path: str,
    value: str,
) -> None:
    components = path.split(".")
    current: object = payload
    for component in components[:-1]:
        if isinstance(current, list) and component.isdigit():
            current = current[int(component)]
        elif isinstance(current, dict):
            current = current[component]
        else:
            raise StoryPlanningInputError(
                f"Story Bible patch path '{path}' cannot be applied."
            )
    final_component = components[-1]
    if isinstance(current, list) and final_component.isdigit():
        current[int(final_component)] = value
    elif isinstance(current, dict) and final_component in current:
        current[final_component] = value
    else:
        raise StoryPlanningInputError(
            f"Story Bible patch path '{path}' cannot be applied."
        )


def story_bible_non_chinese_fields(
    output: StoryBibleGenerationOutput,
    *, market_profile: str = "cn_mainland",
) -> list[str]:
    """Validate Chinese narrative while preserving overseas English identities."""
    from app.modules.content_spec.market_profile import market_profile_contract
    names = [entry.name for entry in output.character_registry] if not market_profile_contract(market_profile).is_mainland else []
    return story_bible_chinese_issues(output, allowed_names=names)


_KINSHIP_PREFIX_PATTERN = re.compile(
    r"(?:母亲|父亲|儿子|女儿|哥哥|姐姐|弟弟|妹妹|丈夫|妻子|爱人|恋人)\s*"
)


def story_bible_character_consistency_issues(
    output: StoryBibleGenerationOutput,
    *,
    supplied_characters: list[StoryBibleCharacterInput] | None = None,
) -> list[str]:
    """Find identity errors that a structural schema cannot detect."""
    issues: list[str] = []
    character_refs = {value.casefold() for value in output.character_refs}
    registry_by_ref = {
        item.character_ref.casefold(): item for item in output.character_registry
    }

    if not output.character_registry:
        issues.append("character_registry is required for generated story identities")
    else:
        registry_refs = set(registry_by_ref)
        if registry_refs != character_refs:
            issues.append("character_registry does not match character_refs")
        names: dict[str, str] = {}
        for item in output.character_registry:
            normalized_name = item.name.strip().casefold()
            previous_ref = names.get(normalized_name)
            if previous_ref is not None and previous_ref != item.character_ref.casefold():
                issues.append(
                    f"duplicate canonical character name '{item.name}' for "
                    f"{previous_ref} and {item.character_ref}"
                )
            names[normalized_name] = item.character_ref.casefold()

    for supplied in supplied_characters or []:
        registry_entry = registry_by_ref.get(supplied.character_ref.casefold())
        if registry_entry is None:
            issues.append(f"supplied character '{supplied.character_ref}' is missing")
        elif registry_entry.name.strip() != supplied.name.strip():
            issues.append(
                f"supplied character '{supplied.character_ref}' was renamed from "
                f"'{supplied.name}' to '{registry_entry.name}'"
            )

    # A character arc is owned by one canonical identity. A kinship prefix
    # followed by that same identity is almost always a self-reference error,
    # such as "查清母亲林若晚之死" for the arc owned by 林若晚.
    narrative_values: list[tuple[str, str]] = []
    for index, arc in enumerate(output.character_arc_targets):
        narrative_values.extend(
            [
                (f"character_arc_targets.{index}.external_goal", arc.external_goal),
                (f"character_arc_targets.{index}.internal_need", arc.internal_need or ""),
                (f"character_arc_targets.{index}.starting_state", arc.starting_state),
                (f"character_arc_targets.{index}.target_state", arc.target_state),
            ]
        )
        narrative_values.extend(
            (f"character_arc_targets.{index}.key_turning_points.{item_index}", value)
            for item_index, value in enumerate(arc.key_turning_points)
        )
    for path, value in narrative_values:
        if not value:
            continue
        owner = registry_by_ref.get(
            output.character_arc_targets[int(path.split(".")[1])].character_ref.casefold()
        )
        if owner is None or "母亲" in owner.role or "父亲" in owner.role:
            continue
        for match in _KINSHIP_PREFIX_PATTERN.finditer(value):
            suffix = value[match.end() :]
            if suffix.startswith(owner.name):
                issues.append(
                    f"{path} uses '{match.group().strip()}{owner.name}' as a "
                    "self-referential kinship"
                )
                break
    return issues


def repair_deterministic_story_bible_identity_issues(
    output: StoryBibleGenerationOutput,
) -> StoryBibleGenerationOutput:
    """Repair identity slips whose intended meaning is unambiguous locally."""
    registry_by_ref = {
        item.character_ref.casefold(): item for item in output.character_registry
    }
    repaired_arcs = []
    changed = False
    for arc in output.character_arc_targets:
        owner = registry_by_ref.get(arc.character_ref.casefold())
        if owner is None or "母亲" in owner.role or "父亲" in owner.role:
            repaired_arcs.append(arc)
            continue

        pattern = re.compile(
            rf"((?:母亲|父亲|儿子|女儿|哥哥|姐姐|弟弟|妹妹|丈夫|妻子|爱人|恋人)\s*)"
            rf"{re.escape(owner.name)}"
        )

        def repair(value: str | None) -> str | None:
            nonlocal changed
            if value is None:
                return None
            repaired = pattern.sub(r"\1", value)
            changed = changed or repaired != value
            return repaired

        repaired_arcs.append(
            arc.model_copy(
                update={
                    "external_goal": repair(arc.external_goal),
                    "internal_need": repair(arc.internal_need),
                    "starting_state": repair(arc.starting_state),
                    "target_state": repair(arc.target_state),
                    "key_turning_points": [
                        repair(value) for value in arc.key_turning_points
                    ],
                }
            )
        )
    if not changed:
        return output
    return output.model_copy(update={"character_arc_targets": repaired_arcs})


def _first_text(values: dict[str, object], *keys: str) -> str | None:
    for key in keys:
        value = values.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _normalize_story_bible_relationship(item: dict[str, object], index: int) -> dict[str, object]:
    source = item.get("source_character_ref") or item.get("from")
    target = item.get("target_character_ref") or item.get("to")
    dynamics = (
        item.get("dynamics")
        or item.get("dynamic")
        or item.get("description")
        or item.get("关系")
    )
    relationship_type = (
        item.get("relationship_type")
        or item.get("type")
        or item.get("relationship")
        or "未命名关系"
    )
    stage = item.get("stage") or item.get("阶段")
    stage_text = str(stage).strip() if stage is not None else ""
    dynamic_text = str(dynamics).strip() if dynamics is not None else ""
    initial_state = item.get("initial_state") or item.get("start")
    target_direction = item.get("target_direction") or item.get("target")
    return {
        "relationship_id": item.get("relationship_id") or f"relationship.generated.{index}",
        "source_character_ref": source or f"character.unknown.source.{index}",
        "target_character_ref": target or f"character.unknown.target.{index}",
        "relationship_type": relationship_type,
        "initial_state": (
            initial_state
            or (f"{stage_text}：{dynamic_text}" if stage_text and dynamic_text else dynamic_text)
            or "关系状态待在后续剧情中确认。"
        ),
        "target_direction": (
            target_direction
            or dynamic_text
            or "关系将随主线冲突继续变化。"
        ),
        "locked": bool(item.get("locked", False)),
    }


def _normalize_character_arc_target(
    item: dict[str, object],
    index: int,
) -> dict[str, object]:
    """Flatten common model wrappers and aliases into the arc contract.

    Some providers place the four arc fields under ``arc_target`` (or emit
    concise aliases such as ``goal`` and ``initial_state``) even when the
    response schema asks for the canonical top-level fields.
    """
    nested = item.get("arc_target")
    source = dict(nested) if isinstance(nested, dict) else {}
    source.update({key: value for key, value in item.items() if key != "arc_target"})

    character_ref = (
        source.get("character_ref")
        or source.get("character")
        or source.get("character_id")
        or f"character.generated.{index}"
    )
    arc_text = nested.strip() if isinstance(nested, str) else None
    external_goal = _first_text(
        source,
        "external_goal",
        "external_objective",
        "outer_goal",
        "goal",
        "want",
        "外部目标",
    ) or arc_text
    starting_state = _first_text(
        source,
        "starting_state",
        "initial_state",
        "start_state",
        "beginning_state",
        "起始状态",
    )
    target_state = _first_text(
        source,
        "target_state",
        "final_state",
        "end_state",
        "desired_state",
        "arc_destination",
        "目标状态",
    ) or arc_text
    if arc_text and not starting_state:
        starting_state = "故事开始时仍受旧有处境和既有误解束缚。"

    return {
        "character_ref": character_ref,
        "external_goal": external_goal or "通过行动完成当前人物目标。",
        "internal_need": _first_text(
            source,
            "internal_need",
            "inner_need",
            "need",
            "内在需要",
        ),
        "starting_state": starting_state or "故事开始时仍处于尚未完成转变的状态。",
        "target_state": target_state or "在主线冲突后完成关键转变并承担相应代价。",
        "key_turning_points": source.get("key_turning_points")
        or source.get("turning_points")
        or source.get("关键转折点")
        or [],
        "protected_traits": source.get("protected_traits")
        or source.get("core_traits")
        or source.get("核心特质")
        or [],
    }


def _normalize_story_line_identifiers(
    story_lines: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Keep authored story content while making technical line IDs stable and valid."""

    normalized: list[dict[str, object]] = []
    used: set[str] = set()
    changed_count = 0
    for index, item in enumerate(story_lines, start=1):
        source_id = str(item.get("story_line_id") or "").strip()
        source_identity = source_id.casefold()
        is_valid = (
            3 <= len(source_id) <= 120
            and _TECHNICAL_IDENTIFIER_RE.fullmatch(source_id) is not None
            and source_identity not in used
        )
        if is_valid:
            story_line_id = source_id
        else:
            digest_source = json.dumps(
                {
                    "source_id": source_id,
                    "title": item.get("title"),
                    "index": index,
                },
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            digest = hashlib.sha1(digest_source.encode("utf-8")).hexdigest()[:10]
            base_id = f"storyline.generated.{index}.{digest}"
            story_line_id = base_id
            collision = 2
            while story_line_id.casefold() in used:
                story_line_id = f"{base_id}.{collision}"
                collision += 1
            changed_count += 1
        used.add(story_line_id.casefold())
        normalized.append({**item, "story_line_id": story_line_id})

    if changed_count:
        logger.info(
            "Normalized Story Bible technical story-line IDs locally "
            "changed_count=%d total_count=%d",
            changed_count,
            len(normalized),
        )
    return normalized


def _normalize_story_line(item: dict[str, object], index: int) -> dict[str, object]:
    nested = item.get("story_line")
    source = dict(nested) if isinstance(nested, dict) else {}
    source.update({key: value for key, value in item.items() if key != "story_line"})
    story_line_type = source.get("story_line_type") or source.get("type")
    if story_line_type not in {"main", "subplot", "character_arc"}:
        story_line_type = "main" if index == 1 else "subplot"
    premise = _first_text(
        source,
        "premise",
        "responsibility",
        "story_duty",
        "line_goal",
        "development",
        "description",
        "arc",
        "主线职责",
    )
    resolution = _first_text(
        source,
        "planned_resolution",
        "resolution",
        "resolution_direction",
        "outcome",
        "payoff",
        "ending",
        "arc",
        "计划收束",
    )
    title = _first_text(source, "title", "name", "story_line_title", "故事线标题")
    if title and re.fullmatch(r"故事线\s*\d+", title):
        title = None
    if premise == "围绕主线冲突推进并形成阶段性变化。":
        premise = None
    if resolution == "在后续剧情中完成与主线方向一致的收束。":
        resolution = None
    return {
        "story_line_id": source.get("story_line_id") or source.get("id") or f"storyline.generated.{index}",
        "title": title,
        "story_line_type": story_line_type,
        "premise": premise,
        "planned_resolution": resolution,
        "character_refs": source.get("character_refs") or source.get("characters") or [],
    }


def _normalize_story_phase(item: dict[str, object], index: int) -> dict[str, object]:
    phase_number = item.get("phase") or index
    return {
        "story_line_id": item.get("story_line_id") or f"storyline.phase.{phase_number}",
        "title": item.get("title"),
        "story_line_type": "main" if index == 1 else "subplot",
        "premise": item.get("premise") or item.get("summary") or item.get("description"),
        "planned_resolution": item.get("planned_resolution") or item.get("resolution") or item.get("outcome"),
        "character_refs": item.get("character_refs") or [],
    }


def _normalize_escalation_stage(
    item: dict[str, object],
    index: int,
) -> dict[str, object]:
    stage_number = item.get("phase") or item.get("level") or index
    title_value = item.get("title") or item.get("name") or item.get("stage") or item.get("层级")
    title = title_value if isinstance(title_value, str) else None
    goal = (
        item.get("stage_goal")
        or item.get("goal")
        or item.get("summary")
        or item.get("conflict")
        or item.get("冲突")
    )
    opposition = (
        item.get("stage_opposition")
        or item.get("opposition")
        or item.get("stage_boss")
        or item.get("antagonist")
        or item.get("pressure")
        or item.get("larger_pressure")
        or item.get("更大压力")
    )
    payoff = (
        item.get("stage_payoff")
        or item.get("payoff")
        or item.get("resolution")
        or item.get("outcome")
        or item.get("reward")
        or item.get("local_payoff")
        or item.get("局部回报")
    )
    escalation = (
        item.get("escalation_to_next")
        or item.get("escalation")
        or item.get("next_pressure")
        or item.get("larger_pressure")
        or item.get("更大压力")
    )
    stage_label = title or f"阶段{stage_number}"
    return {
        "stage_id": item.get("stage_id") or f"escalation.stage.{stage_number}",
        "title": stage_label,
        # Missing stage fields must remain visible as editorial work, rather
        # than becoming reusable pseudo-content that later prompts can copy.
        "stage_goal": goal or f"待补充：《{stage_label}》阶段的具体目标与人物选择。",
        "stage_opposition": (
            opposition
            or f"待补充：阻止《{stage_label}》阶段目标的具体人物、规则或资源门槛。"
        ),
        "stage_payoff": (
            payoff
            or f"待补充：《{stage_label}》阶段必须兑现的可验证结果与人物代价。"
        ),
        "escalation_to_next": (
            escalation
            or f"待补充：《{stage_label}》阶段结果将具体改变的对手、规则、资源或关系。"
        ),
    }
