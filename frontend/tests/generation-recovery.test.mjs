import assert from "node:assert/strict";
import test from "node:test";

import {
  automaticGenerationRecoveryDelayMs,
  completeRecoveryEpisode,
  continuePausedGenerationRecoveryTask,
  episodeGenerationAgentRequestId,
  failGenerationRecoveryTask,
  firstMissingRecoveryEpisode,
  finishGenerationRecoveryTask,
  pauseGenerationRecoveryTask,
  reconcileGenerationRecoveryTask,
  resumeGenerationRecoveryTask,
  shouldAutoResumeGenerationRecovery,
  shouldAutomaticallyContinueScriptGeneration,
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

test("recovery resumes orphaned work and only bounded transient failures", () => {
  assert.equal(shouldAutoResumeGenerationRecovery(baseTask, [11], undefined), true);
  assert.equal(shouldAutoResumeGenerationRecovery(baseTask, [11], undefined, "approved"), true);
  assert.equal(shouldAutoResumeGenerationRecovery(baseTask, [11], undefined, "awaiting_review"), false);
  assert.equal(shouldAutoResumeGenerationRecovery(baseTask, [11], "running"), false);
  assert.equal(shouldAutoResumeGenerationRecovery(
    { ...baseTask, status: "paused" },
    [11],
    undefined,
  ), false);
  assert.equal(shouldAutoResumeGenerationRecovery(
    { ...baseTask, status: "failed" },
    [11],
    undefined,
  ), false);
  assert.equal(shouldAutoResumeGenerationRecovery(
    { ...baseTask, status: "partial", lastError: "供应商网关状态码 524" },
    [11],
    "failed",
  ), true);
  assert.equal(shouldAutoResumeGenerationRecovery(
    { ...baseTask, status: "failed", attemptCount: 2, lastError: "当前集仍在处理中" },
    [11],
    "failed",
  ), true);
  assert.equal(shouldAutoResumeGenerationRecovery(
    {
      ...baseTask,
      status: "failed",
      attemptCount: 2,
      lastError: "当前生成请求与原始输入不一致，请重新生成当前集。",
    },
    [11],
    "failed",
  ), true);
  assert.equal(shouldAutoResumeGenerationRecovery(
    {
      ...baseTask,
      status: "partial",
      attemptCount: 3,
      lastError: "供应商网关状态码 524",
    },
    [11],
    "failed",
  ), false);
  assert.equal(shouldAutoResumeGenerationRecovery(
    { ...baseTask, status: "failed", lastError: "剧本结构校验失败" },
    [11],
    "failed",
  ), false);
  assert.equal(shouldAutoResumeGenerationRecovery(baseTask, [11, 12, 13], undefined), false);
});

test("automatic recovery uses bounded gateway cooldowns", () => {
  assert.equal(automaticGenerationRecoveryDelayMs(baseTask), 500);
  assert.equal(automaticGenerationRecoveryDelayMs({
    ...baseTask,
    status: "partial",
    lastError: "524",
  }), 10_000);
  assert.equal(automaticGenerationRecoveryDelayMs({
    ...baseTask,
    status: "partial",
    attemptCount: 2,
    lastError: "524",
  }), 30_000);
});

test("completed planning continues ready script parts but respects every stop state", () => {
  const ready = {
    planningPhase: "script",
    planningStatus: "approved",
    existingEpisodeCount: 10,
    nextReadyEpisode: 11,
    generationIntent: false,
    busy: false,
  };

  assert.equal(shouldAutomaticallyContinueScriptGeneration(ready), true);
  assert.equal(shouldAutomaticallyContinueScriptGeneration({
    ...ready,
    browserTaskStatus: "completed",
    recoveryTaskStatus: "completed",
  }), true);
  for (const browserTaskStatus of ["running", "pausing", "paused", "failed"]) {
    assert.equal(shouldAutomaticallyContinueScriptGeneration({
      ...ready,
      browserTaskStatus,
    }), false);
  }
  for (const recoveryTaskStatus of ["running", "paused", "partial", "failed"]) {
    assert.equal(shouldAutomaticallyContinueScriptGeneration({
      ...ready,
      recoveryTaskStatus,
    }), false);
  }
  assert.equal(shouldAutomaticallyContinueScriptGeneration({
    ...ready,
    nextReadyEpisode: null,
  }), false);
  assert.equal(shouldAutomaticallyContinueScriptGeneration({
    ...ready,
    planningPhase: "episode_roadmap",
  }), false);
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

test("a stale workspace failure cannot overlap a server-completed episode", () => {
  const task = {
    ...baseTask,
    completedEpisodeNumbers: [11, 12],
  };

  const failed = failGenerationRecoveryTask(task, 12, "workspace replay failed");

  assert.equal(failed.status, "partial");
  assert.deepEqual(failed.completedEpisodeNumbers, [11, 12]);
  assert.deepEqual(failed.failedEpisodeNumbers, []);
  assert.equal(failed.lastError, "workspace replay failed");
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

test("manual recovery revisions reuse the same per-episode agent checkpoint", () => {
  const firstId = episodeGenerationAgentRequestId(baseTask, 12);
  const retriedTask = resumeGenerationRecoveryTask(baseTask);
  const retriedId = episodeGenerationAgentRequestId(retriedTask, 12);

  assert.equal(
    firstId,
    "agent-request.generation-job.test.episode-12",
  );
  assert.equal(retriedId, firstId);
  assert.equal(episodeGenerationAgentRequestId(retriedTask, 12), retriedId);
});

test("manual recovery attempt count remains within the server contract", () => {
  const resumed = resumeGenerationRecoveryTask({
    ...baseTask,
    attemptCount: 20,
  });

  assert.equal(resumed.attemptCount, 20);
  assert.equal(resumed.jobRevision, 2);
});

test("checkpoint reconciliation preserves every completed episode and rebases revisions", () => {
  const remote = {
    ...baseTask,
    batchRevision: 4,
    jobRevision: 4,
    completedEpisodeNumbers: [11],
    checkpointedAt: "2026-08-10T00:02:00.000Z",
    serverBacked: true,
  };
  const requested = {
    ...baseTask,
    batchRevision: 3,
    jobRevision: 3,
    completedEpisodeNumbers: [12],
    failedEpisodeNumbers: [11, 13],
    status: "partial",
    lastError: "episode 13 failed",
    checkpointedAt: "2026-08-10T00:03:00.000Z",
  };

  const reconciled = reconcileGenerationRecoveryTask(remote, requested);

  assert.equal(reconciled.batchRevision, 5);
  assert.equal(reconciled.jobRevision, 5);
  assert.deepEqual(reconciled.completedEpisodeNumbers, [11, 12]);
  assert.deepEqual(reconciled.failedEpisodeNumbers, [13]);
  assert.equal(reconciled.lastError, "episode 13 failed");
  assert.equal(reconciled.serverBacked, true);
});

test("a completed server checkpoint cannot regress during reconciliation", () => {
  const remote = finishGenerationRecoveryTask({
    ...baseTask,
    batchRevision: 5,
    jobRevision: 5,
  });
  const requested = failGenerationRecoveryTask(baseTask, 12, "late failure");

  assert.deepEqual(
    reconcileGenerationRecoveryTask(remote, requested),
    remote,
  );
});
