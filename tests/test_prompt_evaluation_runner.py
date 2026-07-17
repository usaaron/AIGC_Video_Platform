import json
from pathlib import Path

from evaluation.models import PromptEvaluationRunRequest
from evaluation.prompt_evaluation_runner import PromptEvaluationRunner


def load_default_request() -> PromptEvaluationRunRequest:
    payload = json.loads(
        Path("examples/prompt_evaluations/default_request.json").read_text()
    )
    payload["save_report"] = False
    return PromptEvaluationRunRequest.model_validate(payload)


def test_prompt_evaluation_runner_supports_prompt_strategy_and_stability_comparisons() -> None:
    runner = PromptEvaluationRunner()
    request = load_default_request()

    result = runner.run(request)

    assert result.benchmark_dataset_id == "us_female_dark_romance"
    assert len(result.variants) == 3
    assert all(variant.content_spec_id == result.content_spec_id for variant in result.variants)
    prompt_v1 = next(variant for variant in result.variants if variant.case_id == "prompt_v1")
    prompt_v2 = next(variant for variant in result.variants if variant.case_id == "prompt_v2")
    repeat_variant = next(
        variant for variant in result.variants if variant.case_id == "strategy_v2_repeat"
    )

    assert prompt_v1.prompt_versions == ["v1"]
    assert prompt_v2.prompt_versions == ["v2"]
    assert prompt_v1.generation_strategy_version == "v1"
    assert repeat_variant.generation_strategy_version == "v2"
    assert repeat_variant.stability_summary.run_count == 2
    assert repeat_variant.stability_summary.title_exact_match_ratio == 1.0
    assert repeat_variant.stability_summary.hook_exact_match_ratio == 1.0
    assert result.decision_summary.best_variant_case_id == "strategy_v2_repeat"
    assert result.decision_summary.next_optimization_targets
    assert prompt_v2.explainability.compare_to_case_id == "prompt_v1"
    assert any(
        metric.startswith("average_latency_ms")
        for metric in prompt_v2.explainability.improved_metrics
    )
    assert any(
        metric.startswith("repeat_validation_coverage")
        for metric in repeat_variant.explainability.improved_metrics
    )
    assert (
        prompt_v1.samples[0].draft_master_script.title
        != prompt_v2.samples[0].draft_master_script.title
    )
    assert any(
        check.check_name == "prompt_versions_recorded" and check.passed
        for check in prompt_v2.samples[0].deterministic_checks
    )
    assert any(
        check.check_name == "generation_strategy_version_recorded" and check.passed
        for check in repeat_variant.samples[0].deterministic_checks
    )
    assert all(
        sample.story_qc_is_placeholder is True
        for variant in result.variants
        for sample in variant.samples
    )


def test_prompt_evaluation_runner_writes_json_and_markdown_reports(tmp_path: Path) -> None:
    runner = PromptEvaluationRunner()
    request = load_default_request().model_copy(
        update={"save_report": True, "report_dir": str(tmp_path)}
    )

    result = runner.run(request)

    assert result.report_paths is not None
    assert Path(result.report_paths.json_path).exists()
    assert Path(result.report_paths.markdown_path).exists()
    markdown = Path(result.report_paths.markdown_path).read_text()
    assert "## Overall Decision" in markdown
    assert "### Next Optimization Targets" in markdown
    assert "#### Improved Metrics" in markdown
