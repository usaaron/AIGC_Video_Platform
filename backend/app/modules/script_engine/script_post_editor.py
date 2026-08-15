from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import json
import re

from pydantic import ValidationError

from app.modules.master_script.models import (
    DraftMasterScript,
    DraftSceneCard,
    LLMScriptEditorialPatch,
)
from app.script_delivery_contract import (
    EPISODE_RUNTIME_MAX_SECONDS,
    EPISODE_RUNTIME_MIN_SECONDS,
)
from app.modules.script_engine.llm_adapter import LLMAdapter
from app.modules.script_engine.mainland_language import (
    blocking_draft_script_chinese_issues,
)
from app.modules.script_engine.mainland_screenplay import (
    draft_screenplay_style_issues,
)
from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.screenplay_duration import (
    ScreenplayDurationEstimate,
    estimate_screenplay_duration,
)


EDITOR_DURATION_MIN_SECONDS = EPISODE_RUNTIME_MIN_SECONDS
EDITOR_DURATION_MAX_SECONDS = EPISODE_RUNTIME_MAX_SECONDS
EDITOR_MAX_ATTEMPTS = 2
EDITOR_MIN_OUTPUT_TOKENS = 8_000
_SPEAKER_MARKER = re.compile(
    r"\s*[（(](?:O\.S\.|V\.O\.|continued|pre[\s-]?lap)[）)]\s*$",
    re.IGNORECASE,
)


class InvalidScriptPostEditError(ValueError):
    """Raised when GPT cannot return an acceptable bounded screenplay edit."""


@dataclass(frozen=True)
class ScriptPostEditResult:
    draft: DraftMasterScript
    duration: ScreenplayDurationEstimate
    attempt_count: int


class ScriptPostEditor:
    """Apply a bounded GPT edit without exposing continuity fields to mutation."""

    def __init__(self, *, llm_adapter: LLMAdapter) -> None:
        self._llm_adapter = llm_adapter

    def edit(
        self,
        draft: DraftMasterScript,
        *,
        strategy: GenerationStrategy,
        target_duration_seconds: int | None,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> ScriptPostEditResult:
        source_scene_numbers = [scene.scene_number for scene in draft.scenes]
        source_duration = estimate_screenplay_duration(draft)  # type: ignore[arg-type]
        target_duration = min(
            EDITOR_DURATION_MAX_SECONDS,
            max(
                EDITOR_DURATION_MIN_SECONDS,
                target_duration_seconds or draft.target_duration_seconds,
            ),
        )
        correction_issues: list[str] = []
        previous_patch: dict[str, object] | None = None

        for attempt in range(1, EDITOR_MAX_ATTEMPTS + 1):
            self._emit(
                progress_callback,
                "stage",
                stage="editing_with_gpt",
                editor_attempt=attempt,
                estimated_duration_seconds=source_duration.total_seconds,
                target_duration_seconds=target_duration,
            )
            raw_patch = self._llm_adapter.generate_structured_output(
                self._build_prompt(
                    draft=draft,
                    source_duration=source_duration,
                    target_duration=target_duration,
                    correction_issues=correction_issues,
                    previous_patch=previous_patch,
                ),
                strategy=strategy.model_copy(
                    update={
                        "max_tokens": max(strategy.max_tokens, EDITOR_MIN_OUTPUT_TOKENS)
                    }
                ),
                output_schema=LLMScriptEditorialPatch.model_json_schema(),
            )
            normalized = {
                key: value for key, value in raw_patch.items() if key != "_meta"
            }
            try:
                patch = LLMScriptEditorialPatch.model_validate(normalized)
                candidate = self._apply_patch(
                    draft,
                    patch,
                    expected_scene_numbers=source_scene_numbers,
                )
            except (ValidationError, ValueError) as exc:
                correction_issues = [f"结构或合并错误：{str(exc)[:500]}"]
                previous_patch = normalized
                if attempt < EDITOR_MAX_ATTEMPTS:
                    continue
                raise InvalidScriptPostEditError(
                    "GPT正文终审未返回可合并的完整场景编辑结果。"
                ) from exc

            duration = estimate_screenplay_duration(candidate)  # type: ignore[arg-type]
            correction_issues = self._acceptance_issues(
                source=draft,
                candidate=candidate,
                duration=duration,
            )
            if not correction_issues:
                metadata = {
                    **candidate.llm_metadata,
                    "script_editor_applied": True,
                    "script_editor_provider": self._llm_adapter.get_model_info().provider,
                    "script_editor_model": self._llm_adapter.get_model_info().model_name,
                    "script_editor_attempt_count": attempt,
                    "script_editor_source_duration_seconds": source_duration.total_seconds,
                    "estimated_duration_seconds": duration.total_seconds,
                    "duration_window_seconds": [
                        EDITOR_DURATION_MIN_SECONDS,
                        EDITOR_DURATION_MAX_SECONDS,
                    ],
                }
                return ScriptPostEditResult(
                    draft=candidate.model_copy(update={"llm_metadata": metadata}),
                    duration=duration,
                    attempt_count=attempt,
                )
            previous_patch = normalized

        raise InvalidScriptPostEditError(
            f"GPT正文终审后仍未满足当前项目的{EDITOR_DURATION_MIN_SECONDS}–"
            f"{EDITOR_DURATION_MAX_SECONDS}秒、人物和场景保护规则："
            + "；".join(correction_issues[:6])
        )

    @staticmethod
    def _apply_patch(
        source: DraftMasterScript,
        patch: LLMScriptEditorialPatch,
        *,
        expected_scene_numbers: list[int],
    ) -> DraftMasterScript:
        patch_by_scene = {scene.scene_number: scene for scene in patch.scenes}
        if sorted(patch_by_scene) != sorted(expected_scene_numbers):
            raise ValueError(
                "GPT必须返回原稿的全部场景，且不得新增、删除或重编号场景。"
            )

        allowed_speakers = {
            ScriptPostEditor._speaker_identity(character.name)
            for character in source.characters
        }
        allowed_speakers.update(
            ScriptPostEditor._speaker_identity(dialogue.character_name)
            for scene in source.scenes
            for dialogue in scene.dialogues
        )
        unknown_speakers = sorted(
            {
                dialogue.character_name
                for scene in patch.scenes
                for dialogue in scene.dialogues
                if ScriptPostEditor._speaker_identity(dialogue.character_name)
                not in allowed_speakers
            }
        )
        if unknown_speakers:
            raise ValueError("GPT新增了未获批准的说话人物：" + "、".join(unknown_speakers))

        edited_scenes: list[DraftSceneCard] = []
        for scene in source.scenes:
            edited_body = patch_by_scene[scene.scene_number]
            dialogue_prompts = list(
                dict.fromkeys(dialogue.text for dialogue in edited_body.dialogues)
            )[:6]
            edited_scenes.append(
                scene.model_copy(
                    update={
                        "character_actions": edited_body.character_actions,
                        "dialogues": edited_body.dialogues,
                        "dialogue_prompts": dialogue_prompts,
                    }
                )
            )
        return DraftMasterScript.model_validate(
            source.model_dump() | {"scenes": [scene.model_dump() for scene in edited_scenes]}
        )

    @staticmethod
    def _speaker_identity(value: str) -> str:
        return _SPEAKER_MARKER.sub("", value).strip().casefold()

    @staticmethod
    def _acceptance_issues(
        *,
        source: DraftMasterScript,
        candidate: DraftMasterScript,
        duration: ScreenplayDurationEstimate,
    ) -> list[str]:
        issues: list[str] = []
        if duration.total_seconds < EDITOR_DURATION_MIN_SECONDS:
            issues.append(
                f"预计时长仅{duration.total_seconds}秒，需要在原场景内增加有效动作、反应和潜台词交锋"
            )
        elif duration.total_seconds > EDITOR_DURATION_MAX_SECONDS:
            issues.append(
                f"预计时长达到{duration.total_seconds}秒，需要压缩重复动作和无推进对白"
            )

        protected_source = source.model_dump(
            exclude={"scenes", "llm_metadata", "updated_at"}
        )
        protected_candidate = candidate.model_dump(
            exclude={"scenes", "llm_metadata", "updated_at"}
        )
        if protected_source != protected_candidate:
            issues.append("GPT修改了受保护的剧情、人物或连续性字段")

        for source_scene, candidate_scene in zip(source.scenes, candidate.scenes, strict=True):
            protected_scene_fields = {
                "scene_number",
                "slug",
                "purpose",
                "setting_hint",
                "beat_summary",
                "emotional_shift",
                "emotional_objective",
                "turning_point",
                "scene_causality",
                "cliffhanger",
                "supporting_asset_ids",
            }
            if any(
                getattr(source_scene, field) != getattr(candidate_scene, field)
                for field in protected_scene_fields
            ):
                issues.append(f"第{source_scene.scene_number}场的受保护结构发生变化")

        if candidate.language.strip().casefold() in {
            "zh",
            "zh-cn",
            "cn",
            "chinese",
            "简体中文",
            "中文",
        }:
            language_issues = blocking_draft_script_chinese_issues(candidate)  # type: ignore[arg-type]
            if language_issues:
                issues.append(
                    "中文路径的动作或对白出现了不符合语言要求的内容："
                    + "、".join(language_issues[:5])
                )
        screenplay_issues = draft_screenplay_style_issues(candidate)  # type: ignore[arg-type]
        if screenplay_issues:
            issues.append(
                "动作描述包含镜头语言、内心叙述或过长段落："
                + "、".join(screenplay_issues[:5])
            )
        return list(dict.fromkeys(issues))

    @staticmethod
    def _build_prompt(
        *,
        draft: DraftMasterScript,
        source_duration: ScreenplayDurationEstimate,
        target_duration: int,
        correction_issues: list[str],
        previous_patch: dict[str, object] | None,
    ) -> str:
        language_rule = (
            "保持全中文动作与对白。"
            if draft.language.strip().casefold() in {"zh", "zh-cn", "cn", "chinese", "简体中文", "中文"}
            else (
                "海外路径的动作与画面描述保持简体中文，人物使用原稿中的稳定英文名，"
                "对白只写自然的美国短剧英语；中文翻译由后续双语显示层生成，"
                "不要在同一个对白text中混写中英两种版本。"
            )
        )
        correction_block = (
            "\n上一次编辑仍有以下问题，必须全部修正：\n- "
            + "\n- ".join(correction_issues)
            if correction_issues
            else ""
        )
        previous_block = (
            "\n上一次编辑结果，仅用于定向修正：\n"
            + json.dumps(previous_patch, ensure_ascii=False)
            if previous_patch is not None
            else ""
        )
        return f"""你是剧本大师工作流中的GPT终审编剧。DeepSeek已经完成一集完整初稿。
你的任务只是在不改变剧情事实、人物关系、伏笔、连续性结果、场景数量、场景顺序、场景标题和结尾义务的前提下，优化每场的可拍动作与人物对白。

当前项目规则：
1. 单集最终成片范围为{EDITOR_DURATION_MIN_SECONDS}–{EDITOR_DURATION_MAX_SECONDS}秒，目标约{target_duration}秒；当前程序估算约{source_duration.total_seconds}秒。
2. 动作只写观众能看到或听到的外部动作、环境声、道具变化和演员调度；不写心理活动、镜头景别、角度、运镜、全知解释或无意义空镜。每项保持一个简洁可拍动作单元，导出层会自动添加△，不要在字段里重复添加。
3. 对白采用美国短剧的短句、打断、反击和潜台词节奏；删除后不影响冲突、关系、信息或选择的台词不要保留。intent只放可表演提示，例如低声、头也不抬或beat。
4. 保留原稿已有的（O.S.）、（V.O.）、（continued）和（pre-lap）语义；如确有表演必要，可把这些标记附在已批准人物名后，但不得借此新增人物。
5. 保持短剧持续执行压力-行动-回报-升级循环，在原有剧情范围内强化动作、反应、交锋和事件后果，不能整集只等待、调查、解释或为最终对手做准备。
6. 不得修改场景标题、场景顺序、转场语义或结尾钩子义务；最后可见动作或最后一句对白必须真正执行原稿的cliffhanger和next_episode_question。
7. 不得新增人物；说话人只能来自原稿已经存在的人物。
8. 必须返回全部原场景，每场只返回scene_number、character_actions、dialogues。
9. 不要返回分析、解释、Markdown或完整DraftMasterScript。
10. {language_rule}
{correction_block}{previous_block}

DeepSeek已校验初稿：
{json.dumps(draft.model_dump(mode="json"), ensure_ascii=False)}
"""

    @staticmethod
    def _emit(
        callback: Callable[[str, dict[str, object]], None] | None,
        event_type: str,
        **payload: object,
    ) -> None:
        if callback is not None:
            callback(event_type, dict(payload))
