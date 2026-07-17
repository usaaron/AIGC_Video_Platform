from __future__ import annotations

from app.modules.master_script.models import DraftMasterScript, DraftSceneCard
from app.modules.script_engine.models import (
    RevisionAction,
    RevisionPlan,
    RevisionTargetType,
    ScriptRevisionRequest,
    ScriptRevisionRun,
)
from app.modules.script_engine.repository import GenerationStrategyRepository
from app.modules.script_engine.story_qc import PlaceholderStoryQC, StoryQC


class MissingRevisionGenerationStrategyError(ValueError):
    """Raised when a revision references a missing generation strategy."""


class InvalidRevisionPlanError(ValueError):
    """Raised when a revision plan does not match the provided draft."""


class ScriptRevisionService:
    def __init__(
        self,
        *,
        generation_strategy_repository: GenerationStrategyRepository,
        story_qc: StoryQC | None = None,
    ) -> None:
        self._generation_strategy_repository = generation_strategy_repository
        self._story_qc = story_qc or PlaceholderStoryQC()

    def revise(self, payload: ScriptRevisionRequest) -> ScriptRevisionRun:
        draft = payload.draft_master_script
        plan = payload.revision_plan
        self._validate_alignment(draft, plan)

        strategy = self._generation_strategy_repository.get(plan.generation_strategy_id)
        if strategy is None:
            raise MissingRevisionGenerationStrategyError(
                f"GenerationStrategy '{plan.generation_strategy_id}' was not found."
            )

        original_story_qc_report = self._story_qc.evaluate(
            draft.model_dump(),
            strategy=strategy,
        )
        revised_draft = self._apply_revision_actions(draft, plan.actions)
        revised_story_qc_report = self._story_qc.evaluate(
            revised_draft.model_dump(),
            strategy=strategy,
        )
        improved = revised_story_qc_report.overall_score >= original_story_qc_report.overall_score

        improvement_summary = [
            f"Story QC score changed from {original_story_qc_report.overall_score:.3f} to {revised_story_qc_report.overall_score:.3f}.",
            "Re-run Final MasterScript mapping only after the revised draft is accepted.",
        ]
        if improved:
            improvement_summary.insert(
                0,
                "Placeholder revision pass improved or preserved the draft Story QC score.",
            )
        else:
            improvement_summary.insert(
                0,
                "Placeholder revision pass did not improve the Story QC score yet.",
            )

        return ScriptRevisionRun(
            original_draft_master_script=draft,
            revision_plan=plan,
            revised_draft_master_script=revised_draft,
            original_story_qc_report=original_story_qc_report,
            revised_story_qc_report=revised_story_qc_report,
            applied_action_ids=[action.action_id for action in plan.actions],
            improvement_summary=improvement_summary,
            improved=improved,
        )

    def _validate_alignment(
        self,
        draft: DraftMasterScript,
        plan: RevisionPlan,
    ) -> None:
        if draft.id != plan.draft_master_script_id:
            raise InvalidRevisionPlanError(
                "RevisionPlan draft_master_script_id does not match the provided DraftMasterScript."
            )
        if draft.content_spec_id != plan.content_spec_id:
            raise InvalidRevisionPlanError(
                "RevisionPlan content_spec_id does not match the provided DraftMasterScript."
            )
        if draft.generation_strategy_id != plan.generation_strategy_id:
            raise InvalidRevisionPlanError(
                "RevisionPlan generation_strategy_id does not match the provided DraftMasterScript."
            )

    def _apply_revision_actions(
        self,
        draft: DraftMasterScript,
        actions: list[RevisionAction],
    ) -> DraftMasterScript:
        revised = draft.model_copy(deep=True)
        revision_flags: dict[str, bool] = {}
        applied_notes: list[str] = []

        for action in actions:
            self._apply_action(revised, action, revision_flags, applied_notes)

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
        return DraftMasterScript.model_validate(revised.model_dump())

    def _apply_action(
        self,
        draft: DraftMasterScript,
        action: RevisionAction,
        revision_flags: dict[str, bool],
        applied_notes: list[str],
    ) -> None:
        if action.target_type == RevisionTargetType.hook:
            draft.hook = self._strengthen_hook(draft.hook)
            revision_flags["hook_polish_complete"] = True
        elif action.target_type == RevisionTargetType.dialogue:
            draft.scenes = [
                self._strengthen_scene_dialogue(scene)
                if scene.scene_number in action.related_scene_numbers or not action.related_scene_numbers
                else scene
                for scene in draft.scenes
            ]
            revision_flags["dialogue_polish_complete"] = True
        elif action.target_type == RevisionTargetType.cliffhanger:
            draft.scenes[-1] = self._strengthen_final_cliffhanger(draft.scenes[-1])
            revision_flags["cliffhanger_polish_complete"] = True
        elif action.target_type == RevisionTargetType.conflict:
            draft.scenes = [self._raise_conflict(scene) for scene in draft.scenes]
            revision_flags["conflict_escalation_complete"] = True
        elif action.target_type == RevisionTargetType.emotion:
            draft.scenes = [self._sharpen_emotion(scene) for scene in draft.scenes]
            revision_flags["emotion_progression_complete"] = True
        elif action.target_type == RevisionTargetType.pacing:
            draft.target_duration_seconds = min(draft.target_duration_seconds, 42)
            revision_flags["pacing_polish_complete"] = True
        elif action.target_type == RevisionTargetType.commercial:
            draft.synopsis = self._strengthen_commercial_synopsis(draft.synopsis)
            revision_flags["commercial_polish_complete"] = True
        elif action.target_type == RevisionTargetType.scene_structure:
            draft.scenes = [self._clarify_scene_structure(scene) for scene in draft.scenes]
            revision_flags["structure_polish_complete"] = True
        elif action.target_type == RevisionTargetType.character:
            draft.scenes = [self._strengthen_character_agency(scene) for scene in draft.scenes]
            revision_flags["character_polish_complete"] = True
        elif action.target_type == RevisionTargetType.localization:
            revision_flags["localization_review_complete"] = True
            revision_flags["localization_polish_complete"] = True

        applied_notes.append(f"Applied revision action: {action.title}.")

    def _strengthen_hook(self, hook: str) -> str:
        base = hook.strip().rstrip(".?!")
        addition = "Then the groom said the name she buried years ago."
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
                    "A public reveal flips the power balance while one decisive answer remains withheld",
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
                    "The social and relational stakes rise in full view of the crowd",
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
