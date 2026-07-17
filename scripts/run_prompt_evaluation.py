from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.dependencies import get_prompt_evaluation_service
from evaluation.models import PromptEvaluationRunRequest


def main() -> None:
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        ROOT_DIR / "examples" / "prompt_evaluations" / "default_request.json"
    )
    payload = PromptEvaluationRunRequest.model_validate_json(config_path.read_text())
    service = get_prompt_evaluation_service()
    result = service.run(payload)

    print("Prompt evaluation complete")
    print(f"  Evaluation Case ID: {result.evaluation_case_id}")
    print(f"  Benchmark Dataset ID: {result.benchmark_dataset_id}")
    print(f"  ContentSpec ID: {result.content_spec_id}")
    print(f"  Overall Pass: {result.overall_pass}")
    if result.report_paths is not None:
        print(f"  JSON Report: {result.report_paths.json_path}")
        print(f"  Markdown Report: {result.report_paths.markdown_path}")
    for variant in result.variants:
        print(
            f"  Variant {variant.case_id}: pass={variant.pass_fail} "
            f"strategy={variant.generation_strategy_id} "
            f"prompt_versions={','.join(variant.prompt_versions) if variant.prompt_versions else 'n/a'} "
            f"runs={len(variant.samples)}"
        )
        for sample in variant.samples:
            print(
                f"    Run {sample.run_index}: draft_id={sample.artifact_ids.draft_master_script_id} "
                f"latency_ms={sample.latency_ms} "
                f"story_qc={sample.story_qc_score}"
            )

    output_path = ROOT_DIR / "examples" / "prompt_evaluations" / "last_result.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2)
    )
    print(f"  Snapshot: {output_path}")


if __name__ == "__main__":
    main()
