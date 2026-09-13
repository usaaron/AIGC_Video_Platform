"""Reconcile full-draft references using the existing compatibility rules.

This stage runs after scalar normalization. Legacy presence and causality
defaults remain explicit here; they are not semantic evidence validation.
"""

from __future__ import annotations

from copy import deepcopy


_LEDGER_KEY_FIELDS = {
    "continuity_state_updates": ("entity_key", "state_domain"),
    "story_line_updates": ("story_line_id",),
    "setup_payoff_updates": ("setup_payoff_ref",),
}


def reconcile_draft_evidence(
    normalized: dict[str, object], *, scenes: list[object],
) -> bool:
    """Reconcile in place after the caller has checked for a nonempty scene list."""
    scene_evidence = _collect_scene_evidence(scenes)
    generated_character_names = {
        str(character.get("name") or "").strip().casefold()
        for character in (normalized.get("characters") or [])
        if isinstance(character, dict) and str(character.get("name") or "").strip()
    }

    # Preserve stage order and the evidence snapshot taken before legacy defaults.
    changed = _reconcile_character_states(normalized, scenes, scene_evidence, generated_character_names)
    changed |= _reconcile_ledger_references(normalized, scene_evidence)
    changed |= _reconcile_death_transitions(normalized)
    changed |= _reconcile_hook_response(normalized, scene_evidence)
    changed |= _reconcile_payoff_statuses(normalized)
    changed |= _reconcile_story_alignment(normalized)
    changed |= _reconcile_relationships(normalized, scene_evidence, generated_character_names)
    changed |= _reconcile_scene_causality(scenes)
    return changed


def _collect_scene_evidence(scenes: list[object]) -> dict[int, str]:
    scene_evidence: dict[int, str] = {}
    for raw_scene in scenes:
        if not isinstance(raw_scene, dict):
            continue
        scene_number = raw_scene.get("scene_number")
        if not isinstance(scene_number, int):
            continue
        evidence_parts = [
            value
            for value in (raw_scene.get("character_actions") or [])
            if isinstance(value, str)
        ]
        for dialogue in raw_scene.get("dialogues") or []:
            if not isinstance(dialogue, dict):
                continue
            evidence_parts.extend(
                str(dialogue.get(field_name) or "")
                for field_name in ("character_name", "text")
            )
        scene_evidence[scene_number] = " ".join(evidence_parts).casefold()
    return scene_evidence


def _filter_evidence_numbers(value: object, scene_evidence: dict[int, str]) -> list[int]:
    values = value if isinstance(value, list) else ([value] if value is not None else [])
    result: list[int] = []
    seen: set[int] = set()
    for number in values:
        if isinstance(number, bool) or not isinstance(number, int):
            continue
        if number in scene_evidence and number not in seen:
            seen.add(number)
            result.append(number)
    return result


def _record_removals(normalized: dict[str, object], collection_name: str, count: int) -> None:
    if count:
        metadata = normalized.setdefault("_meta", {})
        if isinstance(metadata, dict):
            metadata[f"unsupported_{collection_name}_removed"] = count


def _reconcile_character_states(
    normalized: dict[str, object],
    scenes: list[object],
    scene_evidence: dict[int, str],
    generated_character_names: set[str],
) -> bool:
    changed = False
    character_updates = normalized.get("character_state_updates")
    if isinstance(character_updates, list):
        reconciled_updates: list[object] = []
        removed_character_updates = 0
        seen_character_names: set[str] = set()
        for update in character_updates:
            if not isinstance(update, dict):
                removed_character_updates += 1
                continue
            name = str(update.get("character_name") or "").strip().casefold()
            if (
                not name
                or name not in generated_character_names
                or name in seen_character_names
            ):
                removed_character_updates += 1
                continue
            visible_numbers = [
                number
                for number in _filter_evidence_numbers(update.get("evidence_scene_numbers"), scene_evidence)
                if name in scene_evidence[number]
            ]
            if visible_numbers:
                if visible_numbers != update.get("evidence_scene_numbers"):
                    update["evidence_scene_numbers"] = visible_numbers
                    changed = True
                reconciled_updates.append(update)
                seen_character_names.add(name)
            else:
                # The body does not visibly support this ledger row. Keep
                # the screenplay and omit only the unsupported memory row.
                removed_character_updates += 1
        if len(reconciled_updates) != len(character_updates):
            normalized["character_state_updates"] = reconciled_updates
            changed = True
        if not reconciled_updates and character_updates:
            changed |= _restore_required_character_state(normalized, scenes, character_updates)
        _record_removals(normalized, "character_state_updates", removed_character_updates)
    return changed


def _restore_required_character_state(
    normalized: dict[str, object], scenes: list[object], character_updates: list[object],
) -> bool:
    # The schema requires one state row. Use the first generated
    # character and make the first scene visibly establish presence
    # rather than allowing an impossible root validation failure.
    first_character = normalized.get("characters")
    first_character_name = (
        str(first_character[0].get("name") or "").strip()
        if isinstance(first_character, list)
        and first_character
        and isinstance(first_character[0], dict)
        else "主角"
    )
    first_scene = scenes[0]
    if isinstance(first_scene, dict):
        actions = first_scene.setdefault("character_actions", [])
        if isinstance(actions, list):
            actions.append(f"{first_character_name}在场并观察局势。")
        first_scene_number = first_scene.get("scene_number", 1)
        template = next(
            (item for item in character_updates if isinstance(item, dict)),
            {},
        )
        template = deepcopy(template)
        template.setdefault("current_goal", "推进本集目标并处理当前压力。")
        template.setdefault("emotional_state", "承受当前事件带来的压力。")
        template.setdefault("change_summary", "本集行动推动其状态发生变化。")
        template.setdefault("change_cause", "本集可见行动推动状态变化。")
        template["character_name"] = first_character_name
        template["evidence_scene_numbers"] = [first_scene_number]
        normalized["character_state_updates"] = [template]
        return True
    return False


def _reconcile_ledger_references(
    normalized: dict[str, object], scene_evidence: dict[int, str],
) -> bool:
    changed = False
    # All evidence lists must point at this episode's actual scenes.
    for collection_name, key_fields in _LEDGER_KEY_FIELDS.items():
        collection = normalized.get(collection_name)
        if not isinstance(collection, list):
            continue
        retained_updates: list[object] = []
        seen_keys: set[tuple[str, ...]] = set()
        removed_updates = 0
        for update in collection:
            if not isinstance(update, dict):
                removed_updates += 1
                continue
            filtered = _filter_evidence_numbers(update.get("evidence_scene_numbers"), scene_evidence)
            if filtered:
                if filtered != update.get("evidence_scene_numbers"):
                    update["evidence_scene_numbers"] = filtered
                    changed = True
            else:
                removed_updates += 1
                continue
            key = tuple(
                str(update.get(field_name) or "").strip().casefold()
                for field_name in key_fields
            )
            if not all(key) or key in seen_keys:
                removed_updates += 1
                continue
            seen_keys.add(key)
            retained_updates.append(update)
        if len(retained_updates) != len(collection):
            normalized[collection_name] = retained_updates
            changed = True
        _record_removals(normalized, collection_name, removed_updates)
    return changed


def _reconcile_death_transitions(normalized: dict[str, object]) -> bool:
    changed = False
    continuity_updates = normalized.get("continuity_state_updates")
    if isinstance(continuity_updates, list):
        character_states = {
            str(update.get("character_name") or "").strip().casefold(): update
            for update in (normalized.get("character_state_updates") or [])
            if isinstance(update, dict)
        }
        retained_continuity: list[object] = []
        removed_death_updates = 0
        for update in continuity_updates:
            if (
                isinstance(update, dict)
                and str(update.get("entity_type") or "").strip().casefold() == "character"
                and str(update.get("transition") or "").strip().casefold() == "died"
            ):
                character_state = character_states.get(
                    str(update.get("entity_name") or "").strip().casefold()
                )
                if not character_state or character_state.get("life_status") != "dead":
                    removed_death_updates += 1
                    continue
            retained_continuity.append(update)
        if removed_death_updates:
            normalized["continuity_state_updates"] = retained_continuity
            _record_removals(normalized, "continuity_death_updates", removed_death_updates)
            changed = True
    return changed


def _reconcile_hook_response(
    normalized: dict[str, object], scene_evidence: dict[int, str],
) -> bool:
    changed = False
    hook = normalized.get("continuation_hook")
    if isinstance(hook, dict):
        evidence = hook.get("response_evidence_scene_numbers")
        if not isinstance(evidence, list):
            evidence = [evidence] if evidence is not None else []
        filtered_evidence = _filter_evidence_numbers(evidence, scene_evidence)
        if filtered_evidence != evidence:
            hook["response_evidence_scene_numbers"] = filtered_evidence
            changed = True
        if not str(hook.get("previous_hook_response") or "").strip():
            for field_name in ("responds_to_episode", "response_evidence_scene_numbers"):
                if hook.get(field_name):
                    hook[field_name] = None if field_name == "responds_to_episode" else []
                    changed = True
    return changed


def _reconcile_payoff_statuses(normalized: dict[str, object]) -> bool:
    changed = False
    payoff_updates = normalized.get("setup_payoff_updates")
    if isinstance(payoff_updates, list):
        for update in payoff_updates:
            if not isinstance(update, dict):
                continue
            action = str(update.get("action") or "").strip().casefold()
            status = str(update.get("status") or "").strip().casefold()
            if action == "payoff" and status != "paid_off":
                update["status"] = "paid_off"
                changed = True
            elif status == "paid_off" and action != "payoff":
                update["action"] = "payoff"
                changed = True
            elif action in {"partial_payoff", "reinforce", "defer"} and status == "setup":
                update["status"] = "active"
                changed = True
    return changed


def _reconcile_story_alignment(normalized: dict[str, object]) -> bool:
    changed = False
    story_updates = normalized.get("story_line_updates")
    if isinstance(story_updates, list):
        for update in story_updates:
            if not isinstance(update, dict):
                continue
            alignment = str(update.get("planned_alignment") or "aligned").strip().casefold()
            if alignment != "aligned" and not str(update.get("alignment_note") or "").strip():
                update["alignment_note"] = "本集正文已给出对应推进证据。"
                changed = True
    return changed


def _reconcile_relationships(
    normalized: dict[str, object],
    scene_evidence: dict[int, str],
    generated_character_names: set[str],
) -> bool:
    changed = False
    relationship_updates = normalized.get("relationship_state_updates")
    if isinstance(relationship_updates, list):
        supported_updates: list[object] = []
        removed_updates = 0
        seen_pairs: set[tuple[str, str]] = set()
        for update in relationship_updates:
            if not isinstance(update, dict):
                removed_updates += 1
                continue
            source_name = str(
                update.get("source_character_name") or ""
            ).strip().casefold()
            target_name = str(
                update.get("target_character_name") or ""
            ).strip().casefold()
            evidence_numbers = _filter_evidence_numbers(update.get("evidence_scene_numbers"), scene_evidence)
            pair = tuple(sorted((source_name, target_name)))
            if (
                not source_name
                or not target_name
                or source_name == target_name
                or source_name not in generated_character_names
                or target_name not in generated_character_names
                or not evidence_numbers
                or pair in seen_pairs
                or any(
                    source_name not in scene_evidence[number]
                    or target_name not in scene_evidence[number]
                    for number in evidence_numbers
                )
            ):
                removed_updates += 1
                continue
            if evidence_numbers != update.get("evidence_scene_numbers"):
                update["evidence_scene_numbers"] = evidence_numbers
                changed = True
            seen_pairs.add(pair)
            supported_updates.append(update)
        if len(supported_updates) != len(relationship_updates):
            normalized["relationship_state_updates"] = supported_updates
            changed = True
        _record_removals(normalized, "relationship_updates", removed_updates)
    return changed


def _reconcile_scene_causality(scenes: list[object]) -> bool:
    changed = False
    prior_scene_numbers: list[int] = []
    for index, raw_scene in enumerate(scenes):
        if not isinstance(raw_scene, dict):
            continue
        scene_number = raw_scene.get("scene_number")
        causality = raw_scene.get("scene_causality")
        if not isinstance(causality, dict):
            goal_text = str(
                raw_scene.get("purpose")
                or raw_scene.get("beat_summary")
                or "推进本集目标。"
            )
            conflict_text = str(
                raw_scene.get("beat_summary") or "当前目标受到阻碍。"
            )
            outcome_text = str(
                raw_scene.get("turning_point")
                or raw_scene.get("beat_summary")
                or "局势发生新的变化。"
            )
            if outcome_text.strip().casefold() == goal_text.strip().casefold():
                outcome_text += " 局势因此发生变化。"
            causality = {
                "goal": goal_text,
                "conflict": conflict_text,
                "outcome": outcome_text,
                "caused_by_scene_number": None,
                "causal_link": None,
            }
            raw_scene["scene_causality"] = causality
            changed = True
        if index == 0:
            if causality.get("caused_by_scene_number") is not None:
                causality["caused_by_scene_number"] = None
                changed = True
            if causality.get("causal_link") is not None:
                causality["causal_link"] = None
                changed = True
        elif prior_scene_numbers:
            predecessor = causality.get("caused_by_scene_number")
            if predecessor not in prior_scene_numbers:
                causality["caused_by_scene_number"] = prior_scene_numbers[-1]
                changed = True
        if (
            causality.get("caused_by_scene_number") is not None
            and not str(causality.get("causal_link") or "").strip()
        ):
            causality["causal_link"] = "上一场结果直接造成这一场的新目标与压力。"
            changed = True
        if isinstance(scene_number, int):
            prior_scene_numbers.append(scene_number)
    return changed
