from __future__ import annotations

import json
import os
from pathlib import Path
import random
import sys
from time import perf_counter, sleep
from typing import Any

from pydantic import ValidationError


ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
for import_path in (ROOT_DIR, BACKEND_DIR):
    if str(import_path) not in sys.path:
        sys.path.insert(0, str(import_path))

from app.llm_runtime import get_llm_runtime_config
from app.modules.master_script.models import LLMGeneratedDraftMasterScript
from app.modules.script_engine.llm_adapter import RealLLMAdapter
from app.modules.script_engine.models import (
    GenerationStrategyCreate,
    GenerationStrategyStatus,
    GenerationWorkflowStep,
)


OUTPUT_DIR = (
    ROOT_DIR
    / "examples"
    / "prompt_evaluations"
    / "serialized_story_planning_real_ab_v1_1_bounded"
)
EVALUATION_ID = "serialized_story_planning_real_ab_v1_1_bounded"
CONTRACT_VERSION = "serialized_story_planning_contract.v1.1-candidate"
PROMPT_VERSION = "serialized_story_planning_offline_ab.v1.1-revalidation"
FINAL_EPISODE_SCHEMA_PATCH_VERSION = (
    "serialized_story_planning_offline_ab.v1.1-revalidation.final-scene-flag-patch1"
)
STRATEGY_ID = "strategy.serialized_story_planning.offline_ab.v1.1-revalidation"
OUTPUT_LANGUAGE = "en"
PLATFORM_PROFILE_ID = "tiktok_benchmark_v1"
EPISODE_COUNT = 4
SCENE_COUNT = 3
TARGET_DURATION_SECONDS = 90
TEMPERATURE = 0.6
TOP_P = 0.9
MAX_TOKENS = 4000
REASONING_EFFORT = "low"
REQUEST_DELAY_SECONDS = max(
    0.0,
    float(os.environ.get("SERIALIZED_AB_REQUEST_DELAY_SECONDS", "20")),
)
RATE_LIMIT_RETRY_COUNT = max(
    0,
    int(os.environ.get("SERIALIZED_AB_429_RETRIES", "2")),
)
RATE_LIMIT_COOLDOWN_SECONDS = max(
    0.0,
    float(os.environ.get("SERIALIZED_AB_429_COOLDOWN_SECONDS", "180")),
)
SCHEMA_RETRY_COUNT = max(
    0,
    int(os.environ.get("SERIALIZED_AB_SCHEMA_RETRIES", "2")),
)
SCHEMA_RETRY_DELAY_SECONDS = max(
    0.0,
    float(os.environ.get("SERIALIZED_AB_SCHEMA_RETRY_DELAY_SECONDS", "30")),
)
GENERATION_ORDER = (
    "supernatural_romance/direct/episodes_01_to_04",
    "supernatural_romance/planned_v1_1/episodes_01_to_04",
    "revenge_drama/direct/episodes_01_to_04",
    "revenge_drama/planned_v1_1/episodes_01_to_04",
)

ALLOWED_EPISODE_PLAN_FIELDS = {
    "episode_number",
    "episode_purpose",
    "entry_state",
    "required_state_change",
    "protagonist_decision",
    "planned_reveal",
    "setup_refs",
    "payoff_refs",
    "exit_state",
    "escalation_requirement",
    "emotional_requirement",
}
FORBIDDEN_EPISODE_PLAN_FIELDS = {
    "episode_goal",
    "central_conflict",
    "reveal",
    "emotional_movement",
    "cliffhanger",
    "scenes",
    "dialogue",
}

FIXTURES: tuple[dict[str, Any], ...] = (
    {
        "story_id": "supernatural_romance",
        "story_title": "Supernatural Romance",
        "role": "primary_failure_case",
        "content_spec_summary": {
            "audience": "English-speaking viewers who prefer supernatural mystery, restrained romance, and identity conflict",
            "platform": "TikTok-oriented vertical serialized fiction",
            "language": "English",
            "episode_duration_seconds": 90,
            "desired_scene_count": 3,
            "tone": "Eerie, tender, urgent",
            "story_goal": "A paramedic who hears final memories works with an immortal stranger whose identity is being consumed by a supernatural exchange.",
            "constraints": [
                "Romance grows through decisions and shared cost.",
                "Supernatural rules remain consistent.",
                "Do not use a destiny-mate shortcut.",
            ],
        },
        "story_blueprint": {
            "core_premise": "Paramedic Nia Calder hears a dying patient's final memory and finds immortal archivist Rowan inside it, while an entity exchanges human survival for stolen memory.",
            "series_dramatic_promise": "Nia and Rowan reconstruct trust while uncovering a supernatural economy that makes memory, rescue, and consent inseparable.",
            "central_conflict": "Nia refuses to abandon people in danger; Rowan fears that opposing the exchange will erase the evidence and identity needed to defeat it.",
            "theme": "Love is not perfect remembrance; it is the choice to know someone again.",
            "ending_direction": "They break the entity's isolated-sacrifice rule through reciprocal consent while accepting that some memories cannot be restored.",
            "character_arc_targets": "Nia learns responsibility does not require solitary sacrifice. Rowan chooses present trust over control of the past.",
            "major_setup_payoff_refs": {
                "SR-S1": "silver emergency tag",
                "SR-S2": "blank journal page",
                "SR-S3": "the phrase 'remember me forward'",
            },
        },
        "episode_plans": (
            {
                "episode_number": 1,
                "episode_purpose": "Establish the exchange and create an ethical bond.",
                "entry_state": "Nia hides her ability; Rowan tracks unexplained losses alone.",
                "required_state_change": "Nia and Rowan become causally linked, one life is preserved, and the entity notices their interference.",
                "protagonist_decision": "Nia prioritizes a life after preserving available evidence; the exact rescue method is open.",
                "planned_reveal": "Rowan's losses and Nia's ability are connected by an external exchange.",
                "setup_refs": ["SR-S1", "SR-S2"],
                "payoff_refs": [],
                "exit_state": "A patient lives, Rowan lacks one critical fact, and Nia is marked by the exchange.",
                "escalation_requirement": "Create a new threat to verification or trust; choose the exact hook and cliffhanger freely.",
            },
            {
                "episode_number": 2,
                "episode_purpose": "Test trust without repeating rescue followed by memory loss.",
                "entry_state": "Both are linked and possess incomplete but independently stored evidence.",
                "required_state_change": "They verify that the entity manipulates relational evidence, Rowan grants Nia bounded trust, and both retain their current memories.",
                "protagonist_decision": "Nia follows a risky lead while protecting Rowan's consent and an independent verification path.",
                "planned_reveal": "The entity can counterfeit or reroute relational evidence.",
                "setup_refs": ["SR-S1", "SR-S2", "SR-S3"],
                "payoff_refs": ["SR-S2:partial"],
                "exit_state": "Trust rests on a verified choice, one record is compromised, and both retain current memories.",
                "emotional_requirement": "Move from suspicion to provisional trust and then destabilized certainty; choose the conflict device freely.",
            },
            {
                "episode_number": 3,
                "episode_purpose": "Force a choice between recovering the past and protecting future autonomy.",
                "entry_state": "Current memories are intact, a restoration path exists, and the entity has leverage.",
                "required_state_change": "They reject restoration that transfers its cost to another and lose access to part of the recoverable past.",
                "protagonist_decision": "Nia and Rowan choose present consent over complete recovered identity.",
                "planned_reveal": "Silver tags route stolen memories, and the exchange exploits isolated sacrifice.",
                "setup_refs": ["SR-S1", "SR-S3"],
                "payoff_refs": ["SR-S1:partial"],
                "exit_state": "The rule is understood, the restoration path is reduced or lost, and their present relationship remains intact but threatened.",
                "escalation_requirement": "Target their future shared identity rather than stage another rescue.",
            },
            {
                "episode_number": 4,
                "episode_purpose": "Resolve the exchange through reciprocal agency.",
                "entry_state": "They understand the rule but cannot restore every loss.",
                "required_state_change": "The entity loses control, incomplete memory remains, and a shared future becomes possible.",
                "protagonist_decision": "They consent to reciprocal risk without one person owning the other's identity.",
                "planned_reveal": "The exchange persists only while loss is involuntary or borne alone.",
                "setup_refs": [],
                "payoff_refs": ["SR-S1", "SR-S2", "SR-S3"],
                "exit_state": "The central exchange is broken and new shared memories can be preserved.",
                "emotional_requirement": "Move from anticipatory loss to reciprocal trust and bittersweet renewal; choose the exact payoff execution freely.",
            },
        ),
    },
    {
        "story_id": "revenge_drama",
        "story_title": "Revenge Drama",
        "role": "control_case",
        "content_spec_summary": {
            "audience": "English-speaking viewers who prefer strategic revenge, institutional conflict, and earned reversals",
            "platform": "TikTok-oriented vertical serialized fiction",
            "language": "English",
            "episode_duration_seconds": 90,
            "desired_scene_count": 3,
            "tone": "Sharp, controlled, escalating",
            "story_goal": "A structural engineer must expose the developer who framed her without endangering residents.",
            "constraints": [
                "Revenge depends on evidence and consequential choices.",
                "The protagonist protects vulnerable people.",
                "Do not use a public-wedding or secret-heir device.",
            ],
        },
        "story_blueprint": {
            "core_premise": "Disgraced engineer Tessa Ward audits the developer who framed her and discovers his newest tower repeats the defect that ended her career.",
            "series_dramatic_promise": "Tessa transforms personal revenge into public accountability while defeating a system that treats resident safety as negotiable.",
            "central_conflict": "Tessa needs internal proof, but immediate exposure could cause panic and leave residents inside an unsafe tower.",
            "theme": "Justice without responsibility can reproduce the harm it condemns.",
            "ending_direction": "Tessa enables a safe evacuation, releases independently verified evidence, and rejects a settlement that repairs only her reputation.",
            "character_arc_targets": "Tessa moves from reputation-focused revenge to public-accountability leadership. Hale moves from certainty to sacrificing allies and exposing his fear.",
            "major_setup_payoff_refs": {
                "RV-S1": "altered load-test record",
                "RV-S2": "evacuation plan",
                "RV-S3": "Tessa's unsigned calculation",
            },
        },
        "episode_plans": (
            {
                "episode_number": 1,
                "episode_purpose": "Shift Tessa's objective from clearing her name to preventing current harm.",
                "entry_state": "Tessa is discredited and has temporary internal access.",
                "required_state_change": "A repeat safety risk becomes credible, and Tessa delays personal vindication to investigate it.",
                "protagonist_decision": "Tessa prioritizes resident safety over the easiest reputation evidence.",
                "planned_reveal": "The current tower reproduces a material pattern from the earlier failure.",
                "setup_refs": ["RV-S1", "RV-S3"],
                "payoff_refs": [],
                "exit_state": "Tessa has partial safety evidence, and the company detects scrutiny.",
                "escalation_requirement": "Create immediate pressure on access or evidence; choose the exact device freely.",
            },
            {
                "episode_number": 2,
                "episode_purpose": "Verify the framing while making premature exposure dangerous.",
                "entry_state": "Tessa has partial proof, and residents do not know the risk.",
                "required_state_change": "The substitution behind her framing is established, and a safe response becomes necessary before release.",
                "protagonist_decision": "Tessa rejects silence without triggering an uncontrolled response.",
                "planned_reveal": "Her unsigned work was transformed into a certified falsification.",
                "setup_refs": ["RV-S1", "RV-S2", "RV-S3"],
                "payoff_refs": ["RV-S3:partial"],
                "exit_state": "Tessa has framing evidence and a narrow protection window.",
                "emotional_requirement": "Move from vindication to disciplined responsibility; choose the exact bargain or threat freely.",
            },
            {
                "episode_number": 3,
                "episode_purpose": "Make public safety visibly cost Tessa her fastest revenge.",
                "entry_state": "The official response path is compromised, and records are at risk.",
                "required_state_change": "Residents gain a credible route toward safety, Tessa accepts a personal or legal cost, and institutional complicity becomes visible.",
                "protagonist_decision": "Tessa chooses a bounded sacrifice that protects residents and preserves evidence.",
                "planned_reveal": "The falsification depended on both corporate and oversight participation.",
                "setup_refs": ["RV-S1", "RV-S2"],
                "payoff_refs": ["RV-S1:partial"],
                "exit_state": "Most residents can act safely, Tessa is under direct pressure, and the antagonists believe they can contain the record.",
                "escalation_requirement": "Make pressure public or institutional; choose the exact arrest or sabotage mechanism freely.",
            },
            {
                "episode_number": 4,
                "episode_purpose": "Complete safe exposure and accountable justice.",
                "entry_state": "Remaining residents and evidence are both vulnerable.",
                "required_state_change": "Residents are safe, evidence is independently preserved, and accountability no longer depends on Tessa alone.",
                "protagonist_decision": "Tessa chooses public verification over a private restoration of status.",
                "planned_reveal": "The earlier and current failures are part of the same corrupted process.",
                "setup_refs": [],
                "payoff_refs": ["RV-S1", "RV-S2", "RV-S3"],
                "exit_state": "The central case resolves through public accountability, while broader consequences may remain.",
                "escalation_requirement": "Continuation may expose wider scope but must not repeat another building emergency.",
            },
        ),
    },
)


class OfflineEvaluationLLMAdapter(RealLLMAdapter):
    """Apply a fixed reasoning profile without changing the production adapter."""

    def _build_chat_payload(
        self,
        *,
        prompt: str,
        strategy: Any,
        output_schema: dict[str, Any] | None,
    ) -> dict[str, Any]:
        payload = super()._build_chat_payload(
            prompt=prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        payload["reasoning_effort"] = REASONING_EFFORT
        return payload


def main() -> None:
    config = get_llm_runtime_config()
    if config.use_mock_adapter:
        raise RuntimeError(
            "Serialized Story Planning v1.1 real A/B requires LLM_PROVIDER, "
            "LLM_MODEL, LLM_API_KEY, and LLM_BASE_URL."
        )

    validate_fixtures()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    adapter = OfflineEvaluationLLMAdapter(
        provider=config.provider,
        model_name=config.model_name,
        api_key=config.api_key or "",
        base_url=config.base_url or "",
        timeout_seconds=config.timeout_seconds,
        max_retries=config.max_retries,
    )
    strategy = build_strategy(config)
    manifest_path = OUTPUT_DIR / "manifest.json"
    manifest = load_or_create_manifest(manifest_path, config)
    write_generation_config(config, strategy)

    for fixture in FIXTURES:
        story_id = fixture["story_id"]
        story_dir = OUTPUT_DIR / story_id
        write_json(story_dir / "content_spec_summary.json", fixture["content_spec_summary"])
        write_json(story_dir / "story_blueprint.json", fixture["story_blueprint"])
        write_json(story_dir / "episode_plans_v1_1.json", fixture["episode_plans"])

        for variant in ("direct", "planned_v1_1"):
            previous_state: dict[str, Any] | None = None
            for episode_number in range(1, EPISODE_COUNT + 1):
                episode_dir = story_dir / variant / f"episode_{episode_number:02d}"
                episode_dir.mkdir(parents=True, exist_ok=True)
                draft_path = episode_dir / "draft.json"
                run_path = episode_dir / "run.json"
                prompt_path = episode_dir / "prompt.txt"
                continuity_input_path = episode_dir / "continuity_input.json"
                continuity_output_path = episode_dir / "continuity_output.json"
                failure_path = episode_dir / "failure.json"
                expected_prompt_version = prompt_version_for_episode(episode_number)

                if prompt_path.exists() and not prompt_uses_version(
                    prompt_path, expected_prompt_version
                ):
                    archive_checkpoint(
                        episode_dir=episode_dir,
                        story_id=story_id,
                        variant=variant,
                        episode_number=episode_number,
                        reason="pre_final_scene_flag_patch",
                    )
                    update_manifest_status(
                        manifest,
                        manifest_path,
                        story_id,
                        variant,
                        episode_number,
                        "superseded_technical_contract_mismatch",
                    )

                if all(
                    path.exists()
                    for path in (
                        draft_path,
                        run_path,
                        prompt_path,
                        continuity_input_path,
                        continuity_output_path,
                    )
                ):
                    draft = LLMGeneratedDraftMasterScript.model_validate(read_json(draft_path))
                    previous_state = read_json(continuity_output_path)
                    print(f"Resumed {story_id}/{variant}/episode_{episode_number:02d}")
                    continue

                if draft_path.exists() or run_path.exists() or continuity_output_path.exists():
                    raise RuntimeError(
                        f"Incomplete successful checkpoint at {episode_dir}; inspect it before retrying."
                    )

                previous_failure_count = 0
                if failure_path.exists():
                    previous_failure_count = int(read_json(failure_path).get("attempt_count", 1))

                plan = fixture["episode_plans"][episode_number - 1]
                planning_context = (
                    {
                        "contract_version": CONTRACT_VERSION,
                        "story_blueprint": fixture["story_blueprint"],
                        "current_episode_plan": plan,
                    }
                    if variant == "planned_v1_1"
                    else None
                )
                prompt = build_prompt(
                    content_spec_summary=fixture["content_spec_summary"],
                    episode_number=episode_number,
                    previous_state=previous_state,
                    planning_context=planning_context,
                )
                prompt_path.write_text(prompt, encoding="utf-8")
                write_json(continuity_input_path, previous_state)

                started_at = perf_counter()
                try:
                    (
                        draft,
                        metadata,
                        rate_limit_failures,
                        schema_failures,
                    ) = generate_validated_output(
                        adapter=adapter,
                        prompt=prompt,
                        strategy=strategy,
                    )
                    latency_seconds = round(perf_counter() - started_at, 3)
                except Exception as exc:
                    write_json(
                        failure_path,
                        {
                            "error_type": type(exc).__name__,
                            "error": str(exc),
                            "story_id": story_id,
                            "variant": variant,
                            "episode_number": episode_number,
                            "attempt_count": previous_failure_count
                            + 1
                            + int(getattr(exc, "offline_rate_limit_retries", 0))
                            + int(
                                getattr(exc, "offline_schema_validation_retries", 0)
                            ),
                            "schema_validation_retries": int(
                                getattr(exc, "offline_schema_validation_retries", 0)
                            ),
                        },
                    )
                    update_manifest_status(
                        manifest,
                        manifest_path,
                        story_id,
                        variant,
                        episode_number,
                        "failed",
                    )
                    raise

                if failure_path.exists():
                    failure_path.unlink()
                write_json(draft_path, draft.model_dump(mode="json"))
                next_state = build_previous_episode_state(draft, episode_number)
                write_json(continuity_output_path, next_state)
                usage = metadata.get("usage") if isinstance(metadata, dict) else None
                write_json(
                    run_path,
                    {
                        "story_id": story_id,
                        "variant": variant,
                        "episode_number": episode_number,
                        "contract_version": CONTRACT_VERSION if planning_context else None,
                        "prompt_version": expected_prompt_version,
                        "generation_strategy_id": strategy.id,
                        "generation_strategy_version": strategy.version,
                        "model_provider": config.provider,
                        "model_name": config.model_name,
                        "temperature": strategy.temperature,
                        "top_p": strategy.top_p,
                        "max_tokens": strategy.max_tokens,
                        "reasoning_effort": REASONING_EFFORT,
                        "output_language": OUTPUT_LANGUAGE,
                        "platform_profile_id": PLATFORM_PROFILE_ID,
                        "target_duration_seconds": TARGET_DURATION_SECONDS,
                        "desired_scene_count": SCENE_COUNT,
                        "latency_seconds": latency_seconds,
                        "prompt_characters": len(prompt),
                        "planning_context_characters": len(
                            json.dumps(planning_context, ensure_ascii=False)
                        ),
                        "usage": usage,
                        "response_id": metadata.get("response_id")
                        if isinstance(metadata, dict)
                        else None,
                        "generation_failure_count_before_success": previous_failure_count,
                        "rate_limit_failures_before_success": rate_limit_failures,
                        "schema_validation_failures_before_success": schema_failures,
                        "total_technical_failures_before_success": previous_failure_count
                        + rate_limit_failures
                        + schema_failures,
                    },
                )
                previous_state = next_state
                update_manifest_status(
                    manifest,
                    manifest_path,
                    story_id,
                    variant,
                    episode_number,
                    "completed",
                )
                print(
                    f"Completed {story_id}/{variant}/episode_{episode_number:02d} "
                    f"({latency_seconds}s)"
                )
                if REQUEST_DELAY_SECONDS:
                    print(f"Cooling down for {REQUEST_DELAY_SECONDS:g}s")
                    sleep(REQUEST_DELAY_SECONDS)

    write_json(OUTPUT_DIR / "deterministic_checks.json", run_deterministic_checks())
    create_blind_review_package()
    manifest["generation_status"] = "completed"
    if not (OUTPUT_DIR / "blind_review" / "blind_review_locked.json").exists():
        manifest["generation_status"] = "completed_pending_blind_review"
        manifest["decision_status"] = "pending_blind_review"
    write_json(manifest_path, manifest)
    print(f"Artifacts: {OUTPUT_DIR.relative_to(ROOT_DIR)}")
    print(f"Generation status: {manifest['generation_status']}")


def build_strategy(config: Any) -> GenerationStrategyCreate:
    return GenerationStrategyCreate(
        id=STRATEGY_ID,
        name="Serialized Story Planning v1.1 Bounded Revalidation",
        target_platform="tiktok",
        target_content_type="serialized_ai_comic_episode",
        applicable_tags=["serialized_story", "offline_evaluation"],
        model_provider=config.provider,
        model_name=config.model_name,
        temperature=TEMPERATURE,
        top_p=TOP_P,
        max_tokens=MAX_TOKENS,
        workflow_steps=[
            GenerationWorkflowStep(
                step_order=1,
                name="episode_generation",
                description="Generate one structured episode for bounded offline revalidation.",
                prompt_id="prompt.serialized_story_planning.offline_ab.v1.1-revalidation",
                multi_turn_enabled=False,
                structured_output_required=True,
            )
        ],
        prompt_ids=["prompt.serialized_story_planning.offline_ab.v1.1-revalidation"],
        qc_enabled=False,
        self_check_enabled=False,
        human_review_required=True,
        output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
        version="v1.1-revalidation",
        status=GenerationStrategyStatus.active,
    )


def build_prompt(
    *,
    content_spec_summary: dict[str, Any],
    episode_number: int,
    previous_state: dict[str, Any] | None,
    planning_context: dict[str, Any] | None,
) -> str:
    effective_prompt_version = prompt_version_for_episode(episode_number)
    final_episode_instruction = (
        "Resolve the bounded four-episode story's central question. End with an earned "
        "payoff and only a limited continuation possibility. For schema compatibility, "
        "set the final scene's cliffhanger field to true; in this final episode the flag "
        "means the scene delivers the required final payoff or continuation beat and does "
        "not require adding an unrelated threat."
        if episode_number == EPISODE_COUNT
        else "Advance the story and earn a consequential next-episode cliffhanger."
    )
    return "\n".join(
        [
            f"EvaluationPromptVersion: {effective_prompt_version}",
            "Task: Generate one complete episode of a connected four-episode AI comic story.",
            "Do not mention prompts, plans, schemas, variants, evaluation, or these instructions.",
            "When planning context is present, satisfy its required effects but invent the dramatic execution.",
            "When planning context is absent, infer this episode's responsibility from the ContentSpec, episode number, and previous state.",
            "The actual previous episode state is authoritative if it differs in minor execution detail from a planned entry state.",
            "",
            f"EpisodeNumber: {episode_number}",
            f"EpisodeCount: {EPISODE_COUNT}",
            f"OutputLanguage: {OUTPUT_LANGUAGE}",
            f"PlatformProfile: {PLATFORM_PROFILE_ID}",
            f"TargetDurationSeconds: {TARGET_DURATION_SECONDS}",
            f"DesiredSceneCount: {SCENE_COUNT}",
            "",
            "SharedGenerationRequirements:",
            "- Return exactly three scenes and comply with the supplied structured output schema.",
            "- Keep the JSON concise: use exactly two dialogue lines and two or three visible character actions per scene.",
            "- Keep purpose, beat summary, emotional fields, causal fields, and turning point to one concise sentence each.",
            "- Preserve established characters, facts, relationships, rules, and consequences.",
            "- Give the protagonist at least one consequential observable decision.",
            "- Every scene must have Goal, Conflict, Outcome, and a causal link after Scene 1.",
            "- Conflict and emotional pressure must escalate rather than repeat.",
            "- Include natural, character-specific dialogue and visible actions.",
            "- The final scene must deliver an earned cliffhanger or payoff.",
            f"- {final_episode_instruction}",
            "",
            "CreativeFreedomBoundary:",
            "- Invent the exact opening hook, conflict mechanism, physical incident, reversal device, dialogue, scene choreography, emotional expression, and cliffhanger execution.",
            "- Treat planned reveals as information obligations, not required staging.",
            "- Do not repeat an adjacent episode's primary conflict, rescue, sacrifice, reveal, threat device, or state transition unless the new function clearly escalates it.",
            "- A recurring motif is allowed; a repeated dramatic mechanism is not.",
            "",
            "ContentSpecSummary:",
            json.dumps(content_spec_summary, ensure_ascii=False, indent=2),
            "",
            "PreviousEpisodeState:",
            json.dumps(previous_state, ensure_ascii=False, indent=2),
            "",
            "PlanningContext:",
            json.dumps(planning_context, ensure_ascii=False, indent=2),
        ]
    )


def build_previous_episode_state(
    draft: LLMGeneratedDraftMasterScript,
    episode_number: int,
) -> dict[str, Any]:
    final_scene = draft.scenes[-1]
    return {
        "completed_episode_number": episode_number,
        "title": draft.title,
        "episode_goal": draft.episode_goal,
        "synopsis": draft.synopsis,
        "character_states": [
            {
                "name": character.name,
                "role": character.role,
                "motivation": character.motivation,
            }
            for character in draft.characters
        ],
        "final_scene_outcome": final_scene.scene_causality.outcome,
        "final_turning_point": final_scene.turning_point,
        "next_episode_question": draft.next_episode_question,
    }


def validate_fixtures() -> None:
    if len(FIXTURES) != 2:
        raise RuntimeError(f"Expected exactly two fixtures, found {len(FIXTURES)}.")
    for fixture in FIXTURES:
        plans = fixture["episode_plans"]
        if len(plans) != EPISODE_COUNT:
            raise RuntimeError(f"{fixture['story_id']} must contain four plans.")
        for expected_number, plan in enumerate(plans, start=1):
            fields = set(plan)
            if int(plan["episode_number"]) != expected_number:
                raise RuntimeError(f"Invalid episode order in {fixture['story_id']}.")
            if fields - ALLOWED_EPISODE_PLAN_FIELDS:
                raise RuntimeError(
                    f"Unsupported v1.1 plan fields in {fixture['story_id']}: "
                    f"{sorted(fields - ALLOWED_EPISODE_PLAN_FIELDS)}"
                )
            if fields & FORBIDDEN_EPISODE_PLAN_FIELDS:
                raise RuntimeError(
                    f"Forbidden v1 plan fields in {fixture['story_id']}: "
                    f"{sorted(fields & FORBIDDEN_EPISODE_PLAN_FIELDS)}"
                )


def write_generation_config(config: Any, strategy: GenerationStrategyCreate) -> None:
    write_json(
        OUTPUT_DIR / "generation_config.json",
        {
            "evaluation_id": EVALUATION_ID,
            "contract_version": CONTRACT_VERSION,
            "prompt_version": PROMPT_VERSION,
            "final_episode_prompt_version": FINAL_EPISODE_SCHEMA_PATCH_VERSION,
            "generation_strategy_id": strategy.id,
            "model_provider": config.provider,
            "model_name": config.model_name,
            "temperature": TEMPERATURE,
            "top_p": TOP_P,
            "max_tokens": MAX_TOKENS,
            "reasoning_effort": REASONING_EFFORT,
            "platform_profile_id": PLATFORM_PROFILE_ID,
            "output_language": OUTPUT_LANGUAGE,
            "episode_count_per_story": EPISODE_COUNT,
            "scene_count_per_episode": SCENE_COUNT,
            "target_duration_seconds": TARGET_DURATION_SECONDS,
            "generation_order": GENERATION_ORDER,
            "inter_request_delay_seconds": REQUEST_DELAY_SECONDS,
            "rate_limit_retry_count": RATE_LIMIT_RETRY_COUNT,
            "rate_limit_cooldown_seconds": RATE_LIMIT_COOLDOWN_SECONDS,
            "schema_retry_count": SCHEMA_RETRY_COUNT,
            "schema_retry_delay_seconds": SCHEMA_RETRY_DELAY_SECONDS,
            "continuity_summary_fields": (
                "completed_episode_number",
                "title",
                "episode_goal",
                "synopsis",
                "character_states",
                "final_scene_outcome",
                "final_turning_point",
                "next_episode_question",
            ),
            "output_schema": "LLMGeneratedDraftMasterScript",
            "technical_contract_correction": {
                "scope": "episode_04_for_both_variants",
                "reason": "The existing schema validator uses cliffhanger=true as the final-scene payoff-or-continuation marker.",
                "creative_change": False,
                "comparison_rule": "Regenerate both Direct and Planned episode 4 with the same correction.",
            },
        },
    )


def load_or_create_manifest(path: Path, config: Any) -> dict[str, Any]:
    expected_model = {
        "provider": config.provider,
        "model_name": config.model_name,
        "temperature": TEMPERATURE,
        "top_p": TOP_P,
        "max_tokens": MAX_TOKENS,
        "reasoning_effort": REASONING_EFFORT,
    }
    if path.exists():
        manifest = read_json(path)
        if manifest.get("model") != expected_model:
            raise RuntimeError("Existing manifest uses different fixed model settings.")
        manifest["fixed_settings"]["inter_request_delay_seconds"] = (
            REQUEST_DELAY_SECONDS
        )
        manifest["fixed_settings"]["rate_limit_retry_count"] = (
            RATE_LIMIT_RETRY_COUNT
        )
        manifest["fixed_settings"]["rate_limit_cooldown_seconds"] = (
            RATE_LIMIT_COOLDOWN_SECONDS
        )
        manifest["fixed_settings"]["schema_retry_count"] = SCHEMA_RETRY_COUNT
        manifest["fixed_settings"]["schema_retry_delay_seconds"] = (
            SCHEMA_RETRY_DELAY_SECONDS
        )
        manifest["technical_contract_correction"] = {
            "status": "applied_symmetrically_to_episode_04_pair",
            "prompt_version": FINAL_EPISODE_SCHEMA_PATCH_VERSION,
            "reason": "Align final-scene boolean semantics with the unchanged output schema validator.",
            "creative_prompt_tuning": False,
        }
        write_json(path, manifest)
        return manifest

    manifest = {
        "evaluation_id": EVALUATION_ID,
        "generation_status": "in_progress",
        "decision_status": "pending_blind_review",
        "contract_version": CONTRACT_VERSION,
        "prompt_version": PROMPT_VERSION,
        "final_episode_prompt_version": FINAL_EPISODE_SCHEMA_PATCH_VERSION,
        "generation_strategy_id": STRATEGY_ID,
        "model": expected_model,
        "technical_contract_correction": {
            "status": "applied_symmetrically_to_episode_04_pair",
            "prompt_version": FINAL_EPISODE_SCHEMA_PATCH_VERSION,
            "reason": "Align final-scene boolean semantics with the unchanged output schema validator.",
            "creative_prompt_tuning": False,
        },
        "fixed_settings": {
            "output_language": OUTPUT_LANGUAGE,
            "platform_profile_id": PLATFORM_PROFILE_ID,
            "episode_count_per_story": EPISODE_COUNT,
            "scene_count_per_episode": SCENE_COUNT,
            "target_duration_seconds": TARGET_DURATION_SECONDS,
            "generation_order": GENERATION_ORDER,
            "inter_request_delay_seconds": REQUEST_DELAY_SECONDS,
            "rate_limit_retry_count": RATE_LIMIT_RETRY_COUNT,
            "rate_limit_cooldown_seconds": RATE_LIMIT_COOLDOWN_SECONDS,
            "schema_retry_count": SCHEMA_RETRY_COUNT,
            "schema_retry_delay_seconds": SCHEMA_RETRY_DELAY_SECONDS,
            "generations_per_episode_variant": 1,
            "total_expected_generations": 16,
        },
        "stories": {
            fixture["story_id"]: {
                "story_title": fixture["story_title"],
                "role": fixture["role"],
                "direct": {},
                "planned_v1_1": {},
            }
            for fixture in FIXTURES
        },
    }
    write_json(path, manifest)
    return manifest


def update_manifest_status(
    manifest: dict[str, Any],
    manifest_path: Path,
    story_id: str,
    variant: str,
    episode_number: int,
    status: str,
) -> None:
    manifest["stories"][story_id][variant][f"episode_{episode_number:02d}"] = status
    write_json(manifest_path, manifest)


def prompt_version_for_episode(episode_number: int) -> str:
    if episode_number == EPISODE_COUNT:
        return FINAL_EPISODE_SCHEMA_PATCH_VERSION
    return PROMPT_VERSION


def prompt_uses_version(path: Path, expected_version: str) -> bool:
    return path.read_text(encoding="utf-8").startswith(
        f"EvaluationPromptVersion: {expected_version}\n"
    )


def archive_checkpoint(
    *,
    episode_dir: Path,
    story_id: str,
    variant: str,
    episode_number: int,
    reason: str,
) -> None:
    history_dir = (
        OUTPUT_DIR
        / "technical_history"
        / story_id
        / variant
        / f"episode_{episode_number:02d}"
        / reason
    )
    history_dir.mkdir(parents=True, exist_ok=True)
    for path in episode_dir.iterdir():
        if path.is_file():
            target = history_dir / path.name
            if target.exists():
                target = history_dir / f"attempt_{len(list(history_dir.iterdir())) + 1}_{path.name}"
            path.replace(target)


def generate_with_rate_limit_recovery(
    *,
    adapter: OfflineEvaluationLLMAdapter,
    prompt: str,
    strategy: GenerationStrategyCreate,
) -> tuple[dict[str, Any], int]:
    """Retry only provider-rejected 429 calls; never repeat a successful generation."""

    for retry_number in range(RATE_LIMIT_RETRY_COUNT + 1):
        try:
            output = adapter.generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
            )
            return output, retry_number
        except Exception as exc:
            is_rate_limit = "429" in str(exc) and "Concurrency limit" in str(exc)
            if not is_rate_limit or retry_number >= RATE_LIMIT_RETRY_COUNT:
                setattr(exc, "offline_rate_limit_retries", retry_number)
                raise
            print(
                "Provider returned 429 before generation; cooling down for "
                f"{RATE_LIMIT_COOLDOWN_SECONDS:g}s before technical retry "
                f"{retry_number + 1}/{RATE_LIMIT_RETRY_COUNT}."
            )
            sleep(RATE_LIMIT_COOLDOWN_SECONDS)

    raise RuntimeError("Rate-limit recovery ended unexpectedly.")


def generate_validated_output(
    *,
    adapter: OfflineEvaluationLLMAdapter,
    prompt: str,
    strategy: GenerationStrategyCreate,
) -> tuple[LLMGeneratedDraftMasterScript, dict[str, Any], int, int]:
    """Retry invalid structured responses with the exact same evaluation prompt."""

    total_rate_limit_failures = 0
    for schema_retry_number in range(SCHEMA_RETRY_COUNT + 1):
        raw_output, rate_limit_failures = generate_with_rate_limit_recovery(
            adapter=adapter,
            prompt=prompt,
            strategy=strategy,
        )
        total_rate_limit_failures += rate_limit_failures
        metadata = raw_output.pop("_meta", {})
        try:
            draft = LLMGeneratedDraftMasterScript.model_validate(raw_output)
            return (
                draft,
                metadata if isinstance(metadata, dict) else {},
                total_rate_limit_failures,
                schema_retry_number,
            )
        except ValidationError as exc:
            if schema_retry_number >= SCHEMA_RETRY_COUNT:
                setattr(exc, "offline_rate_limit_retries", total_rate_limit_failures)
                setattr(
                    exc,
                    "offline_schema_validation_retries",
                    schema_retry_number,
                )
                raise
            print(
                "Structured output failed DraftMasterScript validation; retrying the "
                f"same prompt after {SCHEMA_RETRY_DELAY_SECONDS:g}s "
                f"({schema_retry_number + 1}/{SCHEMA_RETRY_COUNT})."
            )
            sleep(SCHEMA_RETRY_DELAY_SECONDS)

    raise RuntimeError("Structured-output recovery ended unexpectedly.")


def run_deterministic_checks() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    for fixture in FIXTURES:
        story_id = fixture["story_id"]
        plan_fields_valid = all(
            set(plan) <= ALLOWED_EPISODE_PLAN_FIELDS
            and not set(plan) & FORBIDDEN_EPISODE_PLAN_FIELDS
            for plan in fixture["episode_plans"]
        )
        checks.append(
            {
                "story_id": story_id,
                "check": "episode_plan_v1_1_boundary",
                "passed": plan_fields_valid,
            }
        )
        for variant in ("direct", "planned_v1_1"):
            for episode_number in range(1, EPISODE_COUNT + 1):
                episode_dir = OUTPUT_DIR / story_id / variant / f"episode_{episode_number:02d}"
                draft = LLMGeneratedDraftMasterScript.model_validate(
                    read_json(episode_dir / "draft.json")
                )
                scene_numbers = {scene.scene_number for scene in draft.scenes}
                gco_complete = all(
                    scene.scene_causality.goal.strip()
                    and scene.scene_causality.conflict.strip()
                    and scene.scene_causality.outcome.strip()
                    for scene in draft.scenes
                )
                causal_refs_valid = all(
                    scene.scene_number == 1
                    or (
                        scene.scene_causality.caused_by_scene_number is not None
                        and scene.scene_causality.caused_by_scene_number in scene_numbers
                        and scene.scene_causality.caused_by_scene_number < scene.scene_number
                    )
                    for scene in draft.scenes
                )
                continuity_available = episode_number == 1 or read_json(
                    episode_dir / "continuity_input.json"
                ) is not None
                checks.append(
                    {
                        "story_id": story_id,
                        "variant": variant,
                        "episode_number": episode_number,
                        "check": "structured_episode_contract",
                        "passed": len(draft.scenes) == SCENE_COUNT
                        and gco_complete
                        and causal_refs_valid
                        and continuity_available,
                        "details": {
                            "scene_count": len(draft.scenes),
                            "gco_complete": gco_complete,
                            "causal_refs_valid": causal_refs_valid,
                            "continuity_input_available": continuity_available,
                            "final_scene_cliffhanger": draft.scenes[-1].cliffhanger,
                        },
                    }
                )
    return {
        "evaluation_id": EVALUATION_ID,
        "check_count": len(checks),
        "all_passed": all(check["passed"] for check in checks),
        "checks": checks,
        "limitations": [
            "Dramatic-mechanism repetition requires blind semantic review.",
            "Setup/payoff quality requires evidence-based review, not reference presence alone.",
            "A structured contract pass does not establish readable story quality.",
        ],
    }


def create_blind_review_package() -> None:
    blind_dir = OUTPUT_DIR / "blind_review"
    blind_dir.mkdir(parents=True, exist_ok=True)
    if (blind_dir / "blind_key.json").exists():
        print("Preserved existing blind review package")
        return
    randomizer = random.SystemRandom()
    blind_key: dict[str, Any] = {}
    review_template: dict[str, Any] = {
        "evaluation_id": EVALUATION_ID,
        "review_status": "pending_blind_review",
        "reviewer_identity_type": None,
        "reviewer_count": None,
        "rubric_scale": "1-5",
        "stories": {},
    }
    for fixture in FIXTURES:
        story_id = fixture["story_id"]
        labels = ["candidate_1", "candidate_2"]
        randomizer.shuffle(labels)
        mapping = {labels[0]: "direct", labels[1]: "planned_v1_1"}
        blind_key[story_id] = mapping
        story_blind_dir = blind_dir / story_id
        story_blind_dir.mkdir(parents=True, exist_ok=True)
        for candidate, variant in mapping.items():
            write_json(
                story_blind_dir / f"{candidate}.json",
                {
                    "story_id": story_id,
                    "candidate": candidate,
                    "episodes": [
                        read_json(
                            OUTPUT_DIR
                            / story_id
                            / variant
                            / f"episode_{episode_number:02d}"
                            / "draft.json"
                        )
                        for episode_number in range(1, EPISODE_COUNT + 1)
                    ],
                },
            )
        review_template["stories"][story_id] = {
            "candidate_1": empty_review_scores(),
            "candidate_2": empty_review_scores(),
            "preferred_candidate": None,
            "deliberately_planned_story_candidate": None,
            "stronger_character_continuity_candidate": None,
            "better_setup_payoff_candidate": None,
            "stronger_hooks_cliffhangers_candidate": None,
            "less_repetitive_mechanical_candidate": None,
            "would_continue_to_episode_5_candidate": None,
            "major_single_episode_regression": None,
            "comparison_evidence": [],
            "uncertainty_notes": [],
        }
    write_json(blind_dir / "blind_key.json", blind_key)
    write_json(blind_dir / "review_template.json", review_template)


def empty_review_scores() -> dict[str, Any]:
    dimensions = (
        "overall_story_coherence",
        "character_decision_consistency",
        "cross_episode_causality",
        "setup_payoff_completion",
        "reveal_timing",
        "exit_entry_continuity",
        "unique_episode_responsibility",
        "repetition_control",
        "hook_strength",
        "cliffhanger_quality",
        "conflict_variety",
        "creative_variety",
        "emotional_progression",
        "rigidity_freedom",
        "filler_control",
        "single_episode_readability",
    )
    return {
        "scores": {dimension: None for dimension in dimensions},
        "evidence": [],
        "adjacent_episode_repetition": {
            "primary_conflict_mechanism": [],
            "rescue_mechanism": [],
            "sacrifice_or_cost": [],
            "reveal_type": [],
            "evidence_or_threat_device": [],
            "state_transition": [],
            "recurring_motifs_not_counted_as_repetition": [],
        },
        "strengths": [],
        "weaknesses": [],
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
