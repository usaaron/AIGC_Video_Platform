"use client";

import { CheckCircle, LoaderCircle, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  getPlanningPauseState,
  planningTaskElapsedSeconds,
  requestPlanningPause,
  resumePlanningTasks,
  type PlanningTaskSnapshot,
  useAllPlanningTasks,
} from "@/lib/story-planning-background";
import {
  requestScriptGenerationPause,
  resumeScriptGenerationTask,
  scriptGenerationElapsedSeconds,
  type ScriptGenerationTaskSnapshot,
  useScriptGenerationTasks,
} from "@/lib/script-generation-background";
import { useLocale } from "@/providers/locale-provider";

/** Compact global status for work that continues after leaving its workspace. */
export function BackgroundGenerationStatus() {
  const { t } = useLocale();
  const planningTasks = useAllPlanningTasks().filter((task) => (
    task.status === "queued" || task.status === "running"
  ));
  const scriptTasks = useScriptGenerationTasks().filter((task) => (
    task.status === "running" || task.status === "pausing" || task.status === "paused"
  ));
  const [now, setNow] = useState(Date.now());
  const scriptTimerSignature = scriptTasks
    .map((task) => `${task.key}:${task.status}`)
    .join("|");
  const hasRunningScriptTask = scriptTasks.some((task) => task.status === "running");

  useEffect(() => {
    if (!planningTasks.length && !hasRunningScriptTask) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [planningTasks.length, hasRunningScriptTask, scriptTimerSignature]);

  if (!planningTasks.length && !scriptTasks.length) {
    return (
      <div aria-label={t("backgroundStatus.idle")} className="topbar-generation-status" role="status">
        <span className="topbar-generation-idle" title={t("backgroundStatus.idle")}>
          <CheckCircle aria-hidden="true" size={14} />
        </span>
      </div>
    );
  }

  const planningGroups = groupPlanningTasksByProject(planningTasks);

  return (
    <div
      aria-label={t("backgroundStatus.label")}
      className="topbar-generation-status"
      role="status"
    >
      {planningGroups.map(([projectId, tasks]) => {
        const pauseState = getPlanningPauseState(projectId);
        const running = pauseState === "running";
        return (
          <StatusItem
            actionLabel={t(running ? "generationPause.pausePlanning" : "generationPause.resumePlanning")}
            count={tasks.length}
            elapsed={planningTaskElapsedSeconds(earliestPlanningTask(tasks), now)}
            href={`/projects/${projectId}/planning/structure`}
            key={projectId}
            label={t(running ? "backgroundStatus.planning" : `generationPause.planning.${pauseState}`)}
            onAction={() => running ? requestPlanningPause(projectId) : resumePlanningTasks(projectId)}
            paused={!running}
          />
        );
      })}
      {scriptTasks.map((task) => (
        <StatusItem
          actionLabel={t(task.status === "running" ? "generationPause.pauseScript" : "generationPause.resumeScript")}
          elapsed={elapsedForScriptTask(task, now)}
          href={`/projects/${task.projectId}/workspace`}
          key={task.key}
          label={t(task.status === "paused"
            ? "backgroundStatus.scriptPaused"
            : task.status === "pausing"
              ? "backgroundStatus.scriptPausing"
              : "backgroundStatus.script")}
          onAction={() => task.status === "running"
            ? requestScriptGenerationPause(task.projectId)
            : resumeScriptGenerationTask(task.projectId)}
          paused={task.status !== "running"}
        />
      ))}
    </div>
  );
}

function StatusItem({
  actionLabel,
  count,
  elapsed,
  href,
  label,
  onAction,
  paused,
}: {
  actionLabel: string;
  count?: number;
  elapsed: number;
  href: string;
  label: string;
  onAction: () => void;
  paused: boolean;
}) {
  return (
    <span className="topbar-generation-status-item">
      {paused
        ? <Pause aria-hidden="true" className="topbar-generation-paused" size={12} />
        : <LoaderCircle aria-hidden="true" className="topbar-generation-spinner" size={13} />}
      <Link className="topbar-generation-label" href={href}>
        {label}{count && count > 1 ? ` · ${count}` : ""}
      </Link>
      <time dateTime={`PT${elapsed}S`}>{formatElapsed(elapsed)}</time>
      <button aria-label={actionLabel} onClick={onAction} title={actionLabel} type="button">
        {paused ? <Play aria-hidden="true" size={12} /> : <Pause aria-hidden="true" size={12} />}
      </button>
    </span>
  );
}

function groupPlanningTasksByProject(
  tasks: PlanningTaskSnapshot[],
): Array<[string, PlanningTaskSnapshot[]]> {
  const groups = new Map<string, PlanningTaskSnapshot[]>();
  tasks.forEach((task) => groups.set(task.projectId, [...(groups.get(task.projectId) ?? []), task]));
  return [...groups.entries()];
}

function earliestPlanningTask(tasks: PlanningTaskSnapshot[]): PlanningTaskSnapshot {
  return tasks.reduce((earliest, task) => (
    planningStartTime(task) < planningStartTime(earliest) ? task : earliest
  ));
}

function planningStartTime(task: PlanningTaskSnapshot): number {
  const value = Date.parse(task.startedAt ?? task.createdAt);
  return Number.isFinite(value) ? value : Date.now();
}

function elapsedForScriptTask(task: ScriptGenerationTaskSnapshot, now: number): number {
  return scriptGenerationElapsedSeconds(task, now);
}

function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
