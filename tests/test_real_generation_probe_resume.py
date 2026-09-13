from copy import deepcopy
import json
import sqlite3

import pytest

from app.modules.agent_runtime.service import fingerprint_input
from app.modules.script_engine.models import ScriptGenerationDraftRequest
from scripts.real_generation_probe_fixture import _overseas_fixture, _plans, fixture_metadata
from scripts.real_generation_probe_resume import (
    ROOT, _files, _historical_usage, copy_resume_database, file_sha256,
    load_resume_source, restore_resume_state, validate_code_fingerprints,
    validate_reprojected_request,
)
from scripts.run_real_generation_probe import write_json


@pytest.fixture
def source_probe(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    state = {
        "project": {"project_id": "project.probe", "content_spec_id": "spec.probe"},
        "bible": {"story_bible_id": "bible.probe", "version": 1},
        "node": {"node_id": "node.probe", "version": 1},
        "fixture": fixture_metadata("v2"), "release_region": "overseas",
    }
    state["plans"] = [{**plan, "source_node_id": "node.probe", "source_node_version": 1,
                       "story_bible_version": 1, "status": "approved"} for plan in _overseas_fixture(_plans("v2"))]
    files = ["scripts/run_real_generation_probe.py", "scripts/real_generation_probe_fixture.py",
             "scripts/real_generation_probe_continuity.py", "scripts/real_generation_probe_transport.py",
             "scripts/real_generation_probe_resume.py", "backend/app/modules/script_engine/generation_service.py",
             "backend/app/modules/script_engine/continuity_qc.py", "frontend/lib/continuity.ts",
             "frontend/lib/continuity-checkpoint.ts", "frontend/lib/memory-recall.ts"]
    manifest = {"source_hashes": {name: file_sha256(ROOT / name) for name in files},
                "project_id": "project.probe", "release_region": "overseas", "fixture": fixture_metadata("v2")}
    write_json(source / "fixed_inputs.json", state)
    write_json(source / "run_manifest.json", manifest)
    write_json(source / "summary.json", {"project_id": "project.probe", "episodes": [{"episode_number": 1}, {"episode_number": 2}], "elapsed_seconds": 400})
    workspace = {"episodes": []}
    with sqlite3.connect(source / "probe.db") as db:
        for table, column, key in (("story_projects", "project_id", "project"),
                                   ("story_bible_versions", "story_bible_id", "bible"),
                                   ("story_plan_node_versions", "node_id", "node")):
            db.execute(f"CREATE TABLE {table} ({column} TEXT, payload TEXT)")
            db.execute(f"INSERT INTO {table} VALUES (?, ?)", (state[key][column], json.dumps(state[key])))
        db.execute("CREATE TABLE agent_runs (run_id TEXT, request_key TEXT, status TEXT, episode_number INTEGER, project_id TEXT, input_fingerprint TEXT, result_payload TEXT, payload TEXT, failure_type TEXT)")
        db.execute("CREATE TABLE agent_steps (run_id TEXT, status TEXT, checkpoint_type TEXT, checkpoint_payload TEXT)")
        db.execute("CREATE TABLE episode_artifact_versions (artifact_id TEXT, payload TEXT, payload_checksum TEXT, story_project_id TEXT, episode_number INTEGER)")
        db.execute("CREATE TABLE story_project_workspace_snapshots (project_id TEXT, revision INTEGER, payload TEXT)")
        for number in (1, 2, 3):
            directory = source / f"episode_{number:03d}"
            directory.mkdir()
            request = ScriptGenerationDraftRequest(
                content_spec_id="spec.probe", story_project_id="project.probe", agent_request_id=f"request.{number}",
                generation_strategy_id="strategy.probe", output_language="en", release_region="overseas",
                episode_context={"generation_mode": "full", "episode_number": number, "total_episodes": 3},
            ).model_dump(mode="json")
            write_json(directory / "request.json", request)
            draft = {"title": f"Original {number}", "scenes": [], "llm_metadata": {}}
            run = {"data": {"draft_master_script": draft, "story_project_id": "project.probe",
                            "content_spec_id": "spec.probe", "generation_strategy_id": "strategy.probe"}}
            completed = number < 3
            db.execute("INSERT INTO agent_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
                       (f"agent.{number}", request["agent_request_id"], "completed" if completed else "running", number,
                        "project.probe", fingerprint_input({**request, "agent_request_id": None}),
                        json.dumps({"draft_run": run["data"]}) if completed else None,
                        json.dumps({"status": "completed" if completed else "running"})))
            if not completed:
                continue
            for name, value in (("draft.json", draft), ("run.json", run), ("metrics.json", {"latency_seconds": 200})):
                write_json(directory / name, value)
            db.execute("INSERT INTO agent_steps VALUES (?, 'completed', 'episode_script_run.v1', ?)",
                       (f"agent.{number}", json.dumps(run["data"])))
            artifact = {"artifact_id": f"artifact.project.probe.ep{number}.draft", "content_payload": run["data"],
                        "memory_layer": "provisional", "artifact_kind": "draft"}
            db.execute("INSERT INTO episode_artifact_versions VALUES (?, ?, ?, ?, ?)",
                       (artifact["artifact_id"], json.dumps(artifact), fingerprint_input(run["data"]), "project.probe", number))
            workspace["episodes"].append({"episodeNumber": number, "generationRun": run["data"], "workingDraftJson": json.dumps(draft)})
        db.execute("INSERT INTO story_project_workspace_snapshots VALUES ('project.probe', 3, ?)", (json.dumps(workspace),))
    return source


def load(source, **overrides):
    return load_resume_source(source, **{"episodes": 3, "release_region": "overseas", "fixture_version": "v2",
                                         "allowed_source_changes": [], **overrides})


def test_resume_recovers_two_episodes_and_retires_only_copy(source_probe, tmp_path):
    before = _files(source_probe)
    resume = load(source_probe)
    assert [item["episode_number"] for item in resume["selected"]] == [1, 2]
    assert resume["stale_agent_ids"] == ["agent.3"]
    output = tmp_path / "resumed"
    output.mkdir()
    copy_resume_database(resume, output)
    with sqlite3.connect(output / "probe.db") as db:
        assert db.execute("SELECT status FROM agent_runs WHERE run_id = 'agent.3'").fetchone()[0] == "failed"
    assert _files(source_probe) == before


def test_memory_projection_upgrade_preserves_plans_and_archived_request():
    historical = {"agent_request_id": "old", "episode_context": {
        "episode_number": 3, "approved_episode_plan": {"episode_goal": "Verify the witness"},
        "memory_recall": {"capsules": []}, "previous_episode_handoff": "Original summary",
    }}
    current = deepcopy(historical)
    current["agent_request_id"] = "new"
    current["episode_context"]["previous_episode_handoff"] = "Original summary and exact final scene"
    before = deepcopy(historical)
    changes = [{"path": "scripts/real_generation_probe_fixture.py"}]
    with pytest.raises(ValueError, match="outside"):
        validate_reprojected_request(historical, current, [])
    assert validate_reprojected_request(historical, current, changes) == ["previous_episode_handoff"]
    assert historical == before
    current["episode_context"]["approved_episode_plan"]["episode_goal"] = "Invent a new plot"
    with pytest.raises(ValueError, match="outside"):
        validate_reprojected_request(historical, current, changes)


def test_resume_validates_archived_fingerprint_before_new_memory_defaults(source_probe):
    for number in (1, 2, 3):
        path = source_probe / f"episode_{number:03d}" / "request.json"
        request = json.loads(path.read_text())
        request["episode_context"]["memory_recall"] = {
            "schema_version": "memory_recall.v1", "memory_layer": "provisional", "task": "episode_generation",
            "through_episode_number": number - 1, "status": "sufficient", "required_refs": [],
            "missing_requirements": [], "omitted_records": [], "capsules": [{
                "capsule_id": "memory.character.lead", "memory_type": "character_state",
                "summary": "Archived state without new structured fields.", "source_episode": 0,
                "source_scene_numbers": [], "entity_refs": [], "evidence_refs": [],
                "authority": "derived", "priority": 50, "mandatory": False, "conflict_note": None,
            }],
        }
        write_json(path, request)
        with sqlite3.connect(source_probe / "probe.db") as db:
            db.execute("UPDATE agent_runs SET input_fingerprint = ? WHERE run_id = ?",
                       (fingerprint_input({**request, "agent_request_id": None}), f"agent.{number}"))
    assert len(load(source_probe)["selected"]) == 2


@pytest.mark.parametrize("mutation, message", [
    ("fixture", "fixture"), ("request", "fingerprint"), ("checkpoint", "final checkpoint"),
    ("missing_episode", "contiguous"), ("incomplete_checkpoint", "Incomplete episode has a checkpoint"),
    ("draft", "draft/run mismatch"), ("source_code", "Source code fingerprint mismatch"),
])
def test_resume_rejects_mismatched_or_incomplete_evidence(source_probe, mutation, message):
    if mutation in {"fixture", "source_code"}:
        path = source_probe / "run_manifest.json"
        payload = json.loads(path.read_text())
        if mutation == "fixture":
            payload["fixture"] = fixture_metadata("v1")
        else:
            payload["source_hashes"]["frontend/lib/continuity.ts"] = "0" * 64
        write_json(path, payload)
    elif mutation in {"request", "draft"}:
        path = source_probe / "episode_001" / f"{mutation}.json"
        payload = json.loads(path.read_text())
        payload["desired_scene_count" if mutation == "request" else "title"] = 4 if mutation == "request" else "changed"
        write_json(path, payload)
    elif mutation == "missing_episode":
        (source_probe / "episode_001/run.json").unlink()
    else:
        with sqlite3.connect(source_probe / "probe.db") as db:
            if mutation == "checkpoint":
                db.execute("DELETE FROM agent_steps WHERE run_id = 'agent.1'")
            else:
                db.execute("INSERT INTO agent_steps VALUES ('agent.3', 'completed', 'episode_script_pre_edit_run.v2', '{}')")
    with pytest.raises(ValueError, match=message):
        load(source_probe)


def test_source_changes_require_exact_current_fingerprint(source_probe):
    manifest = json.loads((source_probe / "run_manifest.json").read_text())
    name = "frontend/lib/continuity.ts"
    current = manifest["source_hashes"][name]
    manifest["source_hashes"][name] = "0" * 64
    assert validate_code_fingerprints(manifest["source_hashes"], [f"{name}={current}"]) == [
        {"path": name, "inherited_sha256": "0" * 64, "current_sha256": current}]
    with pytest.raises(ValueError, match="Allowed source fingerprint mismatch"):
        validate_code_fingerprints(manifest["source_hashes"], [f"{name}={'1' * 64}"])


def test_revised_source_provenance_selects_corrected_drafts(source_probe, tmp_path):
    revised = tmp_path / "revised"
    revised.mkdir()
    for number in (1, 2):
        directory = revised / f"episode_{number:03d}"
        directory.mkdir()
        run = json.loads((source_probe / directory.name / "run.json").read_text())
        run["data"]["draft_master_script"]["title"] = f"Corrected {number}"
        run["data"]["episode_context"] = json.loads((source_probe / directory.name / "request.json").read_text())["episode_context"]
        write_json(directory / "run.json", run)
        write_json(directory / "draft.json", run["data"]["draft_master_script"])
        write_json(directory / "request.json", json.loads((source_probe / directory.name / "request.json").read_text()))
    revision = {"schema_version": 1, "source_directory": str(source_probe), "source_files_sha256": _files(source_probe),
                "revised_files_sha256": _files(revised), "episodes": [{"episode_number": 1}, {"episode_number": 2}]}
    write_json(revised / "revision.json", revision)
    result = load(source_probe, revised_directory=revised)
    assert [item["run"]["data"]["draft_master_script"]["title"] for item in result["selected"]] == ["Corrected 1", "Corrected 2"]
    assert all(item["origin"] == "inherited_editorial_revision" for item in result["selected"])
    path = revised / "episode_002/run.json"
    run = json.loads(path.read_text())
    run["data"]["episode_context"]["episode_number"] = 1
    write_json(path, run)
    revision["revised_files_sha256"]["episode_002/run.json"] = file_sha256(path)
    write_json(revised / "revision.json", revision)
    with pytest.raises(ValueError, match="Revised run episode context"):
        load(source_probe, revised_directory=revised)
    revision["source_files_sha256"]["episode_002/draft.json"] = "0" * 64
    write_json(revised / "revision.json", revision)
    with pytest.raises(ValueError, match="Source file fingerprint mismatch"):
        load(source_probe, revised_directory=revised)


def test_historical_usage_retains_interrupted_unknowns(tmp_path):
    rows = [{"event": "request_finished", "request_id": 1, "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}},
            {"event": "request_started", "request_id": 2, "usage": None}]
    (tmp_path / "provider_requests.jsonl").write_text("\n".join(json.dumps(row) for row in rows))
    usage = _historical_usage(tmp_path)
    assert usage["physical_requests"] == 2
    assert usage["requests_missing_usage"] == 1
    assert usage["known_tokens"]["total_tokens"] == 15
    assert usage["total_usage_complete"] is False
    assert usage["counted_against_current_budget"] is False


def test_restore_revised_working_draft_rebuilds_real_product_state(tmp_path, monkeypatch):
    from scripts import real_generation_probe_fixture as fixture
    from tests.test_real_generation_probe import _continuity_bridge_input

    workspace, bible = _continuity_bridge_input()
    old_episode = deepcopy(workspace["episodes"][0])
    corrected = deepcopy(old_episode["generationRun"]["draft_master_script"])
    corrected["character_state_updates"][0].update(life_status="alive", change_summary="Reached the station safely.",
                                                   change_cause="Left before the collapse.")
    corrected["scenes"][0]["character_actions"] = ["Eve Hart reaches the station safely."]
    revised_run = {"data": {"draft_master_script": corrected}}
    workspace["episodes"] = []
    state = {"project": {"project_id": workspace["id"]}, "bible": bible}
    stored = {}
    monkeypatch.setattr(fixture, "_workspace", lambda state: deepcopy(workspace))
    monkeypatch.setattr(fixture, "build_probe_request", lambda state, number, previous: {"agent_request_id": "request.same"})

    def data(client, method, path, payload=None):
        if path.endswith("/workspace"):
            return {"workspace_payload": stored["workspace"]}
        if method == "POST":
            stored["artifact"] = {**payload, "artifact_version": 1, "payload_checksum": fingerprint_input(payload["content_payload"]), "created_at": "2026-01-01T00:00:00Z"}
        return stored["artifact"]

    def save(client, state):
        stored["workspace"] = deepcopy(state["workspace"])

    monkeypatch.setattr(fixture, "_data", data)
    monkeypatch.setattr(fixture, "_save_workspace", save)
    resume = {"state": state, "workspace_revision": 1, "source": tmp_path / "source", "revised_directory": tmp_path / "revised",
              "selected": [{"episode_number": 1, "request": {"agent_request_id": "request.same"},
                            "workspace_episode": old_episode, "run": revised_run, "origin": "inherited_editorial_revision",
                            "artifact": {"artifact_id": "artifact.original"}}]}
    recovered, previous = restore_resume_state(None, resume, tmp_path)
    assert previous == corrected
    episode = recovered["workspace"]["episodes"][0]
    assert json.loads(episode["workingDraftJson"]) == corrected
    assert episode["generationRun"]["draft_master_script"] == corrected
    assert recovered["workspace"]["characters"][0]["dynamicState"]["lifeStatus"] == "alive"
    assert stored["artifact"]["artifact_kind"] == "revised"
    assert stored["artifact"]["source_artifact_id"] == "artifact.original"
    assert old_episode["generationRun"]["draft_master_script"] != corrected


def test_prepare_only_resumes_at_episode_three_with_zero_requests(source_probe, tmp_path, monkeypatch):
    from contextlib import nullcontext
    from scripts import real_generation_probe_fixture as fixture
    from scripts import real_generation_probe_resume as resume_module
    from scripts import run_cn_recursive_600k_acceptance as metrics_module
    from scripts import run_real_generation_probe as runner

    resume = load(source_probe)
    before = _files(source_probe)
    state = deepcopy(resume["state"])
    state["canonical_names"] = {}
    previous = resume["selected"][-1]["run"]["data"]["draft_master_script"]

    def restore(client, loaded, output):
        for item in loaded["selected"]:
            (output / f"episode_{item['episode_number']:03d}").mkdir()
        return state, previous

    requested = []

    def request(recovered, number, draft):
        assert draft == previous
        assert number == 3
        requested.append(number)
        return {"agent_request_id": "old.request", "episode_context": {"episode_number": number,
                "previous_episode_handoff": draft["title"]}}

    class NoGenerationClient:
        def post(self, *args, **kwargs):
            pytest.fail("Prepare-only must not call generation.")

    output = tmp_path / "prepared"
    monkeypatch.setattr(runner, "prepare_runtime", lambda *args, **kwargs: nullcontext(NoGenerationClient()))
    monkeypatch.setattr(resume_module, "restore_resume_state", restore)
    monkeypatch.setattr(fixture, "build_probe_request", request)
    monkeypatch.setattr(runner, "overseas_language_audit", lambda *args: {"language_contract_passed": True})
    monkeypatch.setattr(metrics_module, "episode_metrics", lambda number, draft, latency: {
        "episode_number": number, "effective_body_characters": 0, "scene_count": 0})
    monkeypatch.setattr("sys.argv", ["probe", "--resume-from", str(source_probe), "--output-dir", str(output),
                                    "--fixture-version", "v2", "--episodes", "3", "--prepare-only"])
    assert runner.main() == 0
    assert requested == [3]
    payload = json.loads((output / "episode_003/request.json").read_text())
    assert payload["agent_request_id"] != "old.request"
    assert payload["episode_context"]["previous_episode_handoff"] == previous["title"]
    summary = json.loads((output / "summary.json").read_text())
    assert summary["status"] == "prepared"
    assert summary["provider"]["physical_requests"] == 0
    assert summary["resume"]["first_new_episode"] == 3
    assert summary["resume"]["new_episode_numbers"] == []
    assert [row["latency_seconds"] for row in summary["episodes"]] == [None, None]
    assert _files(source_probe) == before


def test_replay_verifies_inherited_revision_without_replaying_original_agent(tmp_path, monkeypatch):
    from contextlib import nullcontext
    from scripts import real_generation_probe_fixture as fixture
    from scripts import run_real_generation_probe as runner

    directory = tmp_path / "episode_001"
    directory.mkdir()
    revised = {"draft_master_script": {"title": "Corrected text"}}
    write_json(tmp_path / "summary.json", {"project_id": "project.probe", "release_region": "overseas"})
    write_json(directory / "request.json", {"agent_request_id": "original.completed.agent"})
    write_json(directory / "run.json", {"data": revised})
    write_json(directory / "provenance.json", {"origin": "inherited_editorial_revision"})
    workspace = {"episodes": [{"episodeNumber": 1, "generationRun": revised,
                               "workingDraftJson": json.dumps(revised["draft_master_script"]),
                               "artifactRefs": {"revised": {"artifactId": "artifact.revised"}}}]}

    class NoGenerationClient:
        def post(self, *args, **kwargs):
            pytest.fail("An inherited revision must not replay the original completed Agent.")

    monkeypatch.setattr(runner, "prepare_runtime", lambda *args, **kwargs: nullcontext(NoGenerationClient()))
    monkeypatch.setattr(fixture, "_data", lambda client, method, path: {"workspace_payload": workspace}
                        if path.endswith("/workspace") else {"content_payload": revised})
    assert runner.verify_replay(tmp_path) == 0
    result = json.loads((tmp_path / "replay_verification.json").read_text())
    assert result["provider"]["physical_requests"] == 0
    assert result["episodes"][0]["verification"] == "inherited_revised_artifact_retrieval"
    assert result["episodes"][0]["generation_replayed"] is False
