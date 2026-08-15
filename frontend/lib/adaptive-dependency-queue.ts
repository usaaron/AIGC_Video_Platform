export interface DependencyQueueItem<T> {
  value: T;
  depth: number;
}

export interface DependencyQueueProgress<T> {
  item: DependencyQueueItem<T>;
  completed: number;
  scheduled: number;
  active: number;
  targetConcurrency: number;
  durationMs: number;
  depthCompleted: number;
  depthScheduled: number;
  error?: unknown;
}

export async function runAdaptiveDependencyQueue<T>(input: {
  initialValues: T[];
  process: (item: DependencyQueueItem<T>) => Promise<T[]>;
  initialConcurrency: number;
  minimumConcurrency?: number;
  maximumConcurrency: number;
  successesBeforeIncrease?: number;
  slowTaskThresholdMs?: number;
  breadthFirst?: boolean;
  shouldReduceConcurrencyOnError?: (error: unknown) => boolean;
  onProgress?: (progress: DependencyQueueProgress<T>) => Promise<void> | void;
}): Promise<void> {
  const minimumConcurrency = Math.max(1, Math.floor(input.minimumConcurrency ?? 1));
  const maximumConcurrency = Math.max(
    minimumConcurrency,
    Math.floor(input.maximumConcurrency),
  );
  let targetConcurrency = Math.min(
    maximumConcurrency,
    Math.max(minimumConcurrency, Math.floor(input.initialConcurrency)),
  );
  const successesBeforeIncrease = Math.max(
    1,
    Math.floor(input.successesBeforeIncrease ?? 2),
  );
  const slowTaskThresholdMs = input.slowTaskThresholdMs === undefined
    ? undefined
    : Math.max(0, Math.floor(input.slowTaskThresholdMs));
  const pending = input.initialValues.map((value) => ({ value, depth: 1 }));
  const scheduledByDepth = new Map<number, number>([
    [1, input.initialValues.length],
  ]);
  const completedByDepth = new Map<number, number>();
  const active = new Map<number, Promise<QueueOutcome<T>>>();
  let activeDepth = 1;
  let nextTaskId = 1;
  let completed = 0;
  let scheduled = pending.length;
  let consecutiveSuccesses = 0;
  let firstFailure: unknown;
  let hasFailure = false;

  const launchAvailable = () => {
    while (pending.length && active.size < targetConcurrency) {
      if (input.breadthFirst && pending[0]?.depth !== activeDepth) break;
      const item = pending.shift();
      if (!item) break;
      const taskId = nextTaskId;
      nextTaskId += 1;
      const startedAt = Date.now();
      const task = Promise.resolve()
        .then(() => input.process(item))
        .then<QueueOutcome<T>, QueueOutcome<T>>(
          (children) => ({
            taskId,
            item,
            ok: true,
            children,
            durationMs: Date.now() - startedAt,
          }),
          (error: unknown) => ({
            taskId,
            item,
            ok: false,
            error,
            durationMs: Date.now() - startedAt,
          }),
        );
      active.set(taskId, task);
    }
  };

  launchAvailable();
  while (active.size) {
    const outcome = await Promise.race(active.values());
    active.delete(outcome.taskId);
    completed += 1;
    completedByDepth.set(
      outcome.item.depth,
      (completedByDepth.get(outcome.item.depth) ?? 0) + 1,
    );
    const wasSlow = slowTaskThresholdMs !== undefined
      && outcome.durationMs >= slowTaskThresholdMs;

    if (outcome.ok) {
      const descendants = outcome.children.map((value) => ({
        value,
        depth: outcome.item.depth + 1,
      }));
      pending.push(...descendants);
      scheduled += descendants.length;
      if (descendants.length) {
        const childDepth = outcome.item.depth + 1;
        scheduledByDepth.set(
          childDepth,
          (scheduledByDepth.get(childDepth) ?? 0) + descendants.length,
        );
      }
      if (wasSlow) {
        targetConcurrency = Math.max(minimumConcurrency, targetConcurrency - 1);
        consecutiveSuccesses = 0;
      } else {
        consecutiveSuccesses += 1;
        if (
          consecutiveSuccesses >= successesBeforeIncrease
          && targetConcurrency < maximumConcurrency
        ) {
          targetConcurrency += 1;
          consecutiveSuccesses = 0;
        }
      }
    } else {
      if (!hasFailure) {
        firstFailure = outcome.error;
        hasFailure = true;
      }
      consecutiveSuccesses = 0;
      if (wasSlow || input.shouldReduceConcurrencyOnError?.(outcome.error)) {
        targetConcurrency = Math.max(minimumConcurrency, targetConcurrency - 1);
      }
    }

    await input.onProgress?.({
      item: outcome.item,
      completed,
      scheduled,
      active: active.size,
      targetConcurrency,
      durationMs: outcome.durationMs,
      depthCompleted: completedByDepth.get(outcome.item.depth) ?? 0,
      depthScheduled: scheduledByDepth.get(outcome.item.depth) ?? 0,
      ...(!outcome.ok ? { error: outcome.error } : {}),
    });
    if (
      input.breadthFirst
      && active.size === 0
      && pending.length
      && pending[0]?.depth !== activeDepth
    ) {
      activeDepth = pending[0]?.depth ?? activeDepth;
    }
    launchAvailable();
  }

  if (hasFailure) throw firstFailure;
}

type QueueOutcome<T> =
  | {
      taskId: number;
      item: DependencyQueueItem<T>;
      ok: true;
      children: T[];
      durationMs: number;
    }
  | {
      taskId: number;
      item: DependencyQueueItem<T>;
      ok: false;
      error: unknown;
      durationMs: number;
    };
