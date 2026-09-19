"""Provider field normalization shared by full drafts and repair fragments.

Preserves the existing alias and compatibility-default policy. Evidence
validation and model repair remain responsibilities of the generation service.
"""

from __future__ import annotations

from copy import deepcopy
import hashlib
import re

from app.modules.master_script.models import CharacterStateUpdate
from app.script_delivery_contract import (
    DEFAULT_ENDING_MODE,
    EndingMode,
    ending_mode_requires_hook,
)


_TONE_ALIASES = {
    "intense": "intense",
    "紧张": "intense",
    "紧张激烈": "intense",
    "冷峻克制，带爽感": "intense",
    "冷峻克制带爽感": "intense",
    "紧张、爽感": "intense",
    "冷峻": "intense",
    "冷峻克制": "intense",
    "melodramatic": "melodramatic",
    "情节剧": "melodramatic",
    "强情节": "melodramatic",
    "狗血": "melodramatic",
    "suspenseful": "suspenseful",
    "悬疑": "suspenseful",
    "悬念": "suspenseful",
    "emotional": "emotional",
    "情感": "emotional",
    "情感向": "emotional",
    "温情": "emotional",
    "冷峻而温情": "emotional",
    "冷峻温情": "emotional",
}

_ENUM_FIELDS_BY_COLLECTION: dict[
    str,
    tuple[tuple[str, dict[str, str]], ...],
] = {
    "character_state_updates": (
        (
            "life_status",
            {
                "alive": "alive",
                "存活": "alive",
                "活着": "alive",
                "dead": "dead",
                "死亡": "dead",
                "已死": "dead",
                "missing": "missing",
                "失踪": "missing",
                "unknown": "unknown",
                "未知": "unknown",
            },
        ),
    ),
    "relationship_state_updates": (),
    "continuity_state_updates": (
        (
            "entity_type",
            {
                "character": "character", "角色": "character", "人物": "character",
                "person": "character", "people": "character", "人": "character",
                "item": "item", "物品": "item", "道具": "item",
                "object": "item", "thing": "item", "物件": "item",
                "location": "location", "地点": "location", "场所": "location",
                "place": "location", "空间": "location", "房间": "location",
                "organization": "organization", "组织": "organization",
                "机构": "organization", "company": "organization", "团体": "organization",
                "environment": "environment", "环境": "environment",
                "world": "environment", "世界": "environment", "天气": "environment",
                "society": "society", "社会": "society", "社会关系": "society",
                "time": "time", "时间": "time", "时点": "time",
            },
        ),
        (
            "state_domain",
            {
                "existence": "existence", "存在": "existence",
                "life": "life", "生命": "life",
                "health": "health", "健康": "health",
                "ability": "ability", "能力": "ability",
                "condition": "condition", "状态": "condition",
                "ownership": "ownership", "所有权": "ownership",
                "possession": "possession", "持有": "possession",
                "location": "location", "位置": "location",
                "access": "access", "权限": "access",
                "affiliation": "affiliation", "归属": "affiliation",
                "authority": "authority", "权力": "authority",
                "identity": "identity", "身份": "identity",
                "resource": "resource", "资源": "resource",
                "rule": "rule", "规则": "rule",
                "schedule": "schedule", "日程": "schedule",
                "weather": "weather", "天气": "weather",
                "reputation": "reputation", "声誉": "reputation",
                "legal_status": "legal_status", "法律状态": "legal_status",
                "technology": "technology", "技术": "technology",
                "knowledge": "knowledge", "知识": "knowledge", "认知": "knowledge",
                "intelligence": "knowledge", "information": "knowledge",
                "obligation": "obligation", "义务": "obligation",
                "environment": "environment", "环境": "environment",
                "mobilization": "condition", "readiness": "condition",
            },
        ),
        (
            "transition",
            {
                "established": "established", "建立": "established", "确立": "established",
                "changed": "changed", "改变": "changed",
                "resolved": "resolved", "解决": "resolved",
                "acquired": "acquired", "获得": "acquired",
                "lost": "lost", "失去": "lost",
                "moved": "moved", "移动": "moved",
                "transferred": "transferred", "转移": "transferred",
                "destroyed": "destroyed", "销毁": "destroyed",
                "died": "died", "死亡": "died",
                "recovered": "recovered", "恢复": "recovered",
                "repaired": "repaired", "修复": "repaired",
                "retained": "established", "maintained": "established",
                "unchanged": "established", "保持": "established",
                "activated": "changed", "triggered": "changed",
                "pending": "changed", "escalated": "changed",
                "updated": "changed", "激活": "changed", "待定": "changed",
                "injured": "changed", "escaped": "moved",
                "observed": "established", "impending": "established",
                "acquired_information": "acquired",
                "disabled": "changed", "restricted": "changed",
                "preserved": "established",
                "discovered": "acquired", "heard": "acquired",
            },
        ),
        (
            "persistence",
            {
                "temporary": "temporary", "临时": "temporary",
                "ongoing": "ongoing", "持续": "ongoing",
                "persistent": "ongoing", "indefinite": "ongoing",
                "pending": "ongoing",
                "permanent": "permanent", "永久": "permanent",
                "lasting_mark": "permanent", "destroyed": "permanent",
            },
        ),
    ),
    "story_line_updates": (
        (
            "status",
            {
                "setup": "setup", "铺垫": "setup",
                "active": "active", "进行中": "active",
                "progressing": "active", "advanced": "active",
                "resolved": "resolved", "已解决": "resolved", "收束": "resolved",
                "seeded": "setup", "introduced": "setup",
            },
        ),
        (
            "contribution_type",
            {
                "setup": "setup", "铺垫": "setup",
                "progress": "progress", "推进": "progress",
                "turning_point": "turning_point", "转折": "turning_point",
                "payoff": "payoff", "回收": "payoff",
                "resolution": "resolution", "收束": "resolution",
                "exposition": "setup", "reveal": "progress",
                "development": "progress", "escalation": "progress",
                "foundation": "setup", "manifestation": "progress",
                "choice": "turning_point",
            },
        ),
        (
            "planned_alignment",
            {
                "aligned": "aligned", "对齐": "aligned", "一致": "aligned",
                "expanded": "expanded", "扩展": "expanded",
                "deviated": "deviated", "偏离": "deviated",
            },
        ),
    ),
    "setup_payoff_updates": (
        (
            "action",
            {
                "setup": "setup", "埋设": "setup", "铺垫": "setup",
                "reinforce": "reinforce", "加强": "reinforce",
                "partial_payoff": "partial_payoff", "部分回收": "partial_payoff",
                "payoff": "payoff", "回收": "payoff", "完全回收": "payoff",
                "defer": "defer", "延后": "defer",
            },
        ),
        (
            "status",
            {
                "setup": "setup", "铺垫": "setup",
                "active": "active", "进行中": "active",
                "partial_payoff": "active", "部分回收": "active",
                "reinforced": "active", "加强": "active",
                "deferred": "active", "延后": "active",
                "established": "setup",
                "paid_off": "paid_off", "已回收": "paid_off",
            },
        ),
    ),
}


def normalize_draft_scalar_contracts(
    output: dict[str, object],
    *,
    ending_mode: EndingMode | str | None = None,
    partial: bool = False,
) -> None:
    """Normalize fields in place, preserving the legacy order for partial patches."""

    try:
        resolved_ending_mode = EndingMode(
            ending_mode
            if ending_mode is not None
            else output.get("ending_mode") or DEFAULT_ENDING_MODE.value
        )
    except (TypeError, ValueError):
        resolved_ending_mode = DEFAULT_ENDING_MODE

    _normalize_header(output)
    defaults = _compatibility_defaults(output)
    _wrap_root_collections(output)
    _normalize_characters(output, defaults)
    _normalize_character_states(output, defaults)
    _normalize_scene_fields(output)
    scene_number_map = _normalize_scene_numbers(output)
    _normalize_ledger_fields(output, scene_number_map)
    _normalize_hook(output, resolved_ending_mode, scene_number_map, partial=partial)


def _parse_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    if not isinstance(value, str):
        return None
    match = re.search(r"[-+]?\d+(?:\.\d+)?", value.replace(",", ""))
    if match is not None:
        number = float(match.group())
        return int(number) if number.is_integer() else None
    chinese_match = re.search(r"[零〇一二三四五六七八九十百千万两]+", value)
    if chinese_match is None:
        return None
    token = chinese_match.group()
    digits = {
        "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3,
        "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
    }
    if not any(character in token for character in "十百千万"):
        return int("".join(str(digits[character]) for character in token))
    number = 0
    total = 0
    for character in token:
        if character in digits:
            number = digits[character]
            continue
        unit = {"十": 10, "百": 100, "千": 1_000, "万": 10_000}[character]
        if unit == 10_000:
            total = (total + number) * unit
        else:
            total += (number or 1) * unit
        number = 0
    return total + number


def _normalize_enum(
    target: dict[str, object],
    field_name: str,
    aliases: dict[str, str],
) -> None:
    value = target.get(field_name)
    if not isinstance(value, str):
        return
    normalized_value = value.strip().casefold().replace(" ", "_")
    if normalized_value in aliases:
        target[field_name] = aliases[normalized_value]
        return
    # GLM occasionally adds a short qualifier (for example
    # "world fact" or "supporting person") instead of returning the
    # exact enum token. These mappings are mechanical and do not alter
    # the event, only the transport spelling of a typed field.
    compact = re.sub(r"[\s_、，,。:：()（）/\\-]+", "", normalized_value)
    if field_name == "entity_type":
        fuzzy_aliases = (
            (("character", "person", "people", "human", "role", "人物", "角色", "人"), "character"),
            (("item", "object", "thing", "prop", "物品", "道具", "物件"), "item"),
            (("location", "place", "space", "room", "地点", "场所", "位置", "空间"), "location"),
            (("organization", "organisation", "company", "group", "机构", "组织", "公司", "团体"), "organization"),
            (("environment", "world", "weather", "setting", "环境", "世界", "天气"), "environment"),
            (("society", "social", "社会", "社会关系"), "society"),
            (("time", "date", "timeline", "时间", "时点", "日期"), "time"),
        )
        for markers, canonical in fuzzy_aliases:
            if any(marker in compact for marker in markers):
                target[field_name] = canonical
                return
        # Information/evidence is represented by the concrete carrier
        # in this contract. When the model emits only the abstract
        # concept, ``item`` is the least destructive canonical type.
        if any(marker in compact for marker in ("information", "evidence", "clue", "document", "信息", "证据", "线索", "资料")):
            target[field_name] = "item"
            return
        # Final deterministic transport fallback. The model is free to
        # describe a continuity entity in natural language, but the
        # persisted contract has only seven concrete carriers. Infer
        # the carrier from stable identifiers before defaulting to the
        # least destructive concrete carrier (item).
        identity_text = " ".join(
            str(target.get(key) or "").casefold()
            for key in ("entity_key", "entity_name", "current_state")
        )
        identity_compact = re.sub(r"[\s_、，,。:：()（）/\\-]+", "", identity_text)
        inferred_aliases = (
            (("character", "person", "people", "human", "人物", "角色", "人物状态", "角色状态"), "character"),
            (("location", "place", "room", "scene", "地点", "场所", "房间", "地址"), "location"),
            (("organization", "organisation", "company", "group", "机构", "组织", "公司", "团体"), "organization"),
            (("environment", "world", "weather", "setting", "环境", "世界", "天气"), "environment"),
            (("society", "social", "社会"), "society"),
            (("time", "date", "timeline", "时间", "日期", "时点"), "time"),
        )
        for markers, canonical in inferred_aliases:
            if any(marker in identity_compact for marker in markers):
                target[field_name] = canonical
                return
        if compact or target.get("entity_key"):
            target[field_name] = "item"
            return
    if field_name == "state_domain":
        if any(marker in compact for marker in ("physical", "physicalstate", "物理", "物理状态", "外观")):
            target[field_name] = "condition"
            return
        fuzzy_aliases = (
            (("intelligence", "information", "awareness", "intel", "情报", "信息", "认知"), "knowledge"),
            (("mobilization", "readiness", "operational", "activation", "动员", "战备", "就绪"), "condition"),
            (("funding", "budget", "money", "supply", "资金", "预算", "物资"), "resource"),
            (("relationship", "membership", "alliance", "关系", "成员", "联盟"), "affiliation"),
        )
        for markers, canonical in fuzzy_aliases:
            if any(marker in compact for marker in markers):
                target[field_name] = canonical
                return
        # The concrete state remains in current_state/change_cause.
        # Falling back to the neutral condition bucket repairs only
        # an unsupported classification label.
        if compact or target.get("entity_key"):
            target[field_name] = "condition"
            return
    if field_name == "life_status" and any(
        marker in compact
        for marker in ("健康", "安全", "存活", "活着", "正常", "行动")
    ):
        target[field_name] = "alive"
        return
    if field_name == "transition":
        transition_aliases = (
            (("establish", "established", "create", "created", "confirm", "confirmed", "建立", "确立", "确认"), "established"),
            (("resolve", "resolved", "settle", "settled", "close", "closed", "解决", "完成", "收束"), "resolved"),
            (("acquire", "acquired", "discover", "discovered", "reveal", "revealed", "learned", "unlocked", "获得", "发现", "揭示", "查明", "解锁"), "acquired"),
            (("lose", "lost", "missing", "disconnected", "失去", "丢失", "失联", "断联"), "lost"),
            (("move", "moved", "relocate", "relocated", "leave", "left", "离开", "移动", "转移"), "moved"),
            (("transfer", "transferred", "交换", "转交"), "transferred"),
            (("destroy", "destroyed", "break", "broken", "销毁", "摧毁", "损毁", "破坏"), "destroyed"),
            (("die", "died", "death", "dead", "死亡", "身亡"), "died"),
            (("recover", "recovered", "repair", "repaired", "restore", "restored", "恢复", "修复", "重建"), "recovered"),
        )
        for markers, canonical in transition_aliases:
            if any(marker in compact for marker in markers):
                target[field_name] = canonical
                return
        # Unknown short labels still describe a state change; this is
        # the least lossy canonical transition and avoids a whole
        # episode regeneration for provider-specific wording.
        if compact:
            target[field_name] = "changed"
            return
    if field_name == "persistence":
        if any(marker in compact for marker in ("temporary", "singleuse", "shortterm", "临时", "短暂", "一次性")):
            target[field_name] = "temporary"
            return
        if any(marker in compact for marker in ("permanent", "lasting", "enduring", "longterm", "永久", "长期", "持久")):
            target[field_name] = "permanent"
            return
        if compact:
            target[field_name] = "ongoing"
            return


def _wrap_single_value(target: dict[str, object], field_name: str) -> None:
    value = target.get(field_name)
    if value is not None and not isinstance(value, list):
        target[field_name] = [value]


def _normalize_scene_number_list(
    target: dict[str, object],
    field_name: str,
    scene_number_map: dict[int, int],
) -> None:
    _wrap_single_value(target, field_name)
    values = target.get(field_name)
    if not isinstance(values, list):
        return
    normalized_values: list[object] = []
    for value in values:
        number = _parse_int(value)
        normalized_values.append(
            scene_number_map.get(number, number) if number is not None else value
        )
    target[field_name] = normalized_values


def normalize_script_tone(tone: str) -> str:
    output: dict[str, object] = {"tone": tone}
    _normalize_enum(output, "tone", _TONE_ALIASES)
    tone = output.get("tone")
    if isinstance(tone, str) and tone not in {
        "intense",
        "melodramatic",
        "suspenseful",
        "emotional",
    }:
        compact_tone = re.sub(r"[\s、，,。]+", "", tone.casefold())
        if any(marker in compact_tone for marker in ("悬疑", "悬念", "惊悚", "谜")):
            output["tone"] = "suspenseful"
        elif any(marker in compact_tone for marker in ("温情", "情感", "感人", "治愈")):
            output["tone"] = "emotional"
        elif any(marker in compact_tone for marker in ("狗血", "强情节", "抓马", "虐恋")):
            output["tone"] = "melodramatic"
        elif re.search(r"[\u4e00-\u9fff]", compact_tone):
            # Free-form Chinese tone descriptions most commonly describe
            # dramatic pressure. This enum mapping changes no story content.
            output["tone"] = "intense"
    return str(output["tone"])


def _normalize_header(output: dict[str, object]) -> None:
    if isinstance(output.get("tone"), str):
        output["tone"] = normalize_script_tone(output["tone"])
    duration = _parse_int(output.get("target_duration_seconds"))
    if duration is not None:
        output["target_duration_seconds"] = duration


def _compatibility_defaults(output: dict[str, object]) -> dict[str, str]:
    language = str(output.get("language") or "").casefold()
    is_chinese = language.startswith(("zh", "中文", "简体", "中国"))
    defaults = {
        "character_role": "配角" if is_chinese else "Supporting character",
        "character_description": "参与本集行动并受到事件影响的角色。"
        if is_chinese
        else "A character involved in this episode's action and consequences.",
        "character_motivation": "推动当前行动并完成本集目标。"
        if is_chinese
        else "Advance the current action and fulfill this episode's goal.",
        "current_goal": "推进本集目标并处理当前压力。"
        if is_chinese
        else "Advance the episode goal and handle the current pressure.",
        "emotional_state": "承受当前事件带来的压力。"
        if is_chinese
        else "Under pressure from the current events.",
        "change_summary": "本集事件改变了角色的处境。"
        if is_chinese
        else "The episode changes the character's situation.",
        "change_cause": "由本集已发生的行动和结果造成。"
        if is_chinese
        else "Caused by the actions and outcomes shown in this episode.",
    }
    return defaults


def _wrap_root_collections(output: dict[str, object]) -> None:
    for field_name in (
        "characters",
        "character_state_updates",
        "relationship_state_updates",
        "continuity_state_updates",
        "story_line_updates",
        "setup_payoff_updates",
        "scenes",
    ):
        value = output.get(field_name)
        if isinstance(value, dict):
            output[field_name] = [value]


def _normalize_characters(
    output: dict[str, object], defaults: dict[str, str],
) -> None:
    characters = output.get("characters")
    if isinstance(characters, list):
        normalized_characters: list[object] = []
        for item in characters:
            if isinstance(item, str) and item.strip():
                item = {
                    "name": item.strip(),
                    "role": defaults["character_role"],
                    "description": defaults["character_description"],
                    "motivation": defaults["character_motivation"],
                }
            normalized_characters.append(item)
            if not isinstance(item, dict):
                continue
            description = str(item.get("description") or "").strip()
            role = str(item.get("role") or "").strip()
            motivation = str(
                item.get("motivation")
                or item.get("goal")
                or item.get("desire")
                or description
                or defaults["character_motivation"]
            ).strip()
            if len(role) < 2:
                item["role"] = defaults["character_role"]
            if len(description) < 10:
                item["description"] = defaults["character_description"]
            if (
                not str(item.get("motivation") or "").strip()
                or len(motivation) < 5
            ):
                item["motivation"] = (
                    motivation
                    if len(motivation) >= 5
                    else defaults["character_motivation"]
                )
        output["characters"] = normalized_characters


def _normalize_character_states(
    output: dict[str, object], defaults: dict[str, str],
) -> None:
    character_updates = output.get("character_state_updates")
    if isinstance(character_updates, list):
        character_names = {
            str(item.get("name") or "").strip()
            for item in output.get("characters", [])
            if isinstance(item, dict) and str(item.get("name") or "").strip()
        }
        allowed_update_fields = set(CharacterStateUpdate.model_fields)
        expanded_updates: list[object] = []
        for item in character_updates:
            if isinstance(item, dict) and not str(
                item.get("character_name") or ""
            ).strip():
                named_states = [
                    (key, value)
                    for key, value in item.items()
                    if key not in allowed_update_fields
                    and isinstance(value, str)
                    and value.strip()
                    and (not character_names or key in character_names)
                ]
                if named_states:
                    shared = {
                        key: value
                        for key, value in item.items()
                        if key in allowed_update_fields and key != "character_name"
                    }
                    for character_name, state_text in named_states:
                        expanded = deepcopy(shared)
                        expanded.update(
                            {
                                "character_name": character_name,
                                "current_goal": state_text[:240],
                                "emotional_state": state_text[:160],
                                "change_summary": state_text[:300],
                                "change_cause": defaults["change_cause"],
                            }
                        )
                        expanded_updates.append(expanded)
                    continue
            expanded_updates.append(item)
        output["character_state_updates"] = expanded_updates
        for item in expanded_updates:
            if not isinstance(item, dict):
                continue
            before = str(item.pop("state_before", "") or "").strip()
            after = str(item.pop("state_after", "") or "").strip()
            if not str(item.get("current_goal") or "").strip():
                item["current_goal"] = after or before or defaults["current_goal"]
            if not str(item.get("emotional_state") or "").strip():
                item["emotional_state"] = after or before or defaults["emotional_state"]
            if not str(item.get("change_summary") or "").strip():
                item["change_summary"] = (
                    f"{before} -> {after}" if before and after else after or before
                ) or defaults["change_summary"]
            if not str(item.get("change_cause") or "").strip():
                item["change_cause"] = defaults["change_cause"]
            evidence = item.get("evidence_scene_numbers")
            if evidence is None:
                raw_scenes = output.get("scenes")
                first_scene = (
                    raw_scenes[0]
                    if isinstance(raw_scenes, list) and raw_scenes
                    else None
                )
                first_number = (
                    _parse_int(first_scene.get("scene_number"))
                    if isinstance(first_scene, dict)
                    else None
                )
                item["evidence_scene_numbers"] = [first_number or 1]
            elif not isinstance(evidence, list):
                item["evidence_scene_numbers"] = [evidence]
            life_status = str(item.get("life_status") or "").strip().casefold()
            if life_status not in {"", "alive", "dead", "missing", "unknown"}:
                if any(marker in life_status for marker in ("死亡", "已死", "身亡")):
                    item["life_status"] = "dead"
                elif any(marker in life_status for marker in ("失踪", "失联", "下落不明")):
                    item["life_status"] = "missing"
                elif any(
                    marker in life_status
                    for marker in ("存活", "活着", "正常", "行动", "在场")
                ):
                    item["life_status"] = "alive"


def _normalize_scene_fields(output: dict[str, object]) -> None:
    scenes = output.get("scenes")
    if isinstance(scenes, list):
        for scene in scenes:
            if not isinstance(scene, dict):
                continue
            legacy_aliases = {
                "location": "setting",
                "summary": "beat_summary",
                "beats": "character_actions",
                "scene_title": "slug",
            }
            for legacy_name, current_name in legacy_aliases.items():
                legacy_value = scene.pop(legacy_name, None)
                if current_name not in scene and legacy_value is not None:
                    scene[current_name] = legacy_value
            dialogues = scene.get("dialogues")
            if not isinstance(dialogues, list):
                continue
            non_empty_dialogues = [
                dialogue
                for dialogue in dialogues
                if not isinstance(dialogue, dict)
                or str(dialogue.get("text") or "").strip()
            ]
            if non_empty_dialogues:
                dialogues = non_empty_dialogues
                scene["dialogues"] = dialogues
            for dialogue in dialogues:
                if not isinstance(dialogue, dict):
                    continue
                intent = str(dialogue.get("intent") or "").strip()
                if len(intent) < 3:
                    if not intent:
                        dialogue["intent"] = "推动当前对白。"
                    elif re.search(r"[\u4e00-\u9fff]", intent):
                        dialogue["intent"] = "意图：" + intent
                    else:
                        dialogue["intent"] = intent + "." * (3 - len(intent))


def _normalize_scene_numbers(output: dict[str, object]) -> dict[int, int]:
    scenes = output.get("scenes")
    scene_number_map: dict[int, int] = {}
    if isinstance(scenes, list):
        parsed_numbers = [
            _parse_int(scene.get("scene_number")) if isinstance(scene, dict) else None
            for scene in scenes
        ]
        keep_numbers = (
            all(number is not None and number > 0 for number in parsed_numbers)
            and len(set(parsed_numbers)) == len(parsed_numbers)
        )
        for index, scene in enumerate(scenes, start=1):
            if not isinstance(scene, dict):
                continue
            old_number = parsed_numbers[index - 1]
            new_number = old_number if keep_numbers and old_number is not None else index
            if old_number is not None:
                scene_number_map[old_number] = new_number
            scene["scene_number"] = new_number
            _wrap_single_value(scene, "character_actions")
            _wrap_single_value(scene, "dialogues")
            cliffhanger = scene.get("cliffhanger")
            if isinstance(cliffhanger, str):
                normalized_flag = cliffhanger.strip().casefold()
                if normalized_flag in {"是", "有", "true", "yes", "1"}:
                    scene["cliffhanger"] = True
                elif normalized_flag in {"否", "无", "false", "no", "0"}:
                    scene["cliffhanger"] = False
            causality = scene.get("scene_causality")
            if isinstance(causality, dict):
                predecessor = _parse_int(causality.get("caused_by_scene_number"))
                if predecessor is not None:
                    causality["caused_by_scene_number"] = scene_number_map.get(
                        predecessor,
                        predecessor,
                    )
    return scene_number_map


def _normalize_story_line_state(item: dict[str, object]) -> None:
    raw_status = str(item.get("status") or "").strip().casefold()
    raw_status_compact = re.sub(
        r"[\s_、，,。:：()（）/\\-]+",
        "",
        raw_status,
    )
    contribution_values = {
        "progress": "progress",
        "推进": "progress",
        "turning_point": "turning_point",
        "转折": "turning_point",
        "payoff": "payoff",
        "回收": "payoff",
        "resolution": "resolution",
        "收束": "resolution",
    }
    if raw_status not in {"setup", "铺垫", "active", "进行中", "resolved", "已解决", "收束"}:
        if any(marker in raw_status_compact for marker in ("resolution", "resolved", "closed", "complete", "收束", "解决", "完成")):
            item["status"] = "resolved"
        elif any(marker in raw_status_compact for marker in ("setup", "seed", "seeded", "introduce", "introduced", "foundation", "铺垫", "埋设")):
            item["status"] = "setup"
        elif raw_status_compact:
            item["status"] = "active"
        raw_status = raw_status_compact
    if raw_status in contribution_values:
        contribution_type = str(item.get("contribution_type") or "").strip().casefold()
        if contribution_type not in {
            "setup", "progress", "turning_point", "payoff", "resolution"
        }:
            item["contribution_type"] = contribution_values[raw_status]
        item["status"] = (
            "resolved"
            if raw_status in {"resolution", "收束"}
            else "active"
        )
    contribution_type = str(
        item.get("contribution_type") or ""
    ).strip().casefold()
    if contribution_type not in {
        "setup",
        "progress",
        "turning_point",
        "payoff",
        "resolution",
    }:
        normalized_status = str(
            item.get("status") or "active"
        ).strip().casefold()
        item["contribution_type"] = {
            "setup": "setup",
            "resolved": "resolution",
        }.get(normalized_status, "progress")


def _normalize_setup_payoff_state(item: dict[str, object]) -> None:
    raw_action = str(item.get("action") or "").strip().casefold()
    action_compact = re.sub(
        r"[\s_、，,。:：()（）/\\-]+",
        "",
        raw_action,
    )
    if raw_action not in {
        "setup", "埋设", "铺垫", "reinforce", "加强",
        "partial_payoff", "部分回收", "payoff", "回收", "完全回收",
        "defer", "延后",
    }:
        if any(marker in action_compact for marker in ("payoff", "paid", "resolve", "回收", "兑现", "完成")):
            item["action"] = "payoff"
        elif any(marker in action_compact for marker in ("defer", "delay", "postpone", "延后", "推迟")):
            item["action"] = "defer"
        elif any(marker in action_compact for marker in ("partial", "half", "部分")):
            item["action"] = "partial_payoff"
        elif action_compact:
            item["action"] = "reinforce"
    raw_setup_status = str(item.get("status") or "").strip().casefold()
    setup_status_compact = re.sub(
        r"[\s_、，,。:：()（）/\\-]+",
        "",
        raw_setup_status,
    )
    if raw_setup_status not in {
        "setup", "铺垫", "active", "进行中", "partial_payoff",
        "部分回收", "reinforced", "加强", "deferred", "延后",
        "established", "paid_off", "已回收",
    } and setup_status_compact:
        if any(marker in setup_status_compact for marker in ("paid", "payoff", "resolved", "complete", "回收", "兑现", "完成")):
            item["status"] = "paid_off"
            item["action"] = "payoff"
        elif any(marker in setup_status_compact for marker in ("setup", "seed", "introduced", "铺垫", "埋设")):
            item["status"] = "setup"
        else:
            item["status"] = "active"


def _normalize_knowledge_states(item: dict[str, object]) -> None:
    knowledge_states = item.get("knowledge_states")
    if isinstance(knowledge_states, (dict, str)):
        knowledge_states = [knowledge_states]
        item["knowledge_states"] = knowledge_states
    if isinstance(knowledge_states, list):
        normalized_knowledge_states: list[object] = []
        for knowledge_index, knowledge_state in enumerate(knowledge_states):
            if (
                isinstance(knowledge_state, dict)
                and not set(knowledge_state).intersection(
                    {"knowledge_key", "statement", "status"}
                )
            ):
                for label, raw_state in knowledge_state.items():
                    label_text = str(label).strip()
                    state_text = str(raw_state).strip()
                    if not label_text or not state_text:
                        continue
                    statement = f"{label_text}：{state_text}"[:300]
                    compact_state = re.sub(
                        r"[\s_、，,。:：()（）/\\-]+",
                        "",
                        state_text.casefold(),
                    )
                    if any(
                        marker in compact_state
                        for marker in ("证伪", "错误", "不成立")
                    ):
                        status = "disproved"
                    elif any(
                        marker in compact_state
                        for marker in ("遗忘", "忘记")
                    ):
                        status = "forgotten"
                    elif any(
                        marker in compact_state
                        for marker in (
                            "怀疑", "未知", "未查明", "未确认", "无实据"
                        )
                    ):
                        status = "suspected"
                    elif any(
                        marker in compact_state
                        for marker in ("相信", "认为", "推测")
                    ):
                        status = "believed"
                    else:
                        status = "known"
                    digest = hashlib.sha256(
                        f"{label_text}|{statement}".encode("utf-8")
                    ).hexdigest()[:12]
                    normalized_knowledge_states.append({
                        "knowledge_key": f"generated.knowledge.{digest}",
                        "statement": statement,
                        "status": status,
                    })
                continue
            if isinstance(knowledge_state, str):
                statement = knowledge_state.strip()
                if statement:
                    knowledge_state = {
                        "knowledge_key": (
                            f"episode.knowledge.{knowledge_index + 1}"
                        ),
                        "statement": statement,
                        "status": "known",
                    }
            normalized_knowledge_states.append(knowledge_state)
            if isinstance(knowledge_state, dict):
                if not str(knowledge_state.get("knowledge_key") or "").strip():
                    knowledge_state["knowledge_key"] = (
                        f"episode.knowledge.{knowledge_index + 1}"
                    )
                if not str(knowledge_state.get("statement") or "").strip():
                    knowledge_state["statement"] = "本集确认的连续性事实。"
                _normalize_enum(
                    knowledge_state,
                    "status",
                    {
                        "known": "known", "已知": "known", "知道": "known",
                        "believed": "believed", "相信": "believed",
                        "suspected": "suspected", "怀疑": "suspected",
                        "disproved": "disproved", "证伪": "disproved",
                        "forgotten": "forgotten", "遗忘": "forgotten",
                    },
                )
                if not str(knowledge_state.get("status") or "").strip():
                    knowledge_state["status"] = "known"
        item["knowledge_states"] = normalized_knowledge_states


def _normalize_ledger_fields(
    output: dict[str, object], scene_number_map: dict[int, int],
) -> None:
    for collection_name, field_specs in _ENUM_FIELDS_BY_COLLECTION.items():
        collection = output.get(collection_name)
        if not isinstance(collection, list):
            continue
        for item in collection:
            if not isinstance(item, dict):
                continue
            for field_name in (
                "knowledge_changes",
                "health_conditions",
                "action_capabilities",
                "lasting_marks",
                "active_constraints",
            ):
                _wrap_single_value(item, field_name)
                values = item.get(field_name)
                if isinstance(values, list):
                    item[field_name] = [
                        value
                        for value in values
                        if value is not None
                        and not (isinstance(value, str) and not value.strip())
                    ]
            for field_name, aliases in field_specs:
                _normalize_enum(item, field_name, aliases)
            if collection_name == "story_line_updates":
                _normalize_story_line_state(item)
            elif collection_name == "setup_payoff_updates":
                _normalize_setup_payoff_state(item)
            _normalize_scene_number_list(item, "evidence_scene_numbers", scene_number_map)
            _normalize_knowledge_states(item)
            if collection_name == "continuity_state_updates":
                entity_key = str(item.get("entity_key") or "").strip()
                if entity_key and not re.fullmatch(
                    r"[a-z0-9_.:-]+",
                    entity_key,
                ):
                    entity_type = str(item.get("entity_type") or "item").strip()
                    entity_name = str(item.get("entity_name") or entity_key).strip()
                    digest = hashlib.sha256(
                        f"{entity_type}|{entity_name}".encode("utf-8")
                    ).hexdigest()[:12]
                    item["entity_key"] = (
                        f"generated.{entity_type or 'item'}.{digest}"
                    )
            if collection_name == "setup_payoff_updates":
                setup_payoff_ref = str(
                    item.get("setup_payoff_ref") or ""
                ).strip()
                source_ref = str(item.get("source_ref") or "").strip()
                annotated_identifier = re.fullmatch(
                    r"((?:ep\d+|(?:setup|payoff)[._-][a-zA-Z0-9_.-]+))[:：](.+)",
                    setup_payoff_ref,
                ) if not source_ref else None
                if annotated_identifier:
                    # Older provider output used an explicit ID followed by
                    # its display annotation. Preserve that established ID.
                    item["setup_payoff_ref"] = annotated_identifier.group(1)
                if not source_ref and setup_payoff_ref and not re.fullmatch(
                    r"[a-zA-Z0-9_.:-]+", setup_payoff_ref,
                ) and not annotated_identifier:
                    source_ref = setup_payoff_ref
                if source_ref:
                    # Keep the exact authored reference alongside its technical
                    # identity; Chinese/mixed prose must never become a new,
                    # untraceable setup merely because it cannot be an ID.
                    item["source_ref"] = source_ref
                    if re.fullmatch(r"[a-zA-Z0-9_.:-]{3,120}", source_ref):
                        item["setup_payoff_ref"] = source_ref
                    else:
                        digest = hashlib.sha256(source_ref.encode("utf-8")).hexdigest()[:12]
                        item["setup_payoff_ref"] = f"generated.setup_payoff.{digest}"
                target_episode = _parse_int(item.get("target_payoff_episode"))
                if target_episode is not None:
                    item["target_payoff_episode"] = target_episode


def _normalize_hook(
    output: dict[str, object],
    resolved_ending_mode: EndingMode,
    scene_number_map: dict[int, int],
    *,
    partial: bool = False,
) -> None:
    hook = output.get("continuation_hook")
    if isinstance(hook, str) and hook.strip():
        summary = hook.strip()[:300]
        next_question = str(output.get("next_episode_question") or "").strip()
        if resolved_ending_mode == EndingMode.series_finale:
            # A legacy string hook is usually a transport alias, not an
            # author-approved epilogue. Do not let scalar normalization
            # resurrect a continuation requirement at a series ending.
            output["continuation_hook"] = None
        else:
            output["continuation_hook"] = {
                "ending_hook_type": (
                    "信息悬念"
                    if ending_mode_requires_hook(resolved_ending_mode)
                    else "季终收束"
                ),
                "ending_hook_summary": summary,
                "next_episode_obligation": (
                    next_question[:300]
                    if next_question
                    else (
                        "下一集必须回应本集结尾提出的未解问题。"
                        if ending_mode_requires_hook(resolved_ending_mode)
                        else "下一季仅承接已批准的后续入口。"
                    )
                ),
            }
    if isinstance(hook, dict):
        def pop_first_hook_alias(*field_names: str) -> object | None:
            selected: object | None = None
            for field_name in field_names:
                value = hook.pop(field_name, None)
                if selected is None and value not in (None, "", [], {}):
                    selected = value
            return selected

        legacy_hook_type = pop_first_hook_alias("hook_type", "type", "ending_type")
        legacy_summary = pop_first_hook_alias(
            "hook_description",
            "hook_summary",
            "description",
            "summary",
            "text",
            "promise",
            "ending_hook",
            "hook_text",
            "ending_pressure",
        )
        legacy_obligation = pop_first_hook_alias(
            "next_obligation",
            "next_episode_hook",
            "next_episode_promise",
            "obligation",
            "next_required_step",
        )
        legacy_evidence = pop_first_hook_alias("response_evidence")
        legacy_evidence_numbers = pop_first_hook_alias(
            "evidence_scene_numbers",
            "response_scene_numbers",
        )
        legacy_target_episode = pop_first_hook_alias(
            "target_episode",
            "payoff_episode",
            "payoff_target_episode",
        )
        hook.pop("source_episode", None)
        if not str(hook.get("ending_hook_type") or "").strip() and (not partial or legacy_hook_type is not None):
            hook["ending_hook_type"] = (
                str(legacy_hook_type or "").strip() or "因果压力"
            )
        if not str(hook.get("ending_hook_summary") or "").strip() and (not partial or legacy_summary is not None or legacy_evidence is not None):
            hook["ending_hook_summary"] = (
                str(legacy_summary or legacy_evidence or "").strip()
            )
        if not str(hook.get("next_episode_obligation") or "").strip() and (not partial or legacy_obligation is not None):
            hook["next_episode_obligation"] = str(
                legacy_obligation or ""
            ).strip()
        if (
            hook.get("response_evidence_scene_numbers") in (None, [])
            and legacy_evidence_numbers is not None
        ):
            hook["response_evidence_scene_numbers"] = legacy_evidence_numbers
        if hook.get("target_payoff_episode") is None and legacy_target_episode is not None:
            hook["target_payoff_episode"] = legacy_target_episode
        _normalize_scene_number_list(hook, "response_evidence_scene_numbers", scene_number_map)
        for field_name in ("responds_to_episode", "target_payoff_episode"):
            number = _parse_int(hook.get(field_name))
            if number is not None:
                hook[field_name] = number
        allowed_hook_fields = {
            "responds_to_episode",
            "previous_hook_response",
            "response_evidence_scene_numbers",
            "ending_hook_type",
            "ending_hook_summary",
            "next_episode_obligation",
            "target_payoff_episode",
        }
        for field_name in list(hook):
            if field_name not in allowed_hook_fields:
                hook.pop(field_name)
