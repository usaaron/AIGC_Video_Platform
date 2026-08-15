import assert from "node:assert/strict";
import test from "node:test";

import {
  beginScriptGenerationTask,
  completeScriptGenerationTask,
  failScriptGenerationTask,
  getScriptGenerationTask,
  isScriptGenerationRunning,
  requestScriptGenerationPause,
  resumeScriptGenerationTask,
  updateScriptGenerationProgress,
  waitForScriptGenerationResume,
} from "../lib/script-generation-background.ts";
import {
  applyEpisodeStreamEvent,
  createEpisodeStreamBatch,
  startEpisodeStream,
} from "../lib/generation-stream.ts";

test("one project cannot start the same script batch twice while it is running", () => {
  const projectId = `project.script.deduplicate.${crypto.randomUUID()}`;
  const first = beginScriptGenerationTask({
    projectId,
    startEpisode: 1,
    endEpisode: 10,
  });
  const duplicate = beginScriptGenerationTask({
    projectId,
    startEpisode: 1,
    endEpisode: 10,
  });

  assert.equal(first.started, true);
  assert.equal(duplicate.started, false);
  assert.equal(isScriptGenerationRunning(projectId), true);
  assert.deepEqual(
    [duplicate.task.startEpisode, duplicate.task.endEpisode],
    [1, 10],
  );

  completeScriptGenerationTask(projectId);
  assert.equal(getScriptGenerationTask(projectId)?.status, "completed");
  assert.equal(isScriptGenerationRunning(projectId), false);
});

test("a failed script task releases the project lock for a bounded retry", () => {
  const projectId = `project.script.retry.${crypto.randomUUID()}`;
  beginScriptGenerationTask({
    projectId,
    startEpisode: 11,
    endEpisode: 20,
  });
  failScriptGenerationTask(projectId, new Error("model output invalid"));

  const failed = getScriptGenerationTask(projectId);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.error, "model output invalid");

  const retry = beginScriptGenerationTask({
    projectId,
    startEpisode: 11,
    endEpisode: 20,
  });
  assert.equal(retry.started, true);
  completeScriptGenerationTask(projectId);
});

test("different projects can generate independently", () => {
  const left = `project.script.left.${crypto.randomUUID()}`;
  const right = `project.script.right.${crypto.randomUUID()}`;

  assert.equal(beginScriptGenerationTask({
    projectId: left,
    startEpisode: 1,
    endEpisode: 8,
  }).started, true);
  assert.equal(beginScriptGenerationTask({
    projectId: right,
    startEpisode: 1,
    endEpisode: 8,
  }).started, true);

  completeScriptGenerationTask(left);
  completeScriptGenerationTask(right);
});

test("streaming script progress remains readable outside the generating component", () => {
  const projectId = `project.script.progress.${crypto.randomUUID()}`;
  beginScriptGenerationTask({
    projectId,
    startEpisode: 21,
    endEpisode: 28,
  });
  updateScriptGenerationProgress(
    projectId,
    createEpisodeStreamBatch(21, 28, 1800),
  );
  updateScriptGenerationProgress(projectId, (batch) => startEpisodeStream(batch, 21, 1800));
  updateScriptGenerationProgress(projectId, (batch) => applyEpisodeStreamEvent(batch, 21, {
    type: "draft_delta",
    timestamp: "2026-08-12T00:00:00Z",
    phase: "draft",
    delta: '{"title":"归途","scenes":[{"slug":"码头重逢","setting":"夜/外/码头","character_actions":["林夏走进雨里。"]',
    reset: true,
  }));

  const restored = getScriptGenerationTask(projectId);
  assert.equal(restored?.progress[0].status, "active");
  assert.equal(restored?.progress[0].episodeNumber, 21);
  assert.match(restored?.progress[0].preview ?? "", /林夏走进雨里/);
  assert.equal(restored?.progress[0].attemptCount, 1);
  completeScriptGenerationTask(projectId);
});

test("script generation pauses only at a cooperative episode boundary", async () => {
  const projectId = `project.script.pause.${crypto.randomUUID()}`;
  beginScriptGenerationTask({
    projectId,
    startEpisode: 31,
    endEpisode: 38,
  });

  requestScriptGenerationPause(projectId);
  assert.equal(getScriptGenerationTask(projectId)?.status, "pausing");
  const paused = waitForScriptGenerationResume(projectId);
  await Promise.resolve();
  assert.equal(getScriptGenerationTask(projectId)?.status, "paused");
  assert.equal(isScriptGenerationRunning(projectId), true);

  resumeScriptGenerationTask(projectId);
  assert.equal(await paused, true);
  assert.equal(getScriptGenerationTask(projectId)?.status, "running");
  completeScriptGenerationTask(projectId);
});
