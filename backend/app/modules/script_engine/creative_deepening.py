from __future__ import annotations

import json
from time import perf_counter

from pydantic import ValidationError

from app.modules.master_script.models import (
    CharacterProfile,
    DraftMasterScript,
    DraftSceneCard,
    LLMGeneratedDraftMasterScript,
)
from app.modules.script_engine.llm_adapter import (
    LLMAdapter,
    LLMRequestError,
    LLMStructuredOutputError,
)
from app.modules.script_engine.models import (
    CreativeDeepeningChange,
    CreativeDeepeningChangeType,
    CreativeDeepeningComparisonStatus,
    CreativeDeepeningPreservationCheck,
    CreativeDeepeningQCComparison,
    CreativeDeepeningRequest,
    CreativeDeepeningRun,
    CreativeDeepeningStatus,
    GenerationStrategy,
    KnowledgeTargetStage,
    PromptBuildContext,
    PromptLibraryItem,
    StoryQCReport,
)
from app.modules.script_engine.prompt_builder import PromptBuilder


class CreativeDeepeningService:
    """Creates one non-authoritative enhancement candidate and validates its scope."""

    def __init__(
        self,
        *,
        prompt_builder: PromptBuilder,
        llm_adapter: LLMAdapter,
        service_version: str = "creative_deepening_service.v1",
    ) -> None:
        self._prompt_builder = prompt_builder
        self._llm_adapter = llm_adapter
        self._service_version = service_version

    def generate_shadow_candidate(
        self,
        request: CreativeDeepeningRequest,
        *,
        prompts: list[PromptLibraryItem],
        prompt_context: PromptBuildContext,
        strategy: GenerationStrategy,
    ) -> CreativeDeepeningRun:
        started_at = perf_counter()
        prompt_build_result = None
        raw_output: dict[str, object] = {}
        try:
            prompt_context = self._with_source_draft(prompt_context, request)
            prompt_build_result = self._prompt_builder.build_master_prompt(
                prompts=prompts,
                context=prompt_context,
                strategy=strategy,
                build_purpose=KnowledgeTargetStage.creative_deepening,
                prompt_ids_override=strategy.deepening_prompt_ids,
            )
            deepening_strategy = strategy.model_copy(
                update={
                    "max_tokens": strategy.deepening_max_tokens or strategy.max_tokens,
                }
            )
            raw_output = self._llm_adapter.generate_structured_output(
                prompt_build_result.prompt_text,
                strategy=deepening_strategy,
                output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
            )
            candidate = self._map_candidate(
                raw_output=raw_output,
                source=request.source_draft_master_script,
            )
            change_trace = self._build_change_trace(
                request.source_draft_master_script,
                candidate,
            )
            growth_ratio = self._expressive_growth_ratio(
                request.source_draft_master_script,
                candidate,
            )
            checks = self._build_preservation_checks(
                source=request.source_draft_master_script,
                candidate=candidate,
                change_trace=change_trace,
                growth_ratio=growth_ratio,
                max_growth_ratio=request.max_expressive_growth_ratio,
            )
            candidate_valid = all(check.passed for check in checks)
            warnings = []
            if not candidate_valid:
                warnings = [
                    "Candidate violated the Creative Deepening preservation contract; "
                    "the source Draft remains selected."
                ]
            return CreativeDeepeningRun(
                status=(
                    CreativeDeepeningStatus.shadow_candidate
                    if candidate_valid
                    else CreativeDeepeningStatus.rejected_preservation
                ),
                service_version=self._service_version,
                source_draft_master_script_id=request.source_draft_master_script.id,
                selected_draft_master_script_id=request.source_draft_master_script.id,
                candidate_draft_master_script=candidate,
                knowledge_bundle=request.knowledge_bundle,
                knowledge_selection_trace=request.knowledge_selection_trace,
                prompt_build_result=prompt_build_result,
                llm_model_info=self._llm_adapter.get_model_info(),
                llm_raw_output=raw_output,
                change_trace=change_trace,
                preservation_checks=checks,
                candidate_valid_for_comparison=candidate_valid,
                expressive_growth_ratio=growth_ratio,
                latency_seconds=round(perf_counter() - started_at, 6),
                token_usage=self._extract_token_usage(raw_output),
                warnings=warnings,
            )
        except (
            LLMRequestError,
            LLMStructuredOutputError,
            ValidationError,
            ValueError,
        ) as exc:
            return CreativeDeepeningRun(
                status=CreativeDeepeningStatus.technical_failure,
                service_version=self._service_version,
                source_draft_master_script_id=request.source_draft_master_script.id,
                selected_draft_master_script_id=request.source_draft_master_script.id,
                knowledge_bundle=request.knowledge_bundle,
                knowledge_selection_trace=request.knowledge_selection_trace,
                prompt_build_result=prompt_build_result,
                llm_model_info=self._llm_adapter.get_model_info(),
                llm_raw_output=raw_output,
                latency_seconds=round(perf_counter() - started_at, 6),
                warnings=[f"Creative Deepening shadow failed: {str(exc)[:300]}"],
            )

    def _with_source_draft(
        self,
        context: PromptBuildContext,
        request: CreativeDeepeningRequest,
    ) -> PromptBuildContext:
        return context.model_copy(
            update={
                "extra_variables": {
                    **context.extra_variables,
                    "source_draft_master_script_json": json.dumps(
                        request.source_draft_master_script.model_dump(mode="json"),
                        ensure_ascii=True,
                    ),
                }
            }
        )

    def _map_candidate(
        self,
        *,
        raw_output: dict[str, object],
        source: DraftMasterScript,
    ) -> DraftMasterScript:
        metadata = raw_output.get("_meta", {})
        if isinstance(metadata, dict) and metadata.get("provider") == "mock":
            return self._build_mock_candidate(source=source, metadata=metadata)

        validation_payload = {
            key: value for key, value in raw_output.items() if key != "_meta"
        }
        # The source draft owns the ending contract.  Older deepening prompts
        # do not include this field, and validating those payloads with the
        # serial default would incorrectly reject a season/series finale for
        # omitting a continuation hook.
        validation_payload["ending_mode"] = source.ending_mode.value
        generated = LLMGeneratedDraftMasterScript.model_validate(validation_payload)
        source_scenes = {scene.scene_number: scene for scene in source.scenes}
        llm_metadata = dict(metadata) if isinstance(metadata, dict) else {}
        llm_metadata["deepening_source_draft_id"] = source.id

        return DraftMasterScript(
            content_spec_id=source.content_spec_id,
            generation_strategy_id=source.generation_strategy_id,
            title=generated.title,
            logline=generated.logline,
            language=generated.language,
            target_audience=generated.target_audience,
            target_platform=generated.target_platform,
            tone=generated.tone,
            hook=generated.hook,
            synopsis=generated.synopsis,
            episode_cast=generated.episode_cast,
            locations=generated.locations,
            episode_goal=generated.episode_goal,
            ending_mode=source.ending_mode,
            # Runtime is a project/roadmap constraint, not an editable creative field.
            target_duration_seconds=source.target_duration_seconds,
            characters=[
                CharacterProfile.model_validate(character.model_dump())
                for character in generated.characters
            ],
            # Deepening may improve expression but cannot rewrite episode consequences.
            character_state_updates=source.character_state_updates,
            relationship_state_updates=source.relationship_state_updates,
            continuity_state_updates=source.continuity_state_updates,
            story_line_updates=source.story_line_updates,
            setup_payoff_updates=source.setup_payoff_updates,
            continuation_hook=source.continuation_hook,
            scenes=[
                DraftSceneCard(
                    scene_number=scene.scene_number,
                    slug=scene.slug,
                    scene_heading=scene.scene_heading or scene.setting,
                    purpose=scene.purpose,
                    setting_hint=scene.setting,
                    beat_summary=scene.beat_summary,
                    emotional_shift=scene.emotional_shift,
                    emotional_objective=scene.emotional_objective,
                    character_refs=(
                        scene.character_refs
                        or source_scenes[scene.scene_number].character_refs
                        if scene.scene_number in source_scenes
                        else scene.character_refs
                    ),
                    character_actions=scene.character_actions,
                    body_order=scene.body_order,
                    turning_point=scene.turning_point,
                    scene_causality=scene.scene_causality,
                    cliffhanger=scene.cliffhanger,
                    dialogue_prompts=[line.text for line in scene.dialogues[:6]],
                    dialogues=scene.dialogues,
                    supporting_asset_ids=(
                        source_scenes[scene.scene_number].supporting_asset_ids
                        if scene.scene_number in source_scenes
                        else []
                    ),
                    content_manifest=(
                        scene.content_manifest
                        or source_scenes[scene.scene_number].content_manifest
                        if scene.scene_number in source_scenes
                        else scene.content_manifest
                    ),
                )
                for scene in generated.scenes
            ],
            next_episode_question=generated.next_episode_question,
            qa_notes=source.qa_notes,
            llm_metadata=llm_metadata,
        )

    def _build_mock_candidate(
        self,
        *,
        source: DraftMasterScript,
        metadata: dict[str, object],
    ) -> DraftMasterScript:
        """Create a valid, bounded candidate for local workflow demonstrations."""
        scenes = []
        for scene in source.scenes:
            actions = list(scene.character_actions)
            action = "The focal character reveals a visible emotional reaction."
            if scene == source.scenes[0] and action not in actions and len(actions) < 10:
                actions.append(action)
            scenes.append(
                scene.model_copy(
                    update={
                        "character_actions": actions,
                    }
                )
            )

        payload = source.model_dump(
            mode="json",
            exclude={"id", "created_at", "updated_at"},
        )
        payload["scenes"] = [scene.model_dump(mode="json") for scene in scenes]
        payload["llm_metadata"] = {
            **source.llm_metadata,
            **metadata,
            "deepening_source_draft_id": source.id,
            "mock_candidate": True,
        }
        return DraftMasterScript.model_validate(payload)

    def _build_change_trace(
        self,
        source: DraftMasterScript,
        candidate: DraftMasterScript,
    ) -> list[CreativeDeepeningChange]:
        changes: list[CreativeDeepeningChange] = []
        protected_top_level = [
            "title",
            "logline",
            "language",
            "target_audience",
            "target_platform",
            "tone",
            "hook",
            "synopsis",
            "episode_goal",
            "target_duration_seconds",
            "next_episode_question",
            "ending_mode",
        ]
        for field_name in protected_top_level:
            if getattr(source, field_name) != getattr(candidate, field_name):
                changes.append(
                    self._change(
                        CreativeDeepeningChangeType.forbidden,
                        field_name,
                        "A protected story-level field changed.",
                    )
                )

        for index, candidate_character in enumerate(candidate.characters):
            if index >= len(source.characters):
                changes.append(
                    self._change(
                        CreativeDeepeningChangeType.forbidden,
                        "characters",
                        "A new character identity was introduced.",
                    )
                )
                continue
            source_character = source.characters[index]
            for field_name in ("name", "role"):
                if getattr(source_character, field_name) != getattr(
                    candidate_character,
                    field_name,
                ):
                    changes.append(
                        self._change(
                            CreativeDeepeningChangeType.forbidden,
                            f"characters[{index}].{field_name}",
                            "A protected character identity field changed.",
                        )
                    )
            for field_name in ("description", "motivation"):
                if getattr(source_character, field_name) != getattr(
                    candidate_character,
                    field_name,
                ):
                    changes.append(
                        self._change(
                            CreativeDeepeningChangeType.character_expression,
                            f"characters[{index}].{field_name}",
                            "Character expression was refined without changing identity.",
                        )
                    )
        if len(source.characters) != len(candidate.characters):
            changes.append(
                self._change(
                    CreativeDeepeningChangeType.forbidden,
                    "characters",
                    "The character count changed.",
                )
            )

        source_scenes = {scene.scene_number: scene for scene in source.scenes}
        for candidate_scene in candidate.scenes:
            source_scene = source_scenes.get(candidate_scene.scene_number)
            if source_scene is None:
                changes.append(
                    self._change(
                        CreativeDeepeningChangeType.forbidden,
                        "scenes",
                        "A new scene number was introduced.",
                        scene_number=candidate_scene.scene_number,
                    )
                )
                continue
            protected_scene_fields = (
                "slug",
                "purpose",
                "setting_hint",
                "turning_point",
                "scene_causality",
                "cliffhanger",
            )
            for field_name in protected_scene_fields:
                if getattr(source_scene, field_name) != getattr(candidate_scene, field_name):
                    changes.append(
                        self._change(
                            CreativeDeepeningChangeType.forbidden,
                            field_name,
                            "A protected scene structure field changed.",
                            scene_number=candidate_scene.scene_number,
                        )
                    )
            allowed_fields = {
                "beat_summary": CreativeDeepeningChangeType.scene_intensity,
                "emotional_shift": CreativeDeepeningChangeType.emotional_expression,
                "emotional_objective": CreativeDeepeningChangeType.emotional_expression,
                "character_actions": CreativeDeepeningChangeType.visual_action,
                "dialogue_prompts": CreativeDeepeningChangeType.dialogue,
                "dialogues": CreativeDeepeningChangeType.dialogue,
            }
            for field_name, change_type in allowed_fields.items():
                if getattr(source_scene, field_name) != getattr(candidate_scene, field_name):
                    changes.append(
                        self._change(
                            change_type,
                            field_name,
                            "An allowed expressive field changed.",
                            scene_number=candidate_scene.scene_number,
                        )
                    )
        if [scene.scene_number for scene in source.scenes] != [
            scene.scene_number for scene in candidate.scenes
        ]:
            changes.append(
                self._change(
                    CreativeDeepeningChangeType.forbidden,
                    "scene_order",
                    "Scene count or order changed.",
                )
            )
        return changes

    def _build_preservation_checks(
        self,
        *,
        source: DraftMasterScript,
        candidate: DraftMasterScript,
        change_trace: list[CreativeDeepeningChange],
        growth_ratio: float,
        max_growth_ratio: float,
    ) -> list[CreativeDeepeningPreservationCheck]:
        forbidden = [
            change
            for change in change_trace
            if change.change_type == CreativeDeepeningChangeType.forbidden
        ]
        allowed = [
            change
            for change in change_trace
            if change.change_type != CreativeDeepeningChangeType.forbidden
        ]
        return [
            CreativeDeepeningPreservationCheck(
                check_name="protected_story_fields",
                passed=not forbidden,
                details=(
                    "Premise, identity, scene structure, causality, and ending were preserved."
                    if not forbidden
                    else f"Detected {len(forbidden)} protected-field changes."
                ),
            ),
            CreativeDeepeningPreservationCheck(
                check_name="meaningful_expressive_change",
                passed=bool(allowed),
                details=(
                    f"Detected {len(allowed)} allowed expressive changes."
                    if allowed
                    else "No allowed expressive field changed."
                ),
            ),
            CreativeDeepeningPreservationCheck(
                check_name="expressive_growth_budget",
                passed=growth_ratio <= max_growth_ratio,
                details=(
                    f"Expressive growth ratio {growth_ratio:.3f}; maximum "
                    f"{max_growth_ratio:.3f}."
                ),
            ),
            CreativeDeepeningPreservationCheck(
                check_name="source_draft_selected",
                passed=True,
                details=(
                    f"Shadow mode keeps source Draft '{source.id}' selected regardless "
                    "of candidate validity."
                ),
            ),
        ]

    def _expressive_growth_ratio(
        self,
        source: DraftMasterScript,
        candidate: DraftMasterScript,
    ) -> float:
        source_size = self._expressive_size(source)
        candidate_size = self._expressive_size(candidate)
        if source_size == 0:
            return 0.0 if candidate_size == 0 else 1.0
        return round((candidate_size - source_size) / source_size, 4)

    def _expressive_size(self, draft: DraftMasterScript) -> int:
        values: list[str] = []
        for character in draft.characters:
            values.extend([character.description, character.motivation])
        for scene in draft.scenes:
            values.extend(
                [
                    scene.beat_summary,
                    scene.emotional_shift,
                    scene.emotional_objective or "",
                    *scene.character_actions,
                    *[dialogue.text for dialogue in scene.dialogues],
                ]
            )
        return sum(len(value.split()) for value in values)

    def _extract_token_usage(
        self,
        raw_output: dict[str, object],
    ) -> dict[str, int] | None:
        metadata = raw_output.get("_meta")
        if not isinstance(metadata, dict):
            return None
        usage = metadata.get("usage")
        if not isinstance(usage, dict):
            return None
        normalized = {
            str(key): value
            for key, value in usage.items()
            if isinstance(value, int) and value >= 0
        }
        return normalized or None

    def _change(
        self,
        change_type: CreativeDeepeningChangeType,
        field_name: str,
        summary: str,
        *,
        scene_number: int | None = None,
    ) -> CreativeDeepeningChange:
        return CreativeDeepeningChange(
            change_type=change_type,
            field_name=field_name,
            summary=summary,
            scene_number=scene_number,
        )


def build_deepening_qc_comparison(
    source_report: StoryQCReport,
    candidate_report: StoryQCReport | None,
) -> CreativeDeepeningQCComparison:
    if candidate_report is None:
        return CreativeDeepeningQCComparison(
            status=CreativeDeepeningComparisonStatus.unavailable,
            source_overall_score=source_report.overall_score,
            summary="Candidate QC is unavailable because the shadow candidate was invalid.",
        )

    source_dimensions = {
        evaluation.dimension.value: evaluation.score
        for evaluation in source_report.dimension_evaluations
    }
    candidate_dimensions = {
        evaluation.dimension.value: evaluation.score
        for evaluation in candidate_report.dimension_evaluations
    }
    common_dimensions = sorted(set(source_dimensions).intersection(candidate_dimensions))
    dimension_deltas = {
        dimension: round(
            candidate_dimensions[dimension] - source_dimensions[dimension],
            3,
        )
        for dimension in common_dimensions
    }
    overall_delta = round(
        candidate_report.overall_score - source_report.overall_score,
        3,
    )
    return CreativeDeepeningQCComparison(
        status=CreativeDeepeningComparisonStatus.available,
        source_overall_score=source_report.overall_score,
        candidate_overall_score=candidate_report.overall_score,
        overall_delta=overall_delta,
        dimension_deltas=dimension_deltas,
        summary=(
            "Shadow candidate was evaluated with the same Story QC implementation; "
            "the comparison is observational and does not select the candidate."
        ),
    )
