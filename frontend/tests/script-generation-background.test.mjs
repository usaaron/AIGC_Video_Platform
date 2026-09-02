import assert from "node:assert/strict";
import test from "node:test";

import {
  beginScriptGenerationTask,
  completeScriptGenerationTask,
  failScriptGenerationTask,
  getScriptGenerationTask,
  isScriptGenerationRunning,
  isScriptGenerationPauseAbort,
  requestScriptGenerationPause,
  registerScriptGenerationAbortController,
  resumeScriptGenerationTask,
  scriptGenerationElapsedSeconds,
  updateScriptGenerationProgress,
  waitForScriptGenerationResume,
  waitForScriptGenerationIdle,
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

test("script generation pause aborts active requests and freezes elapsed time", () => {
  const projectId = `project.script.pause.abort.${crypto.randomUUID()}`;
  beginScriptGenerationTask({
    projectId,
    startEpisode: 51,
    endEpisode: 51,
  });
  updateScriptGenerationProgress(projectId, createEpisodeStreamBatch(51, 51, 1800));
  updateScriptGenerationProgress(projectId, (batch) => startEpisodeStream(batch, 51, 1800));

  const controller = new AbortController();
  const unregister = registerScriptGenerationAbortController(projectId, controller);
  requestScriptGenerationPause(projectId);

  assert.equal(controller.signal.aborted, true);
  assert.equal(isScriptGenerationPauseAbort(controller.signal), true);
  const paused = getScriptGenerationTask(projectId);
  assert.equal(paused?.status, "pausing");
  const current = paused?.progress[0];
  assert.ok(current?.pausedAt);
  const frozen = scriptGenerationElapsedSeconds(
    paused,
    Date.parse(paused.pausedAt) + 60_000,
  );
  assert.equal(
    scriptGenerationElapsedSeconds(paused, Date.parse(paused.pausedAt) + 300_000),
    frozen,
  );

  const lateController = new AbortController();
  const unregisterLate = registerScriptGenerationAbortController(projectId, lateController);
  assert.equal(lateController.signal.aborted, true);
  assert.equal(isScriptGenerationPauseAbort(lateController.signal), true);

  resumeScriptGenerationTask(projectId);
  const resumed = getScriptGenerationTask(projectId);
  assert.equal(resumed?.status, "running");
  assert.equal(resumed?.progress[0].pausedAt, undefined);
  assert.ok((resumed?.progress[0].pausedDurationMs ?? 0) >= 0);
  unregister();
  unregisterLate();
  completeScriptGenerationTask(projectId);
});

test("idle waiters release when the primary script task finishes", async () => {
  const projectId = `project.script.idle.${crypto.randomUUID()}`;
  beginScriptGenerationTask({
    projectId,
    startEpisode: 41,
    endEpisode: 48,
  });

  let released = false;
  const idle = waitForScriptGenerationIdle(projectId).then(() => {
    released = true;
  });
  await Promise.resolve();
  assert.equal(released, false);

  failScriptGenerationTask(projectId, new Error("episode 45 failed"));
  await idle;
  assert.equal(released, true);
});
