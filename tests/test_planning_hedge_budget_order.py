"""The already-metered hedge survives either reservation order, without I/O."""

import json
from threading import Event
from uuid import uuid4

import httpx

from app.modules.script_engine.llm_adapter import ModelFailoverLLMAdapter, RealLLMAdapter
from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.planning_call_budget import planning_call_budget_scope
from tests.test_llm_adapter import build_strategy


def test_fallback_reserving_final_allowance_does_not_get_cancelled_by_primary_budget_failure():
    fallback_posted, primary_checked = Event(), Event()
    requests = []

    class PrimaryAfterFallback(RealLLMAdapter):
        def _stream_text(self, *args, **kwargs):
            assert fallback_posted.wait(timeout=3)
            try:
                return super()._stream_text(*args, **kwargs)
            finally:
                primary_checked.set()

    def handler(request):
        requests.append(json.loads(request.content)["model"])
        fallback_posted.set()
        assert primary_checked.wait(timeout=3)
        event = {"choices": [{"delta": {"content": '{"title":"metered fallback"}'}, "finish_reason": "stop"}]}
        return httpx.Response(200, text=f"data: {json.dumps(event)}\n\ndata: [DONE]\n\n",
                             headers={"content-type": "text/event-stream"})

    kwargs = dict(provider="openai_compatible", api_key="offline-test-key",
                  base_url="https://offline.invalid/v1", max_retries=0,
                  transport=httpx.MockTransport(handler))
    primary = PrimaryAfterFallback(model_name="primary", **kwargs)
    fallback = RealLLMAdapter(model_name="fallback", **kwargs)
    adapter = ModelFailoverLLMAdapter(primary=primary, fallback=fallback, hedge_delay_seconds=0.01)
    try:
        with planning_call_budget_scope(database_runtime=None, operation_id=str(uuid4()),
            project_id="test-budget-order", parent_node_id="parent", parent_node_version=1,
            input_fingerprint="a" * 64, limit=1) as budget:
            result = adapter.generate_structured_output_stream("Offline test", strategy=GenerationStrategy.model_validate(build_strategy()))
            assert result["title"] == "metered fallback"
            assert result["_meta"]["model_hedge_winner"] == "fallback"
            assert budget.used == 1
        assert requests == ["fallback"]
    finally:
        primary._client.close()
        fallback._client.close()
