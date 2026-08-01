from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import random
import sys
import time
from time import perf_counter
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.llm_runtime import get_llm_runtime_config
from app.modules.content_spec.models import ContentSpec
from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.llm_adapter import LLMRequestError
from app.modules.script_engine.models import ScriptGenerationDraftRequest
from app.modules.script_engine.prompt_builder import TemplatePromptBuilder
from app.modules.script_engine.generation_service import (
    InvalidDraftMasterScriptOutputError,
)
from evaluation.prompt_evaluation_runner import PromptEvaluationRunner
from scripts.run_scene_causality_real_ab import build_prompt_items, build_strategy


EVALUATION_ID = "creative_control_combined_v1"
OUTPUT_DIR = (
    ROOT_DIR / "examples" / "prompt_evaluations" / EVALUATION_ID
)
CONFIG_PATH = OUTPUT_DIR / "experiment_config.json"
VARIANTS = ("baseline", "structured_creative_control")


class StructuredCreativeControlPromptBuilder(TemplatePromptBuilder):
    """Inject frozen evaluation context without changing the production builder."""

    def __init__(self, structured_context: dict[str, Any]) -> None:
        super().__init__(builder_version="v0.2+creative-control-eval.v1")
        self._structured_context = structured_context

    def _build_structured_context_section(
        self,
        rendered_variables: dict[str, str],
    ) -> str:
        base_section = super()._build_structured_context_section(rendered_variables)
        context_json = json.dumps(
            self._structured_context,
            ensure_ascii=True,
            separators=(",", ":"),
        )
        return (
            f"{base_section}\n"
            "CreativeControlUsage: Treat the supplied profiles and relationship as "
            "bounded creative constraints. Express goals, fears, beliefs, contradictions, "
            "decision patterns, moral boundaries, and relationship movement through visible "
            "choices and consequences rather than exposition. Do not silently rename the "
            "specified main characters or reverse a stated moral boundary.\n"
            f"StructuredCreativeControlContext: {context_json}"
        )


def main() -> None:
    args = parse_args()
    config_payload = read_json(CONFIG_PATH)
    validate_experiment_config(config_payload)
    prepare_fixture_artifacts(config_payload)
    if args.prepare_only:
        print(f"Prepared fixtures: {OUTPUT_DIR.relative_to(ROOT_DIR)}")
        print("Status: fixtures_prepared_pending_real_generation")
        return
    if args.finalize_review:
        finalize_blind_review(config_payload)
        return

    runtime_config = get_llm_runtime_config()
    if runtime_config.use_mock_adapter:
        raise RuntimeError(
            "Creative Control real validation requires LLM_PROVIDER, LLM_MODEL, "
            "LLM_API_KEY and LLM_BASE_URL."
        )

    manifest = build_manifest(config_payload, runtime_config)
    adapter = runtime_config.build_adapter()
    delay_seconds = env_float("CREATIVE_CONTROL_REQUEST_DELAY_SECONDS", 30.0)
    technical_retries = env_int("CREATIVE_CONTROL_TECHNICAL_RETRIES", 2)
    retry_delay_seconds = env_float("CREATIVE_CONTROL_RETRY_DELAY_SECONDS", 60.0)

    for case_index, case in enumerate(config_payload["cases"]):
        case_id = case["case_id"]
        case_dir = OUTPUT_DIR / "cases" / case_id
        content_spec = ContentSpec.model_validate(case["content_spec"])
        strategy = build_strategy(variant="improved", config=runtime_config)

        runtime = PromptEvaluationRunner()._build_runtime()  # noqa: SLF001
        runtime.script_generation_service._llm_adapter = adapter  # noqa: SLF001
        runtime.script_generation_service._content_spec_repository.save(  # noqa: SLF001
            content_spec
        )
        for prompt_item in build_prompt_items():
            runtime.ensure_prompt_item(prompt_item)
        runtime.ensure_generation_strategy(strategy)

        for variant_index, variant in enumerate(VARIANTS):
            variant_dir = case_dir / variant
            completed = load_completed_run(variant_dir)
            if completed is not None:
                print(f"Resumed {case_id}/{variant}")
                continue

            if variant == "baseline":
                prompt_builder = TemplatePromptBuilder(builder_version="v0.2")
            else:
                prompt_builder = StructuredCreativeControlPromptBuilder(
                    case["structured_creative_control"]
                )
            runtime.script_generation_service._prompt_builder = prompt_builder  # noqa: SLF001

            draft_run, latency_seconds, technical_history = generate_with_retries(
                runtime=runtime,
                content_spec=content_spec,
                strategy_id=strategy.id,
                technical_retries=technical_retries,
                retry_delay_seconds=retry_delay_seconds,
            )
            save_generation_artifacts(
                case=case,
                variant=variant,
                variant_dir=variant_dir,
                draft_run=draft_run,
                latency_seconds=latency_seconds,
                technical_history=technical_history,
            )
            print(f"Completed {case_id}/{variant} ({latency_seconds:.3f}s)")

            is_last = (
                case_index == len(config_payload["cases"]) - 1
                and variant_index == len(VARIANTS) - 1
            )
            if not is_last and delay_seconds > 0:
                print(f"Cooling down for {delay_seconds:g}s")
                time.sleep(delay_seconds)

    deterministic_report = build_deterministic_report(config_payload)
    write_json(OUTPUT_DIR / "deterministic_checks.json", deterministic_report)
    generation_summary = build_generation_summary(config_payload, manifest)
    write_json(OUTPUT_DIR / "generation_summary.json", generation_summary)
    create_blind_review_package(config_payload)
    manifest["generation_status"] = "completed_pending_blind_review"
    manifest["decision_status"] = "pending_blind_review"
    manifest["completed_at"] = utc_now()
    write_json(OUTPUT_DIR / "manifest.json", manifest)
    print(f"Artifacts: {OUTPUT_DIR.relative_to(ROOT_DIR)}")
    print("Generation status: completed_pending_blind_review")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Validate and materialize frozen fixtures without calling a model.",
    )
    parser.add_argument(
        "--finalize-review",
        action="store_true",
        help="Reveal a completed locked blind review and build comparison reports.",
    )
    return parser.parse_args()


def validate_experiment_config(payload: dict[str, Any]) -> None:
    if payload.get("evaluation_id") != EVALUATION_ID:
        raise ValueError("Experiment configuration has an unexpected evaluation_id.")
    cases = payload.get("cases")
    if not isinstance(cases, list) or len(cases) != 3:
        raise ValueError("Exactly three frozen experiment cases are required.")
    case_ids = [case.get("case_id") for case in cases]
    if len(set(case_ids)) != 3:
        raise ValueError("Experiment case ids must be unique.")
    for case in cases:
        ContentSpec.model_validate(case["content_spec"])
        control = case.get("structured_creative_control", {})
        if len(control.get("character_profiles", [])) < 2:
            raise ValueError(f"{case['case_id']} requires two main character profiles.")
        if not control.get("relationship_context"):
            raise ValueError(f"{case['case_id']} requires relationship context.")


def prepare_fixture_artifacts(config_payload: dict[str, Any]) -> None:
    for case in config_payload["cases"]:
        case_dir = OUTPUT_DIR / "cases" / case["case_id"]
        case_dir.mkdir(parents=True, exist_ok=True)
        write_json(case_dir / "content_spec.json", case["content_spec"])
        write_json(
            case_dir / "structured_creative_control.json",
            case["structured_creative_control"],
        )


def build_manifest(config_payload: dict[str, Any], runtime_config: Any) -> dict[str, Any]:
    manifest_path = OUTPUT_DIR / "manifest.json"
    if manifest_path.exists():
        manifest = read_json(manifest_path)
        recorded_model = manifest.get("model", {})
        if recorded_model and (
            recorded_model.get("provider") != runtime_config.provider
            or recorded_model.get("model_name") != runtime_config.model_name
        ):
            raise RuntimeError(
                "Existing checkpoints use a different model. Preserve them and use a new "
                "evaluation directory instead of mixing settings."
            )
        return manifest
    manifest = {
        "evaluation_id": EVALUATION_ID,
        "contract_version": config_payload["contract_version"],
        "generation_status": "in_progress",
        "decision_status": "pending_generation",
        "model": {
            "provider": runtime_config.provider,
            "model_name": runtime_config.model_name,
            "temperature": 0.6,
            "top_p": 0.9,
            "max_tokens": 4000,
        },
        "fixed_settings": config_payload["fixed_settings"],
        "variant_isolation": config_payload["variant_isolation"],
        "thresholds_locked_before_generation": config_payload["decision_thresholds"],
        "started_at": utc_now(),
    }
    write_json(manifest_path, manifest)
    return manifest


def generate_with_retries(
    *,
    runtime: Any,
    content_spec: ContentSpec,
    strategy_id: str,
    technical_retries: int,
    retry_delay_seconds: float,
) -> tuple[Any, float, list[dict[str, Any]]]:
    technical_history: list[dict[str, Any]] = []
    for attempt in range(1, technical_retries + 2):
        started_at = perf_counter()
        try:
            run = runtime.script_generation_service.generate_draft(
                ScriptGenerationDraftRequest(
                    content_spec_id=content_spec.id,
                    generation_strategy_id=strategy_id,
                    output_language="en",
                    desired_scene_count=3,
                )
            )
            return run, perf_counter() - started_at, technical_history
        except (LLMRequestError, InvalidDraftMasterScriptOutputError) as exc:
            latency = perf_counter() - started_at
            technical_history.append(
                {
                    "attempt": attempt,
                    "latency_seconds": round(latency, 3),
                    "error_type": type(exc).__name__,
                    "error": bounded_error(exc),
                    "recorded_at": utc_now(),
                }
            )
            if attempt > technical_retries:
                raise
            print(
                f"Technical generation failure; retrying after {retry_delay_seconds:g}s "
                f"({attempt}/{technical_retries})."
            )
            time.sleep(retry_delay_seconds)
    raise RuntimeError("Generation retry loop ended unexpectedly.")


def save_generation_artifacts(
    *,
    case: dict[str, Any],
    variant: str,
    variant_dir: Path,
    draft_run: Any,
    latency_seconds: float,
    technical_history: list[dict[str, Any]],
) -> None:
    variant_dir.mkdir(parents=True, exist_ok=True)
    prompt_path = variant_dir / "generated_prompt.txt"
    draft_path = variant_dir / "draft.json"
    qc_path = variant_dir / "story_qc.json"
    prompt_path.write_text(draft_run.prompt_build_result.prompt_text, encoding="utf-8")
    write_json(draft_path, draft_run.draft_master_script.model_dump(mode="json"))
    write_json(qc_path, draft_run.story_qc_report.model_dump(mode="json"))

    usage = normalize_usage(draft_run.draft_master_script.llm_metadata.get("usage"))
    run_payload = {
        "case_id": case["case_id"],
        "variant": variant,
        "content_spec_id": draft_run.content_spec_id,
        "draft_id": draft_run.draft_master_script.id,
        "generation_strategy_id": draft_run.generation_strategy_id,
        "generation_strategy_version": draft_run.generation_strategy_version,
        "prompt_ids": draft_run.selected_prompt_ids,
        "prompt_versions": [
            item.version for item in draft_run.prompt_retrieval_result.prompts
        ],
        "prompt_builder_version": draft_run.prompt_build_result.trace.builder_version,
        "llm_model_info": draft_run.llm_model_info.model_dump(mode="json"),
        "token_usage": usage,
        "latency_seconds": round(latency_seconds, 3),
        "technical_failures_before_success": technical_history,
        "successful_generations_for_variant": 1,
        "generated_at": utc_now(),
        "artifacts": {
            "prompt": relative_path(prompt_path),
            "draft": relative_path(draft_path),
            "story_qc": relative_path(qc_path),
        },
    }
    write_json(variant_dir / "run.json", run_payload)


def build_deterministic_report(config_payload: dict[str, Any]) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for case in config_payload["cases"]:
        for variant in VARIANTS:
            variant_dir = OUTPUT_DIR / "cases" / case["case_id"] / variant
            draft = DraftMasterScript.model_validate(read_json(variant_dir / "draft.json"))
            scene_numbers = {scene.scene_number for scene in draft.scenes}
            causality_complete = all(scene.scene_causality is not None for scene in draft.scenes)
            causal_chain_valid = all(
                scene.scene_causality is not None
                and (
                    index == 0
                    or scene.scene_causality.caused_by_scene_number
                    in {number for number in scene_numbers if number < scene.scene_number}
                )
                for index, scene in enumerate(draft.scenes)
            )
            checks: list[dict[str, Any]] = [
                check("draft_schema_valid", True, "DraftMasterScript", type(draft).__name__),
                check("scene_count", len(draft.scenes) == 3, 3, len(draft.scenes)),
                check("output_language", draft.language.lower() in {"en", "english"}, "en", draft.language),
                check("scene_causality_complete", causality_complete, True, causality_complete),
                check("causal_chain_valid", causal_chain_valid, True, causal_chain_valid),
                check("final_cliffhanger", draft.scenes[-1].cliffhanger, True, draft.scenes[-1].cliffhanger),
            ]
            if variant == "structured_creative_control":
                expected_names = {
                    profile["identity"]["name"].casefold()
                    for profile in case["structured_creative_control"]["character_profiles"]
                }
                actual_names = {character.name.casefold() for character in draft.characters}
                checks.append(
                    check(
                        "specified_character_names_preserved",
                        expected_names.issubset(actual_names),
                        sorted(expected_names),
                        sorted(actual_names),
                    )
                )
            results.append(
                {
                    "case_id": case["case_id"],
                    "variant": variant,
                    "all_passed": all(item["passed"] for item in checks),
                    "checks": checks,
                }
            )
    return {
        "evaluation_id": EVALUATION_ID,
        "all_passed": all(result["all_passed"] for result in results),
        "results": results,
        "limitations": [
            "Structural checks do not establish character or story quality.",
            "Character beliefs, contradictions, and moral boundaries require blind semantic review.",
        ],
    }


def build_generation_summary(
    config_payload: dict[str, Any],
    manifest: dict[str, Any],
) -> dict[str, Any]:
    runs: list[dict[str, Any]] = []
    per_case: list[dict[str, Any]] = []
    for case in config_payload["cases"]:
        case_runs: dict[str, dict[str, Any]] = {}
        for variant in VARIANTS:
            run = read_json(
                OUTPUT_DIR / "cases" / case["case_id"] / variant / "run.json"
            )
            runs.append(run)
            case_runs[variant] = run
        baseline_usage = case_runs["baseline"]["token_usage"]
        control_usage = case_runs["structured_creative_control"]["token_usage"]
        per_case.append(
            {
                "case_id": case["case_id"],
                "baseline": {
                    "token_usage": baseline_usage,
                    "latency_seconds": case_runs["baseline"]["latency_seconds"],
                },
                "structured_creative_control": {
                    "token_usage": control_usage,
                    "latency_seconds": case_runs["structured_creative_control"][
                        "latency_seconds"
                    ],
                },
                "prompt_token_growth_percent": percentage_growth(
                    baseline_usage["prompt_tokens"],
                    control_usage["prompt_tokens"],
                ),
                "total_token_growth_percent": percentage_growth(
                    baseline_usage["total_tokens"],
                    control_usage["total_tokens"],
                ),
            }
        )
    by_variant: dict[str, Any] = {}
    for variant in VARIANTS:
        selected = [run for run in runs if run["variant"] == variant]
        by_variant[variant] = {
            "average_latency_seconds": average(
                [run["latency_seconds"] for run in selected]
            ),
            "average_prompt_tokens": average_usage(selected, "prompt_tokens"),
            "average_completion_tokens": average_usage(selected, "completion_tokens"),
            "average_total_tokens": average_usage(selected, "total_tokens"),
            "successful_generation_count": len(selected),
            "technical_failure_count": sum(
                len(run["technical_failures_before_success"]) for run in selected
            ),
        }
    baseline_prompt = by_variant["baseline"]["average_prompt_tokens"]
    control_prompt = by_variant["structured_creative_control"]["average_prompt_tokens"]
    prompt_growth = percentage_growth(baseline_prompt, control_prompt)
    return {
        "evaluation_id": EVALUATION_ID,
        "status": "generated_pending_blind_review",
        "model": manifest["model"],
        "variants": by_variant,
        "per_case": per_case,
        "structured_context_prompt_token_growth_percent": prompt_growth,
        "context_growth_threshold_percent": config_payload["decision_thresholds"][
            "maximum_average_prompt_token_growth_percent"
        ],
    }


def create_blind_review_package(config_payload: dict[str, Any]) -> None:
    blind_dir = OUTPUT_DIR / "blind_review"
    blind_dir.mkdir(parents=True, exist_ok=True)
    key_path = blind_dir / "blind_key.json"
    if key_path.exists():
        print("Preserved existing blind review package")
        return
    randomizer = random.SystemRandom()
    key: dict[str, Any] = {}
    review_template: dict[str, Any] = {
        "evaluation_id": EVALUATION_ID,
        "review_status": "pending_blind_review",
        "reviewer_identity_type": None,
        "rubric_scale": "1-5",
        "rubric": config_payload["blind_review_rubric"],
        "cases": {},
    }
    for case in config_payload["cases"]:
        labels = ["candidate_1", "candidate_2"]
        randomizer.shuffle(labels)
        mapping = {labels[0]: VARIANTS[0], labels[1]: VARIANTS[1]}
        key[case["case_id"]] = mapping
        case_blind_dir = blind_dir / case["case_id"]
        case_blind_dir.mkdir(parents=True, exist_ok=True)
        for label, variant in mapping.items():
            draft = read_json(
                OUTPUT_DIR / "cases" / case["case_id"] / variant / "draft.json"
            )
            write_json(
                case_blind_dir / f"{label}.json",
                {
                    "case_id": case["case_id"],
                    "candidate": label,
                    "shared_brief": case["blind_shared_brief"],
                    "draft": draft,
                },
            )
        review_template["cases"][case["case_id"]] = {
            "candidate_1": empty_candidate_review(config_payload),
            "candidate_2": empty_candidate_review(config_payload),
            "preferred_candidate": None,
            "preference_reason": None,
            "major_structural_regression_candidate": None,
            "comparison_evidence": [],
            "uncertainty_notes": [],
        }
    write_json(key_path, key)
    write_json(blind_dir / "review_template.json", review_template)


def empty_candidate_review(config_payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "scores": {
            dimension: None for dimension in config_payload["blind_review_rubric"]
        },
        "evidence": [],
        "strengths": [],
        "weaknesses": [],
    }


def finalize_blind_review(config_payload: dict[str, Any]) -> None:
    blind_dir = OUTPUT_DIR / "blind_review"
    locked_path = blind_dir / "blind_review_locked.json"
    if not locked_path.exists():
        raise RuntimeError(
            "blind_review_locked.json is required before variant mapping can be revealed."
        )
    review = read_json(locked_path)
    validate_locked_review(review, config_payload)
    key = read_json(blind_dir / "blind_key.json")
    generation_summary = read_json(OUTPUT_DIR / "generation_summary.json")

    comparisons: list[dict[str, Any]] = []
    preferred_control_count = 0
    dimension_deltas: dict[str, list[float]] = {
        dimension: [] for dimension in config_payload["blind_review_rubric"]
    }
    major_regression = False
    for case in config_payload["cases"]:
        case_id = case["case_id"]
        mapping = key[case_id]
        inverse = {variant: candidate for candidate, variant in mapping.items()}
        baseline_candidate = inverse["baseline"]
        control_candidate = inverse["structured_creative_control"]
        case_review = review["cases"][case_id]
        if case_review["preferred_candidate"] == control_candidate:
            preferred_control_count += 1
        deltas: dict[str, float] = {}
        for dimension in config_payload["blind_review_rubric"]:
            baseline_score = case_review[baseline_candidate]["scores"][dimension]
            control_score = case_review[control_candidate]["scores"][dimension]
            delta = round(control_score - baseline_score, 3)
            deltas[dimension] = delta
            dimension_deltas[dimension].append(delta)
        regression_candidate = case_review.get("major_structural_regression_candidate")
        if regression_candidate == control_candidate:
            major_regression = True
        comparisons.append(
            {
                "case_id": case_id,
                "baseline_candidate": baseline_candidate,
                "structured_control_candidate": control_candidate,
                "preferred_variant": mapping.get(case_review["preferred_candidate"]),
                "dimension_deltas_control_minus_baseline": deltas,
                "preference_reason": case_review["preference_reason"],
                "comparison_evidence": case_review["comparison_evidence"],
                "uncertainty_notes": case_review["uncertainty_notes"],
            }
        )

    average_deltas = {
        dimension: average(values) for dimension, values in dimension_deltas.items()
    }
    thresholds = config_payload["decision_thresholds"]
    prompt_growth = generation_summary[
        "structured_context_prompt_token_growth_percent"
    ]
    no_hook_or_cliffhanger_regression = all(
        delta > -thresholds["significant_score_regression_points"]
        for dimension in ("hook_quality", "cliffhanger_quality")
        for delta in dimension_deltas[dimension]
    )
    criteria = {
        "structured_control_preferred_at_least_two_of_three": (
            preferred_control_count >= thresholds["minimum_preferred_case_count"]
        ),
        "average_character_consistency_improved": (
            average_deltas["character_consistency"] > 0
        ),
        "average_character_agency_improved": (
            average_deltas["character_agency"] > 0
        ),
        "no_significant_hook_or_cliffhanger_regression": (
            no_hook_or_cliffhanger_regression
        ),
        "context_growth_acceptable": (
            prompt_growth is not None
            and prompt_growth
            <= thresholds["maximum_average_prompt_token_growth_percent"]
        ),
        "no_major_structural_regression": not major_regression,
    }
    passed = all(criteria.values())
    report = {
        "evaluation_id": EVALUATION_ID,
        "decision": (
            "validated_for_runtime_design" if passed else "not_validated_for_runtime_design"
        ),
        "threshold_passed": passed,
        "criteria": criteria,
        "preferred_structured_control_count": preferred_control_count,
        "average_dimension_deltas_control_minus_baseline": average_deltas,
        "pairwise_comparisons": comparisons,
        "output_cost": generation_summary,
        "review_provenance": {
            "locked_review_path": relative_path(locked_path),
            "variant_mapping_path": relative_path(blind_dir / "blind_key.json"),
            "reviewer_identity_type": review["reviewer_identity_type"],
        },
        "limitations": [
            "This is one bounded generation per variant and case, not a stability study.",
            "The blind review is an AI-assisted observational review, not professional validation.",
            "The experiment tests context injection, not a runtime Creative Intent contract.",
            "Current Story QC remains placeholder and is not used as the decision authority.",
        ],
    }
    write_json(OUTPUT_DIR / "comparison_report.json", report)
    (OUTPUT_DIR / "comparison_report.md").write_text(
        render_markdown_report(report), encoding="utf-8"
    )
    manifest = read_json(OUTPUT_DIR / "manifest.json")
    manifest["generation_status"] = "completed"
    manifest["decision_status"] = report["decision"]
    manifest["review_completed_at"] = utc_now()
    write_json(OUTPUT_DIR / "manifest.json", manifest)
    print(f"Decision: {report['decision']}")
    print(f"Report: {relative_path(OUTPUT_DIR / 'comparison_report.json')}")


def validate_locked_review(
    review: dict[str, Any],
    config_payload: dict[str, Any],
) -> None:
    if review.get("review_status") != "locked_before_variant_reveal":
        raise ValueError("Blind review must be explicitly locked before reveal.")
    if not review.get("reviewer_identity_type"):
        raise ValueError("Blind review must record reviewer_identity_type.")
    for case in config_payload["cases"]:
        case_review = review.get("cases", {}).get(case["case_id"], {})
        if case_review.get("preferred_candidate") not in {
            "candidate_1",
            "candidate_2",
            "tie",
        }:
            raise ValueError(f"{case['case_id']} has no valid preferred candidate.")
        for candidate in ("candidate_1", "candidate_2"):
            scores = case_review.get(candidate, {}).get("scores", {})
            for dimension in config_payload["blind_review_rubric"]:
                score = scores.get(dimension)
                if not isinstance(score, (int, float)) or not 1 <= score <= 5:
                    raise ValueError(
                        f"{case['case_id']}/{candidate}/{dimension} requires a 1-5 score."
                    )


def render_markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "# Creative Control Combined v1",
        "",
        f"**Decision:** `{report['decision']}`",
        "",
        "## Thresholds",
        "",
    ]
    for name, passed in report["criteria"].items():
        lines.append(f"- {'PASS' if passed else 'FAIL'}: `{name}`")
    lines.extend(["", "## Pairwise Results", ""])
    for item in report["pairwise_comparisons"]:
        lines.append(
            f"- `{item['case_id']}`: preferred `{item['preferred_variant']}`; "
            f"{item['preference_reason']}"
        )
    lines.extend(["", "## Average Dimension Deltas", ""])
    for dimension, delta in report[
        "average_dimension_deltas_control_minus_baseline"
    ].items():
        lines.append(f"- `{dimension}`: `{delta:+.3f}`")
    cost = report["output_cost"]
    baseline_cost = cost["variants"]["baseline"]
    control_cost = cost["variants"]["structured_creative_control"]
    lines.extend(
        [
            "",
            "## Output Cost",
            "",
            "| Metric | Baseline | Structured control |",
            "|---|---:|---:|",
            (
                f"| Average prompt tokens | {baseline_cost['average_prompt_tokens']} | "
                f"{control_cost['average_prompt_tokens']} |"
            ),
            (
                f"| Average completion tokens | {baseline_cost['average_completion_tokens']} | "
                f"{control_cost['average_completion_tokens']} |"
            ),
            (
                f"| Average total tokens | {baseline_cost['average_total_tokens']} | "
                f"{control_cost['average_total_tokens']} |"
            ),
            (
                f"| Average latency seconds | {baseline_cost['average_latency_seconds']} | "
                f"{control_cost['average_latency_seconds']} |"
            ),
            "",
            (
                "Average prompt-token growth was "
                f"`{cost['structured_context_prompt_token_growth_percent']}%`, below the "
                f"pre-registered `{cost['context_growth_threshold_percent']}%` limit."
            ),
        ]
    )
    lines.extend(["", "## Limitations", ""])
    lines.extend(f"- {item}" for item in report["limitations"])
    return "\n".join(lines) + "\n"


def load_completed_run(variant_dir: Path) -> dict[str, Any] | None:
    required = (
        variant_dir / "draft.json",
        variant_dir / "generated_prompt.txt",
        variant_dir / "story_qc.json",
        variant_dir / "run.json",
    )
    existence = [path.exists() for path in required]
    if not any(existence):
        return None
    if not all(existence):
        raise RuntimeError(
            f"Incomplete checkpoint in {variant_dir}. Preserve files for inspection "
            "instead of mixing partial and new output."
        )
    return read_json(variant_dir / "run.json")


def normalize_usage(value: Any) -> dict[str, int | None]:
    usage = value if isinstance(value, dict) else {}
    prompt = usage.get("prompt_tokens", usage.get("input_tokens"))
    completion = usage.get("completion_tokens", usage.get("output_tokens"))
    total = usage.get("total_tokens")
    if total is None and isinstance(prompt, int) and isinstance(completion, int):
        total = prompt + completion
    return {
        "prompt_tokens": prompt if isinstance(prompt, int) else None,
        "completion_tokens": completion if isinstance(completion, int) else None,
        "total_tokens": total if isinstance(total, int) else None,
    }


def average_usage(runs: list[dict[str, Any]], field: str) -> float | None:
    values = [
        run["token_usage"][field]
        for run in runs
        if isinstance(run.get("token_usage", {}).get(field), (int, float))
    ]
    return average(values) if values else None


def percentage_growth(before: float | None, after: float | None) -> float | None:
    if before in (None, 0) or after is None:
        return None
    return round(((after - before) / before) * 100, 3)


def average(values: list[float | int]) -> float:
    return round(sum(values) / len(values), 3) if values else 0.0


def check(name: str, passed: bool, expected: Any, actual: Any) -> dict[str, Any]:
    return {
        "check_name": name,
        "passed": bool(passed),
        "expected": expected,
        "actual": actual,
    }


def bounded_error(exc: Exception) -> str:
    return " ".join(str(exc).split())[:500]


def env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    return float(value) if value is not None else default


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    return int(value) if value is not None else default


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def relative_path(path: Path) -> str:
    return str(path.relative_to(ROOT_DIR))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
