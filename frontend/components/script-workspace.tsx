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
import type { DocumentOutlineEntry } from "@/components/document-outline";
import { WorkspaceSectionDirectory } from "@/components/workspace-section-directory";
import {
  PlanningCanvasCopilot,
  type PlanningCanvasAction,
  type PlanningCanvasMessage,
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
  modifyEpisodeDraft,
  reviewEpisodeDraft,
} from "@/lib/generation-client";
import { parseGeneratedDraft } from "@/lib/generated-draft-parser";
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
  automaticGenerationRecoveryDelayMs,
  completeRecoveryEpisode,
  continuePausedGenerationRecoveryTask,
  createGenerationRecoveryTask,
  episodeGenerationAgentRequestId,
  failGenerationRecoveryTask,
  finishGenerationRecoveryTask,
  firstMissingRecoveryEpisode,
  pauseGenerationRecoveryTask,
  resumeGenerationRecoveryTask,
  shouldAutoResumeGenerationRecovery,
  shouldAutomaticallyContinueScriptGeneration,
} from "@/lib/generation-recovery";
import {
  generateWithAutomaticTransientRetry,
} from "@/lib/generation-retry";
import {
  beginScriptGenerationTask,
  completeScriptGenerationTask,
  failScriptGenerationTask,
  isScriptGenerationAbortError,
  isScriptGenerationPauseRequested,
  isScriptGenerationPauseAbort,
  registerScriptGenerationAbortController,
  requestScriptGenerationPause,
  resumeScriptGenerationTask,
  updateScriptGenerationProgress,
  useScriptGenerationTask,
  waitForScriptGenerationResume,
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
  nextReadyScriptPartEpisode,
  plannedEpisodeBodyReference,
  plannedEpisodeDurationSeconds,
  plannedEpisodeShotCount,
  resolveEpisodeGenerationConstraints,
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
import { orderedScreenplayBody } from "@/lib/screenplay-body-order";
import {
  saveEpisodeArtifactOnServer,
  saveGenerationTaskOnServer,
} from "@/lib/project-sync";
import {
  loadEpisodePlans,
  loadStoryBible,
  loadActiveStoryPlanNodes,
  storyBibleIdForProject,
  type StoryBibleSelectionContext,
} from "@/lib/story-planning-client";
import { isRequestAborted, userFacingError } from "@/lib/api-error";
import type {
  EpisodeWorkspace,
  GeneratedDraft,
  GenerationBatchRecord,
  GenerationRecoveryTask,
  ScriptProject,
} from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";
import { canonicalCharacterNameMap } from "@/lib/canonical-character-names";
import {
  loadWorkspaceChatMessages,
  saveWorkspaceChatMessages,
} from "@/lib/workspace-section-memory";

type WorkspaceDocumentView = "current" | "modification" | "deepening" | "revised" | "final";
type SeriesExportMode = "episodes" | "collection";
type ScriptDraftUpdater = (draft: GeneratedDraft) => GeneratedDraft;

function normalizeEpisodeLifecycle(episode: EpisodeWorkspace): EpisodeWorkspace {
  const lockedAt = episode.lockedAt
    ?? (episode.status === "final" || episode.artifactRefs?.final
      ? episode.confirmedAt ?? episode.updatedAt
      : undefined);
  if (lockedAt) {
    const confirmedDraftJson = episode.confirmedDraftJson ?? episode.workingDraftJson;
    const lockedStatus = episode.status === "final"
      || Boolean(episode.finalizationResult?.master_script)
      || Boolean(episode.artifactRefs?.final)
      ? "final"
      : "confirmed";
    if (
      episode.status === lockedStatus
      && episode.lockedAt === lockedAt
      && episode.confirmedDraftJson === confirmedDraftJson
      && !episode.hasLocalDraftEdits
      && !episode.modificationCandidate
    ) return episode;
    return {
      ...episode,
      status: lockedStatus,
      confirmedDraftJson,
      confirmedAt: episode.confirmedAt ?? lockedAt,
      lockedAt,
      hasLocalDraftEdits: false,
      modificationCandidate: undefined,
    };
  }
  const status = episode.hasLocalDraftEdits || episode.modificationCandidate
    ? "editing"
    : "saved";
  return episode.status === status && !episode.lockedAt
    ? episode
    : { ...episode, status, lockedAt: undefined };
}

function episodeIsLocked(episode: EpisodeWorkspace): boolean {
  return Boolean(normalizeEpisodeLifecycle(episode).lockedAt);
}

function episodeHasSavedDraft(episode: EpisodeWorkspace): boolean {
  const normalized = normalizeEpisodeLifecycle(episode);
  return (
    normalized.status === "saved"
      || normalized.status === "confirmed"
      || normalized.status === "final"
  ) && !normalized.deepeningRun?.candidate_draft_master_script;
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
  const { getProject, isReady, updateProject } = useProjects();
  const { locale, t } = useLocale();
  const project = getProject(params.projectId);
  const backgroundScriptTask = useScriptGenerationTask(params.projectId);
  const [activeEpisodeNumber, setActiveEpisodeNumber] = useState(project?.activeEpisodeNumber ?? 1);
  const [selectedDocumentView, setSelectedDocumentView] = useState<WorkspaceDocumentView>("current");
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"save" | "confirm" | "modify" | "deepen" | "batch" | "finalize" | null>(null);
  const [scriptChatInstruction, setScriptChatInstruction] = useState("");
  const [scriptDocumentSelection, setScriptDocumentSelection] = useState<StoryBibleSelectionContext | null>(null);
  const [scriptChatMessages, setScriptChatMessages] = useState<PlanningCanvasMessage[]>(() => (
    loadWorkspaceChatMessages(params.projectId, "script") as PlanningCanvasMessage[]
  ));
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
  const finalizedRecoveryJobs = useRef(new Set<string>());
  const autoResumedRecoveryAttempts = useRef(new Set<string>());
  const automaticallyStartedScriptParts = useRef(new Set<string>());
  const pendingInlineDraftsRef = useRef(new Map<number, GeneratedDraft>());
  const candidateBaseInlineEditsRef = useRef(new Set<number>());
  const generateNextStageRef = useRef<(
    instruction?: string,
    requestedRange?: { startEpisode: number; endEpisode: number },
  ) => Promise<void>>(async () => undefined);
  const scriptModificationAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => scriptModificationAbortControllerRef.current?.abort(), []);

  useEffect(() => {
    saveWorkspaceChatMessages(params.projectId, "script", scriptChatMessages);
  }, [params.projectId, scriptChatMessages]);

  useEffect(() => {
    if (!project?.episodes.length) return;
    const episodes = project.episodes.map(normalizeEpisodeLifecycle);
    if (episodes.every((item, index) => item === project.episodes[index])) return;
    void updateProject(project.id, { episodes });
  }, [project?.episodes, project?.id]);

  const episode = project?.episodes.find((item) => item.episodeNumber === activeEpisodeNumber);
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
    if (
      !project
      || !scriptAccessible
    ) return;
    const nextEpisode = nextReadyScriptPartEpisode(
      project.episodes.map((item) => item.episodeNumber),
      project.episodePlansReadyThrough ?? 0,
      project.generationSettings.episodeCount,
    );
    if (!shouldAutomaticallyContinueScriptGeneration({
      planningPhase: project.planningSession?.phase,
      existingEpisodeCount: project.episodes.length,
      nextReadyEpisode: nextEpisode,
      generationIntent,
      busy: busyAction !== null,
      browserTaskStatus: backgroundScriptTask?.status,
      recoveryTaskStatus: project.activeGenerationTask?.status,
    })) return;

    const attemptKey = [
      project.id,
      project.storyBibleVersion ?? "legacy",
      project.episodePlansReadyThrough ?? 0,
      nextEpisode,
    ].join(":");
    if (automaticallyStartedScriptParts.current.has(attemptKey)) return;
    automaticallyStartedScriptParts.current.add(attemptKey);

    let launched = false;
    const timer = window.setTimeout(() => {
      launched = true;
      void generateNextStageRef.current();
    }, 500);
    return () => {
      window.clearTimeout(timer);
      if (!launched) automaticallyStartedScriptParts.current.delete(attemptKey);
    };
  }, [
    backgroundScriptTask?.status,
    busyAction,
    generationIntent,
    project?.activeGenerationTask?.jobId,
    project?.activeGenerationTask?.status,
    project?.episodePlansReadyThrough,
    project?.episodes.length,
    project?.generationSettings.episodeCount,
    project?.id,
    project?.planningSession?.phase,
    project?.storyBibleVersion,
    scriptAccessible,
  ]);

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
    const task = project?.activeGenerationTask;
    if (
      !project
      || !scriptAccessible
      || !shouldAutoResumeGenerationRecovery(
        task,
        project.episodes.map((item) => item.episodeNumber),
        backgroundScriptTask?.status,
      )
    ) return;

    const recoveryAttemptKey = `${task.jobId}:${task.attemptCount}`;
    if (autoResumedRecoveryAttempts.current.has(recoveryAttemptKey)) return;
    autoResumedRecoveryAttempts.current.add(recoveryAttemptKey);
    let launched = false;
    const timer = window.setTimeout(() => {
      launched = true;
      void generateNextStageRef.current(task.instruction ?? "", {
        startEpisode: task.startEpisode,
        endEpisode: task.endEpisode,
      });
    }, automaticGenerationRecoveryDelayMs(task));
    return () => {
      window.clearTimeout(timer);
      if (!launched) autoResumedRecoveryAttempts.current.delete(recoveryAttemptKey);
    };
  }, [
    backgroundScriptTask?.status,
    project?.activeGenerationTask?.attemptCount,
    project?.activeGenerationTask?.jobId,
    project?.activeGenerationTask?.lastError,
    project?.activeGenerationTask?.status,
    project?.episodes.length,
    project?.id,
    scriptAccessible,
  ]);

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
      <PendingScriptWorkspace
        activeEpisodeNumber={activeEpisodeNumber}
        batch={streamBatch}
        detailsOpen={generationDetailsOpen}
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
  const modificationDraft = currentEpisode.modificationCandidate?.candidate_generation_run.draft_master_script ?? null;
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
  const seriesMissingBilingualCount = currentProject.generationSettings.releaseRegion === "overseas"
    ? currentProject.episodes
      .filter((item) => item.episodeNumber <= currentProject.generationSettings.episodeCount)
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
  const metricDrafts = currentProject.episodes.map((item) => (
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
      .filter((item) => item.episodeNumber <= currentProject.generationSettings.episodeCount)
      .every(episodeHasSavedDraft);
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
    return pendingInlineDraftsRef.current.has(currentEpisode.episodeNumber)
      || candidateBaseInlineEditsRef.current.has(currentEpisode.episodeNumber);
  }

  function replaceEpisode(
    patch: Partial<EpisodeWorkspace>,
    projectPatch: Record<string, unknown> = {},
    options: { skipContinuitySync?: boolean } = {},
  ) {
    const now = new Date().toISOString();
    const episodes = currentProject.episodes.map((item) => item.episodeNumber === currentEpisode.episodeNumber
      ? { ...item, ...patch, updatedAt: now }
      : item);
    const continuityPatch = options.skipContinuitySync
      ? {}
      : synchronizeContinuity(
          currentProject.creativePrompt,
          currentProject.characters,
          episodes,
          currentProject.storyLines,
          currentProject.characterRelationships,
          currentProject.continuityStates,
        );
    updateProject(currentProject.id, {
      episodes,
      ...continuityPatch,
      ...projectPatch,
    });
  }

  function updateCurrentDraft(update: ScriptDraftUpdater) {
    if (!scriptInlineEditingEnabled) return;
    const episodeNumber = currentEpisode.episodeNumber;
    const sourceDraft = pendingInlineDraftsRef.current.get(episodeNumber) ?? currentDraft;
    const nextDraft = update(sourceDraft);
    if (JSON.stringify(nextDraft) === JSON.stringify(sourceDraft)) return;
    pendingInlineDraftsRef.current.set(episodeNumber, nextDraft);
    setMessage(null);
    void updateProject(currentProject.id, (latestProject) => ({
      episodes: latestProject.episodes.map((item) => item.episodeNumber === episodeNumber
        ? {
            ...item,
            status: "editing",
            generationRun: {
              ...item.generationRun,
              draft_master_script: nextDraft,
            },
            workingDraftJson: JSON.stringify(nextDraft, null, 2),
            confirmedDraftJson: undefined,
            hasLocalDraftEdits: true,
            confirmedAt: undefined,
            lockedAt: undefined,
            revisionRun: undefined,
            finalizationResult: undefined,
            updatedAt: new Date().toISOString(),
          }
        : item),
    }));
  }

  async function saveCurrentDraft() {
    if (
      currentEpisodeLocked
      || !currentEpisodeHasDirectEdits
      || currentEpisode.modificationCandidate
      || currentEpisode.deepeningRun?.candidate_draft_master_script
    ) return;
    const editedDraft = pendingInlineDraftsRef.current.get(currentEpisode.episodeNumber)
      ?? currentDraft;
    setBusyAction("save");
    setMessage(null);
    try {
      const artifactRef = await saveEpisodeArtifactOnServer({
        project: currentProject,
        episodeNumber: currentEpisode.episodeNumber,
        artifactKind: "draft",
        memoryLayer: "provisional",
        contentSchemaVersion: "draft_master_script.v1",
        contentPayload: editedDraft,
        lineageRefs: {
          draft_master_script_id: editedDraft.id,
          generation_strategy_id: currentEpisode.generationRun.generation_strategy_id,
        },
      });
      const saved = await updateProject(currentProject.id, (latestProject) => {
        const now = new Date().toISOString();
        const episodes = latestProject.episodes.map((item) => item.episodeNumber === currentEpisode.episodeNumber
          ? {
              ...item,
              status: "saved" as const,
              generationRun: {
                ...item.generationRun,
                draft_master_script: editedDraft,
              },
              workingDraftJson: JSON.stringify(editedDraft, null, 2),
              confirmedDraftJson: undefined,
              hasLocalDraftEdits: false,
              modificationCandidate: undefined,
              confirmedAt: undefined,
              lockedAt: undefined,
              deepeningRun: undefined,
              revisionRun: undefined,
              finalizationResult: undefined,
              artifactRefs: artifactRef
                ? { ...item.artifactRefs, draft: artifactRef }
                : item.artifactRefs,
              updatedAt: now,
            }
          : item);
        return {
          episodes,
          ...synchronizeContinuity(
            latestProject.creativePrompt,
            latestProject.characters,
            episodes,
            latestProject.storyLines,
            latestProject.characterRelationships,
            latestProject.continuityStates,
          ),
        };
      });
      if (!saved) throw new Error(t("workspace.saveFailed"));
      pendingInlineDraftsRef.current.delete(currentEpisode.episodeNumber);
      candidateBaseInlineEditsRef.current.delete(currentEpisode.episodeNumber);
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

  async function requestModification(
    instructionOverride?: string,
    selectionOverride: StoryBibleSelectionContext | null = scriptDocumentSelection,
  ) {
    if (currentEpisodeLocked) return;
    const submittedInstruction = (instructionOverride ?? scriptChatInstruction).trim();
    if (!submittedInstruction) return;
    if (currentEpisodeHasDirectEdits) {
      candidateBaseInlineEditsRef.current.add(currentEpisode.episodeNumber);
    } else {
      candidateBaseInlineEditsRef.current.delete(currentEpisode.episodeNumber);
    }
    const controller = new AbortController();
    scriptModificationAbortControllerRef.current = controller;
    setBusyAction("modify");
    setMessage(null);
    setScriptChatInstruction("");
    setScriptChatMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: submittedInstruction,
        quote: selectionOverride,
      },
    ]);
    setScriptDocumentSelection((current) => current === selectionOverride ? null : current);
    try {
      const latestDraft = pendingInlineDraftsRef.current.get(currentEpisode.episodeNumber)
        ?? currentDraft;
      const result = await modifyEpisodeDraft(
        currentEpisode.generationRun,
        latestDraft,
        submittedInstruction,
        controller.signal,
        selectionOverride,
        currentProject,
      );
      replaceEpisode({
        status: "editing",
        hasLocalDraftEdits: true,
        modificationCandidate: result,
      }, {}, { skipContinuitySync: true });
      setSelectedDocumentView("modification");
      setScriptChatInstruction("");
      setScriptChatMessages((current) => [
        ...current,
        { id: `assistant-${Date.now()}`, role: "assistant", text: "已生成正文修改候选，请在正文区审阅后确认采用。" },
      ]);
      setMessage(t("workspace.modificationReady"));
    } catch (error) {
      if (isRequestAborted(error, controller.signal)) {
        setScriptChatMessages((current) => [
          ...current,
          { id: `assistant-paused-${Date.now()}`, role: "assistant", text: "已暂停本次思考。你可以编辑刚才的消息后重新发送。" },
        ]);
      } else {
        setMessage(formatWorkflowError(error, t, "workspace.modificationFailed"));
      }
    } finally {
      if (scriptModificationAbortControllerRef.current === controller) {
        scriptModificationAbortControllerRef.current = null;
      }
      setBusyAction(null);
    }
  }

  function pauseScriptModification() {
    scriptModificationAbortControllerRef.current?.abort();
  }

  function editScriptChatMessage(
    messageId: string,
    text: string,
    quote?: StoryBibleSelectionContext | null,
  ) {
    setScriptChatMessages((current) => {
      const messageIndex = current.findIndex((item) => item.id === messageId);
      return messageIndex >= 0 ? current.slice(0, messageIndex) : current;
    });
    void requestModification(text, quote ?? null);
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

  async function applyModification() {
    if (!currentEpisode.modificationCandidate || currentEpisodeLocked) return;
    const candidateRun = currentEpisode.modificationCandidate.candidate_generation_run;
    setBusyAction("save");
    setMessage(null);
    try {
      const draftJson = JSON.stringify(candidateRun.draft_master_script, null, 2);
      const artifactRef = await saveEpisodeArtifactOnServer({
        project: currentProject,
        episodeNumber: currentEpisode.episodeNumber,
        artifactKind: "draft",
        memoryLayer: "provisional",
        contentSchemaVersion: "draft_master_script.v1",
        contentPayload: candidateRun.draft_master_script,
        lineageRefs: {
          draft_master_script_id: candidateRun.draft_master_script.id,
          generation_strategy_id: candidateRun.generation_strategy_id,
        },
      });
      replaceEpisode({
        status: "saved",
        generationRun: candidateRun,
        workingDraftJson: draftJson,
        confirmedDraftJson: undefined,
        hasLocalDraftEdits: false,
        modificationCandidate: undefined,
        confirmedAt: undefined,
        lockedAt: undefined,
        deepeningRun: undefined,
        revisionRun: undefined,
        finalizationResult: undefined,
        artifactRefs: artifactRef
          ? { ...currentEpisode.artifactRefs, draft: artifactRef }
          : currentEpisode.artifactRefs,
      });
      pendingInlineDraftsRef.current.delete(currentEpisode.episodeNumber);
      candidateBaseInlineEditsRef.current.delete(currentEpisode.episodeNumber);
      setSelectedDocumentView("current");
      setMessage(artifactRef
        ? t("workspace.modificationApplied")
        : `${t("workspace.modificationApplied")} ${t("workspace.artifactSaveWarning")}`);
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.saveFailed"));
    } finally {
      setBusyAction(null);
    }
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
      const reviewedRun = await reviewEpisodeDraft(currentEpisode.generationRun, deepeningDraft);
      const draftJson = JSON.stringify(reviewedRun.draft_master_script, null, 2);
      const artifactRef = await saveEpisodeArtifactOnServer({
        project: currentProject,
        episodeNumber: currentEpisode.episodeNumber,
        artifactKind: "draft",
        memoryLayer: "provisional",
        contentSchemaVersion: "draft_master_script.v1",
        contentPayload: reviewedRun.draft_master_script,
        lineageRefs: {
          draft_master_script_id: reviewedRun.draft_master_script.id,
          generation_strategy_id: reviewedRun.generation_strategy_id,
        },
      });
      replaceEpisode({
        status: "saved",
        generationRun: reviewedRun,
        workingDraftJson: draftJson,
        confirmedDraftJson: undefined,
        hasLocalDraftEdits: false,
        confirmedAt: undefined,
        lockedAt: undefined,
        deepeningRun: undefined,
        artifactRefs: artifactRef
          ? { ...currentEpisode.artifactRefs, draft: artifactRef }
          : currentEpisode.artifactRefs,
      });
      pendingInlineDraftsRef.current.delete(currentEpisode.episodeNumber);
      candidateBaseInlineEditsRef.current.delete(currentEpisode.episodeNumber);
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
    const createdAt = new Date().toISOString();
    const generatedEpisodes: EpisodeWorkspace[] = [];
    const batchRecordId = `batch-${currentProject.id}-${batchNumber}`;
    let activeStreamingEpisode = batchRange.startEpisode;
    let recoveryTask: GenerationRecoveryTask | undefined;
    const persistRecoveryTask = async (task: GenerationRecoveryTask) => {
      recoveryTask = task;
      try {
        const savedTask = await saveGenerationTaskOnServer(currentProject.id, task);
        recoveryTask = savedTask;
      } catch {
        recoveryTask = { ...task, serverBacked: false };
      }
      // The task endpoint is the durable fine-grained checkpoint. Persist the
      // resulting task snapshot to the large workspace only once per boundary.
      await updateProject(currentProject.id, { activeGenerationTask: recoveryTask });
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
              { isSeriesFinale: episodeNumber === batchRange.totalEpisodes },
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
      const generateEpisodeWithRetry = async (
        episodeNumber: number,
        continuityEpisodes: EpisodeWorkspace[],
      ): Promise<EpisodeWorkspace> => {
        const agentRequestId = recoveryTask
          ? episodeGenerationAgentRequestId(recoveryTask, episodeNumber)
          : `agent-request.${crypto.randomUUID()}`;
        while (true) {
          const controller = new AbortController();
          const unregister = registerScriptGenerationAbortController(
            currentProject.id,
            controller,
          );
          try {
            return await generateWithAutomaticTransientRetry({
              signal: controller.signal,
              generate: () => generateEpisode(
                episodeNumber,
                continuityEpisodes,
                agentRequestId,
                controller.signal,
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
          } catch (error) {
            if (
              !isScriptGenerationAbortError(error)
              || (
                !isScriptGenerationPauseRequested(currentProject.id)
                && !isScriptGenerationPauseAbort(controller.signal)
              )
            ) {
              throw error;
            }
            // The current request was deliberately stopped. Wait for the
            // shared pause gate, then retry this same episode with a fresh
            // controller and the same stable Agent request id.
            await pauseAtEpisodeBoundary();
          } finally {
            unregister();
          }
        }
      };
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

  generateNextStageRef.current = generateNextStage;

  function downloadSeriesData() {
    if (!allPlannedEpisodesSaved) {
      setMessage(t("workspace.exportSaveRequiredSeries"));
      return;
    }
    const ordered = currentProject.episodes
      .filter((item) => item.episodeNumber <= currentProject.generationSettings.episodeCount)
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
    if (!allPlannedEpisodesSaved) {
      setMessage(t("workspace.exportSaveRequiredSeries"));
      return;
    }

    const episodes = currentProject.episodes
      .filter((item) => item.episodeNumber <= currentProject.generationSettings.episodeCount)
      .slice()
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((item) => {
        const draft = resolveSavedDraft(item);
        if (!draft) throw new Error(t("workspace.exportSaveRequiredSeries"));
        const bilingualView = currentProject.generationSettings.releaseRegion === "overseas"
          ? resolveCurrentOverseasDialogueView(
              draft,
              projectCharacterNameMap,
            )
          : undefined;
        return {
          episodeNumber: item.episodeNumber,
          draft,
          bilingualView,
        };
      });
    const missingBilingualCount = formats.length
      && currentProject.generationSettings.releaseRegion === "overseas"
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
              <div className="candidate-decision-actions"><button className="primary-action" disabled={busyAction === "save"} onClick={() => void applyModification()} type="button">{busyAction === "save" ? t("workspace.saving") : t("workspace.applyCandidate")}</button><button className="outline-action" disabled={busyAction === "save"} onClick={() => { const hasInlineEdits = hasCurrentEpisodeInlineEdits(); candidateBaseInlineEditsRef.current.delete(currentEpisode.episodeNumber); replaceEpisode({ status: hasInlineEdits ? "editing" : "saved", hasLocalDraftEdits: hasInlineEdits, modificationCandidate: undefined }, {}, { skipContinuitySync: true }); setSelectedDocumentView("current"); }} type="button">{t("workspace.discardCandidate")}</button></div>
            </div>
          ) : null}
          {currentEpisode.deepeningRun && deepeningDraft ? (
            <div className="candidate-decision-bar"><div aria-label={t("workspace.compareCandidate")} className="candidate-preview-switch" role="group"><button aria-pressed={selectedDocumentView === "current"} onClick={() => setSelectedDocumentView("current")} type="button">{t("workspace.currentScript")}</button><button aria-pressed={selectedDocumentView === "deepening"} onClick={() => setSelectedDocumentView("deepening")} type="button">{t("workspace.version.deepening")}</button></div><span>{deepeningRun?.comparison_metadata?.summary ?? t("workspace.deepeningReady")}</span><div className="candidate-decision-actions"><button className="primary-action" disabled={busyAction === "save"} onClick={() => void applyDeepening()} type="button">{t("workspace.applyDeepening")}</button><button className="outline-action" onClick={() => { const hasInlineEdits = hasCurrentEpisodeInlineEdits(); candidateBaseInlineEditsRef.current.delete(currentEpisode.episodeNumber); replaceEpisode({ status: hasInlineEdits ? "editing" : "saved", deepeningRun: undefined, hasLocalDraftEdits: hasInlineEdits }); setSelectedDocumentView("current"); }} type="button">{t("workspace.keepCurrent")}</button></div></div>
          ) : null}
          {message ? <div className="inline-notice">{message}</div> : null}

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
                .replace("{count}", numberFormatter.format(currentProject.episodes.length))}
              {seriesExportProductionPackage ? ` ${t("workspace.exportProductionPackageSummary")}` : ""}
            </p>
            {seriesMissingBilingualCount > 0 && Object.values(seriesExportFormats).some(Boolean) ? (
              <div className="inline-notice">
                {t("workspace.exportBilingualRequired").replace("{count}", String(seriesMissingBilingualCount))}
              </div>
            ) : null}
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
    return <section className="script-live-generation-preview is-empty"><p>{t("workspace.stream.waitingForText")}</p></section>;
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
      setMessage(t("generation.backgroundScript")
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
    let activeStreamingEpisode = batchRange.startEpisode;
    let recoveryTask: GenerationRecoveryTask | undefined;
    const persistRecoveryTask = async (task: GenerationRecoveryTask) => {
      recoveryTask = task;
      try {
        const savedTask = await saveGenerationTaskOnServer(project.id, task);
        recoveryTask = savedTask;
      } catch {
        recoveryTask = { ...task, serverBacked: false };
      }
      // Avoid uploading the multi-megabyte workspace before and after the
      // lightweight server checkpoint for the same logical state transition.
      await updateProject(project.id, { activeGenerationTask: recoveryTask });
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
              { isSeriesFinale: episodeNumber === batchRange.totalEpisodes },
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
      const generateInitialEpisodeWithRetry = async (
        episodeNumber: number,
        continuityEpisodes: EpisodeWorkspace[],
      ): Promise<EpisodeWorkspace> => {
        const agentRequestId = recoveryTask
          ? episodeGenerationAgentRequestId(recoveryTask, episodeNumber)
          : `agent-request.${crypto.randomUUID()}`;
        while (true) {
          const controller = new AbortController();
          const unregister = registerScriptGenerationAbortController(
            project.id,
            controller,
          );
          try {
            return await generateWithAutomaticTransientRetry({
              signal: controller.signal,
              generate: () => generateInitialEpisode(
                episodeNumber,
                continuityEpisodes,
                agentRequestId,
                controller.signal,
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
          } catch (error) {
            if (
              !isScriptGenerationAbortError(error)
              || (
                !isScriptGenerationPauseRequested(project.id)
                && !isScriptGenerationPauseAbort(controller.signal)
              )
            ) {
              throw error;
            }
            await pauseAtEpisodeBoundary();
          } finally {
            unregister();
          }
        }
      };
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
              <p className="scene-purpose" data-script-field={`第${scene.scene_number}场目的（scenes.${sceneIndex}.purpose）`}><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => updateDraftScene(current, sceneIndex, (draftScene) => ({ ...draftScene, purpose: value })))} source={scene.purpose} /></p>
              <p data-script-field={`第${scene.scene_number}场剧情节拍（scenes.${sceneIndex}.beat_summary）`}><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => updateDraftScene(current, sceneIndex, (draftScene) => ({ ...draftScene, beat_summary: value })))} source={scene.beat_summary} /></p>
              {scene.scene_causality ? (
                <dl className="scene-causality">
                  <div><dt>{t("workspace.goal")}</dt><dd data-script-field={`第${scene.scene_number}场目标（scenes.${sceneIndex}.scene_causality.goal）`}><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => updateDraftScene(current, sceneIndex, (draftScene) => draftScene.scene_causality ? { ...draftScene, scene_causality: { ...draftScene.scene_causality, goal: value } } : draftScene))} source={scene.scene_causality.goal} /></dd></div>
                  <div><dt>{t("workspace.conflict")}</dt><dd data-script-field={`第${scene.scene_number}场冲突（scenes.${sceneIndex}.scene_causality.conflict）`}><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => updateDraftScene(current, sceneIndex, (draftScene) => draftScene.scene_causality ? { ...draftScene, scene_causality: { ...draftScene.scene_causality, conflict: value } } : draftScene))} source={scene.scene_causality.conflict} /></dd></div>
                  <div><dt>{t("workspace.outcome")}</dt><dd data-script-field={`第${scene.scene_number}场结果（scenes.${sceneIndex}.scene_causality.outcome）`}><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => updateDraftScene(current, sceneIndex, (draftScene) => draftScene.scene_causality ? { ...draftScene, scene_causality: { ...draftScene.scene_causality, outcome: value } } : draftScene))} source={scene.scene_causality.outcome} /></dd></div>
                  {scene.scene_causality.causal_link ? <div><dt>{t("workspace.causalLink")}</dt><dd data-script-field={`第${scene.scene_number}场因果衔接（scenes.${sceneIndex}.scene_causality.causal_link）`}><ScriptInlineText editable={editable} onChange={(value) => onDraftChange((current) => updateDraftScene(current, sceneIndex, (draftScene) => draftScene.scene_causality ? { ...draftScene, scene_causality: { ...draftScene.scene_causality, causal_link: value || null } } : draftScene))} source={scene.scene_causality.causal_link} /></dd></div> : null}
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

function resolveWorkingDraft(episode: EpisodeWorkspace): GeneratedDraft {
  if (episodeIsLocked(episode)) {
    return episode.finalizationResult?.master_script
      ?? parseWorkingDraft(episode.confirmedDraftJson)
      ?? parseWorkingDraft(episode.workingDraftJson)
      ?? episode.generationRun.draft_master_script;
  }
  return episode.finalizationResult?.master_script
    ?? parseWorkingDraft(episode.workingDraftJson)
    ?? parseWorkingDraft(episode.confirmedDraftJson)
    ?? episode.generationRun.draft_master_script;
}

function resolveSavedDraft(episode: EpisodeWorkspace): GeneratedDraft | null {
  if (!episodeHasSavedDraft(episode)) return null;
  return resolveWorkingDraft(episode);
}

function collectProjectOverseasCharacterNames(
  project: Pick<
    ScriptProject,
    "canonicalCharacterNames" | "episodes" | "referenceMaterials"
  >,
): Map<string, string> {
  const names = new Map([
    ...Object.entries(project.canonicalCharacterNames ?? {}),
    ...canonicalCharacterNameMap(project.referenceMaterials),
  ]);
  for (const episode of [...project.episodes].sort(
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

function parseWorkingDraft(value?: string): GeneratedDraft | null {
  return parseGeneratedDraft(value, {
    requireTitle: true,
    requireCompleteScenes: true,
  });
}

function formatWorkflowError(
  error: unknown,
  t: (key: string) => string,
  fallbackKey: string,
): string {
  return userFacingError(error, t(fallbackKey));
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
