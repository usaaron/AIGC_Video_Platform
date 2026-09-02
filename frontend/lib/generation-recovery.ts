import type {
  GenerationRecoveryStatus,
  GenerationRecoveryTask,
} from "@/lib/types";

export const MAX_AUTOMATIC_RECOVERY_ATTEMPTS = 3;

const TRANSIENT_RECOVERY_ERROR = /(?:failed to fetch|fetch failed|load failed|network(?:error| request)?|connection\s+(?:reset|closed|refused)|connect(?:ion)?(?:error| failed)|socket|broken pipe|peer closed|eof|stream (?:disconnected|terminated|ended)|timed out|timeout|gateway|upstream|rate.?limit|too many requests|(?:^|\D)(?:408|429|502|503|504|524)(?:\D|$)|网关|上游|网络|连接.*(?:中断|断开|失败)|超时|暂时不可用|仍在处理|处理中|正文终审|恢复标识.*不一致|原始输入不一致)/i;

export function createGenerationRecoveryTask(input: {
  batchNumber: number;
  startEpisode: number;
  endEpisode: number;
  episodePlanIds: string[];
  instruction?: string;
}): GenerationRecoveryTask {
  const now = new Date().toISOString();
  return {
    batchId: `generation-batch.${crypto.randomUUID()}`,
    batchRevision: 1,
    jobId: `generation-job.${crypto.randomUUID()}`,
    jobRevision: 1,
    batchNumber: input.batchNumber,
    startEpisode: input.startEpisode,
    endEpisode: input.endEpisode,
    episodePlanIds: input.episodePlanIds,
    instruction: input.instruction?.trim() || undefined,
    status: "running",
    attemptCount: 1,
    completedEpisodeNumbers: [],
    failedEpisodeNumbers: [],
    createdAt: now,
    checkpointedAt: now,
  };
}

export function resumeGenerationRecoveryTask(
  task: GenerationRecoveryTask,
): GenerationRecoveryTask {
  return reviseTask(task, {
    status: "running",
    attemptCount: Math.min(task.attemptCount + 1, 20),
    failedEpisodeNumbers: [],
    lastError: undefined,
  });
}

export function episodeGenerationAgentRequestId(
  task: GenerationRecoveryTask,
  episodeNumber: number,
): string {
  // Job revisions are persistence checkpoints, not new creative inputs. Keep
  // the request stable so a manual resume can reuse the validated pre-edit
  // episode and continue at GPT finalization.
  return `agent-request.${task.jobId}.episode-${episodeNumber}`;
}

export function pauseGenerationRecoveryTask(
  task: GenerationRecoveryTask,
): GenerationRecoveryTask {
  return reviseTask(task, {
    status: "paused",
    failedEpisodeNumbers: [],
    lastError: undefined,
  });
}

export function continuePausedGenerationRecoveryTask(
  task: GenerationRecoveryTask,
): GenerationRecoveryTask {
  return reviseTask(task, {
    status: "running",
    failedEpisodeNumbers: [],
    lastError: undefined,
  });
}

export function completeRecoveryEpisode(
  task: GenerationRecoveryTask,
  episodeNumber: number,
): GenerationRecoveryTask {
  return reviseTask(task, {
    status: "running",
    completedEpisodeNumbers: sortedUnique([
      ...task.completedEpisodeNumbers,
      episodeNumber,
    ]),
    failedEpisodeNumbers: task.failedEpisodeNumbers.filter(
      (value) => value !== episodeNumber,
    ),
    lastError: undefined,
  });
}

export function failGenerationRecoveryTask(
  task: GenerationRecoveryTask,
  episodeNumber: number,
  error: string,
): GenerationRecoveryTask {
  const completed = new Set(task.completedEpisodeNumbers);
  return reviseTask(task, {
    status: task.completedEpisodeNumbers.length ? "partial" : "failed",
    failedEpisodeNumbers: sortedUnique([
      ...task.failedEpisodeNumbers.filter(
        (value) => !completed.has(value),
      ),
      ...(completed.has(episodeNumber) ? [] : [episodeNumber]),
    ]),
    lastError: error,
  });
}

export function finishGenerationRecoveryTask(
  task: GenerationRecoveryTask,
): GenerationRecoveryTask {
  const now = new Date().toISOString();
  return reviseTask(task, {
    status: "completed",
    completedEpisodeNumbers: Array.from(
      { length: task.endEpisode - task.startEpisode + 1 },
      (_, index) => task.startEpisode + index,
    ),
    failedEpisodeNumbers: [],
    lastError: undefined,
    completedAt: now,
    checkpointedAt: now,
  });
}

export function firstMissingRecoveryEpisode(
  task: GenerationRecoveryTask,
  existingEpisodeNumbers: number[],
): number | null {
  const existing = new Set(existingEpisodeNumbers);
  for (
    let episodeNumber = task.startEpisode;
    episodeNumber <= task.endEpisode;
    episodeNumber += 1
  ) {
    if (!existing.has(episodeNumber)) return episodeNumber;
  }
  return null;
}

export function shouldAutoResumeGenerationRecovery(
  task: GenerationRecoveryTask | undefined,
  existingEpisodeNumbers: number[],
  browserTaskStatus?: string,
): task is GenerationRecoveryTask {
  if (!task || task.status === "paused" || task.status === "completed") return false;
  if (
    browserTaskStatus === "running"
    || browserTaskStatus === "pausing"
    || browserTaskStatus === "paused"
  ) return false;
  if (firstMissingRecoveryEpisode(task, existingEpisodeNumbers) === null) return false;
  if (task.status === "running") return true;
  return task.attemptCount < MAX_AUTOMATIC_RECOVERY_ATTEMPTS
    && TRANSIENT_RECOVERY_ERROR.test(task.lastError ?? "");
}

export function automaticGenerationRecoveryDelayMs(
  task: GenerationRecoveryTask,
): number {
  if (task.status === "running") return 500;
  return task.attemptCount <= 1 ? 10_000 : 30_000;
}

export function shouldAutomaticallyContinueScriptGeneration(input: {
  planningPhase?: string;
  existingEpisodeCount: number;
  nextReadyEpisode: number | null;
  generationIntent: boolean;
  busy: boolean;
  browserTaskStatus?: string;
  recoveryTaskStatus?: GenerationRecoveryStatus;
}): boolean {
  return input.planningPhase === "script"
    && input.existingEpisodeCount > 0
    && input.nextReadyEpisode !== null
    && !input.generationIntent
    && !input.busy
    && (!input.browserTaskStatus || input.browserTaskStatus === "completed")
    && (!input.recoveryTaskStatus || input.recoveryTaskStatus === "completed");
}

export function reconcileGenerationRecoveryTask(
  remote: GenerationRecoveryTask,
  requested: GenerationRecoveryTask,
): GenerationRecoveryTask {
  if (
    remote.jobId !== requested.jobId
    || remote.batchId !== requested.batchId
    || remote.startEpisode !== requested.startEpisode
    || remote.endEpisode !== requested.endEpisode
  ) {
    throw new Error("Generation task identity changed during checkpoint reconciliation.");
  }
  if (remote.status === "completed") return remote;

  const completedEpisodeNumbers = sortedUnique([
    ...remote.completedEpisodeNumbers,
    ...requested.completedEpisodeNumbers,
  ]).filter((episodeNumber) => (
    episodeNumber >= requested.startEpisode
    && episodeNumber <= requested.endEpisode
  ));
  const completed = new Set(completedEpisodeNumbers);
  const failedEpisodeNumbers = sortedUnique(
    requested.failedEpisodeNumbers,
  ).filter((episodeNumber) => !completed.has(episodeNumber));
  const status = requested.status;
  const checkpointedAt = requested.checkpointedAt > remote.checkpointedAt
    ? requested.checkpointedAt
    : remote.checkpointedAt;

  return {
    ...requested,
    batchRevision: remote.batchRevision + 1,
    jobRevision: remote.jobRevision + 1,
    attemptCount: Math.max(remote.attemptCount, requested.attemptCount),
    completedEpisodeNumbers,
    failedEpisodeNumbers,
    createdAt: remote.createdAt,
    checkpointedAt,
    completedAt: status === "completed"
      ? requested.completedAt ?? checkpointedAt
      : undefined,
    lastError: status === "failed" || status === "partial"
      ? requested.lastError
      : undefined,
    serverBacked: true,
  };
}

function reviseTask(
  task: GenerationRecoveryTask,
  patch: Partial<GenerationRecoveryTask> & { status: GenerationRecoveryStatus },
): GenerationRecoveryTask {
  return {
    ...task,
    ...patch,
    batchRevision: task.batchRevision + 1,
    jobRevision: task.jobRevision + 1,
    checkpointedAt: patch.checkpointedAt ?? new Date().toISOString(),
  };
}

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}
