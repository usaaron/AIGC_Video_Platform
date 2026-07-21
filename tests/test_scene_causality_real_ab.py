from scripts.run_scene_causality_real_ab import (
    PreviousTemplatePromptBuilder,
    _load_completed_run,
    build_prompt_items,
)
from app.modules.script_engine.models import (
    GenerationStrategy,
    GenerationWorkflowStep,
    PromptBuildContext,
)
from app.modules.script_engine.prompt_builder import TemplatePromptBuilder


def _strategy(prompt_ids: list[str]) -> GenerationStrategy:
    return GenerationStrategy(
        id="strategy.scene_causality_ab.test.v1",
        name="Scene Causality A/B Test",
        target_platform="tiktok",
        target_content_type="ai_comic_drama",
        applicable_tags=["genre.romance"],
        model_provider="mock",
        model_name="mock-script-generator",
        workflow_steps=[
            GenerationWorkflowStep(
                step_order=index,
                name=f"step_{index}",
                description="Build a structured test draft.",
                prompt_id=prompt_id,
            )
            for index, prompt_id in enumerate(prompt_ids, start=1)
        ],
        prompt_ids=prompt_ids,
        version="v1",
        status="active",
    )


def test_real_ab_prompt_variants_only_change_scene_causality_instruction() -> None:
    prompt_items = build_prompt_items()
    baseline = prompt_items[0]
    improved = prompt_items[1]
    shared = prompt_items[2]
    context = PromptBuildContext(
        content_spec_id="content_spec_test",
        content_spec_title="Fixed benchmark story",
        creative_brief_summary="A fixed short-form dramatic premise.",
        platform_profile_id="tiktok_benchmark_v1",
        audience_profile_summary="US short-form drama viewers.",
        commercial_goal_summary="Test continuation intent.",
        generation_strategy_id="strategy.scene_causality_ab.test.v1",
        extra_variables={"output_json_schema": "{}"},
    )

    baseline_result = PreviousTemplatePromptBuilder().build_master_prompt(
        prompts=[baseline, shared],
        context=context,
        strategy=_strategy([baseline.id, shared.id]),
    )
    improved_result = TemplatePromptBuilder(builder_version="v0.2").build_master_prompt(
        prompts=[improved, shared],
        context=context,
        strategy=_strategy([improved.id, shared.id]),
    )

    assert "SceneCausalityContract:" not in baseline_result.prompt_text
    assert "SceneCausalityContract:" in improved_result.prompt_text
    assert "Each later scene must be caused by an earlier outcome" in improved.prompt_template
    assert baseline_result.trace.builder_version == "v0.1-ab-baseline"
    assert improved_result.trace.builder_version == "v0.2"


def test_real_ab_checkpoint_resumes_only_complete_variant(tmp_path) -> None:
    assert _load_completed_run(tmp_path, "baseline") is None

    (tmp_path / "baseline_draft.json").write_text("{}", encoding="utf-8")
    (tmp_path / "baseline_prompt.txt").write_text("prompt", encoding="utf-8")
    (tmp_path / "baseline_run.json").write_text(
        '{"draft_id":"draft_1"}',
        encoding="utf-8",
    )

    assert _load_completed_run(tmp_path, "baseline") == {"draft_id": "draft_1"}
