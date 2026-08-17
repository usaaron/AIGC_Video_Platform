from __future__ import annotations

import re

from pydantic import BaseModel

from app.modules.master_script.models import LLMGeneratedDraftMasterScript
from app.modules.script_engine.long_story_models import (
    EpisodePlanBatchGenerationOutput,
    StoryBibleGenerationOutput,
    StoryPlanNodeDecompositionOutput,
    StoryPlanNodeGenerationOutput,
)


_CHINESE_PATTERN = re.compile(r"[\u3400-\u9fff]")
_LATIN_PATTERN = re.compile(r"[A-Za-z]")
_COMMON_ABBREVIATION_PATTERN = re.compile(
    r"(?<![A-Za-z])[A-Z]{1,4}(?:-?\d{1,4})?(?![A-Za-z])"
)


def mainland_text_violates_language_contract(value: str | None) -> bool:
    """Reject English-dominant prose while allowing common embedded abbreviations."""
    if value is None or not value.strip():
        return False
    value_without_abbreviations = _COMMON_ABBREVIATION_PATTERN.sub("", value)
    latin_count = len(_LATIN_PATTERN.findall(value_without_abbreviations))
    if latin_count == 0:
        return False
    chinese_count = len(_CHINESE_PATTERN.findall(value))
    if chinese_count == 0:
        return True
    return latin_count >= max(4, round(chinese_count * 0.25))


def story_bible_chinese_issues(output: StoryBibleGenerationOutput) -> list[str]:
    issues: list[str] = []

    def check(path: str, value: str | None) -> None:
        if mainland_text_violates_language_contract(value):
            issues.append(path)

    for field_name in (
        "project_title",
        "core_premise",
        "series_goal",
        "theme",
        "central_conflict",
        "ending_direction",
    ):
        check(field_name, getattr(output, field_name))
    for index, value in enumerate(output.world_rules):
        check(f"world_rules.{index}", value)
    for index, character in enumerate(output.character_registry):
        check(f"character_registry.{index}.name", character.name)
        check(f"character_registry.{index}.role", character.role)
    for index, arc in enumerate(output.character_arc_targets):
        check(f"character_arc_targets.{index}.external_goal", arc.external_goal)
        check(f"character_arc_targets.{index}.internal_need", arc.internal_need)
        check(f"character_arc_targets.{index}.starting_state", arc.starting_state)
        check(f"character_arc_targets.{index}.target_state", arc.target_state)
        for item_index, value in enumerate(arc.key_turning_points):
            check(f"character_arc_targets.{index}.key_turning_points.{item_index}", value)
        for item_index, value in enumerate(arc.protected_traits):
            check(f"character_arc_targets.{index}.protected_traits.{item_index}", value)
    for index, relationship in enumerate(output.relationships):
        check(f"relationships.{index}.relationship_type", relationship.relationship_type)
        check(f"relationships.{index}.initial_state", relationship.initial_state)
        check(f"relationships.{index}.target_direction", relationship.target_direction)
    for index, story_line in enumerate(output.story_lines):
        check(f"story_lines.{index}.title", story_line.title)
        check(f"story_lines.{index}.premise", story_line.premise)
        check(f"story_lines.{index}.planned_resolution", story_line.planned_resolution)
    for index, stage in enumerate(output.escalation_stages):
        check(f"escalation_stages.{index}.title", stage.title)
        check(f"escalation_stages.{index}.stage_goal", stage.stage_goal)
        check(f"escalation_stages.{index}.stage_opposition", stage.stage_opposition)
        check(f"escalation_stages.{index}.stage_payoff", stage.stage_payoff)
        check(f"escalation_stages.{index}.escalation_to_next", stage.escalation_to_next)
    for index, value in enumerate(output.locked_facts):
        check(f"locked_facts.{index}", value)
    for index, value in enumerate(output.avoid_patterns):
        check(f"avoid_patterns.{index}", value)
    return issues


def planning_output_chinese_issues(output: BaseModel) -> list[str]:
    if isinstance(output, StoryPlanNodeDecompositionOutput):
        return [
            f"children.{index}.{path}"
            for index, child in enumerate(output.children)
            for path in _story_plan_node_chinese_issues(child)
        ]
    if isinstance(output, StoryPlanNodeGenerationOutput):
        return _story_plan_node_chinese_issues(output)
    if isinstance(output, EpisodePlanBatchGenerationOutput):
        issues: list[str] = []
        for index, plan in enumerate(output.episode_plans):
            prefix = f"episode_plans.{index}"
            for field_name in (
                "episode_goal",
                "entry_state",
                "central_conflict",
                "protagonist_decision",
                "reveal",
                "emotional_movement",
                "stage_opposition",
                "episode_payoff",
                "pressure_escalation",
                "exit_state",
                "cliffhanger",
                "ending_hook_type",
                "next_episode_obligation",
            ):
                value = getattr(plan, field_name)
                if mainland_text_violates_language_contract(value):
                    issues.append(f"{prefix}.{field_name}")
            for field_name in (
                "continuity_requirements",
                "source_turning_points",
                "source_unit_story_beats",
            ):
                for item_index, value in enumerate(getattr(plan, field_name)):
                    if mainland_text_violates_language_contract(value):
                        issues.append(f"{prefix}.{field_name}.{item_index}")
            for scene_index, scene in enumerate(plan.scene_execution_plan):
                for field_name in (
                    "scene_heading",
                    "scene_objective",
                    "visible_action",
                    "turn_or_reveal",
                    "dialogue_objective",
                    "exit_state",
                ):
                    value = getattr(scene, field_name)
                    if mainland_text_violates_language_contract(value):
                        issues.append(
                            f"{prefix}.scene_execution_plan.{scene_index}.{field_name}"
                        )
        return issues
    raise TypeError(f"Unsupported mainland planning output: {type(output).__name__}")


def draft_script_chinese_issues(output: LLMGeneratedDraftMasterScript) -> list[str]:
    issues: list[str] = []

    def check(path: str, value: str | None) -> None:
        if mainland_text_violates_language_contract(value):
            issues.append(path)

    for field_name in (
        "title",
        "logline",
        "synopsis",
        "hook",
        "target_audience",
        "episode_goal",
        "next_episode_question",
    ):
        check(field_name, getattr(output, field_name))
    for index, character in enumerate(output.characters):
        check(f"characters.{index}.name", character.name)
        check(f"characters.{index}.role", character.role)
        check(f"characters.{index}.description", character.description)
        check(f"characters.{index}.motivation", character.motivation)
    for index, update in enumerate(output.character_state_updates):
        prefix = f"character_state_updates.{index}"
        check(f"{prefix}.character_name", update.character_name)
        check(f"{prefix}.current_goal", update.current_goal)
        check(f"{prefix}.emotional_state", update.emotional_state)
        check(f"{prefix}.belief_or_attitude", update.belief_or_attitude)
        check(f"{prefix}.physical_state", update.physical_state)
        check(f"{prefix}.location", update.location)
        check(f"{prefix}.personality_change", update.personality_change)
        check(f"{prefix}.change_summary", update.change_summary)
        check(f"{prefix}.change_cause", update.change_cause)
        for item_index, value in enumerate(update.knowledge_changes):
            check(f"{prefix}.knowledge_changes.{item_index}", value)
        for item_index, value in enumerate(update.active_constraints):
            check(f"{prefix}.active_constraints.{item_index}", value)
    for index, scene in enumerate(output.scenes):
        prefix = f"scenes.{index}"
        for field_name in (
            "slug",
            "purpose",
            "setting",
            "beat_summary",
            "emotional_shift",
            "emotional_objective",
            "turning_point",
        ):
            value = getattr(scene, field_name, None)
            if field_name == "setting" and value is None:
                value = getattr(scene, "setting_hint", None)
            check(f"{prefix}.{field_name}", value)
        for item_index, value in enumerate(scene.character_actions):
            check(f"{prefix}.character_actions.{item_index}", value)
        check(f"{prefix}.scene_causality.goal", scene.scene_causality.goal)
        check(f"{prefix}.scene_causality.conflict", scene.scene_causality.conflict)
        check(f"{prefix}.scene_causality.outcome", scene.scene_causality.outcome)
        check(f"{prefix}.scene_causality.causal_link", scene.scene_causality.causal_link)
        for item_index, dialogue in enumerate(scene.dialogues):
            check(f"{prefix}.dialogues.{item_index}.character_name", dialogue.character_name)
            check(f"{prefix}.dialogues.{item_index}.intent", dialogue.intent)
            check(f"{prefix}.dialogues.{item_index}.text", dialogue.text)
    return issues


def blocking_draft_script_chinese_issues(
    output: LLMGeneratedDraftMasterScript,
) -> list[str]:
    """Return language violations that make the performable draft unusable.

    Planning metadata can remain reviewable as a warning. Scene settings,
    action, and spoken dialogue are the actual production body and must remain
    Chinese-dominant before the episode can feed continuity and downstream
    export. Character names may legitimately be Latin-script names.
    """
    performable_fields: list[tuple[str, str]] = []
    for scene_index, scene in enumerate(output.scenes):
        setting = getattr(scene, "setting", None)
        if setting is None:
            setting = getattr(scene, "setting_hint", "")
        performable_fields.append((f"scenes.{scene_index}.setting", setting))
        performable_fields.extend(
            (f"scenes.{scene_index}.character_actions.{action_index}", action)
            for action_index, action in enumerate(scene.character_actions)
        )
        performable_fields.extend(
            (f"scenes.{scene_index}.dialogues.{dialogue_index}.text", dialogue.text)
            for dialogue_index, dialogue in enumerate(scene.dialogues)
        )
    combined_body = "\n".join(value for _, value in performable_fields)
    if not mainland_text_violates_language_contract(combined_body):
        return []
    individual_issues = [
        path
        for path, value in performable_fields
        if mainland_text_violates_language_contract(value)
    ]
    return individual_issues or ["scenes"]


def _story_plan_node_chinese_issues(output: StoryPlanNodeGenerationOutput) -> list[str]:
    issues: list[str] = []
    for field_name in (
        "title",
        "narrative_purpose",
        "synopsis",
        "entry_state",
        "central_conflict",
        "emotional_direction",
        "exit_state",
        "unit_resolution",
        "handoff_pressure",
        "decomposition_reason",
    ):
        if mainland_text_violates_language_contract(getattr(output, field_name)):
            issues.append(field_name)
    for index, value in enumerate(output.turning_points):
        if mainland_text_violates_language_contract(value):
            issues.append(f"turning_points.{index}")
    for index, value in enumerate(output.unit_story_beats):
        if mainland_text_violates_language_contract(value):
            issues.append(f"unit_story_beats.{index}")
    return issues
