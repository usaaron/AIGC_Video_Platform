"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { ArrowIcon, CloseIcon } from "@/components/icons";
import { SectionHelp } from "@/components/section-help";
import {
  applyOverseasCharacterNames,
  mergeOverseasCharacterNames,
} from "@/lib/bilingual-dialogue";
import { EpisodeTreeNavigation } from "@/components/episode-tree-navigation";
import { clientDialogueSpeaker } from "@/lib/client-screenplay-format";
import { ProjectContinuityPanel } from "@/components/project-continuity-panel";
import {
  buildBilingualScriptView,
  deepenEpisodeDraft,
  generateSingleEpisode,
  prepareEpisodeGenerationRuntime,
  modifyEpisodeDraft,
  reviewEpisodeDraft,
} from "@/lib/generation-client";
import {
  applyEpisodeStreamEvent,
  completeEpisodeStream,
  createEpisodeStreamBatch,
  failEpisodeStream,
  markEpisodeAutomaticRetry,
  startEpisodeStream,
} from "@/lib/generation-stream";
import type { EpisodeStreamProgress } from "@/lib/generation-stream";
import {
  completeRecoveryEpisode,
  continuePausedGenerationRecoveryTask,
  createGenerationRecoveryTask,
  failGenerationRecoveryTask,
  finishGenerationRecoveryTask,
  firstMissingRecoveryEpisode,
  pauseGenerationRecoveryTask,
  resumeGenerationRecoveryTask,
} from "@/lib/generation-recovery";
import {
  generateWithAutomaticTransientRetry,
} from "@/lib/generation-retry";
import {
  beginScriptGenerationTask,
  completeScriptGenerationTask,
  failScriptGenerationTask,
  isScriptGenerationPauseRequested,
  updateScriptGenerationProgress,
  useScriptGenerationTask,
  waitForScriptGenerationResume,
} from "@/lib/script-generation-background";
import {
  nextBatchRange,
  nextLeafBatchRange,
  scriptBodyLengthGuidance,
  targetScriptBodyCharacters,
} from "@/lib/generation-planning";
import {
  calculateDraftTextMetrics,
  calculateSeriesTextMetrics,
  countEffectiveCharacters,
} from "@/lib/script-metrics";
import { synchronizeContinuity } from "@/lib/continuity";
import {
  adaptiveEpisodeSceneCount,
  buildEpisodeGenerationWindows,
  contiguousEpisodeCoverageThrough,
  episodeGenerationCharacterRefs,
  episodeGenerationExecutionPlan,
  episodeGenerationInstruction,
  episodeGenerationLedgerPlan,
  nextApprovedScriptLeafRange,
  plannedEpisodeBodyReference,
  plannedEpisodeDurationSeconds,
  plannedEpisodeShotCount,
  resolveEpisodeGenerationConstraints,
  storyBibleEpisodeContext,
  storyNodeExecutionContext,
  storySegmentBodyReference,
} from "@/lib/episode-generation-planning";
import type { EpisodeGenerationConstraint } from "@/lib/episode-generation-planning";
import {
  collectionDocumentFilename,
  createCollectionArchive,
  createEpisodeArchive,
  episodeDocumentFilename,
  seriesArchiveFilename,
  toEpisodeMarkdown,
  toEpisodePlainText,
  toSeriesDocument,
  type EpisodeDocumentFormat,
} from "@/lib/episode-export";
import { buildProductionIndex } from "@/lib/production-index";
import { createProductionWorkbookAttachments } from "@/lib/production-workbooks";
import { createScreenplayDocxBlob } from "@/lib/episode-docx";
import { completeScriptQualityLoop } from "@/lib/quality-loop-client";
import {
  saveEpisodeArtifactOnServer,
  saveGenerationTaskOnServer,
} from "@/lib/project-sync";
import {
  loadEpisodePlans,
  loadStoryBible,
  loadActiveStoryPlanNodes,
  storyBibleIdForProject,
} from "@/lib/story-planning-client";
import { CURRENT_MARKET_PROFILE } from "@/lib/types";
import { userFacingError } from "@/lib/api-error";
import type {
  BilingualScriptView,
  EpisodeWorkspace,
  GeneratedDraft,
  GeneratedScene,
  GenerationBatchRecord,
  GenerationRecoveryTask,
  ReleaseRegion,
  ScriptProject,
  ScriptGenerationRun,
} from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";
import { WorkflowNavigation } from "@/components/workflow-navigation";

type WorkspaceVersion = "framework" | "modification" | "deepening" | "revised" | "final";
type SeriesExportMode = "episodes" | "collection";

const CREATIVE_DEEPENING_ENABLED = (
  process.env.NEXT_PUBLIC_CREATIVE_DEEPENING_ENABLED === "true"
);

export function ScriptWorkspace() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getProject, isReady, updateProject } = useProjects();
  const { locale, t } = useLocale();
  const project = getProject(params.projectId);
  const backgroundScriptTask = useScriptGenerationTask(params.projectId);
  const [activeEpisodeNumber, setActiveEpisodeNumber] = useState(project?.activeEpisodeNumber ?? 1);
  const [selectedVersion, setSelectedVersion] = useState<WorkspaceVersion>("framework");
  const [editingDraft, setEditingDraft] = useState<GeneratedDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"confirm" | "modify" | "deepen" | "next" | "batch" | "finalize" | null>(null);
  const [dialog, setDialog] = useState<"modify" | "next" | "batch" | null>(null);
  const [instruction, setInstruction] = useState("");
  const [workspaceView, setWorkspaceView] = useState<"script" | "continuity">(
    searchParams.get("view") === "continuity" ? "continuity" : "script",
  );
  const [episodeExportFormat, setEpisodeExportFormat] = useState<EpisodeDocumentFormat>("markdown");
  const [seriesExportOpen, setSeriesExportOpen] = useState(false);
  const [seriesExportMode, setSeriesExportMode] = useState<SeriesExportMode>("episodes");
  const [seriesExportFormats, setSeriesExportFormats] = useState<Record<EpisodeDocumentFormat, boolean>>({
    markdown: true,
    text: false,
    word: false,
  });
  const [seriesExportProductionPackage, setSeriesExportProductionPackage] = useState(true);
  const [seriesExportBusy, setSeriesExportBusy] = useState(false);
  const [generationIntentConsumed, setGenerationIntentConsumed] = useState(false);
  const streamBatch = backgroundScriptTask?.progress ?? [];
  const setStreamBatch = useCallback<Dispatch<SetStateAction<EpisodeStreamProgress[]>>>(
    (update) => updateScriptGenerationProgress(params.projectId, update),
    [params.projectId],
  );
  const [generationProgressVisible, setGenerationProgressVisible] = useState<boolean | null>(null);
  const finalizedRecoveryJobs = useRef(new Set<string>());

  const episode = project?.episodes.find((item) => item.episodeNumber === activeEpisodeNumber);
  const generationIntent = searchParams.get("generate") === "1";
  const requestedStart = Number(searchParams.get("start"));
  const requestedEnd = Number(searchParams.get("end"));
  const requestedLeafRange = Number.isInteger(requestedStart)
    && Number.isInteger(requestedEnd)
    && requestedStart > 0
    && requestedEnd >= requestedStart
    ? { startEpisode: requestedStart, endEpisode: requestedEnd }
    : project?.episodePlansReadyThrough
      ? { startEpisode: 1, endEpisode: project.episodePlansReadyThrough }
      : null;

  useEffect(() => {
    if (!project?.episodes.length) return;
    if (!project.episodes.some((item) => item.episodeNumber === activeEpisodeNumber)) {
      setActiveEpisodeNumber(project.episodes[0].episodeNumber);
    }
  }, [project?.episodes.length, activeEpisodeNumber]);

  useEffect(() => {
    setSelectedVersion("framework");
    setEditingDraft(null);
    setMessage(null);
  }, [activeEpisodeNumber]);

  useEffect(() => {
    if (!project?.episodes.length || project.storyLines.length) return;
    updateProject(project.id, synchronizeContinuity(
      project.creativePrompt,
      project.characters,
      project.episodes,
      project.storyLines,
      project.characterRelationships,
      project.continuityStates,
    ));
  }, [
    project?.id,
    project?.episodes.length,
    project?.characters.length,
    project?.storyLines.length,
  ]);

  useEffect(() => {
    const task = project?.activeGenerationTask;
    if (!project || !task || task.status === "completed") return;
    if (finalizedRecoveryJobs.current.has(task.jobId)) return;
    const missingEpisode = firstMissingRecoveryEpisode(
      task,
      project.episodes.map((item) => item.episodeNumber),
    );
    if (missingEpisode !== null) return;
    finalizedRecoveryJobs.current.add(task.jobId);
    const completedTask = finishGenerationRecoveryTask(task);
    updateProject(project.id, { activeGenerationTask: completedTask });
    void saveGenerationTaskOnServer(project.id, completedTask)
      .finally(() => updateProject(project.id, { activeGenerationTask: undefined }));
  }, [project, updateProject]);

  useEffect(() => {
    if (!streamBatch.length) {
      setGenerationProgressVisible(null);
      return;
    }
    const progressElement = document.getElementById("episode-generation-progress");
    if (!progressElement) return;
    const observer = new IntersectionObserver(
      ([entry]) => setGenerationProgressVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(progressElement);
    return () => observer.disconnect();
  }, [streamBatch.length]);

  if (!isReady) {
    return <main className="centered-state"><div className="loading-mark" /><p>{t("project.opening")}</p></main>;
  }
  if (!project) {
    return <main className="centered-state" />;
  }
  if (
    requestedLeafRange
    && project.episodes.length === 0
    && generationIntentConsumed
    && project.status === "generating"
  ) {
    return (
      <InitialScriptBatchLauncher
        onClearIntent={() => router.replace(`/projects/${project.id}/workspace`)}
        onConsumeIntent={() => setGenerationIntentConsumed(true)}
        project={project}
        requestedLeafRange={requestedLeafRange}
        setStreamBatch={setStreamBatch}
        streamBatch={streamBatch}
        t={t}
        updateProject={updateProject}
      />
    );
  }
  if (
    requestedLeafRange
    && project.episodes.length === 0
    && generationIntent
    && !generationIntentConsumed
  ) {
    return (
      <InitialScriptBatchLauncher
        onClearIntent={() => router.replace(`/projects/${project.id}/workspace`)}
        onConsumeIntent={() => setGenerationIntentConsumed(true)}
        project={project}
        requestedLeafRange={requestedLeafRange}
        setStreamBatch={setStreamBatch}
        streamBatch={streamBatch}
        t={t}
        updateProject={updateProject}
      />
    );
  }
  if (!episode) {
    return (
      <main className="script-workspace page-reveal">
        <header className="workspace-header">
          <div>
            <span className="section-kicker">{t("workspace.kicker")}</span>
            <div className="section-title-with-help">
              <h1>{project.title}</h1>
              <SectionHelp content={t("guide.scriptWorkspace")} label={t("guide.openHelp")} />
            </div>
            <p>{t("workspace.episodeCountSummary")
              .replace("{current}", "0")
              .replace("{total}", String(project.generationSettings.episodeCount))}</p>
          </div>
          <div className="workspace-header-actions">
            <Link className="outline-action" href={`/projects/${project.id}/planning`}>
              {t("workspace.backToPlanning")}
            </Link>
          </div>
        </header>
        <WorkflowNavigation
          active="script"
          generatedEpisodes={0}
          plannedThrough={project.episodePlansReadyThrough ?? 0}
          projectId={project.id}
          scriptStarted
          totalEpisodes={project.generationSettings.episodeCount}
        />
        {streamBatch.length ? (
          <EpisodeGenerationProgress
            batch={streamBatch}
            onRetryEpisode={() => undefined}
            retryDisabled
            t={t}
          />
        ) : null}
      </main>
    );
  }

  const currentProject = project;
  const currentEpisode = episode;
  const recoverableEpisode = currentProject.activeGenerationTask
    ? firstMissingRecoveryEpisode(
        currentProject.activeGenerationTask,
        currentProject.episodes.map((item) => item.episodeNumber),
      )
    : null;
  const frameworkDraft = parseWorkingDraft(currentEpisode.workingDraftJson)
    ?? currentEpisode.generationRun.draft_master_script;
  const modificationDraft = currentEpisode.modificationCandidate?.candidate_generation_run.draft_master_script ?? null;
  const deepeningRun = currentEpisode.deepeningRun ?? currentEpisode.generationRun.creative_deepening_run ?? null;
  const deepeningDraft = deepeningRun?.candidate_valid_for_comparison
    ? deepeningRun.candidate_draft_master_script ?? null
    : null;
  const revisedDraft = currentEpisode.revisionRun?.revised_draft_master_script ?? null;
  const finalDraft = currentEpisode.finalizationResult?.master_script ?? null;
  const displayedDraft = selectedVersion === "modification" && modificationDraft
    ? modificationDraft
    : selectedVersion === "deepening" && deepeningDraft
      ? deepeningDraft
      : selectedVersion === "revised" && revisedDraft
        ? revisedDraft
        : selectedVersion === "final" && finalDraft
          ? finalDraft
          : frameworkDraft;
  const displayedBilingualView = currentEpisode.bilingualViews?.[displayedDraft.id];
  const marketMismatch = currentProject.marketProfile !== CURRENT_MARKET_PROFILE;
  const displayedProjectTitle = marketMismatch
    ? t("nav.historicalProject")
    : currentProject.title;
  const isConfirmed = ["confirmed", "deepened", "final"].includes(currentEpisode.status);
  const metricDrafts = currentProject.episodes.map((item) => (
    item.episodeNumber === currentEpisode.episodeNumber && editingDraft
      ? editingDraft
      : resolveExportDraft(item)
  ));
  const seriesTextMetrics = calculateSeriesTextMetrics(
    metricDrafts,
    currentProject.generationSettings.targetTotalCharacters,
    currentProject.generationSettings.episodeCount,
  );
  const displayedTextMetrics = calculateDraftTextMetrics(editingDraft ?? displayedDraft);
  const displayedBodyTarget = scriptBodyTargetCharacters(displayedDraft)
    ?? targetScriptBodyCharacters(currentProject.generationSettings);
  const displayedBodyGuidance = scriptBodyLengthGuidance(displayedBodyTarget);
  const displayedBodyTargetStatus = displayedTextMetrics.scriptBodyCharacters
    < displayedBodyGuidance.preferredMinCharacters
    ? t("workspace.length.currentTargetShort")
    : displayedTextMetrics.scriptBodyCharacters > displayedBodyGuidance.preferredMaxCharacters
      ? t("workspace.length.currentTargetLong")
      : t("workspace.length.currentTargetMet");
  const numberFormatter = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US");
  const progressPercent = seriesTextMetrics.progressRatio * 100;
  const projectedSummary = seriesTextMetrics.estimatedEpisodesToTarget === null
    ? t("workspace.length.projectionPending")
    : t("workspace.length.projectionValue")
        .replace("{planned}", numberFormatter.format(seriesTextMetrics.plannedEpisodes))
        .replace("{projected}", numberFormatter.format(seriesTextMetrics.projectedCharactersAtPlannedEpisodes))
        .replace("{estimated}", numberFormatter.format(seriesTextMetrics.estimatedEpisodesToTarget));

  function blockCrossMarketMutation(): boolean {
    if (!marketMismatch) return false;
    setMessage(t("workspace.marketMismatch"));
    return true;
  }

  function replaceEpisode(patch: Partial<EpisodeWorkspace>, projectPatch: Record<string, unknown> = {}) {
    const now = new Date().toISOString();
    const episodes = currentProject.episodes.map((item) => item.episodeNumber === currentEpisode.episodeNumber
      ? { ...item, ...patch, updatedAt: now }
      : item);
    updateProject(currentProject.id, {
      episodes,
      ...synchronizeContinuity(
        currentProject.creativePrompt,
        currentProject.characters,
        episodes,
        currentProject.storyLines,
        currentProject.characterRelationships,
        currentProject.continuityStates,
      ),
      ...projectPatch,
    });
  }

  function selectEpisode(number: number) {
    setActiveEpisodeNumber(number);
    updateProject(currentProject.id, { activeEpisodeNumber: number });
  }

  function scrollToGenerationProgress() {
    document.getElementById("episode-generation-progress")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function startEditing() {
    setEditingDraft(structuredClone(frameworkDraft));
    setSelectedVersion("framework");
  }

  function saveManualEdit() {
    if (!editingDraft) return;
    replaceEpisode({
      status: "editing",
      workingDraftJson: JSON.stringify(editingDraft, null, 2),
      hasLocalDraftEdits: true,
      confirmedDraftJson: undefined,
      confirmedAt: undefined,
      deepeningRun: undefined,
      revisionRun: undefined,
      finalizationResult: undefined,
    });
    setEditingDraft(null);
    setMessage(t("workspace.saved"));
  }

  async function confirmDraft(draft: GeneratedDraft = editingDraft ?? frameworkDraft) {
    if (blockCrossMarketMutation()) return;
    setBusyAction("confirm");
    setMessage(null);
    try {
      const reviewedRun = await reviewEpisodeDraft(
        currentEpisode.generationRun,
        draft,
      );
      const draftJson = JSON.stringify(reviewedRun.draft_master_script, null, 2);
      const artifactRef = await saveEpisodeArtifactOnServer({
        project: currentProject,
        episodeNumber: currentEpisode.episodeNumber,
        artifactKind: "draft",
        contentSchemaVersion: "draft_master_script.v1",
        contentPayload: reviewedRun.draft_master_script,
        lineageRefs: {
          draft_master_script_id: reviewedRun.draft_master_script.id,
          generation_strategy_id: reviewedRun.generation_strategy_id,
        },
      });
      const legacyPatch = currentEpisode.episodeNumber === 1 ? {
        generationRun: reviewedRun,
        workingDraftJson: draftJson,
        hasLocalDraftEdits: false,
        revisionRun: undefined,
        finalizationResult: undefined,
      } : {};
      replaceEpisode({
        status: "confirmed",
        generationRun: reviewedRun,
        workingDraftJson: draftJson,
        confirmedDraftJson: draftJson,
        hasLocalDraftEdits: false,
        modificationCandidate: undefined,
        deepeningRun: undefined,
        revisionRun: undefined,
        finalizationResult: undefined,
        artifactRefs: artifactRef
          ? { ...currentEpisode.artifactRefs, draft: artifactRef }
          : currentEpisode.artifactRefs,
        confirmedAt: new Date().toISOString(),
      }, legacyPatch);
      setEditingDraft(null);
      setSelectedVersion("framework");
      setMessage(artifactRef
        ? t("workspace.confirmed")
        : `${t("workspace.confirmed")} ${t("workspace.artifactSaveWarning")}`);
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.confirmFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function requestModification() {
    if (blockCrossMarketMutation()) return;
    if (!instruction.trim()) return;
    setBusyAction("modify");
    setMessage(null);
    try {
      const result = await modifyEpisodeDraft(
        currentEpisode.generationRun,
        frameworkDraft,
        instruction.trim(),
      );
      replaceEpisode({ modificationCandidate: result });
      setSelectedVersion("modification");
      setDialog(null);
      setInstruction("");
      setMessage(t("workspace.modificationReady"));
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.modificationFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  function applyModification() {
    if (!currentEpisode.modificationCandidate) return;
    const candidateRun = currentEpisode.modificationCandidate.candidate_generation_run;
    replaceEpisode({
      status: "editing",
      generationRun: candidateRun,
      workingDraftJson: JSON.stringify(candidateRun.draft_master_script, null, 2),
      hasLocalDraftEdits: true,
      modificationCandidate: undefined,
      confirmedDraftJson: undefined,
      confirmedAt: undefined,
      deepeningRun: undefined,
      revisionRun: undefined,
      finalizationResult: undefined,
    });
    setSelectedVersion("framework");
    setMessage(t("workspace.modificationApplied"));
  }

  async function requestDeepening() {
    if (blockCrossMarketMutation()) return;
    if (!isConfirmed) return;
    setBusyAction("deepen");
    setMessage(null);
    replaceEpisode({ status: "deepening" });
    try {
      const result = await deepenEpisodeDraft(currentEpisode.generationRun, frameworkDraft);
      replaceEpisode({ status: "confirmed", deepeningRun: result });
      if (!result.candidate_valid_for_comparison || !result.candidate_draft_master_script) {
        setMessage(t("workspace.deepeningRejected"));
        return;
      }
      setSelectedVersion("deepening");
      setMessage(t("workspace.deepeningReady"));
    } catch (error) {
      replaceEpisode({ status: "confirmed" });
      setMessage(formatWorkflowError(error, t, "workspace.deepeningFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function applyDeepening() {
    if (!deepeningDraft) return;
    setBusyAction("confirm");
    try {
      const reviewedRun = await reviewEpisodeDraft(currentEpisode.generationRun, deepeningDraft);
      const draftJson = JSON.stringify(reviewedRun.draft_master_script, null, 2);
      replaceEpisode({
        status: "deepened",
        generationRun: reviewedRun,
        workingDraftJson: draftJson,
        confirmedDraftJson: draftJson,
        hasLocalDraftEdits: false,
        confirmedAt: new Date().toISOString(),
      });
      setSelectedVersion("framework");
      setMessage(t("workspace.deepeningApplied"));
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.confirmFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function generateNextStage(
    optionalInstruction = "",
    requestedRange?: { startEpisode: number; endEpisode: number },
  ) {
    if (blockCrossMarketMutation()) return;
    setDialog(null);
    setBusyAction("batch");
    setMessage(null);
    const orderedExistingEpisodes = currentProject.episodes
      .slice()
      .sort((left, right) => left.episodeNumber - right.episodeNumber);
    const generatedThrough = contiguousEpisodeCoverageThrough(
      orderedExistingEpisodes.map((item) => item.episodeNumber),
    );
    if (!currentProject.storyBibleVersion) {
      setMessage(t("generation.planRequired"));
      setBusyAction(null);
      return;
    }
    const storyBibleId = storyBibleIdForProject(currentProject.id);
    let storyPlanNodes: Awaited<ReturnType<typeof loadActiveStoryPlanNodes>>;
    try {
      storyPlanNodes = await loadActiveStoryPlanNodes(
        currentProject.id,
        storyBibleId,
        currentProject.storyBibleVersion,
      );
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "generation.episodePlansRequired"));
      setBusyAction(null);
      return;
    }
    const approvedLeafDecision = nextApprovedScriptLeafRange(
      storyPlanNodes,
      currentProject.episodeRoadmaps ?? [],
      orderedExistingEpisodes.map((item) => item.episodeNumber),
      requestedRange ?? {
        startEpisode: 1,
        endEpisode: currentProject.episodePlansReadyThrough ?? 0,
      },
      currentProject.episodeRoadmapRequired === true,
    );
    if (approvedLeafDecision.status === "complete") {
      setMessage(t("workspace.leafComplete"));
      setBusyAction(null);
      return;
    }
    if (approvedLeafDecision.status === "gap") {
      setMessage(t("workspace.planningGap").replace(
        "{episode}",
        String(approvedLeafDecision.nextEpisode),
      ));
      setBusyAction(null);
      return;
    }
    if (approvedLeafDecision.status !== "ready") {
      setMessage(t("generation.episodePlansRequired"));
      setBusyAction(null);
      return;
    }
    const decision = nextLeafBatchRange(
      generatedThrough,
      currentProject.generationSettings,
      approvedLeafDecision.range,
      { generatedBodyCharacters: seriesTextMetrics.scriptBodyCharacters },
    );
    if (decision.status !== "ready") {
      setMessage(decision.status === "gap"
        ? t("workspace.planningGap").replace("{episode}", String(decision.nextEpisode))
        : t("workspace.leafComplete"));
      setBusyAction(null);
      return;
    }
    const batchRange = decision.range;
    const backgroundTask = beginScriptGenerationTask({
      projectId: currentProject.id,
      startEpisode: batchRange.startEpisode,
      endEpisode: batchRange.endEpisode,
    });
    if (!backgroundTask.started) {
      setDialog(null);
      setMessage(t("workflowNavigation.backgroundScript")
        .replace("{start}", String(backgroundTask.task.startEpisode))
        .replace("{end}", String(backgroundTask.task.endEpisode)));
      setBusyAction(null);
      return;
    }
    let generationFailed = false;
    let generationFailure: unknown;
    const recoveryCandidate = currentProject.activeGenerationTask
      && currentProject.activeGenerationTask.status !== "completed"
      && currentProject.activeGenerationTask.startEpisode <= batchRange.startEpisode
      && currentProject.activeGenerationTask.endEpisode === batchRange.endEpisode
      ? currentProject.activeGenerationTask
      : undefined;
    const batchNumber = recoveryCandidate?.batchNumber ?? (
      Math.max(
        0,
        ...currentProject.generationBatches.map((batch) => batch.batchNumber),
      ) + 1
    );
    const requestedEpisodeCount = batchRange.endEpisode - batchRange.startEpisode + 1;
    const createdAt = new Date().toISOString();
    const generatedEpisodes: EpisodeWorkspace[] = [];
    const overseasCharacterNames = collectProjectOverseasCharacterNames(currentProject);
    const batchRecordId = `batch-${currentProject.id}-${batchNumber}`;
    let activeStreamingEpisode = batchRange.startEpisode;
    let recoveryTask: GenerationRecoveryTask | undefined;
    const persistRecoveryTask = async (task: GenerationRecoveryTask) => {
      recoveryTask = task;
      updateProject(currentProject.id, { activeGenerationTask: task });
      try {
        const savedTask = await saveGenerationTaskOnServer(currentProject.id, task);
        recoveryTask = savedTask;
        updateProject(currentProject.id, { activeGenerationTask: savedTask });
      } catch {
        recoveryTask = { ...task, serverBacked: false };
        updateProject(currentProject.id, { activeGenerationTask: recoveryTask });
      }
    };
    const pauseAtEpisodeBoundary = async () => {
      if (!isScriptGenerationPauseRequested(currentProject.id)) return;
      if (recoveryTask && recoveryTask.status !== "paused") {
        await persistRecoveryTask(pauseGenerationRecoveryTask(recoveryTask));
      }
      setMessage(t("workspace.generationPaused"));
      const didPause = await waitForScriptGenerationResume(currentProject.id);
      if (didPause && recoveryTask?.status === "paused") {
        await persistRecoveryTask(
          continuePausedGenerationRecoveryTask(recoveryTask),
        );
        setMessage(t("workspace.generationResumed"));
      }
    };
    setStreamBatch(createEpisodeStreamBatch(
      batchRange.startEpisode,
      batchRange.endEpisode,
      targetScriptBodyCharacters(currentProject.generationSettings, {
        generatedEpisodeCount: orderedExistingEpisodes.length,
        generatedBodyCharacters: seriesTextMetrics.scriptBodyCharacters,
      }),
    ));
    try {
      const [storyBible, episodePlans] = await Promise.all([
        loadStoryBible(currentProject.id, currentProject.storyBibleVersion),
        loadEpisodePlans(
          currentProject.id,
          storyBibleId,
          currentProject.storyBibleVersion,
          batchRange.startEpisode,
          batchRange.endEpisode,
        ),
      ]);
      if (!storyBible || storyBible.status !== "approved") {
        throw new Error(t("generation.planRequired"));
      }
      const generationConstraints = resolveEpisodeGenerationConstraints(
        episodePlans,
        storyPlanNodes,
        batchRange.startEpisode,
        batchRange.endEpisode,
        currentProject.episodeRoadmaps,
        currentProject.episodeRoadmapRequired,
      );
      if (generationConstraints.length !== requestedEpisodeCount) {
        throw new Error(t("generation.episodePlansRequired"));
      }
      const generationRuntime = await prepareEpisodeGenerationRuntime(currentProject);
      const constraintsByNumber = new Map(
        generationConstraints.map((constraint) => [constraint.episodeNumber, constraint]),
      );
      recoveryTask = recoveryCandidate
        ? recoveryCandidate.status === "paused"
          ? continuePausedGenerationRecoveryTask(recoveryCandidate)
          : resumeGenerationRecoveryTask(recoveryCandidate)
        : createGenerationRecoveryTask({
            batchNumber,
            startEpisode: batchRange.startEpisode,
            endEpisode: batchRange.endEpisode,
            episodePlanIds: generationConstraints.map((constraint) => (
              constraint.episodePlan?.episode_plan_id
              ?? `episode-plan.runtime.${constraint.episodeNumber}`
            )),
            instruction: optionalInstruction,
          });
      await persistRecoveryTask(recoveryTask);
      const persistGeneratedEpisodes = async (completed: boolean) => {
        const episodes = mergeEpisodesByNumber(
          orderedExistingEpisodes,
          generatedEpisodes,
        );
        const taskStart = recoveryTask?.startEpisode ?? batchRange.startEpisode;
        const taskEnd = recoveryTask?.endEpisode ?? batchRange.endEpisode;
        const generatedInTask = episodes.filter((item) => (
          item.episodeNumber >= taskStart && item.episodeNumber <= taskEnd
        )).length;
        const batchRecord: GenerationBatchRecord = {
          id: batchRecordId,
          batchNumber,
          startEpisode: taskStart,
          endEpisode: taskEnd,
          requestedEpisodeCount: taskEnd - taskStart + 1,
          generatedEpisodeCount: generatedInTask,
          instruction: optionalInstruction.trim() || undefined,
          status: completed ? "completed" : "partial",
          createdAt,
          ...(completed ? { completedAt: new Date().toISOString() } : {}),
        };
        const saved = await updateProject(currentProject.id, {
          episodes,
          generationBatches: [
            ...currentProject.generationBatches.filter((batch) => batch.id !== batchRecordId),
            batchRecord,
          ],
          ...synchronizeContinuity(
            currentProject.creativePrompt,
            currentProject.characters,
            episodes,
            currentProject.storyLines,
            currentProject.characterRelationships,
            currentProject.continuityStates,
          ),
          status: "draft",
        });
        if (!saved) {
          throw Object.assign(
            new Error("Generated episode content could not be saved locally."),
            { retryable: false, failureClass: "persistence" },
          );
        }
      };
      const generateEpisode = async (
        episodeNumber: number,
        continuityEpisodes: EpisodeWorkspace[],
      ): Promise<EpisodeWorkspace> => {
        const latestEpisode = continuityEpisodes.at(-1);
        const previousEpisode = latestEpisode
          ? resolveExportDraft(latestEpisode)
          : undefined;
        const continuity = synchronizeContinuity(
          currentProject.creativePrompt,
          currentProject.characters,
          continuityEpisodes,
          currentProject.storyLines,
          currentProject.characterRelationships,
          currentProject.continuityStates,
        );
        const generatedBodyCharacters = calculateSeriesTextMetrics(
          continuityEpisodes.map(resolveExportDraft),
          currentProject.generationSettings.targetTotalCharacters,
          currentProject.generationSettings.episodeCount,
        ).scriptBodyCharacters;
        const generationConstraint = constraintsByNumber.get(episodeNumber);
        const ledgerPlan = episodeGenerationLedgerPlan(generationConstraint);
        const baselineBodyTarget = targetScriptBodyCharacters(
          currentProject.generationSettings,
        );
        const adaptiveBodyTarget = targetScriptBodyCharacters(
          currentProject.generationSettings,
          {
            generatedEpisodeCount: continuityEpisodes.length,
            generatedBodyCharacters,
          },
        );
        const bodyTarget = plannedEpisodeBodyReference(
          generationConstraint,
          storySegmentBodyReference(
            generationConstraint,
            adaptiveBodyTarget,
            adaptiveBodyTarget / Math.max(1, baselineBodyTarget),
          ),
        );
        setStreamBatch((current) => startEpisodeStream(
          current,
          episodeNumber,
          bodyTarget,
        ));
        const run = await generateSingleEpisode({ ...currentProject, ...continuity }, {
          generationMode: currentProject.generationSettings.mode,
          episodeNumber,
          totalEpisodes: batchRange.totalEpisodes,
          targetScriptBodyCharacters: bodyTarget,
          targetDurationSeconds: plannedEpisodeDurationSeconds(generationConstraint),
          adaptiveSceneCount: adaptiveEpisodeSceneCount(generationConstraint),
          plannedShotCount: plannedEpisodeShotCount(generationConstraint),
          previousEpisode,
          episodeInstruction: episodeGenerationInstruction(
            generationConstraint,
            episodeNumber === batchRange.startEpisode ? optionalInstruction : "",
            { isSeriesFinale: episodeNumber === batchRange.totalEpisodes },
          ),
          relevantCharacterRefs: episodeGenerationCharacterRefs(generationConstraint),
          approvedStoryNode: storyNodeExecutionContext(generationConstraint),
          approvedEpisodePlan: episodeGenerationExecutionPlan(generationConstraint),
          ...ledgerPlan,
          storyBibleContext: storyBibleEpisodeContext(
            storyBible,
            generationConstraint,
          ),
          batch: {
            batchNumber,
            startEpisode: batchRange.startEpisode,
            endEpisode: batchRange.endEpisode,
            instruction: optionalInstruction,
          },
        }, (event) => setStreamBatch((current) => applyEpisodeStreamEvent(
          current,
          episodeNumber,
          event,
        )), generationRuntime);
        setStreamBatch((current) => completeEpisodeStream(
          current,
          episodeNumber,
          {
            actualCharacters: calculateDraftTextMetrics(
              run.draft_master_script,
            ).scriptBodyCharacters,
            ...generationPerformanceDetails(run.draft_master_script),
          },
        ));
        const bilingualViews = await buildGeneratedOverseasDialogueView(
          currentProject,
          run,
          overseasCharacterNames,
        );
        const now = new Date().toISOString();
        return {
          id: crypto.randomUUID(),
          episodeNumber,
          status: "framework",
          generationRun: run,
          ...(bilingualViews ? { bilingualViews } : {}),
          workingDraftJson: JSON.stringify(run.draft_master_script, null, 2),
          hasLocalDraftEdits: false,
          continuationInstruction: optionalInstruction.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        };
      };
      const episodeNumbers = Array.from(
        { length: requestedEpisodeCount },
        (_, index) => batchRange.startEpisode + index,
      );
      const generateEpisodeWithRetry = (
        episodeNumber: number,
        continuityEpisodes: EpisodeWorkspace[],
      ) => generateWithAutomaticTransientRetry({
        generate: () => generateEpisode(
          episodeNumber,
          continuityEpisodes,
        ),
        onAutomaticRetry: ({ nextAttempt, maxAttempts }) => {
          setStreamBatch((current) => markEpisodeAutomaticRetry(
            current,
            episodeNumber,
          ));
          setMessage(t("workspace.stream.autoRetrying")
            .replace("{episode}", String(episodeNumber))
            .replace("{attempt}", String(nextAttempt))
            .replace("{max}", String(maxAttempts)));
        },
      });
      const generationWindows = buildEpisodeGenerationWindows(episodeNumbers);
      for (const windowEpisodeNumbers of generationWindows) {
        await pauseAtEpisodeBoundary();
        activeStreamingEpisode = windowEpisodeNumbers[0];
        setMessage(t("workspace.batchProgress")
          .replace(
            "{current}",
            String(windowEpisodeNumbers[0] - batchRange.startEpisode + 1),
          )
          .replace("{total}", String(requestedEpisodeCount)));

        const continuityEpisodes = [...orderedExistingEpisodes, ...generatedEpisodes];
        const windowResults = await Promise.allSettled(
          windowEpisodeNumbers.map((episodeNumber) => generateEpisodeWithRetry(
            episodeNumber,
            continuityEpisodes,
          )),
        );
        let firstFailure: { episodeNumber: number; reason: unknown } | undefined;
        for (let index = 0; index < windowResults.length; index += 1) {
          const episodeNumber = windowEpisodeNumbers[index];
          const result = windowResults[index];
          if (result.status === "rejected") {
            const errorText = userFacingError(result.reason, t("generation.failed"));
            setStreamBatch((current) => failEpisodeStream(
              current,
              episodeNumber,
              errorText,
            ));
            firstFailure ??= { episodeNumber, reason: result.reason };
            continue;
          }
          if (firstFailure) {
            setStreamBatch((current) => failEpisodeStream(
              current,
              episodeNumber,
              "上一集生成失败，本集结果未保存，请从失败集继续生成。",
            ));
            continue;
          }
          generatedEpisodes.push(result.value);
          generatedEpisodes.sort((left, right) => left.episodeNumber - right.episodeNumber);
          await persistGeneratedEpisodes(false);
          if (recoveryTask) {
            await persistRecoveryTask(
              completeRecoveryEpisode(recoveryTask, episodeNumber),
            );
          }
        }
        if (firstFailure) {
          activeStreamingEpisode = firstFailure.episodeNumber;
          throw firstFailure.reason;
        }
      }
      generatedEpisodes.sort((left, right) => left.episodeNumber - right.episodeNumber);
      await persistGeneratedEpisodes(true);
      if (recoveryTask) {
        await persistRecoveryTask(finishGenerationRecoveryTask(recoveryTask));
      }
      updateProject(currentProject.id, { activeEpisodeNumber: batchRange.startEpisode });
      updateProject(currentProject.id, { activeGenerationTask: undefined });
      setActiveEpisodeNumber(batchRange.startEpisode);
      setDialog(null);
      setInstruction("");
      setMessage(t("workspace.batchComplete")
        .replace("{start}", String(batchRange.startEpisode))
        .replace("{end}", String(batchRange.endEpisode)));
    } catch (error) {
      generationFailed = true;
      generationFailure = error;
      const errorText = userFacingError(error, t("generation.failed"));
      if (recoveryTask) {
        await persistRecoveryTask(
          failGenerationRecoveryTask(
            recoveryTask,
            activeStreamingEpisode,
            errorText,
          ),
        );
      }
      setStreamBatch((current) => failEpisodeStream(
        current,
        activeStreamingEpisode,
        errorText,
      ));
      setMessage(formatWorkflowError(error, t, "workspace.nextFailed"));
    } finally {
      if (generationFailed) {
        failScriptGenerationTask(currentProject.id, generationFailure);
      } else {
        completeScriptGenerationTask(currentProject.id);
      }
      setBusyAction(null);
    }
  }

  function handleNextEpisode() {
    const nextNumber = currentEpisode.episodeNumber + 1;
    if (currentProject.episodes.some((item) => item.episodeNumber === nextNumber)) {
      selectEpisode(nextNumber);
      return;
    }
    setInstruction("");
    setDialog("batch");
  }

  async function finalizeEpisode() {
    if (blockCrossMarketMutation()) return;
    if (!isConfirmed) return;
    setBusyAction("finalize");
    setMessage(null);
    try {
      const result = await completeScriptQualityLoop(currentEpisode.generationRun);
      const revisedArtifact = await saveEpisodeArtifactOnServer({
        project: currentProject,
        episodeNumber: currentEpisode.episodeNumber,
        artifactKind: "revised",
        contentSchemaVersion: "revised_draft_master_script.v1",
        contentPayload: result.revisionRun.revised_draft_master_script,
        sourceArtifactId: currentEpisode.artifactRefs?.draft?.artifactId,
        lineageRefs: {
          revised_draft_master_script_id: result.revisionRun.revised_draft_master_script.id,
        },
      });
      const finalArtifact = await saveEpisodeArtifactOnServer({
        project: currentProject,
        episodeNumber: currentEpisode.episodeNumber,
        artifactKind: "final",
        contentSchemaVersion: "final_master_script.v1",
        contentPayload: result.finalizationResult.master_script,
        sourceArtifactId: revisedArtifact?.artifactId,
        lineageRefs: {
          final_master_script_id: result.finalizationResult.master_script.id,
        },
      });
      const allEpisodesFinal = currentProject.episodes.every((item) => (
        item.episodeNumber === currentEpisode.episodeNumber || item.status === "final"
      ));
      replaceEpisode({
        status: "final",
        revisionRun: result.revisionRun,
        finalizationResult: result.finalizationResult,
        artifactRefs: {
          ...currentEpisode.artifactRefs,
          ...(revisedArtifact ? { revised: revisedArtifact } : {}),
          ...(finalArtifact ? { final: finalArtifact } : {}),
        },
      }, {
        status: allEpisodesFinal ? "final" : "draft",
        ...(currentEpisode.episodeNumber === 1 ? {
          revisionRun: result.revisionRun,
          finalizationResult: result.finalizationResult,
        } : {}),
      });
      setSelectedVersion("final");
      setMessage(revisedArtifact && finalArtifact
        ? t("workspace.qualityComplete")
        : `${t("workspace.qualityComplete")} ${t("workspace.artifactSaveWarning")}`);
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.qualityFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function downloadEpisode(format: "json" | EpisodeDocumentFormat) {
    const isJson = format === "json";
    if (format === "word") {
      const document = await createScreenplayDocxBlob(currentProject.title, [{
        episodeNumber: currentEpisode.episodeNumber,
        draft: displayedDraft,
        bilingualView: displayedBilingualView,
      }]);
      downloadBlob(
        document,
        episodeDocumentFilename(
          currentProject.title,
          currentEpisode.episodeNumber,
          format,
        ),
      );
      return;
    }
    downloadFile(
      isJson
        ? JSON.stringify(displayedDraft, null, 2)
        : format === "markdown"
          ? toEpisodeMarkdown(
              displayedDraft,
              currentEpisode.episodeNumber,
              displayedBilingualView,
            )
          : toEpisodePlainText(
              displayedDraft,
              currentEpisode.episodeNumber,
              displayedBilingualView,
            ),
      isJson
        ? `${safeFilename(currentProject.title)}-episode-${String(currentEpisode.episodeNumber).padStart(2, "0")}.json`
        : episodeDocumentFilename(
            currentProject.title,
            currentEpisode.episodeNumber,
            format,
          ),
      isJson
        ? "application/json"
        : format === "markdown"
          ? "text/markdown;charset=utf-8"
          : "text/plain;charset=utf-8",
    );
  }

  function downloadSeriesData() {
    const ordered = currentProject.episodes
      .slice()
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((item) => ({
        episodeNumber: item.episodeNumber,
        status: item.status,
        draft: resolveExportDraft(item),
      }));
    downloadFile(
      JSON.stringify({
        schema_version: "ai_comic_series_export.v1",
        project_id: currentProject.id,
        title: currentProject.title,
        tags: currentProject.selectedTagIds,
        characters: currentProject.characters,
        planning_mode: "recursive_tree",
        text_metrics: seriesTextMetrics,
        episodes: ordered,
      }, null, 2),
      `${safeFilename(currentProject.title)}-full-script.json`,
      "application/json",
    );
  }

  async function downloadSeriesDocuments() {
    const formats = (Object.entries(seriesExportFormats) as Array<[EpisodeDocumentFormat, boolean]>)
      .filter(([, selected]) => selected)
      .map(([format]) => format);
    if (!formats.length && !seriesExportProductionPackage) return;

    const episodes = currentProject.episodes
      .slice()
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((item) => {
        const draft = resolveExportDraft(item);
        return {
          episodeNumber: item.episodeNumber,
          draft,
          bilingualView: item.bilingualViews?.[draft.id],
        };
      });
    setSeriesExportBusy(true);
    setMessage(null);
    try {
      const productionAttachments = seriesExportProductionPackage
        ? (await createProductionWorkbookAttachments(
            currentProject.title,
            buildProductionIndex({
              characters: currentProject.characters,
              relationships: currentProject.characterRelationships,
              continuityStates: currentProject.continuityStates,
              episodes,
            }),
          )).map((attachment) => ({
            filename: `制作资料/${attachment.filename}`,
            content: attachment.content,
          }))
        : [];
      if (seriesExportMode === "episodes") {
        const archive = await createEpisodeArchive(
          currentProject.title,
          episodes,
          formats,
          productionAttachments,
        );
        downloadBlob(archive, seriesArchiveFilename(currentProject.title, "episodes"));
      } else {
        const documents = await Promise.all(formats.map(async (format) => ({
          format,
          content: format === "word"
            ? await createScreenplayDocxBlob(currentProject.title, episodes, { includeCover: true })
            : toSeriesDocument(
                currentProject.title,
                episodes,
                format,
                seriesExportPreface(format, seriesTextMetrics, numberFormatter),
              ),
        })));
        if (documents.length === 1 && !productionAttachments.length) {
          const document = documents[0];
          if (document.content instanceof Blob) {
            downloadBlob(
              document.content,
              collectionDocumentFilename(currentProject.title, document.format),
            );
          } else {
            downloadFile(
              document.content,
              collectionDocumentFilename(currentProject.title, document.format),
              document.format === "markdown"
                ? "text/markdown;charset=utf-8"
                : "text/plain;charset=utf-8",
            );
          }
        } else {
          const archive = await createCollectionArchive(
            currentProject.title,
            documents,
            productionAttachments,
          );
          downloadBlob(archive, seriesArchiveFilename(currentProject.title, "collection"));
        }
      }
      setSeriesExportOpen(false);
    } catch {
      setMessage(t("workspace.exportFailed"));
    } finally {
      setSeriesExportBusy(false);
    }
  }

  return (
    <main className="script-workspace page-reveal">
      <header className="workspace-header">
        <div>
          <span className="section-kicker">{t("workspace.kicker")}</span>
          <div className="section-title-with-help">
            <h1>{displayedProjectTitle}</h1>
            <SectionHelp content={t("guide.scriptWorkspace")} label={t("guide.openHelp")} />
          </div>
          <p>{t("workspace.episodeCountSummary").replace("{current}", String(currentProject.episodes.length)).replace("{total}", String(currentProject.generationSettings.episodeCount))}</p>
        </div>
        <div className="workspace-header-actions">
          {streamBatch.length && generationProgressVisible === false ? (
            <button className="outline-action" onClick={scrollToGenerationProgress} type="button">
              {t("workspace.backToGenerationProgress")}
            </button>
          ) : null}
          <button className="outline-action" onClick={() => setSeriesExportOpen(true)} type="button">
            {t("workspace.exportScript")}
          </button>
          <Link className="outline-action" href={`/projects/${currentProject.id}/planning`}>
            {t("workspace.backToPlanning")}
          </Link>
        </div>
      </header>

      <WorkflowNavigation
        active="script"
        generatedEpisodes={currentProject.episodes.length}
        plannedThrough={currentProject.episodePlansReadyThrough ?? 0}
        projectId={currentProject.id}
        scriptStarted
        totalEpisodes={currentProject.generationSettings.episodeCount}
      />

      {currentProject.activeGenerationTask
      && recoverableEpisode !== null
      && (!backgroundScriptTask || backgroundScriptTask.status === "failed" || backgroundScriptTask.status === "completed") ? (
        <section className="generation-recovery-banner" aria-live="polite">
          <div>
            <strong>{t("workspace.recovery.title")}</strong>
            <p>{t("workspace.recovery.description")
              .replace("{episode}", String(recoverableEpisode))}</p>
          </div>
          <button
            className="primary-action"
            disabled={Boolean(busyAction)}
            onClick={() => void generateNextStage(
              currentProject.activeGenerationTask?.instruction ?? "",
              {
                startEpisode: currentProject.activeGenerationTask?.startEpisode
                  ?? recoverableEpisode,
                endEpisode: currentProject.activeGenerationTask?.endEpisode
                  ?? recoverableEpisode,
              },
            )}
            type="button"
          >
            {busyAction ? t("workspace.processing") : t("workspace.recovery.resume")}
          </button>
        </section>
      ) : null}

      <AutoStartDirectGeneration
        enabled={generationIntent && !generationIntentConsumed && Boolean(requestedLeafRange)}
        onConsume={() => {
          setGenerationIntentConsumed(true);
          router.replace(`/projects/${currentProject.id}/workspace`);
        }}
        onStart={() => generateNextStage("", requestedLeafRange ?? undefined)}
      />

      {streamBatch.length ? (
        <EpisodeGenerationProgress
          batch={streamBatch}
          onRetryEpisode={(episodeNumber) => {
            const recoveryTask = currentProject.activeGenerationTask;
            void generateNextStage("", {
              startEpisode: recoveryTask?.startEpisode
                ?? streamBatch[0]?.episodeNumber
                ?? episodeNumber,
              endEpisode: recoveryTask?.endEpisode
                ?? streamBatch.at(-1)?.episodeNumber
                ?? episodeNumber,
            });
          }}
          retryDisabled={Boolean(busyAction)}
          t={t}
        />
      ) : null}

      <section aria-label={t("workspace.length.title")} className="story-length-dashboard">
        <div className="story-length-heading">
          <div>
            <span className="section-kicker">{t("workspace.length.kicker")}</span>
            <div className="section-title-with-help">
              <h2>{t("workspace.length.title")}</h2>
              <SectionHelp content={t("guide.storyLength")} label={t("guide.openHelp")} />
            </div>
          </div>
          <strong>{progressPercent.toFixed(2)}%</strong>
        </div>
        <div className="story-length-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, progressPercent)}>
          <span style={{ width: `${Math.min(100, progressPercent)}%` }} />
        </div>
        <div className="story-length-metrics">
          <div><span>{t("workspace.length.total")}</span><strong>{numberFormatter.format(seriesTextMetrics.scriptBodyCharacters)}</strong><small>{t("workspace.length.target").replace("{target}", numberFormatter.format(seriesTextMetrics.targetCharacters))}</small></div>
          <div><span>{t("workspace.length.body")}</span><strong>{numberFormatter.format(seriesTextMetrics.totalCharacters)}</strong><small>{t("workspace.length.bodyHelp")}</small></div>
          <div><span>{t("workspace.length.average")}</span><strong>{numberFormatter.format(seriesTextMetrics.averageCharactersPerEpisode)}</strong><small>{t("workspace.length.requiredAverage").replace("{required}", numberFormatter.format(seriesTextMetrics.requiredAverageCharactersPerEpisode))}</small></div>
          <div><span>{t("workspace.length.projection")}</span><strong>{numberFormatter.format(seriesTextMetrics.projectedCharactersAtPlannedEpisodes)}</strong><small>{projectedSummary}</small></div>
        </div>
        <div className="story-length-current">
          <span>{t("workspace.length.currentEpisode").replace("{episode}", String(currentEpisode.episodeNumber))}</span>
          <strong>{numberFormatter.format(displayedTextMetrics.scriptBodyCharacters)}</strong>
          <small>{t("workspace.length.currentBreakdown")
            .replace("{actions}", numberFormatter.format(displayedTextMetrics.actionCharacters))
            .replace("{dialogue}", numberFormatter.format(displayedTextMetrics.dialogueCharacters))}</small>
          <small>{t("workspace.length.currentTarget")
            .replace("{min}", numberFormatter.format(displayedBodyGuidance.preferredMinCharacters))
            .replace("{max}", numberFormatter.format(displayedBodyGuidance.preferredMaxCharacters))
            .replace("{status}", displayedBodyTargetStatus)}</small>
          <small>{t("workspace.length.countingRule")}</small>
        </div>
      </section>

      <nav className="project-view-tabs">
        <button aria-pressed={workspaceView === "script"} onClick={() => setWorkspaceView("script")} type="button">{t("workspace.scriptView")}</button>
        <button aria-pressed={workspaceView === "continuity"} onClick={() => setWorkspaceView("continuity")} type="button">{t("workspace.continuityView")}</button>
      </nav>

      {marketMismatch ? (
        <div className="storage-alert">{t("workspace.marketMismatch")}</div>
      ) : null}

      {workspaceView === "continuity" ? (
        <ProjectContinuityPanel
          project={currentProject}
        />
      ) : (
      <div className="episode-workspace-layout">
        <EpisodeTreeNavigation
          activeEpisodeNumber={currentEpisode.episodeNumber}
          entries={currentProject.episodes.map((item) => ({
            id: item.id,
            episodeNumber: item.episodeNumber,
            label: t("workspace.episodeLabel").replace("{number}", String(item.episodeNumber)),
            statusLabel: t(`episodeStatus.${item.status}`),
          }))}
          heading={t("workspace.episodes")}
          nextBatchDisabled={busyAction === "next" || busyAction === "batch"}
          nextBatchLabel={t("workspace.nextBatch")}
          onNextBatch={handleNextEpisode}
          onSelectEpisode={selectEpisode}
          projectId={currentProject.id}
          showNextBatch={currentProject.episodes.length < currentProject.generationSettings.episodeCount && isConfirmed}
          storyBibleVersion={currentProject.storyBibleVersion}
          totalEpisodes={currentProject.generationSettings.episodeCount}
        />

        <div className="episode-document-area">
          <div className="episode-title-row">
            <span>{t("workspace.episodeLabel").replace("{number}", String(currentEpisode.episodeNumber))}</span>
            <span className={`episode-status status-${currentEpisode.status}`}>{t(`episodeStatus.${currentEpisode.status}`)}</span>
          </div>

          <nav aria-label={t("workspace.versions")} className="workspace-version-tabs">
            <button aria-pressed={selectedVersion === "framework"} onClick={() => setSelectedVersion("framework")} type="button">{t("workspace.version.draft")}</button>
            <button aria-pressed={selectedVersion === "modification"} disabled={!modificationDraft} onClick={() => setSelectedVersion("modification")} type="button">{t("workspace.version.modification")}</button>
            {CREATIVE_DEEPENING_ENABLED ? <button aria-pressed={selectedVersion === "deepening"} disabled={!deepeningDraft} onClick={() => setSelectedVersion("deepening")} type="button">{t("workspace.version.deepening")}</button> : null}
            <button aria-pressed={selectedVersion === "revised"} disabled={!revisedDraft} onClick={() => setSelectedVersion("revised")} type="button">{t("workspace.version.revised")}</button>
            <button aria-pressed={selectedVersion === "final"} disabled={!finalDraft} onClick={() => setSelectedVersion("final")} type="button">{t("workspace.version.final")}</button>
          </nav>

          <div className="workspace-toolbar episode-actions">
            {selectedVersion === "framework" ? <button className="outline-action" onClick={startEditing} type="button">{t("workspace.edit")}</button> : null}
            {selectedVersion === "framework" ? <button className="outline-action" onClick={() => { setInstruction(""); setDialog("modify"); }} type="button">{t("workspace.aiModify")}</button> : null}
            {!isConfirmed && selectedVersion === "framework" ? <button className="primary-action" disabled={busyAction === "confirm"} onClick={() => void confirmDraft()} type="button">{busyAction === "confirm" ? t("workspace.confirming") : t("workspace.confirmEpisode")}</button> : null}
            {isConfirmed ? <button className="primary-action" disabled={busyAction === "next" || busyAction === "batch"} onClick={handleNextEpisode} type="button">{currentProject.episodes.some((item) => item.episodeNumber === currentEpisode.episodeNumber + 1) ? t("workspace.nextEpisode") : t("workspace.nextBatch")} <ArrowIcon /></button> : null}
            {isConfirmed && CREATIVE_DEEPENING_ENABLED ? <button className="outline-action" disabled={busyAction === "deepen"} onClick={() => void requestDeepening()} type="button">{busyAction === "deepen" ? t("workspace.deepening") : t("workspace.deepenEpisode")}</button> : null}
            <div className="episode-export-control">
              <select
                aria-label={t("workspace.exportEpisodeFormat")}
                onChange={(event) => setEpisodeExportFormat(event.target.value as EpisodeDocumentFormat)}
                value={episodeExportFormat}
              >
                <option value="markdown">{t("workspace.exportFormatMarkdown")}</option>
                <option value="text">{t("workspace.exportFormatText")}</option>
                <option value="word">{t("workspace.exportFormatWord")}</option>
              </select>
              <button className="outline-action" onClick={() => void downloadEpisode(episodeExportFormat)} type="button">{t("workspace.exportEpisode")}</button>
            </div>
            <button className="text-action" onClick={() => void downloadEpisode("json")} type="button">{t("workspace.exportEpisodeData")}</button>
          </div>

          {selectedVersion === "modification" && modificationDraft ? (
            <div className="candidate-decision-bar"><span>{currentEpisode.modificationCandidate?.instruction}</span><button className="primary-action" onClick={applyModification} type="button">{t("workspace.applyCandidate")}</button><button className="outline-action" onClick={() => { replaceEpisode({ modificationCandidate: undefined }); setSelectedVersion("framework"); }} type="button">{t("workspace.discardCandidate")}</button></div>
          ) : null}
          {selectedVersion === "deepening" && deepeningDraft ? (
            <div className="candidate-decision-bar"><span>{deepeningRun?.comparison_metadata?.summary ?? t("workspace.deepeningReady")}</span><button className="primary-action" disabled={busyAction === "confirm"} onClick={() => void applyDeepening()} type="button">{t("workspace.applyDeepening")}</button><button className="outline-action" onClick={() => setSelectedVersion("framework")} type="button">{t("workspace.keepFramework")}</button></div>
          ) : null}
          {message ? <div className="inline-notice">{message}</div> : null}

          {editingDraft ? (
            <EpisodeDraftEditor draft={editingDraft} onChange={setEditingDraft} onCancel={() => setEditingDraft(null)} onConfirm={() => void confirmDraft(editingDraft)} onSave={saveManualEdit} t={t} />
          ) : (
            <ScriptDocumentWithTranslation
              cachedView={displayedBilingualView}
              characterNameMap={Object.fromEntries(
                collectProjectOverseasCharacterNames(currentProject),
              )}
              draft={displayedDraft}
              generationStrategyId={currentEpisode.generationRun.generation_strategy_id}
              locale={locale}
              onView={(view) => replaceEpisode({
                bilingualViews: {
                  ...(currentEpisode.bilingualViews ?? {}),
                  [displayedDraft.id]: view,
                },
              })}
              releaseRegion={currentProject.generationSettings.releaseRegion}
              t={t}
            />
          )}

          {isConfirmed ? (
            <section className="episode-finalization-panel">
              <div>
                <div className="section-kicker-with-help">
                  <span className="section-kicker">{t("workspace.finalization")}</span>
                  <SectionHelp content={t("guide.finalization")} label={t("guide.openHelp")} />
                </div>
                <p>{t("workspace.finalizationHelp")}</p>
              </div>
              <button className="primary-action" disabled={busyAction === "finalize" || currentEpisode.status === "final"} onClick={() => void finalizeEpisode()} type="button">{busyAction === "finalize" ? t("workspace.completingQuality") : currentEpisode.status === "final" ? t("workspace.qualityCompleted") : t("workspace.completeQuality")}</button>
            </section>
          ) : null}
        </div>
      </div>
      )}

      {dialog ? (
        <div className="tag-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busyAction) setDialog(null); }}>
          <div aria-modal="true" className="tag-dialog episode-instruction-dialog" role="dialog">
            <button aria-label={t("tags.cancelCustom")} className="tag-dialog-close" disabled={Boolean(busyAction)} onClick={() => setDialog(null)} type="button"><CloseIcon /></button>
            <span className="section-kicker">{dialog === "batch" ? t("workspace.nextBatch") : dialog === "next" ? t("workspace.nextEpisode") : t("workspace.aiModify")}</span>
            <div className="section-title-with-help">
              <h3>{dialog === "batch" ? t("workspace.batchPromptTitle") : dialog === "next" ? t("workspace.nextPromptTitle") : t("workspace.modifyPromptTitle")}</h3>
              <SectionHelp content={t("guide.aiRevision")} label={t("guide.openHelp")} />
            </div>
            <p>{dialog === "batch" ? t("workspace.batchPromptHelp") : dialog === "next" ? t("workspace.nextPromptHelp") : t("workspace.modifyPromptHelp")}</p>
            <textarea autoFocus maxLength={1000} onChange={(event) => setInstruction(event.target.value)} placeholder={dialog === "batch" ? t("workspace.batchPromptPlaceholder") : dialog === "next" ? t("workspace.nextPromptPlaceholder") : t("workspace.modifyPromptPlaceholder")} rows={5} value={instruction} />
            <div className="tag-dialog-actions">
              {dialog === "next" || dialog === "batch" ? <button className="outline-action" disabled={Boolean(busyAction)} onClick={() => void generateNextStage()} type="button">{t("workspace.skipPrompt")}</button> : <button className="outline-action" disabled={Boolean(busyAction)} onClick={() => setDialog(null)} type="button">{t("tags.cancelCustom")}</button>}
              <button className="primary-action" disabled={Boolean(busyAction) || (dialog === "modify" && !instruction.trim())} onClick={() => dialog === "next" || dialog === "batch" ? void generateNextStage(instruction) : void requestModification()} type="button">{busyAction ? t("workspace.processing") : t("tags.confirmCustom")}</button>
            </div>
          </div>
        </div>
      ) : null}

      {seriesExportOpen ? (
        <div className="tag-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !seriesExportBusy) setSeriesExportOpen(false); }}>
          <div aria-labelledby="series-export-title" aria-modal="true" className="tag-dialog series-export-dialog" role="dialog">
            <button aria-label={t("tags.cancelCustom")} className="tag-dialog-close" disabled={seriesExportBusy} onClick={() => setSeriesExportOpen(false)} type="button"><CloseIcon /></button>
            <span className="section-kicker">{t("workspace.exportDialogKicker")}</span>
            <div className="section-title-with-help">
              <h3 id="series-export-title">{t("workspace.exportDialogTitle")}</h3>
              <SectionHelp content={t("guide.export")} label={t("guide.openHelp")} />
            </div>

            <fieldset className="series-export-fieldset">
              <legend>{t("workspace.exportMode")}</legend>
              <div aria-label={t("workspace.exportMode")} className="series-export-modes" role="group">
                <button aria-pressed={seriesExportMode === "episodes"} autoFocus onClick={() => setSeriesExportMode("episodes")} type="button">{t("workspace.exportModeEpisodes")}</button>
                <button aria-pressed={seriesExportMode === "collection"} onClick={() => setSeriesExportMode("collection")} type="button">{t("workspace.exportModeCollection")}</button>
              </div>
            </fieldset>

            <fieldset className="series-export-fieldset">
              <legend>{t("workspace.exportFormats")}</legend>
              <div className="series-export-formats">
                {(["markdown", "text", "word"] as EpisodeDocumentFormat[]).map((format) => (
                  <label key={format}>
                    <input
                      checked={seriesExportFormats[format]}
                      onChange={(event) => setSeriesExportFormats((current) => ({ ...current, [format]: event.target.checked }))}
                      type="checkbox"
                    />
                    <span>{format === "markdown"
                      ? t("workspace.exportFormatMarkdown")
                      : format === "text"
                        ? t("workspace.exportFormatText")
                        : t("workspace.exportFormatWord")}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="series-export-fieldset">
              <legend>{t("workspace.exportProductionPackage")}</legend>
              <div className="series-export-formats">
                <label>
                  <input
                    checked={seriesExportProductionPackage}
                    onChange={(event) => setSeriesExportProductionPackage(event.target.checked)}
                    type="checkbox"
                  />
                  <span>{t("workspace.exportProductionPackageOption")}</span>
                </label>
              </div>
            </fieldset>

            <p className="series-export-summary">
              {(seriesExportMode === "episodes"
                ? t("workspace.exportEpisodesSummary")
                : t("workspace.exportCollectionSummary"))
                .replace("{count}", numberFormatter.format(currentProject.episodes.length))}
              {seriesExportProductionPackage ? ` ${t("workspace.exportProductionPackageSummary")}` : ""}
            </p>
            <div className="tag-dialog-actions">
              <button className="text-action series-export-data" disabled={seriesExportBusy} onClick={downloadSeriesData} type="button">{t("workspace.exportAllData")}</button>
              <button className="outline-action" disabled={seriesExportBusy} onClick={() => setSeriesExportOpen(false)} type="button">{t("tags.cancelCustom")}</button>
              <button
                className="primary-action"
                disabled={seriesExportBusy || (!Object.values(seriesExportFormats).some(Boolean) && !seriesExportProductionPackage)}
                onClick={() => void downloadSeriesDocuments()}
                type="button"
              >
                {seriesExportBusy
                  ? t("workspace.exportPackaging")
                  : seriesExportMode === "episodes" || seriesExportProductionPackage || Object.values(seriesExportFormats).filter(Boolean).length > 1
                    ? t("workspace.exportDownloadZip")
                    : t("workspace.exportDownloadFile")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function AutoStartDirectGeneration({ enabled, onConsume, onStart }: {
  enabled: boolean;
  onConsume: () => void;
  onStart: () => Promise<void>;
}) {
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    onConsume();
    void onStart();
  }, [enabled, onConsume, onStart]);

  return null;
}

function EpisodeGenerationProgress({
  batch,
  onRetryEpisode,
  retryDisabled = false,
  t,
}: {
  batch: EpisodeStreamProgress[];
  onRetryEpisode?: (episodeNumber: number) => void;
  retryDisabled?: boolean;
  t: (key: string) => string;
}) {
  const hasActiveEpisode = batch.some((item) => item.status === "active");
  const [now, setNow] = useState(Date.now());
  const [openEpisodes, setOpenEpisodes] = useState<Set<number>>(new Set());
  const statusSignature = batch.map((item) => `${item.episodeNumber}:${item.status}`).join("|");

  useEffect(() => {
    if (!hasActiveEpisode) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveEpisode]);

  useEffect(() => {
    setOpenEpisodes((current) => {
      const next = new Set(current);
      for (const item of batch) {
        if (item.status === "active" || item.status === "failed") {
          next.add(item.episodeNumber);
        } else if (item.status === "completed") {
          next.delete(item.episodeNumber);
        }
      }
      return next;
    });
  }, [statusSignature]);

  const completedCount = batch.filter((item) => item.status === "completed").length;
  return (
    <section
      aria-label={t("workspace.stream.title")}
      className="episode-generation-progress"
      id="episode-generation-progress"
    >
      <div className="episode-generation-progress-heading">
        <div>
          <span className="section-kicker">{t("workspace.stream.kicker")}</span>
          <div className="section-title-with-help">
            <h2>{t("workspace.stream.title")}</h2>
            <SectionHelp content={t("guide.generationProgress")} label={t("guide.openHelp")} />
          </div>
        </div>
        <div className="episode-generation-progress-controls">
          <strong>{completedCount}/{batch.length}</strong>
        </div>
      </div>
      <div className="episode-generation-list">
        {batch.map((item) => {
          const visibleCharacters = item.actualCharacters
            ?? countEffectiveCharacters(item.preview);
          const progress = item.preferredMaxCharacters > 0
            ? Math.min(100, visibleCharacters / item.preferredMaxCharacters * 100)
            : 0;
          const elapsedSeconds = item.startedAt
            ? Math.max(0, Math.round(((item.completedAt ?? now) - item.startedAt) / 1000))
            : 0;
          const statusLabel = t(`workspace.stream.stage.${item.stage}`);
          return (
            <details
              className={`episode-generation-item is-${item.status}`}
              key={`${item.episodeNumber}-${item.status}`}
              onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                setOpenEpisodes((current) => {
                  if (current.has(item.episodeNumber) === isOpen) return current;
                  const next = new Set(current);
                  if (isOpen) next.add(item.episodeNumber);
                  else next.delete(item.episodeNumber);
                  return next;
                });
              }}
              open={openEpisodes.has(item.episodeNumber)}
            >
              <summary>
                <span className="episode-generation-number">
                  {String(item.episodeNumber).padStart(2, "0")}
                </span>
                <span className="episode-generation-title">
                  <strong>{t("workspace.episodeLabel").replace("{number}", String(item.episodeNumber))}</strong>
                  <small>{statusLabel}</small>
                  {(item.attemptCount ?? 0) > 1 ? (
                    <small>{t("workspace.stream.attempt")
                      .replace("{count}", String(item.attemptCount))}</small>
                  ) : null}
                </span>
                <span className="episode-generation-metrics">
                  <strong>{visibleCharacters}</strong>
                  <small>{t("workspace.stream.lengthRange")
                    .replace("{min}", String(item.preferredMinCharacters))
                    .replace("{max}", String(item.preferredMaxCharacters))}</small>
                  <small>{elapsedSeconds ? `${elapsedSeconds}s` : "-"}</small>
                </span>
              </summary>
              <div className="episode-generation-body">
                <div className="episode-generation-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
                  <span style={{ width: `${progress}%` }} />
                </div>
                {item.error ? (
                  <div className="episode-generation-error-block">
                    <p className="episode-generation-error">{userFacingError(item.error, t("generation.failed"))}</p>
                    {onRetryEpisode ? (
                      <button
                        className="outline-action episode-retry-action"
                        disabled={retryDisabled}
                        onClick={() => onRetryEpisode(item.episodeNumber)}
                        type="button"
                      >
                        {t("workspace.stream.retryEpisode")}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div aria-live={item.status === "active" ? "polite" : "off"} className="episode-generation-preview">
                    {item.preview || t("workspace.stream.waitingForText")}
                    {item.status === "active" ? <span className="typing-caret" aria-hidden="true" /> : null}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function InitialScriptBatchLauncher({
  onClearIntent,
  onConsumeIntent,
  project,
  requestedLeafRange,
  setStreamBatch,
  streamBatch,
  t,
  updateProject,
}: {
  onClearIntent: () => void;
  onConsumeIntent: () => void;
  project: ScriptProject;
  requestedLeafRange: { startEpisode: number; endEpisode: number };
  setStreamBatch: Dispatch<SetStateAction<EpisodeStreamProgress[]>>;
  streamBatch: EpisodeStreamProgress[];
  t: (key: string) => string;
  updateProject: (projectId: string, patch: Partial<ScriptProject>) => Promise<boolean>;
}) {
  const started = useRef(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  async function commitEpisodes(
    generatedEpisodes: EpisodeWorkspace[],
    batchRecord: GenerationBatchRecord,
    keepGenerating = false,
  ) {
    const episodeSnapshot = [...generatedEpisodes];
    const firstRun = episodeSnapshot[0].generationRun;
    const saved = await updateProject(project.id, {
      episodes: episodeSnapshot,
      generationBatches: [batchRecord],
      activeEpisodeNumber: generatedEpisodes[0].episodeNumber,
      ...synchronizeContinuity(
        project.creativePrompt,
        project.characters,
        episodeSnapshot,
        project.storyLines,
        project.characterRelationships,
        project.continuityStates,
      ),
      generationRun: firstRun,
      revisionRun: undefined,
      finalizationResult: undefined,
      workingDraftJson: generatedEpisodes[0].workingDraftJson,
      hasLocalDraftEdits: false,
      contentSpecId: firstRun.content_spec_id ?? project.contentSpecId,
      status: keepGenerating ? "generating" : "draft",
    });
    if (!saved) {
      throw Object.assign(
        new Error("Generated episode content could not be saved locally."),
        { retryable: false, failureClass: "persistence" },
      );
    }
  }

  async function generateInitialBatch() {
    setBusy(true);
    setErrorMessage(null);
    if (!project.storyBibleVersion) {
      setErrorMessage(t("generation.planRequired"));
      setBusy(false);
      return;
    }
    const storyBibleId = storyBibleIdForProject(project.id);
    let storyPlanNodes: Awaited<ReturnType<typeof loadActiveStoryPlanNodes>>;
    try {
      storyPlanNodes = await loadActiveStoryPlanNodes(
        project.id,
        storyBibleId,
        project.storyBibleVersion,
      );
    } catch (error) {
      setErrorMessage(formatWorkflowError(error, t, "generation.episodePlansRequired"));
      setBusy(false);
      return;
    }
    const approvedLeafDecision = nextApprovedScriptLeafRange(
      storyPlanNodes,
      project.episodeRoadmaps ?? [],
      [],
      requestedLeafRange,
      project.episodeRoadmapRequired === true,
    );
    if (approvedLeafDecision.status !== "ready") {
      setErrorMessage(approvedLeafDecision.status === "gap"
        ? t("workspace.planningGap").replace(
          "{episode}",
          String(approvedLeafDecision.nextEpisode),
        )
        : t("generation.episodePlansRequired"));
      setBusy(false);
      return;
    }
    const decision = nextLeafBatchRange(
      0,
      project.generationSettings,
      approvedLeafDecision.range,
    );
    if (decision.status !== "ready") {
      setErrorMessage(decision.status === "gap"
        ? t("workspace.planningGap").replace("{episode}", String(decision.nextEpisode))
        : t("workspace.leafComplete"));
      setBusy(false);
      return;
    }
    const batchRange = decision.range;
    const backgroundTask = beginScriptGenerationTask({
      projectId: project.id,
      startEpisode: batchRange.startEpisode,
      endEpisode: batchRange.endEpisode,
    });
    if (!backgroundTask.started) {
      setMessage(t("workflowNavigation.backgroundScript")
        .replace("{start}", String(backgroundTask.task.startEpisode))
        .replace("{end}", String(backgroundTask.task.endEpisode)));
      setBusy(true);
      return;
    }
    let generationFailed = false;
    let generationFailure: unknown;
    const requestedEpisodeCount = batchRange.endEpisode - batchRange.startEpisode + 1;
    const createdAt = new Date().toISOString();
    const generatedEpisodes: EpisodeWorkspace[] = [];
    const overseasCharacterNames = collectProjectOverseasCharacterNames(project);
    let activeStreamingEpisode = batchRange.startEpisode;
    let recoveryTask: GenerationRecoveryTask | undefined;
    const persistRecoveryTask = async (task: GenerationRecoveryTask) => {
      recoveryTask = task;
      updateProject(project.id, { activeGenerationTask: task });
      try {
        const savedTask = await saveGenerationTaskOnServer(project.id, task);
        recoveryTask = savedTask;
        updateProject(project.id, { activeGenerationTask: savedTask });
      } catch {
        recoveryTask = { ...task, serverBacked: false };
        updateProject(project.id, { activeGenerationTask: recoveryTask });
      }
    };
    const pauseAtEpisodeBoundary = async () => {
      if (!isScriptGenerationPauseRequested(project.id)) return;
      if (recoveryTask && recoveryTask.status !== "paused") {
        await persistRecoveryTask(pauseGenerationRecoveryTask(recoveryTask));
      }
      setMessage(t("workspace.generationPaused"));
      const didPause = await waitForScriptGenerationResume(project.id);
      if (didPause && recoveryTask?.status === "paused") {
        await persistRecoveryTask(
          continuePausedGenerationRecoveryTask(recoveryTask),
        );
        setMessage(t("workspace.generationResumed"));
      }
    };
    setStreamBatch(createEpisodeStreamBatch(
      batchRange.startEpisode,
      batchRange.endEpisode,
      targetScriptBodyCharacters(project.generationSettings),
    ));
    updateProject(project.id, { status: "generating" });
    try {
      const [storyBible, episodePlans] = await Promise.all([
        loadStoryBible(project.id, project.storyBibleVersion),
        loadEpisodePlans(
          project.id,
          storyBibleId,
          project.storyBibleVersion,
          batchRange.startEpisode,
          batchRange.endEpisode,
        ),
      ]);
      if (!storyBible || storyBible.status !== "approved") {
        throw new Error(t("generation.planRequired"));
      }
      const generationConstraints = resolveEpisodeGenerationConstraints(
        episodePlans,
        storyPlanNodes,
        batchRange.startEpisode,
        batchRange.endEpisode,
        project.episodeRoadmaps,
        project.episodeRoadmapRequired,
      );
      if (generationConstraints.length !== requestedEpisodeCount) {
        throw new Error(t("generation.episodePlansRequired"));
      }
      const generationRuntime = await prepareEpisodeGenerationRuntime(project);
      const constraintsByNumber = new Map(
        generationConstraints.map((constraint) => [constraint.episodeNumber, constraint]),
      );
      const recoveryCandidate = project.activeGenerationTask
        && project.activeGenerationTask.status !== "completed"
        && project.activeGenerationTask.startEpisode <= batchRange.startEpisode
        && project.activeGenerationTask.endEpisode === batchRange.endEpisode
        ? project.activeGenerationTask
        : undefined;
      recoveryTask = recoveryCandidate
        ? recoveryCandidate.status === "paused"
          ? continuePausedGenerationRecoveryTask(recoveryCandidate)
          : resumeGenerationRecoveryTask(recoveryCandidate)
        : createGenerationRecoveryTask({
            batchNumber: 1,
            startEpisode: batchRange.startEpisode,
            endEpisode: batchRange.endEpisode,
            episodePlanIds: generationConstraints.map((constraint) => (
              constraint.episodePlan?.episode_plan_id
              ?? `episode-plan.runtime.${constraint.episodeNumber}`
            )),
          });
      await persistRecoveryTask(recoveryTask);
      const generateInitialEpisode = async (
        episodeNumber: number,
        continuityEpisodes: EpisodeWorkspace[],
      ): Promise<EpisodeWorkspace> => {
        const latestEpisode = continuityEpisodes.at(-1);
        const previousEpisode = latestEpisode
          ? resolveExportDraft(latestEpisode)
          : undefined;
        const continuity = synchronizeContinuity(
          project.creativePrompt,
          project.characters,
          continuityEpisodes,
          project.storyLines,
          project.characterRelationships,
          project.continuityStates,
        );
        const generatedBodyCharacters = calculateSeriesTextMetrics(
          continuityEpisodes.map(resolveExportDraft),
          project.generationSettings.targetTotalCharacters,
          project.generationSettings.episodeCount,
        ).scriptBodyCharacters;
        const generationConstraint = constraintsByNumber.get(episodeNumber);
        const ledgerPlan = episodeGenerationLedgerPlan(generationConstraint);
        const baselineBodyTarget = targetScriptBodyCharacters(project.generationSettings);
        const adaptiveBodyTarget = targetScriptBodyCharacters(
          project.generationSettings,
          {
            generatedEpisodeCount: continuityEpisodes.length,
            generatedBodyCharacters,
          },
        );
        const bodyTarget = plannedEpisodeBodyReference(
          generationConstraint,
          storySegmentBodyReference(
            generationConstraint,
            adaptiveBodyTarget,
            adaptiveBodyTarget / Math.max(1, baselineBodyTarget),
          ),
        );
        setStreamBatch((currentBatch) => startEpisodeStream(
          currentBatch,
          episodeNumber,
          bodyTarget,
        ));
        const generationRun = await generateSingleEpisode({
          ...project,
          ...continuity,
        }, {
          generationMode: project.generationSettings.mode,
          episodeNumber,
          totalEpisodes: batchRange.totalEpisodes,
          targetScriptBodyCharacters: bodyTarget,
          targetDurationSeconds: plannedEpisodeDurationSeconds(generationConstraint),
          adaptiveSceneCount: adaptiveEpisodeSceneCount(generationConstraint),
          plannedShotCount: plannedEpisodeShotCount(generationConstraint),
          previousEpisode,
          episodeInstruction: episodeGenerationInstruction(
            generationConstraint,
            "",
            { isSeriesFinale: episodeNumber === batchRange.totalEpisodes },
          ),
          relevantCharacterRefs: episodeGenerationCharacterRefs(generationConstraint),
          approvedStoryNode: storyNodeExecutionContext(generationConstraint),
          approvedEpisodePlan: episodeGenerationExecutionPlan(generationConstraint),
          ...ledgerPlan,
          storyBibleContext: storyBibleEpisodeContext(
            storyBible,
            generationConstraint,
          ),
          batch: {
            batchNumber: 1,
            startEpisode: batchRange.startEpisode,
            endEpisode: batchRange.endEpisode,
          },
        }, (event) => setStreamBatch((currentBatch) => applyEpisodeStreamEvent(
          currentBatch,
          episodeNumber,
          event,
        )), generationRuntime);
        setStreamBatch((currentBatch) => completeEpisodeStream(
          currentBatch,
          episodeNumber,
          {
            actualCharacters: calculateDraftTextMetrics(
              generationRun.draft_master_script,
            ).scriptBodyCharacters,
            ...generationPerformanceDetails(generationRun.draft_master_script),
          },
        ));
        const bilingualViews = await buildGeneratedOverseasDialogueView(
          project,
          generationRun,
          overseasCharacterNames,
        );
        const now = new Date().toISOString();
        return {
          id: crypto.randomUUID(),
          episodeNumber,
          status: "framework",
          generationRun,
          ...(bilingualViews ? { bilingualViews } : {}),
          workingDraftJson: JSON.stringify(generationRun.draft_master_script, null, 2),
          hasLocalDraftEdits: false,
          createdAt: now,
          updatedAt: now,
        };
      };
      const episodeNumbers = Array.from(
        { length: requestedEpisodeCount },
        (_, index) => batchRange.startEpisode + index,
      );
      const generateInitialEpisodeWithRetry = (
        episodeNumber: number,
        continuityEpisodes: EpisodeWorkspace[],
      ) => generateWithAutomaticTransientRetry({
        generate: () => generateInitialEpisode(
          episodeNumber,
          continuityEpisodes,
        ),
        onAutomaticRetry: ({ nextAttempt, maxAttempts }) => {
          setStreamBatch((currentBatch) => markEpisodeAutomaticRetry(
            currentBatch,
            episodeNumber,
          ));
          setMessage(t("workspace.stream.autoRetrying")
            .replace("{episode}", String(episodeNumber))
            .replace("{attempt}", String(nextAttempt))
            .replace("{max}", String(maxAttempts)));
        },
      });
      const generationWindows = buildEpisodeGenerationWindows(episodeNumbers);
      for (const windowEpisodeNumbers of generationWindows) {
        await pauseAtEpisodeBoundary();
        activeStreamingEpisode = windowEpisodeNumbers[0];
        setMessage(
          t("generation.progress")
            .replace(
              "{current}",
              String(windowEpisodeNumbers[0] - batchRange.startEpisode + 1),
            )
            .replace("{total}", String(requestedEpisodeCount)),
        );
        const continuityEpisodes = [...generatedEpisodes];
        const windowResults = await Promise.allSettled(
          windowEpisodeNumbers.map((episodeNumber) => generateInitialEpisodeWithRetry(
            episodeNumber,
            continuityEpisodes,
          )),
        );
        let firstFailure: { episodeNumber: number; reason: unknown } | undefined;
        for (let index = 0; index < windowResults.length; index += 1) {
          const episodeNumber = windowEpisodeNumbers[index];
          const result = windowResults[index];
          if (result.status === "rejected") {
            const errorText = userFacingError(result.reason, t("generation.failed"));
            setStreamBatch((currentBatch) => failEpisodeStream(
              currentBatch,
              episodeNumber,
              errorText,
            ));
            firstFailure ??= { episodeNumber, reason: result.reason };
            continue;
          }
          if (firstFailure) {
            setStreamBatch((currentBatch) => failEpisodeStream(
              currentBatch,
              episodeNumber,
              "上一集生成失败，本集结果未保存，请从失败集继续生成。",
            ));
            continue;
          }
          generatedEpisodes.push(result.value);
          generatedEpisodes.sort((left, right) => left.episodeNumber - right.episodeNumber);
          await commitEpisodes(generatedEpisodes, {
            id: `batch-${project.id}-1`,
            batchNumber: 1,
            startEpisode: batchRange.startEpisode,
            endEpisode: batchRange.endEpisode,
            requestedEpisodeCount,
            generatedEpisodeCount: generatedEpisodes.length,
            status: "partial",
            createdAt,
          }, true);
          if (recoveryTask) {
            await persistRecoveryTask(
              completeRecoveryEpisode(recoveryTask, episodeNumber),
            );
          }
        }
        if (firstFailure) {
          activeStreamingEpisode = firstFailure.episodeNumber;
          throw firstFailure.reason;
        }
      }
      if (recoveryTask) {
        await persistRecoveryTask(finishGenerationRecoveryTask(recoveryTask));
      }
      await commitEpisodes(generatedEpisodes, {
        id: `batch-${project.id}-1`,
        batchNumber: 1,
        startEpisode: batchRange.startEpisode,
        endEpisode: batchRange.endEpisode,
        requestedEpisodeCount,
        generatedEpisodeCount: generatedEpisodes.length,
        status: "completed",
        createdAt,
        completedAt: new Date().toISOString(),
      });
      updateProject(project.id, { activeGenerationTask: undefined });
      onClearIntent();
    } catch (error) {
      generationFailed = true;
      generationFailure = error;
      const errorText = userFacingError(error, t("generation.failed"));
      if (recoveryTask) {
        await persistRecoveryTask(
          failGenerationRecoveryTask(
            recoveryTask,
            activeStreamingEpisode,
            errorText,
          ),
        );
      }
      setStreamBatch((currentBatch) => failEpisodeStream(
        currentBatch,
        activeStreamingEpisode,
        errorText,
      ));
      if (generatedEpisodes.length) {
        await commitEpisodes(generatedEpisodes, {
          id: `batch-${project.id}-1`,
          batchNumber: 1,
          startEpisode: batchRange.startEpisode,
          endEpisode: batchRange.endEpisode,
          requestedEpisodeCount,
          generatedEpisodeCount: generatedEpisodes.length,
          status: "partial",
          createdAt,
        });
        onClearIntent();
      } else {
        updateProject(project.id, { status: "idea" });
        setErrorMessage(errorText);
      }
    } finally {
      if (generationFailed) {
        failScriptGenerationTask(project.id, generationFailure);
      } else {
        completeScriptGenerationTask(project.id);
      }
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    onConsumeIntent();
    void generateInitialBatch();
  }, []);

  const decision = nextLeafBatchRange(0, project.generationSettings, requestedLeafRange);
  const visibleRange = decision.status === "ready"
    ? decision.range
    : {
        startEpisode: requestedLeafRange.startEpisode,
        endEpisode: requestedLeafRange.endEpisode,
      };

  return (
    <main className="script-workspace page-reveal">
      <header className="workspace-header">
        <div>
          <span className="section-kicker">{t("planningWorkspace.script")}</span>
          <div className="section-title-with-help">
            <h1>{project.title}</h1>
            <SectionHelp content={t("guide.scriptWorkspace")} label={t("guide.openHelp")} />
          </div>
          <p>{t("workspace.generatingPlannedBatchHelp")}</p>
        </div>
        <Link className="outline-action" href={`/projects/${project.id}/planning`}>
          {t("workspace.backToPlanning")}
        </Link>
      </header>
      <WorkflowNavigation
        active="script"
        generatedEpisodes={project.episodes.length}
        plannedThrough={project.episodePlansReadyThrough ?? 0}
        projectId={project.id}
        scriptStarted
        totalEpisodes={project.generationSettings.episodeCount}
      />
      <section className="direct-generation-status" aria-live="polite">
        {busy ? <div className="loading-mark" /> : null}
        <div>
          <span className="section-kicker">{t("workspace.kicker")}</span>
          <div className="section-title-with-help">
            <h2>{t("workspace.generatingPlannedBatch")
              .replace("{start}", String(visibleRange.startEpisode))
              .replace("{end}", String(visibleRange.endEpisode))}</h2>
            <SectionHelp content={t("guide.generationProgress")} label={t("guide.openHelp")} />
          </div>
          <p>{errorMessage ?? message}</p>
        </div>
      </section>
      {streamBatch.length ? (
        <EpisodeGenerationProgress
          batch={streamBatch}
          onRetryEpisode={() => void generateInitialBatch()}
          retryDisabled={busy}
          t={t}
        />
      ) : null}
    </main>
  );
}

function EpisodeDraftEditor({ draft, onChange, onSave, onConfirm, onCancel, t }: {
  draft: GeneratedDraft;
  onChange: (draft: GeneratedDraft) => void;
  onSave: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  function updateTopLevel(field: keyof GeneratedDraft, value: string) {
    onChange({ ...draft, [field]: value });
  }

  function updateScene(index: number, patch: Partial<GeneratedScene>) {
    onChange({
      ...draft,
      scenes: draft.scenes.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, ...patch } : scene),
    });
  }

  return (
    <section className="structured-episode-editor">
      <div className="structured-editor-grid">
        <label><span>{t("workspace.field.logline")}</span><textarea onChange={(event) => updateTopLevel("logline", event.target.value)} rows={2} value={draft.logline} /></label>
        <label><span>{t("workspace.hook")}</span><textarea onChange={(event) => updateTopLevel("hook", event.target.value)} rows={2} value={draft.hook} /></label>
        <label><span>{t("workspace.synopsis")}</span><textarea onChange={(event) => updateTopLevel("synopsis", event.target.value)} rows={3} value={draft.synopsis} /></label>
        <label><span>{t("workspace.field.episodeGoal")}</span><textarea onChange={(event) => updateTopLevel("episode_goal", event.target.value)} rows={2} value={draft.episode_goal ?? ""} /></label>
        <label><span>{t("workspace.nextQuestion")}</span><textarea onChange={(event) => updateTopLevel("next_episode_question", event.target.value)} rows={2} value={draft.next_episode_question ?? ""} /></label>
      </div>
      {draft.scenes.map((scene, index) => (
        <div className="structured-scene-editor" key={scene.scene_number}>
          <div className="structured-scene-heading"><span>{String(scene.scene_number).padStart(2, "0")}</span><strong>{t("workspace.scene")}</strong></div>
          <label><span>{t("workspace.field.sceneTitle")}</span><input onChange={(event) => updateScene(index, { slug: event.target.value })} value={scene.slug} /></label>
          <label><span>{t("workspace.field.purpose")}</span><textarea onChange={(event) => updateScene(index, { purpose: event.target.value })} rows={2} value={scene.purpose} /></label>
          <label><span>{t("workspace.field.beat")}</span><textarea onChange={(event) => updateScene(index, { beat_summary: event.target.value })} rows={3} value={scene.beat_summary} /></label>
          <label><span>{t("workspace.field.actions")}</span><textarea onChange={(event) => updateScene(index, { character_actions: splitLines(event.target.value) })} rows={4} value={scene.character_actions.join("\n")} /></label>
          <div className="structured-dialogue-editor">
            <span>{t("workspace.field.dialogue")}</span>
            {scene.dialogues.map((line, dialogueIndex) => (
              <div key={`${scene.scene_number}-${dialogueIndex}`}>
                <input aria-label={t("workspace.field.character")} onChange={(event) => updateScene(index, { dialogues: scene.dialogues.map((item, itemIndex) => itemIndex === dialogueIndex ? { ...item, character_name: event.target.value } : item) })} value={line.character_name} />
                <input aria-label={t("workspace.field.intent")} onChange={(event) => updateScene(index, { dialogues: scene.dialogues.map((item, itemIndex) => itemIndex === dialogueIndex ? { ...item, intent: event.target.value } : item) })} value={line.intent} />
                <textarea aria-label={t("workspace.field.dialogue")} onChange={(event) => updateScene(index, { dialogues: scene.dialogues.map((item, itemIndex) => itemIndex === dialogueIndex ? { ...item, text: event.target.value } : item) })} rows={2} value={line.text} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="structured-editor-actions"><button className="text-action" onClick={onCancel} type="button">{t("tags.cancelCustom")}</button><button className="outline-action" onClick={onSave} type="button">{t("workspace.saveEdit")}</button><button className="primary-action" onClick={onConfirm} type="button">{t("workspace.saveAndConfirm")}</button></div>
    </section>
  );
}

function ScriptDocumentWithTranslation({
  draft,
  generationStrategyId,
  locale,
  cachedView,
  characterNameMap,
  onView,
  releaseRegion,
  t,
}: {
  draft: GeneratedDraft;
  generationStrategyId: string;
  locale: "en" | "zh";
  cachedView?: BilingualScriptView;
  characterNameMap: Record<string, string>;
  onView: (view: BilingualScriptView) => void;
  releaseRegion: ReleaseRegion;
  t: (key: string) => string;
}) {
  const [attemptedTranslationKey, setAttemptedTranslationKey] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState(false);
  const legacyChineseView = locale === "zh"
    && draft.language.toLocaleLowerCase().startsWith("en");
  const overseasDialogueView = releaseRegion === "overseas"
    && !draft.language.toLocaleLowerCase().startsWith("en");
  const shouldTranslate = legacyChineseView || overseasDialogueView;
  const translationOnly = legacyChineseView;
  const targetLanguage = overseasDialogueView ? "en-US-short-drama" : "zh-CN";
  const translationRequestKey = `${draft.id}:${targetLanguage}:${JSON.stringify(
    draft.scenes.flatMap((scene) => scene.dialogues.map((dialogue) => [
      dialogue.character_name,
      dialogue.text,
    ])),
  )}:${JSON.stringify(characterNameMap)}`;
  const activeView = shouldTranslate
    && cachedView?.target_language?.toLocaleLowerCase().startsWith(
      overseasDialogueView ? "en-us" : "zh",
    )
    && (!overseasDialogueView || overseasDialogueViewMatchesDraft(
      cachedView,
      draft,
      characterNameMap,
    ))
    ? cachedView
    : undefined;

  useEffect(() => {
    if (
      !shouldTranslate
      || activeView
      || attemptedTranslationKey === translationRequestKey
    ) return;
    setAttemptedTranslationKey(translationRequestKey);
    setTranslationError(false);
    void buildBilingualScriptView(
      generationStrategyId,
      draft,
      targetLanguage,
      characterNameMap,
    )
      .then(onView)
      .catch(() => setTranslationError(true));
  }, [
    attemptedTranslationKey,
    activeView,
    draft,
    generationStrategyId,
    characterNameMap,
    onView,
    shouldTranslate,
    targetLanguage,
    translationRequestKey,
  ]);

  const translations = activeView
    ? new Map(activeView.items.map((item) => [item.path, item.translated_text]))
    : undefined;

  return (
    <>
      {shouldTranslate && !activeView && !translationError
        ? <div className="inline-notice">{t("workspace.translationLoading")}</div>
        : null}
      {translationError ? (
        <div className="inline-notice">
          {t("workspace.translationFailed")}
          <button
            className="text-action"
            onClick={() => {
              setTranslationError(false);
              setAttemptedTranslationKey(null);
            }}
            type="button"
          >
            {t("workspace.translationRetry")}
          </button>
        </div>
      ) : null}
      {!translationOnly || activeView ? (
        <ScriptDocument
          characterNameMap={new Map(Object.entries(characterNameMap))}
          draft={draft}
          overseasDialogueView={overseasDialogueView}
          t={t}
          translationOnly={translationOnly}
          translations={translations}
        />
      ) : null}
    </>
  );
}

function overseasDialogueViewMatchesDraft(
  view: BilingualScriptView,
  draft: GeneratedDraft,
  characterNameMap: Record<string, string>,
): boolean {
  if (view.view_version !== "bilingual_script_view.v2") return false;
  const sourceByPath = new Map(view.items.map((item) => [item.path, item.source_text]));
  const translatedByPath = new Map(view.items.map((item) => [item.path, item.translated_text]));
  return draft.scenes.every((scene, sceneIndex) => scene.dialogues.every(
    (dialogue, dialogueIndex) => {
      const prefix = `scenes.${sceneIndex}.dialogues.${dialogueIndex}`;
      const characterPath = `${prefix}.character_name`;
      const sourceName = clientDialogueSpeaker(
        dialogue.character_name,
        dialogue.character_name,
      ).speaker;
      const expectedEnglishName = characterNameMap[sourceName];
      const translatedName = clientDialogueSpeaker(
        translatedByPath.get(characterPath) ?? "",
        dialogue.character_name,
      ).speaker.toLocaleUpperCase();
      return sourceByPath.get(characterPath) === dialogue.character_name.trim()
        && sourceByPath.get(`${prefix}.text`) === dialogue.text.trim()
        && (!expectedEnglishName
          || translatedName === expectedEnglishName.toLocaleUpperCase());
    },
  ));
}

function ScriptDocument({
  characterNameMap,
  draft,
  t,
  translations,
  translationOnly = false,
  overseasDialogueView = false,
}: {
  characterNameMap: ReadonlyMap<string, string>;
  draft: GeneratedDraft;
  t: (key: string) => string;
  translations?: Map<string, string>;
  translationOnly?: boolean;
  overseasDialogueView?: boolean;
}) {
  return (
    <article className="script-document">
      <details className="script-production-notes">
        <summary>{t("workspace.productionNotes")}</summary>
        <div className="script-notes-help"><SectionHelp content={t("guide.productionNotes")} label={t("guide.openHelp")} /></div>
        <section className="script-overview">
          <strong>{t("workspace.hook")}</strong>
          <p><ScriptText path="hook" source={draft.hook} t={t} translationOnly={translationOnly} translations={translations} /></p>
          <strong>{t("workspace.synopsis")}</strong>
          <p><ScriptText path="synopsis" source={draft.synopsis} t={t} translationOnly={translationOnly} translations={translations} /></p>
          <strong>{t("workspace.nextQuestion")}</strong>
          <p><ScriptText path="next_episode_question" source={draft.next_episode_question ?? ""} t={t} translationOnly={translationOnly} translations={translations} /></p>
        </section>
      </details>
      {draft.scenes.map((scene, sceneIndex) => (
        <section className="script-scene" key={scene.scene_number}>
          <span>{String(scene.scene_number).padStart(2, "0")}</span>
          <div>
            <h2>{scene.setting_hint
              ? <ScriptText path={`scenes.${sceneIndex}.setting_hint`} source={scene.setting_hint} t={t} translationOnly={translationOnly} translations={translations} />
              : <ScriptText path={`scenes.${sceneIndex}.slug`} source={scene.slug} t={t} translationOnly={translationOnly} translations={translations} />}</h2>
            {scene.setting_hint ? <p className="scene-setting"><ScriptText path={`scenes.${sceneIndex}.slug`} source={scene.slug} t={t} translationOnly={translationOnly} translations={translations} /></p> : null}
            <details className="scene-planning-notes">
              <summary>{t("workspace.productionNotes")}</summary>
              <div className="script-notes-help"><SectionHelp content={t("guide.productionNotes")} label={t("guide.openHelp")} /></div>
              <p className="scene-purpose"><ScriptText path={`scenes.${sceneIndex}.purpose`} source={scene.purpose} t={t} translationOnly={translationOnly} translations={translations} /></p>
              <p><ScriptText path={`scenes.${sceneIndex}.beat_summary`} source={scene.beat_summary} t={t} translationOnly={translationOnly} translations={translations} /></p>
              {scene.scene_causality ? (
                <dl className="scene-causality">
                  <div><dt>{t("workspace.goal")}</dt><dd><ScriptText path={`scenes.${sceneIndex}.scene_causality.goal`} source={scene.scene_causality.goal} t={t} translationOnly={translationOnly} translations={translations} /></dd></div>
                  <div><dt>{t("workspace.conflict")}</dt><dd><ScriptText path={`scenes.${sceneIndex}.scene_causality.conflict`} source={scene.scene_causality.conflict} t={t} translationOnly={translationOnly} translations={translations} /></dd></div>
                  <div><dt>{t("workspace.outcome")}</dt><dd><ScriptText path={`scenes.${sceneIndex}.scene_causality.outcome`} source={scene.scene_causality.outcome} t={t} translationOnly={translationOnly} translations={translations} /></dd></div>
                  {scene.scene_causality.causal_link ? <div><dt>{t("workspace.causalLink")}</dt><dd><ScriptText path={`scenes.${sceneIndex}.scene_causality.causal_link`} source={scene.scene_causality.causal_link} t={t} translationOnly={translationOnly} translations={translations} /></dd></div> : null}
                </dl>
              ) : null}
            </details>
            <div className="scene-actions">{scene.character_actions.map((action, actionIndex) => <p key={`${action}-${actionIndex}`}><span aria-hidden="true">△</span><ScriptText path={`scenes.${sceneIndex}.character_actions.${actionIndex}`} source={overseasDialogueView ? applyOverseasCharacterNames(action, characterNameMap) : action} t={t} translationOnly={translationOnly} translations={translations} /></p>)}</div>
            <div className="scene-dialogues">{scene.dialogues.map((dialogue, dialogueIndex) => {
              const prefix = `scenes.${sceneIndex}.dialogues.${dialogueIndex}`;
              const polishedSpeaker = translations?.get(`${prefix}.character_name`);
              const displaySpeaker = clientDialogueSpeaker(
                polishedSpeaker ?? dialogue.character_name,
                dialogue.character_name,
              );
              return (
                <blockquote key={`${dialogue.character_name}-${dialogueIndex}`}>
                  <strong>{`${displaySpeaker.speaker}${displaySpeaker.marker ? ` (${displaySpeaker.marker})` : ""}`}</strong>
                  <small><ScriptText path={`${prefix}.intent`} source={dialogue.intent} t={t} translationOnly={translationOnly} translations={translations} /></small>
                  <p>{overseasDialogueView
                    ? <OverseasDialogue source={dialogue.text} translated={translations?.get(`${prefix}.text`)} t={t} />
                    : <ScriptText path={`${prefix}.text`} source={dialogue.text} t={t} translationOnly={translationOnly} translations={translations} />}</p>
                </blockquote>
              );
            })}</div>
          </div>
        </section>
      ))}
    </article>
  );
}

function OverseasDialogue({
  source,
  translated,
  t,
}: {
  source: string;
  translated?: string;
  t: (key: string) => string;
}) {
  if (!translated) return <>{source}</>;
  return (
    <>
      {translated}
      <span className="bilingual-translation">
        <small>{t("workspace.translationLabel")}</small>
        {source}
      </span>
    </>
  );
}

function ScriptText({
  path,
  source,
  translations,
  translationOnly,
  t,
}: {
  path: string;
  source: string;
  translations?: Map<string, string>;
  translationOnly: boolean;
  t: (key: string) => string;
}) {
  const translated = translations?.get(path);
  if (translationOnly) return translated ?? source;
  return <>{source}<Translation path={path} t={t} translations={translations} /></>;
}

function Translation({
  path,
  translations,
  t,
}: {
  path: string;
  translations?: Map<string, string>;
  t: (key: string) => string;
}) {
  const text = translations?.get(path);
  if (!text) return null;
  return (
    <span className="bilingual-translation">
      <small>{t("workspace.translationLabel")}</small>
      {text}
    </span>
  );
}

function resolveExportDraft(episode: EpisodeWorkspace): GeneratedDraft {
  return episode.finalizationResult?.master_script
    ?? parseWorkingDraft(episode.confirmedDraftJson)
    ?? parseWorkingDraft(episode.workingDraftJson)
    ?? episode.generationRun.draft_master_script;
}

async function buildGeneratedOverseasDialogueView(
  project: ScriptProject,
  generationRun: ScriptGenerationRun,
  characterNameMap: Map<string, string>,
): Promise<Record<string, BilingualScriptView> | undefined> {
  const draft = generationRun.draft_master_script;
  if (
    project.generationSettings.releaseRegion !== "overseas"
    || draft.language.toLocaleLowerCase().startsWith("en")
  ) return undefined;
  try {
    const view = await buildBilingualScriptView(
      generationRun.generation_strategy_id,
      draft,
      "en-US-short-drama",
      Object.fromEntries(characterNameMap),
    );
    mergeOverseasCharacterNames(characterNameMap, view);
    return { [draft.id]: view };
  } catch {
    // The canonical Chinese script is already valid. The workspace retries only
    // the presentation-layer dialogue view without rerunning the episode.
    return undefined;
  }
}

function collectProjectOverseasCharacterNames(
  project: Pick<ScriptProject, "episodes">,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const episode of [...project.episodes].sort(
    (left, right) => left.episodeNumber - right.episodeNumber,
  )) {
    for (const view of Object.values(episode.bilingualViews ?? {})) {
      mergeOverseasCharacterNames(names, view);
    }
  }
  return names;
}

function mergeEpisodesByNumber(
  existingEpisodes: EpisodeWorkspace[],
  generatedEpisodes: EpisodeWorkspace[],
): EpisodeWorkspace[] {
  const episodes = new Map<number, EpisodeWorkspace>();
  for (const episode of existingEpisodes) episodes.set(episode.episodeNumber, episode);
  for (const episode of generatedEpisodes) episodes.set(episode.episodeNumber, episode);
  return [...episodes.values()].sort(
    (left, right) => left.episodeNumber - right.episodeNumber,
  );
}

function scriptBodyTargetCharacters(draft: GeneratedDraft): number | null {
  const metadata = draft.llm_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const values = metadata as Record<string, unknown>;
  const target = values.script_body_reference_characters
    ?? values.script_body_target_characters;
  return typeof target === "number" && Number.isFinite(target) && target > 0
    ? Math.round(target)
    : null;
}

function generationPerformanceDetails(draft: GeneratedDraft): {
  modelPassCount?: number;
  generationElapsedMs?: number;
  firstPassAccepted?: boolean;
} {
  const metadata = draft.llm_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const values = metadata as Record<string, unknown>;
  return {
    ...(typeof values.model_pass_count === "number"
      ? { modelPassCount: values.model_pass_count }
      : {}),
    ...(typeof values.generation_elapsed_ms === "number"
      ? { generationElapsedMs: values.generation_elapsed_ms }
      : {}),
    ...(typeof values.first_pass_accepted === "boolean"
      ? { firstPassAccepted: values.first_pass_accepted }
      : {}),
  };
}

function parseWorkingDraft(value?: string): GeneratedDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<GeneratedDraft>;
    if (typeof parsed.title !== "string" || !Array.isArray(parsed.scenes) || parsed.scenes.some((scene) => !Array.isArray(scene.character_actions) || !Array.isArray(scene.dialogues))) return null;
    return parsed as GeneratedDraft;
  } catch {
    return null;
  }
}

function formatWorkflowError(
  error: unknown,
  t: (key: string) => string,
  fallbackKey: string,
): string {
  return userFacingError(error, t(fallbackKey));
}

function splitLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-") || "script-project";
}

function downloadFile(content: string, filename: string, type: string) {
  downloadBlob(new Blob([content], { type }), filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function seriesExportPreface(
  format: EpisodeDocumentFormat,
  metrics: ReturnType<typeof calculateSeriesTextMetrics>,
  formatter: Intl.NumberFormat,
): string {
  const lines = [
    `已生成：${formatter.format(metrics.generatedEpisodes)} / ${formatter.format(metrics.plannedEpisodes)} 集`,
    `动作与对白正文：${formatter.format(metrics.scriptBodyCharacters)}`,
    `整体参考规模：约 ${formatter.format(metrics.targetCharacters)} 字`,
    `分集辅助文本（不计入正文）：${formatter.format(metrics.totalCharacters)}`,
    `当前正文集均：${formatter.format(metrics.averageCharactersPerEpisode)}`,
    `参考集均：约 ${formatter.format(metrics.requiredAverageCharactersPerEpisode)} 字`,
    "统计口径：整体字数只用于判断长篇量级，不要求精确命中；每集以剧情表达完整为结束条件",
  ];
  return format === "markdown"
    ? `## 长篇字数统计\n\n${lines.map((line) => `- ${line}`).join("\n")}`
    : `长篇字数统计\n\n${lines.join("\n")}`;
}
