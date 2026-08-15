import { useEffect, useState } from "react";


export type PlanningTaskKind = "top_level" | "decompose" | "episode_roadmap" | "full_tree";
export type PlanningTaskStatus = "queued" | "running" | "completed" | "failed";
export type PlanningPauseState = "running" | "pausing" | "paused";

export interface PlanningTaskSnapshot {
  id: string;
  key: string;
  kind: PlanningTaskKind;
  projectId: string;
  nodeId?: string;
  label?: string;
  status: PlanningTaskStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface PlanningTaskRecord<T> extends PlanningTaskSnapshot {
  run: () => Promise<T>;
  onSuccess?: (result: T) => Promise<void> | void;
  onFailure?: (error: unknown) => Promise<void> | void;
  promise: Promise<T>;
  resolve: (result: T) => void;
  reject: (error: unknown) => void;
}

// One scheduler owns both limits. Roadmaps may use seven slots while one slot
// remains available for Story Bible or recursive-tree work.
const MAX_CONCURRENT_PLANNING_TASKS = 8;
const MAX_CONCURRENT_EPISODE_ROADMAP_TASKS = 7;
const FULL_TREE_RESERVED_SLOTS = 7;
const PLANNING_TASK_HISTORY_STORAGE_KEY = "my-comic:planning-task-history:v1";
const taskRecords = new Map<string, PlanningTaskRecord<unknown>>();
const activeKeyToTask = new Map<string, string>();
const pendingTaskIds: string[] = [];
const listeners = new Set<() => void>();
const pausedProjectIds = new Set<string>();
const pauseWaiters = new Map<string, Set<() => void>>();
const waitingTaskIds = new Set<string>();
let activeTaskCount = 0;
let activeEpisodeRoadmapTaskCount = 0;

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribePlanningTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPlanningTask(key: string): PlanningTaskSnapshot | undefined {
  const task = taskRecords.get(activeKeyToTask.get(key) ?? "")
    ?? [...taskRecords.values()].reverse().find((candidate) => candidate.key === key);
  if (task) return taskSnapshot(task);
  return readPersistedTaskHistory().find((candidate) => candidate.key === key);
}

function taskSnapshot(task: PlanningTaskRecord<unknown>): PlanningTaskSnapshot {
  const {
    run: _run,
    onSuccess: _onSuccess,
    onFailure: _onFailure,
    promise: _promise,
    resolve: _resolve,
    reject: _reject,
    ...snapshot
  } = task;
  return snapshot;
}

export function getPlanningTasks(projectId: string): PlanningTaskSnapshot[] {
  return mergeTaskSnapshots(
    [...taskRecords.values()].map(taskSnapshot),
    readPersistedTaskHistory(),
  )
    .filter((task) => task.projectId === projectId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getAllPlanningTasks(): PlanningTaskSnapshot[] {
  return mergeTaskSnapshots(
    [...taskRecords.values()].map(taskSnapshot),
    readPersistedTaskHistory(),
  )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function usePlanningTask(key: string): PlanningTaskSnapshot | undefined {
  const [task, setTask] = useState<PlanningTaskSnapshot | undefined>(
    () => getPlanningTask(key),
  );
  useEffect(() => {
    setTask(getPlanningTask(key));
    return subscribePlanningTasks(() => setTask(getPlanningTask(key)));
  }, [key]);
  return task;
}

export function usePlanningTasks(projectId: string): PlanningTaskSnapshot[] {
  const [tasks, setTasks] = useState<PlanningTaskSnapshot[]>(
    () => getPlanningTasks(projectId),
  );
  useEffect(() => {
    setTasks(getPlanningTasks(projectId));
    return subscribePlanningTasks(() => setTasks(getPlanningTasks(projectId)));
  }, [projectId]);
  return tasks;
}

export function useAllPlanningTasks(): PlanningTaskSnapshot[] {
  const [tasks, setTasks] = useState<PlanningTaskSnapshot[]>(
    () => getAllPlanningTasks(),
  );
  useEffect(() => subscribePlanningTasks(() => {
    setTasks(getAllPlanningTasks());
  }), []);
  return tasks;
}

export function getPlanningPauseState(projectId: string): PlanningPauseState {
  if (!pausedProjectIds.has(projectId)) return "running";
  const hasInFlightTask = [...taskRecords.values()].some((task) => (
    task.projectId === projectId
    && task.status === "running"
    && (task.kind === "full_tree" || !waitingTaskIds.has(task.id))
  ));
  return hasInFlightTask ? "pausing" : "paused";
}

export function usePlanningPauseState(projectId: string): PlanningPauseState {
  const [state, setState] = useState<PlanningPauseState>(
    () => getPlanningPauseState(projectId),
  );
  useEffect(() => {
    setState(getPlanningPauseState(projectId));
    return subscribePlanningTasks(() => setState(getPlanningPauseState(projectId)));
  }, [projectId]);
  return state;
}

export function requestPlanningPause(projectId: string): void {
  const hasActiveTask = [...taskRecords.values()].some((task) => (
    task.projectId === projectId
    && (task.status === "queued" || task.status === "running")
  ));
  if (!hasActiveTask) return;
  pausedProjectIds.add(projectId);
  notify();
}

export function resumePlanningTasks(projectId: string): void {
  if (!pausedProjectIds.delete(projectId)) return;
  const waiters = pauseWaiters.get(projectId);
  pauseWaiters.delete(projectId);
  waiters?.forEach((resolve) => resolve());
  notify();
  void drainPlanningTasks();
}

export async function waitForPlanningTaskResume(taskKey: string): Promise<boolean> {
  const taskId = activeKeyToTask.get(taskKey);
  const task = taskId ? taskRecords.get(taskId) : undefined;
  if (!task || !pausedProjectIds.has(task.projectId)) return false;
  waitingTaskIds.add(task.id);
  notify();
  await new Promise<void>((resolve) => {
    const waiters = pauseWaiters.get(task.projectId) ?? new Set<() => void>();
    waiters.add(resolve);
    pauseWaiters.set(task.projectId, waiters);
  });
  waitingTaskIds.delete(task.id);
  notify();
  return true;
}

export function enqueuePlanningTask<T>(input: {
  key: string;
  kind: PlanningTaskKind;
  projectId: string;
  nodeId?: string;
  label?: string;
  run: () => Promise<T>;
  onSuccess?: (result: T) => Promise<void> | void;
  onFailure?: (error: unknown) => Promise<void> | void;
}): { task: PlanningTaskSnapshot; promise: Promise<T> } {
  const existingId = activeKeyToTask.get(input.key);
  const existing = existingId ? taskRecords.get(existingId) : undefined;
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return {
      task: getPlanningTask(input.key) as PlanningTaskSnapshot,
      promise: existing.promise as Promise<T>,
    };
  }

  let resolvePromise!: (result: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const task: PlanningTaskRecord<T> = {
    id: `planning-task.${crypto.randomUUID()}`,
    key: input.key,
    kind: input.kind,
    projectId: input.projectId,
    nodeId: input.nodeId,
    label: input.label,
    status: "queued",
    createdAt: new Date().toISOString(),
    run: input.run,
    onSuccess: input.onSuccess,
    onFailure: input.onFailure,
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
  taskRecords.set(task.id, task as PlanningTaskRecord<unknown>);
  activeKeyToTask.set(task.key, task.id);
  pendingTaskIds.push(task.id);
  notify();
  drainPlanningTasks();
  return { task: getPlanningTask(task.key) as PlanningTaskSnapshot, promise };
}

async function drainPlanningTasks(): Promise<void> {
  while (activeTaskCount < MAX_CONCURRENT_PLANNING_TASKS && pendingTaskIds.length) {
    const nextIndex = pendingTaskIds.findIndex((candidateId) => {
      const candidate = taskRecords.get(candidateId);
      return candidate?.status === "queued" && (
        !pausedProjectIds.has(candidate.projectId)
        && !hasProjectFullTreeBarrier(candidate)
        && activeTaskCount + planningTaskSlotCost(candidate.kind) <= MAX_CONCURRENT_PLANNING_TASKS
        && (
          candidate.kind !== "episode_roadmap"
          || activeEpisodeRoadmapTaskCount < MAX_CONCURRENT_EPISODE_ROADMAP_TASKS
        )
      );
    });
    if (nextIndex < 0) break;
    const [taskId] = pendingTaskIds.splice(nextIndex, 1);
    if (!taskId) continue;
    const task = taskRecords.get(taskId);
    if (!task || task.status !== "queued") continue;
    const reservedSlots = planningTaskSlotCost(task.kind);
    activeTaskCount += reservedSlots;
    if (task.kind === "episode_roadmap") activeEpisodeRoadmapTaskCount += 1;
    task.status = "running";
    task.startedAt = new Date().toISOString();
    notify();
    void executePlanningTask(task).finally(() => {
      activeTaskCount -= reservedSlots;
      if (task.kind === "episode_roadmap") activeEpisodeRoadmapTaskCount -= 1;
      void drainPlanningTasks();
    });
  }
}

function planningTaskSlotCost(kind: PlanningTaskKind): number {
  return kind === "full_tree" ? FULL_TREE_RESERVED_SLOTS : 1;
}

function hasProjectFullTreeBarrier(candidate: PlanningTaskRecord<unknown>): boolean {
  return [...taskRecords.values()].some((task) => (
    task.id !== candidate.id
    && task.projectId === candidate.projectId
    && (
      candidate.kind === "full_tree"
        ? task.status === "running"
        : task.kind === "full_tree"
          && (task.status === "queued" || task.status === "running")
    )
  ));
}

async function executePlanningTask<T>(task: PlanningTaskRecord<T>): Promise<void> {
  try {
    // Each generation client owns retries for its smallest safe unit. Keeping
    // this scheduler single-attempt prevents a decompose/top-level operation
    // from becoming 3x3 retries and preserves checkpoint recovery semantics.
    const result = await task.run();
    if (task.onSuccess) await task.onSuccess(result);
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.resolve(result);
  } catch (error) {
    task.status = "failed";
    task.completedAt = new Date().toISOString();
    task.error = error instanceof Error ? error.message : String(error);
    if (task.onFailure) {
      try {
        await task.onFailure(error);
      } catch {
        // Preserve the generation failure as the task's actionable error.
      }
    }
    task.reject(error);
  } finally {
    waitingTaskIds.delete(task.id);
    if (activeKeyToTask.get(task.key) === task.id) activeKeyToTask.delete(task.key);
    const hasUnfinishedProjectTask = [...taskRecords.values()].some((candidate) => (
      candidate.projectId === task.projectId
      && candidate.id !== task.id
      && (candidate.status === "queued" || candidate.status === "running")
    ));
    if (!hasUnfinishedProjectTask) pausedProjectIds.delete(task.projectId);
    trimPlanningTaskHistory(task.projectId);
    persistFinishedTaskHistory();
    notify();
  }
}

function trimPlanningTaskHistory(projectId: string): void {
  const finished = [...taskRecords.values()]
    .filter((task) => (
      task.projectId === projectId
      && (task.status === "completed" || task.status === "failed")
    ))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  for (const task of finished.slice(40)) taskRecords.delete(task.id);
}

function mergeTaskSnapshots(
  current: PlanningTaskSnapshot[],
  persisted: PlanningTaskSnapshot[],
): PlanningTaskSnapshot[] {
  const byId = new Map(persisted.map((task) => [task.id, task]));
  current.forEach((task) => byId.set(task.id, task));
  return [...byId.values()];
}

function readPersistedTaskHistory(): PlanningTaskSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PLANNING_TASK_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPersistableTaskSnapshot).slice(0, 80);
  } catch {
    return [];
  }
}

function persistFinishedTaskHistory(): void {
  if (typeof window === "undefined") return;
  const finished = [...taskRecords.values()]
    .filter((task) => task.status === "completed" || task.status === "failed")
    .map(taskSnapshot);
  const snapshots = mergeTaskSnapshots(finished, readPersistedTaskHistory())
    .filter(isPersistableTaskSnapshot)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 80);
  try {
    window.localStorage.setItem(
      PLANNING_TASK_HISTORY_STORAGE_KEY,
      JSON.stringify(snapshots),
    );
  } catch {
    // The in-memory task record still preserves the result for this session.
  }
}

function isPersistableTaskSnapshot(value: unknown): value is PlanningTaskSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const task = value as Partial<PlanningTaskSnapshot>;
  return (
    typeof task.id === "string"
    && typeof task.key === "string"
    && typeof task.projectId === "string"
    && typeof task.createdAt === "string"
    && (task.kind === "top_level" || task.kind === "decompose" || task.kind === "episode_roadmap" || task.kind === "full_tree")
    && (task.status === "completed" || task.status === "failed")
    && (task.error === undefined || typeof task.error === "string")
  );
}
