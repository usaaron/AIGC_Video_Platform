import {
  continuePausedGenerationRecoveryTask,
  episodeGenerationAgentRequestId,
  pauseGenerationRecoveryTask,
} from "@/lib/generation-recovery";
import { generateWithAutomaticTransientRetry, type AutomaticRetryEvent } from "@/lib/generation-retry";
import { saveGenerationTaskOnServer } from "@/lib/project-sync";
import {
  isScriptGenerationAbortError,
  isScriptGenerationPauseAbort,
  isScriptGenerationPauseRequested,
  isScriptGenerationRunning,
  registerScriptGenerationAbortController,
  waitForScriptGenerationResume,
} from "@/lib/script-generation-background";
import type { GenerationRecoveryTask, ScriptProject } from "@/lib/types";
import type { useProjects } from "@/providers/project-provider";

interface SessionOptions {
  projectId: string;
  getProject: ReturnType<typeof useProjects>["getProject"];
  updateProject: ReturnType<typeof useProjects>["updateProject"];
  onPauseChange: (paused: boolean) => void;
  onAutomaticRetry: (episodeNumber: number, event: AutomaticRetryEvent) => void;
}

export class GenerationSessionError extends Error {
  readonly retryable = false;
  readonly failureClass: "conflict" | "persistence";
  constructor(message: string, failureClass: "conflict" | "persistence") {
    super(message);
    this.failureClass = failureClass;
  }
}

const snapshot = (task?: GenerationRecoveryTask) => JSON.stringify(task ?? null);

export function createScriptGenerationSession({
  projectId, getProject, updateProject, onPauseChange, onAutomaticRetry,
}: SessionOptions) {
  const sourceEpoch = getProject(projectId)?.planningRevisionEpoch ?? 0;
  let task: GenerationRecoveryTask | undefined;
  let expectedCheckpoint = snapshot(getProject(projectId)?.activeGenerationTask);
  let writes: Promise<void> = Promise.resolve();
  let pause: Promise<void> | undefined;
  let closed = false;

  function isCurrent(project: ScriptProject | undefined) {
    return !closed && project && project.planningRevision?.status !== "active"
      && (project.planningRevisionEpoch ?? 0) === sourceEpoch
      && snapshot(project.activeGenerationTask) === expectedCheckpoint;
  }

  function changedError() {
    return new GenerationSessionError("生成任务或检查点已变化，请从当前任务继续。", "conflict");
  }

  function enqueue(write: () => Promise<void>) {
    const result = writes.then(write);
    writes = result.catch(() => undefined);
    return result;
  }

  function checkpoint(update: GenerationRecoveryTask | ((current: GenerationRecoveryTask) => GenerationRecoveryTask)) {
    return enqueue(async () => {
      if (typeof update === "function" && !task) return;
      if (!isCurrent(getProject(projectId))) throw changedError();
      const next = typeof update === "function" ? update(task!) : update;
      if ((next.planningRevisionEpoch ?? 0) !== sourceEpoch) throw changedError();
      let savedTask;
      try { savedTask = await saveGenerationTaskOnServer(projectId, next); }
      catch (error) {
        if (typeof error === "object" && error !== null && "status" in error && error.status === 409) throw changedError();
        savedTask = { ...next, serverBacked: false };
      }
      let applied = false;
      const saved = await updateProject(projectId, (current) => {
        if (!isCurrent(current)) return {};
        applied = true;
        return { activeGenerationTask: savedTask };
      });
      if (!applied) throw changedError();
      task = savedTask;
      expectedCheckpoint = snapshot(task);
      if (!saved) throw new GenerationSessionError("生成检查点未能保存在本地，请重试。", "persistence");
    });
  }

  function clearCheckpoint() {
    return enqueue(async () => {
      let applied = false;
      const saved = await updateProject(projectId, (current) => {
        if (!isCurrent(current)) return {};
        applied = true;
        return { activeGenerationTask: undefined };
      });
      if (!applied) throw changedError();
      expectedCheckpoint = snapshot();
      if (!saved) throw new GenerationSessionError("生成任务完成记录未能保存在本地，请重试。", "persistence");
      closed = true;
    });
  }

  function pauseAtBoundary(): Promise<void> {
    if (pause) return pause;
    if (!isScriptGenerationPauseRequested(projectId)) return Promise.resolve();
    // All paused requests share one checkpoint transition and one resume gate.
    pause = (async () => {
      do {
        await checkpoint(pauseGenerationRecoveryTask);
        if (isScriptGenerationPauseRequested(projectId)) onPauseChange(true);
        await waitForScriptGenerationResume(projectId);
        if (!isScriptGenerationRunning(projectId)) {
          const error = new Error("Generation session ended while paused.");
          error.name = "AbortError";
          throw error;
        }
        // Resume may have happened while the paused checkpoint was being saved.
        await checkpoint(continuePausedGenerationRecoveryTask);
        onPauseChange(false);
      } while (isScriptGenerationPauseRequested(projectId));
    })().finally(() => { pause = undefined; });
    return pause;
  }

  async function generateEpisode<T>(episodeNumber: number, generate: (requestId: string, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!task) throw new GenerationSessionError("请先保存生成任务检查点。", "persistence");
    const requestId = episodeGenerationAgentRequestId(task, episodeNumber);
    while (true) {
      await pauseAtBoundary();
      if (!isCurrent(getProject(projectId))) throw changedError();
      const controller = new AbortController();
      const unregister = registerScriptGenerationAbortController(projectId, controller);
      try {
        const result = await generateWithAutomaticTransientRetry({
          signal: controller.signal,
          generate: () => generate(requestId, controller.signal),
          onAutomaticRetry: (event) => onAutomaticRetry(episodeNumber, event),
        });
        if (!isCurrent(getProject(projectId))) throw changedError();
        return result;
      } catch (error) {
        if (!isScriptGenerationAbortError(error)
          || (!isScriptGenerationPauseRequested(projectId) && !isScriptGenerationPauseAbort(controller.signal))) throw error;
      } finally { unregister(); }
    }
  }

  return { get task() { return task; }, checkpoint, clearCheckpoint, pauseAtBoundary, generateEpisode };
}
