import { useEffect, useState } from "react";

import type { EpisodeStreamProgress } from "@/lib/generation-stream";

export type ScriptGenerationTaskStatus =
  | "running"
  | "pausing"
  | "paused"
  | "completed"
  | "failed";

export interface ScriptGenerationTaskSnapshot {
  key: string;
  projectId: string;
  startEpisode: number;
  endEpisode: number;
  status: ScriptGenerationTaskStatus;
  createdAt: string;
  completedAt?: string;
  error?: string;
  progress: EpisodeStreamProgress[];
}

const taskRecords = new Map<string, ScriptGenerationTaskSnapshot>();
const activeProjectTasks = new Map<string, string>();
const listeners = new Set<() => void>();
const pauseWaiters = new Map<string, Set<() => void>>();

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
  if (!task || (task.status !== "running" && task.status !== "pausing")) return;
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
  taskRecords.set(key, { ...task, status: "pausing" });
  notify();
}

export function resumeScriptGenerationTask(projectId: string): void {
  const key = activeProjectTasks.get(projectId);
  if (!key) return;
  const task = taskRecords.get(key);
  if (!task || (task.status !== "pausing" && task.status !== "paused")) return;
  taskRecords.set(key, { ...task, status: "running" });
  const waiters = pauseWaiters.get(projectId);
  pauseWaiters.delete(projectId);
  waiters?.forEach((resolve) => resolve());
  notify();
}

export function isScriptGenerationPauseRequested(projectId: string): boolean {
  const status = getScriptGenerationTask(projectId)?.status;
  return status === "pausing" || status === "paused";
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
  taskRecords.set(key, {
    ...task,
    status,
    completedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  });
  activeProjectTasks.delete(projectId);
  const waiters = pauseWaiters.get(projectId);
  pauseWaiters.delete(projectId);
  waiters?.forEach((resolve) => resolve());
  notify();
}

function isActiveScriptTaskStatus(status: ScriptGenerationTaskStatus): boolean {
  return status === "running" || status === "pausing" || status === "paused";
}
