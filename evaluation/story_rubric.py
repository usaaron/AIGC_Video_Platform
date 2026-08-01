from __future__ import annotations

from collections.abc import Mapping
import re
from typing import Any

from evaluation.models import StoryRubricCategory, StoryRubricResult


RUBRIC_DEFINITIONS: list[tuple[str, str, str]] = [
    ("Hook", "Script should establish a compelling opening in the first beat.", "Strengthen the opening reveal or contradiction."),
    ("Narrative Logic", "Scenes should follow a coherent cause-and-effect progression.", "Clarify why each scene triggers the next escalation."),
    ("Character Consistency", "Lead and counterpart behavior should align with the stated conflict.", "Align dialogue and actions with the character objective."),
    ("Character Agency", "The protagonist should make or resist meaningful choices.", "Add an explicit choice or refusal beat for the protagonist."),
    ("Emotional Progression", "Scene-to-scene emotional shifts should escalate or deepen.", "Sharpen the emotional turn between scenes."),
    ("Conflict Escalation", "Later scenes should raise stakes over earlier ones.", "Increase public, relational, or status consequences in later scenes."),
    ("Dialogue Quality", "Dialogue should be specific, performable, and tension-bearing.", "Replace generic lines with concrete, high-stakes phrasing."),
    ("Platform Fit", "The script should follow the selected platform or market profile without importing unrelated platform assumptions.", "Align pacing and presentation with the selected profile."),
    ("Cultural Fit", "The script should read as understandable and safe for the target audience.", "Reduce ambiguous references and sharpen audience framing."),
    ("Commercial Potential", "The episode should imply sequel demand or monetizable retention.", "Strengthen episode-end curiosity and future payoff."),
    ("Cliffhanger Strength", "The ending should create a clear unresolved pressure point.", "End on a sharper unanswered reveal or power reversal."),
]

STORY_QUALITY_RUBRIC = [
    {
        "category_name": category_name,
        "score_range": "0-5",
        "judgment_standard": judgment_standard,
        "deduction_reason": "Missing or weak structural signal.",
        "revision_suggestion": revision_suggestion,
    }
    for category_name, judgment_standard, revision_suggestion in RUBRIC_DEFINITIONS
]


class StoryRubricEvaluator:
    def evaluate(self, script: Mapping[str, Any], *, stage: str) -> StoryRubricResult:
        scenes = script.get("scenes", [])
        hook = str(script.get("hook", "")).strip()
        revision_signals = self._extract_revision_signals(script)
        has_dialogues = bool(
            scenes
            and isinstance(scenes, list)
            and scenes[0].get("dialogues")
        )
        categories = [
            self._score_hook(hook),
            self._score_narrative_logic(scenes),
            self._score_character_consistency(scenes),
            self._score_character_agency(scenes),
            self._score_emotional_progression(scenes),
            self._score_conflict_escalation(scenes),
            self._score_dialogue_quality(scenes, has_dialogues, revision_signals),
            self._score_platform_fit(script, scenes),
            self._score_cultural_fit(script),
            self._score_commercial_potential(script, scenes, revision_signals),
            self._score_cliffhanger_strength(script, scenes),
        ]
        total_max = sum(category.max_score for category in categories)
        total_score = sum(category.score for category in categories)
        overall_score = round(total_score / total_max, 3)
        return StoryRubricResult(
            stage=stage,
            overall_score=overall_score,
            categories=categories,
            passed=overall_score >= 0.65,
        )

    def _make_category(
        self,
        *,
        index: int,
        score: float,
        deduction_reasons: list[str],
    ) -> StoryRubricCategory:
        category_name, judgment_standard, revision_suggestion = RUBRIC_DEFINITIONS[index]
        return StoryRubricCategory(
            category_name=category_name,
            max_score=5,
            score=score,
            judgment_standard=judgment_standard,
            deduction_reasons=deduction_reasons,
            revision_suggestions=[revision_suggestion],
        )

    def _score_hook(self, hook: str) -> StoryRubricCategory:
        score = 5.0 if len(hook) >= 20 else 2.5
        deductions = [] if score >= 4.0 else ["Hook is too short or non-specific."]
        return self._make_category(index=0, score=score, deduction_reasons=deductions)

    def _score_narrative_logic(self, scenes: list[dict[str, Any]]) -> StoryRubricCategory:
        has_structure = all(scene.get("purpose") and scene.get("beat_summary") for scene in scenes)
        score = 4.5 if len(scenes) >= 2 and has_structure else 2.5
        deductions = [] if has_structure else ["Scenes do not fully explain cause-and-effect progression."]
        return self._make_category(index=1, score=score, deduction_reasons=deductions)

    def _score_character_consistency(self, scenes: list[dict[str, Any]]) -> StoryRubricCategory:
        consistent = any(scene.get("purpose") for scene in scenes)
        score = 4.0 if consistent else 2.0
        deductions = [] if consistent else ["Character motivations are under-specified."]
        return self._make_category(index=2, score=score, deduction_reasons=deductions)

    def _score_character_agency(self, scenes: list[dict[str, Any]]) -> StoryRubricCategory:
        agency_terms = {
            "activate",
            "activates",
            "choose",
            "chooses",
            "commit",
            "commits",
            "confront",
            "confronts",
            "decide",
            "decides",
            "demand",
            "demands",
            "expose",
            "exposes",
            "force",
            "forces",
            "refuse",
            "refuses",
            "reject",
            "rejects",
            "reveal",
            "reveals",
            "risk",
            "risks",
            "stop",
            "stops",
            "take",
            "takes",
        }
        agency = any(
            self._scene_contains_terms(scene, agency_terms)
            for scene in scenes
        )
        score = 4.0 if agency else 2.5
        deductions = [] if agency else ["Protagonist choices are not visible enough."]
        return self._make_category(index=3, score=score, deduction_reasons=deductions)

    def _score_emotional_progression(self, scenes: list[dict[str, Any]]) -> StoryRubricCategory:
        shifts = {scene.get("emotional_shift") for scene in scenes if scene.get("emotional_shift")}
        score = 4.5 if len(shifts) >= max(len(scenes) - 1, 1) else 2.5
        deductions = [] if score >= 4.0 else ["Emotional changes are too repetitive or flat."]
        return self._make_category(index=4, score=score, deduction_reasons=deductions)

    def _score_conflict_escalation(self, scenes: list[dict[str, Any]]) -> StoryRubricCategory:
        final_cliffhanger = bool(scenes and scenes[-1].get("cliffhanger"))
        score = 4.5 if len(scenes) >= 2 and final_cliffhanger else 2.0
        deductions = [] if final_cliffhanger else ["Conflict does not escalate into a clear episode-end threat."]
        return self._make_category(index=5, score=score, deduction_reasons=deductions)

    def _score_dialogue_quality(
        self,
        scenes: list[dict[str, Any]],
        has_dialogues: bool,
        revision_signals: dict[str, bool],
    ) -> StoryRubricCategory:
        if has_dialogues:
            dialogue_count = sum(len(scene.get("dialogues", [])) for scene in scenes)
            score = 4.0 if dialogue_count >= len(scenes) * 2 else 3.2
            deductions = [] if score >= 4.0 else ["Dialogue coverage is still sparse."]
        elif revision_signals.get("dialogue_polish_complete"):
            score = 3.6
            deductions = ["Dialogue polish is planned, but final spoken lines are still not fully expanded."]
        else:
            score = 2.0
            deductions = ["Draft uses prompts instead of final dialogue lines."]
        return self._make_category(index=6, score=score, deduction_reasons=deductions)

    def _score_platform_fit(
        self,
        script: Mapping[str, Any],
        scenes: list[dict[str, Any]],
    ) -> StoryRubricCategory:
        duration = int(script.get("target_duration_seconds", 0) or 0)
        target_platform = str(script.get("target_platform", "")).casefold()
        if "tiktok" in target_platform:
            fit = duration <= 60 and bool(scenes)
        else:
            fit = bool(scenes) and duration > 0
        score = 4.5 if fit else 2.5
        deductions = [] if fit else ["Duration, pacing, or scene structure does not match the selected profile."]
        return self._make_category(index=7, score=score, deduction_reasons=deductions)

    def _score_cultural_fit(self, script: Mapping[str, Any]) -> StoryRubricCategory:
        language = str(script.get("language", "en")).lower()
        score = 4.0 if language in {"en", "en-us", "zh", "zh-cn", "chinese"} else 3.0
        deductions = [] if score >= 4.0 else ["Target language / audience framing is underspecified."]
        return self._make_category(index=8, score=score, deduction_reasons=deductions)

    def _score_commercial_potential(
        self,
        script: Mapping[str, Any],
        scenes: list[dict[str, Any]],
        revision_signals: dict[str, bool],
    ) -> StoryRubricCategory:
        has_cliffhanger = bool(scenes and scenes[-1].get("cliffhanger"))
        hook = str(script.get("hook", "")).lower()
        score = 4.5 if has_cliffhanger and hook else 2.5
        if revision_signals.get("commercial_polish_complete") and score < 4.5:
            score = 3.8
        deductions = [] if score >= 4.0 else ["Script lacks strong sequel or retention pressure."]
        return self._make_category(index=9, score=score, deduction_reasons=deductions)

    def _score_cliffhanger_strength(
        self,
        script: Mapping[str, Any],
        scenes: list[dict[str, Any]],
    ) -> StoryRubricCategory:
        final_scene = scenes[-1] if scenes else {}
        next_episode_question = str(script.get("next_episode_question", "")).strip()
        unresolved_markers = {
            "before",
            "hidden",
            "remains",
            "unanswered",
            "unknown",
            "until",
            "whether",
            "withheld",
        }
        final_pressure_text = " ".join(
            [
                str(final_scene.get("beat_summary", "")),
                str(final_scene.get("turning_point", "")),
                str((final_scene.get("scene_causality") or {}).get("outcome", "")),
            ]
        )
        has_unresolved_pressure = bool(next_episode_question) or bool(
            self._tokens(final_pressure_text) & unresolved_markers
        )
        strong = bool(final_scene.get("cliffhanger")) and has_unresolved_pressure
        score = 5.0 if strong else 3.0 if final_scene.get("cliffhanger") else 1.5
        deductions = [] if strong else ["Final scene could end on a sharper unresolved reveal."]
        return self._make_category(index=10, score=score, deduction_reasons=deductions)

    def _scene_contains_terms(
        self,
        scene: Mapping[str, Any],
        terms: set[str],
    ) -> bool:
        causality = scene.get("scene_causality")
        causality_text = ""
        if isinstance(causality, Mapping):
            causality_text = " ".join(
                str(causality.get(field, ""))
                for field in ("goal", "conflict", "outcome", "causal_link")
            )
        text = " ".join(
            [
                str(scene.get("purpose", "")),
                str(scene.get("turning_point", "")),
                causality_text,
                *[str(action) for action in scene.get("character_actions", [])],
            ]
        )
        return bool(self._tokens(text) & terms)

    def _tokens(self, value: str) -> set[str]:
        return set(re.findall(r"[a-z]+", value.casefold()))

    def _extract_revision_signals(self, script: Mapping[str, Any]) -> dict[str, bool]:
        metadata = script.get("llm_metadata", {})
        if not isinstance(metadata, Mapping):
            return {}
        signals = metadata.get("revision_signals", {})
        if not isinstance(signals, Mapping):
            return {}
        return {
            str(key): bool(value)
            for key, value in signals.items()
        }
