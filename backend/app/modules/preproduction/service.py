from __future__ import annotations

import hashlib
import json
from concurrent.futures import Future
from datetime import datetime, timezone
from threading import Lock
from typing import ClassVar

from app.modules.master_script.models import CharacterProfile, DraftMasterScript, DraftSceneCard
from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.llm_adapter import bind_llm_log_context, llm_operation_deadline
from app.modules.script_engine.screenplay_duration import estimate_scene_duration, estimate_spoken_line_duration
from app.modules.script_engine.scene_heading_metadata import scene_metadata_conflicts
from .models import (
    MAX_COMPILED_PROMPT_LENGTH, PreflightFinding, PreproductionStoryboard, SceneDesign, SceneProposal, StoryboardEditRequest,
    StoryboardScene, StoryboardShot,
)
from .prompt_director import build_prompt_plan, compile_cinematic_prompt, derive_acting_direction
from .production_detail_skill import production_detail_instruction
from .director_contract import DIRECTOR_CONTRACT_INSTRUCTION
from .proposal_repair import validate_scene_proposal
from .generation_recovery import generate_scene_output
from .repository import PreproductionRepository, StoryboardConflictError


def source_signature(source: dict) -> str:
    # Exclude transport metadata and timestamps, retain creative content.
    content = {key: value for key, value in source.items()
               if key not in {"llm_metadata", "created_at", "updated_at"}}
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()


class StoryboardService:
    _inflight_lock: ClassVar[Lock] = Lock()
    _inflight_scenes: ClassVar[dict[tuple, Future[PreproductionStoryboard]]] = {}

    def __init__(self, repository: PreproductionRepository, adapter_factory):
        self.repository = repository
        self.adapter_factory = adapter_factory

    def require(self, project_id: str, episode_number: int, expected_revision: int | None = None,
                revision: int | None = None) -> PreproductionStoryboard:
        plan = self.repository.get(project_id, episode_number, revision)
        if plan is None:
            raise LookupError("本集尚未创建分镜。")
        if expected_revision is not None and plan.revision != expected_revision:
            raise StoryboardConflictError("分镜版本已变化，请重新加载。")
        return plan

    def start(self, project_id: str, episode_number: int, source: dict,
              expected_revision: int) -> PreproductionStoryboard:
        source = {key: value for key, value in source.items() if key != "llm_metadata"}
        if len(json.dumps(source, ensure_ascii=False).encode()) > 5_000_000:
            raise StoryboardConflictError("单集正文超过分镜输入容量。")
        draft = DraftMasterScript.model_validate(source)
        if any(not scene.character_actions and not scene.dialogues for scene in draft.scenes):
            raise StoryboardConflictError("正文仍有空场景，完成正文后再编排分镜。")
        current = self.repository.get(project_id, episode_number)
        if (current.revision if current else 0) != expected_revision:
            raise StoryboardConflictError("分镜版本已变化，请重新加载。")
        signature = source_signature(source)
        if current and current.source_signature == signature:
            return current
        if current:
            old_scenes = {s.scene_number: s for s in DraftMasterScript.model_validate(current.source_draft).scenes}
            new_scenes = {s.scene_number: s for s in draft.scenes}
            # Never infer stable identity from equal scene numbers after a rewrite.
            changed = {n for n in old_scenes.keys() | new_scenes.keys()
                       if old_scenes.get(n) != new_scenes.get(n)}
            if current.source_draft.get("characters") != source.get("characters"):
                changed.update(new_scenes)
            plan = current.model_copy(deep=True, update={
                "source_draft": source, "source_signature": signature,
                "stale_scene_numbers": sorted(set(current.stale_scene_numbers) | changed),
                "candidate": None,
            })
        else:
            plan = PreproductionStoryboard(story_project_id=project_id, episode_number=episode_number,
                                           source_draft=source, source_signature=signature)
        return self._commit(plan, expected_revision)

    def generate_scene(self, project_id: str, episode_number: int, scene_number: int,
                       expected_revision: int, instruction: str) -> PreproductionStoryboard:
        # A remounted browser may repeat the same request while its original
        # model call is still running. Share that call across service instances;
        # distinct edits still pass through the repository's revision check.
        key = (self.repository.runtime.engine, project_id, episode_number,
               scene_number, expected_revision, instruction)
        with self._inflight_lock:
            pending = self._inflight_scenes.get(key)
            owner = pending is None
            if owner:
                pending = Future()
                self._inflight_scenes[key] = pending
        if not owner:
            return pending.result().model_copy(deep=True)
        try:
            result = self._generate_scene(project_id, episode_number, scene_number, expected_revision, instruction)
        except Exception as error:
            pending.set_exception(error)
            raise
        else:
            pending.set_result(result)
            return result.model_copy(deep=True)
        finally:
            with self._inflight_lock:
                if self._inflight_scenes.get(key) is pending:
                    del self._inflight_scenes[key]

    def _generate_scene(self, project_id: str, episode_number: int, scene_number: int,
                        expected_revision: int, instruction: str) -> PreproductionStoryboard:
        plan = self.require(project_id, episode_number, expected_revision)
        draft = DraftMasterScript.model_validate(plan.source_draft)
        source = next((scene for scene in draft.scenes if scene.scene_number == scene_number), None)
        if source is None:
            raise StoryboardConflictError("当前正文中没有这一场。")
        existing = next((scene for scene in plan.scenes if scene.scene_number == scene_number), None)
        if existing and any(shot.locked for shot in existing.shots):
            raise StoryboardConflictError("本场包含已锁定镜头，请先解锁需要重编的场景。")
        if plan.candidate:
            raise StoryboardConflictError("请先采用或放弃当前候选。")
        schema = SceneProposal.model_json_schema()
        timings = {scene.scene_number: estimate_scene_duration(scene) for scene in draft.scenes}
        total_reference = sum(timing.total_seconds for timing in timings.values())
        # An unchanged action:N can now name different source text. Supplying
        # the stale scene's full design/prompts encourages copying its former
        # action sequence while merely rebinding the same technical refs.
        # Keep that scene in persisted history and the candidate comparison,
        # but use it as editing context only while its source is current.
        source_changed = scene_number in plan.stale_scene_numbers
        context = {
            "visual_direction": plan.visual_direction,
            "episode_title": draft.title,
            "characters": [character.model_dump(mode="json") for character in draft.characters],
            "scene": source.model_dump(mode="json"),
            "ordered_source_refs": source.body_order,
            "duration_budget_seconds": round(draft.target_duration_seconds * timings[scene_number].total_seconds / total_reference, 1),
            "spoken_reference_seconds": timings[scene_number].dialogue_seconds,
            "current_scene": existing.model_dump(mode="json") if existing and not source_changed else None,
            "source_changed": source_changed,
            "previous_scene_end": next((s.shots[-1].continuity_out for s in reversed(plan.scenes)
                                        if s.scene_number < scene_number and s.scene_number not in plan.stale_scene_numbers), None),
            "author_instruction": instruction,
            "acting_rules": [
                "表演写成目标、阻力、策略和可见行为，不直接写抽象情绪。",
                "节拍数量服从镜头时长与真实变化，最多 4 项；短镜头可以只有一个有效动作，不为凑数添加重心、呼吸或手势。",
                "身体任务须有具体目的；非说话角色的反应只安排在画面确实能覆盖的位置，特写不能同时要求展示画外人物的全身动作。",
            ],
        }
        prompt = (
            "你是文字分镜编排师，同时遵守内部制作细化 Skill。将提供的本场完整正文编成可执行摄影镜头。只返回符合 Schema 的 JSON。\n"
            + production_detail_instruction(storyboard_translation=True) + "\n"
            + DIRECTOR_CONTRACT_INSTRUCTION + "\n"
            "遵守视觉方向和作者指令，摄影设计不得新增剧情事实或未来信息。"
            "按叙事、情绪和空间需要合并动作与对白，不要每个动作机械生成一镜。"
            "为场景设计填写 audience_effect 和 status_change；为每个镜头填写 acting_direction，把目标、阻力、利害、策略、节拍、潜台词、身体行为、台词表达、重音停顿和本镜变化写成可观察内容。"
            "source_refs 使用本场 body_order 中从 0 开始的 action:N/dialogue:N。"
            "各镜头引用合起来必须恰好覆盖 ordered_source_refs，保持顺序，不重复、不遗漏。"
            "对白由系统从引用回填，不要改写台词。action_sequence 写明确位置、动作先后、表演和反应；"
            "action_sequence 必须实际呈现每个所引 action 的完整可见过程、物件载体与控制变化，不能只列 source_refs 或依靠随后附上的原文代替镜头动作。"
            "scene 是当前正文依据；source_changed 为 true 时旧镜头已过期，须据当前正文重新编排本场，不能因 action:N 编号相同而沿用旧动作。"
            "镜头起止状态只能从本场正文推导。对白与动作可以重叠，时长按可执行节拍估计。"
            "continuity_in 只写动作开始前已成立的人物位置和物件状态；开门、走近、放下等过程依次放入 action_sequence，不能把结束状态提前放进首帧。"
            "默认一条 shot 对应一个单一连续镜头，不夹带剪辑切换；只有作者明确要求一条 shot 包含多镜头序列时，才可在 camera 中逐段说明切点、顺序与时间，全部计入本项总时长。构图与摄影机运动必须能覆盖所要求的可见动作。"
            "逐镜核对引用台词的口播时间，不能把多句对白和额外停顿硬塞进短镜头；场景预算是参考。"
            "若必要口播已超过预算，保留可执行时长并在 unresolved_questions 标明节奏冲突，不删台词凑时间。"
            "正文没交代而又影响执行的信息放入 unresolved_questions，不凭空补成事实。"
            "摄影、连续性和场景设计用中文，原文对白语言保持不变。\n"
            + json.dumps(context, ensure_ascii=False, separators=(",", ":"))
        )
        adapter = self.adapter_factory()
        strategy = GenerationStrategy(
            id="strategy.storyboard.v1", name="Scene storyboard", version="1.0",
            target_platform="preproduction", target_content_type="storyboard",
            model_provider="configured", model_name="planning-editor",
            workflow_steps=[{
                "step_order": 1, "name": "Storyboard", "description": "Source-linked scene storyboard",
                "prompt_id": "prompt.storyboard.v1", "structured_output_required": True,
            }], prompt_ids=["prompt.storyboard.v1"],
            temperature=0.4, max_tokens=12000,
        )
        with llm_operation_deadline(600, scope="storyboard_scene_generation"), bind_llm_log_context(
                project_id=project_id, episode=episode_number, stage=f"storyboard.scene_{scene_number}"):
            output = generate_scene_output(adapter=adapter, prompt=prompt, strategy=strategy, schema=schema)
            proposal = validate_scene_proposal(output, adapter=adapter, strategy=strategy,
                                               source=source, scene_number=scene_number, original_prompt=prompt)
        retained_ids = ({tuple(shot.source_refs): shot.shot_id for shot in existing.shots}
                        if existing and scene_number not in plan.stale_scene_numbers else {})
        candidate = StoryboardScene(
            scene_number=scene_number, source_revision=plan.revision, design=proposal.design,
            shots=[StoryboardShot(**shot.model_dump(), **(
                {"shot_id": retained_ids[tuple(shot.source_refs)]} if tuple(shot.source_refs) in retained_ids else {}
            )) for shot in proposal.shots],
            unresolved_questions=proposal.unresolved_questions,
        )
        if existing:
            plan.candidate = candidate
        else:
            plan.scenes.append(candidate)
            plan.stale_scene_numbers = [n for n in plan.stale_scene_numbers if n != scene_number]
        return self._commit(plan, expected_revision)

    def edit(self, project_id: str, episode_number: int, request: StoryboardEditRequest) -> PreproductionStoryboard:
        plan = self.require(project_id, episode_number, request.expected_revision)
        old_shots = {shot.shot_id: shot for scene in plan.scenes for shot in scene.shots}
        new_shots = {shot.shot_id: shot for scene in request.scenes for shot in scene.shots}
        old_positions = {shot.shot_id: (scene.scene_number, i) for scene in plan.scenes for i, shot in enumerate(scene.shots)}
        new_positions = {shot.shot_id: (scene.scene_number, i) for scene in request.scenes for i, shot in enumerate(scene.shots)}
        old_scenes = {scene.scene_number: scene for scene in plan.scenes}
        for scene in request.scenes:
            if scene.scene_number not in old_scenes or scene.source_revision != old_scenes[scene.scene_number].source_revision:
                raise StoryboardConflictError("分镜来源版本不能由编辑请求改写。")
            old_scene = old_scenes[scene.scene_number]
            if any(shot.locked for shot in old_scene.shots) and any(
                getattr(old_scene.design, field) != getattr(scene.design, field)
                for field in ("production_contract", "spatial_layout", "transition")
            ):
                raise StoryboardConflictError("本场制作约定、空间或剪辑会影响已锁定镜头，请先单独解锁。")
        for shot_id, old in old_shots.items():
            if not old.locked:
                continue
            new = new_shots.get(shot_id)
            if new is None or old_positions[shot_id] != new_positions[shot_id] or old.model_dump(exclude={"locked", "prompt", "dialogue"}) != new.model_dump(exclude={"locked", "prompt", "dialogue"}):
                raise StoryboardConflictError("请先单独解锁镜头，再修改或移除其内容。")
        if plan.visual_direction != request.visual_direction and any(shot.locked for shot in old_shots.values()):
            raise StoryboardConflictError("视觉方向会影响已锁定镜头，请先解锁。")
        plan.scenes = request.scenes
        remaining = {scene.scene_number for scene in plan.scenes}
        plan.stale_scene_numbers = [number for number in plan.stale_scene_numbers if number in remaining]
        plan.visual_direction = request.visual_direction
        if request.candidate_action == "accept":
            if not plan.candidate:
                raise StoryboardConflictError("没有待采用的分镜候选。")
            scene_number = plan.candidate.scene_number
            original_scene = old_scenes.get(scene_number)
            existing = next((s for s in plan.scenes if s.scene_number == scene_number), None)
            if ((original_scene and any(shot.locked for shot in original_scene.shots))
                    or (existing and any(shot.locked for shot in existing.shots))):
                raise StoryboardConflictError("本场已锁定，请先单独解锁，再采用候选。")
            plan.scenes = [s for s in plan.scenes if s.scene_number != scene_number] + [plan.candidate]
            plan.stale_scene_numbers = [n for n in plan.stale_scene_numbers if n != scene_number]
            plan.candidate = None
        elif request.candidate_action == "reject":
            plan.candidate = None
        return self._commit(plan, request.expected_revision)

    def _commit(self, plan: PreproductionStoryboard, expected_revision: int) -> PreproductionStoryboard:
        plan = plan.model_copy(deep=True)
        source = DraftMasterScript.model_validate(plan.source_draft)
        source_scenes = {scene.scene_number: scene for scene in source.scenes}
        numbers = [s.scene_number for s in plan.scenes]
        ids = [shot.shot_id for scene in plan.scenes for shot in scene.shots]
        if len(set(numbers)) != len(numbers) or len(set(ids)) != len(ids):
            raise StoryboardConflictError("场次和镜头 ID 不能重复。")
        findings = []
        for number, original in source_scenes.items():
            for message in scene_metadata_conflicts(
                original.scene_heading or "", original.setting_hint,
                original.content_manifest.time_of_day if original.content_manifest else "",
            ):
                findings.append(PreflightFinding(code="source_scene_metadata", severity="warning",
                                                scene_number=number, message=message))
            if number not in numbers:
                findings.append(PreflightFinding(code="missing_scene", severity="error", scene_number=number,
                                                message="本场尚未编排。"))
        for scene in plan.scenes:
            if scene.scene_number in plan.stale_scene_numbers:
                previous = self.require(plan.story_project_id, plan.episode_number, revision=scene.source_revision)
                previous_source = DraftMasterScript.model_validate(previous.source_draft)
                original = next(s for s in previous_source.scenes
                                if s.scene_number == scene.scene_number)
                self._enrich_scene_design(scene, original)
                for shot in scene.shots:
                    self._compile_shot(shot, original, plan.visual_direction, previous_source.characters, scene.design)
                findings.append(PreflightFinding(code="source_changed", severity="error", scene_number=scene.scene_number,
                                                message="正文来源已变化，旧分镜已保留，需重新编排并核对。"))
                continue
            original = source_scenes.get(scene.scene_number)
            if original is None:
                raise StoryboardConflictError("镜头场次不在当前正文中。")
            self._enrich_scene_design(scene, original)
            refs = [ref for shot in scene.shots for ref in shot.source_refs]
            if refs != original.body_order:
                findings.append(PreflightFinding(code="source_coverage", severity="error", scene_number=scene.scene_number,
                                                message="正文动作或对白存在遗漏、重复或顺序变化。"))
            for shot_index, shot in enumerate(scene.shots, start=1):
                self._compile_shot(shot, original, plan.visual_direction, source.characters, scene.design)
                spoken_seconds = sum(
                    estimate_spoken_line_duration(original.dialogues[int(ref.split(":")[1])].text)
                    for ref in shot.source_refs if ref.startswith("dialogue:")
                )
                if spoken_seconds > shot.duration_seconds * 1.2 + 1:
                    findings.append(PreflightFinding(
                        code="shot_dialogue_duration", severity="warning", scene_number=scene.scene_number,
                        message=f"第 {shot_index} 镜按当前口播参考约需 {spoken_seconds:.1f} 秒，已分配 {shot.duration_seconds:g} 秒，且未计额外停顿；请核对时长或拆镜。",
                    ))
            for question in scene.unresolved_questions:
                findings.append(PreflightFinding(code="creative_question", severity="warning", scene_number=scene.scene_number,
                                                message=question))
        if plan.candidate:
            original = source_scenes[plan.candidate.scene_number]
            self._enrich_scene_design(plan.candidate, original)
            for shot in plan.candidate.shots:
                self._compile_shot(shot, original, plan.visual_direction, source.characters, plan.candidate.design)
        if sum(shot.duration_seconds for scene in plan.scenes for shot in scene.shots) > source.target_duration_seconds:
            findings.append(PreflightFinding(code="duration_budget", severity="warning", message="分镜预计总时长超出正文目标时长。"))
        if not plan.visual_direction.strip():
            findings.append(PreflightFinding(code="visual_direction", severity="warning", message="本集视觉方向尚未确定。"))
        plan.findings = findings
        plan.status = "source_changed" if plan.stale_scene_numbers else "draft" if any(f.severity == "error" for f in findings) else "review"
        plan.scenes.sort(key=lambda s: s.scene_number)
        plan.revision = expected_revision + 1
        plan.updated_at = datetime.now(timezone.utc)
        return self.repository.save(PreproductionStoryboard.model_validate(plan.model_dump()), expected_revision)

    @staticmethod
    def _enrich_scene_design(scene: StoryboardScene, original: DraftSceneCard) -> None:
        """Fill the human-facing dramatic summary without inventing new story facts."""

        causality = original.scene_causality
        outcome = (causality.outcome if causality else None) or original.turning_point or original.beat_summary
        scene.design = scene.design.model_copy(update={
            "audience_effect": scene.design.audience_effect or f"让观众看见：{original.beat_summary}。",
            "status_change": scene.design.status_change or f"本场结束时，局面推进到：{outcome}。",
        })

    @staticmethod
    def _compile_shot(shot: StoryboardShot, original: DraftSceneCard, visual: str,
                      characters: list[CharacterProfile], design: SceneDesign | None = None) -> None:
        derived_acting = derive_acting_direction(original, shot)
        existing_acting = shot.acting_direction
        shot.acting_direction = existing_acting.model_copy(update={
            field: value
            for field, value in derived_acting.model_dump().items()
            if not getattr(existing_acting, field)
        })
        dialogue = []
        source_order = []
        for ref in shot.source_refs:
            if ref not in original.body_order:
                raise StoryboardConflictError("镜头引用了不存在的正文段落。")
            kind, index = ref.split(":")
            if kind == "dialogue":
                line = original.dialogues[int(index)]
                text = f"{line.character_name}: {line.text}"
                if line.chinese_translation:
                    text += f"\n{line.chinese_translation}"
                dialogue.append(text)
                source_order.append(f"{ref} {text}")
            else:
                source_order.append(f"{ref} {original.character_actions[int(index)]}")
        shot.dialogue = dialogue
        shot.prompt_plan = build_prompt_plan(original, shot, visual, characters, design)
        prompt = compile_cinematic_prompt(original, shot, visual, design, characters)
        if len(prompt) > MAX_COMPILED_PROMPT_LENGTH:
            raise StoryboardConflictError("单镜执行提示词超过容量，请缩短拍摄要求或拆分镜头动作；原分镜已保留。")
        shot.prompt = prompt
