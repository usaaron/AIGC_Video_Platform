from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.llm_runtime import get_llm_runtime_config
from app.modules.content_spec.models import ContentSpec
from app.modules.master_script.models import LLMGeneratedDraftMasterScript
from app.modules.script_engine.models import (
    GenerationStrategyCreate,
    GenerationStrategyStatus,
    GenerationWorkflowStep,
    PromptLibraryItemCreate,
    PromptType,
    ScriptGenerationDraftRequest,
)
from app.modules.script_engine.prompt_builder import TemplatePromptBuilder
from evaluation.models import BenchmarkDatasetType
from evaluation.prompt_evaluation_runner import PromptEvaluationRunner


OUTPUT_DIR = (
    ROOT_DIR
    / "examples"
    / "prompt_evaluations"
    / "scene_causality_real_ab_v1"
)
DATASET_IDS = (
    "us_female_dark_romance",
    "supernatural_romance",
    "revenge_drama",
)
OUTPUT_LANGUAGE = "en"
DESIRED_SCENE_COUNT = 3
TEMPERATURE = 0.6
TOP_P = 0.9
MAX_TOKENS = 4000


class PreviousTemplatePromptBuilder(TemplatePromptBuilder):
    """Reproduce the pre-v0.2 prompt context without changing production code."""

    def __init__(self) -> None:
        super().__init__(builder_version="v0.1-ab-baseline")

    def _build_structured_context_section(self, rendered_variables: dict[str, str]) -> str:
        section = super()._build_structured_context_section(rendered_variables)
        return "\n".join(
            line
            for line in section.splitlines()
            if not line.startswith("SceneCausalityContract:")
        )


def build_prompt_items() -> list[PromptLibraryItemCreate]:
    common_fields: dict[str, Any] = {
        "target_module": "script_engine",
        "applicable_tags": ["genre.romance"],
        "target_platform": "tiktok",
        "target_audience": "US female 18-34",
        "input_variables": [
            "content_spec_json",
            "creative_brief_json",
            "platform_profile_json",
            "retrieved_assets_json",
            "generation_strategy_json",
            "output_language",
            "desired_scene_count",
            "target_duration_seconds",
            "output_json_schema",
        ],
        "output_schema": LLMGeneratedDraftMasterScript.model_json_schema(),
    }
    return [
        PromptLibraryItemCreate(
            id="prompt.story_planning.scene_causality_ab.baseline",
            name="Scene Causality A/B Baseline Prompt",
            prompt_type=PromptType.story_planning,
            version="v2-baseline",
            prompt_template=(
                "Generate a high-retention short-form dramatic episode from the supplied "
                "structured context. The opening hook must stop the scroll immediately, "
                "the protagonist must show agency, and the ending must force the next episode."
            ),
            evaluation_notes=["Pre-v0.2 generation instruction baseline."],
            **common_fields,
        ),
        PromptLibraryItemCreate(
            id="prompt.story_planning.scene_causality_ab.improved",
            name="Scene Causality A/B Improved Prompt",
            prompt_type=PromptType.story_planning,
            version="v3-scene-causality",
            prompt_template=(
                "Generate a high-retention short-form dramatic episode from the supplied "
                "structured context. The opening hook must stop the scroll immediately, "
                "the protagonist must show agency, and the ending must force the next episode. "
                "Build every scene around an immediate goal, a concrete conflict, and an "
                "outcome that changes the story state. Each later scene must be caused by an "
                "earlier outcome rather than merely following it."
            ),
            evaluation_notes=["Scene Causality v1 candidate instruction."],
            **common_fields,
        ),
        PromptLibraryItemCreate(
            id="prompt.platform_optimization.scene_causality_ab.shared",
            name="Scene Causality A/B Shared Platform Prompt",
            prompt_type=PromptType.tiktok_optimization,
            version="v1-shared",
            prompt_template=(
                "Apply the supplied PlatformProfile constraints. Keep the episode concise, "
                "performable, and clear for the requested output language."
            ),
            evaluation_notes=["Shared unchanged platform instruction."],
            **common_fields,
        ),
    ]


def build_strategy(*, variant: str, config: Any) -> GenerationStrategyCreate:
    prompt_id = f"prompt.story_planning.scene_causality_ab.{variant}"
    return GenerationStrategyCreate(
        id=f"strategy.scene_causality_ab.{variant}.v1",
        name=f"Scene Causality A/B {variant.title()}",
        target_platform="tiktok",
        target_content_type="ai_comic_drama",
        applicable_tags=["genre.romance"],
        model_provider=config.provider,
        model_name=config.model_name,
        temperature=TEMPERATURE,
        top_p=TOP_P,
        max_tokens=MAX_TOKENS,
        workflow_steps=[
            GenerationWorkflowStep(
                step_order=1,
                name="story_planning",
                description="Generate one structured first draft.",
                prompt_id=prompt_id,
                multi_turn_enabled=False,
                structured_output_required=True,
            ),
            GenerationWorkflowStep(
                step_order=2,
                name="platform_optimization",
                description="Apply the same platform constraints to both variants.",
                prompt_id="prompt.platform_optimization.scene_causality_ab.shared",
                multi_turn_enabled=False,
                structured_output_required=True,
            ),
        ],
        prompt_ids=[
            prompt_id,
            "prompt.platform_optimization.scene_causality_ab.shared",
        ],
        qc_enabled=True,
        self_check_enabled=False,
        human_review_required=True,
        output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
        version="v1",
        status=GenerationStrategyStatus.active,
    )


def main() -> None:
    config = get_llm_runtime_config()
    if config.use_mock_adapter:
        raise RuntimeError(
            "Scene Causality real A/B requires LLM_PROVIDER, LLM_MODEL, "
            "LLM_API_KEY and LLM_BASE_URL."
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    runner = PromptEvaluationRunner()
    adapter = config.build_adapter()
    manifest: dict[str, Any] = {
        "evaluation_id": "scene_causality_real_ab_v1",
        "decision_status": "pending_human_review",
        "model": {
            "provider": config.provider,
            "model_name": config.model_name,
            "temperature": TEMPERATURE,
            "top_p": TOP_P,
            "max_tokens": MAX_TOKENS,
        },
        "fixed_settings": {
            "output_language": OUTPUT_LANGUAGE,
            "desired_scene_count": DESIRED_SCENE_COUNT,
            "platform_profile_id": "tiktok_benchmark_v1",
            "generations_per_variant": 1,
        },
        "comparison_note": (
            "Both variants use the current structured output schema. The baseline removes "
            "the v0.2 SceneCausalityContract and uses the previous story-planning instruction; "
            "the improved variant uses Prompt Builder v0.2 and the Scene Causality prompt."
        ),
        "samples": [],
    }

    for dataset_id in DATASET_IDS:
        scenario = runner.load_scenario(
            dataset_id=dataset_id,
            dataset_type=BenchmarkDatasetType.benchmark,
        )
        runtime = runner._build_runtime()  # noqa: SLF001 - bounded evaluation runner
        runtime.script_generation_service._llm_adapter = adapter  # noqa: SLF001
        for prompt_item in build_prompt_items():
            runtime.ensure_prompt_item(prompt_item)

        baseline_strategy = build_strategy(variant="baseline", config=config)
        improved_strategy = build_strategy(variant="improved", config=config)
        runtime.ensure_generation_strategy(baseline_strategy)
        runtime.ensure_generation_strategy(improved_strategy)

        pipeline = runtime.data_intelligence_service.run_records_pipeline(
            scenario.records,
            platform_profile_id="tiktok_benchmark_v1",
            audience_hint=scenario.audience_hint,
            commercial_objective=scenario.commercial_objective,
        ) if not (OUTPUT_DIR / dataset_id / "content_spec.json").exists() else None
        sample_dir = OUTPUT_DIR / dataset_id
        sample_dir.mkdir(parents=True, exist_ok=True)
        content_spec_path = sample_dir / "content_spec.json"
        if pipeline is None:
            content_spec = ContentSpec.model_validate(_read_json(content_spec_path))
            runtime.script_generation_service._content_spec_repository.save(  # noqa: SLF001
                content_spec
            )
        else:
            content_spec = pipeline.content_spec
            _write_json(content_spec_path, content_spec.model_dump(mode="json"))

        sample_record: dict[str, Any] = {
            "dataset_id": dataset_id,
            "content_spec_id": content_spec.id,
            "content_spec_path": str(content_spec_path.relative_to(ROOT_DIR)),
            "baseline": None,
            "improved": None,
            "human_review": {
                "scores": None,
                "comparison": None,
                "preferred_variant": None,
                "uncertainty_notes": None,
            },
        }
        manifest["samples"].append(sample_record)
        _write_json(OUTPUT_DIR / "manifest.json", manifest)

        runs: dict[str, Any] = {}
        for variant, strategy, prompt_builder in (
            ("baseline", baseline_strategy, PreviousTemplatePromptBuilder()),
            ("improved", improved_strategy, TemplatePromptBuilder(builder_version="v0.2")),
        ):
            runtime.script_generation_service._prompt_builder = prompt_builder  # noqa: SLF001
            completed_run = _load_completed_run(sample_dir, variant)
            if completed_run is not None:
                runs[variant] = completed_run
                sample_record[variant] = completed_run
                _write_json(OUTPUT_DIR / "manifest.json", manifest)
                print(f"Resumed {dataset_id}: skipped completed {variant}")
                continue

            draft_run = runtime.script_generation_service.generate_draft(
                ScriptGenerationDraftRequest(
                    content_spec_id=content_spec.id,
                    generation_strategy_id=strategy.id,
                    output_language=OUTPUT_LANGUAGE,
                    desired_scene_count=DESIRED_SCENE_COUNT,
                )
            )
            draft_path = sample_dir / f"{variant}_draft.json"
            prompt_path = sample_dir / f"{variant}_prompt.txt"
            run_path = sample_dir / f"{variant}_run.json"
            _write_json(
                draft_path,
                draft_run.draft_master_script.model_dump(mode="json"),
            )
            prompt_path.write_text(
                draft_run.prompt_build_result.prompt_text,
                encoding="utf-8",
            )
            run_metadata = {
                "draft_id": draft_run.draft_master_script.id,
                "strategy_id": strategy.id,
                "strategy_version": strategy.version,
                "prompt_ids": draft_run.selected_prompt_ids,
                "prompt_versions": [
                    prompt.version for prompt in draft_run.prompt_retrieval_result.prompts
                ],
                "prompt_builder_version": draft_run.prompt_build_result.trace.builder_version,
                "draft_path": str(draft_path.relative_to(ROOT_DIR)),
                "prompt_path": str(prompt_path.relative_to(ROOT_DIR)),
            }
            _write_json(run_path, run_metadata)
            runs[variant] = run_metadata
            sample_record[variant] = run_metadata
            _write_json(OUTPUT_DIR / "manifest.json", manifest)

        print(f"Completed {dataset_id}: baseline + improved")

    _write_json(OUTPUT_DIR / "manifest.json", manifest)
    print(f"Artifacts: {OUTPUT_DIR.relative_to(ROOT_DIR)}")
    print("Decision status: pending_human_review")


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_completed_run(sample_dir: Path, variant: str) -> dict[str, Any] | None:
    required_paths = (
        sample_dir / f"{variant}_draft.json",
        sample_dir / f"{variant}_prompt.txt",
        sample_dir / f"{variant}_run.json",
    )
    existing_paths = [path.exists() for path in required_paths]
    if not any(existing_paths):
        return None
    if not all(existing_paths):
        raise RuntimeError(
            f"Incomplete checkpoint for {sample_dir.name}/{variant}; "
            "preserve the existing files for manual inspection before retrying."
        )
    run_metadata = _read_json(required_paths[2])
    if not isinstance(run_metadata, dict):
        raise RuntimeError(f"Invalid checkpoint metadata: {required_paths[2]}")
    return run_metadata


if __name__ == "__main__":
    main()
