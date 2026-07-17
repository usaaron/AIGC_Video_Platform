from evaluation.benchmark_runner import BenchmarkRunner
from evaluation.models import BenchmarkDatasetType


def test_benchmark_runner_executes_fixed_benchmarks() -> None:
    runner = BenchmarkRunner()
    dataset_ids = [
        "us_female_dark_romance",
        "us_werewolf_romance",
        "ceo_romance",
        "supernatural_romance",
        "revenge_drama",
    ]

    results = [
        runner.run(
            runner.load_scenario(
                dataset_id=dataset_id,
                dataset_type=BenchmarkDatasetType.benchmark,
            )
        )
        for dataset_id in dataset_ids
    ]

    assert len(results) == 5
    assert all(result.analysis_evaluation.score >= 0.7 for result in results)
    assert all(result.score_summary.revision_qc_gain >= 0.0 for result in results)
    assert all(result.score_summary.final_gain_over_draft >= 0.0 for result in results)
    assert all(result.revision_summary.action_count >= 1 for result in results)
    assert all(result.highlights.strongest_gain_stage for result in results)
    assert all(result.revision_improves_over_draft for result in results)
    assert all(
        result.revised_story_qc_report.overall_score >= result.story_qc_report.overall_score
        for result in results
    )
    assert all(
        result.final_improves_over_revised_draft for result in results
    )
    assert all(result.final_improves_over_draft for result in results)
