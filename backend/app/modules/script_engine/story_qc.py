from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Mapping

from evaluation.story_rubric import StoryRubricEvaluator
from app.modules.script_engine.models import (
    StoryQCDimension,
    StoryQCDimensionEvaluation,
    StoryQCKnowledgeRef,
    GenerationStrategy,
    StoryQCCheck,
    StoryQCRubricCategory,
    StoryQCReport,
    StoryQCStatus,
)
from app.script_delivery_contract import ending_mode_requires_hook


_FINALE_CLOSING_CATEGORIES = {
    "cliffhanger strength",
    "conflict escalation",
    "commercial potential",
}


class StoryQC(ABC):
    @abstractmethod
    def evaluate(
        self,
        draft_script: Mapping[str, Any],
        *,
        strategy: GenerationStrategy,
    ) -> StoryQCReport:
        raise NotImplementedError


class PlaceholderStoryQC(StoryQC):
    def __init__(self) -> None:
        self._rubric_evaluator = StoryRubricEvaluator()

    def evaluate(
        self,
        draft_script: Mapping[str, Any],
        *,
        strategy: GenerationStrategy,
    ) -> StoryQCReport:
        rubric_result = self._rubric_evaluator.evaluate(draft_script, stage="draft")
        requires_hook = ending_mode_requires_hook(draft_script.get("ending_mode"))
        rubric_categories = (
            rubric_result.categories
            if requires_hook
            else self._adapt_finale_rubric_categories(
                rubric_result.categories,
                draft_script,
            )
        )
        rubric_overall_score = (
            rubric_result.overall_score
            if requires_hook
            else self._aggregate_rubric_categories(rubric_categories)
        )
        rubric_passed = (
            rubric_result.passed
            if requires_hook
            else rubric_overall_score >= 0.65
        )
        dimension_evaluations = self._build_dimension_evaluations(
            draft_script,
            rubric_categories,
        )
        checks = [
            StoryQCCheck(
                check_name="hook_present",
                passed=bool(draft_script.get("hook")),
                score=1.0 if draft_script.get("hook") else 0.3,
                note="Rubric-aligned check for hook presence.",
            ),
            StoryQCCheck(
                check_name="scenes_present",
                passed=bool(draft_script.get("scenes")),
                score=1.0 if draft_script.get("scenes") else 0.2,
                note="Rubric-aligned check for scene structure presence.",
            ),
            StoryQCCheck(
                check_name="strategy_qc_enabled",
                passed=strategy.qc_enabled,
                score=0.8 if strategy.qc_enabled else 0.4,
                note="Rubric-aligned check for strategy QC configuration.",
            ),
            StoryQCCheck(
                check_name="rubric_score",
                passed=rubric_passed,
                score=rubric_overall_score,
                note=(
                    "Story quality rubric aggregate score."
                    if requires_hook
                    else "Mode-aware finale rubric aggregate; formal closure replaces continuation-pressure scoring."
                ),
            ),
        ]
        overall_score = round(sum(check.score for check in checks) / len(checks), 3)
        return StoryQCReport(
            overall_score=overall_score,
            status=StoryQCStatus.placeholder,
            checks=checks,
            recommended_actions=[
                "Use the story rubric deductions and suggestions to build a revision plan."
            ],
            rubric_overall_score=rubric_overall_score,
            rubric_categories=[
                StoryQCRubricCategory(
                    category_name=category.category_name,
                    score=category.score,
                    max_score=category.max_score,
                    deduction_reasons=category.deduction_reasons,
                    revision_suggestions=category.revision_suggestions,
                )
                for category in rubric_categories
            ],
            report_version="story_qc_report.v1",
            explainability_status="partial",
            dimension_evaluations=dimension_evaluations,
            evidence_summary=self._build_evidence_summary(dimension_evaluations),
            knowledge_refs=self._build_knowledge_refs(
                dimension_evaluations,
                ending_mode=draft_script.get("ending_mode"),
            ),
        )

    def _adapt_finale_rubric_categories(
        self,
        categories: list[Any],
        draft_script: Mapping[str, Any],
    ) -> list[Any]:
        """Reframe continuation-only rubric categories for a legal finale.

        The shared legacy evaluator still scores ``Cliffhanger Strength`` as
        if every episode must create unresolved continuation pressure. Its
        ``Conflict Escalation`` and ``Commercial Potential`` proxies also use
        the same cliffhanger bit. Keep that evaluator unchanged and translate
        only these three categories to an evidence-based finale contract. All
        other categories remain untouched.
        """

        resolution_score = self._finale_resolution_score(draft_script)
        if resolution_score is None:
            return categories

        adapted: list[Any] = []
        for category in categories:
            category_name = str(category.category_name).strip().casefold()
            if category_name not in _FINALE_CLOSING_CATEGORIES:
                adapted.append(category)
                continue

            score = self._finale_category_score(
                category_name,
                original_score=float(category.score),
                resolution_score=resolution_score,
                draft_script=draft_script,
            )
            if score < 4.0:
                deduction_reasons = [
                    "Formal finale resolution is not yet concrete enough."
                ]
                revision_suggestions = [
                    "Make the final causal and emotional resolution observable."
                ]
            elif category_name == "cliffhanger strength":
                deduction_reasons = []
                revision_suggestions = [
                    "Protect the formal resolution and avoid adding a manufactured continuation hook."
                ]
            else:
                deduction_reasons = []
                revision_suggestions = [
                    "Judge the finale on visible stakes, payoff, and audience satisfaction rather than sequel bait."
                ]

            adapted.append(
                category.model_copy(
                    update={
                        "score": round(min(max(score, 0.0), category.max_score), 3),
                        "deduction_reasons": self._unique_strings(deduction_reasons),
                        "revision_suggestions": self._unique_strings(
                            revision_suggestions
                        ),
                    }
                )
            )
        return adapted

    def _finale_category_score(
        self,
        category_name: str,
        *,
        original_score: float,
        resolution_score: float,
        draft_script: Mapping[str, Any],
    ) -> float:
        """Map legacy cliffhanger proxies onto finale-appropriate evidence."""

        if category_name == "cliffhanger strength":
            # A season finale may still leave a tasteful next-season doorway,
            # so never downgrade an already-strong ending merely because the
            # closure-aware rubric uses a different axis.
            return max(original_score, resolution_score)

        if category_name == "conflict escalation":
            scenes = self._normalized_scenes(draft_script)
            has_scene_progression = len(scenes) >= 2 and any(
                str(scene.get("purpose", "")).strip()
                != str(scenes[0].get("purpose", "")).strip()
                for scene in scenes[1:]
            )
            if resolution_score >= 4.0 and has_scene_progression:
                return max(original_score, 4.0)
            return max(original_score, min(resolution_score, 3.5))

        # A finite finale can be commercially satisfying without promising a
        # sequel. A hook still helps, but the score is capped below the
        # serial-episode maximum unless closure and the opening hook both hold.
        has_opening_hook = bool(str(draft_script.get("hook", "")).strip())
        if resolution_score >= 4.0 and has_opening_hook:
            return max(original_score, 4.0)
        if resolution_score >= 3.0:
            return max(original_score, 3.5 if has_opening_hook else 3.0)
        return original_score

    def _aggregate_rubric_categories(self, categories: list[Any]) -> float:
        total_max = sum(float(category.max_score) for category in categories)
        if total_max <= 0:
            return 0.0
        return round(
            sum(float(category.score) for category in categories) / total_max,
            3,
        )

    def _finale_resolution_score(self, draft_script: Mapping[str, Any]) -> float | None:
        """Score observable closure evidence on the final scene.

        The score is deliberately conservative: a single generic beat is not
        enough to waive a quality concern, while a turning point plus a causal
        outcome (and, when present, an episode/series payoff field) is enough
        to replace the legacy cliffhanger penalty.
        """

        scenes = self._normalized_scenes(draft_script)
        if not scenes:
            return None
        final_scene = scenes[-1]
        causality = final_scene.get("scene_causality")
        causality_outcome = (
            causality.get("outcome", "")
            if isinstance(causality, Mapping)
            else ""
        )
        evidence_values = [
            final_scene.get("turning_point"),
            causality_outcome,
            final_scene.get("resolution"),
            final_scene.get("episode_payoff"),
            final_scene.get("exit_state"),
            final_scene.get("unit_resolution"),
            draft_script.get("episode_payoff"),
            draft_script.get("exit_state"),
            draft_script.get("unit_resolution"),
        ]
        normalized_values = {
            " ".join(str(value).strip().casefold().split())
            for value in evidence_values
            if isinstance(value, str) and value.strip()
        }
        evidence_count = len(normalized_values)
        if evidence_count >= 3:
            return 4.5
        if evidence_count >= 2:
            return 4.0
        if evidence_count == 1:
            return 3.0
        return 2.0

    def _build_dimension_evaluations(
        self,
        draft_script: Mapping[str, Any],
        rubric_categories: list[Any],
    ) -> list[StoryQCDimensionEvaluation]:
        rubric_map = {
            str(category.category_name).lower(): category
            for category in rubric_categories
        }
        scenes = self._normalized_scenes(draft_script)

        return [
            self._build_hook_quality(draft_script, scenes, rubric_map),
            self._build_character_agency(draft_script, scenes, rubric_map),
            self._build_conflict_escalation(draft_script, scenes, rubric_map),
            self._build_emotional_payoff(draft_script, scenes, rubric_map),
            self._build_cliffhanger_strength(draft_script, scenes, rubric_map),
        ]

    def _build_hook_quality(
        self,
        draft_script: Mapping[str, Any],
        scenes: list[dict[str, Any]],
        rubric_map: dict[str, Any],
    ) -> StoryQCDimensionEvaluation:
        hook = str(draft_script.get("hook", "")).strip()
        first_scene = scenes[0] if scenes else {}
        category = rubric_map["hook"]
        scene_refs = self._scene_refs(first_scene)
        evidence = self._unique_strings(
            [
                self._truncate(f"Hook: {hook}", 160) if hook else "",
                self._truncate(
                    f"Scene 1 purpose: {first_scene.get('purpose', '')}",
                    160,
                )
                if first_scene.get("purpose")
                else "",
            ]
        )
        revision_signals = []
        if category.score < 4.0:
            revision_signals = [
                "strengthen_opening_conflict",
                "clarify_scroll_stopping_question",
            ]
        return self._dimension_evaluation(
            dimension=StoryQCDimension.hook_quality,
            category=category,
            summary=(
                "Opening hook establishes a clear contradiction and viewing question."
                if category.score >= 4.0
                else "Opening hook exists, but the conflict or viewer question is still soft."
            ),
            score_reason=(
                "The current score is driven by whether the draft hook is specific and whether the opening scene establishes immediate pressure."
            ),
            scene_refs=scene_refs,
            evidence=evidence,
            revision_signals=revision_signals,
        )

    def _build_character_agency(
        self,
        draft_script: Mapping[str, Any],
        scenes: list[dict[str, Any]],
        rubric_map: dict[str, Any],
    ) -> StoryQCDimensionEvaluation:
        category = rubric_map["character agency"]
        agency_keywords = {
            "reveal",
            "expose",
            "refuse",
            "choose",
            "decide",
            "activate",
            "demand",
            "confront",
            "reject",
            "take",
            "选择",
            "决定",
            "拒绝",
            "揭露",
            "揭穿",
            "对峙",
            "反抗",
            "要求",
            "夺走",
            "抢下",
        }
        agency_scenes = [
            scene
            for scene in scenes
            if self._scene_contains_keywords(scene, agency_keywords)
        ]
        scene_refs = self._scene_refs(*agency_scenes) or self._scene_refs(*scenes[:1])
        evidence = self._unique_strings(
            [
                self._truncate(
                    f"Scene {scene.get('scene_number')}: {scene.get('purpose', '')}",
                    160,
                )
                for scene in agency_scenes[:2]
            ]
            + [
                self._truncate(action, 160)
                for scene in agency_scenes[:2]
                for action in scene.get("character_actions", [])[:2]
            ]
        )
        revision_signals = []
        if category.score < 4.0:
            revision_signals = [
                "show_protagonist_choice",
                "increase_visible_action_risk",
            ]
        return self._dimension_evaluation(
            dimension=StoryQCDimension.character_agency,
            category=category,
            summary=(
                "The protagonist visibly pushes the plot with public choices or refusals."
                if category.score >= 4.0
                else "The protagonist is present, but their agency is not explicit enough yet."
            ),
            score_reason=(
                "The current score reflects whether the protagonist initiates, refuses, exposes, or otherwise changes the scene outcome through visible action."
            ),
            scene_refs=scene_refs,
            evidence=evidence,
            revision_signals=revision_signals,
        )

    def _build_conflict_escalation(
        self,
        draft_script: Mapping[str, Any],
        scenes: list[dict[str, Any]],
        rubric_map: dict[str, Any],
    ) -> StoryQCDimensionEvaluation:
        del draft_script
        category = rubric_map["conflict escalation"]
        final_scene = scenes[-1] if scenes else {}
        scene_refs = self._scene_refs(*scenes)
        evidence = self._unique_strings(
            [
                self._truncate(
                    f"Scene {scene.get('scene_number')} purpose: {scene.get('purpose', '')}",
                    160,
                )
                for scene in scenes[:3]
            ]
            + [
                self._truncate(
                    f"Final scene cliffhanger: {final_scene.get('cliffhanger')}",
                    160,
                )
                if final_scene
                else "",
            ]
        )
        revision_signals = []
        if category.score < 4.0:
            revision_signals = [
                "increase_scene_to_scene_stakes",
                "sharpen_episode_end_threat",
            ]
        return self._dimension_evaluation(
            dimension=StoryQCDimension.conflict_escalation,
            category=category,
            summary=(
                "The scenes build toward a stronger public or relational threat by the ending."
                if category.score >= 4.0
                else "The scenes progress, but the escalation curve is still too mild or too abrupt."
            ),
            score_reason=(
                "The current score reflects whether later scenes meaningfully raise pressure over earlier scenes and whether the episode ends under stronger threat than it began."
            ),
            scene_refs=scene_refs,
            evidence=evidence,
            revision_signals=revision_signals,
        )

    def _build_emotional_payoff(
        self,
        draft_script: Mapping[str, Any],
        scenes: list[dict[str, Any]],
        rubric_map: dict[str, Any],
    ) -> StoryQCDimensionEvaluation:
        del draft_script
        category = rubric_map["emotional progression"]
        scene_refs = self._scene_refs(*scenes)
        evidence = self._unique_strings(
            [
                self._truncate(
                    f"Scene {scene.get('scene_number')} emotional shift: {scene.get('emotional_shift', '')}",
                    160,
                )
                for scene in scenes[:3]
                if scene.get("emotional_shift")
            ]
            + [
                self._truncate(
                    f"Scene {scene.get('scene_number')} turning point: {scene.get('turning_point', '')}",
                    160,
                )
                for scene in scenes[:3]
                if scene.get("turning_point")
            ]
        )
        revision_signals = []
        if category.score < 4.0:
            revision_signals = [
                "sharpen_emotional_turn",
                "increase_payoff_after_reveal",
            ]
        return self._dimension_evaluation(
            dimension=StoryQCDimension.emotional_payoff,
            category=category,
            summary=(
                "The script sets up emotional expectation and lands meaningful turns between scenes."
                if category.score >= 4.0
                else "The draft has emotional movement, but the payoff or turn intensity remains uneven."
            ),
            score_reason=(
                "The current score reflects whether emotional shifts change across scenes and whether turning points deliver a satisfying escalation or reversal."
            ),
            scene_refs=scene_refs,
            evidence=evidence,
            revision_signals=revision_signals,
        )

    def _build_cliffhanger_strength(
        self,
        draft_script: Mapping[str, Any],
        scenes: list[dict[str, Any]],
        rubric_map: dict[str, Any],
    ) -> StoryQCDimensionEvaluation:
        category = rubric_map["cliffhanger strength"]
        final_scene = scenes[-1] if scenes else {}
        ending_mode = draft_script.get("ending_mode")
        if not ending_mode_requires_hook(ending_mode):
            scene_refs = self._scene_refs(final_scene)
            resolution_text = str(
                final_scene.get("turning_point")
                or final_scene.get("beat_summary")
                or ""
            ).strip()
            evidence = self._unique_strings(
                [
                    self._truncate(
                        f"Final scene resolution: {resolution_text}",
                        160,
                    )
                    if resolution_text
                    else "",
                ]
            )
            return self._dimension_evaluation(
                dimension=StoryQCDimension.cliffhanger_strength,
                category=category,
                summary=(
                    "Finale resolution is evaluated for emotional and causal closure rather than continuation pressure."
                ),
                score_reason=(
                    "A season or series finale is not required to create an unresolved cliffhanger."
                ),
                scene_refs=scene_refs,
                evidence=evidence,
                revision_signals=[],
            )
        next_episode_question = str(draft_script.get("next_episode_question", "")).strip()
        scene_refs = self._scene_refs(final_scene)
        evidence = self._unique_strings(
            [
                self._truncate(
                    f"Final scene turning point: {final_scene.get('turning_point', '')}",
                    160,
                )
                if final_scene.get("turning_point")
                else "",
                self._truncate(
                    f"Final emotional shift: {final_scene.get('emotional_shift', '')}",
                    160,
                )
                if final_scene.get("emotional_shift")
                else "",
                self._truncate(
                    f"Next episode question: {next_episode_question}",
                    160,
                )
                if next_episode_question
                else "",
            ]
        )
        revision_signals = []
        if category.score < 4.0:
            revision_signals = [
                "strengthen_unresolved_question",
                "end_on_power_reversal",
            ]
        return self._dimension_evaluation(
            dimension=StoryQCDimension.cliffhanger_strength,
            category=category,
            summary=(
                "The ending creates strong unresolved pressure that should pull viewers into the next episode."
                if category.score >= 4.0
                else "The ending reveals information, but the unresolved pressure could still be sharper."
            ),
            score_reason=(
                "The current score reflects whether the last scene ends with unresolved pressure, suspense, or a reversal strong enough to create immediate next-episode demand."
            ),
            scene_refs=scene_refs,
            evidence=evidence,
            revision_signals=revision_signals,
        )

    def _dimension_evaluation(
        self,
        *,
        dimension: StoryQCDimension,
        category: Any,
        summary: str,
        score_reason: str,
        scene_refs: list[int],
        evidence: list[str],
        revision_signals: list[str],
    ) -> StoryQCDimensionEvaluation:
        return StoryQCDimensionEvaluation(
            dimension=dimension,
            score=category.score,
            summary=summary,
            score_reason=score_reason,
            deduction_reasons=category.deduction_reasons,
            scene_refs=scene_refs,
            evidence=evidence,
            revision_signals=revision_signals,
        )

    def _build_evidence_summary(
        self,
        dimension_evaluations: list[StoryQCDimensionEvaluation],
    ) -> list[str]:
        summary: list[str] = []
        for evaluation in dimension_evaluations:
            if evaluation.evidence:
                summary.append(
                    self._truncate(
                        f"{evaluation.dimension.value}: {evaluation.evidence[0]}",
                        200,
                    )
                )
            elif evaluation.deduction_reasons:
                summary.append(
                    self._truncate(
                        f"{evaluation.dimension.value}: {evaluation.deduction_reasons[0]}",
                        200,
                    )
                )
        return self._unique_strings(summary)[:10]

    def _build_knowledge_refs(
        self,
        dimension_evaluations: list[StoryQCDimensionEvaluation],
        *,
        ending_mode: object = None,
    ) -> list[StoryQCKnowledgeRef]:
        knowledge_refs: list[StoryQCKnowledgeRef] = []
        for evaluation in dimension_evaluations:
            if not evaluation.deduction_reasons or not evaluation.evidence:
                continue
            # The legacy cliffhanger knowledge card describes unresolved
            # continuation pressure. It is not an actionable reference for a
            # season/series finale, whose contract is observable closure.
            if (
                evaluation.dimension == StoryQCDimension.cliffhanger_strength
                and not ending_mode_requires_hook(ending_mode)
            ):
                continue
            knowledge_id = self._placeholder_knowledge_id(evaluation.dimension)
            if knowledge_id is None:
                continue
            knowledge_refs.append(
                StoryQCKnowledgeRef(
                    knowledge_id=knowledge_id,
                    dimension=evaluation.dimension,
                    reason=evaluation.deduction_reasons[0],
                    evidence=evaluation.evidence[0],
                )
            )
        return knowledge_refs

    def _placeholder_knowledge_id(
        self,
        dimension: StoryQCDimension,
    ) -> str | None:
        mapping = {
            StoryQCDimension.hook_quality: "hook.core_conflict.fast_setup.v1",
            StoryQCDimension.character_agency: "character.agency.active_choice.v1",
            StoryQCDimension.conflict_escalation: "conflict.escalation.scene_to_scene.v1",
            StoryQCDimension.emotional_payoff: "emotion.payoff.turning_shift.v1",
            StoryQCDimension.cliffhanger_strength: "cliffhanger.unresolved_pressure.v1",
        }
        return mapping.get(dimension)

    def _normalized_scenes(self, draft_script: Mapping[str, Any]) -> list[dict[str, Any]]:
        scenes = draft_script.get("scenes", [])
        if not isinstance(scenes, list):
            return []
        return [scene for scene in scenes if isinstance(scene, Mapping)]

    def _scene_contains_keywords(
        self,
        scene: Mapping[str, Any],
        keywords: set[str],
    ) -> bool:
        search_fields: list[str] = [
            str(scene.get("purpose", "")),
            str(scene.get("beat_summary", "")),
            str(scene.get("turning_point", "")),
        ]
        search_fields.extend(str(item) for item in scene.get("character_actions", []))
        for dialogue in scene.get("dialogues", []):
            if isinstance(dialogue, Mapping):
                search_fields.append(str(dialogue.get("intent", "")))
                search_fields.append(str(dialogue.get("text", "")))
        haystack = " ".join(search_fields).lower()
        return any(keyword in haystack for keyword in keywords)

    def _scene_refs(self, *scenes: Mapping[str, Any]) -> list[int]:
        refs: list[int] = []
        for scene in scenes:
            if not isinstance(scene, Mapping):
                continue
            scene_number = scene.get("scene_number")
            if isinstance(scene_number, int):
                refs.append(scene_number)
        return list(dict.fromkeys(refs))

    def _unique_strings(self, values: list[str]) -> list[str]:
        ordered: list[str] = []
        seen: set[str] = set()
        for value in values:
            normalized = value.strip()
            if not normalized:
                continue
            lowered = normalized.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            ordered.append(normalized)
        return ordered

    def _truncate(self, value: str, limit: int) -> str:
        if len(value) <= limit:
            return value
        return value[: limit - 3].rstrip() + "..."
