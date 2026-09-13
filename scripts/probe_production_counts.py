"""Capture count-repair inputs in an isolated probe, or replay them without HTTP."""

from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from functools import wraps
import json
from pathlib import Path
import sys
from unittest.mock import patch
from uuid import uuid4

from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.llm_adapter import (
    LLMRequestError, LLMStructuredOutputError, RealLLMAdapter, bind_llm_market,
)
from app.modules.script_engine.models import GenerationStrategy, ScriptReleaseRegion
from scripts.run_real_generation_probe import main as run_probe, write_json


@contextmanager
def capture_count_repairs(output: Path):
    active: ContextVar[dict | None] = ContextVar("count_probe", default=None)
    ensure = ScriptGenerationService._ensure_episode_production_counts
    generate = ScriptGenerationService._generate_postprocess_output
    parse = RealLLMAdapter._parse_json_content
    active_patch: ContextVar[dict | None] = ContextVar("count_probe_patch", default=None)

    @wraps(parse)
    def recorded_parse(self, content, **kwargs):
        evidence = active_patch.get()
        if evidence is not None:
            evidence.setdefault("raw_responses", []).append(content)
        return parse(self, content, **kwargs)

    @wraps(ensure)
    def recorded_ensure(self, **kwargs):
        directory = output / "count_repairs" / uuid4().hex
        directory.mkdir(parents=True)
        region = kwargs.get("release_region", ScriptReleaseRegion.cn_mainland)
        write_json(directory / "source.json", {
            "output": kwargs["output"],
            "strategy": kwargs["strategy"].model_dump(mode="json"),
            "release_region": getattr(region, "value", region),
            "target_duration_seconds": kwargs.get("target_duration_seconds"),
        })
        token = active.set({"directory": directory, "attempt": 0})
        try:
            result = ensure(self, **kwargs)
            write_json(directory / "result.json", {"status": "passed", "output": result})
            return result
        except Exception as error:
            write_json(directory / "result.json", failure(error))
            raise
        finally:
            active.reset(token)

    @wraps(generate)
    def recorded_generate(self, **kwargs):
        record = active.get()
        if record is None or kwargs["phase"] != "episode_production_count_repair":
            return generate(self, **kwargs)
        record["attempt"] += 1
        destination = record["directory"] / f"patch_{record['attempt']:02d}.json"
        evidence = {"prompt": kwargs["prompt"], "schema": kwargs["output_schema"]}
        token = active_patch.set(evidence)
        try:
            result = generate(self, **kwargs)
            evidence.update(status="passed", output=result)
            return result
        except Exception as error:
            evidence.update(failure(error))
            raise
        finally:
            active_patch.reset(token)
            write_json(destination, evidence)

    # Only this standalone process records synthetic fixture content. Product
    # endpoints and ordinary probes retain their content-free logging policy.
    with patch.object(ScriptGenerationService, "_ensure_episode_production_counts", recorded_ensure), \
         patch.object(ScriptGenerationService, "_generate_postprocess_output", recorded_generate), \
         patch.object(RealLLMAdapter, "_parse_json_content", recorded_parse):
        yield


def failure(error: Exception) -> dict:
    result = {"status": "failed", "error_type": type(error).__name__, "detail": str(error)}
    if isinstance(error, (LLMRequestError, LLMStructuredOutputError)):
        result["attributes"] = vars(error).copy()
    return result


class ReplayCountService(ScriptGenerationService):
    def __init__(self, patches: list[dict]):
        self._production_count_llm_adapter = None
        self._repair_llm_adapter = None
        self.patches = patches
        self.requests: list[dict] = []

    def _generate_postprocess_output(self, **kwargs):
        index = len(self.requests)
        self.requests.append({"prompt": kwargs["prompt"], "schema": kwargs["output_schema"]})
        if index >= len(self.patches):
            raise AssertionError("Replay exhausted captured patches; HTTP is never used.")
        record = self.patches[index]
        if record["status"] != "passed":
            error_class = {"LLMRequestError": LLMRequestError,
                           "LLMStructuredOutputError": LLMStructuredOutputError}.get(record["error_type"])
            if error_class is None:
                raise AssertionError(f"Unsupported captured error: {record['error_type']}")
            error = error_class(record["detail"])
            error.__dict__.update(record.get("attributes", {}))
            raise error
        return deepcopy(record["output"])


def replay_count_repair(directory: Path) -> dict:
    source = json.loads((directory / "source.json").read_text())
    patches = [json.loads(path.read_text()) for path in sorted(directory.glob("patch_*.json"))]
    service = ReplayCountService(patches)
    try:
        with bind_llm_market(source["release_region"]):
            result = service._ensure_episode_production_counts(
                output=source["output"], strategy=GenerationStrategy.model_validate(source["strategy"]),
                release_region=ScriptReleaseRegion(source["release_region"]),
                target_duration_seconds=source["target_duration_seconds"],
            )
        outcome = {"status": "passed", "output": result}
    except Exception as error:
        outcome = failure(error)
    return {**outcome, "patch_calls": len(service.requests), "provider_requests": 0}


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--replay":
        result = replay_count_repair(Path(sys.argv[2]))
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["status"] == "passed" else 1
    if "--output-dir" not in sys.argv:
        raise SystemExit("Capture requires --output-dir pointing to a new isolated probe directory.")
    output = Path(sys.argv[sys.argv.index("--output-dir") + 1]).resolve()
    if "--repair-source" in sys.argv:
        from app.dependencies import get_script_generation_service
        from scripts.real_generation_probe_transport import ProviderRequestMeter
        from scripts.run_real_generation_probe import _ensure_real_generation_runtime

        source_path = Path(sys.argv[sys.argv.index("--repair-source") + 1])
        source = json.loads(source_path.read_text())
        _ensure_real_generation_runtime(source["release_region"])
        output.mkdir(parents=True, exist_ok=False)
        meter = ProviderRequestMeter(output / "provider_requests.jsonl", max_requests=4,
                                     deadline_seconds=180, request_timeout_seconds=90)
        try:
            with meter, capture_count_repairs(output), bind_llm_market(source["release_region"]):
                get_script_generation_service()._ensure_episode_production_counts(
                    output=source["output"], strategy=GenerationStrategy.model_validate(source["strategy"]),
                    release_region=ScriptReleaseRegion(source["release_region"]),
                    target_duration_seconds=source["target_duration_seconds"],
                )
            result = {"status": "passed"}
        except Exception as error:
            result = failure(error)
        write_json(output / "summary.json", {**result, "provider": meter.summary(), "source": str(source_path)})
        print(json.dumps({**result, "output": str(output)}))
        return 0 if result["status"] == "passed" else 1
    with capture_count_repairs(output):
        return run_probe()


if __name__ == "__main__":
    raise SystemExit(main())
