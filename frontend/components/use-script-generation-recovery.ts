"use client";

import { useEffect, useMemo, useRef } from "react";

import { nextReadyScriptPartEpisode } from "@/lib/episode-generation-planning";
import {
  automaticGenerationRecoveryDelayMs,
  finishGenerationRecoveryTask,
  firstMissingRecoveryEpisode,
  shouldAutoResumeGenerationRecovery,
  shouldAutomaticallyContinueScriptGeneration,
} from "@/lib/generation-recovery";
import { saveGenerationTaskOnServer } from "@/lib/project-sync";
import type { GenerationRecoveryTask, ScriptProject } from "@/lib/types";
import type { useProjects } from "@/providers/project-provider";

interface RecoveryOptions {
  project: ScriptProject | undefined;
  scriptAccessible: boolean;
  generationIntent: boolean;
  busy: boolean;
  browserTaskStatus?: string;
  updateProject: ReturnType<typeof useProjects>["updateProject"];
  onResumeInitial: (task: GenerationRecoveryTask) => void;
}

function scheduleAttempt(attempts: Set<string>, key: string, delay: number, launch: () => void) {
  if (attempts.has(key)) return;
  attempts.add(key);
  let launched = false;
  const timer = window.setTimeout(() => {
    launched = true;
    launch();
  }, delay);
  return () => {
    window.clearTimeout(timer);
    if (!launched) attempts.delete(key);
  };
}

export function useScriptGenerationRecovery({
  project, scriptAccessible, generationIntent, busy, browserTaskStatus,
  updateProject, onResumeInitial,
}: RecoveryOptions) {
  const finalizedRecoveryJobs = useRef(new Set<string>());
  const autoResumedRecoveryAttempts = useRef(new Set<string>());
  const automaticallyStartedScriptParts = useRef(new Set<string>());
  const generateNextStageRef = useRef<(
    instruction?: string,
    requestedRange?: { startEpisode: number; endEpisode: number },
  ) => Promise<void>>(async () => undefined);
  const resumeInitialRef = useRef(onResumeInitial);
  resumeInitialRef.current = onResumeInitial;
  const episodeNumbers = useMemo(
    () => project?.episodes.map((episode) => episode.episodeNumber) ?? [],
    [project?.episodes],
  );

  useEffect(() => {
    if (!project || !scriptAccessible) return;
    const nextEpisode = nextReadyScriptPartEpisode(
      episodeNumbers, project.episodePlansReadyThrough ?? 0, project.generationSettings.episodeCount,
    );
    if (!shouldAutomaticallyContinueScriptGeneration({
      productionOutputMode: project.productionOutputMode,
      planningPhase: project.planningSession?.phase,
      planningStatus: project.planningSession?.status,
      existingEpisodeCount: episodeNumbers.length,
      nextReadyEpisode: nextEpisode,
      generationIntent,
      busy,
      browserTaskStatus,
      recoveryTaskStatus: project.activeGenerationTask?.status,
    })) return;
    const attemptKey = [
      project.id, project.storyBibleVersion ?? "legacy", project.episodePlansReadyThrough ?? 0, nextEpisode,
    ].join(":");
    return scheduleAttempt(automaticallyStartedScriptParts.current, attemptKey, 500, () => {
      void generateNextStageRef.current();
    });
  }, [
    browserTaskStatus, busy, generationIntent, episodeNumbers,
    project?.activeGenerationTask?.jobId, project?.activeGenerationTask?.status,
    project?.episodePlansReadyThrough, project?.generationSettings.episodeCount,
    project?.id, project?.planningSession?.phase, project?.planningSession?.status,
    project?.storyBibleVersion, project?.productionOutputMode, scriptAccessible,
  ]);

  useEffect(() => {
    const task = project?.activeGenerationTask;
    if (busy || ["running", "pausing", "paused"].includes(browserTaskStatus ?? "")) return;
    if (!project || !task || task.status === "completed") return;
    if (finalizedRecoveryJobs.current.has(task.jobId)) return;
    if (firstMissingRecoveryEpisode(task, episodeNumbers) !== null) return;
    finalizedRecoveryJobs.current.add(task.jobId);
    const completedTask = finishGenerationRecoveryTask(task);
    void updateProject(project.id, (current) => (
      current.activeGenerationTask?.jobId === task.jobId
        && current.activeGenerationTask.jobRevision === task.jobRevision
        ? { activeGenerationTask: completedTask } : {}
    ));
    void saveGenerationTaskOnServer(project.id, completedTask)
      .catch(() => undefined)
      .then(() => updateProject(project.id, (current) => (
        // A late completion must not clear another job or a newer checkpoint.
        current.activeGenerationTask?.jobId === completedTask.jobId
          && current.activeGenerationTask.jobRevision === completedTask.jobRevision
          && current.activeGenerationTask.status === "completed"
          ? { activeGenerationTask: undefined } : {}
      )));
  }, [project, episodeNumbers, updateProject, busy, browserTaskStatus]);

  useEffect(() => {
    const task = project?.activeGenerationTask;
    if (!project || !scriptAccessible || !shouldAutoResumeGenerationRecovery(
      task, episodeNumbers, browserTaskStatus, project.planningSession?.status,
    )) return;
    const recoveryAttemptKey = `${project.id}:${task.jobId}:${task.attemptCount}`;
    return scheduleAttempt(
      autoResumedRecoveryAttempts.current, recoveryAttemptKey, automaticGenerationRecoveryDelayMs(task),
      () => {
        if (episodeNumbers.length === 0) {
          // Empty workspaces must use the initial launcher, not the later-batch callback.
          resumeInitialRef.current(task);
        } else {
          void generateNextStageRef.current(task.instruction ?? "", {
            startEpisode: task.startEpisode, endEpisode: task.endEpisode,
          });
        }
      },
    );
  }, [
    browserTaskStatus, episodeNumbers,
    project?.activeGenerationTask?.attemptCount, project?.activeGenerationTask?.jobId,
    project?.activeGenerationTask?.lastError, project?.activeGenerationTask?.status,
    project?.activeGenerationTask?.instruction, project?.activeGenerationTask?.startEpisode,
    project?.activeGenerationTask?.endEpisode, project?.id, project?.planningSession?.status,
    scriptAccessible,
  ]);

  return generateNextStageRef;
}
