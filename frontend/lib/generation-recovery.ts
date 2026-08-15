import type {
  GenerationRecoveryStatus,
  GenerationRecoveryTask,
} from "@/lib/types";

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
    attemptCount: task.attemptCount + 1,
    failedEpisodeNumbers: [],
    lastError: undefined,
  });
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
  return reviseTask(task, {
    status: task.completedEpisodeNumbers.length ? "partial" : "failed",
    failedEpisodeNumbers: sortedUnique([
      ...task.failedEpisodeNumbers.filter(
        (value) => !task.completedEpisodeNumbers.includes(value),
      ),
      episodeNumber,
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
