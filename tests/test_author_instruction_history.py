"""Persisted author intent reaches existing adapters; no external model is called."""

from copy import deepcopy
import hashlib
import json
from pathlib import Path

from httpx import ASGITransport, AsyncClient
import pytest
from pydantic import ValidationError

from app.dependencies import get_script_generation_service
from app.main import create_app
from app.modules.script_engine.author_conflict_models import AuthorConflictResolution
from app.modules.script_engine.author_conflicts import (
    AuthorConflictResolutionError,
    source_fingerprint,
    source_packet,
)
from app.modules.script_engine.author_instructions import (
    AUTHOR_INSTRUCTION_HISTORY_CONTRACT,
    effective_modification_instruction,
)
from app.modules.script_engine.generation_service import InvalidDraftMasterScriptOutputError
from app.modules.script_engine.llm_adapter import MockLLMAdapter
from app.modules.script_engine.models import (
    EpisodeGenerationContext,
    ScriptDraftModificationRequest,
    ScriptGenerationDraftRequest,
)
from tests.test_script_generation_service import seed_dependencies
from tests.test_short_drama_request_contract import CaptureAdapter, RequestCaptured, _ready_plan


class IntentReviewAdapter(MockLLMAdapter):
    def __init__(self):
        super().__init__()
        self.prompts = []
        self.output = {
            "user_goal": "保留作者要求，修正本集表达。",
            "rewrite_scope": "preserve_unaffected_text",
            "conflicts": [], "options": [],
        }

    def generate_structured_output(self, prompt, *, strategy, output_schema=None):
        assert output_schema["title"] == "AuthorConflictAssessment"
        self.prompts.append(prompt)
        return deepcopy(self.output)


@pytest.fixture
def history_case():
    review = IntentReviewAdapter()
    service, spec_id = seed_dependencies(author_conflict_llm_adapter=review)
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en", desired_scene_count=1,
    ))
    turns = json.loads((Path(__file__).parent / "fixtures/overseas-episode-seven-author-instructions.json").read_text())
    request = ScriptDraftModificationRequest(
        source_generation_run=source, source_draft_master_script=source.draft_master_script,
        instruction=turns["current"],
        prior_author_instructions=[{"id": "author.ep7.first", "instruction": turns["prior"]}],
    )
    return service, request, review


@pytest.mark.parametrize("path", ["full", "compact", "targeted"])
def test_real_ep7_prior_requirements_reach_review_and_every_existing_writer(history_case, path):
    service, request, review = history_case
    if path == "compact":
        context = EpisodeGenerationContext(
            generation_mode="sequential", episode_number=7, total_episodes=10,
            approved_episode_plan=_ready_plan().model_copy(update={"episode_number": 7}),
        )
        request = request.model_copy(update={
            "source_generation_run": request.source_generation_run.model_copy(update={"episode_context": context}),
        })
    elif path == "targeted":
        request = ScriptDraftModificationRequest.model_validate({
            **request.model_dump(),
            "selection_context": {"source_field": "本集钩子（hook）", "selected_text": request.source_draft_master_script.hook},
        })
    writer = CaptureAdapter()
    service._conversation_editor_llm_adapter = writer
    original = request.model_dump()
    with pytest.raises(RequestCaptured):
        service.modify_draft(request)
    assert len(review.prompts) == len(writer.prompts) == 1
    review_input = json.loads(review.prompts[0].split("输入：\n", 1)[1])
    effective = effective_modification_instruction(request)
    assert review_input["instruction"] == effective
    # Non-compact templates may serialize this value as a JSON string too.
    prompt = writer.prompts[0]
    assert effective in prompt or json.dumps(effective, ensure_ascii=False) in prompt
    for marker in ["Watch my sticks", "You're letting Sam call it, Lena?", "where按处所准确翻译", "不要先抬手叫停再收回"]:
        assert marker in prompt
    assert "放弃候选只表示不采用该文本" in prompt
    assert "当前明确修改与旧要求冲突的部分以当前要求为准" in prompt
    assert ("紧凑写作包" in prompt) == (path == "compact")
    assert ("TARGETED SCREENPLAY TEXT REVISION" in prompt) == (path == "targeted")
    assert request.model_dump() == original


def test_history_keeps_order_original_quotes_and_latest_replacement_without_promoting_facts(history_case):
    _, request, _ = history_case
    data = request.model_dump()
    data["prior_author_instructions"] = [
        {"id": "first", "instruction": "保留七分钟，别新增别的时间。", "selection_context": {
            "source_field": "scenes.0.dialogues.24.text", "selected_text": "Seven minutes.",
        }},
        {"id": "second", "instruction": "歌词的where保留处所意思。"},
    ]
    data["instruction"] = "时间明确改为六分钟，其他要求沿用。"
    request = ScriptDraftModificationRequest.model_validate(data)
    intent = effective_modification_instruction(request)
    assert intent.index("保留七分钟") < intent.index("歌词的where") < intent.index(request.instruction)
    assert '"selected_text":"Seven minutes."' in intent
    assert "其路径不保证仍指向当前稿同一内容" in intent
    assert "它们是修改意图，不是已发生的剧情" in intent
    assert intent.endswith(request.instruction)


def test_absent_and_empty_history_keep_legacy_prompt_and_fingerprint(history_case):
    _, request, _ = history_case
    raw = request.model_dump()
    raw.pop("prior_author_instructions")
    absent = ScriptDraftModificationRequest.model_validate(raw)
    empty = ScriptDraftModificationRequest.model_validate({**raw, "prior_author_instructions": []})
    assert effective_modification_instruction(absent) == absent.instruction
    assert AUTHOR_INSTRUCTION_HISTORY_CONTRACT not in effective_modification_instruction(empty)
    legacy_packet = source_packet(absent)
    assert "prior_author_instructions" not in legacy_packet
    legacy_hash = hashlib.sha256(json.dumps(
        legacy_packet, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    assert source_fingerprint(absent) == source_fingerprint(empty) == legacy_hash
    assert source_fingerprint(request) != legacy_hash


def _make_conflict(review, request):
    review.output.update(
        conflicts=[{
            "source_ref": "source_draft_master_script.synopsis",
            "established_fact": request.source_draft_master_script.synopsis,
            "requested_change": "作者要求改变本集表达。",
            "impact": "需要衔接以保持原有因果。",
        }],
        options=[{
            "option_id": "bridge.existing", "kind": "bridge", "title": "保留既有事实落实表达",
            "plan": "只调整本集表达并保留既有因果。", "impact": "只影响本集表达，不新增过去事件。",
        }],
    )


@pytest.mark.parametrize("change", ["text", "order", "selection", "withdrawal"])
def test_history_changes_invalidate_stored_confirmation_without_another_model_call(history_case, change):
    service, request, review_adapter = history_case
    data = request.model_dump()
    data["prior_author_instructions"].append({"id": "second", "instruction": "不要提前开始完整录音。"})
    request = ScriptDraftModificationRequest.model_validate(data)
    _make_conflict(review_adapter, request)
    review = service.modify_draft(request).conflict_review
    assert review is not None
    data = request.model_dump()
    if change == "text":
        data["prior_author_instructions"][0]["instruction"] = "更换此前的一条明确作者要求。"
    elif change == "order":
        data["prior_author_instructions"].reverse()
    elif change == "selection":
        data["prior_author_instructions"][0]["selection_context"] = {"source_field": "hook", "selected_text": "Changed scope"}
    else:
        data["prior_author_instructions"].pop()
    data["resolution"] = AuthorConflictResolution(review=review, option_id="bridge.existing").model_dump()
    with pytest.raises(AuthorConflictResolutionError, match="重新检查影响"):
        service.modify_draft(ScriptDraftModificationRequest.model_validate(data))
    assert len(review_adapter.prompts) == 1


def test_history_is_never_accepted_as_canonical_conflict_evidence(history_case):
    service, request, review = history_case
    _make_conflict(review, request)
    review.output["conflicts"][0].update(
        source_ref="prior_author_instructions.0.instruction",
        established_fact=request.prior_author_instructions[0].instruction[:100],
    )
    with pytest.raises(InvalidDraftMasterScriptOutputError, match="可核对"):
        service.modify_draft(request)


def test_unchanged_history_confirmation_uses_original_review_and_returns_current_instruction(history_case):
    service, request, review_adapter = history_case
    _make_conflict(review_adapter, request)
    review = service.modify_draft(request).conflict_review
    resolved = request.model_copy(update={
        "resolution": AuthorConflictResolution(review=review, option_id="bridge.existing"),
    })
    before = resolved.model_dump()
    result = service.modify_draft(resolved)
    assert len(review_adapter.prompts) == 1
    assert result.candidate_generation_run is not None
    assert result.instruction == request.instruction
    prompt = result.candidate_generation_run.prompt_build_result.prompt_text
    effective = effective_modification_instruction(request)
    assert effective in prompt or json.dumps(effective, ensure_ascii=False) in prompt
    assert resolved.model_dump() == before


def test_targeted_handoff_retains_history_without_repeating_impact_review(history_case):
    service, request, review = history_case
    request = ScriptDraftModificationRequest.model_validate({
        **request.model_dump(),
        "selection_context": {"source_field": "本集钩子（hook）", "selected_text": request.source_draft_master_script.hook},
    })

    class HandoffAdapter(CaptureAdapter):
        def generate_structured_output(self, prompt, **kwargs):
            self.prompts.append(prompt)
            if len(self.prompts) == 1:
                return {
                    "requires_full_episode_rewrite": True,
                    "reason": "Prior active requirements also change other dialogue and exit ledgers.",
                    "replacement_text": None, "updated_chinese_translation": None,
                }
            raise RequestCaptured()

    writer = HandoffAdapter()
    service._conversation_editor_llm_adapter = writer
    before = request.model_dump()
    with pytest.raises(RequestCaptured):
        service.modify_draft(request)
    assert len(review.prompts) == 1
    assert len(writer.prompts) == 2
    assert "TARGETED SCREENPLAY TEXT REVISION" in writer.prompts[0]
    assert "TARGETED SCREENPLAY TEXT REVISION" not in writer.prompts[1]
    effective = effective_modification_instruction(request)
    for prompt in writer.prompts:
        assert effective in prompt or json.dumps(effective, ensure_ascii=False) in prompt
    assert request.model_dump() == before


@pytest.mark.parametrize("invalid", ["duplicate", "count", "single_length", "budget", "selection_budget", "assistant"])
def test_history_bounds_reject_whole_request_without_silent_truncation(history_case, invalid):
    _, request, _ = history_case
    data = request.model_dump()
    if invalid == "duplicate":
        data["prior_author_instructions"] *= 2
    elif invalid == "count":
        data["prior_author_instructions"] = [{"id": str(i), "instruction": "保留事实。"} for i in range(33)]
    elif invalid == "single_length":
        data["prior_author_instructions"][0]["instruction"] = "修" * 4001
    elif invalid == "budget":
        data["prior_author_instructions"] = [{"id": str(i), "instruction": "修" * 4000} for i in range(8)]
    elif invalid == "selection_budget":
        data["prior_author_instructions"] = [{"id": str(i), "instruction": "保留事实。", "selection_context": {
            "source_field": "hook", "selected_text": "原" * 4000,
        }} for i in range(8)]
    else:
        data["prior_author_instructions"][0]["role"] = "assistant"
    with pytest.raises(ValidationError):
        ScriptDraftModificationRequest.model_validate(data)


def test_total_character_boundary_is_exact_and_lossless(history_case):
    _, request, _ = history_case
    data = request.model_dump()
    data["instruction"] = "当" * 4000
    data["prior_author_instructions"] = [{"id": str(i), "instruction": "旧" * 4000} for i in range(7)]
    boundary = ScriptDraftModificationRequest.model_validate(data)
    assert sum(len(item.instruction) for item in boundary.prior_author_instructions) + len(boundary.instruction) == 32000
    assert boundary.model_dump()["prior_author_instructions"] == [
        {**item, "selection_context": None} for item in data["prior_author_instructions"]
    ]
    data["selection_context"] = {"source_field": "h", "selected_text": "x"}
    with pytest.raises(ValidationError, match="Nothing was truncated"):
        ScriptDraftModificationRequest.model_validate(data)


@pytest.mark.anyio
async def test_api_carries_history_and_rejects_overflow_before_review(history_case):
    service, request, review = history_case
    _make_conflict(review, request)
    app = create_app()
    app.dependency_overrides[get_script_generation_service] = lambda: service
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/script-generation/modify-draft", json=request.model_dump(mode="json"))
        assert response.status_code == 200
        assert response.json()["data"]["instruction"] == request.instruction
        packet = json.loads(review.prompts[0].split("输入：\n", 1)[1])
        assert packet["instruction"] == effective_modification_instruction(request)
        bad = request.model_dump(mode="json")
        bad["prior_author_instructions"] = [{"id": str(i), "instruction": "修" * 4000} for i in range(8)]
        response = await client.post("/script-generation/modify-draft", json=bad)
        assert response.status_code == 422
        assert "Nothing was truncated" in response.text
        assert len(review.prompts) == 1
