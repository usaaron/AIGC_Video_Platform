"""Verify saved screenplay -> storyboard -> actual host v2 export in isolation.

The input must be a completed workflow probe, never the interactive preview DB.
By default this only inspects copied inputs. --real opts in to at most six
physical provider requests in fifteen minutes. No HTTP listener is started and
the host import request is captured in memory instead of sent to the main app.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def dump(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def check(condition: bool, message: str) -> None:
    if not condition:
        raise ProbeCheckError(message)


class ProbeCheckError(RuntimeError):
    """Only constant, content-free diagnostic messages belong in this exception."""


FRONTEND_SCRIPT = r"""
import fs from 'node:fs';
import path from 'node:path';
import { resolveSavedDraft } from './lib/script-draft-state.ts';
import { buildImportMaterial } from './lib/host-import-payload.ts';
import { importMaterial } from './lib/host-import.ts';

const [mode, output, target] = process.argv.slice(2);
const read = name => JSON.parse(fs.readFileSync(path.join(output, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const project = read('completed-workspace.json');
const episodes = project.episodes
  .filter(e => e.episodeNumber <= project.generationSettings.episodeCount)
  .map(e => ({ episodeNumber: e.episodeNumber, id: e.id, draft: resolveSavedDraft(e) }))
  .filter(e => e.draft)
  .sort((a, b) => a.episodeNumber - b.episodeNumber);
write('resolved-episodes.json', episodes);
if (mode === 'export') {
  const boards = new Map(read('storyboards.json').map(b => [b.episode_number, b]));
  const material = buildImportMaterial(project, boards);
  write('host-import-material.json', material);
  let captured;
  globalThis.fetch = async (url, init) => {
    if (url !== 'http://probe.invalid/api/v1/script-master/imports' || init?.method !== 'POST' || captured)
      throw new Error('Unexpected network request in captured host export.');
    captured = JSON.parse(init.body);
    return Response.json({ status: 'completed', targetProjectId: target,
      importedEpisodes: 0, updatedEpisodes: 0, importedAssets: 0, updatedAssets: 0,
      preservedAssets: 0, importedShots: 0, updatedShots: 0 });
  };
  await importMaterial(project, target, material, {
    episodeIds: material.episodes.map(e => e.sourceEpisodeId), assets: true, shots: true,
  });
  if (!captured) throw new Error('Host export did not create a payload.');
  write('host-import-v2-payload.json', captured);
}
"""


def run_frontend(mode: str, output: Path, target: str) -> None:
    node = shutil.which("node")
    check(node is not None, "Node.js is required for the actual frontend export.")
    # The export subprocess has no model credentials and only a reserved .invalid
    # destination. Its fetch is replaced before importMaterial can make a request.
    environment = {
        name: value for name, value in os.environ.items()
        if not name.startswith(("LLM_", "NEXT_PUBLIC_", "HOST_"))
        and not any(part in name.upper() for part in ("API_KEY", "TOKEN", "SECRET", "PASSWORD"))
    }
    environment["NEXT_PUBLIC_HOST_DELIVERY_URL"] = "http://probe.invalid/api/v1/script-master/deliveries"
    process = subprocess.run(
        [node, "--no-warnings", "--experimental-strip-types", "--import",
         "./scripts/register-test-runtime.mjs", "--input-type=module", "-", mode, str(output), target],
        input=FRONTEND_SCRIPT, text=True, encoding="utf-8", capture_output=True,
        cwd=ROOT / "frontend", env=environment, timeout=60, check=False,
    )
    # Do not persist stderr: an imported module error can embed a config value.
    check(process.returncode == 0, f"Frontend {mode} failed; no remote host request was sent.")


def copy_source(source: Path, output: Path, *, allow_fixture_source: bool = False) -> dict[str, Any]:
    source = source.resolve(strict=True)
    output = output.resolve()
    check(not output.exists(), "Output must be a new isolated directory.")
    check(not output.is_relative_to(source), "Output must be outside the source directory.")
    check(source != (ROOT / ".cache" / "local-preview").resolve(), "Interactive preview data cannot be a probe source.")
    check((source / "summary.json").is_file() and (source / "probe.db").is_file(),
          "Source is missing its completed probe summary or database.")
    summary = read(source / "summary.json")
    artifacts = {"summary.json": "source-summary.json"}
    if (source / "fixed_inputs.json").is_file():
        check(summary.get("status") == "sample_generated", "Fixed-planning source probe must have completed successfully.")
        check(summary.get("fixture", {}).get("version") == "v2", "Fixed-planning source must use the v2 fixture.")
        check(summary.get("provider", {}).get("physical_requests", 0) > 0,
              "Fixed-planning source has no recorded real-model requests.")
        saved = summary.get("episodes", [])
        check(bool(saved) and len(saved) == summary.get("requested_episodes"), "Fixed-planning source has incomplete saved episodes.")
        workspaces = sorted(source.glob("episode_*/projected_workspace.json"))
        check(len(workspaces) == len(saved), "Fixed-planning source is missing saved workspace artifacts.")
        artifacts.update({"fixed_inputs.json": "fixed_inputs.json", "run_manifest.json": "source-run-manifest.json",
                          str(workspaces[-1].relative_to(source)): "completed-workspace.json"})
        scope = "fixed-v2-planning-real-body"
    else:
        check(summary.get("status") == "passed", "Source workflow probe must have completed successfully.")
        check(summary.get("mode") == "real" or (allow_fixture_source and summary.get("mode") == "mock"),
              "Source must contain real-model workflow output unless --allow-fixture-source is explicit.")
        artifacts.update({"completed-workspace.json": "completed-workspace.json", "planning-state.json": "planning-state.json"})
        scope = "mock-body-real-storyboard" if summary.get("mode") == "mock" else "real-input-planning-body-workflow"
    check(all((source / name).is_file() for name in artifacts), "Source is missing completed probe artifacts.")
    check((source / "probe.db").resolve() != (ROOT / ".cache" / "local-preview" / "script-master.db").resolve(),
          "Interactive preview database cannot be a probe source.")
    output.mkdir(parents=True)
    hashes: dict[str, str] = {}
    for name, destination_name in artifacts.items():
        content = (source / name).read_bytes()
        hashes[name] = hashlib.sha256(content).hexdigest()
        (output / destination_name).write_bytes(content)
    # SQLite backup includes any committed WAL data and never edits the source.
    with sqlite3.connect((source / "probe.db").as_uri() + "?mode=ro", uri=True) as origin:
        with sqlite3.connect(output / "probe.db") as destination:
            origin.backup(destination)
    return {"directory": str(source), "artifact_sha256": hashes, "scope": scope,
            "mode": "mock" if scope == "mock-body-real-storyboard" else "real",
            "source_workspace_artifact": next(name for name, target in artifacts.items() if target == "completed-workspace.json")}


class FixtureStoryboardAdapter:
    """Deterministic test-only scene output; never a claim of model quality."""

    def generate_structured_output_stream(self, prompt: str, *, strategy: Any, output_schema: dict) -> dict:
        check(output_schema.get("title") == "SceneProposal", "Fixture adapter received an unexpected schema.")
        context = json.loads(prompt.rsplit("\n", 1)[1])
        source = context["scene"]
        shots = []
        for reference in context["ordered_source_refs"]:
            kind, raw_index = reference.split(":")
            index = int(raw_index)
            if kind == "action":
                action = source["character_actions"][index]
                text = action if isinstance(action, str) else action.get("action", json.dumps(action, ensure_ascii=False))
            else:
                dialogue = source["dialogues"][index]
                text = dialogue.get("text", "按已保存正文说出台词。")
            shots.append({"source_refs": [reference], "purpose": "固定夹具验证正文引用与主站导入",
                          "duration_seconds": 10, "framing": "中景", "camera": "固定机位",
                          "action_sequence": [text], "sound": "", "continuity_in": "按本场已保存正文的起始状态",
                          "continuity_out": "按当前引用动作或对白完成后的状态"})
        return {"design": {"purpose": "固定夹具验证持久化", "reveal_order": "严格按正文顺序",
                           "spatial_layout": "沿用正文场景", "action_rhythm": "逐项回放",
                           "transition": "衔接下一场已保存正文"}, "shots": shots,
                "unresolved_questions": ["固定分镜夹具只验证操作与数据衔接，不代表真实模型或创意质量。"]}


def runtime(output: Path, *, real: bool, mock_storyboard: bool = False) -> Any:
    from scripts.run_local_preview_backend import configure_environment, parse_env

    # Override the preview helper's DB default before importing any backend code.
    configure_environment({} if mock_storyboard else parse_env((ROOT / ".env.local").read_text(encoding="utf-8-sig")))
    os.environ["DATABASE_URL"] = f"sqlite:///{(output / 'probe.db').as_posix()}"
    os.environ["LLM_STORYBOARD_TIMEOUT_SECONDS"] = "300"
    os.environ["LLM_STORYBOARD_REQUEST_DEADLINE_SECONDS"] = "300"
    os.environ["LLM_STORYBOARD_MAX_RETRIES"] = "0"
    logging.disable(logging.CRITICAL)
    if real:
        from app.llm_runtime import build_storyboard_llm_adapter_from_env
        from app.modules.script_engine.llm_adapter import MockLLMAdapter

        check(not isinstance(build_storyboard_llm_adapter_from_env(), MockLLMAdapter),
              "Real storyboard probe refuses a mock model adapter.")
    from fastapi.testclient import TestClient
    from app.main import create_app

    if mock_storyboard:
        import app.dependencies as dependencies

        dependencies.build_storyboard_llm_adapter_from_env = FixtureStoryboardAdapter
    # Avoid lifespan tasks such as feed refreshes; all exercised routes are local.
    return TestClient(create_app(), raise_server_exceptions=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--real", action="store_true", help="Allow at most six physical model requests; otherwise inspect only.")
    modes.add_argument("--mock-storyboard", action="store_true", help="Exercise the complete chain using explicit deterministic scene fixtures, with zero provider requests.")
    parser.add_argument("--allow-fixture-source", action="store_true", help="Explicitly allow a successful mock-body source; this never makes its prose real-model output.")
    parser.add_argument("--target-project", default="integrated-storyboard-probe", help="Local captured payload target; never contacted.")
    args = parser.parse_args()
    output = args.output.resolve()
    started = time.monotonic()
    summary: dict[str, Any] = {"mode": "real" if args.real else "mock" if args.mock_storyboard else "inspect", "status": "running", "steps": [],
                               "limits": {"physical_requests": 6, "request_seconds": 300, "total_seconds": 900}}
    client = None
    meter = None
    stage = "copy-source"
    owns_output = False

    def call(label: str, method: str, path: str, payload: dict | None = None) -> dict:
        nonlocal stage
        stage = label
        print(f"Storyboard probe: {label}", flush=True)
        then = time.monotonic()
        response = client.request(method, path, **({"json": payload} if payload is not None else {}))
        record = {"stage": label, "status": response.status_code, "seconds": round(time.monotonic() - then, 3)}
        summary["steps"].append(record)
        dump(output / "summary.json", summary)
        check(response.status_code == 200, f"API stage {label} returned HTTP {response.status_code}.")
        data = response.json()["data"]
        dump(output / f"{len(summary['steps']):02d}-{label}.json", data)
        return data

    def verify_board(board: dict, draft: dict, *, complete: bool) -> None:
        from app.modules.master_script.models import DraftMasterScript
        from app.modules.preproduction.service import source_signature

        normalized = DraftMasterScript.model_validate(draft)
        check(board["source_signature"] == source_signature(draft), "Storyboard source signature changed.")
        if complete:
            check({s["scene_number"] for s in board["scenes"]} == {s.scene_number for s in normalized.scenes},
                  "Storyboard did not preserve every source scene.")
        for scene in board["scenes"]:
            original = next(s for s in normalized.scenes if s.scene_number == scene["scene_number"])
            references = [reference for shot in scene["shots"] for reference in shot["source_refs"]]
            check(references == original.body_order, "Storyboard references dropped or reordered source content.")
            check(all(shot["prompt"].strip() for shot in scene["shots"]), "Saved storyboard contains an empty compiled prompt.")

    try:
        summary["source"] = copy_source(args.source, output, allow_fixture_source=args.allow_fixture_source)
        summary["source_scope"] = summary["source"]["scope"]
        if not args.real:
            summary["source_scope"] = f"{summary['source']['mode']}-body-{'mock-storyboard' if args.mock_storyboard else 'inspect'}"
        summary["source"]["scope"] = summary["source_scope"]
        owns_output = True
        stage = "resolve-saved-episodes"
        run_frontend("resolve", output, args.target_project)
        episodes = read(output / "resolved-episodes.json")
        check(bool(episodes), "Completed workspace has no saved episodes.")
        episode = episodes[0]
        number = episode["episodeNumber"]
        draft = episode["draft"]
        scene_numbers = [scene["scene_number"] for scene in draft["scenes"]]
        check(1 <= len(scene_numbers) <= 5, "The first saved episode must have one to five scenes within the six-call budget.")
        workspace = read(output / "completed-workspace.json")
        pid = workspace["id"]
        source_summary = read(output / "source-summary.json")
        planning = read(output / ("fixed_inputs.json" if (output / "fixed_inputs.json").is_file() else "planning-state.json"))
        check(pid == source_summary["project_id"] == planning["project"]["project_id"], "Source project IDs disagree.")
        summary.update(project_id=pid, episode_number=number, planned_scenes=scene_numbers,
                       saved_episodes=[e["episodeNumber"] for e in episodes])
        from scripts.real_generation_probe_transport import ProviderRequestMeter

        meter = ProviderRequestMeter(output / "provider_requests.jsonl", max_requests=6 if args.real else 0,
                                     deadline_seconds=900, request_timeout_seconds=300)
        with meter:
            client = runtime(output, real=args.real, mock_storyboard=args.mock_storyboard)
            snapshot = call("source-workspace-readback", "GET", f"/story-projects/{pid}/workspace")
            check(snapshot["workspace_payload"] == workspace, "Copied database workspace differs from completed artifact.")
            if not args.real and not args.mock_storyboard:
                summary.update(status="inspected", limitations=["Inspect mode does not generate, save, or export storyboards."])
            else:
                route = f"/story-projects/{pid}/episodes/{number}/storyboard"
                stage = "verify-new-storyboard"
                check(client.get(route).status_code == 404, "Source already has a storyboard; this probe requires a fresh episode.")
                board = call("start", "POST", route, {"source_draft": draft, "expected_revision": 0})
                check(board["revision"] == 1 and not board["scenes"], "Storyboard start did not create an empty first revision.")
                for scene_number in scene_numbers:
                    previous_revision = board["revision"]
                    board = call(f"generate-scene-{scene_number}", "POST", f"{route}/scenes/{scene_number}/generate",
                                 {"expected_revision": previous_revision, "instruction": ""})
                    check(board["revision"] == previous_revision + 1 and not board["candidate"],
                          "Initial scene generation did not save its result directly.")
                    verify_board(board, draft, complete=False)
                verify_board(board, draft, complete=True)
                first = scene_numbers[0]
                saved_scenes = deepcopy(board["scenes"])
                previous_revision = board["revision"]
                board = call("regenerate-first-scene", "POST", f"{route}/scenes/{first}/generate",
                             {"expected_revision": previous_revision, "instruction": ""})
                check(board["revision"] == previous_revision + 1 and bool(board["candidate"]), "Regeneration did not create a review candidate.")
                check(board["scenes"] == saved_scenes, "Unaccepted candidate changed saved scenes.")
                candidate = deepcopy(board["candidate"])
                previous_revision = board["revision"]
                board = call("accept-candidate", "PUT", route, {"expected_revision": previous_revision,
                             "visual_direction": board["visual_direction"], "scenes": board["scenes"], "candidate_action": "accept"})
                check(board["revision"] == previous_revision + 1 and board["candidate"] is None, "Candidate acceptance did not advance the saved revision.")
                accepted = next(s for s in board["scenes"] if s["scene_number"] == first)
                check([s["shot_id"] for s in accepted["shots"]] == [s["shot_id"] for s in candidate["shots"]],
                      "Accepted scene does not contain the candidate shots.")
                verify_board(board, draft, complete=True)
                reloaded = call("storyboard-readback", "GET", route)
                check(reloaded == board, "Persisted storyboard did not round-trip exactly.")
                check(call("history-readback", "GET", f"{route}?revision={previous_revision}")["candidate"] == candidate,
                      "Candidate revision was not preserved in storyboard history.")
                before = deepcopy(workspace["episodes"])
                workspace.update(activeEpisodeNumber=number, productionOutputMode="script_and_storyboard",
                                 updatedAt=datetime.now(timezone.utc).isoformat())
                saved = call("workspace-save", "PUT", f"/story-projects/{pid}/workspace", {
                    "project_id": pid, "revision": snapshot["revision"] + 1,
                    "client_instance_id": "integrated_storyboard_probe.v1", "workspace_payload": workspace})
                verified = call("workspace-readback", "GET", f"/story-projects/{pid}/workspace")
                check(verified["revision"] == saved["revision"] and verified["workspace_payload"] == workspace,
                      "Workspace did not round-trip exactly after storyboard generation.")
                check(workspace["episodes"] == before, "Storyboard workflow changed saved screenplay content.")
                check(call("storyboard-after-workspace", "GET", route) == board, "Workspace save changed persisted storyboard.")
                dump(output / "completed-workspace.json", workspace)
                dump(output / "storyboards.json", [board])
                stage = "host-v2-export"
                run_frontend("export", output, args.target_project)
                payload = read(output / "host-import-v2-payload.json")
                material = read(output / "host-import-material.json")
                imported = next(e for e in payload["episodes"] if e["episodeNumber"] == number)
                shots = sum(len(s["shots"]) for s in board["scenes"])
                summary.update(storyboard_revision=board["revision"], storyboard_scenes=len(board["scenes"]),
                               storyboard_shots=shots, storyboard_findings=board["findings"],
                               host_export={"payload": str(output / "host-import-v2-payload.json"),
                                            "episodes": len(payload["episodes"]), "assets": len(payload["assets"]),
                                            "selected_episode_shots": len(imported.get("shots", [])),
                                            "warnings": material["warnings"]},
                               limitations=["Only the first saved episode's storyboard was generated.",
                                            "Provider repair requests share the six-request limit.",
                                            "Host v2 payload was captured; main-project import requires its separate isolated verification.",
                                            "Structural persistence checks do not establish creative approval."])
                check(payload["contractVersion"] == "script_master_delivery.v2", "Unexpected host import contract.")
                check(len(imported.get("shots", [])) == shots and shots > 0,
                      "Actual host exporter omitted generated shots; inspect material warnings for compatibility limits.")
                summary["status"] = "passed"
    except Exception as error:
        summary.update(status="failed", failed_stage=stage, error_type=type(error).__name__)
        if isinstance(error, ProbeCheckError):
            summary["error"] = str(error)
    finally:
        if client is not None:
            client.close()
        summary["seconds"] = round(time.monotonic() - started, 3)
        if meter is not None:
            summary["provider"] = meter.summary()
        if owns_output:
            dump(output / "summary.json", summary)
        print(f"Storyboard probe: {summary['status']} at {stage}", flush=True)
    return 0 if summary["status"] in {"passed", "inspected"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
