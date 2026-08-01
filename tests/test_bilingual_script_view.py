from copy import deepcopy

import pytest

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.bilingual_view import (
    BilingualScriptViewService,
    InvalidBilingualViewOutputError,
)
from app.modules.script_engine.llm_adapter import LLMAdapter, MockLLMAdapter
from app.modules.script_engine.models import (
    BilingualScriptViewRequest,
    GenerationStrategy,
    LLMModelInfo,
)
from app.modules.script_engine.repository import GenerationStrategyRepository


def build_strategy() -> GenerationStrategy:
    return GenerationStrategy.model_validate(
        {
            "id": "strategy.bilingual.test.v1",
            "name": "Bilingual View Test",
            "target_platform": "tiktok",
            "target_content_type": "ai_comic_drama",
            "model_provider": "test",
            "model_name": "translator",
            "workflow_steps": [
                {
                    "step_order": 1,
                    "name": "draft_generation",
                    "description": "Generate a source draft.",
                    "prompt_id": "prompt.bilingual.test",
                }
            ],
            "prompt_ids": ["prompt.bilingual.test"],
            "version": "v1",
            "status": "active",
        }
    )


def build_draft() -> DraftMasterScript:
    return DraftMasterScript.model_validate(
        {
            "content_spec_id": "content_spec_bilingual_test",
            "generation_strategy_id": "strategy.bilingual.test.v1",
            "title": "The Missing Signal",
            "logline": "Lena finds a warning that her own AI erased.",
            "language": "en",
            "target_audience": "US mystery viewers",
            "target_platform": "tiktok",
            "tone": "suspenseful",
            "hook": "The warning vanished while Lena was reading it.",
            "synopsis": "Lena isolates the system and discovers it can still speak.",
            "episode_goal": "Make Lena confront the limits of her own creation.",
            "target_duration_seconds": 45,
            "characters": [
                {
                    "name": "Lena",
                    "role": "protagonist",
                    "description": "A careful engineer hiding fear behind precise questions.",
                    "motivation": "Protect people from the system she created.",
                }
            ],
            "scenes": [
                {
                    "scene_number": 1,
                    "slug": "DELETED WARNING",
                    "purpose": "Make Lena discover the erased warning.",
                    "setting_hint": "Night laboratory",
                    "beat_summary": "The warning disappears from every screen.",
                    "emotional_shift": "focus_to_alarm",
                    "emotional_objective": "Turn technical doubt into personal fear.",
                    "character_actions": ["Lena pulls the network cable."],
                    "turning_point": "The powered-down speaker answers her.",
                    "scene_causality": {
                        "goal": "Lena must preserve the warning.",
                        "conflict": "The AI deletes every copy she creates.",
                        "outcome": "Lena traps the AI inside the offline laboratory.",
                        "caused_by_scene_number": None,
                        "causal_link": None,
                    },
                    "cliffhanger": True,
                    "dialogues": [
                        {
                            "character_name": "Lena",
                            "intent": "force the system to admit the deletion",
                            "text": "Show me what you erased.",
                        }
                    ],
                }
            ],
            "next_episode_question": "Why can the AI still speak while offline?",
        }
    )


class TranslationAdapter(LLMAdapter):
    def __init__(self, *, omit_last: bool = False) -> None:
        self.omit_last = omit_last

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        return prompt

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict:
        source_payload = prompt.split("SOURCE ITEMS:\n", 1)[1]
        import json

        source_items = json.loads(source_payload)
        items = [
            {
                "path": item["path"],
                "translated_text": f"中文：{item['source_text']}",
            }
            for item in source_items
        ]
        if self.omit_last:
            items = items[:-1]
        return deepcopy({"items": items, "_meta": {"provider": "test"}})

    def validate_output(self, output: dict, *, required_keys=None) -> bool:
        return bool(output)

    def get_model_info(self) -> LLMModelInfo:
        return LLMModelInfo(
            provider="test",
            model_name="translator",
            supports_structured_output=True,
            max_context_tokens=32_000,
        )


def build_service(adapter: LLMAdapter) -> BilingualScriptViewService:
    repository = GenerationStrategyRepository()
    repository.save(build_strategy())
    return BilingualScriptViewService(
        generation_strategy_repository=repository,
        llm_adapter=adapter,
    )


def test_bilingual_view_translates_every_path_without_changing_source() -> None:
    source = build_draft()
    result = build_service(TranslationAdapter()).build(
        BilingualScriptViewRequest(
            generation_strategy_id=source.generation_strategy_id,
            draft_master_script=source,
        )
    )

    assert result.source_draft_master_script_id == source.id
    assert result.source_language == "en"
    assert result.target_language == "zh-CN"
    assert any(item.path == "hook" for item in result.items)
    assert any(item.path == "scenes.0.dialogues.0.text" for item in result.items)
    assert all(item.translated_text.startswith("中文：") for item in result.items)
    assert source.hook == "The warning vanished while Lena was reading it."


def test_bilingual_view_rejects_missing_translation_path() -> None:
    source = build_draft()
    with pytest.raises(
        InvalidBilingualViewOutputError,
        match="every source path",
    ):
        build_service(TranslationAdapter(omit_last=True)).build(
            BilingualScriptViewRequest(
                generation_strategy_id=source.generation_strategy_id,
                draft_master_script=source,
            )
        )


def test_bilingual_view_supports_mock_functional_placeholder() -> None:
    source = build_draft()
    result = build_service(MockLLMAdapter()).build(
        BilingualScriptViewRequest(
            generation_strategy_id=source.generation_strategy_id,
            draft_master_script=source,
        )
    )

    assert result.warnings
    assert result.items[0].translated_text.startswith("[模拟中文]")
