import json

import pytest

from scripts.real_generation_probe_resume import _historical_usage


@pytest.mark.parametrize("usage,complete", [
    (None, False),
    ({"input_tokens": 10, "output_tokens": None, "total_tokens": None}, False),
    ({"input_tokens": 10, "output_tokens": 5}, False),
    ({"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}, True),
    ({"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}, True),
])
def test_historical_usage_requires_complete_input_output_and_total(tmp_path, usage, complete):
    events = [
        {"run_id": "source", "request_id": 1, "usage": None},
        {"run_id": "source", "request_id": 1, "usage": usage},
    ]
    (tmp_path / "provider_requests.jsonl").write_text("\n".join(json.dumps(row) for row in events))

    summary = _historical_usage(tmp_path)

    assert summary["physical_requests"] == 1
    assert summary["total_usage_complete"] is complete
    assert summary["requests_incomplete_usage"] == int(not complete)
    assert summary["known_tokens"]["input_tokens"] == (usage or {}).get("input_tokens")
    assert summary["monetary_cost"] is None
    assert summary["counted_against_current_budget"] is False
