from copy import deepcopy
import threading

import pytest
from pydantic import ValidationError

from app.modules.script_engine import draft_contract, draft_recovery
from app.modules.script_engine.generation_service import InvalidDraftMasterScriptOutputError, ScriptGenerationService
from app.modules.script_engine.llm_adapter import (
    LLMRequestCancelledError,
    LLMRequestError,
    LLMStructuredOutputError,
    MockLLMAdapter,
)
from app.modules.script_engine.llm_deadline import DeadlineExceeded
from app.modules.script_engine.models import GenerationStrategy
from tests.test_llm_adapter import build_strategy
from tests.test_script_generation_service import _mainland_single_scene_payload, seed_dependencies


class RecordingAdapter(MockLLMAdapter):
    def __init__(self, stream_error=None, recovery_error=None):
        self.stream_error = stream_error
        self.recovery_error = recovery_error
        self.calls = []

    def generate_structured_output_stream(self, prompt, *, strategy, output_schema=None, on_delta=None):
        self.calls.append(("stream", prompt, strategy, output_schema))
        if on_delta is not None:
            on_delta('{"title":', False)
        if self.stream_error is not None:
            raise self.stream_error
        return {"title": "A complete response"}

    def generate_structured_output(self, prompt, *, strategy, output_schema=None):
        self.calls.append(("non_stream", prompt, strategy, output_schema))
        if self.recovery_error is not None:
            raise self.recovery_error
        return {"title": "A complete response"}


def _request_error(category="transport", **attributes):
    error = LLMRequestError("Injected failure", category=category, recoverable=True)
    for name, value in attributes.items():
        setattr(error, name, value)
    return error


def _structured_error(**attributes):
    error = LLMStructuredOutputError("Invalid JSON", raw_content="{partial")
    for name, value in attributes.items():
        setattr(error, name, value)
    return error


def _generate(adapter, *, callback=None, single=False):
    return draft_recovery.generate_postprocess_output(
        adapter=adapter, prompt="Return the repaired JSON.",
        strategy=GenerationStrategy.model_validate(build_strategy()),
        output_schema={"type": "object"}, phase="acceptance_repair",
        progress_callback=callback, single_non_stream_attempt=single,
    )


@pytest.mark.parametrize("error", [
    _structured_error(stream_fallback_attempted=True),
    _structured_error(empty_response_retry_attempted=True),
    _request_error("failover_exhausted"),
    _request_error("script_generation_routes_exhausted"),
    _request_error(stream_fallback_attempted=True),
    _request_error("empty_response", stream_termination="max_output_tokens"),
    _request_error(route_failure_categories=("timeout", "transport")),
    _request_error("deadline", recoverable=False),
    _request_error("authentication", recoverable=False),
    LLMRequestCancelledError(),
    DeadlineExceeded("workflow"),
])
def test_terminal_or_adapter_exhausted_stream_failure_has_no_extra_request(error):
    adapter = RecordingAdapter(stream_error=error)
    with pytest.raises(type(error)) as failure:
        _generate(adapter)
    assert failure.value is error
    assert [call[0] for call in adapter.calls] == ["stream"]


@pytest.mark.parametrize("error", [
    _structured_error(),
    _request_error(),
    _request_error("empty_response"),
])
def test_recoverable_stream_failure_allows_exactly_one_non_stream_attempt(error):
    adapter = RecordingAdapter(stream_error=error)
    events = []
    result = _generate(adapter, callback=lambda event, payload: events.append((event, payload)))
    assert result == {"title": "A complete response"}
    assert [call[0] for call in adapter.calls] == ["stream", "non_stream"]
    assert adapter.calls[0][1] == "Return the repaired JSON."
    assert adapter.calls[1][1].startswith("Return the repaired JSON.\n\nThe previous post-processing transport")
    assert adapter.calls[0][2:] == adapter.calls[1][2:]
    assert events == [("draft_delta", {"delta": '{"title":', "reset": False, "phase": "acceptance_repair"})]


@pytest.mark.parametrize("single,expected_kind", [(False, "stream"), (True, "non_stream")])
def test_success_never_adds_another_request(single, expected_kind):
    adapter = RecordingAdapter()
    _generate(adapter, single=single)
    assert [call[0] for call in adapter.calls] == [expected_kind]


@pytest.mark.parametrize("single", [False, True])
def test_empty_recovery_preserves_single_attempt_mode_and_exception_cause(single):
    final_error = _structured_error(raw_content="", empty_response=True)
    adapter = RecordingAdapter(stream_error=_structured_error(), recovery_error=final_error)
    expected_error = LLMStructuredOutputError if single else LLMRequestError
    with pytest.raises(expected_error) as failure:
        _generate(adapter, single=single)
    if single:
        assert failure.value is final_error
    else:
        assert failure.value.category == "empty_response"
        assert failure.value.recoverable is True
        assert failure.value.__cause__ is final_error
    assert len(adapter.calls) == (1 if single else 2)


def test_nonempty_semantic_json_failure_is_not_reclassified_as_transport_failure():
    final_error = _structured_error(stream_termination="length")
    adapter = RecordingAdapter(stream_error=_structured_error(), recovery_error=final_error)
    with pytest.raises(LLMStructuredOutputError) as failure:
        _generate(adapter)
    assert failure.value is final_error
    assert len(adapter.calls) == 2


@pytest.fixture
def checkpoint_case():
    service, _ = seed_dependencies()
    output = service._normalize_mechanical_draft_contract(
        _mainland_single_scene_payload(action="林夏把证物箱拖到灯下。")
    )
    output.setdefault("_meta", {})["provider"] = "original"
    return service, output


@pytest.mark.parametrize("error", [
    _request_error(), _structured_error(), InvalidDraftMasterScriptOutputError("Invalid candidate"),
])
def test_failed_mutating_operation_restores_isolated_checkpoint(checkpoint_case, error):
    service, output = checkpoint_case
    before = deepcopy(output)
    calls = []

    def operation(candidate):
        calls.append(candidate)
        candidate["scenes"][0]["character_actions"].clear()
        candidate["_meta"]["provider"] = "failed-candidate"
        raise error

    result = service._run_valid_draft_postprocess_stage(output=output, phase="repair", operation=operation)
    assert len(calls) == 1
    assert output == before
    assert result is not output
    assert result["scenes"] == before["scenes"]
    assert result["_meta"]["provider"] == "original"
    assert result["_meta"]["deferred_postprocess_phases"] == ["repair"]
    assert len(result["_meta"]["deferred_postprocess_diagnostics"]) == 1


@pytest.mark.parametrize("error", [
    _request_error("deadline", recoverable=False),
    _request_error("authentication", recoverable=False),
    DeadlineExceeded("workflow"), LLMRequestCancelledError(), RuntimeError("Unexpected bug"),
])
def test_fatal_errors_propagate_without_returning_a_preserved_success(checkpoint_case, error):
    service, output = checkpoint_case
    before = deepcopy(output)

    def operation(_):
        raise error

    with pytest.raises(type(error)) as failure:
        service._run_valid_draft_postprocess_stage(output=output, phase="repair", operation=operation)
    assert failure.value is error
    assert output == before


@pytest.mark.parametrize("error", [
    None, _request_error(), _structured_error(), InvalidDraftMasterScriptOutputError("Invalid candidate"),
])
def test_cancellation_during_operation_never_returns_a_candidate_or_checkpoint(checkpoint_case, error):
    service, output = checkpoint_case
    before = deepcopy(output)
    cancel = threading.Event()

    def operation(candidate):
        cancel.set()
        if error is not None:
            raise error
        return candidate

    with pytest.raises(LLMRequestCancelledError):
        service._run_valid_draft_postprocess_stage(
            output=output, phase="repair", operation=operation, cancel_event=cancel,
        )
    assert output == before


@pytest.mark.parametrize("cancel_at", [0, 1, 2])
def test_cancellation_at_validation_boundaries_stops_before_next_stage(checkpoint_case, cancel_at):
    _, output = checkpoint_case
    cancel = threading.Event()
    validations = []
    operations = []
    if cancel_at == 0:
        cancel.set()

    def normalize(candidate):
        validations.append(candidate)
        if len(validations) == cancel_at:
            cancel.set()
        return candidate

    def operation(candidate):
        operations.append(candidate)
        return candidate

    with pytest.raises(LLMRequestCancelledError):
        draft_recovery.run_valid_draft_postprocess_stage(
            output=output, phase="repair", operation=operation, normalize=normalize, cancel_event=cancel,
        )
    assert len(validations) == cancel_at
    assert len(operations) == (1 if cancel_at == 2 else 0)


def test_invalid_checkpoint_fails_before_running_optional_operation():
    service, _ = seed_dependencies()
    with pytest.raises(ValidationError):
        service._run_valid_draft_postprocess_stage(
            output={"title": "Incomplete"}, phase="repair",
            operation=lambda _: pytest.fail("Invalid source must not reach enhancement"),
        )


def test_unchanged_body_keeps_output_identity_and_merges_metadata(checkpoint_case):
    service, output = checkpoint_case
    body = deepcopy(draft_contract.without_metadata(output))

    def operation(candidate):
        candidate["_meta"]["style_checked"] = True
        return candidate

    result = service._run_valid_draft_postprocess_stage(output=output, phase="style", operation=operation)
    assert result is output
    assert draft_contract.without_metadata(result) == body
    assert result["_meta"]["style_checked"] is True


def test_missing_ending_mode_in_candidate_keeps_source_closing_contract(checkpoint_case):
    service, output = checkpoint_case
    output["ending_mode"] = "series_finale"
    output["continuation_hook"] = None
    output["next_episode_question"] = None
    output["scenes"][-1]["cliffhanger"] = False
    before = deepcopy(output)

    def operation(candidate):
        candidate.pop("ending_mode")
        candidate["hook"] = "林夏锁住证物箱，将完整证据交给赶到的调查员。"
        return candidate

    result = service._run_valid_draft_postprocess_stage(output=output, phase="style", operation=operation)
    assert result["ending_mode"] == "series_finale"
    assert result["scenes"][-1]["cliffhanger"] is False
    assert result["hook"] != before["hook"]
    assert output == before


@pytest.mark.parametrize("metadata", [None, "opaque", {"deferred_postprocess_phases": "opaque", "deferred_postprocess_diagnostics": None}])
def test_preservation_does_not_replace_opaque_metadata_shapes(metadata):
    output = {"_meta": metadata, "scenes": [{"character_actions": ["Original action"]}]}
    before = deepcopy(output)
    result = draft_recovery.preserve_valid_draft_after_postprocess_failure(
        output, phase="repair", error=_request_error(),
    )
    assert output == before
    if isinstance(metadata, dict):
        assert result["_meta"] == {**metadata, "postprocess_failure_preserved_valid_draft": True}
    else:
        assert result["_meta"] == metadata


def test_failure_diagnostics_preserve_fields_without_copying_raw_provider_content():
    request = LLMRequestError("PRIVATE_PROVIDER_MESSAGE", category="gateway failure", status_code=503)
    structured = LLMStructuredOutputError(
        "Malformed JSON", raw_content="PRIVATE_BODY", json_error_line=2, json_error_column=3,
        json_error_position=5, stream_termination="unexpected_eof",
    )
    assert draft_recovery.failure_diagnostic(phase="repair", error=request) == (
        "repair: request_category=gateway_failure; status=503"
    )
    assert draft_recovery.failure_diagnostic(phase="repair", error=structured) == (
        "repair(error=Malformed JSON, raw_chars=12; json_error=line:2,column:3,position:5; "
        "stream_termination=unexpected_eof)"
    )


def test_exception_chain_keeps_first_llm_failure_and_cycle_limit():
    fatal = _request_error("deadline", recoverable=False)
    fatal.__cause__ = _request_error()
    wrapper = ValueError("Wrapper")
    wrapper.__cause__ = fatal
    assert draft_recovery.exception_chain_has_transient_llm_failure(wrapper) is False
    wrapper.__cause__ = wrapper
    assert draft_recovery.exception_chain_has_transient_llm_failure(wrapper) is False


def test_generation_service_reexports_the_same_contract_exception():
    assert InvalidDraftMasterScriptOutputError is draft_contract.InvalidDraftMasterScriptOutputError
    assert ScriptGenerationService._structured_output_error_is_transient(_structured_error()) is False
