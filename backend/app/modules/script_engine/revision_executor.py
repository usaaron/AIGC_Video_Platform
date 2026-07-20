from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable

from app.modules.master_script.models import DraftMasterScript, DraftSceneCard
from app.modules.script_engine.models import (
    ProtectedScopeStatus,
    RevisionAction,
    RevisionExecutionMode,
    RevisionExecutionResult,
    RevisionExecutionTrace,
    RevisionPlan,
    RevisionProtectedScopeCheck,
    RevisionSkippedAction,
    RevisionStrategy,
    RevisionStrategyExecutionContext,
    RevisionTargetType,
    StoryQCDimension,
)


class RevisionExecutor(ABC):
    @abstractmethod
    def execute(
        self,
        *,
        draft: DraftMasterScript,
        plan: RevisionPlan,
        strategies: list[RevisionStrategy],
    ) -> RevisionExecutionResult:
        """Apply one bounded revision plan and return its execution trace."""


class RuleBasedRevisionExecutor(RevisionExecutor):
    executor_version = "rule_based_revision_executor.v1"

    _DIMENSION_TARGETS = {
        StoryQCDimension.hook_quality: RevisionTargetType.hook,
        StoryQCDimension.character_agency: RevisionTargetType.character,
        StoryQCDimension.conflict_escalation: RevisionTargetType.conflict,
        StoryQCDimension.emotional_payoff: RevisionTargetType.emotion,
        StoryQCDimension.cliffhanger_strength: RevisionTargetType.cliffhanger,
    }
    def execute(
        self,
        *,
        draft: DraftMasterScript,
        plan: RevisionPlan,
        strategies: list[RevisionStrategy],
    ) -> RevisionExecutionResult:
        controlled = plan.revision_decision is not None and bool(strategies)
        execution_mode = (
            RevisionExecutionMode.controlled
            if controlled
            else RevisionExecutionMode.legacy_fallback
        )
        consumed_strategies = strategies if controlled else []
        revised = draft.model_copy(deep=True)
        revision_flags: dict[str, bool] = {}
        applied_notes: list[str] = []
        applied_actions: list[str] = []
        skipped_actions: list[RevisionSkippedAction] = []
        modified_scene_numbers: set[int] = set()

        for action in plan.actions:
            strategy = self._strategy_for_action(action, strategies) if controlled else None
            skip_reason = self._controlled_skip_reason(plan, action, strategy, controlled)
            if skip_reason is not None:
                skipped_actions.append(
                    self._skipped_action(action, strategy, skip_reason)
                )
                continue

            scene_scope, scope_error = self._resolve_scene_scope(
                revised,
                action,
                strategy,
                controlled,
            )
            if scope_error is not None:
                skipped_actions.append(
                    self._skipped_action(action, strategy, scope_error)
                )
                continue

            modified_scene_numbers.update(
                self._apply_action(
                    revised,
                    action,
                    scene_scope,
                    revision_flags,
                    applied_notes,
                )
            )
            applied_actions.append(action.action_id)

        revised.qa_notes = self._merge_unique(
            revised.qa_notes,
            applied_notes
            + [
                "Placeholder script revision pass completed from RevisionPlan actions.",
            ],
        )
        revised.llm_metadata = {
            **revised.llm_metadata,
            "revision_signals": revision_flags,
        }
        trace = RevisionExecutionTrace(
            executor_version=self.executor_version,
            execution_mode=execution_mode,
            applied_actions=applied_actions,
            skipped_actions=skipped_actions,
            modified_scene_numbers=sorted(modified_scene_numbers),
            protected_scope_checks=self._protected_scope_checks(
                plan,
                consumed_strategies,
                skipped_actions,
                controlled,
            ),
            strategy_ids=[
                self._strategy_id(strategy) for strategy in consumed_strategies
            ],
            strategy_contexts=[
                self._strategy_context(strategy) for strategy in consumed_strategies
            ],
        )
        return RevisionExecutionResult(
            revised_draft_master_script=DraftMasterScript.model_validate(
                revised.model_dump()
            ),
            execution_trace=trace,
        )

    def _controlled_skip_reason(
        self,
        plan: RevisionPlan,
        action: RevisionAction,
        strategy: RevisionStrategy | None,
        controlled: bool,
    ) -> str | None:
        if not controlled:
            return None
        decision = plan.revision_decision
        if decision is None:
            return None
        action_dimension = self._dimension_for_target(action.target_type)
        if action_dimension in decision.protected_dimensions:
            return "protected_dimension"
        if decision.revision_required is False:
            return "revision_not_required"
        if strategy is None:
            return "missing_revision_strategy"
        if strategy.target_dimension not in decision.selected_dimensions:
            return "outside_selected_dimensions"
        return None

    def _resolve_scene_scope(
        self,
        draft: DraftMasterScript,
        action: RevisionAction,
        strategy: RevisionStrategy | None,
        controlled: bool,
    ) -> tuple[set[int] | None, str | None]:
        if not controlled or strategy is None:
            return None, None
        if not strategy.scene_refs:
            return set(action.related_scene_numbers) or None, None

        existing_scene_numbers = {scene.scene_number for scene in draft.scenes}
        valid_scope = set(strategy.scene_refs) & existing_scene_numbers
        if not valid_scope:
            return set(), "scene_scope_not_found"

        if action.target_type == RevisionTargetType.hook:
            opening_scene = draft.scenes[0].scene_number
            if opening_scene not in valid_scope:
                return valid_scope, "outside_selected_scene_scope"
        if action.target_type == RevisionTargetType.cliffhanger:
            final_scene = draft.scenes[-1].scene_number
            if final_scene not in valid_scope:
                return valid_scope, "outside_selected_scene_scope"
        return valid_scope, None

    def _strategy_for_action(
        self,
        action: RevisionAction,
        strategies: list[RevisionStrategy],
    ) -> RevisionStrategy | None:
        for strategy in strategies:
            if self._DIMENSION_TARGETS[strategy.target_dimension] == action.target_type:
                return strategy
        return None

    def _dimension_for_target(
        self,
        target_type: RevisionTargetType,
    ) -> StoryQCDimension | None:
        for dimension, mapped_target in self._DIMENSION_TARGETS.items():
            if mapped_target == target_type:
                return dimension
        return None

    def _apply_action(
        self,
        draft: DraftMasterScript,
        action: RevisionAction,
        scene_scope: set[int] | None,
        revision_flags: dict[str, bool],
        applied_notes: list[str],
    ) -> set[int]:
        modified_scene_numbers: set[int] = set()
        if action.target_type == RevisionTargetType.hook:
            draft.hook = self._strengthen_hook(draft.hook)
            revision_flags["hook_polish_complete"] = True
        elif action.target_type == RevisionTargetType.dialogue:
            target_scenes = self._target_scene_numbers(draft, action, scene_scope)
            modified_scene_numbers.update(
                self._update_scoped_scenes(
                    draft,
                    target_scenes,
                    self._strengthen_scene_dialogue,
                )
            )
            revision_flags["dialogue_polish_complete"] = True
        elif action.target_type == RevisionTargetType.cliffhanger:
            final_scene_number = draft.scenes[-1].scene_number
            original_scene = draft.scenes[-1]
            revised_scene = self._strengthen_final_cliffhanger(original_scene)
            draft.scenes[-1] = revised_scene
            if revised_scene != original_scene:
                modified_scene_numbers.add(final_scene_number)
            revision_flags["cliffhanger_polish_complete"] = True
        elif action.target_type == RevisionTargetType.conflict:
            modified_scene_numbers.update(
                self._update_scoped_scenes(draft, scene_scope, self._raise_conflict)
            )
            revision_flags["conflict_escalation_complete"] = True
        elif action.target_type == RevisionTargetType.emotion:
            modified_scene_numbers.update(
                self._update_scoped_scenes(draft, scene_scope, self._sharpen_emotion)
            )
            revision_flags["emotion_progression_complete"] = True
        elif action.target_type == RevisionTargetType.pacing:
            draft.target_duration_seconds = min(draft.target_duration_seconds, 42)
            revision_flags["pacing_polish_complete"] = True
        elif action.target_type == RevisionTargetType.commercial:
            draft.synopsis = self._strengthen_commercial_synopsis(draft.synopsis)
            revision_flags["commercial_polish_complete"] = True
        elif action.target_type == RevisionTargetType.scene_structure:
            modified_scene_numbers.update(
                self._update_scoped_scenes(
                    draft,
                    scene_scope,
                    self._clarify_scene_structure,
                )
            )
            revision_flags["structure_polish_complete"] = True
        elif action.target_type == RevisionTargetType.character:
            modified_scene_numbers.update(
                self._update_scoped_scenes(
                    draft,
                    scene_scope,
                    self._strengthen_character_agency,
                )
            )
            revision_flags["character_polish_complete"] = True
        elif action.target_type == RevisionTargetType.localization:
            revision_flags["localization_review_complete"] = True
            revision_flags["localization_polish_complete"] = True

        applied_notes.append(f"Applied revision action: {action.title}.")
        return modified_scene_numbers

    def _target_scene_numbers(
        self,
        draft: DraftMasterScript,
        action: RevisionAction,
        scene_scope: set[int] | None,
    ) -> set[int]:
        if scene_scope is not None:
            requested_scene_numbers = scene_scope
        elif action.related_scene_numbers:
            requested_scene_numbers = set(action.related_scene_numbers)
        else:
            requested_scene_numbers = {
                scene.scene_number for scene in draft.scenes
            }
        existing_scene_numbers = {scene.scene_number for scene in draft.scenes}
        return requested_scene_numbers & existing_scene_numbers

    def _update_scoped_scenes(
        self,
        draft: DraftMasterScript,
        scene_scope: set[int] | None,
        update: Callable[[DraftSceneCard], DraftSceneCard],
    ) -> set[int]:
        target_scenes = (
            scene_scope
            if scene_scope is not None
            else {scene.scene_number for scene in draft.scenes}
        )
        revised_scenes: list[DraftSceneCard] = []
        modified_scene_numbers: set[int] = set()
        for scene in draft.scenes:
            revised_scene = (
                update(scene) if scene.scene_number in target_scenes else scene
            )
            revised_scenes.append(revised_scene)
            if revised_scene != scene:
                modified_scene_numbers.add(scene.scene_number)
        draft.scenes = revised_scenes
        return modified_scene_numbers

    def _skipped_action(
        self,
        action: RevisionAction,
        strategy: RevisionStrategy | None,
        reason: str,
    ) -> RevisionSkippedAction:
        return RevisionSkippedAction(
            action_id=action.action_id,
            target_type=action.target_type,
            reason=reason,
            requested_scene_numbers=(
                strategy.scene_refs if strategy is not None else action.related_scene_numbers
            ),
        )

    def _protected_scope_checks(
        self,
        plan: RevisionPlan,
        strategies: list[RevisionStrategy],
        skipped_actions: list[RevisionSkippedAction],
        controlled: bool,
    ) -> list[RevisionProtectedScopeCheck]:
        if not controlled or plan.revision_decision is None:
            return []

        checks: list[RevisionProtectedScopeCheck] = []
        for dimension in plan.revision_decision.protected_dimensions:
            target_type = self._DIMENSION_TARGETS[dimension]
            blocked = any(
                skipped.target_type == target_type
                and skipped.reason == "protected_dimension"
                for skipped in skipped_actions
            )
            checks.append(
                RevisionProtectedScopeCheck(
                    scope_ref=f"protected_dimension:{dimension.value}",
                    status=(
                        ProtectedScopeStatus.blocked
                        if blocked
                        else ProtectedScopeStatus.respected
                    ),
                    note=(
                        "A conflicting action was blocked by the protected dimension."
                        if blocked
                        else "No conflicting action was applied to the protected dimension."
                    ),
                )
            )

        for strategy in strategies:
            for directive in strategy.do_not_touch:
                checks.append(
                    RevisionProtectedScopeCheck(
                        scope_ref=f"strategy_directive:{self._strategy_id(strategy)}",
                        status=ProtectedScopeStatus.recorded_only,
                        note=f"Recorded non-executable protection directive: {directive}",
                    )
                )
        return checks

    def _strategy_context(
        self,
        strategy: RevisionStrategy,
    ) -> RevisionStrategyExecutionContext:
        return RevisionStrategyExecutionContext(
            strategy_id=self._strategy_id(strategy),
            target_dimension=strategy.target_dimension,
            problem_reason=strategy.problem_reason,
            revision_goal=strategy.revision_goal,
            revision_method=strategy.revision_method,
            expected_effect=strategy.expected_effect,
            priority=strategy.priority,
            confidence=strategy.confidence,
            scene_refs=strategy.scene_refs,
            do_not_touch=strategy.do_not_touch,
            knowledge_ref_ids=[ref.knowledge_id for ref in strategy.knowledge_refs],
        )

    def _strategy_id(self, strategy: RevisionStrategy) -> str:
        return f"revision_strategy.{strategy.target_dimension.value}.p{strategy.priority}"

    def _strengthen_hook(self, hook: str) -> str:
        base = hook.strip().rstrip(".?!")
        addition = "Then someone revealed the secret the lead had buried years ago."
        if addition.lower() in base.lower():
            return f"{base}."
        return f"{base}. {addition}"

    def _strengthen_scene_dialogue(self, scene: DraftSceneCard) -> DraftSceneCard:
        prompts = self._merge_unique(
            scene.dialogue_prompts,
            [
                "Use one line with a concrete accusation and one line with a power reversal.",
                "Make each line short, performable and impossible to scroll past.",
            ],
        )
        return scene.model_copy(update={"dialogue_prompts": prompts})

    def _strengthen_final_cliffhanger(self, scene: DraftSceneCard) -> DraftSceneCard:
        updated_prompt = self._merge_unique(
            scene.dialogue_prompts,
            ["End on an unanswered reveal that forces the next episode."],
        )
        return scene.model_copy(
            update={
                "beat_summary": self._append_descriptive_sentence(
                    scene.beat_summary,
                    "A consequential reveal shifts the power balance while one "
                    "decisive answer remains withheld",
                ),
                "emotional_shift": "shock_to_suspense",
                "dialogue_prompts": updated_prompt,
            }
        )

    def _raise_conflict(self, scene: DraftSceneCard) -> DraftSceneCard:
        return scene.model_copy(
            update={
                "beat_summary": self._append_descriptive_sentence(
                    scene.beat_summary,
                    "The opposition raises the stakes through a concrete consequence",
                )
            }
        )

    def _sharpen_emotion(self, scene: DraftSceneCard) -> DraftSceneCard:
        shift = scene.emotional_shift
        if "to" not in shift:
            shift = f"{shift}_to_suspense"
        return scene.model_copy(update={"emotional_shift": shift})

    def _strengthen_commercial_synopsis(self, synopsis: str) -> str:
        base = synopsis.strip().rstrip(".")
        addition = "The episode should trigger immediate sequel curiosity and comment debate."
        if addition.lower() in base.lower():
            return f"{base}."
        return f"{base}. {addition}"

    def _clarify_scene_structure(self, scene: DraftSceneCard) -> DraftSceneCard:
        return scene.model_copy(
            update={
                "beat_summary": self._append_descriptive_sentence(
                    scene.beat_summary,
                    "This beat clearly triggers the next escalation",
                )
            }
        )

    def _strengthen_character_agency(self, scene: DraftSceneCard) -> DraftSceneCard:
        return scene.model_copy(
            update={
                "purpose": self._append_descriptive_sentence(
                    scene.purpose,
                    "The lead makes an irreversible choice",
                )
            }
        )

    def _append_descriptive_sentence(self, base_text: str, addition: str) -> str:
        normalized_base = base_text.strip().rstrip(".")
        normalized_addition = addition.strip().rstrip(".")
        if not normalized_base:
            return f"{normalized_addition}."
        if normalized_addition.lower() in normalized_base.lower():
            return f"{normalized_base}."
        return f"{normalized_base}. {normalized_addition}."

    def _merge_unique(self, existing: list[str], additions: list[str]) -> list[str]:
        merged: list[str] = []
        seen: set[str] = set()
        for value in [*existing, *additions]:
            normalized = value.strip().lower()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            merged.append(value)
        return merged
