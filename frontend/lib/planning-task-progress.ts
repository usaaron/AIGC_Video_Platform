import { useCallback, useSyncExternalStore } from "react";
import { createCopilotProgressRun, type CopilotProgress, type CopilotProgressRun } from "@/lib/copilot-progress";
import { projectStorageKey } from "@/lib/host-session";

// Task-owned, memory-only snapshots survive route changes. Prompt content and
// provider reasoning are never added to persisted task history or diagnostics.
const records = new Map<string, { owner: object; progress: CopilotProgress | null; run: CopilotProgressRun | null }>();
const listeners = new Set<() => void>();

export function subscribePlanningProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPlanningProgress(key: string): CopilotProgress | null {
  return records.get(projectStorageKey(key))?.progress ?? null;
}

export function beginPlanningTaskProgress(key: string, signal = new AbortController().signal): CopilotProgressRun {
  return beginScopedProgress(projectStorageKey(key), signal);
}

function beginScopedProgress(key: string, signal: AbortSignal): CopilotProgressRun {
  records.get(key)?.run?.finish("paused");
  const record = { owner: {}, progress: null as CopilotProgress | null, run: null as CopilotProgressRun | null };
  records.delete(key);
  records.set(key, record);
  const run = createCopilotProgressRun({
    id: crypto.randomUUID(), signal,
    isCurrent: () => records.get(key)?.owner === record.owner,
    onChange(progress) {
      record.progress = progress;
      listeners.forEach(listener => listener());
    },
  });
  record.run = run;
  const finished = [...records.entries()].filter(([, item]) => item.progress?.status !== "running");
  for (const [oldKey] of finished.slice(0, Math.max(0, finished.length - 40))) records.delete(oldKey);
  return run;
}

export function usePlanningProgress(key: string): CopilotProgress | null {
  const scopedKey = projectStorageKey(key);
  const snapshot = useCallback(() => records.get(scopedKey)?.progress ?? null, [scopedKey]);
  return useSyncExternalStore(subscribePlanningProgress, snapshot, () => null);
}

/** For background work only: unmounting detaches the observer, not its task. */
export function useRetainedCopilotProgress(key: string): {
  progress: CopilotProgress | null;
  begin: (signal: AbortSignal) => CopilotProgressRun;
} {
  const scopedKey = projectStorageKey(key);
  const progress = usePlanningProgress(key);
  const begin = useCallback((signal: AbortSignal) => beginScopedProgress(scopedKey, signal), [scopedKey]);
  return { progress, begin };
}
