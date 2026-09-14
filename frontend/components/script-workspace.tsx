"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Check,
  ChevronDown,
  Download,
  History,
  LoaderCircle,
  Pause,
  Play,
  ShieldCheck,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type SyntheticEvent,
} from "react";

import { CloseIcon } from "@/components/icons";
import { AuthorConflictDialog } from "@/components/author-conflict-dialog";
import { useScriptAuthorWorkflow } from "@/components/use-script-author-workflow";
import type { DocumentOutlineEntry } from "@/components/document-outline";
import { EpisodeQualityReviewPanel } from "@/components/episode-quality-review-panel";
import { WorkspaceSectionDirectory } from "@/components/workspace-section-directory";
import { useScriptGenerationRecovery } from "@/components/use-script-generation-recovery";
import { ScriptDraftSaveError, useScriptDraftEditing } from "@/components/use-script-draft-editing";
import {
  PlanningCanvasCopilot,
  type PlanningCanvasAction,
} from "@/components/planning-canvas-copilot";
import { SelectionEditToolbar } from "@/components/selection-edit-toolbar";
import { SectionHelp } from "@/components/section-help";
import { workspaceSectionAccess } from "@/lib/workspace-stage";
import {
  applyChineseCharacterNames,
  mergeOverseasCharacterNames,
  overseasDialogueSpeaker,
} from "@/lib/bilingual-dialogue";
import { clientDialogueSpeaker } from "@/lib/client-screenplay-format";
import { ProjectContinuityPanel } from "@/components/project-continuity-panel";
import {
  buildEmbeddedOverseasDialogueView,
  deepenEpisodeDraft,
  generateSingleEpisode,
  prepareEpisodeGenerationRuntime,
  reviewEpisodeDraft,
} from "@/lib/generation-client";
import {
  episodeHasSavedDraft, episodeIsLocked, normalizeEpisodeLifecycle,
  parseWorkingDraft, resolveSavedDraft, resolveWorkingDraft, type ScriptDraftUpdater,
} from "@/lib/script-draft-state";
import { safeFilename } from "@/lib/filename";
import { draftMetadataBoolean, draftMetadataNumber } from "@/lib/draft-metadata";
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
  resumeGenerationRecoveryTask,
} from "@/lib/generation-recovery";
import { createScriptGenerationSession, GenerationSessionError } from "@/lib/script-generation-session";
import { createGenerationResultCommitter } from "@/lib/generation-result-committer";
import {
  beginScriptGenerationTask,
  completeScriptGenerationTask,
  failScriptGenerationTask,
  isScriptGenerationRunning,
  requestScriptGenerationPause,
  resumeScriptGenerationTask,
  updateScriptGenerationProgress,
  useScriptGenerationTask,
  type ScriptGenerationTaskSnapshot,
} from "@/lib/script-generation-background";
import {
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
  isApprovedEpisodeRoadmap,
  storyBibleEpisodeContext,
  storyNodeExecutionContext,
  storySegmentBodyReference,
} from "@/lib/episode-generation-planning";
import {
  collectionDocumentFilename,
  createCollectionArchive,
  createEpisodeArchive,
  seriesArchiveFilename,
  toSeriesDocument,
  type EpisodeDocumentFormat,
} from "@/lib/episode-export";
import { buildProductionIndex } from "@/lib/production-index";
import { createProductionWorkbookAttachments } from "@/lib/production-workbooks";
import { createScreenplayDocxBlob } from "@/lib/episode-docx";
import {
  buildSeriesDeliveryConfirmation,
  isSeriesDeliveryConfirmationCurrent,
} from "@/lib/episode-delivery-confirmation";
import { deliverSeriesToHost, hostDeliveryConfigured } from "@/lib/host-delivery";
import { orderedScreenplayBody } from "@/lib/screenplay-body-order";
import {
} from "@/lib/project-sync";
import {
  loadEpisodePlans,
  loadStoryBible,
  loadActiveStoryPlanNodes,
  storyBibleIdForProject,
} from "@/lib/story-planning-client";
import { userFacingError } from "@/lib/api-error";
import type {
  EpisodeWorkspace,
  GeneratedDraft,
  GenerationRecoveryTask,
  ScriptProject,
} from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";
import { canonicalCharacterNameMap } from "@/lib/canonical-character-names";

type WorkspaceDocumentView = "current" | "modification" | "deepening" | "revised" | "final";
type SeriesExportMode = "episodes" | "collection";

function isPlannedEpisodeNumber(episodeNumber: number, episodeCount: number): boolean {
  return Number.isSafeInteger(episodeNumber)
    && episodeNumber >= 1
    && Number.isSafeInteger(episodeCount)
    && episodeCount > 0
    && episodeNumber <= episodeCount;
}

function plannedEpisodesForProject(
  project: Pick<ScriptProject, "episodes" | "generationSettings">,
): EpisodeWorkspace[] {
  return project.episodes.filter((episode) => isPlannedEpisodeNumber(
    episode.episodeNumber,
    project.generationSettings.episodeCount,
  ));
}

const CREATIVE_DEEPENING_ENABLED = (
  process.env.NEXT_PUBLIC_CREATIVE_DEEPENING_ENABLED === "true"
);

const SCRIPT_QUICK_ACTIONS: Array<{ id: PlanningCanvasAction; label: string; instruction: string }> = [
  { id: "continue", label: "续写", instruction: "请承接当前正文继续写下去，保持人物状态、场景逻辑和上一集交接一致。" },
  { id: "polish", label: "润色", instruction: "请润色当前正文，保留剧情事实，只优化表达、节奏和对白自然度。" },
  { id: "rewrite", label: "改写", instruction: "请根据当前正文和上下文重写需要调整的部分，确保前后场次衔接一致。" },
  { id: "expand", label: "扩写", instruction: "请补足当前正文的必要动作、情绪和场面细节，不改变既定剧情走向。" },
  { id: "shorten", label: "精简", instruction: "请压缩当前正文的重复表达，保留全部关键行动、信息和对白。" },
];

const AUTHOR_INTENT_WORKFLOW_RULE = "工作流最高原则：用户明确表达的意志、选择、修改和否决永远优先于系统建议、模板和模型推断；未明确决定的内容保持待定，不得擅自补写或替用户做决定。";

function withAuthorIntentWorkflowRule(instruction?: string): string {
  const prefix = AUTHOR_INTENT_WORKFLOW_RULE;
  const value = instruction?.trim() ?? "";
  if (!value) return prefix;
  const remaining = Math.max(0, 4000 - prefix.length - 1);
  return `${prefix}；${value.slice(0, remaining)}`;
}

type ScriptWorkspaceTranslator = (key: string) => string;

function normalizedEpisodeTitle(title: string | null | undefined, episodeNumber: number): string {
  const value = title?.trim() ?? "";
  if (!value) return "";
  return value
    .replace(new RegExp(`^第\\s*${episodeNumber}\\s*集(?:\\s*[·:：—-]\\s*)?`), "")
    .trim();
}

function projectEpisodeTitle(project: ScriptProject, episodeNumber: number): string {
  const roadmapTitle = project.episodeRoadmaps?.find((item) => (
    item.episode_number === episodeNumber
    && isApprovedEpisodeRoadmap(item)
  ))?.episode_title;
  const normalizedRoadmapTitle = normalizedEpisodeTitle(roadmapTitle, episodeNumber);
  if (normalizedRoadmapTitle) return normalizedRoadmapTitle;
  const episode = project.episodes.find((item) => item.episodeNumber === episodeNumber);
  const draftTitle = episode ? parseWorkingDraft(episode.workingDraftJson)?.title : undefined;
  return normalizedEpisodeTitle(draftTitle, episodeNumber);
}

function updateDraftScene(
  draft: GeneratedDraft,
  sceneIndex: number,
  update: (scene: GeneratedDraft["scenes"][number]) => GeneratedDraft["scenes"][number],
): GeneratedDraft {
  return {
    ...draft,
    scenes: draft.scenes.map((scene, index) => index === sceneIndex ? update(scene) : scene),
  };
}

function updateDraftDialogue(
  draft: GeneratedDraft,
  sceneIndex: number,
  dialogueIndex: number,
  update: (
    dialogue: GeneratedDraft["scenes"][number]["dialogues"][number],
  ) => GeneratedDraft["scenes"][number]["dialogues"][number],
): GeneratedDraft {
  return updateDraftScene(draft, sceneIndex, (scene) => ({
    ...scene,
    dialogues: scene.dialogues.map((dialogue, index) => (
      index === dialogueIndex ? update(dialogue) : dialogue
    )),
  }));
}

function updateDialogueSpeakerFromDisplay(
  dialogue: GeneratedDraft["scenes"][number]["dialogues"][number],
  displayValue: string,
  overseasDialogueView: boolean,
): GeneratedDraft["scenes"][number]["dialogues"][number] {
  const parsed = clientDialogueSpeaker(displayValue, displayValue);
  const withMarker = (name: string) => parsed.marker ? `${name} (${parsed.marker})` : name;
  if (!overseasDialogueView) {
    return { ...dialogue, character_name: withMarker(parsed.speaker) };
  }
  const bilingualName = parsed.speaker.match(/^(.+?)[（(]\s*([A-Za-z][A-Za-z0-9 ._'-]*)\s*[）)]$/);
  if (bilingualName) {
    return {
      ...dialogue,
      character_name: withMarker(bilingualName[2].trim()),
      chinese_character_name: bilingualName[1].trim(),
    };
  }
  if (/[\u3400-\u9fff]/.test(parsed.speaker)) {
    return { ...dialogue, chinese_character_name: parsed.speaker };
  }
  return { ...dialogue, character_name: withMarker(parsed.speaker) };
}

function episodeDirectoryLabel(
  project: ScriptProject,
  episodeNumber: number,
  t: ScriptWorkspaceTranslator,
): string {
  const numberLabel = t("workspace.episodeLabel").replace("{number}", String(episodeNumber));
  const title = projectEpisodeTitle(project, episodeNumber);
  return title ? `${numberLabel} · ${title}` : numberLabel;
}

function creatorGenerationStage(
  item: EpisodeStreamProgress,
  t: ScriptWorkspaceTranslator,
): string {
  if (item.status === "failed") return t("workspace.stream.creatorStage.failed");
  if (item.status === "completed") return t("workspace.stream.creatorStage.completed");
  if (item.status === "queued") return t("workspace.stream.creatorStage.queued");
  if (item.stage === "preparing") return t("workspace.stream.creatorStage.preparing");
  if (item.stage === "generating" || item.stage === "retrying_generation") {
    return t("workspace.stream.creatorStage.writing");
  }
  return t("workspace.stream.creatorStage.reviewing");
}

function buildScriptDirectoryEntries(
  project: ScriptProject,
  batch: EpisodeStreamProgress[],
  t: ScriptWorkspaceTranslator,
): DocumentOutlineEntry[] {
  const visibleBatch = compactGenerationDirectoryBatch(project, batch);
  const batchByEpisode = new Map(visibleBatch.map((item) => [item.episodeNumber, item]));
  const generatedByEpisode = new Map(project.episodes.map((item) => [item.episodeNumber, item]));
  const episodeNumbers = [...new Set([
    ...project.episodes.map((item) => item.episodeNumber),
    ...visibleBatch.map((item) => item.episodeNumber),
  ])].sort((left, right) => left - right);
  const entries: DocumentOutlineEntry[] = [];
  for (const episodeNumber of episodeNumbers) {
    const streamed = batchByEpisode.get(episodeNumber);
    const generated = generatedByEpisode.get(episodeNumber);
    const normalizedGenerated = generated ? normalizeEpisodeLifecycle(generated) : undefined;
    const status = streamed?.status ?? (generated ? "completed" : "queued");
    const statusLabel = streamed
      ? creatorGenerationStage(streamed, t)
      : normalizedGenerated
        ? t(`episodeStatus.${normalizedGenerated.status}`)
        : t("workspace.stream.creatorStage.queued");
    entries.push({
      id: `script-episode-${episodeNumber}`,
      label: episodeDirectoryLabel(project, episodeNumber, t),
      meta: statusLabel,
      status,
      statusLabel,
      disabled: !generated && !streamed,
    });
  }
  return entries;
}

function preferredStreamItem(
  batch: EpisodeStreamProgress[],
  episodeNumber?: number,
): EpisodeStreamProgress | undefined {
  return batch.find((item) => item.episodeNumber === episodeNumber)
    ?? batch.find((item) => item.status === "active")
    ?? batch.find((item) => item.status === "failed")
    ?? batch.find((item) => item.status === "queued")
    ?? batch.at(-1);
}

function compactGenerationDetailBatch(
  batch: EpisodeStreamProgress[],
  limit = 4,
): EpisodeStreamProgress[] {
  if (batch.length <= limit) return batch;
  const focus = preferredStreamItem(batch);
  const focusEpisode = focus?.episodeNumber ?? batch[0].episodeNumber;
  const priority = [
    ...batch.filter((item) => item.status === "active" || item.status === "failed"),
    ...batch.filter((item) => item.status === "completed").slice(-1),
    ...batch.filter((item) => (
      item.status === "queued" && item.episodeNumber > focusEpisode
    )).slice(0, 1),
    ...batch.slice().sort((left, right) => (
      Math.abs(left.episodeNumber - focusEpisode)
      - Math.abs(right.episodeNumber - focusEpisode)
    )),
  ];
  const visibleEpisodes = new Set<number>();
  for (const item of priority) {
    visibleEpisodes.add(item.episodeNumber);
    if (visibleEpisodes.size >= limit) break;
  }
  return batch.filter((item) => visibleEpisodes.has(item.episodeNumber));
}

function compactGenerationDirectoryBatch(
  project: ScriptProject,
  batch: EpisodeStreamProgress[],
): EpisodeStreamProgress[] {
  if (!batch.length) return [];
  const generatedEpisodes = new Set(project.episodes.map((item) => item.episodeNumber));
  const focused = compactGenerationDetailBatch(batch, 6);
  const firstQueued = batch
    .filter((item) => item.status === "queued")
    .sort((left, right) => left.episodeNumber - right.episodeNumber)[0];
  const visibleEpisodes = new Set([
    ...generatedEpisodes,
    ...focused.map((item) => item.episodeNumber),
    ...(firstQueued ? [firstQueued.episodeNumber] : []),
  ]);
  const visible = batch.filter((item) => visibleEpisodes.has(item.episodeNumber));
  return visible.length ? visible : firstQueued ? [firstQueued] : batch.slice(0, 1);
}

export function ScriptWorkspace() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectStore = useProjects();
  const { getProject, isReady, updateProject } = projectStore;
  const { locale, t } = useLocale();
  const project = getProject(params.projectId);
  const backgroundScriptTask = useScriptGenerationTask(params.projectId);
  const [activeEpisodeNumber, setActiveEpisodeNumber] = useState(project?.activeEpisodeNumber ?? 1);
  const [selectedDocumentView, setSelectedDocumentView] = useState<WorkspaceDocumentView>("current");
  const [message, setMessage] = useState<string | null>(null);
  const [workspaceBusyAction, setBusyAction] = useState<"save" | "confirm" | "modify" | "deepen" | "batch" | "finalize" | null>(null);
  const [workspaceView, setWorkspaceView] = useState<"script" | "continuity">(
    searchParams.get("view") === "continuity" ? "continuity" : "script",
  );
  const [seriesExportOpen, setSeriesExportOpen] = useState(false);
  const [seriesExportMode, setSeriesExportMode] = useState<SeriesExportMode>("episodes");
  const [seriesExportFormats, setSeriesExportFormats] = useState<Record<EpisodeDocumentFormat, boolean>>({
    markdown: true,
    text: false,
    word: false,
  });
  const [seriesExportProductionPackage, setSeriesExportProductionPackage] = useState(true);
  const [seriesExportBusy, setSeriesExportBusy] = useState(false);
  const [hostDeliveryBusy, setHostDeliveryBusy] = useState(false);
  const [episodeExportFormat, setEpisodeExportFormat] = useState<EpisodeDocumentFormat>("markdown");
  const [generationIntentConsumed, setGenerationIntentConsumed] = useState(false);
  const streamBatch = backgroundScriptTask?.progress ?? [];
  const streamStatusSignature = streamBatch
    .map((item) => `${item.episodeNumber}:${item.status}`)
    .join("|");
  const setStreamBatch = useCallback<Dispatch<SetStateAction<EpisodeStreamProgress[]>>>(
    (update) => updateScriptGenerationProgress(params.projectId, update),
    [params.projectId],
  );
  const [generationDetailsOpen, setGenerationDetailsOpen] = useState(false);
  const [generationStatusDismissed, setGenerationStatusDismissed] = useState(false);
  const [lengthDetailsOpen, setLengthDetailsOpen] = useState(false);
  const [activeScriptOutlineId, setActiveScriptOutlineId] = useState(
    `script-episode-${project?.activeEpisodeNumber ?? 1}`,
  );
  const draftEditing = useScriptDraftEditing({ projectId: params.projectId, getProject, updateProject });
  const { pendingInlineDraftsRef, candidateBaseInlineEditsRef } = draftEditing;
  const deliveryValidationCacheRef = useRef<{
    project: ScriptProject;
    confirmation: unknown;
    value: boolean;
  } | null>(null);

  useEffect(() => {
    if (!project?.episodes.length) return;
    const episodes = project.episodes.map(normalizeEpisodeLifecycle);
    if (episodes.every((item, index) => item === project.episodes[index])) return;
    void updateProject(project.id, { episodes });
  }, [project?.episodes, project?.id]);

  const episode = project?.episodes.find((item) => item.episodeNumber === activeEpisodeNumber);
  const authorWorkflow = useScriptAuthorWorkflow({
    projectId: params.projectId, episode, projectStore, draftEditing,
    onMessage: setMessage, onViewChange: setSelectedDocumentView, t,
  });
  const {
    conflictOpen: authorConflictOpen, conflictBusy: authorConflictBusy, error: authorConflictError,
    instruction: scriptChatInstruction, selection: scriptDocumentSelection, messages: scriptChatMessages,
    setInstruction: setScriptChatInstruction, setSelection: setScriptDocumentSelection,
    requestModification, applyModification, deferAuthorConflict, withdrawAuthorConflict,
    recheckAuthorConflict, confirmAuthorConflict, pauseScriptModification, editScriptChatMessage,
  } = authorWorkflow;
  const busyAction = workspaceBusyAction ?? authorWorkflow.busyAction;
  const generationIntent = searchParams.get("generate") === "1";
  const scriptAccessible = project ? workspaceSectionAccess(project).script : false;
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
    if (!isReady || !project || scriptAccessible) return;
    const destination = workspaceSectionAccess(project).planning
      ? `/projects/${project.id}/planning/structure`
      : `/projects/${project.id}/planning`;
    router.replace(destination);
  }, [isReady, project?.id, router, scriptAccessible]);

  useEffect(() => {
    if (!project?.episodes.length) return;
    if (!project.episodes.some((item) => item.episodeNumber === activeEpisodeNumber)) {
      setActiveEpisodeNumber(project.episodes[0].episodeNumber);
    }
  }, [project?.episodes.length, activeEpisodeNumber]);

  useEffect(() => {
    setSelectedDocumentView("current");
    setScriptDocumentSelection(null);
    setMessage(null);
    setActiveScriptOutlineId(`script-episode-${activeEpisodeNumber}`);
  }, [activeEpisodeNumber]);

  useEffect(() => {
    if (streamBatch.some((item) => item.status === "active" || item.status === "queued")) {
      setGenerationStatusDismissed(false);
      setGenerationDetailsOpen(false);
      return;
    }
    if (!streamBatch.length || !streamBatch.every((item) => item.status === "completed")) return;
    setGenerationDetailsOpen(false);
    const timer = window.setTimeout(() => setGenerationStatusDismissed(true), 6_000);
    return () => window.clearTimeout(timer);
  }, [streamStatusSignature]);

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

  const generateNextStageRef = useScriptGenerationRecovery({
    project,
    scriptAccessible,
    generationIntent,
    busy: busyAction !== null,
    browserTaskStatus: backgroundScriptTask?.status,
    updateProject,
    onResumeInitial: (task) => {
      setGenerationIntentConsumed(false);
      router.replace(`/projects/${params.projectId}/workspace?generate=1&start=${task.startEpisode}&end=${task.endEpisode}`);
    },
  });

  if (!isReady) {
    return <main className="centered-state"><div className="loading-mark" /><p>{t("project.opening")}</p></main>;
  }
  if (!project) {
    return <main className="centered-state" />;
  }
  if (!scriptAccessible) {
    return <main className="centered-state"><div className="loading-mark" /></main>;
  }
  if (
    requestedLeafRange
    && project.episodes.length === 0
    && generationIntentConsumed
    && (generationIntent || project.status === "generating")
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
    const planningRequiredMessage = !requestedLeafRange
      && !streamBatch.length
      && !backgroundScriptTask
      ? t("generation.episodePlansRequired")
      : null;
    return (
      <PendingScriptWorkspace
        activeEpisodeNumber={activeEpisodeNumber}
        batch={streamBatch}
        detailsOpen={generationDetailsOpen}
        message={message ?? planningRequiredMessage}
        onDetailsToggle={() => setGenerationDetailsOpen((current) => !current)}
        onRetryEpisode={() => {
          setGenerationIntentConsumed(false);
          router.replace(`/projects/${project.id}/workspace?generate=1`);
        }}
        onSelectEpisode={(episodeNumber) => {
          setActiveEpisodeNumber(episodeNumber);
          void updateProject(project.id, { activeEpisodeNumber: episodeNumber });
        }}
        project={project}
        retryDisabled={!requestedLeafRange || isScriptGenerationRunning(project.id)}
        task={backgroundScriptTask}
        t={t}
      />
    );
  }

  const normalizedEpisodes = project.episodes.map(normalizeEpisodeLifecycle);
  const currentProject = normalizedEpisodes.every((item, index) => item === project.episodes[index])
    ? project
    : { ...project, episodes: normalizedEpisodes };
  const currentEpisode = normalizeEpisodeLifecycle(episode);
  const recoverableEpisode = currentProject.activeGenerationTask
    ? firstMissingRecoveryEpisode(
        currentProject.activeGenerationTask,
        currentProject.episodes.map((item) => item.episodeNumber),
      )
    : null;
  const currentDraft = resolveWorkingDraft(currentEpisode);
  const modificationDraft = currentEpisode.modificationCandidate?.candidate_generation_run?.draft_master_script ?? null;
  const deepeningRun = currentEpisode.deepeningRun ?? currentEpisode.generationRun.creative_deepening_run ?? null;
  const deepeningDraft = deepeningRun?.candidate_valid_for_comparison
    ? deepeningRun.candidate_draft_master_script ?? null
    : null;
  const revisedDraft = currentEpisode.revisionRun?.revised_draft_master_script ?? null;
  const displayedDraft = selectedDocumentView === "modification" && modificationDraft
    ? modificationDraft
    : selectedDocumentView === "deepening" && deepeningDraft
      ? deepeningDraft
      : selectedDocumentView === "revised" && revisedDraft
        ? revisedDraft
        : currentDraft;
  const projectCharacterNameMap = Object.fromEntries(
    collectProjectOverseasCharacterNames(currentProject),
  );
  const plannedEpisodes = plannedEpisodesForProject(currentProject);
  const seriesMissingBilingualCount = currentProject.generationSettings.releaseRegion === "overseas"
    ? plannedEpisodes
      .reduce((count, item) => {
        const draft = resolveSavedDraft(item);
        if (!draft) return count + 1;
        const isUsable = Boolean(resolveCurrentOverseasDialogueView(
          draft,
          projectCharacterNameMap,
        ));
        return count + (isUsable ? 0 : 1);
      }, 0)
    : 0;
  const displayedBilingualView = currentProject.generationSettings.releaseRegion === "overseas"
    ? resolveCurrentOverseasDialogueView(
        displayedDraft,
        projectCharacterNameMap,
      )
    : undefined;
  const metricDrafts = plannedEpisodes.map((item) => (
    resolveWorkingDraft(item)
  ));
  const seriesTextMetrics = calculateSeriesTextMetrics(
    metricDrafts,
    currentProject.generationSettings.targetTotalCharacters,
    currentProject.generationSettings.episodeCount,
  );
  const displayedTextMetrics = calculateDraftTextMetrics(displayedDraft);
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
  const scriptGenerationActive = backgroundScriptTask
    ? ["running", "pausing", "paused"].includes(backgroundScriptTask.status)
    : false;
  const allPlannedEpisodesGenerated = currentProject.generationSettings.episodeCount > 0
    && contiguousEpisodeCoverageThrough(
      currentProject.episodes.map((item) => item.episodeNumber),
    ) >= currentProject.generationSettings.episodeCount
    && !scriptGenerationActive
    && (!currentProject.activeGenerationTask
      || currentProject.activeGenerationTask.status === "completed");
  const allPlannedEpisodesSaved = allPlannedEpisodesGenerated
    && currentProject.episodes
      .filter((item) => isPlannedEpisodeNumber(
        item.episodeNumber,
        currentProject.generationSettings.episodeCount,
      )).length === currentProject.generationSettings.episodeCount
    && currentProject.episodes
      .filter((item) => isPlannedEpisodeNumber(
        item.episodeNumber,
        currentProject.generationSettings.episodeCount,
      ))
      .every(episodeHasSavedDraft);
  const cachedDeliveryValidation = deliveryValidationCacheRef.current;
  const seriesDeliveryConfirmed = cachedDeliveryValidation
    && cachedDeliveryValidation.project === currentProject
    && cachedDeliveryValidation.confirmation === currentProject.deliveryConfirmation
    ? cachedDeliveryValidation.value
    : (() => {
        const value = isSeriesDeliveryConfirmationCurrent(
          currentProject,
          currentProject.deliveryConfirmation,
        );
        deliveryValidationCacheRef.current = {
          project: currentProject,
          confirmation: currentProject.deliveryConfirmation,
          value,
        };
        return value;
      })();
  const currentEpisodeLocked = episodeIsLocked(currentEpisode);
  const scriptInlineEditingEnabled = !currentEpisodeLocked
    && selectedDocumentView === "current"
    && workspaceView === "script"
    && !modificationDraft
    && !deepeningDraft
    && busyAction === null;
  const currentEpisodeHasDirectEdits = currentEpisode.hasLocalDraftEdits
    && !currentEpisode.modificationCandidate
    && !currentEpisode.deepeningRun?.candidate_draft_master_script;
  const projectedSummary = seriesTextMetrics.estimatedEpisodesToTarget === null
    ? t("workspace.length.projectionPending")
    : t("workspace.length.projectionValue")
        .replace("{planned}", numberFormatter.format(seriesTextMetrics.plannedEpisodes))
        .replace("{projected}", numberFormatter.format(seriesTextMetrics.projectedCharactersAtPlannedEpisodes))
        .replace("{estimated}", numberFormatter.format(seriesTextMetrics.estimatedEpisodesToTarget));

  function hasCurrentEpisodeInlineEdits(): boolean {
    return draftEditing.hasInlineEdits(currentEpisode.episodeNumber);
  }

  function replaceEpisode(
    patch: Partial<EpisodeWorkspace>,
    skipContinuitySync = false,
  ) {
    void draftEditing.replaceEpisode(currentEpisode.episodeNumber, patch, skipContinuitySync);
  }

  function updateCurrentDraft(update: ScriptDraftUpdater) {
    if (!scriptInlineEditingEnabled) return;
    draftEditing.updateDraft(currentEpisode.episodeNumber, update);
    setMessage(null);
  }

  async function saveCurrentDraft() {
    if (
      currentEpisodeLocked
      || !currentEpisodeHasDirectEdits
      || currentEpisode.modificationCandidate
      || currentEpisode.deepeningRun?.candidate_draft_master_script
    ) return;
    setBusyAction("save");
    setMessage(null);
    try {
      const save = draftEditing.saveDraft(currentEpisode.episodeNumber);
      if (!save) return;
      const artifactRef = await save;
      setMessage(artifactRef
        ? t("workspace.episodeSaved")
        : `${t("workspace.episodeSaved")} ${t("workspace.artifactSaveWarning")}`);
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.saveFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  function selectEpisode(number: number) {
    setScriptDocumentSelection(null);
    setSelectedDocumentView("current");
    setActiveEpisodeNumber(number);
    updateProject(currentProject.id, { activeEpisodeNumber: number });
  }
  function submitScriptChat() {
    void requestModification(scriptChatInstruction);
  }

  function runScriptQuickAction(_action: PlanningCanvasAction, actionInstruction: string) {
    setScriptChatInstruction(actionInstruction);
    void requestModification(actionInstruction, scriptDocumentSelection);
  }

  function captureScriptDocumentSelection(event: SyntheticEvent<HTMLDivElement>) {
    if (currentEpisodeLocked) return;
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? "";
    if (!selectedText) return;
    const eventTarget = event.target instanceof HTMLElement ? event.target : null;
    if (eventTarget?.closest(".selection-edit-toolbar")) return;
    const anchorElement = selection?.anchorNode instanceof HTMLElement
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement ?? null;
    const target = anchorElement?.closest<HTMLElement>("[data-script-field]");
    if (!target || !event.currentTarget.contains(target)) return;
    const fullText = target.dataset.scriptFieldText ?? target.innerText ?? selectedText;
    const selectedIndex = fullText.indexOf(selectedText);
    const afterStart = selectedIndex >= 0
      ? selectedIndex + selectedText.length
      : fullText.length;
    setScriptDocumentSelection({
      source_field: target.dataset.scriptField ?? "正文",
      selected_text: selectedText.slice(0, 4_000),
      before_text: selectedIndex > 0
        ? fullText.slice(Math.max(0, selectedIndex - 320), selectedIndex)
        : "",
      after_text: fullText.slice(afterStart, afterStart + 320),
    });
  }


  async function requestDeepening() {
    if (currentEpisodeLocked) return;
    if (currentEpisodeHasDirectEdits) {
      candidateBaseInlineEditsRef.current.add(currentEpisode.episodeNumber);
    } else {
      candidateBaseInlineEditsRef.current.delete(currentEpisode.episodeNumber);
    }
    setBusyAction("deepen");
    setMessage(null);
    try {
      const latestDraft = pendingInlineDraftsRef.current.get(currentEpisode.episodeNumber)
        ?? currentDraft;
      const result = await deepenEpisodeDraft(currentEpisode.generationRun, latestDraft);
      if (!result.candidate_valid_for_comparison || !result.candidate_draft_master_script) {
        const hasInlineEdits = hasCurrentEpisodeInlineEdits();
        replaceEpisode({
          status: hasInlineEdits ? "editing" : "saved",
          deepeningRun: undefined,
          hasLocalDraftEdits: hasInlineEdits,
        });
        setMessage(t("workspace.deepeningRejected"));
        return;
      }
      replaceEpisode({ status: "editing", deepeningRun: result, hasLocalDraftEdits: true });
      setSelectedDocumentView("deepening");
      setMessage(t("workspace.deepeningReady"));
    } catch (error) {
      const hasInlineEdits = hasCurrentEpisodeInlineEdits();
      replaceEpisode({
        status: hasInlineEdits ? "editing" : "saved",
        deepeningRun: undefined,
        hasLocalDraftEdits: hasInlineEdits,
      });
      setMessage(formatWorkflowError(error, t, "workspace.deepeningFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function applyDeepening() {
    if (!deepeningDraft || currentEpisodeLocked) return;
    setBusyAction("save");
    try {
      const sourceProject = getProject(currentProject.id) ?? currentProject;
      const sourceEpisode = sourceProject.episodes.find((item) => item.episodeNumber === currentEpisode.episodeNumber);
      if (!sourceEpisode) return;
      const reviewedRun = await reviewEpisodeDraft(currentEpisode.generationRun, deepeningDraft);
      const artifactRef = await draftEditing.persistReviewedDraft(sourceProject, sourceEpisode, reviewedRun);
      setSelectedDocumentView("current");
      setMessage(artifactRef
        ? t("workspace.deepeningApplied")
        : `${t("workspace.deepeningApplied")} ${t("workspace.artifactSaveWarning")}`);
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.saveFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function generateNextStage(
    optionalInstruction = "",
    requestedRange?: { startEpisode: number; endEpisode: number },
  ) {
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
      setMessage(t("generation.backgroundScript")
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
    const generatedEpisodes: EpisodeWorkspace[] = [];
    let activeStreamingEpisode = batchRange.startEpisode;
    const session = createScriptGenerationSession({
      projectId: currentProject.id, getProject, updateProject,
      onPauseChange: (paused) => setMessage(t(paused ? "workspace.generationPaused" : "workspace.generationResumed")),
      onAutomaticRetry: (episodeNumber, { nextAttempt, maxAttempts }) => {
        setStreamBatch((current) => markEpisodeAutomaticRetry(current, episodeNumber));
        setMessage(t("workspace.stream.autoRetrying")
          .replace("{episode}", String(episodeNumber))
          .replace("{attempt}", String(nextAttempt))
          .replace("{max}", String(maxAttempts)));
      },
    });
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
      const recoveryTask = recoveryCandidate
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
      await session.checkpoint(recoveryTask);
      const resultCommitter = createGenerationResultCommitter({
        project: currentProject,
        updateProject,
        getTask: () => session.task,
        initial: false,
      });
      const generateEpisode = async (
        episodeNumber: number,
        continuityEpisodes: EpisodeWorkspace[],
        agentRequestId: string,
        signal: AbortSignal,
      ): Promise<EpisodeWorkspace> => {
        const latestEpisode = continuityEpisodes.at(-1);
        const previousEpisode = latestEpisode
          ? resolveWorkingDraft(latestEpisode)
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
          continuityEpisodes.map(resolveWorkingDraft),
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
          agentRequestId,
          targetScriptBodyCharacters: bodyTarget,
          targetDurationSeconds: plannedEpisodeDurationSeconds(generationConstraint),
          adaptiveSceneCount: adaptiveEpisodeSceneCount(generationConstraint),
          plannedShotCount: plannedEpisodeShotCount(generationConstraint),
          previousEpisode,
          episodeInstruction: withAuthorIntentWorkflowRule(
            episodeGenerationInstruction(
              generationConstraint,
              episodeNumber === batchRange.startEpisode ? optionalInstruction : "",
              { endingMode: episodeGenerationExecutionPlan(generationConstraint)?.ending_mode },
            ),
          ),
          relevantCharacterRefs: episodeGenerationCharacterRefs(generationConstraint),
          approvedStoryNode: storyNodeExecutionContext(generationConstraint),
          approvedEpisodePlan: episodeGenerationExecutionPlan(generationConstraint),
          ...ledgerPlan,
          storyBibleContext: storyBibleEpisodeContext(
            storyBible,
            generationConstraint,
          ),
          creativeDecisions: storyBible.creative_decisions ?? [],
          batch: {
            batchNumber,
            startEpisode: batchRange.startEpisode,
            endEpisode: batchRange.endEpisode,
            instruction: optionalInstruction,
          },
        }, (event) => {
          if (signal.aborted) return;
          setStreamBatch((current) => applyEpisodeStreamEvent(
            current,
            episodeNumber,
            event,
          ));
        }, generationRuntime, signal);
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
        const now = new Date().toISOString();
        return {
          id: crypto.randomUUID(),
          episodeNumber,
          status: "saved",
          generationRun: run,
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
      ).filter((episodeNumber) => (
        !orderedExistingEpisodes.some((episode) => episode.episodeNumber === episodeNumber)
      ));
      const generationWindows = buildEpisodeGenerationWindows(episodeNumbers);
      for (const windowEpisodeNumbers of generationWindows) {
        await session.pauseAtBoundary();
        activeStreamingEpisode = windowEpisodeNumbers[0];
        setMessage(t("workspace.batchProgress")
          .replace(
            "{current}",
            String(windowEpisodeNumbers[0] - batchRange.startEpisode + 1),
          )
          .replace("{total}", String(requestedEpisodeCount)));

        const continuityEpisodes = [...orderedExistingEpisodes, ...generatedEpisodes];
        const windowResults = await Promise.allSettled(
          windowEpisodeNumbers.map((episodeNumber) => session.generateEpisode(
            episodeNumber,
            (requestId, signal) => generateEpisode(episodeNumber, continuityEpisodes, requestId, signal),
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
          generatedEpisodes.push(result.value);
          generatedEpisodes.sort((left, right) => left.episodeNumber - right.episodeNumber);
          await resultCommitter.commitEpisode(result.value);
          await session.checkpoint((task) => completeRecoveryEpisode(task, episodeNumber));
        }
        if (firstFailure) {
          activeStreamingEpisode = firstFailure.episodeNumber;
          throw firstFailure.reason;
        }
      }
      generatedEpisodes.sort((left, right) => left.episodeNumber - right.episodeNumber);
      await resultCommitter.complete();
      await session.checkpoint(finishGenerationRecoveryTask);
      await session.clearCheckpoint();
      setActiveEpisodeNumber(getProject(currentProject.id)?.activeEpisodeNumber ?? batchRange.startEpisode);
      setMessage(t("workspace.batchComplete")
        .replace("{start}", String(batchRange.startEpisode))
        .replace("{end}", String(batchRange.endEpisode)));
    } catch (error) {
      generationFailed = true;
      generationFailure = error;
      const errorText = formatWorkflowError(error, t, "generation.failed");
      await session.checkpoint((task) => failGenerationRecoveryTask(task, activeStreamingEpisode, errorText))
        .catch(() => undefined);
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

  generateNextStageRef.current = generateNextStage;

  async function confirmSeriesDelivery() {
    if (!allPlannedEpisodesSaved || seriesExportBusy) return;
    setSeriesExportBusy(true);
    setMessage(null);
    try {
      const confirmed = await confirmLatestSeriesDelivery(
        currentProject.id,
        updateProject,
        getProject,
      );
      if (!confirmed) throw new Error(t("workspace.confirmSeriesDeliveryFailed"));
      setMessage(t("workspace.confirmSeriesDeliverySaved"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("workspace.confirmSeriesDeliveryFailed"));
    } finally {
      setSeriesExportBusy(false);
    }
  }

  function getConfirmedSeriesExportProject(): ScriptProject | null {
    try {
      const latestProject = getProject(currentProject.id) ?? currentProject;
      const episodeCount = latestProject.generationSettings.episodeCount;
      const plannedEpisodes = plannedEpisodesForProject(latestProject);
      const ready = Number.isInteger(episodeCount)
        && episodeCount > 0
        && plannedEpisodes.length === episodeCount
        && contiguousEpisodeCoverageThrough(
          latestProject.episodes.map((item) => item.episodeNumber),
        ) >= episodeCount
        && !isScriptGenerationRunning(latestProject.id)
        && (!latestProject.activeGenerationTask
          || latestProject.activeGenerationTask.status === "completed")
        && plannedEpisodes.every(episodeHasSavedDraft);
      if (!ready) {
        setMessage(t("workspace.exportSaveRequiredSeries"));
        return null;
      }
      if (!isSeriesDeliveryConfirmationCurrent(
        latestProject,
        latestProject.deliveryConfirmation,
      )) {
        setMessage(t("workspace.exportSeriesConfirmationRequired"));
        return null;
      }
      return latestProject;
    } catch {
      setMessage(t("workspace.exportSeriesConfirmationRequired"));
      return null;
    }
  }

  async function deliverToHost() {
    const exportProject = getConfirmedSeriesExportProject();
    if (!exportProject || hostDeliveryBusy) return;
    setHostDeliveryBusy(true);
    setMessage(null);
    try {
      await deliverSeriesToHost(exportProject);
      setMessage(t("workspace.deliveryCompleted"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("workspace.confirmSeriesDeliveryFailed"));
    } finally {
      setHostDeliveryBusy(false);
    }
  }

  function downloadSeriesData() {
    if (!allPlannedEpisodesSaved) {
      setMessage(t("workspace.exportSaveRequiredSeries"));
      return;
    }
    const exportProject = getConfirmedSeriesExportProject();
    if (!exportProject) return;
    const ordered = plannedEpisodesForProject(exportProject)
      .slice()
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((item) => {
        const draft = resolveSavedDraft(item);
        if (!draft) throw new Error(t("workspace.exportSaveRequiredSeries"));
        return {
          episodeNumber: item.episodeNumber,
          status: "saved" as const,
          draft,
        };
      });
    downloadFile(
      JSON.stringify({
        schema_version: "ai_comic_series_export.v1",
        project_id: exportProject.id,
        title: exportProject.title,
        tags: exportProject.selectedTagIds,
        characters: exportProject.characters,
        planning_mode: "recursive_tree",
        text_metrics: exportProject === currentProject
          ? seriesTextMetrics
          : calculateSeriesTextMetrics(
              plannedEpisodesForProject(exportProject).map((item) => resolveWorkingDraft(item)),
              exportProject.generationSettings.targetTotalCharacters,
              exportProject.generationSettings.episodeCount,
            ),
        delivery_confirmation: exportProject.deliveryConfirmation,
        episodes: ordered,
      }, null, 2),
      `${safeFilename(exportProject.title)}-full-script.json`,
      "application/json",
    );
  }

  async function downloadSeriesDocuments() {
    const formats = (Object.entries(seriesExportFormats) as Array<[EpisodeDocumentFormat, boolean]>)
      .filter(([, selected]) => selected)
      .map(([format]) => format);
    if (!formats.length && !seriesExportProductionPackage) return;
    if (!allPlannedEpisodesSaved) {
      setMessage(t("workspace.exportSaveRequiredSeries"));
      return;
    }
    const exportProject = getConfirmedSeriesExportProject();
    if (!exportProject) return;
    const exportCharacterNameMap = exportProject === currentProject
      ? projectCharacterNameMap
      : Object.fromEntries(collectProjectOverseasCharacterNames(exportProject));
    const exportTextMetrics = exportProject === currentProject
      ? seriesTextMetrics
      : calculateSeriesTextMetrics(
          plannedEpisodesForProject(exportProject).map((item) => resolveWorkingDraft(item)),
          exportProject.generationSettings.targetTotalCharacters,
          exportProject.generationSettings.episodeCount,
        );

    const episodes = plannedEpisodesForProject(exportProject)
      .slice()
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((item) => {
        const draft = resolveSavedDraft(item);
        if (!draft) throw new Error(t("workspace.exportSaveRequiredSeries"));
        const bilingualView = exportProject.generationSettings.releaseRegion === "overseas"
          ? resolveCurrentOverseasDialogueView(
              draft,
              exportCharacterNameMap,
            )
          : undefined;
        return {
          episodeNumber: item.episodeNumber,
          draft,
          bilingualView,
        };
      });
    const missingBilingualCount = formats.length
      && exportProject.generationSettings.releaseRegion === "overseas"
      ? episodes.filter((item) => !item.bilingualView).length
      : 0;
    if (missingBilingualCount > 0) {
      setMessage(t("workspace.exportBilingualRequired").replace("{count}", String(missingBilingualCount)));
      return;
    }
    setSeriesExportBusy(true);
    setMessage(null);
    try {
      const productionAttachments = seriesExportProductionPackage
        ? (await createProductionWorkbookAttachments(
            exportProject.title,
            buildProductionIndex({
              characters: exportProject.characters,
              relationships: exportProject.characterRelationships,
              continuityStates: exportProject.continuityStates,
              episodes,
            }),
          )).map((attachment) => ({
            filename: `制作资料/${attachment.filename}`,
            content: attachment.content,
          }))
        : [];
      if (seriesExportMode === "episodes") {
        const archive = await createEpisodeArchive(
          exportProject.title,
          episodes,
          formats,
          productionAttachments,
        );
        if (!getConfirmedSeriesExportProject()) return;
        downloadBlob(archive, seriesArchiveFilename(exportProject.title, "episodes"));
      } else {
        const documents = await Promise.all(formats.map(async (format) => ({
          format,
          content: format === "word"
            ? await createScreenplayDocxBlob(exportProject.title, episodes, { includeCover: true })
            : toSeriesDocument(
                exportProject.title,
                episodes,
                format,
                seriesExportPreface(format, exportTextMetrics, numberFormatter),
              ),
        })));
        if (documents.length === 1 && !productionAttachments.length) {
          const document = documents[0];
          if (!getConfirmedSeriesExportProject()) return;
          if (document.content instanceof Blob) {
            downloadBlob(
              document.content,
              collectionDocumentFilename(exportProject.title, document.format),
            );
          } else {
            downloadFile(
              document.content,
              collectionDocumentFilename(exportProject.title, document.format),
              document.format === "markdown"
                ? "text/markdown;charset=utf-8"
                : "text/plain;charset=utf-8",
            );
          }
        } else {
          const archive = await createCollectionArchive(
            exportProject.title,
            documents,
            productionAttachments,
          );
          if (!getConfirmedSeriesExportProject()) return;
          downloadBlob(archive, seriesArchiveFilename(exportProject.title, "collection"));
        }
      }
      setSeriesExportOpen(false);
      setMessage(null);
    } catch {
      setMessage(t("workspace.exportFailed"));
    } finally {
      setSeriesExportBusy(false);
    }
  }

  const scriptDirectoryEntries = buildScriptDirectoryEntries(
    currentProject,
    streamBatch,
    t,
  );
  const currentEpisodeTitle = projectEpisodeTitle(
    currentProject,
    currentEpisode.episodeNumber,
  );
  const retryGenerationEpisode = (episodeNumber: number) => {
    const recoveryTask = currentProject.activeGenerationTask;
    void generateNextStage("", {
      startEpisode: recoveryTask?.startEpisode
        ?? streamBatch[0]?.episodeNumber
        ?? episodeNumber,
      endEpisode: recoveryTask?.endEpisode
        ?? streamBatch.at(-1)?.episodeNumber
        ?? episodeNumber,
    });
  };

  function selectScriptDirectoryEntry(entry: DocumentOutlineEntry): void {
    if (entry.id === "workspace-section-script") {
      setActiveScriptOutlineId(`script-episode-${currentEpisode.episodeNumber}`);
      return;
    }
    const episodeMatch = /^script-episode-(\d+)$/.exec(entry.id);
    if (episodeMatch) {
      setActiveScriptOutlineId(entry.id);
      selectEpisode(Number(episodeMatch[1]));
      return;
    }
    setActiveScriptOutlineId(entry.id);
    window.requestAnimationFrame(() => {
      document.getElementById(entry.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <main className="script-workspace is-unified page-reveal">
      {authorConflictOpen && currentEpisode.pendingAuthorConflict && !currentEpisode.pendingAuthorConflict.resolved ? (
        <AuthorConflictDialog
          busy={authorConflictBusy || busyAction === "modify"}
          error={authorConflictError}
          key={currentEpisode.pendingAuthorConflict.review.review_id}
          onConfirm={confirmAuthorConflict}
          onDefer={deferAuthorConflict}
          onRecheck={recheckAuthorConflict}
          onWithdraw={withdrawAuthorConflict}
          pending={currentEpisode.pendingAuthorConflict}
        />
      ) : null}
      <AutoStartDirectGeneration
        enabled={generationIntent && !generationIntentConsumed && Boolean(requestedLeafRange)}
        onConsume={() => {
          setGenerationIntentConsumed(true);
          router.replace(`/projects/${currentProject.id}/workspace`);
        }}
        onStart={() => generateNextStage("", requestedLeafRange ?? undefined)}
      />
      <div className="script-workbench">
        <div className="script-document-column">
          <div className="script-unified-document-layout">
            <WorkspaceSectionDirectory
              activeEntryId={activeScriptOutlineId}
              activeSection="script"
              currentEntries={scriptDirectoryEntries}
              onSelect={selectScriptDirectoryEntry}
              projectId={currentProject.id}
            />
            <div
              className="script-document-surface"
              onKeyUp={captureScriptDocumentSelection}
              onMouseUp={captureScriptDocumentSelection}
            >
              <SelectionEditToolbar
                actions={SCRIPT_QUICK_ACTIONS}
                disabled={currentEpisodeLocked || busyAction !== null || selectedDocumentView !== "current" || workspaceView !== "script"}
                onAction={runScriptQuickAction}
                onClear={() => setScriptDocumentSelection(null)}
                selection={currentEpisodeLocked ? null : scriptDocumentSelection}
              />
              <div className="document-edit-toolbar script-document-toolbar" role="toolbar" aria-label={t("workspace.toolbarLabel")}>
                <div className="script-document-identity">
                  <span>{t("workspace.episodeLabel").replace("{number}", String(currentEpisode.episodeNumber))}</span>
                  <strong>{currentEpisodeTitle || t("workspace.stream.untitledEpisode")}</strong>
                  <span className={`episode-status status-${currentEpisode.status}`}>{t(`episodeStatus.${currentEpisode.status}`)}</span>
                  <SectionHelp content={t("guide.scriptWorkspace")} label={t("guide.openHelp")} />
                </div>
                <div className="script-document-toolbar-actions">
                  <button aria-pressed={workspaceView === "continuity"} className="document-edit-toolbar-action" onClick={() => setWorkspaceView((current) => current === "script" ? "continuity" : "script")} title={t("workspace.continuityView")} type="button"><Activity aria-hidden="true" size={14} /><span>{t("workspace.continuityView")}</span></button>
                  <button aria-expanded={lengthDetailsOpen} className="document-edit-toolbar-action" onClick={() => setLengthDetailsOpen((current) => !current)} title={t("workspace.length.title")} type="button"><ShieldCheck aria-hidden="true" size={14} /><span>{progressPercent.toFixed(0)}%</span></button>
                  {allPlannedEpisodesSaved ? <button className="document-edit-toolbar-action is-export-ready" onClick={() => setSeriesExportOpen(true)} title={t("workspace.exportAll")} type="button"><Download aria-hidden="true" size={14} /><span>{t("workspace.exportAll")}</span></button> : null}
                </div>
              </div>

              {streamBatch.length && !generationStatusDismissed ? <ScriptGenerationStatus batch={streamBatch} detailsOpen={generationDetailsOpen} onDetailsToggle={() => setGenerationDetailsOpen((current) => !current)} onRetryEpisode={retryGenerationEpisode} project={currentProject} retryDisabled={Boolean(busyAction)} task={backgroundScriptTask} t={t} /> : null}

              {currentProject.activeGenerationTask && recoverableEpisode !== null && (!backgroundScriptTask || backgroundScriptTask.status === "failed" || backgroundScriptTask.status === "completed") ? (
                <section className="generation-recovery-banner is-compact" aria-live="polite">
                  <div><strong>{t("workspace.recovery.title")}</strong><p>{t("workspace.recovery.description").replace("{episode}", String(recoverableEpisode))}</p></div>
                  <button className="primary-action" disabled={Boolean(busyAction)} onClick={() => void generateNextStage(currentProject.activeGenerationTask?.instruction ?? "", { startEpisode: currentProject.activeGenerationTask?.startEpisode ?? recoverableEpisode, endEpisode: currentProject.activeGenerationTask?.endEpisode ?? recoverableEpisode })} type="button">{busyAction ? t("workspace.processing") : t("workspace.recovery.resume")}</button>
                </section>
              ) : null}

              {lengthDetailsOpen ? (
                <section aria-label={t("workspace.length.title")} className="story-length-dashboard is-compact">
                  <div className="story-length-heading"><strong>{t("workspace.length.title")}</strong><strong>{progressPercent.toFixed(2)}%</strong></div>
                  <div className="story-length-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, progressPercent)}><span style={{ width: `${Math.min(100, progressPercent)}%` }} /></div>
                  <div className="story-length-metrics">
                    <div><span>{t("workspace.length.total")}</span><strong>{numberFormatter.format(seriesTextMetrics.scriptBodyCharacters)}</strong><small>{t("workspace.length.target").replace("{target}", numberFormatter.format(seriesTextMetrics.targetCharacters))}</small></div>
                    <div><span>{t("workspace.length.average")}</span><strong>{numberFormatter.format(seriesTextMetrics.averageCharactersPerEpisode)}</strong><small>{t("workspace.length.requiredAverage").replace("{required}", numberFormatter.format(seriesTextMetrics.requiredAverageCharactersPerEpisode))}</small></div>
                    <div><span>{t("workspace.length.currentEpisode").replace("{episode}", String(currentEpisode.episodeNumber))}</span><strong>{numberFormatter.format(displayedTextMetrics.scriptBodyCharacters)}</strong><small>{t("workspace.length.currentTarget").replace("{min}", numberFormatter.format(displayedBodyGuidance.preferredMinCharacters)).replace("{max}", numberFormatter.format(displayedBodyGuidance.preferredMaxCharacters)).replace("{status}", displayedBodyTargetStatus)}</small></div>
                    <div><span>{t("workspace.length.projection")}</span><strong>{numberFormatter.format(seriesTextMetrics.projectedCharactersAtPlannedEpisodes)}</strong><small>{projectedSummary}</small></div>
                  </div>
                </section>
              ) : null}

              {workspaceView === "continuity" ? (
                <ProjectContinuityPanel project={currentProject} />
              ) : (
          <>
          <div className="workspace-toolbar episode-actions is-compact">
            {currentEpisodeHasDirectEdits && selectedDocumentView === "current" ? (
              <button className="primary-action" disabled={busyAction !== null} onClick={() => void saveCurrentDraft()} type="button">
                <Check aria-hidden="true" size={14} />
                <span>{busyAction === "save" ? t("workspace.saving") : t("workspace.saveEpisode")}</span>
              </button>
            ) : null}
            {CREATIVE_DEEPENING_ENABLED && !currentEpisodeLocked && selectedDocumentView === "current" ? <button className="outline-action" disabled={busyAction === "deepen"} onClick={() => void requestDeepening()} type="button">{busyAction === "deepen" ? t("workspace.deepening") : t("workspace.deepenEpisode")}</button> : null}
            <details className="episode-action-menu version-history-menu">
              <summary className="outline-action"><History aria-hidden="true" size={14} /><span>{t("workspace.versionHistory")}</span><ChevronDown aria-hidden="true" size={13} /></summary>
              <div className="episode-action-menu-popover" role="menu">
                <button aria-pressed={selectedDocumentView === "current"} onClick={() => setSelectedDocumentView("current")} role="menuitem" type="button">{t("workspace.currentScript")}</button>
                {revisedDraft ? <button aria-pressed={selectedDocumentView === "revised"} onClick={() => setSelectedDocumentView("revised")} role="menuitem" type="button">{t("workspace.version.revised")}</button> : null}
              </div>
            </details>
          </div>

          {modificationDraft ? (
            <div className="candidate-decision-bar">
              <div aria-label={t("workspace.compareCandidate")} className="candidate-preview-switch" role="group"><button aria-pressed={selectedDocumentView === "current"} onClick={() => setSelectedDocumentView("current")} type="button">{t("workspace.currentScript")}</button><button aria-pressed={selectedDocumentView === "modification"} onClick={() => setSelectedDocumentView("modification")} type="button">{t("workspace.aiCandidate")}</button></div>
              <span>{currentEpisode.modificationCandidate?.instruction}</span>
              <div className="candidate-decision-actions"><button className="primary-action" disabled={busyAction === "save"} onClick={() => void applyModification()} type="button">{busyAction === "save" ? t("workspace.saving") : t("workspace.applyCandidate")}</button><button className="outline-action" disabled={busyAction === "save"} onClick={() => { const hasInlineEdits = hasCurrentEpisodeInlineEdits(); candidateBaseInlineEditsRef.current.delete(currentEpisode.episodeNumber); replaceEpisode({ status: hasInlineEdits ? "editing" : "saved", hasLocalDraftEdits: hasInlineEdits, modificationCandidate: undefined }, true); setSelectedDocumentView("current"); }} type="button">{t("workspace.discardCandidate")}</button></div>
            </div>
          ) : null}
          {currentEpisode.pendingAuthorConflict && !currentEpisode.pendingAuthorConflict.resolved ? (
            <div className="candidate-decision-bar" role="status">
              <span>有一项剧情修改等待处理：{currentEpisode.pendingAuthorConflict.review.user_goal}</span>
              <button className="outline-action" disabled={Boolean(busyAction) || authorConflictBusy} onClick={authorWorkflow.openConflict} type="button">查看冲突与影响</button>
            </div>
          ) : currentEpisode.pendingAuthorConflict?.resolved?.project_id ? (
            <div className="candidate-decision-bar">
              <span>这次上游修改已建立新修订版本，原稿保留在当前项目。</span>
              <a className="outline-action" href={`/projects/${currentEpisode.pendingAuthorConflict.resolved.project_id}/planning`}>打开修订版本</a>
            </div>
          ) : null}
          {currentEpisode.deepeningRun && deepeningDraft ? (
            <div className="candidate-decision-bar"><div aria-label={t("workspace.compareCandidate")} className="candidate-preview-switch" role="group"><button aria-pressed={selectedDocumentView === "current"} onClick={() => setSelectedDocumentView("current")} type="button">{t("workspace.currentScript")}</button><button aria-pressed={selectedDocumentView === "deepening"} onClick={() => setSelectedDocumentView("deepening")} type="button">{t("workspace.version.deepening")}</button></div><span>{deepeningRun?.comparison_metadata?.summary ?? t("workspace.deepeningReady")}</span><div className="candidate-decision-actions"><button className="primary-action" disabled={busyAction === "save"} onClick={() => void applyDeepening()} type="button">{t("workspace.applyDeepening")}</button><button className="outline-action" onClick={() => { const hasInlineEdits = hasCurrentEpisodeInlineEdits(); candidateBaseInlineEditsRef.current.delete(currentEpisode.episodeNumber); replaceEpisode({ status: hasInlineEdits ? "editing" : "saved", deepeningRun: undefined, hasLocalDraftEdits: hasInlineEdits }); setSelectedDocumentView("current"); }} type="button">{t("workspace.keepCurrent")}</button></div></div>
          ) : null}
          {message ? <div className="inline-notice">{message}</div> : null}

          <EpisodeQualityReviewPanel
            draft={displayedDraft}
            stale={selectedDocumentView === "current" && currentEpisodeHasDirectEdits}
            t={t}
          />

          <ScriptDocumentWithDialoguePair
            characterNameMap={projectCharacterNameMap}
            draft={displayedDraft}
            editable={scriptInlineEditingEnabled}
            onDraftChange={updateCurrentDraft}
            releaseRegion={currentProject.generationSettings.releaseRegion}
            t={t}
          />

              </>
              )}
            </div>
          </div>
        </div>
        <PlanningCanvasCopilot
          busy={busyAction === "modify"}
          disabled={currentEpisodeLocked || (busyAction !== null && busyAction !== "modify") || selectedDocumentView !== "current" || workspaceView !== "script"}
          instruction={scriptChatInstruction}
          messages={scriptChatMessages}
          onClearSelection={() => setScriptDocumentSelection(null)}
          onEditMessage={editScriptChatMessage}
          onInstructionChange={setScriptChatInstruction}
          onPause={pauseScriptModification}
          onQuickAction={runScriptQuickAction}
          onSubmit={submitScriptChat}
          quickActions={SCRIPT_QUICK_ACTIONS}
          scopeLabel={`${t("workspace.episodeLabel").replace("{number}", String(currentEpisode.episodeNumber))}${currentEpisodeTitle ? ` · ${currentEpisodeTitle}` : ""}`}
          selection={currentEpisodeLocked ? null : scriptDocumentSelection}
          thinking={busyAction === "modify"}
          variant="document"
        />
      </div>

      {seriesExportOpen && allPlannedEpisodesSaved ? (
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
                .replace("{count}", numberFormatter.format(plannedEpisodes.length))}
              {seriesExportProductionPackage ? ` ${t("workspace.exportProductionPackageSummary")}` : ""}
            </p>
            <section className={`series-export-confirmation${seriesDeliveryConfirmed ? " is-confirmed" : ""}`}>
              <strong>{t("workspace.deliveryConfirmTitle")}</strong>
              <p>
                {seriesDeliveryConfirmed
                  ? t("workspace.deliveryConfirmCurrent").replace("{time}", currentProject.deliveryConfirmation?.confirmedAt ?? "")
                  : t("workspace.deliveryConfirmPending")}
              </p>
              {!seriesDeliveryConfirmed ? (
                <button
                  className="outline-action"
                  disabled={seriesExportBusy}
                  onClick={() => void confirmSeriesDelivery()}
                  type="button"
                >
                  {t("workspace.confirmSeriesDelivery")}
                </button>
              ) : null}
            </section>
            {seriesMissingBilingualCount > 0 && Object.values(seriesExportFormats).some(Boolean) ? (
              <div className="inline-notice">
                {t("workspace.exportBilingualRequired").replace("{count}", String(seriesMissingBilingualCount))}
              </div>
            ) : null}
            <div className="tag-dialog-actions">
              {hostDeliveryConfigured() ? (
                <button
                  className="text-action series-export-data"
                  disabled={seriesExportBusy || hostDeliveryBusy || !seriesDeliveryConfirmed}
                  onClick={() => void deliverToHost()}
                  type="button"
                >
                  {hostDeliveryBusy ? t("workspace.exportPackaging") : t("workspace.deliverToHost")}
                </button>
              ) : null}
              <button className="text-action series-export-data" disabled={seriesExportBusy || !seriesDeliveryConfirmed} onClick={downloadSeriesData} type="button">{t("workspace.exportAllData")}</button>
              <button className="outline-action" disabled={seriesExportBusy} onClick={() => setSeriesExportOpen(false)} type="button">{t("tags.cancelCustom")}</button>
              <button
                className="primary-action"
                disabled={seriesExportBusy || !seriesDeliveryConfirmed || (!Object.values(seriesExportFormats).some(Boolean) && !seriesExportProductionPackage)}
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

function formatScriptElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function ScriptGenerationStatus({
  batch,
  detailsOpen,
  onDetailsToggle,
  onRetryEpisode,
  project,
  retryDisabled,
  task,
  t,
}: {
  batch: EpisodeStreamProgress[];
  detailsOpen: boolean;
  onDetailsToggle: () => void;
  onRetryEpisode?: (episodeNumber: number) => void;
  project: ScriptProject;
  retryDisabled: boolean;
  task?: ScriptGenerationTaskSnapshot;
  t: ScriptWorkspaceTranslator;
}) {
  const current = preferredStreamItem(batch);
  const [now, setNow] = useState(Date.now());
  const active = batch.some((item) => item.status === "active");
  const taskPaused = task?.status === "paused" || task?.status === "pausing";
  useEffect(() => {
    if (!active || taskPaused) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, taskPaused]);
  if (!current) return null;
  const completedEpisodes = new Set(project.episodes.map((item) => item.episodeNumber));
  batch.filter((item) => item.status === "completed").forEach((item) => (
    completedEpisodes.add(item.episodeNumber)
  ));
  const pausedAt = taskPaused && current.pausedAt !== undefined
    ? current.pausedAt
    : Number.NaN;
  const elapsedEnd = current.completedAt
    ?? (Number.isFinite(pausedAt) ? pausedAt : now);
  const elapsedSeconds = current.startedAt
    ? Math.max(
        0,
        Math.round(
          (elapsedEnd - current.startedAt - (current.pausedDurationMs ?? 0)) / 1_000,
        ),
      )
    : 0;
  const title = projectEpisodeTitle(project, current.episodeNumber);
  return (
    <div className="script-generation-status-stack">
      <section aria-live="polite" className={`script-generation-status is-${current.status}`}>
        <span className="script-generation-status-mark">
          {taskPaused ? <Pause aria-hidden="true" size={15} /> : null}
          {!taskPaused && current.status === "active" ? <LoaderCircle aria-hidden="true" size={15} /> : null}
          {!taskPaused && current.status === "completed" ? <Check aria-hidden="true" size={15} /> : null}
          {!taskPaused && current.status === "queued" ? <span aria-hidden="true" className="script-generation-queued-dot" /> : null}
          {!taskPaused && current.status === "failed" ? <span aria-hidden="true">!</span> : null}
        </span>
        <div className="script-generation-status-copy">
          <strong>{t("workspace.stream.compactProgress")
            .replace("{completed}", String(completedEpisodes.size))
            .replace("{total}", String(project.generationSettings.episodeCount))}</strong>
          <span>{t("workspace.episodeLabel").replace("{number}", String(current.episodeNumber))}{title ? ` · ${title}` : ""}</span>
          <small>{creatorGenerationStage(current, t)}{elapsedSeconds ? ` · ${formatScriptElapsed(elapsedSeconds)}` : ""}</small>
        </div>
        <div className="script-generation-status-actions">
          {task && (task.status === "running" || taskPaused) ? (
            <button aria-label={t(taskPaused ? "generationPause.resumeScript" : "generationPause.pauseScript")} className="small-icon-button" onClick={() => taskPaused ? resumeScriptGenerationTask(project.id) : requestScriptGenerationPause(project.id)} title={t(taskPaused ? "generationPause.resumeScript" : "generationPause.pauseScript")} type="button">
              {taskPaused ? <Play aria-hidden="true" size={14} /> : <Pause aria-hidden="true" size={14} />}
            </button>
          ) : null}
          {current.status === "failed" && onRetryEpisode ? (
            <button className="script-generation-retry" disabled={retryDisabled} onClick={() => onRetryEpisode(current.episodeNumber)} type="button">
              {t("workspace.stream.retryEpisode")}
            </button>
          ) : null}
          <button aria-expanded={detailsOpen} className="script-generation-details-toggle" onClick={onDetailsToggle} type="button">
            {t("workspace.stream.details")}<ChevronDown aria-hidden="true" className={detailsOpen ? "is-open" : undefined} size={14} />
          </button>
        </div>
      </section>
      {detailsOpen ? (
        <EpisodeGenerationProgress batch={batch} onRetryEpisode={onRetryEpisode} project={project} retryDisabled={retryDisabled} t={t} />
      ) : null}
    </div>
  );
}

function ScriptLiveGenerationPreview({
  item,
  onRetryEpisode,
  project,
  retryDisabled,
  t,
}: {
  item?: EpisodeStreamProgress;
  onRetryEpisode?: (episodeNumber: number) => void;
  project: ScriptProject;
  retryDisabled: boolean;
  t: ScriptWorkspaceTranslator;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (item?.status !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [item?.status]);
  if (!item) {
    return <section className="script-live-generation-preview is-empty"><p>{t("workspace.stream.notStarted")}</p></section>;
  }
  const title = projectEpisodeTitle(project, item.episodeNumber);
  const visibleCharacters = item.actualCharacters ?? countEffectiveCharacters(item.preview);
  const elapsedSeconds = item.startedAt
    ? Math.round(((item.completedAt ?? now) - item.startedAt) / 1_000)
    : 0;
  return (
    <section aria-live={item.status === "active" ? "polite" : "off"} className={`script-live-generation-preview is-${item.status}`}>
      <header>
        <div>
          <span>{t("workspace.episodeLabel").replace("{number}", String(item.episodeNumber))}</span>
          <h1>{title || t("workspace.stream.untitledEpisode")}</h1>
        </div>
        <div className="script-live-generation-meta">
          <strong>{creatorGenerationStage(item, t)}</strong>
          <small>{visibleCharacters ? `${visibleCharacters} ${t("workspace.stream.characters")}` : ""}{elapsedSeconds ? ` · ${formatScriptElapsed(elapsedSeconds)}` : ""}</small>
        </div>
      </header>
      {item.error ? (
        <div className="episode-generation-error-block">
          <p className="episode-generation-error">{userFacingError(item.error, t("generation.failed"))}</p>
          {onRetryEpisode ? <button className="primary-action" disabled={retryDisabled} onClick={() => onRetryEpisode(item.episodeNumber)} type="button">{t("workspace.stream.retryEpisode")}</button> : null}
        </div>
      ) : (
        <div className="script-live-generation-text">
          {item.preview || t("workspace.stream.waitingForText")}
          {item.status === "active" ? <span className="typing-caret" aria-hidden="true" /> : null}
        </div>
      )}
      {item.status !== "completed" && !item.error ? <footer>{t("workspace.stream.previewPending")}</footer> : null}
    </section>
  );
}

function PendingScriptWorkspace({
  activeEpisodeNumber,
  batch,
  detailsOpen,
  message,
  onDetailsToggle,
  onRetryEpisode,
  onSelectEpisode,
  project,
  retryDisabled = false,
  task,
  t,
}: {
  activeEpisodeNumber: number;
  batch: EpisodeStreamProgress[];
  detailsOpen: boolean;
  message?: string | null;
  onDetailsToggle: () => void;
  onRetryEpisode: (episodeNumber: number) => void;
  onSelectEpisode: (episodeNumber: number) => void;
  project: ScriptProject;
  retryDisabled?: boolean;
  task?: ScriptGenerationTaskSnapshot;
  t: ScriptWorkspaceTranslator;
}) {
  const selectedItem = preferredStreamItem(batch, activeEpisodeNumber);
  const entries = buildScriptDirectoryEntries(project, batch, t);
  const activeEntryId = selectedItem ? `script-episode-${selectedItem.episodeNumber}` : null;
  return (
    <main className="script-workspace is-unified page-reveal">
      <div className="script-generation-workbench">
        <WorkspaceSectionDirectory
          activeEntryId={activeEntryId}
          activeSection="script"
          currentEntries={entries}
          onSelect={(entry) => {
            const match = /^script-episode-(\d+)$/.exec(entry.id);
            if (match) onSelectEpisode(Number(match[1]));
          }}
          projectId={project.id}
        />
        <div className="script-generation-document-surface">
          <div className="document-edit-toolbar script-document-toolbar">
            <div className="script-document-identity"><span>{t("workspace.kicker")}</span><strong>{project.title}</strong></div>
          </div>
          {batch.length ? <ScriptGenerationStatus batch={batch} detailsOpen={detailsOpen} onDetailsToggle={onDetailsToggle} onRetryEpisode={onRetryEpisode} project={project} retryDisabled={retryDisabled} task={task} t={t} /> : null}
          {message ? <div className="inline-notice">{message}</div> : null}
          {!batch.length && !task ? (
            <div className="script-generation-empty-actions">
              <button
                className="primary-action"
                disabled={retryDisabled}
                onClick={() => onRetryEpisode(activeEpisodeNumber)}
                type="button"
              >
                {t("workspace.generateNextPart")}
              </button>
            </div>
          ) : null}
          <ScriptLiveGenerationPreview item={selectedItem} onRetryEpisode={onRetryEpisode} project={project} retryDisabled={retryDisabled} t={t} />
        </div>
      </div>
    </main>
  );
}

function EpisodeGenerationProgress({
  batch,
  onRetryEpisode,
  project,
  retryDisabled = false,
  t,
}: {
  batch: EpisodeStreamProgress[];
  onRetryEpisode?: (episodeNumber: number) => void;
  project: ScriptProject;
  retryDisabled?: boolean;
  t: (key: string) => string;
}) {
  const hasActiveEpisode = batch.some((item) => item.status === "active");
  const [now, setNow] = useState(Date.now());
  const [openEpisodes, setOpenEpisodes] = useState<Set<number>>(new Set());
  const statusSignature = batch.map((item) => `${item.episodeNumber}:${item.status}`).join("|");
  const visibleBatch = compactGenerationDetailBatch(batch);
  const hiddenEpisodeCount = batch.length - visibleBatch.length;

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

  return (
    <section
      aria-label={t("workspace.stream.title")}
      className="episode-generation-progress is-details"
      id="episode-generation-progress"
    >
      <div className="episode-generation-list">
        {visibleBatch.map((item) => {
          const visibleCharacters = item.actualCharacters
            ?? countEffectiveCharacters(item.preview);
          const elapsedSeconds = item.startedAt
            ? Math.max(0, Math.round(((item.completedAt ?? now) - item.startedAt) / 1000))
            : 0;
          const statusLabel = creatorGenerationStage(item, t);
          const title = projectEpisodeTitle(project, item.episodeNumber);
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
                  <strong>{t("workspace.episodeLabel").replace("{number}", String(item.episodeNumber))}{title ? ` · ${title}` : ""}</strong>
                  <small>{statusLabel} · {t(`workspace.stream.stage.${item.stage}`)}</small>
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
                    {item.preview || (item.status === "completed"
                      ? statusLabel
                      : t("workspace.stream.waitingForText"))}
                    {item.status === "active" ? <span className="typing-caret" aria-hidden="true" /> : null}
                  </div>
                )}
              </div>
            </details>
          );
        })}
        {hiddenEpisodeCount > 0 ? (
          <div className="episode-generation-compacted">
            {t("workspace.stream.compactedItems").replace("{count}", String(hiddenEpisodeCount))}
          </div>
        ) : null}
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
  updateProject: (
    projectId: string,
    patch: Partial<ScriptProject> | ((current: ScriptProject) => Partial<ScriptProject>),
  ) => Promise<boolean>;
}) {
  const { getProject } = useProjects();
  const started = useRef(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState(
    requestedLeafRange.startEpisode,
  );
  const task = useScriptGenerationTask(project.id);

  useEffect(() => {
    const active = streamBatch.find((item) => item.status === "active");
    if (active) setSelectedEpisodeNumber(active.episodeNumber);
  }, [streamBatch]);
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
      setMessage(t("generation.backgroundScript")
        .replace("{start}", String(backgroundTask.task.startEpisode))
        .replace("{end}", String(backgroundTask.task.endEpisode)));
      setBusy(true);
      return;
    }
    let generationFailed = false;
    let generationFailure: unknown;
    const requestedEpisodeCount = batchRange.endEpisode - batchRange.startEpisode + 1;
    const generatedEpisodes: EpisodeWorkspace[] = [];
    let activeStreamingEpisode = batchRange.startEpisode;
    const session = createScriptGenerationSession({
      projectId: project.id, getProject, updateProject,
      onPauseChange: (paused) => setMessage(t(paused ? "workspace.generationPaused" : "workspace.generationResumed")),
      onAutomaticRetry: (episodeNumber, { nextAttempt, maxAttempts }) => {
        setStreamBatch((current) => markEpisodeAutomaticRetry(current, episodeNumber));
        setMessage(t("workspace.stream.autoRetrying")
          .replace("{episode}", String(episodeNumber))
          .replace("{attempt}", String(nextAttempt))
          .replace("{max}", String(maxAttempts)));
      },
    });
    const resultCommitter = createGenerationResultCommitter({
      project,
      updateProject,
      getTask: () => session.task,
      initial: true,
    });
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
      const recoveryTask = recoveryCandidate
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
      await session.checkpoint(recoveryTask);
      const generateInitialEpisode = async (
        episodeNumber: number,
        continuityEpisodes: EpisodeWorkspace[],
        agentRequestId: string,
        signal: AbortSignal,
      ): Promise<EpisodeWorkspace> => {
        const latestEpisode = continuityEpisodes.at(-1);
        const previousEpisode = latestEpisode
          ? resolveWorkingDraft(latestEpisode)
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
          continuityEpisodes.map(resolveWorkingDraft),
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
          agentRequestId,
          targetScriptBodyCharacters: bodyTarget,
          targetDurationSeconds: plannedEpisodeDurationSeconds(generationConstraint),
          adaptiveSceneCount: adaptiveEpisodeSceneCount(generationConstraint),
          plannedShotCount: plannedEpisodeShotCount(generationConstraint),
          previousEpisode,
          episodeInstruction: withAuthorIntentWorkflowRule(
            episodeGenerationInstruction(
              generationConstraint,
              "",
              { endingMode: episodeGenerationExecutionPlan(generationConstraint)?.ending_mode },
            ),
          ),
          relevantCharacterRefs: episodeGenerationCharacterRefs(generationConstraint),
          approvedStoryNode: storyNodeExecutionContext(generationConstraint),
          approvedEpisodePlan: episodeGenerationExecutionPlan(generationConstraint),
          ...ledgerPlan,
          storyBibleContext: storyBibleEpisodeContext(
            storyBible,
            generationConstraint,
          ),
          creativeDecisions: storyBible.creative_decisions ?? [],
          batch: {
            batchNumber: 1,
            startEpisode: batchRange.startEpisode,
            endEpisode: batchRange.endEpisode,
          },
        }, (event) => {
          if (signal.aborted) return;
          setStreamBatch((currentBatch) => applyEpisodeStreamEvent(
            currentBatch,
            episodeNumber,
            event,
          ));
        }, generationRuntime, signal);
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
        const now = new Date().toISOString();
        return {
          id: crypto.randomUUID(),
          episodeNumber,
          status: "saved",
          generationRun,
          workingDraftJson: JSON.stringify(generationRun.draft_master_script, null, 2),
          hasLocalDraftEdits: false,
          createdAt: now,
          updatedAt: now,
        };
      };
      const episodeNumbers = Array.from(
        { length: requestedEpisodeCount },
        (_, index) => batchRange.startEpisode + index,
      ).filter((episodeNumber) => (
        !project.episodes.some((episode) => episode.episodeNumber === episodeNumber)
      ));
      const generationWindows = buildEpisodeGenerationWindows(episodeNumbers);
      for (const windowEpisodeNumbers of generationWindows) {
        await session.pauseAtBoundary();
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
          windowEpisodeNumbers.map((episodeNumber) => session.generateEpisode(
            episodeNumber,
            (requestId, signal) => generateInitialEpisode(episodeNumber, continuityEpisodes, requestId, signal),
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
          generatedEpisodes.push(result.value);
          generatedEpisodes.sort((left, right) => left.episodeNumber - right.episodeNumber);
          await resultCommitter.commitEpisode(result.value);
          await session.checkpoint((task) => completeRecoveryEpisode(task, episodeNumber));
        }
        if (firstFailure) {
          activeStreamingEpisode = firstFailure.episodeNumber;
          throw firstFailure.reason;
        }
      }
      await resultCommitter.complete();
      await session.checkpoint(finishGenerationRecoveryTask);
      await session.clearCheckpoint();
      onClearIntent();
    } catch (error) {
      generationFailed = true;
      generationFailure = error;
      const errorText = formatWorkflowError(error, t, "generation.failed");
      await session.checkpoint((task) => failGenerationRecoveryTask(task, activeStreamingEpisode, errorText))
        .catch(() => undefined);
      setStreamBatch((currentBatch) => failEpisodeStream(
        currentBatch,
        activeStreamingEpisode,
        errorText,
      ));
      await resultCommitter.partial().catch(() => undefined);
      if (generatedEpisodes.length) {
        onClearIntent();
      } else {
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

  return (
    <PendingScriptWorkspace
      activeEpisodeNumber={selectedEpisodeNumber}
      batch={streamBatch}
      detailsOpen={detailsOpen}
      message={errorMessage ?? message}
      onDetailsToggle={() => setDetailsOpen((current) => !current)}
      onRetryEpisode={() => void generateInitialBatch()}
      onSelectEpisode={setSelectedEpisodeNumber}
      project={project}
      retryDisabled={busy}
      task={task}
      t={t}
    />
  );
}

function ScriptDocumentWithDialoguePair({
  draft,
  characterNameMap,
  editable,
  onDraftChange,
  releaseRegion,
  t,
}: {
  draft: GeneratedDraft;
  characterNameMap: Record<string, string>;
  editable: boolean;
  onDraftChange: (update: ScriptDraftUpdater) => void;
  releaseRegion: ScriptProject["generationSettings"]["releaseRegion"];
  t: (key: string) => string;
}) {
  const overseasDialogueView = releaseRegion === "overseas";
  const embeddedView = overseasDialogueView
    ? resolveCurrentOverseasDialogueView(
        draft,
        characterNameMap,
      )
    : undefined;
  const translations = embeddedView
    ? new Map(embeddedView.items.map((item) => [item.path, item.translated_text]))
    : undefined;

  return (
    <ScriptDocument
      characterNameMap={mergeOverseasCharacterNames(
        new Map(Object.entries(characterNameMap)),
        embeddedView,
      )}
      draft={draft}
      editable={editable}
      onDraftChange={onDraftChange}
      overseasDialogueView={overseasDialogueView}
      t={t}
      translations={translations}
    />
  );
}

function resolveCurrentOverseasDialogueView(
  draft: GeneratedDraft,
  characterNameMap: Record<string, string>,
): ReturnType<typeof buildEmbeddedOverseasDialogueView> {
  return buildEmbeddedOverseasDialogueView(
    draft,
    "zh-CN-short-drama",
    characterNameMap,
  );
}

function ScriptDocument({
  characterNameMap,
  draft,
  editable,
  onDraftChange,
  t,
  translations,
  overseasDialogueView = false,
}: {
  characterNameMap: ReadonlyMap<string, string>;
  draft: GeneratedDraft;
  editable: boolean;
  onDraftChange: (update: ScriptDraftUpdater) => void;
  t: (key: string) => string;
  translations?: Map<string, string>;
  overseasDialogueView?: boolean;
}) {
  const dialoguePresentation = overseasDialogueView && translations
    ? {
        direction: "english-to-chinese" as const,
        translations,
      }
    : undefined;
  return (
    <article className="script-document">
      <details
        className="script-production-notes is-document-section"
        id="script-overview"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("summary")) event.preventDefault();
        }}
        open
      >
        <summary>{t("workspace.productionNotes")}</summary>
        <div className="script-notes-help"><SectionHelp content={t("guide.productionNotes")} label={t("guide.openHelp")} /></div>
        <section className="script-overview">
          <strong>{t("workspace.hook")}</strong>
          <p data-script-field="本集钩子（hook）"><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => ({ ...current, hook: value }))} source={draft.hook} /></p>
          <strong>{t("workspace.synopsis")}</strong>
          <p data-script-field="剧情梗概（synopsis）"><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => ({ ...current, synopsis: value }))} source={draft.synopsis} /></p>
          <strong>本集出场人物</strong>
          <p data-script-field="本集出场人物（episode_cast）">{(draft.episode_cast ?? draft.scenes.flatMap((scene) => scene.character_refs ?? scene.dialogues.map((line) => line.chinese_character_name || line.character_name))).filter(Boolean).join("、") || "待补充"}</p>
          <strong>使用场地</strong>
          <p data-script-field="使用场地（locations）">{(draft.locations ?? draft.scenes.map((scene) => scene.content_manifest?.location ?? scene.scene_heading ?? scene.setting_hint ?? scene.setting ?? scene.slug)).filter(Boolean).join("、") || "待补充"}</p>
          <strong>{t("workspace.nextQuestion")}</strong>
          <p data-script-field="下集问题（next_episode_question）"><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => ({ ...current, next_episode_question: value || null }))} source={draft.next_episode_question ?? ""} /></p>
        </section>
      </details>
      {draft.scenes.map((scene, sceneIndex) => (
        <section className="script-scene" id={`script-scene-${scene.scene_number}`} key={scene.scene_number}>
          <span>{String(scene.scene_number).padStart(2, "0")}</span>
          <div>
            <h2 data-script-field={`第${scene.scene_number}场场景标题（scenes.${sceneIndex}.${scene.setting_hint ? "setting_hint" : "slug"}）`}>
              <ScriptInlineText
                editable={editable}
                onChange={(value) => onDraftChange((current) => updateDraftScene(current, sceneIndex, (draftScene) => (
                  scene.setting_hint ? { ...draftScene, setting_hint: value } : { ...draftScene, slug: value }
                )))}
                source={overseasDialogueView
                  ? applyChineseCharacterNames(scene.setting_hint ?? scene.slug, characterNameMap)
                  : scene.setting_hint ?? scene.slug}
              />
            </h2>
            <details
              className="scene-planning-notes is-document-section"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("summary")) event.preventDefault();
              }}
              open
            >
              <summary>{t("workspace.productionNotes")}</summary>
              <div className="script-notes-help"><SectionHelp content={t("guide.productionNotes")} label={t("guide.openHelp")} /></div>
              {scene.setting_hint ? <p className="scene-setting" data-script-field={`第${scene.scene_number}场场景标识（scenes.${sceneIndex}.slug）`}><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => updateDraftScene(current, sceneIndex, (draftScene) => ({ ...draftScene, slug: value })))} source={scene.slug} /></p> : null}
              {scene.content_manifest ? (
                <dl className="scene-content-index">
                  <div><dt>出场人物</dt><dd data-script-field={`第${scene.scene_number}场出场人物（scenes.${sceneIndex}.character_refs）`}>{scene.content_manifest.character_refs.join("、") || "待补充"}</dd></div>
                  <div><dt>场景任务</dt><dd data-script-field={`第${scene.scene_number}场任务（scenes.${sceneIndex}.content_manifest.objective）`}>{scene.content_manifest.objective}</dd></div>
                  <div><dt>主要阻力</dt><dd data-script-field={`第${scene.scene_number}场阻力（scenes.${sceneIndex}.content_manifest.conflict）`}>{scene.content_manifest.conflict}</dd></div>
                  <div><dt>场景结果</dt><dd data-script-field={`第${scene.scene_number}场结果（scenes.${sceneIndex}.content_manifest.outcome）`}>{scene.content_manifest.outcome}</dd></div>
                  <div><dt>必要道具</dt><dd data-script-field={`第${scene.scene_number}场道具（scenes.${sceneIndex}.content_manifest.props）`}>{scene.content_manifest.props.join("、") || "无特别道具"}</dd></div>
                </dl>
              ) : null}
            </details>
            <div className="scene-body">{orderedScreenplayBody(scene).map((item) => {
              if (item.kind === "action") {
                return <p className="scene-action-line" data-script-field={`第${scene.scene_number}场动作${item.index + 1}（scenes.${sceneIndex}.character_actions.${item.index}）`} key={`action-${item.index}`}><span aria-hidden="true">△</span><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => updateDraftScene(current, sceneIndex, (draftScene) => ({ ...draftScene, character_actions: draftScene.character_actions.map((action, actionIndex) => actionIndex === item.index ? value : action) })))} source={overseasDialogueView ? applyChineseCharacterNames(item.action, characterNameMap) : item.action} /></p>;
              }
              const dialogue = item.dialogue;
              const prefix = `scenes.${sceneIndex}.dialogues.${item.index}`;
              const displaySpeaker = overseasDialogueView
                ? overseasDialogueSpeaker(
                    dialoguePresentation,
                    `${prefix}.character_name`,
                    dialogue.character_name,
                    characterNameMap,
                  )
                : clientDialogueSpeaker(
                    dialogue.character_name,
                    dialogue.character_name,
                  );
              return (
                <blockquote className="scene-dialogue" key={`dialogue-${item.index}`}>
                  <strong data-script-field={`第${scene.scene_number}场对白${item.index + 1}角色（${prefix}.character_name）`}><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => updateDraftDialogue(current, sceneIndex, item.index, (draftDialogue) => updateDialogueSpeakerFromDisplay(draftDialogue, value, overseasDialogueView)))} source={`${displaySpeaker.speaker}${displaySpeaker.marker ? ` (${displaySpeaker.marker})` : ""}`} /></strong>
                  <small data-script-field={`第${scene.scene_number}场对白${item.index + 1}意图（${prefix}.intent）`}><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => updateDraftDialogue(current, sceneIndex, item.index, (draftDialogue) => ({ ...draftDialogue, intent: value })))} source={overseasDialogueView ? applyChineseCharacterNames(dialogue.intent, characterNameMap) : dialogue.intent} /></small>
                  <p data-script-field={`第${scene.scene_number}场对白${item.index + 1}（${prefix}.text）`}>{overseasDialogueView
                    ? <OverseasDialogue editable={editable} onSourceChange={(value) => onDraftChange((current) => updateDraftDialogue(current, sceneIndex, item.index, (draftDialogue) => ({ ...draftDialogue, text: value })))} onTranslationChange={(value) => onDraftChange((current) => updateDraftDialogue(current, sceneIndex, item.index, (draftDialogue) => ({ ...draftDialogue, chinese_translation: value || null })))} source={dialogue.text} translated={translations?.get(`${prefix}.text`) ?? dialogue.chinese_translation ?? undefined} t={t} />
                    : <ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => updateDraftDialogue(current, sceneIndex, item.index, (draftDialogue) => ({ ...draftDialogue, text: value })))} source={dialogue.text} />}</p>
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
  editable,
  onSourceChange,
  onTranslationChange,
  source,
  translated,
  t,
}: {
  editable: boolean;
  onSourceChange: (value: string) => void;
  onTranslationChange: (value: string) => void;
  source: string;
  translated?: string;
  t: (key: string) => string;
}) {
  if (!translated) {
    return <ScriptInlineText editable={editable} onChange={onSourceChange} source={source} />;
  }
  return (
    <>
      <ScriptInlineText editable={editable} onChange={onSourceChange} source={source} />
      <span className="bilingual-translation">
        <small>{t("workspace.translationLabel")}</small>
        <ScriptInlineText editable={editable} onChange={onTranslationChange} source={translated} />
      </span>
    </>
  );
}

function ScriptInlineText({
  editable,
  onChange,
  source,
}: {
  editable: boolean;
  onChange: (value: string) => void;
  source: string;
}) {
  return (
    <span
      aria-readonly={!editable}
      className={editable ? "script-inline-editable" : undefined}
      contentEditable={editable}
      onBlur={(event) => {
        const value = event.currentTarget.textContent ?? "";
        if (value !== source) onChange(value);
      }}
      suppressContentEditableWarning
    >
      {source}
    </span>
  );
}

async function confirmLatestSeriesDelivery(
  projectId: string,
  updateProject: (
    projectId: string,
    patch: Partial<ScriptProject> | ((current: ScriptProject) => Partial<ScriptProject>),
  ) => Promise<boolean>,
  getProject: (projectId: string) => ScriptProject | undefined,
): Promise<boolean> {
  const beforeConfirmation = getProject(projectId)?.deliveryConfirmation;
  const saved = await updateProject(projectId, (latestProject) => {
    try {
      const episodeCount = latestProject.generationSettings.episodeCount;
      const plannedEpisodes = plannedEpisodesForProject(latestProject);
      const ready = Number.isInteger(episodeCount)
        && episodeCount > 0
        && plannedEpisodes.length === episodeCount
        && contiguousEpisodeCoverageThrough(
          latestProject.episodes.map((item) => item.episodeNumber),
        ) >= episodeCount
        && !isScriptGenerationRunning(projectId)
        && (!latestProject.activeGenerationTask
          || latestProject.activeGenerationTask.status === "completed")
        && plannedEpisodes.every(episodeHasSavedDraft);
      if (!ready) return {};
      const confirmation = buildSeriesDeliveryConfirmation(latestProject);
      return { deliveryConfirmation: confirmation };
    } catch {
      return {};
    }
  });
  if (!saved) {
    // updateProject is optimistic; clear a confirmation that could not be
    // persisted so a transient local state cannot leave the gate open.
    await updateProject(projectId, { deliveryConfirmation: undefined });
    return false;
  }
  const latestProject = getProject(projectId);
  return Boolean(
    latestProject
      && !isScriptGenerationRunning(projectId)
      && (!latestProject.activeGenerationTask
        || latestProject.activeGenerationTask.status === "completed")
      && latestProject.deliveryConfirmation !== beforeConfirmation
      && isSeriesDeliveryConfirmationCurrent(
        latestProject,
        latestProject.deliveryConfirmation,
      ),
  );
}

function collectProjectOverseasCharacterNames(
  project: Pick<
    ScriptProject,
    "canonicalCharacterNames" | "episodes" | "referenceMaterials" | "generationSettings"
  >,
): Map<string, string> {
  const names = new Map([
    ...Object.entries(project.canonicalCharacterNames ?? {}),
    ...canonicalCharacterNameMap(project.referenceMaterials),
  ]);
  for (const episode of [...plannedEpisodesForProject(project)].sort(
    (left, right) => left.episodeNumber - right.episodeNumber,
  )) {
    const draft = resolveWorkingDraft(episode);
    const embeddedView = buildEmbeddedOverseasDialogueView(
      draft,
      "zh-CN-short-drama",
      Object.fromEntries(names),
    );
    mergeOverseasCharacterNames(names, embeddedView);
  }
  return names;
}

function scriptBodyTargetCharacters(draft: GeneratedDraft): number | null {
  const target = draftMetadataNumber(
    draft,
    "script_body_reference_characters",
    "script_body_target_characters",
  );
  return target !== null && target > 0
    ? Math.round(target)
    : null;
}

function generationPerformanceDetails(draft: GeneratedDraft): {
  modelPassCount?: number;
  generationElapsedMs?: number;
  firstPassAccepted?: boolean;
} {
  const modelPassCount = draftMetadataNumber(draft, "model_pass_count");
  const generationElapsedMs = draftMetadataNumber(draft, "generation_elapsed_ms");
  const firstPassAccepted = draftMetadataBoolean(draft, "first_pass_accepted");
  return {
    ...(modelPassCount !== null
      ? { modelPassCount }
      : {}),
    ...(generationElapsedMs !== null
      ? { generationElapsedMs }
      : {}),
    ...(firstPassAccepted !== undefined
      ? { firstPassAccepted }
      : {}),
  };
}

function formatWorkflowError(
  error: unknown,
  t: (key: string) => string,
  fallbackKey: string,
): string {
  return error instanceof ScriptDraftSaveError || error instanceof GenerationSessionError
    ? error.message : userFacingError(error, t(fallbackKey));
}

function downloadFile(content: string, filename: string, type: string) {
  downloadBlob(new Blob([content], { type }), filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  // Keep the object URL alive until the browser has started the download.
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1000);
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
