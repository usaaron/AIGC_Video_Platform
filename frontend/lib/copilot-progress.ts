export type CopilotProgressStage = "context" | "requesting" | "thinking" | "writing" | "validating";

export type CopilotProgressEvent =
  | { type: "progress"; stage: CopilotProgressStage; message: string }
  | { type: "model_thinking"; delta: string }
  | { type: "reasoning_summary"; delta: string };

export interface CopilotProgressStep {
  stage: CopilotProgressStage;
  message: string;
  startedAt: number;
  endedAt?: number;
}

export interface CopilotProgress {
  id: string;
  status: "running" | "completed" | "paused" | "error";
  startedAt: number;
  endedAt?: number;
  steps: CopilotProgressStep[];
  /** Only public summaries explicitly supplied by the service. */
  summary: string;
  /** Model thinking supplied by a supported provider; absent in older history. */
  thinking?: string;
}

export interface CopilotProgressRun {
  onEvent(event: CopilotProgressEvent): void;
  mark(stage: CopilotProgressStage, message: string): void;
  finish(status: "completed" | "paused" | "error"): CopilotProgress;
}

export const COPILOT_SUMMARY_LIMIT = 12_000;
export const COPILOT_THINKING_LIMIT = 12_000;
const STAGES = new Set<CopilotProgressStage>(["context", "requesting", "thinking", "writing", "validating"]);

/** Owns one request; all published values are immutable snapshots. */
export function createCopilotProgressRun(options: {
  id: string;
  signal: AbortSignal;
  onChange: (progress: CopilotProgress) => void;
  isCurrent?: () => boolean;
  now?: () => number;
}): CopilotProgressRun {
  const now = options.now ?? Date.now;
  let value: CopilotProgress = { id: options.id, status: "running", startedAt: now(), steps: [], summary: "" };
  const publish = () => { if (options.isCurrent?.() !== false) options.onChange(value); };
  const writable = () => value.status === "running" && options.isCurrent?.() !== false;

  function finish(status: "completed" | "paused" | "error"): CopilotProgress {
    if (value.status !== "running") return value;
    const endedAt = Math.max(now(), value.startedAt, value.steps.at(-1)?.startedAt ?? 0);
    value = { ...value, status, endedAt, steps: value.steps.map((step, index) => (
      index === value.steps.length - 1 && step.endedAt === undefined ? { ...step, endedAt } : step
    )) };
    options.signal.removeEventListener("abort", onAbort);
    publish();
    return value;
  }
  function onAbort() { finish("paused"); }
  function mark(stage: CopilotProgressStage, message: string) {
    if (!writable() || !STAGES.has(stage)) return;
    const previous = value.steps.at(-1);
    if (previous?.stage === stage) {
      if (previous.message === message) return;
      value = { ...value, steps: [...value.steps.slice(0, -1), { ...previous, message }] };
    } else {
      const startedAt = Math.max(now(), value.startedAt, previous?.startedAt ?? 0);
      value = { ...value, steps: [
        ...value.steps.map((step, index) => index === value.steps.length - 1 ? { ...step, endedAt: startedAt } : step),
        { stage, message, startedAt },
      ] };
    }
    publish();
  }
  function onEvent(event: CopilotProgressEvent) {
    if (!writable()) return;
    if (event.type === "progress") mark(event.stage, event.message);
    else if (event.type === "reasoning_summary" && typeof event.delta === "string" && event.delta) {
      const summary = (value.summary + event.delta).slice(0, COPILOT_SUMMARY_LIMIT);
      if (summary === value.summary) return;
      value = { ...value, summary };
      publish();
    } else if (event.type === "model_thinking" && typeof event.delta === "string" && event.delta) {
      const thinking = ((value.thinking ?? "") + event.delta).slice(0, COPILOT_THINKING_LIMIT);
      if (thinking === value.thinking) return;
      value = { ...value, thinking };
      publish();
    }
  }

  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) onAbort();
  else publish();
  return { onEvent, mark, finish };
}
