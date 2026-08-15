"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";

import { ScriptIcon } from "@/components/icons";
import { SectionHelp } from "@/components/section-help";
import { countEffectiveCharacters } from "@/lib/script-metrics";
import {
  getPlanningPauseState,
  requestPlanningPause,
  resumePlanningTasks,
  type PlanningTaskSnapshot,
  useAllPlanningTasks,
} from "@/lib/story-planning-background";
import {
  requestScriptGenerationPause,
  resumeScriptGenerationTask,
  useScriptGenerationTasks,
} from "@/lib/script-generation-background";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function BackgroundGenerationDock() {
  const pathname = usePathname();
  const { projects } = useProjects();
  const { t } = useLocale();
  const allPlanningTasks = useAllPlanningTasks();
  const allScriptTasks = useScriptGenerationTasks();
  const [now, setNow] = useState(Date.now());
  const routeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const isPlanningPage = Boolean(
    routeProjectId && pathname === `/projects/${routeProjectId}/planning`,
  );
  const isScriptPage = Boolean(
    routeProjectId && pathname === `/projects/${routeProjectId}/workspace`,
  );
  const activePlanningTasks = allPlanningTasks.filter((task) => (
    (task.status === "queued" || task.status === "running")
    && (!routeProjectId || task.projectId === routeProjectId)
    && !(isPlanningPage && task.projectId === routeProjectId)
  ));
  const activeScriptTasks = allScriptTasks.filter((task) => (
    (task.status === "running" || task.status === "pausing" || task.status === "paused")
    && (!routeProjectId || task.projectId === routeProjectId)
    && !(isScriptPage && task.projectId === routeProjectId)
  ));
  const scriptTask = activeScriptTasks[0];

  useEffect(() => {
    if (!activePlanningTasks.length && !scriptTask) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activePlanningTasks.length, scriptTask?.key]);

  if (!activePlanningTasks.length && !scriptTask) return null;

  const projectTitle = (projectId: string) => (
    projects.find((project) => project.id === projectId)?.title
    ?? t("backgroundDock.unknownProject")
  );

  return (
    <aside
      aria-label={t("backgroundDock.label")}
      className={`background-generation-dock ${activePlanningTasks.length && scriptTask ? "has-two-panels" : ""}`}
    >
      {scriptTask ? (
        <ScriptGenerationMiniPanel
          now={now}
          projectTitle={projectTitle(scriptTask.projectId)}
          task={scriptTask}
          t={t}
        />
      ) : null}
      {activePlanningTasks.length ? (
        <PlanningGenerationMiniPanel
          now={now}
          projectTitle={projectTitle(activePlanningTasks[0].projectId)}
          tasks={activePlanningTasks}
          t={t}
        />
      ) : null}
    </aside>
  );
}

function ScriptGenerationMiniPanel({ now, projectTitle, task, t }: {
  now: number;
  projectTitle: string;
  task: ReturnType<typeof useScriptGenerationTasks>[number];
  t: (key: string) => string;
}) {
  const current = task.progress.find((item) => item.status === "active")
    ?? task.progress.find((item) => item.status === "queued")
    ?? task.progress.at(-1);
  const completed = task.progress.filter((item) => item.status === "completed").length;
  const visibleCharacters = current
    ? current.actualCharacters ?? countEffectiveCharacters(current.preview)
    : 0;
  const targetCharacters = current?.targetCharacters ?? 1;
  const progress = Math.min(100, Math.max(2, visibleCharacters / targetCharacters * 100));
  const elapsed = elapsedSeconds(now, current?.startedAt ?? Date.parse(task.createdAt));

  return (
    <section className="background-generation-panel is-script" aria-live="polite">
      <header>
        <span className="background-task-icon"><ScriptIcon /></span>
        <div>
          <small>{projectTitle}</small>
          <strong>{t("backgroundDock.scriptTitle")}</strong>
        </div>
        <SectionHelp content={t("guide.backgroundGeneration")} label={t("guide.openHelp")} />
        <span className="background-task-live">{t("backgroundDock.live")}</span>
      </header>
      <div className="background-script-meta">
        <strong>{current
          ? t("storyPlanNode.episodeLabel").replace("{number}", String(current.episodeNumber))
          : `${task.startEpisode}-${task.endEpisode}`}</strong>
        <span>{current ? t(`workspace.stream.stage.${current.stage}`) : t("workspace.stream.stage.preparing")}</span>
        <time>{elapsed}s</time>
      </div>
      <div className="background-script-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="background-script-preview">
        {current?.preview || t("workspace.stream.waitingForText")}
      </p>
      <footer>
        <span>{completed}/{task.progress.length || task.endEpisode - task.startEpisode + 1}</span>
        {current?.attemptCount ? (
          <span>{t("workspace.stream.attempt").replace("{count}", String(current.attemptCount))}</span>
        ) : null}
        <button
          aria-label={t(task.status === "running" ? "generationPause.pauseScript" : "generationPause.resumeScript")}
          onClick={() => task.status === "running"
            ? requestScriptGenerationPause(task.projectId)
            : resumeScriptGenerationTask(task.projectId)}
          title={t(task.status === "running" ? "generationPause.pauseScript" : "generationPause.resumeScript")}
          type="button"
        >
          {task.status === "running" ? <Pause size={13} /> : <Play size={13} />}
          {t(task.status === "running" ? "generationPause.pause" : "generationPause.resume")}
        </button>
        <Link href={`/projects/${task.projectId}/workspace`}>{t("backgroundDock.open")}</Link>
      </footer>
    </section>
  );
}

function PlanningGenerationMiniPanel({ now, projectTitle, tasks, t }: {
  now: number;
  projectTitle: string;
  tasks: PlanningTaskSnapshot[];
  t: (key: string) => string;
}) {
  const projectId = tasks[0].projectId;
  const pauseState = getPlanningPauseState(projectId);
  return (
    <section className="background-generation-panel is-planning" aria-live="polite">
      <header>
        <span className="background-task-icon"><span className="loading-mark" /></span>
        <div>
          <small>{projectTitle}</small>
          <strong>{t("backgroundDock.planningTitle")}</strong>
        </div>
        <SectionHelp content={t("guide.backgroundGeneration")} label={t("guide.openHelp")} />
        <span className="background-task-live">{tasks.length}</span>
      </header>
      <div className="background-planning-list">
        {tasks.slice(0, 3).map((task) => (
          <div key={task.id}>
            <span className={`background-task-dot is-${task.status}`} />
            <p>
              <strong>{t(`backgroundDock.planning.${task.kind}`)}</strong>
              {task.label && task.kind !== "top_level" ? <small>{task.label}</small> : null}
            </p>
            <time>{elapsedSeconds(now, Date.parse(task.startedAt ?? task.createdAt))}s</time>
          </div>
        ))}
      </div>
      <footer>
        <span>{t(pauseState === "running"
          ? "backgroundDock.runningCount"
          : `generationPause.planning.${pauseState}`)
          .replace("{count}", String(tasks.length))}</span>
        <button
          aria-label={t(pauseState === "running" ? "generationPause.pausePlanning" : "generationPause.resumePlanning")}
          onClick={() => pauseState === "running"
            ? requestPlanningPause(projectId)
            : resumePlanningTasks(projectId)}
          title={t(pauseState === "running" ? "generationPause.pausePlanning" : "generationPause.resumePlanning")}
          type="button"
        >
          {pauseState === "running" ? <Pause size={13} /> : <Play size={13} />}
          {t(pauseState === "running" ? "generationPause.pause" : "generationPause.resume")}
        </button>
        <Link href={`/projects/${tasks[0].projectId}/planning`}>{t("backgroundDock.open")}</Link>
      </footer>
    </section>
  );
}

function elapsedSeconds(now: number, startedAt: number): number {
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Math.round((now - startedAt) / 1_000));
}
