import assert from "node:assert/strict";
import test from "node:test";

import {
  completeRecoveryEpisode,
  continuePausedGenerationRecoveryTask,
  failGenerationRecoveryTask,
  firstMissingRecoveryEpisode,
  finishGenerationRecoveryTask,
  pauseGenerationRecoveryTask,
  resumeGenerationRecoveryTask,
} from "../lib/generation-recovery.ts";

const baseTask = {
  batchId: "generation-batch.test",
  batchRevision: 1,
  jobId: "generation-job.test",
  jobRevision: 1,
  batchNumber: 2,
  startEpisode: 11,
  endEpisode: 13,
  episodePlanIds: ["plan.11", "plan.12", "plan.13"],
  status: "running",
  attemptCount: 1,
  completedEpisodeNumbers: [],
  failedEpisodeNumbers: [],
  createdAt: "2026-08-10T00:00:00.000Z",
  checkpointedAt: "2026-08-10T00:00:00.000Z",
};

test("recovery always resumes from the first episode missing from the workspace", () => {
  const staleCheckpoint = {
    ...baseTask,
    completedEpisodeNumbers: [11, 12],
  };

  assert.equal(firstMissingRecoveryEpisode(staleCheckpoint, [11]), 12);
  assert.equal(firstMissingRecoveryEpisode(staleCheckpoint, [11, 12, 13]), null);
});

test("generation checkpoints advance monotonically across success, failure, and retry", () => {
  const afterSuccess = completeRecoveryEpisode(baseTask, 11);
  const afterFailure = failGenerationRecoveryTask(afterSuccess, 12, "timeout");
  const resumed = resumeGenerationRecoveryTask(afterFailure);
  const finished = finishGenerationRecoveryTask(resumed);

  assert.deepEqual(afterSuccess.completedEpisodeNumbers, [11]);
  assert.equal(afterFailure.status, "partial");
  assert.deepEqual(afterFailure.failedEpisodeNumbers, [12]);
  assert.equal(resumed.status, "running");
  assert.equal(resumed.attemptCount, 2);
  assert.deepEqual(resumed.failedEpisodeNumbers, []);
  assert.equal(finished.status, "completed");
  assert.deepEqual(finished.completedEpisodeNumbers, [11, 12, 13]);
  assert.equal(finished.jobRevision, 5);
});

test("pause and continue preserve the retry attempt and completed checkpoints", () => {
  const afterSuccess = completeRecoveryEpisode(baseTask, 11);
  const paused = pauseGenerationRecoveryTask(afterSuccess);
  const continued = continuePausedGenerationRecoveryTask(paused);

  assert.equal(paused.status, "paused");
  assert.equal(continued.status, "running");
  assert.equal(continued.attemptCount, 1);
  assert.deepEqual(continued.completedEpisodeNumbers, [11]);
});
