"""Create a fingerprinted, provisional two-episode editorial revision bundle."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.continuity_qc import evaluate_episode_continuity
from app.modules.script_engine.long_story_models import EpisodeArtifactCreate
from app.modules.script_engine.models import ScriptGenerationDraftRequest
from scripts.audit_real_probe_continuity import render_prompt_section
from scripts.real_generation_probe_continuity import CONTINUITY_SOURCES, ROOT, project_probe_continuity
from scripts.real_generation_probe_fixture import _data, _save_workspace, build_probe_request
from scripts.real_generation_probe_transport import ProviderRequestMeter
from scripts.revise_overseas_probe_sample import CORRECTION_SETS, apply_corrections
from scripts.run_real_generation_probe import overseas_language_audit, prepare_runtime, screenplay_markdown, write_json


def file_fingerprints(directory: Path) -> dict[str, str]:
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(directory.rglob("*")) if path.is_file()}


def validate_report38_source(source: Path, output: Path) -> dict[str, str]:
    if output == source or source in output.parents:
        raise ValueError("The revision output must be outside the immutable source directory.")
    fingerprints = file_fingerprints(source)
    for number, correction in CORRECTION_SETS["report38"]["episodes"].items():
        prefix = f"episode_{number:03d}"
        if fingerprints.get(f"{prefix}/draft.json") != correction["source_draft_sha256"]:
            raise ValueError("This reviewed correction only applies to the exact report38 sample.")
        draft = json.loads((source / prefix / "draft.json").read_text())
        run = json.loads((source / prefix / "run.json").read_text())["data"]
        if run["draft_master_script"] != draft:
            raise ValueError(f"Source episode {number} run and draft disagree.")
    for relative in ("fixed_inputs.json", "run_manifest.json", "probe.db"):
        if relative not in fingerprints:
            raise ValueError(f"The reviewed source is missing {relative}.")
    return fingerprints


def verify_report38_handoff(payload: dict, draft: dict, number: int, prompt: str, workspace: dict) -> None:
    context = payload["episode_context"]
    checkpoint = json.loads(context["provisional_continuity_checkpoint"])
    assert checkpoint["through_episode_number"] == number
    assert checkpoint["version"] == "provisional"
    assert context["memory_recall"]["status"] == "sufficient"
    assert context["memory_recall"]["missing_requirements"] == []
    assert all(json.dumps(row["summary"], ensure_ascii=False) in prompt
               for row in context["memory_recall"]["capsules"])
    if number == 1:
        for index, ref in enumerate(("character.eve_hart", "character.adam_cole")):
            character = next(row for row in checkpoint["character_states"] if row["character_ref"] == ref)
            knowledge = next(row for row in character["knowledge_states"]
                             if row["knowledge_key"] == "payment_vs_reported_accident_time")
            expected = draft["character_state_updates"][index]["knowledge_states"][0]
            assert knowledge == expected and knowledge["status"] == "known"
            capsule = next(row for row in context["memory_recall"]["capsules"]
                           if row["capsule_id"] == f"memory.{ref}")
            assert f"known:{knowledge['statement']}" in capsule["summary"]
        return
    # E3's approved focus contains Eve and Nora; Adam remains in the full workspace and recall.
    adam = next(row for row in workspace["characters"] if row["id"] == "adam_cole")
    condition = next(row for row in adam["dynamicState"]["knowledgeStates"] if row["knowledgeKey"] == "nora_condition")
    expected = next(row for row in draft["character_state_updates"][1]["knowledge_states"]
                    if row["knowledge_key"] == "nora_condition")
    assert condition == {"knowledgeKey": expected["knowledge_key"], "statement": expected["statement"],
                         "status": "known"}
    eve = next(row for row in checkpoint["character_states"] if row["character_ref"] == "character.eve_hart")
    assert next(row for row in eve["knowledge_states"] if row["knowledge_key"] == "nora_condition") == next(
        row for row in draft["character_state_updates"][0]["knowledge_states"] if row["knowledge_key"] == "nora_condition")
    capsule = next(row for row in context["memory_recall"]["capsules"]
                   if row["capsule_id"] == "memory.character.adam_cole")
    assert draft["character_state_updates"][1]["emotional_state"] in capsule["summary"]
    assert draft["character_state_updates"][1]["change_cause"] in capsule["summary"]
    final_scene = draft["scenes"][2]
    assert final_scene["body_order"][-1] == "action:5"
    assert "展示给亚当" in final_scene["character_actions"][5]
    assert "他看清后点头" in final_scene["character_actions"][5]


def revise_report38_sample(source: Path, output: Path) -> int:
    fingerprints = validate_report38_source(source, output)
    output.mkdir(parents=True, exist_ok=False)
    with sqlite3.connect(f"file:{source / 'probe.db'}?mode=ro", uri=True) as origin:
        with sqlite3.connect(output / "probe.db") as copied:
            origin.backup(copied)
    state = json.loads((source / "fixed_inputs.json").read_text())
    write_json(output / "source_fixed_inputs.json", state)
    now = datetime.now(timezone.utc).isoformat()
    lineage = {
        "schema_version": 1, "content_schema_version": "probe_editorial_revision.v1",
        "status": "provisional", "source_directory": str(source), "correction_set": "report38",
        "method": "explicit_editorial_changes", "created_at": now,
        "source_files_sha256": fingerprints, "episodes": [], "new_model_requests": 0,
        "source_checkpoint_policy": "Immutable historical model checkpoints remain source evidence; revised runs are editorial artifacts and must not be replayed as original model output.",
        "generation_metadata_policy": "Run generation timestamps, model identity and prompt debug fields describe the source run. Revised draft metadata contains fresh deterministic review and editorial provenance only.",
        "source_hashes": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in (*CONTINUITY_SOURCES, Path(__file__),
                                       ROOT / "scripts/revise_overseas_probe_sample.py",
                                       ROOT / "backend/app/modules/script_engine/continuity_qc.py")},
    }
    meter = ProviderRequestMeter(output / "provider_requests.jsonl", max_requests=0)
    reports = []
    with meter, prepare_runtime(output, "overseas", existing=True) as client:
        project_id = state["project"]["project_id"]
        saved = _data(client, "GET", f"/story-projects/{project_id}/workspace")
        original_episodes = deepcopy(saved["workspace_payload"]["episodes"])
        if [row["episodeNumber"] for row in original_episodes] != [1, 2]:
            raise ValueError("The reviewed source workspace must contain exactly episodes 1 and 2.")
        state["workspace_revision"] = saved["revision"]
        state["workspace"]["episodes"] = []
        state["drafts"] = []
        previous = None
        for number in (1, 2):
            directory = output / f"episode_{number:03d}"
            directory.mkdir()
            source_directory = source / directory.name
            request = build_probe_request(state, number, previous)
            context = ScriptGenerationDraftRequest.model_validate(request).episode_context
            original = DraftMasterScript.model_validate(json.loads((source_directory / "draft.json").read_text()))
            revised, changes = apply_corrections(original.model_dump(mode="json"), "report38", number)
            correction = CORRECTION_SETS["report38"]["episodes"][number]
            provenance = {
                "schema_version": "probe_editorial_revision.v1", "status": "provisional",
                "source_directory": str(source), "source_draft_sha256": correction["source_draft_sha256"],
                "source_run_sha256": fingerprints[f"{directory.name}/run.json"],
                "correction_set": "report38", "episode_number": number,
                "method": "explicit_editorial_changes", "created_at": now,
                "new_model_requests": 0, "review_findings": correction["findings"], "changes": changes,
            }
            revised.update(id=f"{original.id}.report38.review1", created_at=now, updated_at=now,
                           llm_metadata={"editorial_revision": provenance})
            candidate = DraftMasterScript.model_validate(revised)
            before_qc = evaluate_episode_continuity(original, context)
            after_qc = evaluate_episode_continuity(candidate, context)
            assert after_qc.blocking_issue_count == 0
            audit = overseas_language_audit(candidate.model_dump(mode="json"), state["canonical_names"])
            assert audit["language_contract_passed"]
            source_run = json.loads((source_directory / "run.json").read_text())["data"]
            review_source = deepcopy(source_run)
            review_source.update(llm_raw_output={}, episode_context=request["episode_context"])
            reviewed_run = _data(client, "POST", "/script-generation/review-draft", {
                "source_generation_run": review_source, "draft_master_script": candidate.model_dump(mode="json"),
            })
            reviewed = DraftMasterScript.model_validate(reviewed_run["draft_master_script"])
            assert reviewed.scenes == candidate.scenes
            assert reviewed_run["continuity_qc_report"] == after_qc.model_dump(mode="json")
            candidate = reviewed
            episode = deepcopy(original_episodes[number - 1])
            source_artifact_id = episode["artifactRefs"]["draft"]["artifactId"]
            artifact_url = f"/story-projects/{project_id}/episodes/{number}/artifacts"
            source_artifact = _data(client, "GET", f"{artifact_url}/{source_artifact_id}")
            payload = EpisodeArtifactCreate(
                artifact_id=f"artifact.{project_id}.ep{number}.report38.editorial_revision_1",
                story_project_id=project_id, episode_number=number, artifact_kind="revised",
                memory_layer="provisional", source_artifact_id=source_artifact_id,
                content_schema_version="probe_editorial_revision.v1",
                content_payload={"provenance": provenance, "draft_master_script": candidate.model_dump(mode="json"),
                                 "generation_run": reviewed_run, "continuity_qc_report": after_qc.model_dump(mode="json")},
                lineage_refs={"source_draft_sha256": correction["source_draft_sha256"],
                              "source_run_sha256": fingerprints[f"{directory.name}/run.json"]},
                client_instance_id="probe_editorial_revision.v1",
            ).model_dump(mode="json")
            artifact = _data(client, "POST", artifact_url, payload)
            assert _data(client, "GET", f"{artifact_url}/{artifact['artifact_id']}") == artifact
            assert _data(client, "GET", f"{artifact_url}/{source_artifact_id}") == source_artifact
            episode.update(generationRun=reviewed_run, workingDraftJson=candidate.model_dump_json(indent=2),
                           hasLocalDraftEdits=False, updatedAt=now)
            episode["artifactRefs"]["revised"] = {
                "artifactId": artifact["artifact_id"], "artifactKind": "revised", "memoryLayer": "provisional",
                "artifactVersion": artifact["artifact_version"], "payloadChecksum": artifact["payload_checksum"],
                "createdAt": artifact["created_at"],
            }
            state["workspace"]["episodes"].append(episode)
            state["workspace"].update(status="draft", activeEpisodeNumber=number)
            state["workspace"] = project_probe_continuity(state["workspace"], state["bible"])["workspace"]
            state["drafts"].append(candidate.model_dump(mode="json"))
            _save_workspace(client, state)
            saved = _data(client, "GET", f"/story-projects/{project_id}/workspace")
            assert saved["workspace_payload"] == state["workspace"]
            previous = candidate.model_dump(mode="json")
            next_request = build_probe_request(state, number + 1, previous)
            next_prompt = render_prompt_section(next_request)
            verify_report38_handoff(next_request, previous, number, next_prompt, state["workspace"])
            write_json(directory / "draft.json", previous)
            write_json(directory / "run.json", {"data": reviewed_run})
            write_json(directory / "request.json", request)
            write_json(directory / "revision.json", provenance)
            write_json(directory / "revision_artifact.json", artifact)
            write_json(directory / "source_qc.json", source_run["continuity_qc_report"])
            write_json(directory / "original_qc_rechecked.json", before_qc.model_dump(mode="json"))
            write_json(directory / "revised_qc.json", after_qc.model_dump(mode="json"))
            write_json(directory / "language_audit.json", audit)
            write_json(directory / "projected_workspace.json", state["workspace"])
            (directory / "SCREENPLAY_REVISED.md").write_text(screenplay_markdown(previous, number), encoding="utf-8")
            write_json(output / f"episode_{number + 1:03d}_request.json", next_request)
            (output / f"episode_{number + 1:03d}_structured_prompt.txt").write_text(next_prompt, encoding="utf-8")
            lineage["episodes"].append({
                "episode_number": number, "original_draft_sha256": correction["source_draft_sha256"],
                "revised_draft_sha256": hashlib.sha256((directory / "draft.json").read_bytes()).hexdigest(),
                "source_artifact_id": source_artifact_id, "revised_artifact_id": artifact["artifact_id"],
                "review_findings": correction["findings"], "changes": changes,
            })
            reports.append({"episode_number": number, "changes": len(changes),
                            "blocking_issues": after_qc.blocking_issue_count, "warnings": after_qc.warning_count,
                            "language_contract_passed": audit["language_contract_passed"],
                            "next_request_rebuilt_and_verified": True,
                            "artifact_kind": artifact["artifact_kind"], "memory_layer": artifact["memory_layer"]})
        write_json(output / "projected_workspace.json", state["workspace"])
        write_json(output / "fixed_inputs.json", state)
        third = output / "episode_003"
        third.mkdir()
        write_json(third / "request.json", next_request)
        (third / "structured_prompt.txt").write_text(next_prompt, encoding="utf-8")
    assert file_fingerprints(source) == fingerprints
    assert meter.summary()["physical_requests"] == 0
    lineage["revised_files_sha256"] = file_fingerprints(output)
    write_json(output / "revision.json", lineage)
    summary = {"passed": True, "source_files_unchanged": True, "source_artifacts_unchanged": True,
               "correction_set": "report38", "review_findings": ["S01", "S02", "S03", "S04", "S05"],
               "episodes": reports, "provider": meter.summary(), "new_generated_episodes": 0,
               "third_episode_request_only": True, "revised_episodes": 2,
               "acceptance_scope": "Localized editorial corrections and deterministic continuity; no new generation or three-episode acceptance."}
    write_json(output / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0
