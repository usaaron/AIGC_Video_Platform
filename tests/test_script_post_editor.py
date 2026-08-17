from __future__ import annotations

from typing import Any

import pytest

from app.modules.master_script.models import (
    CharacterProfile,
    DialogueLine,
    DraftMasterScript,
    DraftSceneCard,
    ScriptTone,
)
from app.modules.script_engine.llm_adapter import LLMAdapter
from app.modules.script_engine.models import GenerationStrategy, LLMModelInfo
from app.modules.script_engine.script_post_editor import (
    InvalidScriptPostEditError,
    ScriptPostEditor,
)


class EditorialPatchAdapter(LLMAdapter):
    def __init__(self, *, short: bool = False, marked_speaker: bool = False) -> None:
        self.short = short
        self.marked_speaker = marked_speaker
        self.call_count = 0

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
        assert "DeepSeek已经完成一集完整初稿" in prompt
        assert "总数只能为1–5个" in prompt
        assert "dialogues合计必须为20–30条" in prompt
        assert "character_actions合计必须为15–20项" in prompt
        assert output_schema is not None
        line = (
            "Stop."
            if self.short
            else "You know exactly what this contract costs us tonight, Damian."
        )
        return {
            "scenes": [
                {
                    "scene_number": scene_number,
                    "character_actions": [
                        f"Action {index} changes the physical balance around the signed contract."
                        for index in range(1, 9 if scene_number == 1 else 8)
                    ],
                    "dialogues": [
                        {
                            "character_name": (
                                f"{speaker} (V.O.)"
                                if self.marked_speaker and speaker == "Elena"
                                else speaker
                            ),
                            "intent": "force the other person to reveal the hidden price",
                            "text": line,
                        }
                        for speaker in ("Elena", "Damian") * 5
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
            setting_hint="A crowded hotel ballroom at night.",
            beat_summary="Damian places the contract between Elena and the exit.",
            emotional_shift="control to suspicion",
            emotional_objective="Keep control without revealing fear.",
            character_actions=["Damian places the contract on the table."],
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
            setting_hint="The corridor outside the ballroom.",
            beat_summary="Elena opens the final page and sees the signature.",
            emotional_shift="suspicion to shock",
            emotional_objective="Learn who placed her in Damian's control.",
            character_actions=["Elena opens the contract to the final page."],
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


def test_gpt_editor_changes_only_scene_bodies_and_records_model_metadata() -> None:
    source = _draft()
    adapter = EditorialPatchAdapter()

    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source,
        strategy=_strategy(),
        target_duration_seconds=90,
    )

    assert 75 <= result.duration.total_seconds <= 115
    assert result.draft.scenes[0].dialogues[0].text != source.scenes[0].dialogues[0].text
    assert result.draft.hook == source.hook
    assert result.draft.characters == source.characters
    assert result.draft.continuity_state_updates == source.continuity_state_updates
    assert result.draft.llm_metadata["script_editor_applied"] is True
    assert result.draft.llm_metadata["script_editor_model"] == "gpt-screenplay-editor"
    assert result.draft.llm_metadata["episode_scene_count"] == 2
    assert result.draft.llm_metadata["episode_dialogue_line_count"] == 20
    assert result.draft.llm_metadata["episode_shot_unit_count"] == 15
    assert adapter.call_count == 1


def test_gpt_editor_retries_once_then_rejects_an_undersized_episode() -> None:
    adapter = EditorialPatchAdapter(short=True)

    with pytest.raises(InvalidScriptPostEditError, match="75–115秒"):
        ScriptPostEditor(llm_adapter=adapter).edit(
            _draft(),
            strategy=_strategy(),
            target_duration_seconds=90,
        )

    assert adapter.call_count == 2


def test_gpt_editor_accepts_partner_dialogue_markers_for_existing_speakers() -> None:
    result = ScriptPostEditor(
        llm_adapter=EditorialPatchAdapter(marked_speaker=True)
    ).edit(
        _draft(),
        strategy=_strategy(),
        target_duration_seconds=90,
    )

    assert result.draft.scenes[0].dialogues[0].character_name == "Elena (V.O.)"
