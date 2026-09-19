"""Offline screenplay examples derived from approved episode contracts."""
from __future__ import annotations

from app.modules.master_script.models import DraftMasterScript, DraftSceneCard
from app.modules.script_engine.draft_scalar_normalization import normalize_script_tone
from app.modules.script_engine.models import EpisodeGenerationContext
from app.script_delivery_contract import ending_mode_requires_hook


def build_mock_episode_draft(*, content_spec, generation_strategy, context: EpisodeGenerationContext,
                             output_language: str, llm_metadata: dict) -> DraftMasterScript:
    plan = context.approved_episode_plan
    assert plan is not None and plan.scene_execution_plan
    requires_hook = ending_mode_requires_hook(plan.ending_mode)
    chinese_name = next(iter(context.canonical_character_names), "演示主角")
    english_name = context.canonical_character_names.get(chinese_name, "Demo Lead")
    overseas = output_language.casefold().startswith("en")
    display_name = english_name if overseas else chinese_name
    scenes = []
    for beat in plan.scene_execution_plan:
        final_scene = beat.scene_number == len(plan.scene_execution_plan)
        actions = [beat.visible_action]
        for index in range(1, min(beat.shot_target, 24)):
            actions.append(f"{display_name}翻开第{context.episode_number}份材料的第{index}页，逐项核对记录。")
        outcome = f"第{beat.scene_number}场核验结束，{display_name}在记录表签名，将本次比对结果归档。"
        actions[-1] = outcome
        scenes.append(DraftSceneCard(
            scene_number=beat.scene_number,
            slug=beat.scene_heading[:120], scene_heading=beat.scene_heading,
            setting_hint=beat.scene_heading[:120], purpose=beat.scene_objective[:240],
            beat_summary=beat.visible_action[:300], emotional_shift=plan.emotional_movement[:120],
            character_refs=beat.character_refs, character_actions=actions,
            dialogues=[{
                "character_name": english_name if overseas else chinese_name,
                "chinese_character_name": None,
                "intent": beat.dialogue_objective[:120],
                "text": f"Check entry {index + 1} against the original record."
                if overseas else f"第{index + 1}项也要对照原件，核实后再保存。",
                "chinese_translation": f"第{index + 1}项也要对照原件，核实后再保存。" if overseas else None,
            } for index in range(beat.dialogue_line_target)],
            turning_point=beat.turn_or_reveal[:240],
            scene_causality={
                "goal": beat.scene_objective[:240],
                "conflict": (beat.opposition or plan.central_conflict)[:300],
                "outcome": outcome,
                "caused_by_scene_number": beat.scene_number - 1 if beat.scene_number > 1 else None,
                "causal_link": "承接上一场核验结果，继续处理当前材料。" if beat.scene_number > 1 else None,
            },
            cliffhanger=final_scene and requires_hook,
        ))

    # A scheduled story line must have the same evidence in the scene and ledger.
    updates = []
    duties = {duty.story_line_id: duty for duty in context.storyline_duties}
    refs = dict.fromkeys([*plan.story_line_refs, *context.planned_story_line_refs, *duties])
    for reference in refs:
        duty = duties.get(reference)
        if duty is not None and not duty.must_progress:
            continue
        evidence = duty.assigned_scene_numbers if duty else [scenes[-1].scene_number]
        progress = f"第{context.episode_number}集核验结果：{plan.exit_state}"[:240]
        for number in evidence:
            scene = scenes[number - 1]
            scene.character_actions[-1] = progress
            scene.beat_summary = progress
            scene.turning_point = progress[:240]
            scene.scene_causality.outcome = progress
        updates.append({
            "story_line_id": reference, "status": "active" if requires_hook else "resolved",
            "progress_summary": progress, "change_cause": progress,
            "evidence_scene_numbers": evidence,
            "next_required_step": (plan.next_episode_obligation or plan.cliffhanger)[:300] if requires_hook else None,
        })
    return DraftMasterScript(
        content_spec_id=content_spec.id, generation_strategy_id=generation_strategy.id,
        title=f"离线演示 · 第{context.episode_number}集", language=output_language,
        target_audience=content_spec.audience_goal.summary,
        target_platform=content_spec.platform_goal.platform_profile_id,
        tone=normalize_script_tone(content_spec.creative_brief.tone),
        hook=plan.cliffhanger[:240], synopsis=f"离线演示：{plan.episode_goal} {plan.exit_state}"[:500],
        episode_goal=plan.episode_goal[:240], target_duration_seconds=plan.target_duration_seconds,
        ending_mode=plan.ending_mode, story_line_updates=updates, scenes=scenes,
        next_episode_question=plan.cliffhanger[:240] if requires_hook else None,
        qa_notes=["离线示例仅用于验证操作流程，不代表真实模型生成质量。"],
        llm_metadata={**llm_metadata, "offline_example": True},
    )
