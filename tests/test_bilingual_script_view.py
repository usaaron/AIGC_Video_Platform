from copy import deepcopy
from threading import Event, Thread

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
        self.prompts: list[str] = []

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        return prompt

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict:
        self.prompts.append(prompt)
        source_payload = prompt.split("SOURCE ITEMS:\n", 1)[1]
        import json

        source_items = json.loads(source_payload)
        american_dialogue = "STABLE CHARACTER NAMES:" in prompt
        chinese_dialogue = "STABLE CHINESE CHARACTER NAMES:" in prompt
        overseas_chinese_presentation = "海外竖屏短剧的中文工作稿编辑" in prompt
        items = [
            {
                "path": item["path"],
                "translated_text": (
                    "LENA HART"
                    if american_dialogue
                    and (
                        item["path"].endswith(".character_name")
                        or (
                            item["path"].startswith("characters.")
                            and item["path"].endswith(".name")
                        )
                    )
                    else (
                        "莉娜"
                        if chinese_dialogue
                        and (
                            item["path"].endswith(".character_name")
                            or (
                                item["path"].startswith("characters.")
                                and item["path"].endswith(".name")
                            )
                        )
                        else (
                            "中文：译文内容"
                            if overseas_chinese_presentation
                            else f"中文：{item['source_text']}"
                        )
                    )
                ),
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


class BlockingTranslationAdapter(TranslationAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.started = Event()
        self.release = Event()

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict:
        self.started.set()
        if not self.release.wait(timeout=2):
            raise RuntimeError("test translation gate was not released")
        return super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
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


def test_bilingual_view_chunks_long_presentations_before_calling_gateway() -> None:
    source = build_draft()
    source.scenes[0].character_actions = [
        f"Lena crosses the laboratory and checks the sealed console {index}. "
        + ("The warning remains visible on the backup screen. " * 5)
        for index in range(24)
    ]
    adapter = TranslationAdapter()
    result = build_service(adapter).build(
        BilingualScriptViewRequest(
            generation_strategy_id=source.generation_strategy_id,
            draft_master_script=source,
        )
    )

    assert len(adapter.prompts) > 1
    assert len(result.items) >= 24
    assert len({item.path for item in result.items}) == len(result.items)
    assert all(len(prompt) < 16_000 for prompt in adapter.prompts)


def test_concurrent_bilingual_view_builds_share_one_gateway_request() -> None:
    source = build_draft()
    request = BilingualScriptViewRequest(
        generation_strategy_id=source.generation_strategy_id,
        draft_master_script=source,
    )
    adapter = BlockingTranslationAdapter()
    service = build_service(adapter)
    results: list[object] = []
    errors: list[BaseException] = []
    second_finished = Event()

    def run_first() -> None:
        try:
            results.append(service.build(request))
        except BaseException as error:  # pragma: no cover - test failure relay
            errors.append(error)

    def run_second() -> None:
        try:
            results.append(service.build(request))
        except BaseException as error:  # pragma: no cover - test failure relay
            errors.append(error)
        finally:
            second_finished.set()

    first = Thread(target=run_first)
    second = Thread(target=run_second)
    first.start()
    assert adapter.started.wait(timeout=1)
    second.start()
    assert not second_finished.wait(timeout=0.05)
    adapter.release.set()
    first.join(timeout=2)
    second.join(timeout=2)

    assert not errors
    assert len(results) == 2
    assert len(adapter.prompts) == 1


def test_american_dialogue_view_only_polishes_speaker_names_and_spoken_lines() -> None:
    source = build_draft().model_copy(update={"language": "zh-CN", "title": "消失的信号"})
    result = build_service(TranslationAdapter()).build(
        BilingualScriptViewRequest(
            generation_strategy_id=source.generation_strategy_id,
            draft_master_script=source,
            target_language="en-US-short-drama",
        )
    )

    paths = {item.path for item in result.items}
    assert paths == {
        "characters.0.name",
        "scenes.0.dialogues.0.character_name",
        "scenes.0.dialogues.0.text",
    }
    assert "hook" not in paths
    assert result.view_version == "bilingual_script_view.v2"
    assert next(
        item.translated_text
        for item in result.items
        if item.path.endswith(".character_name")
    ) == "LENA HART"


def test_american_dialogue_view_reuses_the_project_character_name_map() -> None:
    source = build_draft().model_copy(update={"language": "zh-CN", "title": "消失的信号"})
    source.characters[0].name = "林夏"
    source.scenes[0].dialogues[0].character_name = "林夏"
    result = build_service(TranslationAdapter()).build(
        BilingualScriptViewRequest(
            generation_strategy_id=source.generation_strategy_id,
            draft_master_script=source,
            target_language="en-US-short-drama",
            character_name_map={"林夏": "LENA HART"},
        )
    )

    speaker = next(
        item.translated_text
        for item in result.items
        if item.path.endswith(".character_name")
    )
    assert speaker == "LENA HART"


def test_english_dialogue_view_retains_names_and_translates_spoken_lines_into_chinese() -> None:
    source = build_draft()
    adapter = TranslationAdapter()
    result = build_service(adapter).build(
        BilingualScriptViewRequest(
            generation_strategy_id=source.generation_strategy_id,
            draft_master_script=source,
            target_language="zh-CN-short-drama",
        )
    )

    assert {item.path for item in result.items} == {
        "characters.0.name",
        "scenes.0.dialogues.0.character_name",
        "scenes.0.dialogues.0.text",
    }
    assert result.view_version == "bilingual_script_view.v3"
    dialogue = next(
        item for item in result.items
        if item.path == "scenes.0.dialogues.0.text"
    )
    speaker = next(
        item for item in result.items
        if item.path == "scenes.0.dialogues.0.character_name"
    )
    assert dialogue.source_text == "Show me what you erased."
    assert speaker.translated_text == "Lena"
    assert "你现在是剧本大师和语言大师" in adapter.prompts[0]
    assert "不得改变剧情内容、人物意图、事实、关系、信息量" in adapter.prompts[0]
    assert "partner_screenplay.v1" in adapter.prompts[0]


def test_overseas_english_presentation_translates_narrative_and_dialogue_paths() -> None:
    source = build_draft()
    result = build_service(TranslationAdapter()).build(
        BilingualScriptViewRequest(
            generation_strategy_id=source.generation_strategy_id,
            draft_master_script=source,
            target_language="zh-CN-overseas",
        )
    )

    paths = {item.path for item in result.items}
    assert result.view_version == "bilingual_script_view.v4"
    assert "hook" in paths
    assert "scenes.0.purpose" in paths
    assert "scenes.0.character_actions.0" in paths
    assert "scenes.0.dialogues.0.character_name" in paths
    assert "scenes.0.dialogues.0.text" in paths
    assert next(
        item.translated_text
        for item in result.items
        if item.path == "scenes.0.purpose"
    ).startswith("中文：")


def test_chinese_dialogue_view_merges_legacy_mixed_bilingual_identity_names() -> None:
    source = build_draft()
    source.characters[0].name = "总巡官 CHIEF INSPECTOR"
    source.scenes[0].dialogues[0].character_name = "总巡官"

    result = build_service(TranslationAdapter()).build(
        BilingualScriptViewRequest(
            generation_strategy_id=source.generation_strategy_id,
            draft_master_script=source,
            target_language="zh-CN-short-drama",
            character_name_map={"总巡官": "CHIEF INSPECTOR", "总巡官 CHIEF INSPECTOR": "CHIEF INSPECTOR"},
        )
    )

    character = next(
        item for item in result.items if item.path == "characters.0.name"
    )
    speaker = next(
        item
        for item in result.items
        if item.path == "scenes.0.dialogues.0.character_name"
    )
    assert character.source_text == "总巡官 CHIEF INSPECTOR"
    assert character.translated_text == "CHIEF INSPECTOR"
    assert speaker.translated_text == "CHIEF INSPECTOR"


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
