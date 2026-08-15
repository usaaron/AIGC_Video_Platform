"use client";

import Link from "next/link";
import { Pause, Play } from "lucide-react";
import { SectionHelp } from "@/components/section-help";

import {
  requestPlanningPause,
  resumePlanningTasks,
  usePlanningPauseState,
  usePlanningTasks,
} from "@/lib/story-planning-background";
import {
  requestScriptGenerationPause,
  resumeScriptGenerationTask,
  useScriptGenerationTask,
} from "@/lib/script-generation-background";
import { useLocale } from "@/providers/locale-provider";

export function WorkflowNavigation({
  active,
  generatedEpisodes,
  plannedThrough,
  projectId,
  scriptStarted,
  totalEpisodes,
}: {
  active: "planning" | "script";
  generatedEpisodes: number;
  plannedThrough: number;
  projectId: string;
  scriptStarted: boolean;
  totalEpisodes: number;
}) {
  const { t } = useLocale();
  const planningHref = `/projects/${projectId}/planning`;
  const scriptHref = `/projects/${projectId}/workspace`;
  const planningTasks = usePlanningTasks(projectId);
  const planningPauseState = usePlanningPauseState(projectId);
  const scriptTask = useScriptGenerationTask(projectId);
  const activePlanningTasks = planningTasks.filter((task) => (
    task.status === "queued" || task.status === "running"
  )).length;

  return (
    <div className="workflow-navigation">
      <div className="workflow-navigation-head">
        <nav aria-label={t("workflowNavigation.label")} className="workflow-navigation-tabs">
        {active === "planning" ? (
          <span aria-current="page">{t("workflowNavigation.planning")}</span>
        ) : (
          <Link href={planningHref}>{t("workflowNavigation.planning")}</Link>
        )}
        {active === "script" ? (
          <span aria-current="page">{t("workflowNavigation.script")}</span>
        ) : scriptStarted ? (
          <Link href={scriptHref}>{t("workflowNavigation.script")}</Link>
        ) : (
          <span aria-disabled="true" className="is-disabled">
            {t("workflowNavigation.script")}
          </span>
        )}
        </nav>
        <SectionHelp content={t("guide.workflowNavigation")} label={t("guide.openHelp")} />
      </div>
      <div className="workflow-generation-summary">
        <p>
          {t("workflowNavigation.summary")
            .replace("{planned}", String(plannedThrough))
            .replace("{generated}", String(generatedEpisodes))
            .replace("{total}", String(totalEpisodes))}
        </p>
        {activePlanningTasks ? (
          <div className="workflow-generation-control">
            <span className="workflow-background-status">
              {t(planningPauseState === "running"
                ? "workflowNavigation.backgroundPlanning"
                : `generationPause.planning.${planningPauseState}`)
                .replace("{count}", String(activePlanningTasks))}
            </span>
            <button
              aria-label={t(planningPauseState === "running" ? "generationPause.pausePlanning" : "generationPause.resumePlanning")}
              onClick={() => planningPauseState === "running"
                ? requestPlanningPause(projectId)
                : resumePlanningTasks(projectId)}
              title={t(planningPauseState === "running" ? "generationPause.pausePlanning" : "generationPause.resumePlanning")}
              type="button"
            >
              {planningPauseState === "running" ? <Pause size={14} /> : <Play size={14} />}
              {t(planningPauseState === "running" ? "generationPause.pause" : "generationPause.resume")}
            </button>
          </div>
        ) : null}
        {scriptTask && (scriptTask.status === "running" || scriptTask.status === "pausing" || scriptTask.status === "paused") ? (
          <div className="workflow-generation-control">
            <span className="workflow-background-status">
              {t(scriptTask.status === "running"
                ? "workflowNavigation.backgroundScript"
                : `generationPause.script.${scriptTask.status}`)
                .replace("{start}", String(scriptTask.startEpisode))
                .replace("{end}", String(scriptTask.endEpisode))}
            </span>
            <button
              aria-label={t(scriptTask.status === "running" ? "generationPause.pauseScript" : "generationPause.resumeScript")}
              onClick={() => scriptTask.status === "running"
                ? requestScriptGenerationPause(projectId)
                : resumeScriptGenerationTask(projectId)}
              title={t(scriptTask.status === "running" ? "generationPause.pauseScript" : "generationPause.resumeScript")}
              type="button"
            >
              {scriptTask.status === "running" ? <Pause size={14} /> : <Play size={14} />}
              {t(scriptTask.status === "running" ? "generationPause.pause" : "generationPause.resume")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
