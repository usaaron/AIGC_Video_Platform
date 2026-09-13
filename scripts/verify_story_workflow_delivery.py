"""Verify saved workflow drafts and canonical persistence in an isolated DB copy."""

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "backend")]

from scripts.real_generation_probe_transport import ProviderRequestMeter
from scripts.run_real_generation_probe import prepare_runtime, replay_result_digest, write_json


def verify(source: Path, output: Path) -> dict:
    manifest = json.loads((source / "summary.json").read_text())
    planning = json.loads((source / "planning-state.json").read_text())
    workspace = json.loads((source / "completed-workspace.json").read_text())
    output.mkdir(parents=True, exist_ok=False)
    with sqlite3.connect(f"file:{source / 'probe.db'}?mode=ro", uri=True) as original, \
         sqlite3.connect(output / "probe.db") as copy:
        original.backup(copy)
    pid = planning["project"]["project_id"]
    base = f"/story-projects/{pid}"
    checks = []
    meter = ProviderRequestMeter(output / "provider_requests.jsonl", max_requests=0)

    def request(client, method, path, payload=None):
        response = client.request(method, path, **({"json": payload} if payload is not None else {}))
        if response.status_code not in {200, 201}:
            raise AssertionError(f"{method} {path}: HTTP {response.status_code}: {response.text}")
        return response.json()["data"]

    try:
        with meter, prepare_runtime(output, manifest["release_region"], existing=True) as client:
            saved = request(client, "GET", base + "/workspace")
            assert saved["workspace_payload"] == workspace, "Workspace changed after process restart"
            checks.append("workspace_restart_equal")
            assert len(workspace["episodes"]) == manifest["requested_body_episodes"]
            for episode in workspace["episodes"]:
                number = episode["episodeNumber"]
                record, = source.glob(f"[0-9][0-9]-body-{number}.json")
                body = json.loads(record.read_text())
                replay = request(client, "POST", "/script-generation/generate-draft", body["request"])
                assert replay_result_digest({"data": replay}) == replay_result_digest(body["response"])
                ref = episode["artifactRefs"]["draft"]["artifactId"]
                artifact = request(client, "GET", base + f"/episodes/{number}/artifacts/{ref}")
                assert artifact["content_payload"] == episode["generationRun"]
                assert artifact["memory_layer"] == "provisional"
                checks.append(f"episode_{number}_restart_replay_and_artifact_equal")
            assert request(client, "GET", base + "/continuity-ledger/latest") is None
            checks.append("unconfirmed_drafts_do_not_advance_canonical_ledger")

            # Exercise confirmation storage only in this disposable copy. This
            # is a persistence test, never author approval of the source story.
            for episode in workspace["episodes"]:
                number = episode["episodeNumber"]
                payload = {
                    "artifact_id": f"artifact.{pid}.ep{number}.test-confirmed",
                    "story_project_id": pid, "episode_number": number,
                    "artifact_kind": "draft", "memory_layer": "canonical",
                    "content_schema_version": "script_generation_run.v1",
                    "content_payload": deepcopy(episode["generationRun"]),
                    "source_artifact_id": episode["artifactRefs"]["draft"]["artifactId"],
                    "lineage_refs": {"test_scope": "simulated_confirmation_in_disposable_copy"},
                    "created_at": episode["updatedAt"],
                }
                artifact = request(client, "POST", base + f"/episodes/{number}/artifacts", payload)
                repeat = request(client, "POST", base + f"/episodes/{number}/artifacts", payload)
                assert repeat == artifact, "Confirmation replay created a second artifact"
                ledger = request(client, "GET", base + "/continuity-ledger/latest")
                assert ledger["through_episode_number"] == number
                checks.append(f"episode_{number}_canonical_ledger_and_idempotency")
            audit = request(client, "GET", base + "/continuity-ledger/audit")
            write_json(output / "ledger-audit.json", audit)
            assert audit["status"] == "consistent", f"Canonical ledger drift: {audit['conflicts']}"
            assert audit["event_set_count"] == len(workspace["episodes"])
            checks.append("canonical_ledger_audit_consistent")
            write_json(output / "canonical-ledger.json", ledger)
        outcome = {"status": "passed", "checks": checks,
                   "confirmation_scope": "simulated_on_disposable_database_copy", "creative_approval": False}
    except Exception as error:
        outcome = {"status": "failed", "checks": checks, "error_type": type(error).__name__, "detail": str(error)}
    outcome["provider"] = meter.summary()
    write_json(output / "summary.json", outcome)
    return outcome


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.source.resolve(), args.output.resolve())
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
