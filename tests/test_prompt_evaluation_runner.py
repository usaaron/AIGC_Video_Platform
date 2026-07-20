import json
from pathlib import Path

from app.modules.script_engine.models import StoryQCReport
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
    assert prompt_v2.samples[0].story_qc_dimensions
    assert "hook_quality" in prompt_v2.story_qc_dimension_scores
    assert "hook_quality" in prompt_v2.story_qc_dimension_summaries
    assert "hook_quality" in prompt_v2.story_qc_scene_refs
    assert prompt_v2.explainability.dimension_deltas
    assert prompt_v2.explainability.confidence_note is not None
    classified_metrics = (
        prompt_v2.explainability.improved_metrics
        + prompt_v2.explainability.regressed_metrics
        + prompt_v2.explainability.unchanged_metrics
    )
    assert any(
        metric.startswith("average_latency_ms") for metric in classified_metrics
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
    assert "#### Story QC Dimension Deltas" in markdown


def test_prompt_evaluation_runner_compares_story_qc_dimensions_with_improvements_and_regressions() -> None:
    runner = PromptEvaluationRunner()
    result = runner.run(load_default_request())
    baseline = next(variant for variant in result.variants if variant.case_id == "prompt_v1")
    candidate = next(variant for variant in result.variants if variant.case_id == "prompt_v2")

    candidate = candidate.model_copy(
        update={
            "story_qc_dimension_scores": {
                **candidate.story_qc_dimension_scores,
                "hook_quality": 3.8,
                "character_agency": 3.5,
                "emotional_payoff": 4.1,
            },
            "story_qc_dimension_summaries": {
                **candidate.story_qc_dimension_summaries,
                "hook_quality": "Scene 1 establishes conflict earlier.",
                "character_agency": "The protagonist makes a clearer public choice in Scene 2.",
                "emotional_payoff": "The emotional turn lands, but the payoff is slightly flatter by the ending.",
            },
            "story_qc_evidence": {
                **candidate.story_qc_evidence,
                "hook_quality": ["Scene 1 starts with a public contradiction."],
                "character_agency": ["Scene 2 shows the protagonist making an irreversible choice."],
                "emotional_payoff": ["Scene 3 resolves less intensely than the baseline version."],
            },
            "story_qc_revision_signals": {
                **candidate.story_qc_revision_signals,
                "hook_quality": ["keep_early_conflict"],
                "character_agency": ["keep_visible_public_choice"],
                "emotional_payoff": ["restore_stronger_emotional_release"],
            },
            "story_qc_scene_refs": {
                **candidate.story_qc_scene_refs,
                "hook_quality": [1],
                "character_agency": [2],
                "emotional_payoff": [3],
            },
            "story_qc_deduction_reasons": {
                **candidate.story_qc_deduction_reasons,
                "emotional_payoff": ["Ending payoff is slightly weaker than the setup promises."],
            },
            "metrics_summary": candidate.metrics_summary.model_copy(
                update={
                    "average_script_score": baseline.metrics_summary.average_script_score + 0.03,
                    "average_story_qc_score": baseline.metrics_summary.average_story_qc_score + 0.02,
                }
            ),
        }
    )

    explainability = runner._build_variant_explainability(
        variant=candidate,
        baseline=baseline,
    )

    hook_delta = next(
        item for item in explainability.dimension_deltas if item.dimension == "hook_quality"
    )
    emotional_delta = next(
        item for item in explainability.dimension_deltas if item.dimension == "emotional_payoff"
    )

    assert hook_delta.direction == "improved"
    assert hook_delta.delta == 1.3
    assert emotional_delta.direction == "regressed"
    assert explainability.improvements
    assert explainability.regressions
    assert explainability.strongest_improvement == "hook_quality"
    assert explainability.largest_regression == "emotional_payoff"
    assert explainability.recommendation_reason is not None


def test_prompt_evaluation_runner_supports_old_story_qc_report_fallback() -> None:
    runner = PromptEvaluationRunner()
    old_report = StoryQCReport.model_validate(
        {
            "overall_score": 0.72,
            "status": "placeholder",
            "checks": [
                {
                    "check_name": "hook_present",
                    "passed": True,
                    "score": 1.0,
                    "note": "Hook exists.",
                }
            ],
            "recommended_actions": ["Build a revision plan from rubric deductions."],
            "rubric_overall_score": 0.68,
            "rubric_categories": [
                {
                    "category_name": "Hook",
                    "score": 2.5,
                    "max_score": 5,
                    "deduction_reasons": ["Hook is too short or non-specific."],
                    "revision_suggestions": ["Strengthen the opening contradiction."],
                }
            ],
        }
    )

    assert runner._extract_story_qc_dimensions(old_report) == []


def test_prompt_evaluation_runner_handles_missing_dimension_and_close_scores() -> None:
    runner = PromptEvaluationRunner()
    result = runner.run(load_default_request())
    baseline = next(variant for variant in result.variants if variant.case_id == "prompt_v1")
    candidate = next(variant for variant in result.variants if variant.case_id == "prompt_v2")

    candidate = candidate.model_copy(
        update={
            "story_qc_dimension_scores": {
                key: value
                for key, value in candidate.story_qc_dimension_scores.items()
                if key != "cliffhanger_strength"
            },
            "story_qc_dimension_summaries": {
                key: value
                for key, value in candidate.story_qc_dimension_summaries.items()
                if key != "cliffhanger_strength"
            },
            "metrics_summary": candidate.metrics_summary.model_copy(
                update={
                    "average_script_score": baseline.metrics_summary.average_script_score + 0.005,
                    "average_story_qc_score": baseline.metrics_summary.average_story_qc_score + 0.004,
                }
            ),
        }
    )

    explainability = runner._build_variant_explainability(
        variant=candidate,
        baseline=baseline,
    )

    cliffhanger_delta = next(
        item
        for item in explainability.dimension_deltas
        if item.dimension == "cliffhanger_strength"
    )
    assert cliffhanger_delta.direction == "unavailable"
    assert explainability.confidence_note is not None
