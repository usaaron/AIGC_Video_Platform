from __future__ import annotations

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.models import (
    RevisionAction,
    RevisionPlan,
    RevisionPriority,
    RevisionTargetType,
    ScriptRevisionPlanRequest,
    StoryQCCheck,
    StoryQCRubricCategory,
)


class RubricRevisionPlanner:
    def build_plan(self, payload: ScriptRevisionPlanRequest) -> RevisionPlan:
        draft = payload.draft_master_script
        report = payload.story_qc_report
        actions: list[RevisionAction] = []
        seen_targets: set[str] = set()

        for category in sorted(
            report.rubric_categories,
            key=lambda item: (item.score, item.category_name.lower()),
        ):
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
            actions=actions,
            must_re_qc=True,
            notes=[
                "RevisionPlan is derived from Story QC checks and rubric deductions.",
                "After revisions, run Story QC again before promoting to Final MasterScript.",
            ],
        )

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
            RevisionTargetType.pacing: "Keeps the script short-form native for TikTok.",
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
