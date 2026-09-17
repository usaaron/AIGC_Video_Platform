"""Validate historical probe evidence and resume in a new isolated database."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
from typing import Any
from uuid import uuid4

from scripts.real_generation_probe_continuity import ROOT, project_probe_continuity


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _final_checkpoint_digest(run: dict) -> str:
    from scripts.run_real_generation_probe import replay_result_digest

    value = deepcopy(run)
    metadata = value["data"]["draft_master_script"].get("llm_metadata", {})
    # The Agent and response formatter add these after the final tool checkpoint.
    for key in ("agent_run_id", "agent_reused_checkpoint_tools", "agent_resumed_from_checkpoint",
                "agent_model_tool_call_count", "agent_tool_elapsed_ms", "agent_attempt_count",
                "agent_name", "bilingual_presentation_status", "canonical_script_status"):
        metadata.pop(key, None)
    return replay_result_digest(value)


def _files(directory: Path) -> dict[str, str]:
    return {path.relative_to(directory).as_posix(): file_sha256(path)
            for path in sorted(directory.rglob("*")) if path.is_file()}


def _verify_files(directory: Path, fingerprints: dict[str, str]) -> None:
    _require(bool(fingerprints), "Missing source file fingerprints.")
    for name, expected in fingerprints.items():
        path = (directory / name).resolve()
        _require(path.is_relative_to(directory) and path.is_file(), f"Missing or unsafe provenance file: {name}")
        _require(file_sha256(path) == expected, f"Source file fingerprint mismatch: {name}")


def validate_code_fingerprints(recorded: dict[str, str], allowed: list[str]) -> list[dict]:
    overrides = {}
    for entry in allowed:
        name, separator, checksum = entry.partition("=")
        _require(bool(separator) and len(checksum) == 64 and name not in overrides,
                 "Source change must be a unique repository PATH=SHA256.")
        overrides[name] = checksum
    required = {
        "scripts/run_real_generation_probe.py", "scripts/real_generation_probe_fixture.py",
        "scripts/real_generation_probe_continuity.py", "scripts/real_generation_probe_transport.py",
        "backend/app/modules/script_engine/generation_service.py",
        "backend/app/modules/script_engine/continuity_qc.py", "frontend/lib/continuity.ts",
        "frontend/lib/continuity-checkpoint.ts", "frontend/lib/memory-recall.ts",
    }
    _require(required <= recorded.keys(), "Source manifest is missing required code fingerprints.")
    _require(overrides.keys() <= recorded.keys(), "Source change allowance names an unrecorded file.")
    changes = []
    for name, historical in recorded.items():
        path = (ROOT / name).resolve()
        _require(path.is_relative_to(ROOT) and path.is_file(), f"Missing source code: {name}")
        current = file_sha256(path)
        if name in overrides:
            _require(overrides[name] == current, f"Allowed source fingerprint mismatch: {name}")
        _require(current == historical or overrides.get(name) == current,
                 f"Source code fingerprint mismatch: {name}; acknowledge the exact current PATH=SHA256.")
        if current != historical:
            changes.append({"path": name, "inherited_sha256": historical, "current_sha256": current})
    return changes


def _historical_usage(source: Path) -> dict:
    records = {}
    log = source / "provider_requests.jsonl"
    if log.is_file():
        for line in log.read_text().splitlines():
            item = json.loads(line)
            if "request_id" in item:
                records[(item.get("run_id"), item["request_id"])] = item
    known = [item["usage"] for item in records.values() if item.get("usage") is not None]
    missing = sum(item.get("usage") is None for item in records.values())
    incomplete = sum(any((item.get("usage") or {}).get(key) is None
                         for key in ("input_tokens", "output_tokens", "total_tokens"))
                     for item in records.values())
    return {
        "physical_requests": len(records), "requests_missing_usage": missing,
        "requests_incomplete_usage": incomplete,
        "total_usage_complete": bool(records) and incomplete == 0,
        "known_tokens": {key: sum(row[key] for row in known if row.get(key) is not None)
                         if any(row.get(key) is not None for row in known) else None
                         for key in ("input_tokens", "output_tokens", "total_tokens",
                                     "cached_input_tokens", "reasoning_output_tokens")},
        "monetary_cost": None, "counted_against_current_budget": False,
    }


def load_resume_source(source: Path, *, episodes: int, release_region: str,
                       fixture_version: str, allowed_source_changes: list[str],
                       revised_directory: Path | None = None) -> dict:
    from app.modules.agent_runtime.service import fingerprint_input
    from app.modules.script_engine.models import ScriptGenerationDraftRequest
    from scripts.real_generation_probe_fixture import _overseas_fixture, _plans, fixture_metadata
    from scripts.run_real_generation_probe import replay_result_digest

    source = source.resolve()
    _require(source.is_dir(), "Resume source directory does not exist.")
    for name in ("probe.db-wal", "probe.db-journal"):
        _require(not (source / name).exists(), "Resume requires a stopped source with no SQLite journal.")
    fingerprints = _files(source)
    state, manifest, summary = (_read(source / name) for name in (
        "fixed_inputs.json", "run_manifest.json", "summary.json"))
    watchdog = source / "watchdog_result.json"
    if watchdog.is_file():
        _verify_files(source, _read(watchdog)["source_sha256"])
    metadata = fixture_metadata(fixture_version)
    _require(manifest.get("fixture") == state.get("fixture") == metadata,
             "Resume fixture version or metadata mismatch.")
    _require(manifest.get("release_region") == state.get("release_region") == release_region,
             "Resume release region mismatch.")
    project_id = state["project"]["project_id"]
    _require(manifest.get("project_id") == summary.get("project_id") == project_id,
             "Resume project identity mismatch.")
    changes = validate_code_fingerprints(manifest.get("source_hashes", {}), allowed_source_changes)
    expected_plans = _plans(fixture_version)
    if release_region == "overseas":
        expected_plans = _overseas_fixture(expected_plans)
    expected_plans = [{**plan, "source_node_id": state["node"]["node_id"],
                       "source_node_version": state["node"]["version"],
                       "story_bible_version": state["bible"]["version"], "status": "approved"}
                      for plan in expected_plans]
    _require(state["plans"] == expected_plans, "Saved episode plans do not match the fixture.")
    complete = sorted(int(path.parent.name.removeprefix("episode_")) for path in source.glob("episode_*/run.json"))
    _require(bool(complete) and complete == list(range(1, len(complete) + 1)),
             "Resume requires contiguous completed episodes starting at episode 1.")
    _require(episodes > len(complete), "Requested episode total must exceed completed episodes.")
    _require([row["episode_number"] for row in summary["episodes"]] == complete,
             "Completed episode summary does not match saved runs.")
    connection = sqlite3.connect(f"{(source / 'probe.db').as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    selected = []
    stale = []
    try:
        for table, key, value, expected in (
            ("story_projects", "project_id", project_id, state["project"]),
            ("story_bible_versions", "story_bible_id", state["bible"]["story_bible_id"], state["bible"]),
            ("story_plan_node_versions", "node_id", state["node"]["node_id"], state["node"]),
        ):
            rows = connection.execute(f"SELECT payload FROM {table} WHERE {key} = ?", (value,)).fetchall()
            candidates = [json.loads(row["payload"]) for row in rows]
            if table == "story_bible_versions" and expected.get("market_profile") is None:
                for candidate in candidates:
                    if candidate.get("market_profile") == ("overseas_tiktok" if release_region == "overseas" else "cn_mainland"):
                        candidate.pop("market_profile", None)
            _require(any(candidate == expected for candidate in candidates),
                     f"Saved planning input does not match database: {table}")
        workspace = connection.execute("SELECT revision, payload FROM story_project_workspace_snapshots WHERE project_id = ?",
                                       (project_id,)).fetchone()
        _require(workspace is not None, "Source database lacks a saved workspace.")
        stored_workspace = json.loads(workspace["payload"])
        _require([row["episodeNumber"] for row in stored_workspace["episodes"]] == complete,
                 "Source database workspace episode boundary mismatch.")
        for number in complete:
            directory = source / f"episode_{number:03d}"
            request, run, draft = (_read(directory / name) for name in ("request.json", "run.json", "draft.json"))
            payload = ScriptGenerationDraftRequest.model_validate(request).model_dump(mode="json")
            _require(payload["story_project_id"] == project_id and payload["release_region"] == release_region
                     and payload["episode_context"]["episode_number"] == number,
                     f"Episode {number} request identity mismatch.")
            _require(run["data"]["draft_master_script"] == draft, f"Episode {number} draft/run mismatch.")
            agent = connection.execute("SELECT * FROM agent_runs WHERE request_key = ?", (payload["agent_request_id"],)).fetchone()
            _require(agent is not None and agent["status"] == "completed" and agent["episode_number"] == number
                     and agent["project_id"] == project_id, f"Episode {number} lacks a completed source Agent.")
            _require(agent["input_fingerprint"] == fingerprint_input({**request, "agent_request_id": None}),
                     f"Episode {number} source request fingerprint mismatch.")
            result = json.loads(agent["result_payload"])
            result = result.get("draft_run", result)
            _require(replay_result_digest({"data": result}) == replay_result_digest(run),
                     f"Episode {number} completed checkpoint differs from saved run.")
            checkpoints = connection.execute("SELECT checkpoint_payload FROM agent_steps WHERE run_id = ? AND status = 'completed' AND checkpoint_type = 'episode_script_run.v1'",
                                             (agent["run_id"],)).fetchall()
            _require(any(_final_checkpoint_digest({"data": json.loads(row[0])}) == _final_checkpoint_digest(run)
                         for row in checkpoints), f"Episode {number} lacks a matching final checkpoint.")
            artifact_id = f"artifact.{project_id}.ep{number}.draft"
            row = connection.execute("SELECT payload, payload_checksum FROM episode_artifact_versions WHERE artifact_id = ?",
                                     (artifact_id,)).fetchone()
            _require(row is not None, f"Episode {number} lacks its durable draft artifact.")
            artifact = json.loads(row["payload"])
            _require(artifact["content_payload"] == run["data"] and artifact["memory_layer"] == "provisional"
                     and fingerprint_input(run["data"]) == row["payload_checksum"],
                     f"Episode {number} artifact provenance mismatch.")
            saved_episode = stored_workspace["episodes"][number - 1]
            _require(saved_episode["generationRun"] == run["data"]
                     and json.loads(saved_episode["workingDraftJson"]) == draft,
                     f"Episode {number} workspace draft mismatch.")
            selected.append({"episode_number": number, "request": request, "run": run,
                             "artifact": artifact, "workspace_episode": saved_episode,
                             "metrics": _read(directory / "metrics.json"), "origin": "inherited_original"})
        for row in connection.execute("SELECT * FROM agent_runs WHERE project_id = ? AND episode_number > ?", (project_id, len(complete))):
            _require(row["status"] != "completed", "Incomplete episode has a completed Agent but no saved run.")
            checkpoint_count = connection.execute("SELECT COUNT(*) FROM agent_steps WHERE run_id = ? AND checkpoint_payload IS NOT NULL", (row["run_id"],)).fetchone()[0]
            _require(checkpoint_count == 0, "Incomplete episode has a checkpoint; recover that checkpoint before probe resume.")
            request_path = source / f"episode_{row['episode_number']:03d}" / "request.json"
            _require(request_path.is_file(), "Incomplete Agent lacks its source request.")
            request = _read(request_path)
            ScriptGenerationDraftRequest.model_validate(request)
            _require(row["input_fingerprint"] == fingerprint_input({**request, "agent_request_id": None}),
                     "Incomplete Agent request fingerprint mismatch.")
            stale.append(row["run_id"])
        future_artifacts = connection.execute("SELECT COUNT(*) FROM episode_artifact_versions WHERE story_project_id = ? AND episode_number > ?",
                                              (project_id, len(complete))).fetchone()[0]
        _require(future_artifacts == 0, "Incomplete episode already has an artifact; recover it before probe resume.")
    finally:
        connection.close()
    revision = None
    revision_files = None
    if revised_directory is not None:
        revised_directory = revised_directory.resolve()
        revision = _read(revised_directory / "revision.json")
        _require(revision.get("schema_version") == 1 and Path(revision["source_directory"]).resolve() == source,
                 "Editorial revision source directory or schema mismatch.")
        _verify_files(source, revision["source_files_sha256"])
        _verify_files(revised_directory, revision["revised_files_sha256"])
        revised_numbers = [item["episode_number"] if isinstance(item, dict) else item for item in revision["episodes"]]
        _require(revised_numbers == complete, "Editorial revision must cover all inherited episodes.")
        required_source = {"probe.db", "fixed_inputs.json", "run_manifest.json"}
        required_revised = set()
        for item in selected:
            prefix = f"episode_{item['episode_number']:03d}"
            required_source.update(f"{prefix}/{name}" for name in ("run.json", "draft.json", "request.json"))
            required_revised.update(f"{prefix}/{name}" for name in ("run.json", "draft.json", "request.json"))
            revised_run, revised_draft, revised_request = (_read(revised_directory / prefix / name)
                                                         for name in ("run.json", "draft.json", "request.json"))
            _require(revised_run["data"]["draft_master_script"] == revised_draft,
                     f"Episode {item['episode_number']} revised draft/run mismatch.")
            normalized_request = ScriptGenerationDraftRequest.model_validate(revised_request).model_dump(mode="json")
            from app.modules.script_engine.models import EpisodeGenerationContext
            normalized_run_context = EpisodeGenerationContext.model_validate(
                revised_run["data"].get("episode_context")
            ).model_dump(mode="json")
            _require(normalized_run_context == normalized_request["episode_context"],
                     "Revised run episode context differs from its provenance request.")
            _require(normalized_request["episode_context"]["episode_number"] == item["episode_number"],
                     "Revised request episode number mismatch.")
            for key in ("story_project_id", "content_spec_id", "generation_strategy_id"):
                _require(revised_run["data"][key] == item["run"]["data"][key], "Revised run identity mismatch.")
            item.update(run=revised_run, request=revised_request, origin="inherited_editorial_revision")
        _require(required_source <= revision["source_files_sha256"].keys(), "Editorial provenance omits required source files.")
        _require(required_revised <= revision["revised_files_sha256"].keys(), "Editorial provenance omits revised files.")
        revision_files = _files(revised_directory)
    _verify_files(source, fingerprints)
    return {"source": source, "source_files_sha256": fingerprints, "state": state,
            "selected": selected, "stale_agent_ids": stale, "workspace_revision": workspace["revision"],
            "source_code_changes": changes, "revision": revision, "revised_directory": revised_directory,
            "revision_files_sha256": revision_files, "historical_provider": _historical_usage(source),
            "historical_elapsed_seconds": summary.get("elapsed_seconds"),
            "historical_elapsed_is_intermediate_snapshot": _read(watchdog).get("original_summary_is_intermediate_snapshot", False)
            if watchdog.is_file() else False}


def copy_resume_database(resume: dict, output: Path) -> None:
    _verify_files(resume["source"], resume["source_files_sha256"])
    shutil.copy2(resume["source"] / "probe.db", output / "probe.db")
    with sqlite3.connect(output / "probe.db") as connection:
        for run_id in resume["stale_agent_ids"]:
            row = connection.execute("SELECT payload FROM agent_runs WHERE run_id = ?", (run_id,)).fetchone()
            payload = json.loads(row[0])
            payload.update(status="failed", failure_type="ProbeResumedInIsolatedCopy")
            connection.execute("UPDATE agent_runs SET status = 'failed', failure_type = ?, payload = ? WHERE run_id = ?",
                               ("ProbeResumedInIsolatedCopy", json.dumps(payload), run_id))


def restore_resume_state(client: Any, resume: dict, output: Path) -> tuple[dict, dict]:
    from app.modules.script_engine.long_story_models import EpisodeArtifactCreate
    from scripts.real_generation_probe_fixture import _data, _save_workspace, _workspace, build_probe_request
    from scripts.run_real_generation_probe import screenplay_markdown, write_json

    state = deepcopy(resume["state"])
    state["workspace_revision"] = resume["workspace_revision"]
    state["workspace"] = _workspace(state)
    previous = None
    for item in resume["selected"]:
        number = item["episode_number"]
        request = build_probe_request(state, number, previous)
        reprojected_fields = validate_reprojected_request(
            item["request"], request, resume.get("source_code_changes", []),
        )
        episode = deepcopy(item["workspace_episode"])
        run = item["run"]["data"]
        draft = run["draft_master_script"]
        if item["origin"] == "inherited_editorial_revision":
            original = item["artifact"]
            create = EpisodeArtifactCreate(
                artifact_id=f"artifact.resume.{uuid4().hex}.ep{number}", story_project_id=state["project"]["project_id"],
                episode_number=number, artifact_kind="revised", memory_layer="provisional",
                source_artifact_id=original["artifact_id"], content_schema_version="script_generation_run.v1",
                content_payload=run, lineage_refs=original.get("lineage_refs", {}),
                client_instance_id="bounded_real_generation_probe.resume.v1",
            ).model_dump(mode="json")
            endpoint = f"/story-projects/{state['project']['project_id']}/episodes/{number}/artifacts"
            artifact = _data(client, "POST", endpoint, create)
            _require(_data(client, "GET", f"{endpoint}/{artifact['artifact_id']}")["content_payload"] == run,
                     "Revised artifact did not round-trip unchanged.")
            episode["artifactRefs"] = {"revised": {"artifactId": artifact["artifact_id"], "artifactKind": "revised",
                "memoryLayer": "provisional", "artifactVersion": artifact["artifact_version"],
                "payloadChecksum": artifact["payload_checksum"], "createdAt": artifact["created_at"]}}
        episode.update(generationRun=run, workingDraftJson=json.dumps(draft, ensure_ascii=False, indent=2),
                       hasLocalDraftEdits=False)
        state["workspace"]["episodes"].append(episode)
        state["workspace"] = project_probe_continuity(state["workspace"], state["bible"])["workspace"]
        state["workspace"].update(status="draft", activeEpisodeNumber=number)
        _save_workspace(client, state)
        reloaded = _data(client, "GET", f"/story-projects/{state['project']['project_id']}/workspace")
        _require(reloaded["workspace_payload"] == state["workspace"], "Recovered workspace did not round-trip unchanged.")
        directory = output / f"episode_{number:03d}"
        directory.mkdir()
        for name, value in (("request.json", item["request"]), ("run.json", item["run"]), ("draft.json", draft),
                            ("reprojected_request.json", request),
                            ("projected_workspace.json", state["workspace"]),
                            ("provenance.json", {"origin": item["origin"], "source_directory": str(resume["source"]),
                                                  "revised_directory": str(resume["revised_directory"]) if resume["revised_directory"] else None,
                                                  "reprojected_context_fields": reprojected_fields})):
            write_json(directory / name, value)
        (directory / "SCREENPLAY.md").write_text(screenplay_markdown(draft, number), encoding="utf-8")
        previous = draft
    state["drafts"] = [item["run"]["data"]["draft_master_script"] for item in resume["selected"]]
    return state, previous


def validate_reprojected_request(historical: dict, current: dict, source_changes: list[dict]) -> list[str]:
    comparison = deepcopy(historical)
    comparison["agent_request_id"] = current["agent_request_id"]
    projection_sources = {
        "scripts/real_generation_probe_fixture.py", "scripts/real_generation_probe_continuity.py",
        "frontend/scripts/project-probe-continuity.mjs", "frontend/lib/continuity.ts",
        "frontend/lib/continuity-checkpoint.ts", "frontend/lib/memory-recall.ts",
    }
    changed = []
    if any(item["path"] in projection_sources for item in source_changes):
        for field in ("memory_recall", "provisional_continuity_checkpoint", "previous_episode_handoff"):
            old_context = comparison.get("episode_context", {})
            new_context = current.get("episode_context", {})
            if old_context.get(field) != new_context.get(field):
                old_context[field] = new_context.get(field)
                changed.append(field)
    _require(comparison == current, "Recovered request changed outside the acknowledged memory projection.")
    return changed


def verify_resume_inputs_unchanged(resume: dict) -> None:
    _verify_files(resume["source"], resume["source_files_sha256"])
    _require(_files(resume["source"]) == resume["source_files_sha256"], "Source evidence inventory changed during resume.")
    if resume["revised_directory"]:
        _verify_files(resume["revised_directory"], resume["revision_files_sha256"])
