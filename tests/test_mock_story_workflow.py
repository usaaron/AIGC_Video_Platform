from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]


def test_default_mock_runs_current_story_workflow_with_durable_replay(tmp_path) -> None:
    output = tmp_path / "workflow"
    process = subprocess.run(
        [sys.executable, str(ROOT / "scripts/run_story_workflow_probe.py"), "--output", str(output)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )
    assert process.returncode == 0, process.stdout + process.stderr
    summary = json.loads((output / "summary.json").read_text())
    assert summary["status"] == "passed"
    assert summary["mode"] == "mock"
    assert summary["provider"]["physical_requests"] == 0
    assert summary["simulated_test_approvals"] is True
    assert summary["whole_work_quality_accepted"] is False
    case = json.loads((ROOT / "scripts/story_workflow_review_case.v1.json").read_text())
    assert json.loads((output / "input-case.json").read_text()) == case
    bible_input = json.loads((output / "03-bible-generate.json").read_text())["request"]["creative_prompt"]
    intent_input = json.loads((output / "01-resolve-intent.json").read_text())["request"]
    notes = "\n".join(intent_input["creative_brief"]["generation_notes"])
    for fact in [case["creative_prompt"], *case["locked_test_facts"], *case["review_criteria"]]:
        assert fact in bible_input
        assert fact in notes
    steps = {step["stage"]: step for step in summary["steps"]}
    assert steps["bible-generate"]["status"] == 200
    assert steps["tree-generate"]["status"] == 200
    assert steps["roadmap-1"]["status"] == 200
    for number in (1, 2):
        assert steps[f"body-{number}"]["status"] == 200
        assert steps[f"artifact-workspace-readback-{number}"]["status"] == "equal"
        assert steps[f"replay-no-provider-call-{number}"]["status"] is True
        assert (output / f"episode-{number}.md").read_text().strip()
    planning = json.loads((output / "planning-state.json").read_text())
    allowed = set(planning["bible"]["character_refs"])
    expected = range(planning["node"]["planned_start_episode"], planning["node"]["planned_end_episode"] + 1)
    assert [plan["episode_number"] for plan in planning["plans"]] == list(expected)
    assert all(set(plan["character_refs"]).issubset(allowed) for plan in planning["plans"])

    resumed = subprocess.run(
        [sys.executable, str(ROOT / "scripts/run_story_workflow_probe.py"), "--resume", "--output", str(output)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )
    assert resumed.returncode == 0, resumed.stdout + resumed.stderr
    resumed_summary = json.loads((output / "summary.json").read_text())
    assert resumed_summary["status"] == "passed"


@pytest.mark.parametrize("market", ["cn_mainland", "overseas"])
def test_three_episode_workflow_survives_restart_and_canonical_confirmation(tmp_path, market):
    output = tmp_path / "workflow"
    for script, args in (
        ("run_story_workflow_probe.py", ["--release-region", market, "--episodes", "3", "--output", str(output)]),
        ("verify_story_workflow_delivery.py", ["--source", str(output), "--output", str(tmp_path / "delivery")]),
    ):
        process = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / script), *args], cwd=ROOT,
            capture_output=True, text=True, timeout=90, check=False,
        )
        assert process.returncode == 0, process.stdout + process.stderr
    result = json.loads((tmp_path / "delivery" / "summary.json").read_text())
    assert result["status"] == "passed"
    assert result["provider"]["physical_requests"] == 0
    assert result["creative_approval"] is False
    assert "episode_3_restart_replay_and_artifact_equal" in result["checks"]
    assert "canonical_ledger_audit_consistent" in result["checks"]
