"""Invoke the product's TypeScript continuity projection without model access."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTINUITY_SOURCES = (
    Path(__file__),
    ROOT / "frontend/scripts/project-probe-continuity.mjs",
    ROOT / "frontend/scripts/register-test-runtime.mjs",
    ROOT / "frontend/lib/continuity.ts",
    ROOT / "frontend/lib/continuity-checkpoint.ts",
    ROOT / "frontend/lib/generated-draft-parser.ts",
    ROOT / "frontend/lib/memory-recall.ts",
    ROOT / "frontend/lib/episode-handoff.ts",
    ROOT / "frontend/lib/episode-ending.ts",
    ROOT / "frontend/lib/screenplay-body-order.ts",
)


def project_probe_continuity(
    workspace: dict[str, Any], bible: dict[str, Any], focus: dict[str, Any] | None = None,
) -> dict[str, Any]:
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("The continuity probe requires Node.js with TypeScript stripping support.")
    payload = {"workspace": workspace, "storyBible": bible, "focus": focus or {}}
    # The pure projection process does not need provider credentials or Node preload hooks.
    environment = {key: os.environ[key] for key in ("PATH", "TMPDIR", "LANG") if key in os.environ}
    result = subprocess.run(
        [node, "--experimental-strip-types", "--import", "./scripts/register-test-runtime.mjs",
         "./scripts/project-probe-continuity.mjs"],
        input=json.dumps(payload, ensure_ascii=False), text=True, capture_output=True,
        cwd=ROOT / "frontend", env=environment, timeout=30, check=False,
    )
    if result.returncode:
        raise RuntimeError(f"Product continuity projection failed (exit {result.returncode}).")
    projection = json.loads(result.stdout)
    projected = projection["workspace"]
    if projected["id"] != workspace["id"] or projected["episodes"] != workspace["episodes"]:
        raise RuntimeError("Continuity projection changed the project identity or episode drafts.")
    checkpoint = projection["checkpoint"]
    recall = projection["memoryRecall"]
    if recall["memory_layer"] != "provisional" or recall["through_episode_number"] != len(workspace["episodes"]):
        raise RuntimeError("The product memory recall does not match the preceding episode boundary.")
    if checkpoint is not None:
        decoded = json.loads(checkpoint)
        if decoded.get("version") != "provisional":
            raise RuntimeError("The probe requires a provisional continuity checkpoint.")
    return projection
