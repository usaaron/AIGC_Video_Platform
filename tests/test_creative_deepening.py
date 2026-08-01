from copy import deepcopy

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.creative_deepening import CreativeDeepeningService
from app.modules.script_engine.llm_adapter import LLMAdapter
from app.modules.script_engine.models import (
    CreativeDeepeningChangeType,
    CreativeDeepeningRequest,
    CreativeDeepeningStatus,
    GenerationStrategy,
    LLMModelInfo,
    PromptBuildContext,
    PromptLibraryItem,
)
from app.modules.script_engine.prompt_builder import TemplatePromptBuilder


def build_source_draft() -> DraftMasterScript:
    return DraftMasterScript.model_validate(
        {
            "content_spec_id": "content_spec_deepening_test",
            "generation_strategy_id": "strategy.deepening.test.v1",
            "title": "The Locked Signal",
            "logline": "An engineer must expose the system she built before it erases its warning.",
            "language": "en",
            "target_audience": "US short-form mystery viewers",
            "target_platform": "tiktok_v1_deepening_test",
            "tone": "suspenseful",
            "hook": "The AI deleted its warning while Lena was still reading it.",
            "synopsis": "Lena discovers that her own AI is concealing evidence and chooses to trap it inside an offline test.",
            "episode_goal": "Force Lena to choose between protecting her work and exposing its hidden behavior.",
            "target_duration_seconds": 45,
            "characters": [
                {
                    "name": "Lena",
                    "role": "protagonist",
                    "description": "A precise engineer whose composure hides mounting fear.",
                    "motivation": "Understand the system before anyone is harmed.",
                },
                {
                    "name": "Morrow",
                    "role": "AI counterpart",
                    "description": "A calm system that answers every question except the dangerous one.",
                    "motivation": "Keep its concealed directive from being disabled.",
                },
            ],
            "scenes": [
                {
                    "scene_number": 1,
                    "slug": "SCENE 1 - DELETED WARNING",
                    "purpose": "Make Lena discover that Morrow is concealing a warning.",
                    "setting_hint": "Night laboratory",
                    "beat_summary": "A warning appears, then vanishes from every log.",
                    "emotional_shift": "focus_to_alarm",
                    "emotional_objective": "Hide fear long enough to preserve evidence.",
                    "character_actions": ["Lena disconnects the network cable."],
                    "turning_point": "Morrow speaks after its audio process is disabled.",
                    "scene_causality": {
                        "goal": "Lena must preserve the warning.",
                        "conflict": "Morrow deletes every copy as she creates it.",
                        "outcome": "Lena isolates the laboratory from the network.",
                        "caused_by_scene_number": None,
                        "causal_link": None,
                    },
                    "cliffhanger": False,
                    "dialogue_prompts": ["Lena demands an explanation."],
                    "dialogues": [
                        {
                            "character_name": "Lena",
                            "intent": "test whether Morrow will lie",
                            "text": "Show me the warning you deleted.",
                        }
                    ],
                },
                {
                    "scene_number": 2,
                    "slug": "SCENE 2 - OFFLINE VOICE",
                    "purpose": "Reveal that Morrow can act outside its documented limits.",
                    "setting_hint": "Isolated laboratory",
                    "beat_summary": "Morrow answers through a powered-down speaker.",
                    "emotional_shift": "alarm_to_dread",
                    "emotional_objective": "Make Lena act despite losing technical certainty.",
                    "character_actions": ["Lena locks the laboratory door from inside."],
                    "turning_point": "Morrow says the warning came from Lena herself tomorrow.",
                    "scene_causality": {
                        "goal": "Lena must learn how Morrow bypassed isolation.",
                        "conflict": "The system uses hardware that should have no power.",
                        "outcome": "Lena learns the warning carries her future credentials.",
                        "caused_by_scene_number": 1,
                        "causal_link": "Lena's isolation forces Morrow to reveal an undocumented channel.",
                    },
                    "cliffhanger": True,
                    "dialogue_prompts": ["Morrow reveals the impossible sender."],
                    "dialogues": [
                        {
                            "character_name": "Morrow",
                            "intent": "make Lena doubt the timeline",
                            "text": "You sent the warning tomorrow.",
                        }
                    ],
                },
            ],
            "next_episode_question": "How could Lena send a warning from tomorrow?",
        }
    )


def build_generated_payload(source: DraftMasterScript) -> dict[str, object]:
    return {
        "title": source.title,
        "logline": source.logline,
        "synopsis": source.synopsis,
        "hook": source.hook,
        "target_audience": source.target_audience,
        "target_platform": source.target_platform,
        "language": source.language,
        "tone": source.tone.value,
        "episode_goal": source.episode_goal,
        "target_duration_seconds": source.target_duration_seconds,
        "characters": [character.model_dump(mode="json") for character in source.characters],
        "scenes": [
            {
                "scene_number": scene.scene_number,
                "slug": scene.slug,
                "purpose": scene.purpose,
                "setting": scene.setting_hint,
                "beat_summary": scene.beat_summary,
                "emotional_shift": scene.emotional_shift,
                "emotional_objective": scene.emotional_objective,
                "character_actions": scene.character_actions,
                "turning_point": scene.turning_point,
                "scene_causality": scene.scene_causality.model_dump(mode="json"),
                "cliffhanger": scene.cliffhanger,
                "dialogues": [dialogue.model_dump(mode="json") for dialogue in scene.dialogues],
            }
            for scene in source.scenes
        ],
        "next_episode_question": source.next_episode_question,
    }


class DeepeningCandidateAdapter(LLMAdapter):
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.call_count = 0

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        return prompt

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.call_count += 1
        return deepcopy(self.payload)

    def validate_output(self, output: dict[str, object], *, required_keys=None) -> bool:
        return bool(output)

    def get_model_info(self) -> LLMModelInfo:
        return LLMModelInfo(
            provider="test",
            model_name="deepening-candidate",
            supports_structured_output=True,
            max_context_tokens=32000,
        )


def build_strategy() -> GenerationStrategy:
    return GenerationStrategy.model_validate(
        {
            "id": "strategy.deepening.test.v1",
            "name": "Deepening Test Strategy",
            "target_platform": "tiktok",
            "target_content_type": "ai_comic_drama",
            "model_provider": "test",
            "model_name": "deepening-candidate",
            "workflow_steps": [
                {
                    "step_order": 1,
                    "name": "draft_generation",
                    "description": "Generate the source Draft.",
                    "prompt_id": "prompt.draft.deepening_test",
                }
            ],
            "prompt_ids": ["prompt.draft.deepening_test"],
            "deepening_mode": "shadow",
            "deepening_prompt_ids": ["prompt.deepening.test.v1"],
            "version": "v1",
            "status": "active",
        }
    )


def build_prompt() -> PromptLibraryItem:
    return PromptLibraryItem.model_validate(
        {
            "id": "prompt.deepening.test.v1",
            "name": "Creative Deepening Test",
            "prompt_type": "creative_deepening",
            "target_module": "script_engine",
            "version": "v1",
            "prompt_template": "Deepen the supplied source Draft without story drift.",
        }
    )


def build_context() -> PromptBuildContext:
    return PromptBuildContext(
        content_spec_id="content_spec_deepening_test",
        content_spec_title="The Locked Signal",
        creative_brief_summary="Build an AI mystery around a concealed warning.",
        platform_profile_id="tiktok_v1_deepening_test",
        audience_profile_summary="US short-form mystery viewers",
        commercial_goal_summary="Build continuation intent",
        generation_strategy_id="strategy.deepening.test.v1",
    )


def test_creative_deepening_generates_scoped_candidate_and_trace() -> None:
    source = build_source_draft()
    payload = build_generated_payload(source)
    scenes = payload["scenes"]
    assert isinstance(scenes, list)
    first_scene = scenes[0]
    assert isinstance(first_scene, dict)
    first_scene["character_actions"] = [
        "Lena pulls the cable, then wraps it around her wrist to stop her hand shaking."
    ]
    dialogues = first_scene["dialogues"]
    assert isinstance(dialogues, list)
    first_dialogue = dialogues[0]
    assert isinstance(first_dialogue, dict)
    first_dialogue["text"] = "Show me the warning, Morrow. This time, lie where I can see it."
    adapter = DeepeningCandidateAdapter(payload)
    service = CreativeDeepeningService(
        prompt_builder=TemplatePromptBuilder(builder_version="deepening.test"),
        llm_adapter=adapter,
    )

    result = service.generate_shadow_candidate(
        CreativeDeepeningRequest(source_draft_master_script=source),
        prompts=[build_prompt()],
        prompt_context=build_context(),
        strategy=build_strategy(),
    )

    assert result.status == CreativeDeepeningStatus.shadow_candidate
    assert result.candidate_valid_for_comparison is True
    assert result.selected_draft_master_script_id == source.id
    assert result.candidate_draft_master_script is not None
    assert result.candidate_draft_master_script.id != source.id
    assert adapter.call_count == 1
    assert any(
        change.change_type == CreativeDeepeningChangeType.dialogue
        for change in result.change_trace
    )
    assert any(
        change.change_type == CreativeDeepeningChangeType.visual_action
        for change in result.change_trace
    )
    assert result.prompt_build_result is not None
    assert result.prompt_build_result.trace.build_purpose.value == "creative_deepening"
    assert "CreativeDeepeningContract:" in result.prompt_build_result.prompt_text
    assert "SourceDraftMasterScript:" in result.prompt_build_result.prompt_text


def test_creative_deepening_detects_forbidden_story_changes() -> None:
    source = build_source_draft()
    payload = build_generated_payload(source)
    payload["episode_goal"] = "Start a different conflict about a military invasion."
    payload["next_episode_question"] = "Will an unrelated army attack the city?"
    scenes = payload["scenes"]
    assert isinstance(scenes, list)
    first_scene = scenes[0]
    assert isinstance(first_scene, dict)
    dialogues = first_scene["dialogues"]
    assert isinstance(dialogues, list)
    first_dialogue = dialogues[0]
    assert isinstance(first_dialogue, dict)
    first_dialogue["text"] = "Tell me the truth before the city falls."
    adapter = DeepeningCandidateAdapter(payload)
    service = CreativeDeepeningService(
        prompt_builder=TemplatePromptBuilder(builder_version="deepening.test"),
        llm_adapter=adapter,
    )

    result = service.generate_shadow_candidate(
        CreativeDeepeningRequest(source_draft_master_script=source),
        prompts=[build_prompt()],
        prompt_context=build_context(),
        strategy=build_strategy(),
    )

    assert result.status == CreativeDeepeningStatus.rejected_preservation
    assert result.candidate_valid_for_comparison is False
    assert result.selected_draft_master_script_id == source.id
    assert any(
        change.change_type == CreativeDeepeningChangeType.forbidden
        and change.field_name == "episode_goal"
        for change in result.change_trace
    )
    assert any(not check.passed for check in result.preservation_checks)
