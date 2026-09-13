from __future__ import annotations

import json
import threading
from typing import Any

import pytest

from app.modules.master_script.models import (
    CharacterProfile,
    DialogueLine,
    DraftMasterScript,
    DraftSceneCard,
    LLMScriptEditorialPatch,
    SceneCausality,
    ScriptTone,
)
from app.modules.script_engine.llm_adapter import (
    LLMAdapter,
    LLMRequestError,
    LLMRequestCancelledError,
    LLMStructuredOutputError,
)
from app.modules.script_engine.models import GenerationStrategy, LLMModelInfo
from app.modules.script_engine.script_post_editor import (
    ScriptPostEditCheckpoint,
    ScriptPostEditor,
)
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration


class EditorialPatchAdapter(LLMAdapter):
    def __init__(
        self,
        *,
        short: bool = False,
        overlong: bool = False,
        marked_speaker: bool = False,
        unknown_speaker: bool = False,
    ) -> None:
        self.short = short
        self.overlong = overlong
        self.marked_speaker = marked_speaker
        self.unknown_speaker = unknown_speaker
        self.call_count = 0
        self.prompts: list[str] = []
        self.max_tokens_seen: list[int] = []

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        return prompt

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.call_count += 1
        self.prompts.append(prompt)
        self.max_tokens_seen.append(strategy.max_tokens)
        assert "DeepSeek已经完成一集完整初稿" in prompt
        assert "总数只能为1–5个" in prompt
        assert "dialogues合计必须为25–35条" in prompt
        assert "character_actions合计必须为15–20项" in prompt
        assert "字体与版式由系统按照partner_screenplay.v1统一处理" in prompt
        assert output_schema is not None
        if self.short:
            line = "Stop."
        elif self.overlong:
            line = (
                "You know exactly what this contract costs every person in this room, "
                "and you will explain every hidden payment before anyone leaves tonight."
            )
        else:
            line = "You know exactly what this contract costs us tonight, Damian."
        speaker_cycle = ("Elena", "Damian") * 7
        return {
            "scenes": [
                {
                    "scene_number": scene_number,
                    "character_actions": [
                        f"桌边的契约与人物站位发生第{index}次可见变化。"
                        for index in range(1, 9 if scene_number == 1 else 8)
                    ],
                    "dialogues": [
                        {
                            "character_name": (
                                "孩童"
                                if self.unknown_speaker and index == 0
                                else (
                                    f"{speaker} (V.O.)"
                                    if self.marked_speaker and speaker == "Elena"
                                    else speaker
                                )
                            ),
                            "chinese_character_name": (
                                "埃琳娜" if speaker == "Elena" else "达米安"
                            ),
                            "intent": "逼对方说出隐藏的代价",
                            "text": line,
                            "chinese_translation": "你很清楚这份契约今晚让我们付出了什么，达米安。",
                        }
                        for index, speaker in enumerate(
                            speaker_cycle[:13 if scene_number == 1 else 12]
                        )
                    ],
                }
                for scene_number in (1, 2)
            ]
        }

    def validate_output(
        self,
        output: dict[str, Any],
        *,
        required_keys=None,
    ) -> bool:
        return True

    def get_model_info(self) -> LLMModelInfo:
        return LLMModelInfo(
            provider="openai",
            model_name="gpt-screenplay-editor",
            supports_structured_output=True,
            max_context_tokens=128_000,
        )


class ProgressiveCompressionAdapter(EditorialPatchAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.lines = (
            "You know exactly what this contract costs every person in this room, and you will explain every hidden payment before anyone leaves tonight.",
            "You know who paid for this contract, so tell me before anyone leaves.",
            "You know who paid for this contract, Damian.",
        )

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        result = super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        line = self.lines[min(self.call_count - 1, len(self.lines) - 1)]
        for scene in result["scenes"]:
            for dialogue in scene["dialogues"]:
                dialogue["text"] = line
        return result


class FarOverDurationCompressionAdapter(ProgressiveCompressionAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.lines = (
            "You know who paid for this contract and why everyone here is afraid to say it aloud tonight.",
            "You know who paid for this contract and why everyone here is afraid to say it aloud tonight.",
            "You know who paid for this contract, Damian.",
        )


class UnavailableEditorialAdapter(EditorialPatchAdapter):
    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.call_count += 1
        raise LLMRequestError(
            "temporary gateway failure",
            status_code=502,
            category="provider_gateway",
            recoverable=True,
        )


class UnavailableAfterShortPassAdapter(EditorialPatchAdapter):
    def __init__(self) -> None:
        super().__init__(short=True)

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if self.call_count:
            self.call_count += 1
            raise LLMRequestError(
                "temporary gateway failure",
                status_code=502,
                category="provider_gateway",
                recoverable=True,
            )
        return super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )


class OverseasFieldRepairAdapter(EditorialPatchAdapter):
    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if "只修复下列海外短剧正文中的语言字段" in prompt:
            self.call_count += 1
            self.prompts.append(prompt)
            self.max_tokens_seen.append(strategy.max_tokens)
            assert strategy.max_tokens == 32_000
            assert output_schema is not None
            return {
                "patches": [
                    {
                        "path": "scenes.0.character_actions.0",
                        "value": "埃琳娜把契约按在桌上。",
                    },
                    {
                        "path": "scenes.0.dialogues.0.text",
                        "value": "You knew all along. Why did you hide it from me?",
                    },
                ]
            }
        result = super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        result["scenes"][0]["character_actions"][0] = (
            "Elena presses the contract against the table."
        )
        result["scenes"][0]["dialogues"][0]["text"] = "你早就知道。为什么瞒着我？"
        return result


class DialoguePairRepairAdapter(EditorialPatchAdapter):
    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        assert "只修复下列海外短剧正文中的语言字段" in prompt
        self.call_count += 1
        self.prompts.append(prompt)
        self.max_tokens_seen.append(strategy.max_tokens)
        repair_items = json.loads(prompt.split("待修字段：\n", 1)[1])
        return {
            "patches": [
                {
                    "path": item["path"],
                    "value": (
                        "埃琳娜"
                        if item["path"].endswith(".chinese_character_name")
                        else "告诉我今晚是谁为这份签署的契约付了钱。"
                    ),
                }
                for item in repair_items
            ]
        }


class StickyOverseasFieldRepairAdapter(EditorialPatchAdapter):
    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if "只修复下列海外短剧正文中的语言字段" in prompt:
            self.call_count += 1
            self.prompts.append(prompt)
            return {
                "patches": [{
                    "path": "scenes.0.dialogues.0.text",
                    "value": (
                        "Wait. I need a second."
                        if "最后一次窄修复" in prompt
                        else "..."
                    ),
                }],
            }
        result = super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        result["scenes"][0]["dialogues"][0]["text"] = "..."
        return result


class MalformedOverseasFieldRepairAdapter(StickyOverseasFieldRepairAdapter):
    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if (
            "只修复下列海外短剧正文中的语言字段" in prompt
            and "最后一次窄修复" not in prompt
        ):
            self.call_count += 1
            self.prompts.append(prompt)
            raise LLMStructuredOutputError("language patch was not valid JSON")
        return super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )


class CanonicalRenameAdapter(EditorialPatchAdapter):
    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        result = super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        result["scenes"][0]["dialogues"][0]["character_name"] = "Damian"
        return result


class CanonicalPreservingAdapter(EditorialPatchAdapter):
    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        result = super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        global_index = 0
        for scene in result["scenes"]:
            for dialogue in scene["dialogues"]:
                dialogue["character_name"] = ("Elena", "Damian")[global_index % 2]
                global_index += 1
        return result


def _draft() -> DraftMasterScript:
    characters = [
        CharacterProfile(
            name="Elena",
            role="lead",
            description="A betrayed bride who refuses to surrender public control.",
            motivation="Expose the contract before Damian can use it against her.",
        ),
        CharacterProfile(
            name="Damian",
            role="counterpart",
            description="A calculating heir who hides protection inside every threat.",
            motivation="Keep Elena in the room until she learns who funded the trap.",
        ),
    ]
    scenes = [
        DraftSceneCard(
            scene_number=1,
            slug="INT. BALLROOM - NIGHT",
            purpose="Force Elena to confront the contract in public.",
            setting_hint="夜晚，拥挤的酒店宴会厅。",
            beat_summary="Damian places the contract between Elena and the exit.",
            emotional_shift="control to suspicion",
            emotional_objective="Keep control without revealing fear.",
            character_actions=["达米安把契约放在桌上。"],
            turning_point="Elena recognizes her mother's signature.",
            cliffhanger=False,
            dialogue_prompts=["You already signed."],
            dialogues=[
                DialogueLine(
                    character_name="Damian",
                    intent="keep Elena from leaving",
                    text="You already signed.",
                )
            ],
        ),
        DraftSceneCard(
            scene_number=2,
            slug="INT. BALLROOM CORRIDOR - CONTINUOUS",
            purpose="Reveal that the contract came from Elena's family.",
            setting_hint="宴会厅外的走廊。",
            beat_summary="Elena opens the final page and sees the signature.",
            emotional_shift="suspicion to shock",
            emotional_objective="Learn who placed her in Damian's control.",
            character_actions=["埃琳娜把契约翻到最后一页。"],
            turning_point="Her mother's signature appears beneath Damian's name.",
            cliffhanger=True,
            dialogue_prompts=["Ask your mother."],
            dialogues=[
                DialogueLine(
                    character_name="Damian",
                    intent="redirect Elena toward the real betrayer",
                    text="Ask your mother why she sold you first.",
                )
            ],
        ),
    ]
    return DraftMasterScript(
        content_spec_id="content.editor.test",
        generation_strategy_id="strategy.editor.test",
        title="The Contract",
        logline="A betrayed bride discovers her family signed away her freedom.",
        language="en",
        target_audience="US short-drama viewers",
        target_platform="short drama",
        tone=ScriptTone.intense,
        hook="Elena finds her mother's signature on Damian's contract.",
        synopsis="Elena tries to leave a public confrontation until Damian reveals the contract that ties her family to his plan.",
        episode_goal="Reveal who authorized Damian to control Elena's wedding night.",
        target_duration_seconds=90,
        characters=characters,
        scenes=scenes,
        next_episode_question="Why did Elena's mother sign the contract?",
    )


def _strategy() -> GenerationStrategy:
    return GenerationStrategy.model_construct(max_tokens=3_000)


def _contract_ready_draft() -> DraftMasterScript:
    payload = _draft().model_dump(mode="json")
    actions = [
        f"埃琳娜穿过宴会厅，在达米安碰到契约前检查第{index}处封印。"
        for index in range(1, 16)
    ]
    dialogues = [
        DialogueLine(
            character_name=("Elena", "Damian")[index % 2],
            chinese_character_name=("埃琳娜", "达米安")[index % 2],
            intent="逼对方说出隐藏的代价",
            text="Tell me who paid for this signed contract tonight.",
            chinese_translation="告诉我今晚是谁为这份签署的契约付了钱。",
        ).model_dump(mode="json")
        for index in range(25)
    ]
    payload["scenes"][0]["character_actions"] = actions[:8]
    payload["scenes"][1]["character_actions"] = actions[8:]
    payload["scenes"][0]["dialogues"] = dialogues[:13]
    payload["scenes"][1]["dialogues"] = dialogues[13:]
    payload["scenes"][0]["dialogue_prompts"] = [dialogues[0]["text"]]
    payload["scenes"][1]["dialogue_prompts"] = [dialogues[13]["text"]]
    return DraftMasterScript.model_validate(payload)


def test_editorial_quality_gate_accepts_a_contract_ready_source_without_model_work() -> None:
    source = _contract_ready_draft()

    assessment = ScriptPostEditor.assess_source(
        source,
        overseas_release=True,
    )
    accepted = ScriptPostEditor.accept_without_edit(
        source,
        assessment=assessment,
    )

    assert assessment.requires_edit is False
    assert assessment.issues == ()
    assert accepted.scenes == source.scenes
    assert accepted.llm_metadata["script_editor_policy"] == "quality_gated_v1"
    assert accepted.llm_metadata["script_editor_gate_passed"] is True
    assert accepted.llm_metadata["script_editor_skipped"] is True
    assert accepted.llm_metadata["script_editor_deferred"] is False
    assert accepted.llm_metadata["script_editor_attempt_count"] == 0


def test_editorial_quality_gate_requires_repairs_for_an_invalid_source() -> None:
    assessment = ScriptPostEditor.assess_source(
        _draft(),
        overseas_release=True,
    )

    assert assessment.requires_edit is True
    assert any("预计时长仅" in issue for issue in assessment.issues)
    assert any("台词共" in issue for issue in assessment.issues)
    assert any("镜头执行单元共" in issue for issue in assessment.issues)


@pytest.mark.parametrize("needs_edit", [False, True])
def test_successful_editor_clears_a_previous_deferred_status(needs_edit: bool) -> None:
    source = (_draft() if needs_edit else _contract_ready_draft()).model_copy(update={
        "llm_metadata": {
            "script_editor_deferred": True,
            "script_editor_quality_status": "deferred",
            "script_editor_deferred_reason": "quality_target_not_reached",
            "script_editor_deferred_issues": ["previous duration failure"],
            "script_editor_skip_reason": "previous_skip",
            "initial_generation_usage": {"input_tokens": 17},
        },
    })
    original = source.model_dump(mode="json")
    adapter = EditorialPatchAdapter()
    if needs_edit:
        accepted = ScriptPostEditor(llm_adapter=adapter).edit(
            source,
            strategy=_strategy(),
            target_duration_seconds=90,
            overseas_release=True,
        ).draft
    else:
        accepted = ScriptPostEditor.accept_without_edit(
            source,
            assessment=ScriptPostEditor.assess_source(source, overseas_release=True),
        )

    assert accepted.llm_metadata["script_editor_deferred"] is False
    assert accepted.llm_metadata["script_editor_quality_status"] == "passed"
    assert "script_editor_deferred_reason" not in accepted.llm_metadata
    assert "script_editor_deferred_issues" not in accepted.llm_metadata
    assert accepted.llm_metadata.get("script_editor_skip_reason") == (
        None if needs_edit else "validated_source_ready"
    )
    assert accepted.llm_metadata["initial_generation_usage"] == {"input_tokens": 17}
    assert source.model_dump(mode="json") == original
    assert adapter.call_count == int(needs_edit)


def _three_scene_duration_draft(*, word_count: int) -> DraftMasterScript:
    source = _contract_ready_draft()
    actions = [action for scene in source.scenes for action in scene.character_actions]
    lines = [line for scene in source.scenes for line in scene.dialogues]
    quotient, remainder = divmod(word_count, len(lines))
    lines = [line.model_copy(update={
        "text": " ".join(["word"] * (quotient + int(index < remainder))),
    }) for index, line in enumerate(lines)]
    scenes = [source.scenes[0].model_copy(update={
        "scene_number": index + 1,
        "character_actions": actions[index * 5:(index + 1) * 5],
        "dialogues": lines[start:end],
        "body_order": [],
        "cliffhanger": index == 2,
    }) for index, (start, end) in enumerate(((0, 9), (9, 17), (17, 25)))]
    return source.model_copy(update={"scenes": scenes})


def _duration_budget_prompt(source: DraftMasterScript, editable: list[int]) -> str:
    duration = estimate_screenplay_duration(source)
    scene_count, dialogue_count, shot_count = ScriptPostEditor._production_counts(source)
    return ScriptPostEditor._build_prompt(
        draft=source,
        current_duration=duration,
        target_duration=90,
        source_scene_count=scene_count,
        source_dialogue_count=dialogue_count,
        source_shot_count=shot_count,
        overseas_release=True,
        canonical_character_names={},
        correction_issues=[f"预计时长{duration.total_seconds}秒"],
        previous_patch=None,
        editable_scene_numbers=editable,
    )


def test_focused_expansion_budget_excludes_fixed_scenes_and_caps_growth() -> None:
    source = _three_scene_duration_draft(word_count=152)
    original = source.model_dump(mode="json")
    prompt = _duration_budget_prompt(source, [1, 2])
    context = json.loads(prompt.split("不要恢复第一轮措辞：\n", 1)[1])

    assert context["duration_budget_seconds"] == {
        "episode_current": 61,
        "episode_target": 90,
        "fixed_scenes": 19,
        "editable_current": 42,
        "editable_target": 71,
        "editable_preferred_min": 71,
        "editable_preferred_max": 86,
        "editable_min": 56,
        "editable_max": 96,
    }
    assert "只在可编辑场景中增加约29秒，优先增加29–44秒" in prompt
    assert "最少需增14秒，最多可增54秒" in prompt
    assert "达到目标后停止扩写" in prompt
    assert "不能按总文字量等比例扩写或删减" in prompt
    assert [scene["scene_number"] for scene in context["scenes"]] == [1, 2]
    assert source.model_dump(mode="json") == original


def test_focused_compression_budget_caps_reduction_and_keeps_fixed_scenes() -> None:
    prompt = _duration_budget_prompt(_three_scene_duration_draft(word_count=363), [1, 2])
    context = json.loads(prompt.split("不要恢复第一轮措辞：\n", 1)[1])
    budget = context["duration_budget_seconds"]

    assert budget["episode_current"] == 139
    assert budget["fixed_scenes"] == 43
    assert budget["editable_current"] == 96
    assert budget["editable_target"] == 47
    assert [budget["editable_min"], budget["editable_max"]] == [32, 72]
    assert "只在可编辑场景中削减约49秒，优先削减34–49秒" in prompt
    assert "最少需减24秒，最多可减64秒" in prompt
    assert "不得低于75秒" in prompt


def test_full_episode_duration_budget_does_not_invent_fixed_scene_overhead() -> None:
    source = _three_scene_duration_draft(word_count=152)
    prompt = _duration_budget_prompt(source, [1, 2, 3])
    context = json.loads(prompt.split("不要恢复第一轮措辞：\n", 1)[1])
    budget = context["duration_budget_seconds"]

    assert budget["fixed_scenes"] == 0
    assert budget["editable_current"] == budget["episode_current"] == 61
    assert budget["editable_target"] == budget["episode_target"] == 90
    assert [budget["editable_min"], budget["editable_max"]] == [75, 115]


def test_editor_widens_a_focus_when_fixed_scenes_already_exceed_the_target() -> None:
    source = _three_scene_duration_draft(word_count=294)
    actions = [action for scene in source.scenes for action in scene.character_actions]
    lines = [line for scene in source.scenes for line in scene.dialogues]
    source = source.model_copy(update={"scenes": [
        source.scenes[0].model_copy(update={
            "scene_number": index + 1,
            "character_actions": actions[index * 3:(index + 1) * 3],
            "dialogues": lines[index * 5:(index + 1) * 5],
            "cliffhanger": index == 4,
        }) for index in range(5)
    ]})
    assessment = ScriptPostEditor.assess_source(source, overseas_release=True)
    assert assessment.duration.total_seconds == 116
    initial_focus = ScriptPostEditor._focused_retry_scene_numbers(
        source, correction_issues=list(assessment.issues), duration=assessment.duration,
    )
    assert len(initial_focus) == 1

    class BudgetRespectingAdapter(EditorialPatchAdapter):
        def generate_structured_output(self, prompt, *, strategy, output_schema=None):
            super().generate_structured_output(
                prompt, strategy=strategy, output_schema=output_schema,
            )
            context = json.loads(prompt.split("不要恢复第一轮措辞：\n", 1)[1])
            return {"scenes": [{
                "scene_number": scene["scene_number"],
                "character_actions": scene["character_actions"],
                "body_order": scene["body_order"],
                "dialogues": [dict(line, text="Tell me who paid for this signed contract tonight.")
                              for line in scene["dialogues"]],
            } for scene in context["scenes"]]}

    adapter = BudgetRespectingAdapter()
    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source, strategy=_strategy(), target_duration_seconds=90, overseas_release=True,
    )
    context = json.loads(adapter.prompts[0].split("不要恢复第一轮措辞：\n", 1)[1])

    assert context["editable_scene_numbers"] == [1, 2, 3, 4, 5]
    assert context["duration_budget_seconds"]["fixed_scenes"] == 0
    assert adapter.call_count == 1, result.draft.llm_metadata.get("script_editor_deferred_issues")
    assert result.duration.total_seconds == 91
    assert result.draft.llm_metadata["script_editor_deferred"] is False


def test_overseas_generation_gate_rejects_english_narrative_fields() -> None:
    assessment = ScriptPostEditor.assess_source(
        _contract_ready_draft(),
        overseas_release=True,
        require_overseas_narrative_language=True,
    )

    assert assessment.requires_edit is True
    assert any("title" in issue for issue in assessment.issues)
    language_issues = ScriptPostEditor._overseas_body_language_issues(  # noqa: SLF001
        _contract_ready_draft(),
        include_narrative=True,
    )
    assert "characters.0.name" in language_issues


def _heading_only_draft() -> DraftMasterScript:
    payload = _contract_ready_draft().model_dump(mode="json")
    for field in ("title", "logline", "synopsis", "hook", "target_audience", "episode_goal", "next_episode_question"):
        payload[field] = "埃琳娜要查出契约背后的真实代价。"
    for index, character in enumerate(payload["characters"]):
        character.update(name=("埃琳娜", "达米安")[index], role="当事人",
                         description="出席契约签署的当事人。", motivation="查清签署的真实代价。")
    for scene in payload["scenes"]:
        for field in ("purpose", "beat_summary", "emotional_shift", "emotional_objective", "turning_point"):
            scene[field] = "埃琳娜认出母亲的签名，要求达米安解释。"
    return DraftMasterScript.model_validate(payload)


class HeadingPatchAdapter(EditorialPatchAdapter):
    def __init__(self, responses: list[object] | None = None) -> None:
        super().__init__()
        self.responses = responses

    def generate_structured_output(self, prompt: str, *, strategy: GenerationStrategy,
                                   output_schema: dict[str, Any] | None = None) -> dict[str, Any]:
        self.call_count += 1
        self.prompts.append(prompt)
        if self.responses:
            response = self.responses[min(self.call_count - 1, len(self.responses) - 1)]
            if isinstance(response, Exception):
                raise response
            return response  # type: ignore[return-value]
        fields = json.loads(prompt.split("待修字段：", 1)[1])
        assert {item["path"] for item in fields} == {"scenes.0.slug", "scenes.1.slug"}
        assert output_schema and "patches" in output_schema["properties"]
        return {"patches": [
            {"path": "scenes.0.slug", "value": "内景. 宴会厅 - 夜晚"},
            {"path": "scenes.1.slug", "value": "内景. 宴会厅走廊 - 连续"},
        ]}


def test_heading_only_repair_preserves_every_body_and_ledger_field() -> None:
    source = _heading_only_draft()
    original = source.model_dump(mode="json")
    adapter = HeadingPatchAdapter()
    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source, strategy=_strategy(), target_duration_seconds=90,
        overseas_release=True, require_overseas_narrative_language=True,
    )
    expected = source.model_dump(exclude={"llm_metadata"})
    expected["scenes"][0]["slug"] = "内景. 宴会厅 - 夜晚"
    expected["scenes"][1]["slug"] = "内景. 宴会厅走廊 - 连续"
    assert result.draft.model_dump(exclude={"llm_metadata"}) == expected
    assert source.model_dump(mode="json") == original
    assert result.attempt_count == adapter.call_count == 1
    metadata = result.draft.llm_metadata
    assert metadata["script_editor_deferred"] is False
    assert metadata["script_editor_applied"] is True
    assert metadata["script_editor_skipped"] is False
    assert "script_editor_skip_reason" not in metadata
    assert metadata["script_editor_full_episode_pass_count"] == 0
    assert metadata["script_editor_language_field_repair_count"] == 1


@pytest.mark.parametrize("response", [
    {"patches": [{"path": "scenes.0.dialogues.0.text", "value": "I promise nothing."}]},
    {"patches": [{"path": "scenes.0.slug", "value": "Still English"},
                 {"path": "scenes.1.slug", "value": "Still English"}]},
    LLMStructuredOutputError("invalid JSON"),
    LLMRequestError("temporary outage", status_code=503, recoverable=True),
])
def test_heading_repair_failure_preserves_source_and_counts_attempts(response: object) -> None:
    source = _heading_only_draft()
    adapter = HeadingPatchAdapter([response])
    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source, strategy=_strategy(), target_duration_seconds=90,
        overseas_release=True, require_overseas_narrative_language=True,
    )
    assert result.draft.model_dump(exclude={"llm_metadata"}) == source.model_dump(exclude={"llm_metadata"})
    assert result.attempt_count == adapter.call_count == 2
    assert result.draft.llm_metadata["script_editor_deferred"] is True
    assert result.draft.llm_metadata["script_editor_applied"] is False
    assert result.draft.llm_metadata["script_editor_full_episode_pass_count"] == 0
    assert len(result.draft.llm_metadata["script_editor_attempt_elapsed_ms"]) == 2


def test_heading_repair_cancellation_propagates_without_another_request() -> None:
    adapter = HeadingPatchAdapter([LLMRequestCancelledError()])
    with pytest.raises(LLMRequestCancelledError):
        ScriptPostEditor(llm_adapter=adapter).edit(
            _heading_only_draft(), strategy=_strategy(), target_duration_seconds=90,
            overseas_release=True, require_overseas_narrative_language=True,
            cancel_event=threading.Event(),
        )
    assert adapter.call_count == 1


def test_heading_shortcut_does_not_bypass_other_source_issues() -> None:
    source = _heading_only_draft()
    for scene in source.scenes:
        for dialogue in scene.dialogues:
            dialogue.text = "Stop."
    adapter = UnavailableEditorialAdapter()
    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source, strategy=_strategy(), target_duration_seconds=90,
        overseas_release=True, require_overseas_narrative_language=True,
    )
    assert result.draft.llm_metadata["script_editor_deferred_reason"] == "transient_upstream_failure"
    assert "script_editor_repair_scope" not in result.draft.llm_metadata


def test_overseas_dialogue_pairs_are_repaired_without_rewriting_the_episode() -> None:
    payload = _contract_ready_draft().model_dump(mode="json")
    payload["scenes"][0]["dialogues"][0]["chinese_character_name"] = None
    payload["scenes"][0]["dialogues"][0]["chinese_translation"] = None
    source = DraftMasterScript.model_validate(payload)
    adapter = DialoguePairRepairAdapter()

    repaired, attempt_count = ScriptPostEditor(
        llm_adapter=adapter
    ).ensure_overseas_dialogue_pairs(
        source,
        strategy=_strategy(),
    )

    assert attempt_count == 1
    assert adapter.call_count == 1
    assert repaired.scenes[0].dialogues[0].character_name == "Elena"
    assert repaired.scenes[0].dialogues[0].text == source.scenes[0].dialogues[0].text
    assert repaired.scenes[0].dialogues[0].chinese_character_name == "埃琳娜"
    assert repaired.scenes[0].dialogues[0].chinese_translation == (
        "告诉我今晚是谁为这份签署的契约付了钱。"
    )
    assert repaired.scenes[0].character_actions == source.scenes[0].character_actions
    assert ScriptPostEditor.overseas_dialogue_pair_issues(repaired) == []


def test_gpt_editor_changes_only_scene_bodies_and_records_model_metadata() -> None:
    source = _draft()
    adapter = EditorialPatchAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert 75 <= result.duration.total_seconds <= 115
    assert result.draft.scenes[0].dialogues[0].text != source.scenes[0].dialogues[0].text
    assert result.draft.hook == source.hook
    assert result.draft.characters == source.characters
    assert result.draft.continuity_state_updates == source.continuity_state_updates
    assert result.draft.llm_metadata["script_editor_applied"] is True
    assert result.draft.llm_metadata["script_editor_model"] == "gpt-screenplay-editor"
    assert result.draft.llm_metadata["episode_scene_count"] == 2
    assert result.draft.llm_metadata["episode_dialogue_line_count"] == 25
    assert result.draft.llm_metadata["episode_shot_unit_count"] == 15
    assert result.draft.language == "en"
    assert adapter.call_count == 1
    assert "沿用批准的单集节奏与场景职责" in adapter.prompts[0]
    assert "允许有价值的安静段落和铺垫" in adapter.prompts[0]
    assert "保持短剧持续执行压力-行动-回报-升级循环" not in adapter.prompts[0]
    assert adapter.max_tokens_seen == [32_000]


def test_gpt_editor_keeps_full_budget_on_focused_retry_passes() -> None:
    adapter = ProgressiveCompressionAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        _draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert result.draft.llm_metadata["script_editor_attempt_count"] == 3
    # The first pass edits the complete episode; subsequent duration-only
    # passes may focus on the largest scenes but still need hidden-reasoning
    # headroom to return a valid patch.
    assert adapter.max_tokens_seen == [32_000, 32_000, 32_000]


def test_overseas_editor_receives_the_american_dialogue_language_contract() -> None:
    adapter = EditorialPatchAdapter()

    ScriptPostEditor(llm_adapter=adapter).edit(
        _draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    prompt = adapter.prompts[0]
    assert "你现在同时是剧本大师和语言大师" in prompt
    assert "只使用对应中文名" in prompt
    assert "中文名（ENGLISH NAME）" in prompt
    assert "逐句检查并润色英文对白" in prompt
    assert "每条dialogue.chinese_translation同时写" in prompt
    assert "dialogue.chinese_character_name同时写" in prompt
    assert "英文一旦修改，中文对照必须同步更新" in prompt
    assert "两者逐句保留动作主体、对象、否定、时态、可能性和后果严重程度" in prompt
    assert "数量词及其所指对象必须对应" in prompt
    assert "不能让离场者自动获知后来抵达他人设备的信息" in prompt
    assert "区分提及附件和发送附件" in prompt
    assert "不得把明确执行者的具体行为改写为无主体的结果" in prompt
    assert "不得擅自补出原句未指明的执行者" in prompt
    assert "补足时长不能凭空增加指责、企图或信息来源" in prompt
    assert "不得改变剧情内容、人物意图、事实、关系、信息量" in prompt
    assert "采用自然、可表演的短剧口语" in prompt
    assert "25–35句台词必须共同支撑75–115秒真实表演时长" in prompt


def test_overseas_editor_receives_and_enforces_canonical_character_name_contract() -> None:
    adapter = CanonicalPreservingAdapter()
    result = ScriptPostEditor(llm_adapter=adapter).edit(
        _contract_ready_draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
        canonical_character_names={"埃琳娜": "Elena", "达米安": "Damian"},
    )

    assert "资料中的明确人物名合同" in adapter.prompts[0]
    assert '"埃琳娜":"Elena"' in adapter.prompts[0]
    assert result.draft.llm_metadata["script_editor_applied"] is True


def test_overseas_editor_checks_canonical_names_when_scene_line_counts_change() -> None:
    result = ScriptPostEditor(llm_adapter=EditorialPatchAdapter()).edit(
        _draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
        canonical_character_names={"埃琳娜": "Elena", "达米安": "Damian"},
    )

    assert result.draft.llm_metadata["script_editor_applied"] is True
    assert [len(scene.dialogues) for scene in result.draft.scenes] == [13, 12]
    assert {
        dialogue.character_name
        for scene in result.draft.scenes
        for dialogue in scene.dialogues
    } == {"Elena", "Damian"}


def test_overseas_editor_still_rejects_alias_changes_when_line_counts_change() -> None:
    candidate_payload = _contract_ready_draft().model_dump(mode="json")
    candidate_payload["scenes"][0]["dialogues"][0]["character_name"] = "elena"
    candidate = DraftMasterScript.model_validate(candidate_payload)

    issues = ScriptPostEditor._canonical_character_name_issues(  # noqa: SLF001
        _draft(),
        candidate,
        {"埃琳娜": "Elena", "达米安": "Damian"},
        overseas_release=True,
    )

    assert issues == ["scenes.0.dialogues.0.character_name"]


def test_overseas_editor_defers_candidate_that_renames_canonical_character() -> None:
    source = _contract_ready_draft()
    result = ScriptPostEditor(llm_adapter=CanonicalRenameAdapter()).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
        canonical_character_names={"埃琳娜": "Elena", "达米安": "Damian"},
    )

    assert result.draft.scenes == source.scenes
    assert result.draft.llm_metadata["script_editor_deferred"] is True
    assert result.draft.llm_metadata["script_editor_deferred_reason"] == (
        "contract_regression"
    )


def test_overseas_editor_restores_valid_source_language_fields_before_model_repair() -> None:
    source = _draft()
    adapter = OverseasFieldRepairAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert adapter.call_count == 1
    assert result.draft.scenes[0].character_actions[0] == source.scenes[0].character_actions[0]
    assert result.draft.scenes[0].dialogues[0].text == source.scenes[0].dialogues[0].text
    assert result.draft.scenes[0].dialogue_prompts[0] == (
        source.scenes[0].dialogues[0].text
    )
    assert result.draft.scenes[0].purpose == source.scenes[0].purpose
    assert len(result.draft.scenes[0].dialogues) == 13
    assert len(result.draft.scenes[0].character_actions) == 8
    assert result.draft.llm_metadata["script_editor_full_episode_pass_count"] == 1
    assert result.draft.llm_metadata["script_editor_language_field_repair_count"] == 0
    assert result.draft.llm_metadata["script_editor_attempt_count"] == 1
    assert result.attempt_count == 1
    assert adapter.max_tokens_seen == [32_000]


def test_overseas_editor_retries_only_a_remaining_nonverbal_dialogue_field() -> None:
    source_payload = _draft().model_dump(mode="json")
    source_payload["scenes"][0]["dialogues"][0]["text"] = "..."
    source_payload["scenes"][0]["dialogue_prompts"] = ["..."]
    source = DraftMasterScript.model_validate(source_payload)
    adapter = StickyOverseasFieldRepairAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert adapter.call_count == 3
    assert "最后一次窄修复" not in adapter.prompts[1]
    assert "最后一次窄修复" in adapter.prompts[2]
    assert '"speaker":"Elena"' in adapter.prompts[2]
    assert '"performance_intent":"逼对方说出隐藏的代价"' in adapter.prompts[2]
    for repair_prompt in adapter.prompts[1:]:
        assert "每个给定path必须且只能返回一次" in repair_prompt
        assert "逐句保留动作主体、具体行为、对象、因果、否定、时态与确定程度" in repair_prompt
        assert "改写为无主体的结果" in repair_prompt
        assert "不得把操作端预览改成观众已看见" in repair_prompt
        assert '"continuity_state_updates"' not in repair_prompt
    assert result.draft.scenes[0].dialogues[0].text == "Wait. I need a second."
    assert result.draft.scenes[0].dialogue_prompts[0] == "Wait. I need a second."
    assert result.draft.llm_metadata["script_editor_language_field_repair_count"] == 2
    assert result.draft.llm_metadata["script_editor_attempt_count"] == 3


def test_overseas_editor_keeps_malformed_field_json_inside_narrow_repair() -> None:
    source_payload = _draft().model_dump(mode="json")
    source_payload["scenes"][0]["dialogues"][0]["text"] = "..."
    source_payload["scenes"][0]["dialogue_prompts"] = ["..."]
    source = DraftMasterScript.model_validate(source_payload)
    adapter = MalformedOverseasFieldRepairAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert adapter.call_count == 3
    assert adapter.prompts[0].count("DeepSeek已经完成一集完整初稿") == 1
    assert "最后一次窄修复" not in adapter.prompts[1]
    assert "最后一次窄修复" in adapter.prompts[2]
    assert result.draft.scenes[0].dialogues[0].text == "Wait. I need a second."
    assert result.draft.llm_metadata["script_editor_full_episode_pass_count"] == 1
    assert result.draft.llm_metadata["script_editor_language_field_repair_count"] == 2


def test_editor_prompt_only_contains_editable_scene_context() -> None:
    adapter = EditorialPatchAdapter()

    ScriptPostEditor(llm_adapter=adapter).edit(
        _draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    prompt = adapter.prompts[0]
    assert '"approved_speakers"' in prompt
    assert '"body_order"' in prompt
    assert '"continuity_state_updates"' not in prompt
    assert '"relationship_state_updates"' not in prompt
    assert '"story_line_state_updates"' not in prompt
    context = json.loads(prompt.rsplit("\n", 2)[-2])
    assert all(scene["scene_causality"] is None for scene in context["scenes"])
    assert "内部安全目标为90–105秒" in prompt
    assert "材料持有与公开范围是不同事实" in prompt
    assert "区分操作端预览、观众大屏与向外发布" in prompt
    assert "中断展示不能抹去已经暴露的内容" in prompt
    assert "不得为润色新增或撤销公开事实" in prompt
    assert "原稿未交代的设备或受众不得擅自补为事实" in prompt


def test_editor_receives_causal_context_without_allowing_causal_patch_fields() -> None:
    source = _draft()
    source.scenes[0].scene_causality = SceneCausality(
        goal="埃琳娜要求在公开契约前核验签名。",
        conflict="达米安阻止她在签名尚未核实时公开契约。",
        outcome="契约未被公开，两人开始当面核对签名。",
    )
    source.scenes[1].scene_causality = SceneCausality(
        goal="埃琳娜要追查签名背后的授权人。",
        conflict="达米安拒绝直接说明契约的来历。",
        outcome="埃琳娜在末页认出母亲的签名，转向追问家人。",
        caused_by_scene_number=1,
        causal_link="前场决定先核验，促使埃琳娜继续翻查末页。",
    )
    source = DraftMasterScript.model_validate(source.model_dump())
    original = source.model_dump(mode="json")
    adapter = EditorialPatchAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    context = json.loads(adapter.prompts[0].rsplit("\n", 2)[-2])
    assert context["scenes"][0]["scene_causality"] == original["scenes"][0]["scene_causality"]
    assert context["scenes"][1]["scene_causality"] == original["scenes"][1]["scene_causality"]
    assert result.draft.scenes[0].scene_causality == source.scenes[0].scene_causality
    assert result.draft.llm_metadata["script_editor_applied"] is True
    assert source.model_dump(mode="json") == original
    assert adapter.call_count == 1
    patch_schema = LLMScriptEditorialPatch.model_json_schema()
    scene_schema = patch_schema["$defs"]["LLMGeneratedSceneBodyPatch"]
    assert "scene_causality" not in scene_schema["properties"]
    assert scene_schema["additionalProperties"] is False


def test_overseas_editor_uses_release_region_when_model_mislabels_source_language() -> None:
    source = _draft().model_copy(update={"language": "zh-CN"})

    result = ScriptPostEditor(llm_adapter=EditorialPatchAdapter()).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert result.draft.language == "en"
    assert result.draft.scenes[0].dialogues[0].text.startswith("You know exactly")


def test_non_overseas_editor_defers_language_mismatch_without_stopping_generation() -> None:
    adapter = EditorialPatchAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        _draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=False,
    )

    prompt = adapter.prompts[0]
    assert "你现在同时是剧本大师和语言大师" not in prompt
    assert "逐句检查并润色英文对白" not in prompt
    assert "人物名和人物对白直接使用简体中文" in prompt
    assert "采用自然、可表演的短剧口语" in prompt
    assert "25–35句台词必须共同支撑75–115秒真实表演时长" in prompt
    assert result.draft.llm_metadata["script_editor_deferred"] is True
    assert result.draft.llm_metadata["script_editor_deferred_reason"] == (
        "quality_target_not_reached"
    )


def test_gpt_editor_retries_once_then_preserves_an_undersized_episode() -> None:
    adapter = EditorialPatchAdapter(short=True)

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        _draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert adapter.call_count == 2
    assert "本轮是定量补足" in adapter.prompts[0]
    assert "当前整集估算为" in adapter.prompts[0]
    assert result.draft.llm_metadata["script_editor_deferred"] is True
    assert result.draft.llm_metadata["script_editor_deferred_reason"] == (
        "quality_target_not_reached"
    )


def test_gpt_editor_preserves_last_valid_intermediate_pass_during_outage() -> None:
    checkpoints = []
    failing_adapter = UnavailableAfterShortPassAdapter()
    source = _draft()

    result = ScriptPostEditor(llm_adapter=failing_adapter).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
        checkpoint_callback=checkpoints.append,
    )

    assert failing_adapter.call_count == 2
    assert len(checkpoints) == 1
    assert checkpoints[0].completed_attempt_count == 1
    assert result.draft.scenes == checkpoints[0].working_draft.scenes
    assert result.draft.llm_metadata["script_editor_deferred_reason"] == (
        "transient_upstream_failure"
    )


def test_exhausted_editor_checkpoint_becomes_deferred_episode_instead_of_failure() -> None:
    source = _draft()
    checkpoint = ScriptPostEditCheckpoint(
        source_draft_id=source.id,
        working_draft=source,
        correction_issues=[
            "预计时长达到129秒，需要压缩重复动作和无推进对白"
        ],
        completed_attempt_count=3,
        max_attempts=3,
        attempt_elapsed_ms=[45_000, 36_000, 26_000],
        editable_scene_counts=[2, 1, 1],
    )
    adapter = EditorialPatchAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
        resume_checkpoint=checkpoint,
    )

    assert adapter.call_count == 0
    assert result.draft.scenes == source.scenes
    assert result.draft.llm_metadata["script_editor_deferred"] is True
    assert result.draft.llm_metadata["script_editor_deferred_reason"] == (
        "quality_target_not_reached"
    )


def test_editor_partial_patch_keeps_unselected_scenes_byte_for_byte() -> None:
    source = _draft()
    edited_scene = source.scenes[0].model_dump(mode="json")
    edited_scene["dialogues"][0]["text"] = "Tell me who paid for it."
    patch = LLMScriptEditorialPatch.model_validate({
        "scenes": [{
            "scene_number": edited_scene["scene_number"],
            "character_actions": edited_scene["character_actions"],
            "body_order": edited_scene["body_order"],
            "dialogues": edited_scene["dialogues"],
        }],
    })

    candidate = ScriptPostEditor._apply_patch(  # noqa: SLF001
        source,
        patch,
        expected_scene_numbers=[source.scenes[0].scene_number],
    )

    assert candidate.scenes[0].dialogues[0].text == "Tell me who paid for it."
    assert candidate.scenes[1] == source.scenes[1]


def test_gpt_editor_preserves_overlong_near_miss_after_quantified_compression() -> None:
    adapter = EditorialPatchAdapter(overlong=True)

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        _draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert adapter.call_count == 2
    assert "本轮是定量压缩" in adapter.prompts[1]
    assert "必须落到115秒以内" in adapter.prompts[1]
    assert '"continuity_state_updates"' not in adapter.prompts[1]
    assert "You already signed." not in adapter.prompts[1]
    assert adapter.prompts[1].count(
        "You know exactly what this contract costs every person"
    ) == 25
    assert result.duration.total_seconds > 115
    assert result.draft.llm_metadata["script_editor_deferred_reason"] == (
        "quality_target_not_reached"
    )


def test_gpt_editor_carries_forward_a_near_miss_for_one_more_compression_pass() -> None:
    adapter = ProgressiveCompressionAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        _draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert adapter.call_count == 3
    assert "当前待修正文稿估算约" in adapter.prompts[1]
    assert "本轮是定量压缩" in adapter.prompts[1]
    assert "本轮是定量压缩" in adapter.prompts[2]
    assert result.duration.total_seconds <= 115
    assert result.draft.scenes[0].dialogues[0].text == (
        "You know who paid for this contract, Damian."
    )


def test_gpt_editor_hard_compresses_a_far_over_duration_candidate_once() -> None:
    adapter = FarOverDurationCompressionAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        _draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert adapter.call_count == 3
    assert "当前稿件明显超时，本轮是硬压缩而不是润色" in adapter.prompts[2]
    assert result.duration.total_seconds <= 115


def test_gpt_editor_preserves_ready_draft_after_contract_regression() -> None:
    source = _contract_ready_draft()
    adapter = EditorialPatchAdapter(short=True)

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert result.draft.scenes == source.scenes
    assert result.draft.llm_metadata["script_editor_applied"] is False
    assert result.draft.llm_metadata["script_editor_deferred"] is True
    assert result.draft.llm_metadata["script_editor_deferred_reason"] == (
        "contract_regression"
    )
    assert result.draft.llm_metadata["episode_dialogue_line_count"] == 25
    assert result.draft.llm_metadata["episode_shot_unit_count"] == 15
    assert adapter.call_count == 1


def test_gpt_editor_preserves_ready_draft_during_transient_outage() -> None:
    source = _contract_ready_draft()
    adapter = UnavailableEditorialAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert result.draft.scenes == source.scenes
    assert result.draft.llm_metadata["script_editor_deferred_reason"] == (
        "transient_upstream_failure"
    )
    # The editor retries one transient outage before deferring the validated
    # draft, so a provider hiccup does not fail the episode.
    assert adapter.call_count == 2


def test_gpt_editor_accepts_partner_dialogue_markers_for_existing_speakers() -> None:
    result = ScriptPostEditor(
        llm_adapter=EditorialPatchAdapter(marked_speaker=True)
    ).edit(
        _draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert result.draft.scenes[0].dialogues[0].character_name == "Elena (V.O.)"


def test_gpt_editor_preserves_validated_draft_when_it_invents_a_speaker() -> None:
    source = _draft()
    adapter = EditorialPatchAdapter(unknown_speaker=True)

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
        overseas_release=True,
    )

    assert result.draft.scenes == source.scenes
    assert result.draft.llm_metadata["script_editor_applied"] is False
    assert result.draft.llm_metadata["script_editor_deferred"] is True
    assert result.draft.llm_metadata["script_editor_deferred_reason"] == (
        "protected_speaker_boundary"
    )
    assert adapter.call_count == 1
