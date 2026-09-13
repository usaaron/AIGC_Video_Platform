"""Offline integration audit using unchanged, previously generated episode bodies."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from scripts.real_generation_probe_continuity import CONTINUITY_SOURCES, ROOT
from scripts.real_generation_probe_fixture import build_probe_request, save_probe_artifact, setup_probe
from scripts.real_generation_probe_transport import ProviderRequestMeter
from scripts.run_real_generation_probe import digest, prepare_runtime, write_json


def checkpoint_coverage(workspace: dict, checkpoint: dict) -> dict[str, Any]:
    source_world = workspace.get("continuityStates", [])
    kept_world = checkpoint.get("world_states", [])
    kept_character_refs = [item["character_ref"] for item in checkpoint.get("character_states", [])]
    identities = {(item["entity_key"], item["state_domain"]) for item in kept_world}
    return {
        "world_states_projected": len(source_world), "world_states_in_checkpoint": len(kept_world),
        "omitted_world_states": [{"entity_key": item["entityKey"], "state_domain": item["stateDomain"]}
                                 for item in source_world
                                 if (item["entityKey"], item["stateDomain"]) not in identities],
        "world_entity_types_in_checkpoint": sorted({item["entity_type"] for item in kept_world}),
        "character_refs_in_checkpoint": kept_character_refs,
        "omitted_character_names": [item["name"] for item in workspace["characters"]
                                    if item.get("dynamicState") and f"character.{item['id']}" not in kept_character_refs],
        "open_setup_payoffs_in_checkpoint": len(checkpoint.get("open_setup_payoffs", [])),
    }


def render_prompt_section(payload: dict) -> str:
    from app.modules.script_engine.generation_service import ScriptGenerationService
    from app.modules.script_engine.models import ScriptGenerationDraftRequest
    from app.modules.script_engine.prompt_builder import TemplatePromptBuilder

    context = ScriptGenerationDraftRequest.model_validate(payload).episode_context
    execution = ScriptGenerationService._episode_execution_context_payload(context, model_context_tokens=128_000)
    return TemplatePromptBuilder()._build_structured_context_section({
        "episode_context_json": json.dumps(execution, ensure_ascii=False),
        "output_language": payload["output_language"],
    })


def audit_continuity(source: Path, output: Path) -> int:
    from app.modules.master_script.models import DraftMasterScript
    from app.modules.script_engine.continuity_qc import evaluate_episode_continuity
    from app.modules.script_engine.models import ScriptGenerationDraftRequest

    source_summary = json.loads((source / "summary.json").read_text())
    runs = sorted(path for path in source.glob("episode_*/run.json"))
    if not runs or len(runs) > 3:
        raise ValueError("The offline audit requires one to three completed source episodes.")
    output.mkdir(parents=True, exist_ok=False)
    checks = []
    summary: dict[str, Any] = {
        "mode": "offline_product_continuity", "source": str(source), "episodes": [],
        "new_model_generations": 0, "semantic_quality_accepted": False,
        "prompt_scope": "structured_context_section", "model_context_tokens_for_offline_render": 128_000,
        "saved_run_metadata": "Reused unchanged; historical run IDs do not represent new generation.",
        "source_hashes": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in (*CONTINUITY_SOURCES, Path(__file__),
                                       ROOT / "scripts/real_generation_probe_fixture.py",
                                       ROOT / "backend/app/modules/script_engine/generation_service.py",
                                       ROOT / "backend/app/modules/script_engine/prompt_builder.py",
                                       ROOT / "backend/app/modules/script_engine/continuity_qc.py")},
    }
    meter = ProviderRequestMeter(output / "provider_requests.jsonl", max_requests=0)
    try:
        with meter, prepare_runtime(output, source_summary["release_region"]) as client:
            state = setup_probe(client, source_summary["release_region"])
            write_json(output / "fixed_inputs.json", state)
            previous = None
            for number in range(1, min(len(runs) + 1, 3) + 1):
                payload = build_probe_request(state, number, previous)
                directory = output / f"episode_{number:03d}"
                directory.mkdir()
                write_json(directory / "request.json", payload)
                checkpoint_text = payload["episode_context"]["provisional_continuity_checkpoint"]
                checkpoint = json.loads(checkpoint_text) if checkpoint_text else {}
                write_json(directory / "checkpoint.json", checkpoint)
                prompt = render_prompt_section(payload)
                (directory / "structured_prompt.txt").write_text(prompt, encoding="utf-8")
                recall = payload["episode_context"]["memory_recall"]
                write_json(directory / "memory_recall.json", recall)
                prompt_has_memory = all(json.dumps(row["summary"], ensure_ascii=False) in prompt for row in recall["capsules"])
                coverage = checkpoint_coverage(state["workspace"], checkpoint)
                checks.append(prompt_has_memory and bool(recall["capsules"]))
                item = {"episode_number": number, "checkpoint_characters": len(checkpoint_text or ""),
                        "through_episode_number": checkpoint.get("through_episode_number"),
                        "all_recalled_facts_in_structured_prompt": prompt_has_memory,
                        "memory_recall_status": recall["status"],
                        "memory_recall_missing_requirements": recall["missing_requirements"],
                        "memory_recall_omitted_records": recall["omitted_records"], **coverage}
                if number > 1:
                    source_types = {row["entityType"] for row in state["workspace"]["continuityStates"]}
                    checks.append(all(kind not in source_types or kind in coverage["world_entity_types_in_checkpoint"]
                                      for kind in ("item", "time")))
                    checks.append(bool(coverage["character_refs_in_checkpoint"]))
                    schedules = [row for row in state["workspace"]["continuityStates"] if row["stateDomain"] == "schedule"]
                    if schedules:
                        latest_schedule = max(schedules, key=lambda row: row["lastUpdatedEpisode"])
                        recalled_schedule = any(latest_schedule["entityKey"] in row["entity_refs"] for row in recall["capsules"])
                        item["latest_schedule_recalled"] = recalled_schedule
                        checks.append(recalled_schedule)
                    if any(hook["status"] != "fulfilled" for hook in state["workspace"].get("continuationHooks", [])):
                        checks.append(coverage["open_setup_payoffs_in_checkpoint"] > 0)
                if number <= len(runs):
                    source_run = json.loads(runs[number - 1].read_text())
                    run = source_run["data"]
                    context = ScriptGenerationDraftRequest.model_validate(payload).episode_context
                    qc = evaluate_episode_continuity(DraftMasterScript.model_validate(run["draft_master_script"]), context)
                    write_json(directory / "offline_continuity_qc.json", qc.model_dump(mode="json"))
                    item["offline_qc_status"] = qc.status.value
                    item["offline_qc_checked_through"] = qc.checked_through_episode_number
                    if number > 1:
                        checks.append(qc.checked_through_episode_number == number - 1)
                    artifact = save_probe_artifact(client, state, number, run)
                    preserved = artifact["content_payload"] == run
                    checks.append(preserved and artifact["memory_layer"] == "provisional")
                    item.update(source_run_sha256=hashlib.sha256(runs[number - 1].read_bytes()).hexdigest(),
                                body_sha256=digest(run["draft_master_script"]), source_run_preserved=preserved,
                                saved_memory_layer=artifact["memory_layer"])
                    write_json(directory / "projected_workspace.json", state["workspace"])
                    previous = run["draft_master_script"]
                summary["episodes"].append(item)
        summary["passed"] = bool(checks) and all(checks)
    except Exception as error:
        summary.update(passed=False, error_type=type(error).__name__, error=str(error))
    summary["provider"] = meter.summary()
    summary["passed"] = summary["passed"] and summary["provider"]["physical_requests"] == 0
    write_json(output / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return 0 if summary["passed"] else 1
