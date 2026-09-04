from __future__ import annotations

from pydantic import ValidationError

from app.modules.content_spec.models import ContentSpec
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.master_script.models import (
    DraftMasterScript,
    DraftSceneCard,
    MasterScript,
    MasterScriptFinalizationResult,
    MasterScriptFinalizeRequest,
    FinalMasterScriptLineage,
    SceneCard,
    DialogueLine,
)
from app.modules.master_script.repository import MasterScriptRepository
from app.modules.script_engine.continuity_qc import evaluate_episode_continuity
from app.script_delivery_contract import (
    EPISODE_RUNTIME_MAX_SECONDS,
    EPISODE_RUNTIME_MIN_SECONDS,
)
from app.modules.script_engine.mainland_language import (
    blocking_draft_script_chinese_issues,
)
from app.modules.script_engine.mainland_screenplay import draft_screenplay_style_issues
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration
from app.runtime_policies import MASTER_SCRIPT_FINALIZATION_POLICY


class MissingContentSpecError(ValueError):
    """Raised when a referenced content spec does not exist."""


class DirectMasterScriptCreationDeprecatedError(ValueError):
    """Raised when callers try to bypass the controlled finalization chain."""


class InvalidFinalizationChainError(ValueError):
    """Raised when finalize inputs do not preserve the required lineage chain."""


class FinalizationThresholdNotMetError(ValueError):
    """Raised when the revised draft does not satisfy the configured Re-QC threshold."""


class InvalidFinalScriptAcceptanceError(ValueError):
    """Raised when a mainland final script violates a production contract."""


class MasterScriptService:
    def __init__(
        self,
        repository: MasterScriptRepository,
        content_spec_repository: ContentSpecRepository,
        ) -> None:
        self._repository = repository
        self._content_spec_repository = content_spec_repository

    def create(self, payload: object) -> MasterScript:
        raise DirectMasterScriptCreationDeprecatedError(
            "Direct FinalMasterScript creation is deprecated. Use the controlled finalize endpoint."
        )

    def get(self, master_script_id: str) -> MasterScript | None:
        return self._repository.get(master_script_id)

    def list(self) -> list[MasterScript]:
        return self._repository.list()

    def create_from_draft(
        self,
        payload: MasterScriptFinalizeRequest,
    ) -> MasterScriptFinalizationResult:
        draft_run = payload.script_generation_draft_run
        revision_run = payload.script_revision_run
        revised_draft_master_script = revision_run.revised_draft_master_script

        self._validate_finalization_chain(
            draft_run=draft_run,
            revision_run=revision_run,
        )
        if not self._ensure_content_spec_available(
            content_spec_id=revised_draft_master_script.content_spec_id,
            draft_run=draft_run,
        ):
            raise MissingContentSpecError(
                f"ContentSpec '{revised_draft_master_script.content_spec_id}' was not found."
            )
        minimum_re_qc_score = (
            payload.minimum_re_qc_score_override
            if payload.minimum_re_qc_score_override is not None
            else MASTER_SCRIPT_FINALIZATION_POLICY.minimum_re_qc_score
        )
        re_qc_score = revision_run.revised_story_qc_report.overall_score
        if re_qc_score < minimum_re_qc_score:
            raise FinalizationThresholdNotMetError(
                "Re-QC score is below the minimum finalization threshold. "
                f"Required {minimum_re_qc_score:.3f}, received {re_qc_score:.3f}."
            )
        self._validate_mainland_final_script(
            revised_draft_master_script,
            episode_context=draft_run.episode_context,
        )

        mapping_notes = [
            "Final MasterScript was finalized from a validated revised draft chain.",
            f"Finalization policy: {MASTER_SCRIPT_FINALIZATION_POLICY.policy_id}.",
        ]
        master_script = MasterScript(
            content_spec_id=revised_draft_master_script.content_spec_id,
            title=revised_draft_master_script.title,
            logline=revised_draft_master_script.logline,
            language=revised_draft_master_script.language,
            target_audience=revised_draft_master_script.target_audience,
            target_platform=revised_draft_master_script.target_platform,
            tone=revised_draft_master_script.tone,
            hook=revised_draft_master_script.hook,
            synopsis=revised_draft_master_script.synopsis,
            episode_goal=revised_draft_master_script.episode_goal,
            target_duration_seconds=revised_draft_master_script.target_duration_seconds,
            characters=revised_draft_master_script.characters,
            character_state_updates=revised_draft_master_script.character_state_updates,
            relationship_state_updates=revised_draft_master_script.relationship_state_updates,
            continuity_state_updates=revised_draft_master_script.continuity_state_updates,
            story_line_updates=revised_draft_master_script.story_line_updates,
            setup_payoff_updates=revised_draft_master_script.setup_payoff_updates,
            continuation_hook=revised_draft_master_script.continuation_hook,
            scenes=[
                self._map_scene_card(
                    scene=scene,
                    dialogue_line_count_per_scene=payload.dialogue_line_count_per_scene,
                    speaker_name_cycle=payload.speaker_name_cycle,
                )
                for scene in revised_draft_master_script.scenes
            ],
            next_episode_question=revised_draft_master_script.next_episode_question,
            qa_notes=revised_draft_master_script.qa_notes + mapping_notes,
            version=MASTER_SCRIPT_FINALIZATION_POLICY.finalization_version,
            lineage=self._build_lineage(
                draft_run=draft_run,
                revision_run=revision_run,
                dialogue_line_count_per_scene=payload.dialogue_line_count_per_scene,
                speaker_name_cycle=payload.speaker_name_cycle,
                minimum_re_qc_score=minimum_re_qc_score,
            ),
        )
        saved = self._repository.save(master_script)
        return MasterScriptFinalizationResult(
            master_script=saved,
            source_draft_id=revised_draft_master_script.id,
            mapping_notes=mapping_notes,
        )

    def _validate_finalization_chain(
        self,
        *,
        draft_run,
        revision_run,
    ) -> None:
        draft_master_script = draft_run.draft_master_script
        if draft_master_script.id != revision_run.original_draft_master_script.id:
            raise InvalidFinalizationChainError(
                "Revision input does not match the original DraftMasterScript."
            )
        if draft_run.content_spec_id != revision_run.revision_plan.content_spec_id:
            raise InvalidFinalizationChainError(
                "RevisionPlan content_spec_id does not match the draft generation run."
            )
        if draft_master_script.content_spec_id != draft_run.content_spec_id:
            raise InvalidFinalizationChainError(
                "DraftMasterScript content_spec_id does not match the draft generation run."
            )
        if revision_run.revised_draft_master_script.content_spec_id != draft_run.content_spec_id:
            raise InvalidFinalizationChainError(
                "Revised DraftMasterScript content_spec_id does not match the draft generation run."
            )
        if draft_run.generation_strategy_id != revision_run.revision_plan.generation_strategy_id:
            raise InvalidFinalizationChainError(
                "RevisionPlan generation_strategy_id does not match the draft generation run."
            )
        if draft_run.revision_plan.draft_master_script_id != draft_master_script.id:
            raise InvalidFinalizationChainError(
                "Draft generation run is missing a valid RevisionPlan linkage."
            )
        if (
            draft_run.story_qc_report.overall_score
            != revision_run.original_story_qc_report.overall_score
        ):
            raise InvalidFinalizationChainError(
                "Original StoryQCReport does not match the draft generation run."
            )
        if revision_run.revision_plan.draft_master_script_id != draft_master_script.id:
            raise InvalidFinalizationChainError(
                "Revision run is missing the required DraftMasterScript linkage."
            )
        if revision_run.revised_draft_master_script.id != draft_master_script.id:
            raise InvalidFinalizationChainError(
                "Revised DraftMasterScript must preserve the original draft identity."
            )
        revision_decision = revision_run.revision_plan.revision_decision
        revision_was_not_required = bool(
            revision_decision is not None
            and revision_decision.revision_required is False
        )
        if not revision_run.revision_plan.actions and not revision_was_not_required:
            raise InvalidFinalizationChainError(
                "RevisionPlan must contain an action unless RevisionDecision explicitly "
                "states that revision is not required."
            )
        if revision_run.revision_plan.must_re_qc is not True:
            raise InvalidFinalizationChainError(
                "RevisionPlan must require Re-QC before finalization."
            )

    def _ensure_content_spec_available(
        self,
        *,
        content_spec_id: str,
        draft_run,
    ) -> bool:
        if self._content_spec_repository.get(content_spec_id) is not None:
            return True

        snapshot_json = draft_run.prompt_build_result.rendered_variables.get(
            "content_spec_json"
        )
        if not snapshot_json:
            return False
        try:
            snapshot = ContentSpec.model_validate_json(snapshot_json)
        except (ValidationError, ValueError, TypeError):
            return False
        if snapshot.id != content_spec_id:
            return False

        self._content_spec_repository.save(snapshot)
        return True

    def _map_scene_card(
        self,
        *,
        scene: DraftSceneCard,
        dialogue_line_count_per_scene: int,
        speaker_name_cycle: list[str],
    ) -> SceneCard:
        return SceneCard(
            scene_number=scene.scene_number,
            slug=scene.slug,
            purpose=scene.purpose,
            setting=scene.setting_hint,
            beat_summary=scene.beat_summary,
            emotional_shift=scene.emotional_shift,
            emotional_objective=scene.emotional_objective,
            character_actions=scene.character_actions,
            body_order=scene.body_order,
            turning_point=scene.turning_point,
            scene_causality=scene.scene_causality,
            cliffhanger=scene.cliffhanger,
            dialogues=self._build_dialogues(
                scene=scene,
                dialogue_line_count_per_scene=dialogue_line_count_per_scene,
                speaker_name_cycle=speaker_name_cycle,
            ),
        )

    def _build_dialogues(
        self,
        *,
        scene: DraftSceneCard,
        dialogue_line_count_per_scene: int,
        speaker_name_cycle: list[str],
    ) -> list[DialogueLine]:
        if scene.dialogues:
            # This legacy limit controls only prompt-to-dialogue fallback. A real
            # screenplay must never lose model-written or user-edited dialogue.
            return list(scene.dialogues)

        prompts = scene.dialogue_prompts[:dialogue_line_count_per_scene]
        if not prompts:
            prompts = [scene.beat_summary]

        dialogues: list[DialogueLine] = []
        for index, prompt in enumerate(prompts, start=1):
            character_name = speaker_name_cycle[(index - 1) % len(speaker_name_cycle)]
            dialogues.append(
                DialogueLine(
                    character_name=character_name,
                    intent=self._build_intent(scene),
                    text=self._build_dialogue_text(prompt=prompt),
                )
            )
        return dialogues

    @staticmethod
    def _validate_mainland_final_script(
        draft: DraftMasterScript,
        *,
        episode_context,
    ) -> None:
        if not MasterScriptService._is_mainland_chinese_script(draft):
            return

        language_issues = blocking_draft_script_chinese_issues(draft)
        screenplay_issues = draft_screenplay_style_issues(draft)
        duration = estimate_screenplay_duration(draft)
        continuity = evaluate_episode_continuity(draft, episode_context)
        failures: list[str] = []
        if language_issues:
            failures.append("存在非简体中文正文：" + "、".join(language_issues[:6]))
        if screenplay_issues:
            failures.append("存在不可拍摄或小说化动作：" + "、".join(screenplay_issues[:6]))
        if not (
            EPISODE_RUNTIME_MIN_SECONDS
            <= duration.total_seconds
            <= EPISODE_RUNTIME_MAX_SECONDS
        ):
            failures.append(
                f"预计成片时长为 {duration.total_seconds} 秒，不在 "
                f"{EPISODE_RUNTIME_MIN_SECONDS}–{EPISODE_RUNTIME_MAX_SECONDS} 秒范围内"
            )
        if continuity.blocking_issue_count:
            failures.append(
                "存在硬连续性冲突："
                + "、".join(issue.summary for issue in continuity.issues[:6])
            )
        if failures:
            raise InvalidFinalScriptAcceptanceError("；".join(failures))

    @staticmethod
    def _is_mainland_chinese_script(draft: DraftMasterScript) -> bool:
        language = draft.language.strip().casefold()
        platform = (draft.target_platform or "").strip().casefold()
        return language in {"zh", "zh-cn", "chinese", "中文", "简体中文"} and (
            "mainland" in platform or "cn_mainland" in platform or "中国大陆" in platform
        )

    def _build_intent(self, scene: DraftSceneCard) -> str:
        return scene.purpose[:120]

    def _build_dialogue_text(self, *, prompt: str) -> str:
        return prompt.strip()

    def _build_lineage(
        self,
        *,
        draft_run,
        revision_run,
        dialogue_line_count_per_scene: int,
        speaker_name_cycle: list[str],
        minimum_re_qc_score: float,
    ) -> FinalMasterScriptLineage:
        llm_model_info = draft_run.llm_model_info
        return FinalMasterScriptLineage(
            content_spec_id=draft_run.content_spec_id,
            platform_profile_id=draft_run.orchestration_plan.platform_profile_id,
            generation_strategy_id=draft_run.generation_strategy_id,
            generation_strategy_version=draft_run.generation_strategy_version,
            selected_prompt_ids=draft_run.selected_prompt_ids,
            selected_prompt_versions=[
                prompt.version for prompt in draft_run.prompt_retrieval_result.prompts
            ],
            prompt_builder_version=draft_run.prompt_build_result.trace.builder_version,
            llm_provider=llm_model_info.provider,
            llm_model_name=llm_model_info.model_name,
            original_draft_master_script_id=draft_run.draft_master_script.id,
            original_story_qc_score=draft_run.story_qc_report.overall_score,
            original_story_qc_status=draft_run.story_qc_report.status.value,
            revision_plan_created_at=revision_run.revision_plan.created_at,
            revision_action_ids=revision_run.applied_action_ids,
            revised_draft_master_script_id=revision_run.revised_draft_master_script.id,
            re_qc_score=revision_run.revised_story_qc_report.overall_score,
            re_qc_status=revision_run.revised_story_qc_report.status.value,
            minimum_re_qc_score_required=minimum_re_qc_score,
            dialogue_line_count_per_scene=dialogue_line_count_per_scene,
            speaker_name_cycle=speaker_name_cycle,
            finalization_policy_id=MASTER_SCRIPT_FINALIZATION_POLICY.policy_id,
            finalization_version=MASTER_SCRIPT_FINALIZATION_POLICY.finalization_version,
            draft_generated_at=draft_run.generated_at,
            revision_generated_at=revision_run.generated_at,
        )
