from __future__ import annotations

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.models import (
    RevisionAction,
    RevisionDecision,
    RevisionPlan,
    RevisionPriority,
    RevisionStrategy,
    RevisionTargetType,
    ScriptRevisionPlanRequest,
    StoryQCCheck,
    StoryQCDimension,
    StoryQCDimensionEvaluation,
    StoryQCReport,
    StoryQCRubricCategory,
)
from app.script_delivery_contract import ending_mode_requires_hook


class RubricRevisionPlanner:
    _DIMENSION_PRIORITY = {
        StoryQCDimension.hook_quality: 1,
        StoryQCDimension.character_agency: 2,
        StoryQCDimension.cliffhanger_strength: 3,
        StoryQCDimension.conflict_escalation: 4,
        StoryQCDimension.emotional_payoff: 5,
    }
    _MAX_SELECTED_DIMENSIONS = 2

    def build_plan(self, payload: ScriptRevisionPlanRequest) -> RevisionPlan:
        draft = payload.draft_master_script
        report = payload.story_qc_report
        decision = self.build_decision(
            report,
            ending_mode=draft.ending_mode,
        )
        strategies = self.build_strategies(report, decision)

        if report.dimension_evaluations:
            actions = [
                self._build_action_from_strategy(draft, strategy)
                for strategy in strategies
            ]
        else:
            actions = self._build_legacy_actions(draft, report)

        top_titles = [action.title for action in actions[:2]]
        focus_summary = (
            "; ".join(top_titles)
            if top_titles
            else "Perform a light polish pass before re-running Story QC."
        )
        overall_priority = self._derive_overall_priority(actions, report.overall_score)

        return RevisionPlan(
            draft_master_script_id=draft.id,
            content_spec_id=draft.content_spec_id,
            generation_strategy_id=draft.generation_strategy_id,
            story_qc_status=report.status,
            overall_priority=overall_priority,
            focus_summary=focus_summary,
            revision_decision=decision,
            revision_strategies=strategies,
            actions=actions,
            must_re_qc=True,
            notes=self._build_plan_notes(report, decision, strategies),
        )

    def build_decision(
        self,
        report: StoryQCReport,
        *,
        ending_mode=None,
    ) -> RevisionDecision:
        if not report.dimension_evaluations:
            return RevisionDecision(
                revision_required=self._legacy_revision_required(
                    report,
                    ending_mode=ending_mode,
                ),
                decision_reason=(
                    "Story QC dimension evidence is unavailable; preserve the legacy rubric planning path."
                ),
                confidence=0.4,
            )

        candidates = [
            evaluation
            for evaluation in report.dimension_evaluations
            if self._requires_revision(evaluation)
            and not (
                evaluation.dimension == StoryQCDimension.cliffhanger_strength
                and not ending_mode_requires_hook(ending_mode)
            )
        ]
        ranked_candidates = sorted(candidates, key=self._dimension_selection_key)
        selected = ranked_candidates[: self._MAX_SELECTED_DIMENSIONS]
        deferred = ranked_candidates[self._MAX_SELECTED_DIMENSIONS :]
        selected_dimensions = [evaluation.dimension for evaluation in selected]
        protected_dimensions = [
            evaluation.dimension
            for evaluation in report.dimension_evaluations
            if evaluation.dimension not in selected_dimensions
            and not self._requires_revision(evaluation)
        ]
        primary_scene_refs = self._unique_scene_refs(
            [
                scene_ref
                for evaluation in selected
                for scene_ref in evaluation.scene_refs
            ]
        )

        return RevisionDecision(
            revision_required=bool(selected),
            decision_reason=self._build_decision_reason(selected, deferred),
            selected_dimensions=selected_dimensions,
            deferred_dimensions=[evaluation.dimension for evaluation in deferred],
            protected_dimensions=protected_dimensions,
            primary_scene_refs=primary_scene_refs,
            confidence=self._decision_confidence(selected, report.dimension_evaluations),
        )

    def build_strategies(
        self,
        report: StoryQCReport,
        decision: RevisionDecision,
    ) -> list[RevisionStrategy]:
        evaluations = {
            evaluation.dimension: evaluation
            for evaluation in report.dimension_evaluations
        }
        protected_targets = [
            f"Preserve {dimension.value} while applying the targeted revision."
            for dimension in decision.protected_dimensions
        ]
        strategies: list[RevisionStrategy] = []

        for priority, dimension in enumerate(decision.selected_dimensions, start=1):
            evaluation = evaluations.get(dimension)
            if evaluation is None:
                continue
            strategies.append(
                RevisionStrategy(
                    target_dimension=dimension,
                    problem_type=(
                        evaluation.revision_signals[0]
                        if evaluation.revision_signals
                        else f"{dimension.value}_quality_gap"
                    ),
                    problem_reason=self._problem_reason(evaluation),
                    revision_goal=self._revision_goal(dimension),
                    revision_method=self._revision_method(dimension, evaluation.scene_refs),
                    expected_effect=self._dimension_expected_effect(dimension),
                    priority=priority,
                    confidence=self._evaluation_confidence(evaluation),
                    scene_refs=evaluation.scene_refs,
                    do_not_touch=protected_targets,
                    knowledge_refs=[
                        knowledge_ref
                        for knowledge_ref in report.knowledge_refs
                        if knowledge_ref.dimension == dimension
                    ],
                )
            )

        return strategies

    def _build_action_from_strategy(
        self,
        draft: DraftMasterScript,
        strategy: RevisionStrategy,
    ) -> RevisionAction:
        target_type = self._dimension_target_type(strategy.target_dimension)
        related_scene_numbers = strategy.scene_refs or self._related_scene_numbers(
            draft,
            target_type,
        )
        instructions = [strategy.revision_goal, strategy.revision_method]
        if strategy.do_not_touch:
            instructions.append(strategy.do_not_touch[0])

        return RevisionAction(
            action_id=f"revision.{draft.id}.{target_type.value}",
            target_type=target_type,
            priority=(
                RevisionPriority.high
                if strategy.priority == 1
                else RevisionPriority.medium
            ),
            title=self._dimension_title(strategy.target_dimension),
            rationale=self._truncate(strategy.problem_reason, 300),
            based_on_checks=[f"dimension.{strategy.target_dimension.value}"],
            related_scene_numbers=related_scene_numbers,
            instructions=self._unique_strings(instructions),
            expected_impact=self._truncate(strategy.expected_effect, 240),
        )

    def _build_legacy_actions(
        self,
        draft: DraftMasterScript,
        report: StoryQCReport,
    ) -> list[RevisionAction]:
        actions: list[RevisionAction] = []
        seen_targets: set[str] = set()

        for category in sorted(
            report.rubric_categories,
            key=lambda item: (item.score, item.category_name.lower()),
        ):
            if (
                category.category_name.casefold() == "cliffhanger strength"
                and not ending_mode_requires_hook(draft.ending_mode)
            ):
                continue
            if category.score >= 4.0 and not category.deduction_reasons:
                continue
            action = self._build_action_from_rubric(draft, category, report.checks)
            if action is None or action.target_type.value in seen_targets:
                continue
            seen_targets.add(action.target_type.value)
            actions.append(action)
            if len(actions) >= 5:
                break

        if not actions:
            fallback = self._build_fallback_action(draft, report.checks)
            if fallback is not None:
                actions.append(fallback)
        return actions

    def _requires_revision(self, evaluation: StoryQCDimensionEvaluation) -> bool:
        return evaluation.score < 4.0 or bool(evaluation.deduction_reasons)

    def _dimension_selection_key(
        self,
        evaluation: StoryQCDimensionEvaluation,
    ) -> tuple[int, int, float]:
        evidence_penalty = 0 if evaluation.scene_refs and evaluation.evidence else 1
        return (
            evidence_penalty,
            self._DIMENSION_PRIORITY[evaluation.dimension],
            evaluation.score,
        )

    def _build_decision_reason(
        self,
        selected: list[StoryQCDimensionEvaluation],
        deferred: list[StoryQCDimensionEvaluation],
    ) -> str:
        if not selected:
            return "No evidence-backed dimension falls below the revision threshold."
        selected_names = ", ".join(item.dimension.value for item in selected)
        reason = f"Selected {selected_names} as the highest-impact evidence-backed revision targets."
        if deferred:
            deferred_names = ", ".join(item.dimension.value for item in deferred)
            reason += f" Deferred {deferred_names} to keep this revision round bounded."
        return reason

    def _decision_confidence(
        self,
        selected: list[StoryQCDimensionEvaluation],
        evaluations: list[StoryQCDimensionEvaluation],
    ) -> float:
        if selected:
            return round(
                sum(self._evaluation_confidence(item) for item in selected) / len(selected),
                3,
            )
        return 0.8 if evaluations else 0.4

    def _evaluation_confidence(self, evaluation: StoryQCDimensionEvaluation) -> float:
        confidence = 0.5
        if evaluation.scene_refs:
            confidence += 0.15
        if evaluation.evidence:
            confidence += 0.15
        if evaluation.deduction_reasons:
            confidence += 0.1
        if evaluation.revision_signals:
            confidence += 0.1
        return round(min(confidence, 1.0), 3)

    def _problem_reason(self, evaluation: StoryQCDimensionEvaluation) -> str:
        if evaluation.deduction_reasons:
            return evaluation.deduction_reasons[0]
        return evaluation.summary

    def _revision_goal(self, dimension: StoryQCDimension) -> str:
        goals = {
            StoryQCDimension.hook_quality: "Establish an immediate contradiction and a clear unresolved viewing question.",
            StoryQCDimension.character_agency: "Give the protagonist an active choice with visible consequences.",
            StoryQCDimension.cliffhanger_strength: "End on unresolved pressure that creates immediate next-episode demand.",
            StoryQCDimension.conflict_escalation: "Make each targeted scene raise the stakes beyond the previous beat.",
            StoryQCDimension.emotional_payoff: "Deliver a clear emotional turn that fulfills the scene setup.",
        }
        return goals[dimension]

    def _revision_method(
        self,
        dimension: StoryQCDimension,
        scene_refs: list[int],
    ) -> str:
        scene_scope = self._scene_scope(scene_refs)
        methods = {
            StoryQCDimension.hook_quality: f"Introduce concrete unresolved conflict in {scene_scope} while preserving the final twist.",
            StoryQCDimension.character_agency: f"Replace a reactive beat in {scene_scope} with an irreversible protagonist decision.",
            StoryQCDimension.cliffhanger_strength: f"End {scene_scope} on a consequential threat, reversal, or withheld answer.",
            StoryQCDimension.conflict_escalation: f"Increase opposition and consequences across {scene_scope} without changing unrelated scenes.",
            StoryQCDimension.emotional_payoff: f"Strengthen the setup-to-payoff emotional turn in {scene_scope} without adding a new subplot.",
        }
        return methods[dimension]

    def _dimension_expected_effect(self, dimension: StoryQCDimension) -> str:
        effects = {
            StoryQCDimension.hook_quality: "Improves immediate conflict clarity and opening retention pressure.",
            StoryQCDimension.character_agency: "Improves protagonist agency through a visible, consequential choice.",
            StoryQCDimension.cliffhanger_strength: "Improves continuation intent through unresolved consequential pressure.",
            StoryQCDimension.conflict_escalation: "Improves scene-to-scene escalation while preserving narrative continuity.",
            StoryQCDimension.emotional_payoff: "Improves emotional satisfaction without expanding the story scope.",
        }
        return effects[dimension]

    def _dimension_target_type(
        self,
        dimension: StoryQCDimension,
    ) -> RevisionTargetType:
        mapping = {
            StoryQCDimension.hook_quality: RevisionTargetType.hook,
            StoryQCDimension.character_agency: RevisionTargetType.character,
            StoryQCDimension.cliffhanger_strength: RevisionTargetType.cliffhanger,
            StoryQCDimension.conflict_escalation: RevisionTargetType.conflict,
            StoryQCDimension.emotional_payoff: RevisionTargetType.emotion,
        }
        return mapping[dimension]

    def _dimension_title(self, dimension: StoryQCDimension) -> str:
        return f"Strengthen {dimension.value.replace('_', ' ')}"

    def _scene_scope(self, scene_refs: list[int]) -> str:
        if not scene_refs:
            return "the evidence-backed scene"
        if len(scene_refs) == 1:
            return f"Scene {scene_refs[0]}"
        return "Scenes " + ", ".join(str(scene_ref) for scene_ref in scene_refs)

    def _legacy_revision_required(
        self,
        report: StoryQCReport,
        *,
        ending_mode=None,
    ) -> bool:
        def check_requires_revision(check: StoryQCCheck) -> bool:
            if check.passed:
                return False
            if not ending_mode_requires_hook(ending_mode):
                check_text = f"{check.check_name} {check.note}".casefold()
                if "cliffhanger" in check_text or "结尾钩" in check_text:
                    return False
            return True

        return any(
            (
                category.score < 4.0 or category.deduction_reasons
            )
            and not (
                category.category_name.casefold() == "cliffhanger strength"
                and not ending_mode_requires_hook(ending_mode)
            )
            for category in report.rubric_categories
        ) or any(check_requires_revision(check) for check in report.checks)

    def _build_plan_notes(
        self,
        report: StoryQCReport,
        decision: RevisionDecision,
        strategies: list[RevisionStrategy],
    ) -> list[str]:
        if not report.dimension_evaluations:
            return [
                "RevisionPlan is derived from Story QC checks and rubric deductions.",
                "After revisions, run Story QC again before promoting to Final MasterScript.",
            ]

        notes = [
            f"RevisionDecision: {decision.decision_reason}",
            f"Generated {len(strategies)} evidence-driven revision strategies.",
            "After revisions, run Story QC again before promoting to Final MasterScript.",
        ]
        if decision.protected_dimensions:
            protected = ", ".join(
                dimension.value for dimension in decision.protected_dimensions
            )
            notes.append(f"Protected dimensions: {protected}.")
        return notes

    def _unique_scene_refs(self, values: list[int]) -> list[int]:
        return list(dict.fromkeys(values))

    def _truncate(self, value: str, limit: int) -> str:
        if len(value) <= limit:
            return value
        return value[: limit - 3].rstrip() + "..."

    def _build_action_from_rubric(
        self,
        draft: DraftMasterScript,
        category: StoryQCRubricCategory,
        checks: list[StoryQCCheck],
    ) -> RevisionAction | None:
        target_type = self._map_target_type(category.category_name)
        if target_type is None:
            return None
        related_scene_numbers = self._related_scene_numbers(draft, target_type)
        instructions = category.revision_suggestions[:]
        if not instructions:
            instructions.append("Address the weakest rubric deduction before re-running QC.")
        if category.deduction_reasons:
            instructions.append(f"Fix issue: {category.deduction_reasons[0]}")
        instructions = self._unique_strings(instructions)[:3]
        based_on_checks = self._match_checks(category, checks)

        return RevisionAction(
            action_id=f"revision.{draft.id}.{target_type.value}",
            target_type=target_type,
            priority=self._derive_action_priority(category.score, target_type),
            title=self._build_title(category.category_name),
            rationale=(
                category.deduction_reasons[0]
                if category.deduction_reasons
                else f"{category.category_name} scored below the preferred threshold."
            ),
            based_on_checks=based_on_checks,
            related_scene_numbers=related_scene_numbers,
            instructions=instructions,
            expected_impact=self._expected_impact(target_type),
        )

    def _build_fallback_action(
        self,
        draft: DraftMasterScript,
        checks: list[StoryQCCheck],
    ) -> RevisionAction | None:
        if not checks:
            return None
        failed_checks = [check for check in checks if not check.passed]
        primary_check = failed_checks[0] if failed_checks else checks[0]
        return RevisionAction(
            action_id=f"revision.{draft.id}.polish",
            target_type=RevisionTargetType.scene_structure,
            priority=RevisionPriority.medium,
            title="Polish structural clarity",
            rationale=primary_check.note,
            based_on_checks=[primary_check.check_name],
            related_scene_numbers=[scene.scene_number for scene in draft.scenes],
            instructions=[
                "Clarify each scene objective and escalation beat.",
                "Re-run Story QC after the structural polish pass.",
            ],
            expected_impact="Improves baseline readability and Story QC stability.",
        )

    def _map_target_type(self, category_name: str) -> RevisionTargetType | None:
        mapping = {
            "Hook": RevisionTargetType.hook,
            "Narrative Logic": RevisionTargetType.scene_structure,
            "Character Consistency": RevisionTargetType.character,
            "Character Agency": RevisionTargetType.character,
            "Emotional Progression": RevisionTargetType.emotion,
            "Conflict Escalation": RevisionTargetType.conflict,
            "Dialogue Quality": RevisionTargetType.dialogue,
            "Platform Fit": RevisionTargetType.pacing,
            "TikTok Platform Fit": RevisionTargetType.pacing,
            "Cultural Fit": RevisionTargetType.localization,
            "Commercial Potential": RevisionTargetType.commercial,
            "Cliffhanger Strength": RevisionTargetType.cliffhanger,
        }
        return mapping.get(category_name)

    def _related_scene_numbers(
        self,
        draft: DraftMasterScript,
        target_type: RevisionTargetType,
    ) -> list[int]:
        if not draft.scenes:
            return []
        if target_type == RevisionTargetType.hook:
            return [draft.scenes[0].scene_number]
        if target_type == RevisionTargetType.cliffhanger:
            return [draft.scenes[-1].scene_number]
        return [scene.scene_number for scene in draft.scenes]

    def _derive_action_priority(
        self,
        score: float,
        target_type: RevisionTargetType,
    ) -> RevisionPriority:
        if score < 3.0 or target_type in {
            RevisionTargetType.hook,
            RevisionTargetType.dialogue,
            RevisionTargetType.cliffhanger,
        }:
            return RevisionPriority.high
        if score < 4.0:
            return RevisionPriority.medium
        return RevisionPriority.low

    def _derive_overall_priority(
        self,
        actions: list[RevisionAction],
        overall_score: float,
    ) -> RevisionPriority:
        if overall_score < 0.65 or any(
            action.priority == RevisionPriority.high for action in actions
        ):
            return RevisionPriority.high
        if actions:
            return RevisionPriority.medium
        return RevisionPriority.low

    def _build_title(self, category_name: str) -> str:
        return f"Strengthen {category_name.lower()}"

    def _match_checks(
        self,
        category: StoryQCRubricCategory,
        checks: list[StoryQCCheck],
    ) -> list[str]:
        related: list[str] = []
        category_name = category.category_name.lower()
        for check in checks:
            check_name = check.check_name.lower()
            note = check.note.lower()
            if (
                "hook" in category_name
                and "hook" in check_name
                or "scene" in category_name
                and "scene" in check_name
                or "dialogue" in category_name
                and "dialogue" in note
                or "qc" in note
                and "platform" in category_name
            ):
                related.append(check.check_name)
        if not related:
            related.append(f"rubric.{category.category_name.lower().replace(' ', '_')}")
        return self._unique_strings(related)

    def _expected_impact(self, target_type: RevisionTargetType) -> str:
        messages = {
            RevisionTargetType.hook: "Improves first-second stopping power and replay intent.",
            RevisionTargetType.scene_structure: "Makes escalation easier to follow scene by scene.",
            RevisionTargetType.character: "Improves motivation clarity and protagonist agency.",
            RevisionTargetType.emotion: "Sharpens emotional curve and audience attachment.",
            RevisionTargetType.conflict: "Raises stakes and episode-end urgency.",
            RevisionTargetType.dialogue: "Improves line specificity and performability.",
            RevisionTargetType.pacing: "Aligns pacing with the selected platform or market profile.",
            RevisionTargetType.commercial: "Strengthens retention pressure and sequel demand.",
            RevisionTargetType.cliffhanger: "Makes the unresolved ending more compelling.",
            RevisionTargetType.localization: "Reduces audience confusion and improves clarity.",
        }
        return messages[target_type]

    def _unique_strings(self, values: list[str]) -> list[str]:
        unique: list[str] = []
        seen: set[str] = set()
        for value in values:
            normalized = value.strip().lower()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            unique.append(value)
        return unique
