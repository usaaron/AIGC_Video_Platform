import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  shouldAutoResumeGenerationRecovery,
  shouldAutomaticallyContinueScriptGeneration,
} from "../lib/generation-recovery.ts";
import { inputReadinessWorkflowIntent } from "../lib/input-readiness-workflow.ts";
import {
  currentWorkspaceHref,
  workspaceSectionAccess,
} from "../lib/workspace-stage.ts";

const source = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

function project(overrides = {}) {
  return {
    id: "project.state-machine",
    storyBibleStatus: undefined,
    episodePlansReadyThrough: 0,
    generationSettings: { episodeCount: 12 },
    episodes: [],
    ...overrides,
  };
}

test("a durable script route never adds the generation intent", () => {
  const approved = project({
    planningSession: { phase: "script", status: "approved" },
  });

  assert.equal(workspaceSectionAccess(approved).script, true);
  assert.equal(currentWorkspaceHref(approved), "/projects/project.state-machine/workspace");
  assert.doesNotMatch(currentWorkspaceHref(approved), /[?&]generate=1/);
});

test("readiness analysis remains advisory until the user selects the recommended path", () => {
  const complete = {
    schemaVersion: "input_readiness.v1",
    detectedLevel: "script",
    recommendedStage: "script",
    missingItems: [],
    selectedPath: "recommended",
  };
  const fullWorkflow = { ...complete, selectedPath: "full_workflow" };
  const partial = { ...complete, detectedLevel: "episode_plan", missingItems: ["第3集缺少钩子"] };

  assert.deepEqual(inputReadinessWorkflowIntent(complete), {
    normalizeStoryBible: true,
    prepareCompletePlanning: true,
  });
  assert.deepEqual(inputReadinessWorkflowIntent(fullWorkflow), {
    normalizeStoryBible: false,
    prepareCompletePlanning: false,
  });
  assert.deepEqual(inputReadinessWorkflowIntent(partial), {
    normalizeStoryBible: true,
    prepareCompletePlanning: false,
  });
});

test("automatic script continuation is opt-in to a completed planning phase and idle tasks", () => {
  const ready = {
    planningPhase: "script",
    existingEpisodeCount: 1,
    nextReadyEpisode: 2,
    generationIntent: false,
    busy: false,
  };

  assert.equal(shouldAutomaticallyContinueScriptGeneration(ready), true);
  for (const blocked of [
    { planningPhase: "episode_roadmap" },
    { existingEpisodeCount: 0 },
    { nextReadyEpisode: null },
    { generationIntent: true },
    { busy: true },
    { browserTaskStatus: "running" },
    { browserTaskStatus: "failed" },
    { recoveryTaskStatus: "running" },
    { recoveryTaskStatus: "partial" },
  ]) {
    assert.equal(
      shouldAutomaticallyContinueScriptGeneration({ ...ready, ...blocked }),
      false,
      JSON.stringify(blocked),
    );
  }
});

test("recovery never restarts a paused/completed task or an already covered range", () => {
  const task = {
    batchId: "generation-batch.state-machine",
    batchRevision: 1,
    jobId: "generation-job.state-machine",
    jobRevision: 1,
    batchNumber: 1,
    startEpisode: 1,
    endEpisode: 3,
    episodePlanIds: ["plan.1", "plan.2", "plan.3"],
    status: "running",
    attemptCount: 1,
    completedEpisodeNumbers: [],
    failedEpisodeNumbers: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    checkpointedAt: "2026-09-01T00:00:00.000Z",
  };

  assert.equal(shouldAutoResumeGenerationRecovery(task, [1]), true);
  assert.equal(shouldAutoResumeGenerationRecovery({ ...task, status: "paused" }, [1]), false);
  assert.equal(shouldAutoResumeGenerationRecovery({ ...task, status: "completed" }, [1]), false);
  assert.equal(shouldAutoResumeGenerationRecovery(task, [1, 2, 3]), false);
  assert.equal(shouldAutoResumeGenerationRecovery(task, [1], "running"), false);
});

test("empty script workspace keeps generation behind an explicit action", async () => {
  const workspace = await source("components/script-workspace.tsx");
  const launcher = workspace.match(
    /function PendingScriptWorkspace\([\s\S]*?\n}\n\nfunction EpisodeGenerationProgress/,
  )?.[0] ?? "";
  const autoStart = workspace.match(
    /function AutoStartDirectGeneration\([\s\S]*?\n}\n\nfunction formatScriptElapsed/,
  )?.[0] ?? "";

  assert.ok(launcher);
  assert.match(launcher, /!batch\.length && !task/);
  assert.match(launcher, /onClick=\{\(\) => onRetryEpisode\(activeEpisodeNumber\)\}/);
  assert.match(autoStart, /if \(!enabled \|\| started\.current\) return/);
  assert.match(workspace, /enabled=\{generationIntent && !generationIntentConsumed && Boolean\(requestedLeafRange\)\}/);
  assert.match(workspace, /const generationIntent = searchParams\.get\("generate"\) === "1"/);
});

