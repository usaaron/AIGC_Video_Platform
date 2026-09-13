"""Inspect production role adapters; --live sends only a synthetic JSON request."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import logging
from pathlib import Path
import sys
from time import perf_counter
from typing import Literal

from pydantic import BaseModel, ConfigDict

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "backend")]

from app.dependencies import (
    get_bilingual_script_view_service, get_script_generation_service, get_story_planning_service,
)
from app.llm_runtime import build_input_readiness_llm_adapter_from_env
from app.modules.script_engine.llm_adapter import LLMAdapter, RealLLMAdapter
from app.modules.script_engine.models import GenerationStrategy


class ProbeOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["ok"]
    values: list[int]


def collect_adapters():
    found = []
    def visit(path, adapter, ancestors):
        if id(adapter) in ancestors:
            return
        if isinstance(adapter, RealLLMAdapter):
            found.append((path, adapter))
            return
        for name, value in vars(adapter).items():
            children = value if isinstance(value, (list, tuple)) else [value]
            for index, child in enumerate(children):
                if isinstance(child, LLMAdapter):
                    visit(f"{path}.{name}[{index}]", child, ancestors | {id(adapter)})

    for name, service in (
        ("input_readiness", build_input_readiness_llm_adapter_from_env()),
        ("dialogue", get_bilingual_script_view_service()),
        ("planning", get_story_planning_service()),
        ("script", get_script_generation_service()),
    ):
        visit(name, service, set())
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--mode", choices=["both", "stream", "nonstream"], default="both")
    parser.add_argument("--model")
    parser.add_argument("--wire-api", choices=["responses", "chat_completions"])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    sample = Path(__file__).resolve().parents[1] / "examples/script_engine/generation_strategy_sample.json"
    strategy = GenerationStrategy.model_validate_json(sample.read_text()).model_copy(update={"max_tokens": 4096})
    prompt = 'Return exactly {"status":"ok","values":[1,2,3]} as a JSON object.'
    groups = {}
    for path, adapter in collect_adapters():
        if args.model and args.model not in adapter._model_name:
            continue
        if args.wire_api:
            adapter._wire_api = args.wire_api
        payload = adapter._build_payload(prompt=prompt, strategy=strategy, output_schema=ProbeOutput.model_json_schema())
        # Keys are used only in memory for deduplication, never written to reports.
        identity = (adapter._base_url, adapter._client.headers.get("authorization"), json.dumps(payload, sort_keys=True))
        if identity not in groups:
            groups[identity] = {"adapter": adapter, "roles": [], "model": adapter._model_name,
                "wire_api": adapter._wire_api, "reasoning": adapter._effective_reasoning_effort,
                "thinking": payload.get("thinking", {}).get("type"),
                "format": payload.get("response_format", payload.get("text", {}).get("format"))}
        groups[identity]["roles"].append(path)

    def probe(group, streaming):
        adapter = group["adapter"]
        summary = {key: value for key, value in group.items() if key != "adapter"}
        summary["mode"] = "stream" if streaming else "nonstream"
        if not args.live:
            return {**summary, "status": "not_run"}
        started = perf_counter()
        adapter._request_deadline_seconds = min(adapter._request_deadline_seconds or 90, 90)
        adapter._max_retries = 0
        adapter._retry_empty_response = False
        adapter._defer_schema_container_repair = True
        try:
            operation = adapter.generate_structured_output_stream if streaming else adapter.generate_structured_output
            result = operation(prompt, strategy=strategy, output_schema=ProbeOutput.model_json_schema())
            parsed = ProbeOutput.model_validate({k: v for k, v in result.items() if k != "_meta"})
            summary["status"] = "passed" if parsed.values == [1, 2, 3] else "wrong_values"
            summary["usage"] = {k: v for k, v in (result.get("_meta", {}).get("usage") or {}).items()
                                if k in {"prompt_tokens", "completion_tokens", "input_tokens", "output_tokens", "total_tokens"}}
        except Exception as error:
            detail = str(error).replace(adapter._base_url, "[endpoint]")
            credential = adapter._client.headers.get("authorization", "")
            if credential:
                detail = detail.replace(credential, "[credential]").replace(credential.removeprefix("Bearer "), "[credential]")
            summary.update(status="failed", error_type=type(error).__name__,
                           http_status=getattr(error, "status_code", None),
                           category=getattr(error, "category", None), detail=detail[:600])
        summary["elapsed_seconds"] = round(perf_counter() - started, 2)
        print(json.dumps({k: v for k, v in summary.items() if k not in {"roles", "format"}}, ensure_ascii=False), flush=True)
        return summary

    results = []
    modes = [False, True] if args.mode == "both" else [args.mode == "stream"]
    # Each adapter is used serially; independent credential/config groups overlap.
    def probe_group(group):
        return [probe(group, streaming) for streaming in modes]
    with ThreadPoolExecutor(max_workers=2) as executor:
        for future in as_completed([executor.submit(probe_group, group) for group in groups.values()]):
            results.extend(future.result())
    report = {"live": args.live, "unique_configurations": len(groups), "results": results}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if not args.live:
        print(json.dumps({"unique_configurations": len(groups), "results": [
            {k: v for k, v in row.items() if k not in {"roles", "format"}}
            for row in results
        ]}, ensure_ascii=False, indent=2))
    return 1 if not results or any(result["status"] not in {"passed", "not_run"} for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
