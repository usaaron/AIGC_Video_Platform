"""One-request overseas SSE diagnostic; run under run_with_wall_timeout.py."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from scripts.real_generation_probe_transport import ProviderRequestMeter
from scripts.run_real_generation_probe import write_json


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    prefix = "LLM_OVERSEAS_SCRIPT"
    for suffix in ("MODEL", "API_KEY", "BASE_URL", "WIRE_API"):
        if not os.getenv(f"{prefix}_{suffix}", "").strip():
            raise ValueError(f"Explicit {prefix}_{suffix} is required.")
    os.environ.update({
        f"{prefix}_MAX_RETRIES": "0",
        f"{prefix}_RETRY_EMPTY_RESPONSE": "false",
        f"{prefix}_REASONING_EFFORT": "medium",
        f"{prefix}_TIMEOUT_SECONDS": "60",
    })
    logging.disable(logging.CRITICAL)
    from app.llm_runtime import _build_role_adapter_from_env
    from app.modules.script_engine.models import GenerationStrategy
    from scripts.bootstrap_frontend_mvp_runtime import _bootstrap_payloads

    adapter = _build_role_adapter_from_env(
        prefix, default_model_env=f"{prefix}_MODEL", default_timeout_seconds=60,
        default_max_retries=0, default_reasoning_effort="medium", default_thinking_mode="enabled",
        default_use_strict_schema=False, default_send_response_format=False,
        default_retry_empty_response=False, defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=False,
        inherit_fallback_runtime_tuning=False, inherit_fallback_flags=False,
    )
    strategy_payload = next(payload for path, payload in _bootstrap_payloads(
        "tiktok_frontend_mvp_v1", "frontend_mvp", market_profile="overseas_tiktok",
    ) if path == "/generation-strategies" and payload["id"] == "strategy.tiktok.frontend_mvp.dark_romance.v1")
    strategy = GenerationStrategy.model_validate(strategy_payload).model_copy(update={"max_tokens": 2048})
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}
    summary = {
        "mode": "overseas_small_output_transport_diagnostic", "status": "running",
        "max_physical_requests": 1, "provider_deadline_seconds": 85,
        "required_external_wall_timeout_seconds": 90, "output_token_budget": 2048,
        "script_reasoning_effort_override": "medium", "first_model_delta_seconds": None,
        "script_quality_accepted": False,
        "source_hashes": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in (
            Path(__file__), ROOT / "backend/app/modules/script_engine/llm_adapter.py",
            ROOT / "scripts/real_generation_probe_transport.py", ROOT / "scripts/run_with_wall_timeout.py",
        )},
    }
    write_json(output / "run_manifest.json", summary)
    started = time.monotonic()

    def on_delta(delta: str, reset: bool) -> None:
        if delta and summary["first_model_delta_seconds"] is None:
            summary["first_model_delta_seconds"] = round(time.monotonic() - started, 3)
            write_json(output / "first_model_delta.json", {
                "elapsed_seconds": summary["first_model_delta_seconds"], "characters": len(delta), "reset": reset,
            })

    meter = ProviderRequestMeter(output / "provider_requests.jsonl", max_requests=1,
                                 deadline_seconds=85, request_timeout_seconds=60)
    try:
        with meter:
            result = adapter.generate_structured_output_stream(
                'Return exactly the JSON object {"ok":true}. This is a connection check.',
                strategy=strategy, output_schema=schema, on_delta=on_delta,
            )
        body = {key: value for key, value in result.items() if key != "_meta"}
        summary["expected_reply"] = set(body) == {"ok"} and body["ok"] is True
        summary["status"] = "response_verified" if summary["expected_reply"] else "unexpected_reply"
    except Exception as error:
        summary.update(status="failed", error_type=type(error).__name__,
                       stream_termination=getattr(error, "stream_termination", None))
    finally:
        summary["elapsed_seconds"] = round(time.monotonic() - started, 3)
        summary["provider"] = meter.summary()
        write_json(output / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return 0 if summary["status"] == "response_verified" else 1


if __name__ == "__main__":
    raise SystemExit(main())
