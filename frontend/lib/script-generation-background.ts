import { useEffect, useState } from "react";

import type { EpisodeStreamProgress } from "@/lib/generation-stream";

export type ScriptGenerationTaskStatus =
  | "running"
  | "pausing"
  | "paused"
  | "completed"
  | "failed";

export const SCRIPT_GENERATION_PAUSE_ABORT_REASON = "script-generation-pause";

export interface ScriptGenerationTaskSnapshot {
  key: string;
  projectId: string;
  startEpisode: number;
  endEpisode: number;
  status: ScriptGenerationTaskStatus;
  createdAt: string;
  completedAt?: string;
  pausedAt?: string;
  pausedDurationMs?: number;
  error?: string;
  progress: EpisodeStreamProgress[];
}

const taskRecords = new Map<string, ScriptGenerationTaskSnapshot>();
const activeProjectTasks = new Map<string, string>();
const listeners = new Set<() => void>();
const pauseWaiters = new Map<string, Set<() => void>>();
const activeAbortControllers = new Map<string, Set<AbortController>>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function scriptGenerationTaskKey(projectId: string): string {
  return `script-generation:${projectId}`;
}

export function beginScriptGenerationTask(input: {
  projectId: string;
  startEpisode: number;
  endEpisode: number;
}): { started: boolean; task: ScriptGenerationTaskSnapshot } {
  const activeKey = activeProjectTasks.get(input.projectId);
  const activeTask = activeKey ? taskRecords.get(activeKey) : undefined;
  if (activeTask && isActiveScriptTaskStatus(activeTask.status)) {
    return { started: false, task: { ...activeTask } };
  }

  const key = scriptGenerationTaskKey(input.projectId);
  const task: ScriptGenerationTaskSnapshot = {
    key,
    projectId: input.projectId,
    startEpisode: input.startEpisode,
    endEpisode: input.endEpisode,
    status: "running",
    createdAt: new Date().toISOString(),
    progress: [],
  };
  taskRecords.set(key, task);
  activeProjectTasks.set(input.projectId, key);
  notify();
  return { started: true, task: { ...task } };
}

export function completeScriptGenerationTask(projectId: string): void {
  finishScriptGenerationTask(projectId, "completed");
}

export function failScriptGenerationTask(projectId: string, error: unknown): void {
  finishScriptGenerationTask(
    projectId,
    "failed",
    error instanceof Error ? error.message : String(error),
  );
}

export function getScriptGenerationTask(
  projectId: string,
): ScriptGenerationTaskSnapshot | undefined {
  const key = activeProjectTasks.get(projectId) ?? scriptGenerationTaskKey(projectId);
  const task = taskRecords.get(key);
  return task ? { ...task, progress: [...task.progress] } : undefined;
}

export function getScriptGenerationTasks(): ScriptGenerationTaskSnapshot[] {
  return [...taskRecords.values()]
    .map((task) => ({ ...task, progress: [...task.progress] }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function updateScriptGenerationProgress(
  projectId: string,
  update: EpisodeStreamProgress[] | ((current: EpisodeStreamProgress[]) => EpisodeStreamProgress[]),
): void {
  const key = activeProjectTasks.get(projectId);
  if (!key) return;
  const task = taskRecords.get(key);
  // Once pause has been requested, late SSE frames from the aborted request
  // must not keep changing the preview or make the task look active again.
  if (!task || task.status !== "running") return;
  const nextProgress = typeof update === "function"
    ? update(task.progress)
    : update;
  taskRecords.set(key, {
    ...task,
    progress: [...nextProgress],
  });
  notify();
}

export function isScriptGenerationRunning(projectId: string): boolean {
  const status = getScriptGenerationTask(projectId)?.status;
  return status ? isActiveScriptTaskStatus(status) : false;
}

export function requestScriptGenerationPause(projectId: string): void {
  const key = activeProjectTasks.get(projectId);
  if (!key) return;
  const task = taskRecords.get(key);
  if (!task || task.status !== "running") return;
  taskRecords.set(key, {
    ...task,
    status: "pausing",
    pausedAt: task.pausedAt ?? new Date().toISOString(),
    progress: task.progress.map((item) => (
      item.status === "active" && item.pausedAt === undefined
        ? { ...item, pausedAt: Date.now() }
        : item
    )),
  });
  activeAbortControllers.get(projectId)?.forEach((controller) => {
    controller.abort(SCRIPT_GENERATION_PAUSE_ABORT_REASON);
  });
  notify();
}

export function resumeScriptGenerationTask(projectId: string): void {
  const key = activeProjectTasks.get(projectId);
  if (!key) return;
  const task = taskRecords.get(key);
  if (!task || (task.status !== "pausing" && task.status !== "paused")) return;
  const pausedAtMs = task.pausedAt ? Date.parse(task.pausedAt) : Number.NaN;
  const pausedDurationMs = (task.pausedDurationMs ?? 0)
    + (Number.isFinite(pausedAtMs) ? Math.max(0, Date.now() - pausedAtMs) : 0);
  const resumedAt = Date.now();
  taskRecords.set(key, {
    ...task,
    status: "running",
    pausedAt: undefined,
    pausedDurationMs,
    progress: task.progress.map((item) => {
      if (item.pausedAt === undefined) return item;
      return {
        ...item,
        pausedAt: undefined,
        pausedDurationMs: (item.pausedDurationMs ?? 0)
          + Math.max(0, resumedAt - item.pausedAt),
      };
    }),
  });
  const waiters = pauseWaiters.get(projectId);
  pauseWaiters.delete(projectId);
  waiters?.forEach((resolve) => resolve());
  notify();
}

export function isScriptGenerationPauseRequested(projectId: string): boolean {
  const status = getScriptGenerationTask(projectId)?.status;
  return status === "pausing" || status === "paused";
}

/** Register the request controller for the currently running episode. */
export function registerScriptGenerationAbortController(
  projectId: string,
  controller: AbortController,
): () => void {
  const controllers = activeAbortControllers.get(projectId) ?? new Set<AbortController>();
  controllers.add(controller);
  activeAbortControllers.set(projectId, controllers);
  const task = getScriptGenerationTask(projectId);
  if (task && (task.status === "pausing" || task.status === "paused")) {
    // Close the small race where a request is registered just after the user
    // clicks pause and the original abort broadcast has already run.
    controller.abort(SCRIPT_GENERATION_PAUSE_ABORT_REASON);
  }
  return () => {
    const current = activeAbortControllers.get(projectId);
    if (!current) return;
    current.delete(controller);
    if (!current.size) activeAbortControllers.delete(projectId);
  };
}

export function isScriptGenerationAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function isScriptGenerationPauseAbort(signal: AbortSignal): boolean {
  return signal.aborted && signal.reason === SCRIPT_GENERATION_PAUSE_ABORT_REASON;
}

export function scriptGenerationElapsedSeconds(
  task: ScriptGenerationTaskSnapshot,
  now = Date.now(),
): number {
  const startedAt = Date.parse(task.createdAt);
  if (!Number.isFinite(startedAt)) return 0;
  const completedAt = task.completedAt ? Date.parse(task.completedAt) : Number.NaN;
  const pausedAt = task.pausedAt ? Date.parse(task.pausedAt) : Number.NaN;
  const endedAt = Number.isFinite(completedAt)
    ? completedAt
    : task.status === "pausing" || task.status === "paused"
      ? (Number.isFinite(pausedAt) ? pausedAt : now)
      : now;
  const elapsedMs = endedAt - startedAt - (task.pausedDurationMs ?? 0);
  return Math.max(0, Math.round(elapsedMs / 1_000));
}

export async function waitForScriptGenerationResume(projectId: string): Promise<boolean> {
  const key = activeProjectTasks.get(projectId);
  if (!key) return false;
  const task = taskRecords.get(key);
  if (!task || (task.status !== "pausing" && task.status !== "paused")) return false;
  if (task.status === "pausing") {
    taskRecords.set(key, { ...task, status: "paused" });
    notify();
  }
  await new Promise<void>((resolve) => {
    const waiters = pauseWaiters.get(projectId) ?? new Set<() => void>();
    waiters.add(resolve);
    pauseWaiters.set(projectId, waiters);
  });
  return true;
}

export function waitForScriptGenerationIdle(projectId: string): Promise<void> {
  if (!isScriptGenerationRunning(projectId)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let unsubscribe: () => void = () => undefined;
    const finishIfIdle = () => {
      if (isScriptGenerationRunning(projectId)) return;
      unsubscribe();
      resolve();
    };
    unsubscribe = subscribeScriptGenerationTasks(finishIfIdle);
    finishIfIdle();
  });
}

export function subscribeScriptGenerationTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useScriptGenerationTask(
  projectId: string,
): ScriptGenerationTaskSnapshot | undefined {
  const [task, setTask] = useState<ScriptGenerationTaskSnapshot | undefined>(
    () => getScriptGenerationTask(projectId),
  );
  useEffect(() => {
    setTask(getScriptGenerationTask(projectId));
    return subscribeScriptGenerationTasks(() => {
      setTask(getScriptGenerationTask(projectId));
    });
  }, [projectId]);
  return task;
}

export function useScriptGenerationTasks(): ScriptGenerationTaskSnapshot[] {
  const [tasks, setTasks] = useState<ScriptGenerationTaskSnapshot[]>(
    () => getScriptGenerationTasks(),
  );
  useEffect(() => subscribeScriptGenerationTasks(() => {
    setTasks(getScriptGenerationTasks());
  }), []);
  return tasks;
}

function finishScriptGenerationTask(
  projectId: string,
  status: Exclude<ScriptGenerationTaskStatus, "running">,
  error?: string,
): void {
  const key = activeProjectTasks.get(projectId);
  if (!key) return;
  const task = taskRecords.get(key);
  if (!task || !isActiveScriptTaskStatus(task.status)) return;
  const completedAt = new Date();
  const pausedAtMs = task.pausedAt ? Date.parse(task.pausedAt) : Number.NaN;
  const pausedDurationMs = (task.pausedDurationMs ?? 0)
    + (Number.isFinite(pausedAtMs) ? Math.max(0, completedAt.getTime() - pausedAtMs) : 0);
  taskRecords.set(key, {
    ...task,
    status,
    completedAt: completedAt.toISOString(),
    pausedAt: undefined,
    pausedDurationMs,
    progress: task.progress.map((item) => {
      if (item.pausedAt === undefined) return item;
      return {
        ...item,
        pausedAt: undefined,
        pausedDurationMs: (item.pausedDurationMs ?? 0)
          + Math.max(0, completedAt.getTime() - item.pausedAt),
      };
    }),
    ...(error ? { error } : {}),
  });
  activeProjectTasks.delete(projectId);
  activeAbortControllers.get(projectId)?.forEach((controller) => controller.abort());
  activeAbortControllers.delete(projectId);
  const waiters = pauseWaiters.get(projectId);
  pauseWaiters.delete(projectId);
  waiters?.forEach((resolve) => resolve());
  notify();
}

function isActiveScriptTaskStatus(status: ScriptGenerationTaskStatus): boolean {
  return status === "running" || status === "pausing" || status === "paused";
}
