"use client";

import { useCopilotProgress } from "@/lib/use-copilot-progress";
import type { CopilotProgress, CopilotProgressRun } from "@/lib/copilot-progress";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Download,
  FileSearch,
  GitBranch,
  ListTree,
  LockKeyhole,
  Plus,
  Pause,
  Play,
  Save,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { isScriptGenerationRunning } from "@/lib/script-generation-background";
import { workspaceSectionAccess } from "@/lib/workspace-stage";
import { hostProjectId } from "@/lib/host-session";
import { savePlanningRevisionSnapshot } from "@/lib/project-sync";
import { readPendingProjectCopy, rememberPendingProjectCopy, clearPendingProjectCopy } from "@/lib/pending-project-copy";
import { clearRebuildReceiptsAfterEdit, futureLeafRebuildCandidates, hasCurrentRoadmapRebuild, rebuildFutureRoadmapLeaf } from "@/lib/future-roadmap-rebuild";
import {
  completePlanningRevision, isPlanningRevisionActive, nextUnwrittenPlanningEpisode,
  persistPlanningRevisionTransition, planningRevisionEpisodeLocked, planningRevisionNodeLocked,
  planningRevisionSourceIssues, replaceRevisionRoadmap, retainRevisionRoadmaps, revisionRoadmapsForNode, startPlanningRevision,
} from "@/lib/planning-revision";
import { planningCharacterNameFormatter } from "@/lib/canonical-character-names";
import { preparePlanningBatchApproval } from "@/lib/planning-batch-approval";
import { characterMatchesReference } from "@/lib/character-reference";
import { editStoryPlanEpisodeBoundary, editStoryPlanNodeBoundary } from "@/lib/story-plan-boundary-editing";
import { assertStoryPlanEventEditPreservesSources } from "@/lib/story-plan-event-editing";

import { ArrowIcon } from "@/components/icons";
import { isHostScriptWorkflow } from "@/lib/host-navigation";
import { useHostScriptWorkflow } from "@/lib/use-host-script-workflow";
import { ProducedPlanAmendmentPanel } from "@/components/produced-plan-amendment-panel";
import type { DocumentOutlineEntry } from "@/components/document-outline";
import {
  PlanningCanvasCopilot,
  type PlanningCanvasAction,
  type PlanningCanvasMessage,
} from "@/components/planning-canvas-copilot";
import { StoryPlanDetailsEditor } from "@/components/story-plan-details-editor";
import { StoryPlanReview, planningReviewRange, type PlanningReviewFinding } from "@/components/story-plan-review";
import { EpisodePlanningCard } from "@/components/episode-planning-card";
import { EpisodePlanningNavigator } from "@/components/episode-planning-navigator";
import { GenerationDiagnostics } from "@/components/generation-diagnostics";
import { beginPlanningTaskProgress, usePlanningProgress } from "@/lib/planning-task-progress";
import { SelectionEditToolbar } from "@/components/selection-edit-toolbar";
import { SectionHelp } from "@/components/section-help";
import { WorkspaceSectionDirectory } from "@/components/workspace-section-directory";
import { isRequestAborted, userFacingError, PLANNING_CALL_BUDGET_EXHAUSTED_MESSAGE } from "@/lib/api-error";
import { downloadBlob } from "@/lib/download";
import {
  approvedDirectScriptCoverageThrough,
  approveEpisodeRoadmapItem,
  draftEpisodeRoadmapItem,
  episodeRoadmapReadinessIssues,
  isApprovedEpisodeRoadmap,
  isDirectScriptNode,
  mergeEpisodeRoadmaps,
  replaceEpisodeRoadmapItem,
  storyPlanNodeEpisodeSpan,
} from "@/lib/episode-generation-planning";
import {
  runFullEpisodeRoadmapGeneration,
  type EpisodeRoadmapGenerationProgress,
} from "@/lib/episode-roadmap-generation";
import { requireStoryPlanQuality, StoryPlanQualityError, storyPlanQualityRevisionMessage, storyPlanQualityFindingAdvice } from "@/lib/story-quality-gate";
import {
  auditStoryPlanQuality,
  storyPlanQualityAuditMatchesNodes,
  generateTopLevelStoryPlanNodes,
  confirmEpisodePlanMaterialization,
  confirmStoryPlanNode,
  loadChildStoryPlanNodes,
  loadActiveStoryPlanNodes,
  loadTopLevelStoryPlanNodes,
  loadStoryBible,
  modifyEpisodePlanItem,
  prepareEpisodePlanItem,
  rebuildFutureEpisodePlan,
  modifyStoryPlanNode,
  saveStoryPlanNodeDraft,
  saveStoryBibleDraft,
  storyBibleIdForProject,
  storyPlanningInputSignature,
  savePlanningSession,
  type PlanningRevisionMode,
  type StoryBible,
  type StoryBibleSelectionContext,
  type StoryPlanNode,
} from "@/lib/story-planning-client";
import { storyBibleRevisionSeed, storyPlanningRevisionSeed, unchangedRoadmapPrefixAfterNodeRevision } from "@/lib/story-planning-state";
import {
  enqueuePlanningTask,
  getPlanningTasks,
  requestPlanningPause,
  resumePlanningTasks,
  setPlanningTaskWorkerCount,
  usePlanningPauseState,
  usePlanningTask,
  useTrackedPlanningTask,
  waitForPlanningTaskResume,
} from "@/lib/story-planning-background";
import {
  runFullStoryTreeExpansion,
  type StoryTreeExpansionProgress,
} from "@/lib/story-tree-expansion";
import {
  episodeReadyStoryPlanLeaves,
  storyPlanQualityFrontierNodes,
  summarizeStoryPlanTreeProgress,
} from "@/lib/story-plan-tree-progress";
import {
  appendPlanningTurn,
  updatePlanningSession,
} from "@/lib/planning-session";
import {
  episodeRoadmapCharacters,
  episodeRoadmapLocations,
  episodeRoadmapSynopsis,
  storyPlanningFilename,
  toStoryPlanningMarkdown,
} from "@/lib/story-planning-export";
import {
  normalizeEpisodeDialogueLines,
} from "@/lib/generation-planning";
import {
  buildEpisodePlanImportDraft,
  fingerprintEpisodePlanSource,
  type EpisodePlanImportDraft,
} from "@/lib/episode-plan-import-adapter";
import {
  buildEpisodePlanMaterializationDraft,
  buildEpisodeRoadmapDraftsFromMaterialization,
  type EpisodePlanMaterializationDraft,
  type EpisodePlanMaterializerBlock,
  type EpisodePlanRoadmapDraftBlock,
} from "@/lib/episode-plan-materializer";
import { buildImportedSourceSnapshot } from "@/lib/input-import-adapter";
import {
  loadWorkspaceChatMessages,
  saveWorkspaceChatMessages,
  subscribeWorkspaceChatMessages,
} from "@/lib/workspace-section-memory";
import type {
  EpisodeDramaticUnit,
  EpisodeRoadmapItem,
  ProjectOutputMode,
  ScriptProject,
  StoryTreeQualityAudit,
} from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

type ProjectUpdate = Partial<ScriptProject>
  | ((current: ScriptProject) => Partial<ScriptProject>);
type ProjectUpdateHandler = (
  patch: ProjectUpdate,
) => Promise<boolean | void> | boolean | void;

const DRAMATIC_UNIT_FIELDS = [
  { key: "trigger", label: "触发事件", minLength: 3, maxLength: 300 },
  { key: "choice", label: "人物选择", minLength: 3, maxLength: 300 },
  { key: "visible_consequence", label: "可见后果", minLength: 3, maxLength: 300 },
  { key: "change_type", label: "变化类型", minLength: 2, maxLength: 40 },
  { key: "evidence_hint", label: "动作或对白证据", minLength: 3, maxLength: 300 },
] as const;
const MAX_DRAMATIC_UNITS = 7;

const NODE_QUICK_ACTIONS = [
  { id: "continue", label: "续写", instruction: "请补充选中内容之后的下一步发展，保持前后因果、人物状态和交接压力一致。" },
  { id: "polish", label: "润色", instruction: "请润色选中内容，只优化表达和节奏，不改变剧情事实。" },
  { id: "rewrite", label: "改写", instruction: "请改写选中内容，保留其在当前结构中的因果职责，并让前后文保持一致。" },
  { id: "expand", label: "扩写", instruction: "请扩写选中内容，补足必要的动作、因果或情绪信息，但不要越过当前规划层级。" },
  { id: "shorten", label: "精简", instruction: "请精简选中内容，删除重复和空泛表述，保留全部关键因果信息。" },
] satisfies Array<{ id: PlanningCanvasAction; label: string; instruction: string }>;

type GlobalRevisionEntry = {
  id: string;
  restore: () => Promise<void>;
};

type StoryPlanAssistantState = {
  progress: CopilotProgress | null;
  busy: boolean;
  disabled: boolean;
  instruction: string;
  nodeInstruction: string;
  messages: PlanningCanvasMessage[];
  onClearSelection: () => void;
  onEditMessage: (messageId: string, text: string, quote?: StoryBibleSelectionContext | null) => void;
  onInstructionChange: (value: string) => void;
  onUseNodeInstruction: (value: string) => void;
  onPause: () => void;
  onQuickAction: (action: PlanningCanvasAction, instruction: string) => void;
  onSubmit: () => void;
  scopeLabel: string;
  selection: StoryBibleSelectionContext | null;
};

type StoryPlanOutlineEntry = DocumentOutlineEntry & { nodeId: string };

type RoadmapRevisionMerger = (latest: EpisodeRoadmapItem) => EpisodeRoadmapItem;

const STORY_PLAN_ROOT_MARKER = "system_story_bible_root.v1";

function planningConfirmationProjectSnapshot(project: ScriptProject): string {
  const { serverSync: _sync, ...content } = project;
  return JSON.stringify(content);
}

function planningConfirmationNodeSnapshot(nodes: StoryPlanNode[]): string {
  return JSON.stringify([...nodes].sort((left, right) => left.node_id.localeCompare(right.node_id)));
}

function storyPlanNodeAnchor(nodeId: string): string {
  return `story-plan-node-${nodeId}`;
}

function storyPlanRoadmapAnchor(nodeId: string, episodeNumber: number): string {
  return `story-plan-roadmap-${nodeId}-${episodeNumber}`;
}

function revealPlanningTarget(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  // Keep editors mounted while folded, and reveal them before any directory jump.
  for (let parent: HTMLElement | null = target; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  if (target.hasAttribute("data-roadmap-episode")) {
    const details = target.querySelector<HTMLDetailsElement>(".episode-planning-details");
    if (details) details.open = true;
  }
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.focus({ preventScroll: true });
}

function episodeRoadmapDisplayTitle(item: EpisodeRoadmapItem): string {
  const explicit = item.episode_title?.trim();
  if (explicit) return explicit;
  return "本集待命名";
}

function sameEpisodeRoadmapIdentity(
  left: EpisodeRoadmapItem,
  right: EpisodeRoadmapItem,
): boolean {
  return left.source_node_id === right.source_node_id
    && left.source_node_version === right.source_node_version
    && left.story_bible_version === right.story_bible_version
    && left.episode_number === right.episode_number;
}

function buildStoryPlanOutline(
  activeNodes: StoryPlanNode[],
  fallbackTopLevelNodes: StoryPlanNode[],
  episodeRoadmaps: EpisodeRoadmapItem[],
): StoryPlanOutlineEntry[] {
  const nodes = activeNodes.filter((node) => (
    node.status !== "superseded" && node.decomposition_reason !== STORY_PLAN_ROOT_MARKER
  ));
  const nodeByParent = new Map<string, StoryPlanNode[]>();
  nodes.forEach((node) => {
    const parentKey = node.parent_node_id ?? "__root__";
    nodeByParent.set(parentKey, [...(nodeByParent.get(parentKey) ?? []), node]);
  });
  const root = activeNodes.find((node) => node.parent_node_id === null);
  const rootChildren = root ? nodeByParent.get(root.node_id) ?? [] : [];
  const roots = rootChildren.length
    ? rootChildren
    : (fallbackTopLevelNodes.length ? fallbackTopLevelNodes : nodeByParent.get("__root__") ?? []);

  const entries: StoryPlanOutlineEntry[] = [];
  const visit = (node: StoryPlanNode, depth: number, ancestry: Set<string>, outlineNumber: string) => {
    if (ancestry.has(node.node_id)) return;
    entries.push({
      id: storyPlanNodeAnchor(node.node_id),
      label: `${outlineNumber} ${node.title.trim() || "剧情分支"}`,
      depth,
      meta: node.planned_start_episode !== null && node.planned_end_episode !== null
        ? `${node.planned_start_episode}-${node.planned_end_episode}集`
        : undefined,
      nodeId: node.node_id,
    });
    episodeRoadmaps
      .filter((item) => (
        item.source_node_id === node.node_id
        && item.source_node_version === node.version
        && item.story_bible_version === node.story_bible_version
      ))
      .sort((left, right) => left.episode_number - right.episode_number)
      .forEach((item) => entries.push({
        id: storyPlanRoadmapAnchor(node.node_id, item.episode_number),
        label: `第${item.episode_number}集 ${episodeRoadmapDisplayTitle(item)}`,
        depth: depth + 1,
        meta: item.ending_hook_type || undefined,
        nodeId: node.node_id,
      }));
    const nextAncestry = new Set(ancestry).add(node.node_id);
    (nodeByParent.get(node.node_id) ?? [])
      .slice()
      .sort((left, right) => left.sequence_order - right.sequence_order)
      .forEach((child, index) => visit(
        child,
        depth + 1,
        nextAncestry,
        `${outlineNumber}.${index + 1}`,
      ));
  };
  roots
    .slice()
    .sort((left, right) => left.sequence_order - right.sequence_order)
    .forEach((node, index) => visit(node, 0, new Set(), String(index + 1)));
  return entries;
}

async function persistProjectUpdate(
  handler: ProjectUpdateHandler | undefined,
  patch: ProjectUpdate,
): Promise<void> {
  if (!handler) return;
  const durable = await handler(patch);
  if (durable === false) {
    throw new Error("项目检查点未能写入本地存储，请释放浏览器存储空间后继续。");
  }
}

export function StoryPlanNodePanel({ onProjectUpdate, project, storyBible }: {
  project: ScriptProject;
  storyBible: StoryBible;
  onProjectUpdate?: ProjectUpdateHandler;
}) {
  const { t } = useLocale();
  const { createProject, updateProject, getProject, syncProjectSnapshot, retryProjectSync, adoptServerProjectSnapshot } = useProjects();
  const router = useRouter();
  const scriptWorkflow = useHostScriptWorkflow();
  const [selectedPlanningEpisode, setSelectedPlanningEpisode] = useState<number | null>(null);
  const [fullPlanningStructure, setFullPlanningStructure] = useState(false);
  const projectCopyLocked = Boolean(hostProjectId());
  const [topLevelNodes, setTopLevelNodes] = useState<StoryPlanNode[]>([]);
  const [activeTreeNodes, setActiveTreeNodes] = useState<StoryPlanNode[]>([]);
  const [busy, setBusy] = useState<"load" | "generate" | "roadmap" | "review" | "revision" | "save" | "confirm" | null>("load");
  const revisionCopyRef = useRef<{ sourceProjectId: string; projectId: string } | null>(null);
  const [pendingRevisionCopyId, setPendingRevisionCopyId] = useState<string | null>(null);
  const [revisionCopyMissing, setRevisionCopyMissing] = useState(false);
  useEffect(() => {
    const copyId = readPendingProjectCopy(project.id, "planning");
    revisionCopyRef.current = copyId ? { sourceProjectId: project.id, projectId: copyId } : null;
    setPendingRevisionCopyId(copyId);
    setRevisionCopyMissing(false);
  }, [project.id]);
  const [message, setMessage] = useState<string | null>(null);
  const [planningFailure, setPlanningFailure] = useState<unknown>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [roadmapGenerationProgress, setRoadmapGenerationProgress] = useState<
    EpisodeRoadmapGenerationProgress | null
  >(null);
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const [treeCheckpointRefreshes, setTreeCheckpointRefreshes] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [treeUnlockedNodeIds, setTreeUnlockedNodeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expansionProgress, setExpansionProgress] = useState<StoryTreeExpansionProgress | null>(null);
  const [activeBranchInteractions, setActiveBranchInteractions] = useState<Set<string>>(
    () => new Set(),
  );
  const [episodePlanImportBusy, setEpisodePlanImportBusy] = useState(false);
  const [episodePlanImportMessage, setEpisodePlanImportMessage] = useState<string | null>(null);
  const [episodePlanImportDraft, setEpisodePlanImportDraft] = useState<EpisodePlanImportDraft | null>(
    () => project.episodePlanImportDraft ?? null,
  );
  const [episodePlanMaterializationBusy, setEpisodePlanMaterializationBusy] = useState<"preview" | "confirm" | null>(null);
  const [episodePlanMaterializationDraft, setEpisodePlanMaterializationDraft] = useState<EpisodePlanMaterializationDraft | null>(null);
  const [episodePlanMaterializationBlocks, setEpisodePlanMaterializationBlocks] = useState<EpisodePlanMaterializerBlock[]>([]);
  const [episodePlanRoadmapDraftBlocks, setEpisodePlanRoadmapDraftBlocks] = useState<EpisodePlanRoadmapDraftBlock[]>([]);
  const planningActionInFlightRef = useRef(false);
  const batchConfirmationScopeRef = useRef(0);
  useEffect(() => {
    batchConfirmationScopeRef.current += 1;
    return () => { batchConfirmationScopeRef.current += 1; };
  }, [project.id, storyBible.story_bible_id, storyBible.version]);
  const latestProjectRef = useRef(project);
  const latestTreeNodesRef = useRef(activeTreeNodes);
  latestTreeNodesRef.current = activeTreeNodes;
  const currentQualityAudit = storyPlanQualityAuditMatchesNodes(
    project.storyTreeQualityAudit, storyPlanQualityFrontierNodes(activeTreeNodes), project.episodeRoadmaps,
    { allowLegacyFailure: true, project },
  ) ? project.storyTreeQualityAudit : undefined;
  const revisingFuturePlanning = isPlanningRevisionActive(project);
  const planningLocked = project.planningSession?.phase === "script"
    && project.planningSession.status === "approved" && !revisingFuturePlanning;
  const qualityRevisionMessage = !planningLocked && currentQualityAudit
    && (revisingFuturePlanning
      ? scriptWorkflow === true && currentQualityAudit.findings.some(item => item.end_episode >= project.planningRevision!.startEpisode)
      : currentQualityAudit.status === "needs_revision" || currentQualityAudit.findings.length > 0)
    ? storyPlanQualityRevisionMessage(currentQualityAudit) : null;
  const [revisionStartEpisode, setRevisionStartEpisode] = useState(() => nextUnwrittenPlanningEpisode(project));
  useEffect(() => {
    setRevisionStartEpisode((current) => Math.max(current, nextUnwrittenPlanningEpisode(project)));
  }, [project.episodes]);
  const planningCheckpointSaved = project.planningSession?.status === "active";
  const assistantGettersRef = useRef(new Map<string, () => StoryPlanAssistantState>());
  const [activeAssistantNodeId, setActiveAssistantNodeId] = useState<string | null>(null);
  const [assistantFocusRequest, setAssistantFocusRequest] = useState(0);
  const [reviewAdviceNodeId, setReviewAdviceNodeId] = useState<string | null>(null);
  const [reviewAdviceRange, setReviewAdviceRange] = useState("");
  const [pendingReviewAdvice, setPendingReviewAdvice] = useState<PlanningReviewFinding | null>(null);
  const [pendingStageFocus, setPendingStageFocus] = useState(false);
  const [, setAssistantRevision] = useState(0);
  const [autoExpansionRequested, setAutoExpansionRequested] = useState(false);
  const [revisionHistory, setRevisionHistory] = useState<GlobalRevisionEntry[]>([]);
  // This is deliberately transient: a top-level direction applies to one
  // generation round and must not become the default for later layers.
  const [treeAuthorInstruction, setTreeAuthorInstruction] = useState("");
  const [treeInstructionOpen, setTreeInstructionOpen] = useState(false);
  const [stepByStep, setStepByStep] = useState(false);
  const [planningPartId, setPlanningPartId] = useState("");
  const planningPauseState = usePlanningPauseState(project.id);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const [outputModeChoiceOpen, setOutputModeChoiceOpen] = useState(false);
  const outputModeDialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (!outputModeChoiceOpen) return;
    const dialog = outputModeDialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, [outputModeChoiceOpen]);
  const importedPlanningSnapshot = useMemo(
    () => buildImportedSourceSnapshot(project),
    [project.creativePrompt, project.referenceMaterials],
  );
  const inputReadinessLevel = project.inputReadiness?.detectedLevel;
  const episodePlanImportAvailable = importedPlanningSnapshot.episodeNumbers.length > 0
    && (inputReadinessLevel === "episode_plan" || inputReadinessLevel === "script");
  const outlineEntries = useMemo(
    () => buildStoryPlanOutline(
      activeTreeNodes,
      topLevelNodes,
      project.episodeRoadmaps ?? [],
    ),
    [activeTreeNodes, project.episodeRoadmaps, topLevelNodes],
  );
  const hostEpisodePlans = useMemo(() => activeTreeNodes
    .flatMap(node => revisionRoadmapsForNode(project, node))
    .sort((left, right) => left.episode_number - right.episode_number), [activeTreeNodes, project]);
  const focusedEpisodePlan = hostEpisodePlans.find(item => item.episode_number === selectedPlanningEpisode)
    ?? hostEpisodePlans.find(item => !isApprovedEpisodeRoadmap(item)) ?? hostEpisodePlans[0];
  const focusedEpisodeNumber = scriptWorkflow === true && !fullPlanningStructure
    ? focusedEpisodePlan?.episode_number ?? null : null;
  useEffect(() => {
    setSelectedPlanningEpisode(null);
    setFullPlanningStructure(false);
  }, [project.id, storyBible.story_bible_id, storyBible.version]);
  useEffect(() => {
    if (focusedEpisodeNumber === null || !focusedEpisodePlan) return;
    setActiveAssistantNodeId(focusedEpisodePlan.source_node_id);
    setActiveOutlineId(storyPlanRoadmapAnchor(focusedEpisodePlan.source_node_id, focusedEpisodeNumber));
    const frame = window.requestAnimationFrame(() => {
      const card = document.getElementById(storyPlanRoadmapAnchor(focusedEpisodePlan.source_node_id, focusedEpisodeNumber));
      const details = card?.querySelector<HTMLDetailsElement>(".episode-planning-details");
      if (details) details.open = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedEpisodeNumber, focusedEpisodePlan?.source_node_id]);
  useEffect(() => {
    setTreeAuthorInstruction("");
    setTreeInstructionOpen(false);
  }, [project.id, storyBible.story_bible_id, storyBible.version]);
  useEffect(() => {
    latestProjectRef.current = project;
  }, [project]);
  useEffect(() => {
    setEpisodePlanImportDraft(project.episodePlanImportDraft ?? null);
    setEpisodePlanImportMessage(null);
    setEpisodePlanMaterializationDraft(null);
    setEpisodePlanMaterializationBlocks([]);
    setEpisodePlanRoadmapDraftBlocks([]);
  }, [project.id, project.episodePlanImportDraft]);
  useEffect(() => {
    setRevisionHistory([]);
    setPendingReviewAdvice(null);
    setReviewAdviceNodeId(null);
    setPendingStageFocus(false);
  }, [project.id, storyBible.story_bible_id, storyBible.version]);
  const topLevelTaskKey = `full-tree:${project.id}:${storyBible.story_bible_id}:${storyBible.version}:${project.planningRevisionEpoch ?? 0}`;
  const topLevelTask = usePlanningTask(topLevelTaskKey);
  const topLevelTaskActive = topLevelTask?.status === "queued" || topLevelTask?.status === "running";
  const roadmapBatchTaskKey = `episode-roadmap-all:${project.id}:${storyBible.story_bible_id}:${storyBible.version}:${project.planningRevisionEpoch ?? 0}`;
  const roadmapBatchTask = usePlanningTask(roadmapBatchTaskKey);
  const roadmapBatchTaskActive = roadmapBatchTask?.status === "queued"
    || roadmapBatchTask?.status === "running";
  const latestPlanningTask = topLevelTask && roadmapBatchTask
    ? topLevelTask.createdAt > roadmapBatchTask.createdAt ? topLevelTask : roadmapBatchTask
    : topLevelTask ?? roadmapBatchTask;
  const topLevelProgress = usePlanningProgress(topLevelTaskKey);
  const roadmapProgress = usePlanningProgress(roadmapBatchTaskKey);
  const planningGenerationProgress = [topLevelProgress, roadmapProgress]
    .filter((item): item is CopilotProgress => item !== null)
    .sort((left, right) => right.startedAt - left.startedAt)[0] ?? null;
  const updateBranchInteraction = useCallback((key: string, active: boolean) => {
    setActiveBranchInteractions((current) => {
      if (current.has(key) === active) return current;
      const next = new Set(current);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const registerAssistant = useCallback((nodeId: string, getter: () => StoryPlanAssistantState) => {
    assistantGettersRef.current.set(nodeId, getter);
    setActiveAssistantNodeId((current) => current ?? nodeId);
  }, []);
  const focusAssistant = useCallback((nodeId: string) => {
    setActiveAssistantNodeId(nodeId);
  }, []);
  const notifyAssistant = useCallback((nodeId: string) => {
    if (assistantGettersRef.current.has(nodeId)) setAssistantRevision((current) => current + 1);
  }, []);
  const markPlanningAwaitingReview = useCallback(() => {
    const current = latestProjectRef.current;
    if (current.planningSession?.status === "approved") return;
    const planningSession = updatePlanningSession(current, {
      phase: (current.episodeRoadmaps?.length ?? 0) > 0 ? "episode_roadmap" : "story_tree",
      status: "awaiting_review",
    });
    latestProjectRef.current = { ...current, planningSession };
    void persistProjectUpdate(onProjectUpdate, { planningSession }).catch(() => undefined);
    void savePlanningSession(current, planningSession)
      .then((saved) => persistProjectUpdate(onProjectUpdate, { planningSession: saved }))
      .catch(() => undefined);
  }, [onProjectUpdate]);
  const registerRevision = useCallback((restore: () => Promise<void>) => {
    // The old per-node setUndoHistory((history) => [...history, { kind: "node" ... flow
    // is intentionally replaced by one workbench-level revision stack.
    setRevisionHistory((current) => [
      ...current,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, restore },
    ].slice(-10));
    markPlanningAwaitingReview();
  }, [markPlanningAwaitingReview]);
  useEffect(() => {
    let active = true;
    setBusy("load");
    setMessage(null);
    setLoadError(null);
    setTopLevelNodes([]);
    setActiveTreeNodes([]);
    loadTopLevelStoryPlanNodes(
      project.id,
      storyBible.story_bible_id,
      storyBible.version,
    )
      .then(async (value) => {
        if (!active) return;
        setTopLevelNodes(value);
        const allNodes = await loadActiveStoryPlanNodes(
          project.id,
          storyBible.story_bible_id,
          storyBible.version,
        );
        if (!active) return;
        setActiveTreeNodes(allNodes);
        setTreeUnlockedNodeIds(new Set(
          allNodes.filter(isDirectScriptNode).map((node) => node.node_id),
        ));
        onProjectUpdate?.((current) => {
          const readyThrough = approvedDirectScriptCoverageThrough(allNodes, {
            episodeRoadmaps: current.episodeRoadmaps ?? [],
            roadmapRequired: current.episodeRoadmapRequired === true,
          });
          if ((current.episodePlansReadyThrough ?? 0) === readyThrough) return {};
          return { episodePlansReadyThrough: readyThrough || undefined };
        });
      })
      .catch((error) => {
        if (active) setLoadError(userFacingError(error, t("storyPlanNode.loadFailed")));
      })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [project.id, storyBible.story_bible_id, storyBible.version, t, loadAttempt]);

  useEffect(() => {
    if (topLevelTask?.status !== "completed") return;
    let active = true;
    Promise.all([
      loadTopLevelStoryPlanNodes(
        project.id,
        storyBible.story_bible_id,
        storyBible.version,
      ),
      loadActiveStoryPlanNodes(
        project.id,
        storyBible.story_bible_id,
        storyBible.version,
      ),
    ]).then(([topLevel, allNodes]) => {
      if (!active) return;
      setTopLevelNodes(topLevel);
      setActiveTreeNodes(allNodes);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [project.id, storyBible.story_bible_id, storyBible.version, topLevelTask?.status]);

  useEffect(() => {
    if (topLevelTask?.status !== "failed" || latestPlanningTask?.id !== topLevelTask.id) return;
    setBusy(null);
    setMessage((current) => current ?? userFacingError(
      new Error(topLevelTask.error ?? ""),
      t("storyPlanNode.expandLayerFailed"),
    ));
  }, [topLevelTask?.error, topLevelTask?.status, latestPlanningTask?.id, t]);

  useEffect(() => {
    if (roadmapBatchTask?.status !== "failed" || latestPlanningTask?.id !== roadmapBatchTask.id) return;
    setBusy(null);
    setMessage((current) => current ?? userFacingError(
      new Error(roadmapBatchTask.error ?? ""),
      t("storyPlanNode.roadmapAllFailed"),
    ));
  }, [roadmapBatchTask?.error, roadmapBatchTask?.status, latestPlanningTask?.id, t]);

  useEffect(() => {
    if (
      planningLocked
      || !autoExpansionRequested
      || busy
      || topLevelTaskActive
      || roadmapBatchTaskActive
      || activeBranchInteractions.size > 0
    ) return;
    setAutoExpansionRequested(false);
    setMessage((current) => current ?? t("storyPlanNode.revisionReadyContinue"));
  }, [activeBranchInteractions.size, autoExpansionRequested, busy, planningLocked, roadmapBatchTaskActive, t, topLevelTaskActive]);

  async function generateInteractiveTopLevel() {
    if (
      planningLocked
      || isPlanningRevisionActive(latestProjectRef.current)
      || planningActionInFlightRef.current
      || topLevelTaskActive
      || roadmapBatchTaskActive
      || activeBranchInteractions.size > 0
    ) return;
    planningActionInFlightRef.current = true;
    const requestProject = latestProjectRef.current;
    const roundInstruction = treeAuthorInstruction.trim();
    setTreeInstructionOpen(false);
    setBusy("generate");
    setMessage(null);
    try {
      const syncState = await syncProjectSnapshot(requestProject);
      if (syncState.status !== "synced") {
        planningActionInFlightRef.current = false;
        setBusy(null);
        setMessage(t("storyBible.syncRequired"));
        return;
      }
      const generated = await generateTopLevelStoryPlanNodes(
        requestProject,
        storyBible,
        roundInstruction,
      );
      const activeNodes = await loadActiveStoryPlanNodes(
        project.id,
        storyBible.story_bible_id,
        storyBible.version,
      );
      setTopLevelNodes(generated);
      setActiveTreeNodes(activeNodes);
      setTreeUnlockedNodeIds(new Set(generated.map((node) => node.node_id)));
      const planningSession = appendPlanningTurn(latestProjectRef.current, {
        scope: "story_tree",
        instruction: roundInstruction,
        outcome: "proposed",
      });
      await persistProjectUpdate(onProjectUpdate, {
        planningSession: {
          ...planningSession,
          treeAuthorInstruction: "",
          phase: "story_tree",
          status: "awaiting_review",
          activeNodeId: generated[0]?.node_id,
        },
      });
      void savePlanningSession(latestProjectRef.current, {
        ...planningSession,
        treeAuthorInstruction: "",
        phase: "story_tree",
        status: "awaiting_review",
        activeNodeId: generated[0]?.node_id,
      }).then((saved) => onProjectUpdate?.({ planningSession: saved })).catch(() => undefined);
      setTreeAuthorInstruction("");
      setMessage(t("storyPlanNode.generated"));
    } catch (error) {
      setMessage(userFacingError(error, t("storyPlanNode.generateFailed")));
    } finally {
      planningActionInFlightRef.current = false;
      setBusy(null);
    }
  }

  async function runWithPlanningProgress<T>(taskKey: string, run: (progress: CopilotProgressRun) => Promise<T>): Promise<T> {
    const progress = beginPlanningTaskProgress(taskKey);
    progress.mark("context", "正在整理剧情安排，已完成的内容会逐集保存。");
    try {
      const result = await run(progress);
      progress.finish("completed");
      return result;
    } catch (error) {
      setPlanningFailure(error);
      progress.finish("error");
      throw error;
    }
  }

  async function expandFullTree(guided = false) {
    if (
      planningLocked
      || isPlanningRevisionActive(latestProjectRef.current)
      || planningActionInFlightRef.current
      || topLevelTaskActive
      || roadmapBatchTaskActive
      || activeBranchInteractions.size > 0
    ) return;
    planningActionInFlightRef.current = true;
    const onlyTopLevelNodeId = planningPartId || undefined;
    // An explicitly selected part always stops after its next layer.
    guided = guided && !onlyTopLevelNodeId;
    const requestProject = latestProjectRef.current;
    const roundInstruction = treeAuthorInstruction.trim();
    setTreeInstructionOpen(false);
    setBusy("generate");
    setMessage(null);
    setPlanningFailure(null);
    try {
      const syncState = await syncProjectSnapshot(requestProject);
      if (syncState.status !== "synced") {
        planningActionInFlightRef.current = false;
        setBusy(null);
        setMessage(t("storyBible.syncRequired"));
        return;
      }
      const background = enqueuePlanningTask({
        key: topLevelTaskKey,
        kind: "full_tree",
        projectId: requestProject.id,
        label: guided ? "生成完整剧情规划" : t("storyPlanNode.expandAllRunning"),
        run: () => runWithPlanningProgress(topLevelTaskKey, async (progressRun) => {
          const tree = await runFullStoryTreeExpansion({
          project: requestProject,
          storyBible,
          authorInstruction: roundInstruction,
          stopAfterLayer: !guided,
          onlyTopLevelNodeId,
          beforeStep: async () => { await waitForPlanningTaskResume(topLevelTaskKey); },
          onActiveWorkersChange: (count) => setPlanningTaskWorkerCount(topLevelTaskKey, count),
          onProgress: (progress) => {
            setExpansionProgress(progress);
            progressRun.mark("requesting", "正在生成剧情结构，每完成一部分即保存。");
          },
          onQualityCheckpoint: async (audit) => {
            setActiveTreeNodes(await loadActiveStoryPlanNodes(
              requestProject.id, storyBible.story_bible_id, storyBible.version,
            ));
            await persistProjectUpdate(onProjectUpdate, { storyTreeQualityAudit: audit });
          },
          onTreeCheckpoint: (checkpoint) => {
            setTopLevelNodes(checkpoint.topLevelNodes);
            const completedNodeId = checkpoint.completedNodeId;
            if (completedNodeId) {
              setTreeUnlockedNodeIds((current) => {
                if (current.has(completedNodeId)) return current;
                const next = new Set(current);
                next.add(completedNodeId);
                return next;
              });
            }
            if (checkpoint.refreshNodeIds?.length) {
              setTreeCheckpointRefreshes((current) => {
                const next = new Map(current);
                for (const nodeId of checkpoint.refreshNodeIds ?? []) {
                  next.set(nodeId, (next.get(nodeId) ?? 0) + 1);
                }
                return next;
              });
            }
          },
          onRoadmapCheckpoint: async (checkpoint) => {
            await persistProjectUpdate(onProjectUpdate, (current) => ({
              episodeRoadmaps: mergeEpisodeRoadmaps(
                current.episodeRoadmaps ?? [],
                [checkpoint],
              ),
            }));
          },
          });
          if (!guided) return tree;
          setExpansionProgress(null);
          setActiveTreeNodes(tree.activeNodes);
          setBusy("roadmap");
          const roadmaps = await runFullEpisodeRoadmapGeneration({
            project: { ...requestProject, episodeRoadmaps: tree.episodeRoadmaps },
            storyBible,
            beforeStep: async () => { await waitForPlanningTaskResume(topLevelTaskKey); },
            onProgress: (progress) => {
              setRoadmapGenerationProgress(progress);
              if (progress.phase === "quality_review") progressRun.mark("validating", "正在检查已完成分集的衔接，内容已保存。");
            },
            onModelProgress: progressRun.onEvent,
            onQualityCheckpoint: async (audit) => {
              await persistProjectUpdate(onProjectUpdate, { storyTreeQualityAudit: audit });
            },
            onCheckpoint: async (checkpoint) => {
              await persistProjectUpdate(onProjectUpdate, (current) => ({
                episodeRoadmaps: mergeEpisodeRoadmaps(current.episodeRoadmaps ?? [], [checkpoint]),
              }));
            },
          });
          return { ...tree, ...roadmaps };
        }),
        onSuccess: async (result) => {
          setTopLevelNodes(result.topLevelNodes);
          setActiveTreeNodes(result.activeNodes);
          await persistProjectUpdate(onProjectUpdate, (current) => {
            // Stepwise expansion permits leaf edits; only the guided run owns
            // the roadmap result and keeps those edits locked until it finishes.
            const episodeRoadmaps = guided
              ? mergeEpisodeRoadmaps(current.episodeRoadmaps ?? [], result.episodeRoadmaps)
              : current.episodeRoadmaps ?? [];
            return {
              episodeRoadmaps,
              episodePlansReadyThrough: approvedDirectScriptCoverageThrough(result.activeNodes, {
                episodeRoadmaps,
                roadmapRequired: current.episodeRoadmapRequired === true,
              }) || undefined,
            };
          });
          setTreeRefreshToken((value) => value + 1);
          setExpansionProgress(null);
          setRoadmapGenerationProgress(null);
          const planningSession = appendPlanningTurn(latestProjectRef.current, {
            scope: "story_tree",
            instruction: roundInstruction,
            outcome: "proposed",
          });
          await persistProjectUpdate(onProjectUpdate, {
            planningSession: {
              ...planningSession,
              treeAuthorInstruction: "",
              phase: guided ? "episode_roadmap" : "story_tree",
              status: "awaiting_review",
              activeNodeId: result.activeNodes.find((node) => node.parent_node_id !== null && node.status !== "approved")?.node_id,
            },
          });
          void savePlanningSession(latestProjectRef.current, {
            ...planningSession,
            treeAuthorInstruction: "",
            phase: guided ? "episode_roadmap" : "story_tree",
            status: "awaiting_review",
            activeNodeId: result.activeNodes.find((node) => node.parent_node_id !== null && node.status !== "approved")?.node_id,
          }).then((saved) => onProjectUpdate?.({ planningSession: saved })).catch(() => undefined);
          setTreeAuthorInstruction("");
          setMessage(onlyTopLevelNodeId ? "这一部分的下一层已保存，请检查剧情安排。" : guided ? "分集规划已生成，请检查并批准各集内容。" : t("storyPlanNode.expandLayerComplete"));
          setBusy(null);
        },
        onFailure: async (error) => {
          try {
            const recovered = await loadTopLevelStoryPlanNodes(
              project.id,
              storyBible.story_bible_id,
              storyBible.version,
            );
            if (recovered.length) {
              setTopLevelNodes(recovered);
              setTreeRefreshToken((value) => value + 1);
            }
            const activeNodes = await loadActiveStoryPlanNodes(
              project.id,
              storyBible.story_bible_id,
              storyBible.version,
            );
            setActiveTreeNodes(activeNodes);
            await persistProjectUpdate(onProjectUpdate, (current) => ({
              episodePlansReadyThrough: approvedDirectScriptCoverageThrough(activeNodes, {
                episodeRoadmaps: current.episodeRoadmaps ?? [],
                roadmapRequired: current.episodeRoadmapRequired === true,
              }) || undefined,
            }));
          } catch {
            // Keep the original generation error because it is the actionable failure.
          }
          const partialFailureMessage = guided ? "规划未全部完成，已生成的内容已保留。点击继续生成规划可补齐。" : t("storyPlanNode.expandLayerFailed");
          const failureDetail = userFacingError(error, partialFailureMessage);
          setMessage(
            error instanceof StoryPlanQualityError ? error.message
              : failureDetail === PLANNING_CALL_BUDGET_EXHAUSTED_MESSAGE ? failureDetail
              : failureDetail === partialFailureMessage
              ? partialFailureMessage
              : `${partialFailureMessage} ${failureDetail}`,
          );
          setExpansionProgress(null);
          setRoadmapGenerationProgress(null);
          setBusy(null);
        },
      });
      void background.promise
        .finally(() => { planningActionInFlightRef.current = false; })
        .catch(() => undefined);
    } catch (error) {
      planningActionInFlightRef.current = false;
      setMessage(error instanceof StoryPlanQualityError ? error.message : userFacingError(error, t("storyPlanNode.expandLayerFailed")));
      setExpansionProgress(null);
      setBusy(null);
    }
  }

  async function generateAllEpisodeRoadmaps() {
    if (
      planningLocked
      || isPlanningRevisionActive(latestProjectRef.current)
      || planningActionInFlightRef.current
      || topLevelTaskActive
      || roadmapBatchTaskActive
      || activeBranchInteractions.size > 0
    ) return;
    planningActionInFlightRef.current = true;
    const requestProject = latestProjectRef.current;
    setBusy("roadmap");
    setMessage(null);
    setPlanningFailure(null);
    try {
      const syncState = await syncProjectSnapshot(requestProject);
      if (syncState.status !== "synced") {
        planningActionInFlightRef.current = false;
        setBusy(null);
        setMessage(t("storyBible.syncRequired"));
        return;
      }
      const background = enqueuePlanningTask({
        key: roadmapBatchTaskKey,
        kind: "episode_roadmap",
        projectId: requestProject.id,
        label: t("storyPlanNode.roadmapAllRunning"),
        run: () => runWithPlanningProgress(roadmapBatchTaskKey, progressRun => runFullEpisodeRoadmapGeneration({
          project: requestProject,
          storyBible,
          beforeStep: async () => { await waitForPlanningTaskResume(roadmapBatchTaskKey); },
          onProgress: (progress) => {
            setRoadmapGenerationProgress(progress);
            if (progress.phase === "quality_review") progressRun.mark("validating", "正在检查已完成分集的衔接，内容已保存。");
          },
          onModelProgress: progressRun.onEvent,
          onQualityCheckpoint: async (audit) => {
            await persistProjectUpdate(onProjectUpdate, { storyTreeQualityAudit: audit });
          },
          onCheckpoint: async (checkpoint) => {
            await persistProjectUpdate(onProjectUpdate, (current) => ({
              episodeRoadmaps: mergeEpisodeRoadmaps(
                current.episodeRoadmaps ?? [],
                [checkpoint],
              ),
            }));
          },
        })),
        onSuccess: async (result) => {
          setActiveTreeNodes(result.activeNodes);
          await persistProjectUpdate(onProjectUpdate, (current) => {
            const episodeRoadmaps = mergeEpisodeRoadmaps(
              current.episodeRoadmaps ?? [],
              result.episodeRoadmaps,
            );
            return {
              episodeRoadmaps,
              episodePlansReadyThrough: approvedDirectScriptCoverageThrough(
                result.activeNodes,
                { episodeRoadmaps, roadmapRequired: true },
              ) || undefined,
            };
          });
          setRoadmapGenerationProgress(null);
          const planningSession = appendPlanningTurn(latestProjectRef.current, {
            scope: "story_tree",
            instruction: "",
            outcome: "proposed",
          });
          await persistProjectUpdate(onProjectUpdate, {
            planningSession: {
              ...planningSession,
              treeAuthorInstruction: "",
              phase: "episode_roadmap",
              status: "awaiting_review",
            },
          });
          void savePlanningSession(latestProjectRef.current, {
            ...planningSession,
            treeAuthorInstruction: "",
            phase: "episode_roadmap",
            status: "awaiting_review",
          }).then((saved) => onProjectUpdate?.({ planningSession: saved })).catch(() => undefined);
          setMessage(t("storyPlanNode.roadmapAllComplete"));
          setBusy(null);
        },
        onFailure: (error) => {
          setRoadmapGenerationProgress(null);
          setMessage(error instanceof StoryPlanQualityError ? error.message : userFacingError(error, t("storyPlanNode.roadmapAllFailed")));
          setBusy(null);
        },
      });
      void background.promise
        .finally(() => { planningActionInFlightRef.current = false; })
        .catch(() => undefined);
    } catch (error) {
      planningActionInFlightRef.current = false;
      setMessage(error instanceof StoryPlanQualityError ? error.message : userFacingError(error, t("storyPlanNode.roadmapAllFailed")));
      setRoadmapGenerationProgress(null);
      setBusy(null);
    }
  }

  const treeProgress = summarizeStoryPlanTreeProgress(
    activeTreeNodes,
    project.episodeRoadmaps ?? [],
    project.generationSettings.episodeCount,
  );
  const roadmapGenerationComplete = treeProgress.plannedEpisodeCount > 0
    && treeProgress.generatedRoadmapCount === treeProgress.plannedEpisodeCount;
  const activeRoadmapSources = new Set(
    activeTreeNodes.map((node) => (
      `${node.node_id}:${node.version}:${node.story_bible_version}`
    )),
  );
  const draftedEpisodeNumbers = new Set((project.episodeRoadmaps ?? [])
    .filter((item) => activeRoadmapSources.has(`${item.source_node_id}:${item.source_node_version}:${item.story_bible_version}`))
    .map((item) => item.episode_number));
  const roadmapDraftsComplete = treeProgress.expansionComplete
    && Array.from({ length: project.generationSettings.episodeCount }, (_, index) => index + 1)
      .every((number) => draftedEpisodeNumbers.has(number));
  const qualityAuditRetryAvailable = roadmapDraftsComplete && !currentQualityAudit
    && !planningLocked && !revisingFuturePlanning;
  const pendingRoadmapReviewCount = treeProgress.expansionComplete
    ? (project.episodeRoadmaps ?? []).filter((item) => (
      activeRoadmapSources.has(
        `${item.source_node_id}:${item.source_node_version}:${item.story_bible_version}`,
      )
      && !isApprovedEpisodeRoadmap(item)
    )).length
    : 0;
  const pendingReviewNodes = activeTreeNodes.filter((node) => (
    node.status === "draft" && node.decomposition_reason !== STORY_PLAN_ROOT_MARKER
  ));
  const pendingReviewCount = pendingReviewNodes.length;
  const roadmapProgressLabel = t("storyPlanNode.roadmapOverallProgress")
    .replace("{generated}", String(treeProgress.generatedRoadmapCount))
    .replace("{total}", String(treeProgress.plannedEpisodeCount));
  const planningComplete = treeProgress.expansionComplete && roadmapGenerationComplete;
  const planningActionLabel = planningPartId ? "生成这一部分的下一层" : roadmapDraftsComplete && pendingRoadmapReviewCount > 0
    ? `检查待确认分集（${pendingRoadmapReviewCount}集）`
    : !stepByStep
      ? !topLevelNodes.length ? "生成完整规划" : "继续生成规划"
      : !topLevelNodes.length
      ? t("storyPlanNode.startInteractive")
      : !treeProgress.expansionComplete
        ? t("storyPlanNode.continueExpandAll")
        : treeProgress.generatedRoadmapCount > 0
          ? t("storyPlanNode.continueAllRoadmaps")
          : t("storyPlanNode.generateAllRoadmaps");
  const planningActionIcon = treeProgress.expansionComplete
        ? <ListTree aria-hidden="true" size={15} />
        : <GitBranch aria-hidden="true" size={15} />;
  const planningProgressDetail = scriptWorkflow === true && roadmapDraftsComplete
    ? `${draftedEpisodeNumbers.size} 集大纲草稿已就绪 · ${qualityRevisionMessage ? "请先处理待调整项" : "可继续修改或统一确认"}`
    : !stepByStep
    ? roadmapDraftsComplete
      ? `${draftedEpisodeNumbers.size} 集规划已生成 · ${qualityRevisionMessage ? `${currentQualityAudit?.findings.length || 1} 处待调整` : qualityAuditRetryAvailable ? "待检查剧情" : pendingRoadmapReviewCount ? `${pendingRoadmapReviewCount} 集待确认` : "可以开始正文"}`
      : `正在准备分集规划 · 已生成 ${draftedEpisodeNumbers.size}/${project.generationSettings.episodeCount} 集`
    : pendingReviewCount > 0
    ? t("storyPlanNode.layerReviewPending").replace("{count}", String(pendingReviewCount))
    : pendingRoadmapReviewCount > 0
      ? `还有 ${pendingRoadmapReviewCount} 集规划待确认`
    : !topLevelNodes.length
    ? t("storyPlanNode.waitingFirstLayer")
    : treeProgress.expansionComplete
      ? roadmapProgressLabel
      : t("storyPlanNode.readyLeafProgress")
        .replace("{count}", String(treeProgress.readyLeafCount));
  const episodePlanImportWarnings = (episodePlanImportDraft?.warnings ?? [])
    .map((warning) => typeof warning === "string" ? warning : warning.message)
    .filter(Boolean);
  const episodePlanImportMissing = episodePlanImportDraft?.missingEpisodeNumbers ?? [];
  const episodePlanImportDuplicates = episodePlanImportDraft?.duplicateEpisodeNumbers ?? [];
  const episodePlanImportDraftMatchesSource = Boolean(
    episodePlanImportDraft
    && episodePlanImportDraft.sourceDocument === importedPlanningSnapshot.document,
  );
  const episodePlanImportDraftMatchesLineage = Boolean(
    episodePlanImportDraft
    && (episodePlanImportDraft.storyBibleId == null
      || episodePlanImportDraft.storyBibleId === storyBible.story_bible_id)
    && (episodePlanImportDraft.storyBibleVersion == null
      || episodePlanImportDraft.storyBibleVersion === storyBible.version),
  );
  const episodePlanImportDraftIsCurrent = episodePlanImportDraftMatchesSource
    && episodePlanImportDraftMatchesLineage;
  const currentEpisodePlanMaterializationReceipt = (project.episodePlanMaterializations ?? []).find(
    (item) => item.sourceFingerprint === episodePlanImportDraft?.sourceFingerprint
      && item.storyBibleId === storyBible.story_bible_id
      && item.storyBibleVersion === storyBible.version,
  );

  async function retryStoryPlanQualityAudit() {
    if (
      !qualityAuditRetryAvailable
      || !onProjectUpdate
      || planningActionInFlightRef.current
      || busy
      || loadError
      || topLevelTaskActive
      || roadmapBatchTaskActive
      || activeBranchInteractions.size > 0
      || episodePlanImportBusy
      || episodePlanMaterializationBusy
    ) return;
    planningActionInFlightRef.current = true;
    setBusy("review");
    setMessage(null);
    try {
      const requestProject = getProject(project.id) ?? latestProjectRef.current;
      const syncState = await syncProjectSnapshot(requestProject);
      if (syncState.status !== "synced") {
        setMessage(t("storyBible.syncRequired"));
        return;
      }
      const leaves = storyPlanQualityFrontierNodes(latestTreeNodesRef.current);
      await requireStoryPlanQuality({
        runAudit: () => auditStoryPlanQuality(requestProject, storyBible, leaves),
        onCheckpoint: async (audit) => {
          let retained = false;
          await persistProjectUpdate(onProjectUpdate, (current) => {
            retained = current.id === requestProject.id
              && (current.planningRevisionEpoch ?? 0) === (requestProject.planningRevisionEpoch ?? 0)
              && storyPlanQualityAuditMatchesNodes(
                audit, storyPlanQualityFrontierNodes(latestTreeNodesRef.current), current.episodeRoadmaps,
                { project: current },
              );
            // Save only the audit so concurrent screenplay drafts remain intact.
            return retained ? { storyTreeQualityAudit: audit } : {};
          });
          if (!retained) {
            throw new Error("检查期间规划内容已变化，请重新检查最新规划。已有内容已保留。");
          }
        },
      });
      setMessage(scriptWorkflow === true ? "剧情检查通过。完成修改后，可统一确认大纲并进入正文。" : "剧情检查通过。请逐集查看并确认规划，再开始正文。");
    } catch (error) {
      setMessage(error instanceof StoryPlanQualityError
        ? error.message
        : userFacingError(error, "剧情质量检查未完成，请重试检查；已保存的分集规划会保留。"));
    } finally {
      planningActionInFlightRef.current = false;
      setBusy(null);
    }
  }

  async function inspectEpisodePlanSource() {
    if (
      !episodePlanImportAvailable
      || planningLocked
      || episodePlanImportBusy
      || busy
      || topLevelTaskActive
      || roadmapBatchTaskActive
      || activeBranchInteractions.size > 0
    ) return;
    setEpisodePlanImportBusy(true);
    setEpisodePlanImportMessage(null);
    try {
      const draft = {
        ...(await buildEpisodePlanImportDraft(importedPlanningSnapshot.document)),
        storyBibleId: storyBible.story_bible_id,
        storyBibleVersion: storyBible.version,
      } satisfies EpisodePlanImportDraft;
      // This is the only project mutation in this action. The parser result is
      // a source-audit artifact; it must not touch nodes, roadmaps, readiness,
      // planning phase, or approval state.
      await persistProjectUpdate(onProjectUpdate, {
        episodePlanImportDraft: draft,
      });
      setEpisodePlanImportDraft(draft);
      setEpisodePlanImportMessage(
        `已识别 ${draft.rows.length} 个来源分集；请先核对原文与警告。`,
      );
    } catch (error) {
      setEpisodePlanImportMessage(userFacingError(error, "分集原文检查失败，请稍后重试。"));
    } finally {
      setEpisodePlanImportBusy(false);
    }
  }

  async function buildCurrentEpisodePlanMaterialization(createdAt?: string) {
    if (!episodePlanImportDraft || !episodePlanImportDraftIsCurrent) return null;
    const sourceFingerprint = await fingerprintEpisodePlanSource(
      importedPlanningSnapshot.document,
    );
    const approvedEpisodeReadyNodes = activeTreeNodes
      .filter((node) => node.status === "approved" && node.expansion_status === "episode_ready")
      .map((node) => ({
        nodeId: node.node_id,
        version: node.version,
        storyBibleId: node.story_bible_id,
        storyBibleVersion: node.story_bible_version,
        plannedStartEpisode: node.planned_start_episode ?? undefined,
        plannedEndEpisode: node.planned_end_episode ?? undefined,
        status: node.status,
        expansionStatus: node.expansion_status,
      }));
    const currentNodeVersions = Object.fromEntries(
      approvedEpisodeReadyNodes.map((node) => [node.nodeId, node.version]),
    );
    const currentProject = latestProjectRef.current;
    return buildEpisodePlanMaterializationDraft({
      draft: episodePlanImportDraft,
      sourceDocument: importedPlanningSnapshot.document,
      currentSourceFingerprint: sourceFingerprint.value,
      approvedStoryBible: {
        id: storyBible.story_bible_id,
        version: storyBible.version,
      },
      approvedEpisodeReadyNodes,
      currentNodeVersions,
      occupations: [
        ...(currentProject.episodeRoadmaps ?? []).map((item) => ({ episodeNumber: item.episode_number, kind: "roadmap" as const })),
        ...(currentProject.episodes ?? []).map((item) => ({ episodeNumber: item.episodeNumber, kind: "body" as const })),
      ],
      createdAt,
    });
  }

  async function previewEpisodePlanMaterialization() {
    if (!episodePlanImportDraft || !episodePlanImportDraftIsCurrent || episodePlanMaterializationBusy) return;
    setEpisodePlanMaterializationBusy("preview");
    setEpisodePlanImportMessage(null);
    try {
      const result = await buildCurrentEpisodePlanMaterialization();
      if (!result) return;
      if (result.ok) {
        const roadmapResult = buildEpisodeRoadmapDraftsFromMaterialization(result.draft, {
          targetDurationSeconds: project.generationSettings.preferredEpisodeDurationMinutes * 60,
          plannedSceneCount: project.generationSettings.sceneCount,
        });
        setEpisodePlanMaterializationDraft(result.draft);
        setEpisodePlanMaterializationBlocks([]);
        setEpisodePlanRoadmapDraftBlocks(roadmapResult.blocks);
      } else {
        setEpisodePlanMaterializationDraft(null);
        setEpisodePlanMaterializationBlocks(result.blocks);
        setEpisodePlanRoadmapDraftBlocks([]);
      }
    } catch (error) {
      setEpisodePlanImportMessage(userFacingError(error, "分集规划预览失败，请重新读取资料。"));
    } finally {
      setEpisodePlanMaterializationBusy(null);
    }
  }

  async function confirmEpisodePlanMaterializationDraft() {
    if (
      !episodePlanMaterializationDraft
      || !episodePlanImportDraft
      || !episodePlanImportDraftIsCurrent
      || episodePlanMaterializationBusy
      || planningLocked
    ) return;
    const existingReceipt = (latestProjectRef.current.episodePlanMaterializations ?? []).find(
      (item) => item.sourceFingerprint === episodePlanMaterializationDraft.sourceFingerprint
        && item.storyBibleId === episodePlanMaterializationDraft.storyBibleId
        && item.storyBibleVersion === episodePlanMaterializationDraft.storyBibleVersion,
    );
    if (existingReceipt) {
      setEpisodePlanImportMessage(scriptWorkflow === true ? "这份分集大纲草稿已经保存，完成修改后可统一确认。" : "这份分集规划已经保存，可以继续逐集确认。");
      return;
    }
    const roadmapPreview = buildEpisodeRoadmapDraftsFromMaterialization(
      episodePlanMaterializationDraft,
      {
        targetDurationSeconds: project.generationSettings.preferredEpisodeDurationMinutes * 60,
        plannedSceneCount: project.generationSettings.sceneCount,
      },
    );
    const confirmationMessage = roadmapPreview.ok
      ? scriptWorkflow === true ? `确认加入 ${episodePlanMaterializationDraft.mappings.length} 集分集大纲草稿？你可以继续修改，之后统一确认整份大纲。` : `确认加入 ${episodePlanMaterializationDraft.mappings.length} 集分集规划？确认后仍需逐集检查，之后才能进入正文。`
      : `确认保存 ${episodePlanMaterializationDraft.mappings.length} 集分集规划资料？其中还有 ${roadmapPreview.blocks.length} 项内容需要补充，本次不会加入规划。`;
    if (!window.confirm(confirmationMessage)) return;

    setEpisodePlanMaterializationBusy("confirm");
    setEpisodePlanImportMessage(null);
    try {
      const revalidated = await buildCurrentEpisodePlanMaterialization(
        episodePlanMaterializationDraft.createdAt,
      );
      if (!revalidated?.ok
          || JSON.stringify(revalidated.draft) !== JSON.stringify(episodePlanMaterializationDraft)) {
        setEpisodePlanMaterializationDraft(null);
        setEpisodePlanMaterializationBlocks(revalidated?.ok ? [] : revalidated?.blocks ?? []);
        throw new Error("已有资料或规划发生变化，请重新读取并预览分集规划。");
      }
      const requestProject = latestProjectRef.current;
      const syncState = await syncProjectSnapshot(requestProject);
      if (syncState.status !== "synced") {
        throw new Error(syncState.error ?? t("storyBible.syncRequired"));
      }
      const receiptBase = await confirmEpisodePlanMaterialization(
        requestProject.id,
        revalidated.draft,
        importedPlanningSnapshot.document,
      );
      const roadmapResult = buildEpisodeRoadmapDraftsFromMaterialization(
        revalidated.draft,
        {
          targetDurationSeconds: requestProject.generationSettings.preferredEpisodeDurationMinutes * 60,
          plannedSceneCount: requestProject.generationSettings.sceneCount,
        },
      );
      const receipt = {
        ...receiptBase,
        roadmapDraftCount: roadmapResult.ok ? roadmapResult.roadmaps.length : 0,
      };
      const targetEpisodes = new Set(revalidated.draft.mappings.map((mapping) => mapping.episodeNumber));
      const materializationIsCurrent = (current: ScriptProject) => (
        current.id === requestProject.id
        && (current.storyBibleVersion ?? storyBible.version) === revalidated.draft.storyBibleVersion
        && buildImportedSourceSnapshot(current).document === importedPlanningSnapshot.document
        && !(current.planningSession?.phase === "script" && current.planningSession.status === "approved")
        && !(current.episodeRoadmaps ?? []).some((item) => targetEpisodes.has(item.episode_number))
        && !current.episodes.some((item) => targetEpisodes.has(item.episodeNumber))
        && revalidated.draft.mappings.every((mapping) => latestTreeNodesRef.current.some((node) => (
          node.node_id === mapping.targetNodeId
          && node.version === mapping.targetNodeVersion
          && node.story_bible_id === revalidated.draft.storyBibleId
          && node.story_bible_version === revalidated.draft.storyBibleVersion
          && node.status === "approved"
          && node.expansion_status === "episode_ready"
          && node.planned_start_episode === mapping.targetEpisodeRange.start
          && node.planned_end_episode === mapping.targetEpisodeRange.end
        )))
      );
      const conflictMessage = "已有资料或规划发生变化，请重新读取并预览分集规划。";
      const sessionProject = latestProjectRef.current;
      if (!materializationIsCurrent(sessionProject)) throw new Error(conflictMessage);
      let planningSession = sessionProject.planningSession;
      if (roadmapResult.ok) {
        planningSession = await savePlanningSession(
          sessionProject,
          updatePlanningSession(sessionProject, {
            phase: "episode_roadmap",
            status: "awaiting_review",
          }),
        );
      }
      let conflict = false;
      await persistProjectUpdate(onProjectUpdate, (current) => {
        // Recheck inside the local update so concurrent edits cannot be overwritten.
        if (!materializationIsCurrent(current)) {
          conflict = true;
          return {};
        }
        return {
          episodePlanMaterializations: [
            ...(current.episodePlanMaterializations ?? []).filter(
              (item) => item.materializationId !== receipt.materializationId,
            ),
            receipt,
          ],
          ...(roadmapResult.ok ? {
            episodeRoadmaps: mergeEpisodeRoadmaps(current.episodeRoadmaps ?? [], roadmapResult.roadmaps),
          } : {}),
          ...(planningSession && current.planningSession === sessionProject.planningSession ? { planningSession } : {}),
        };
      });
      if (conflict) throw new Error(conflictMessage);
      setEpisodePlanRoadmapDraftBlocks(roadmapResult.blocks);
      setEpisodePlanImportMessage(
        roadmapResult.ok
          ? scriptWorkflow === true ? `已整理 ${roadmapResult.roadmaps.length} 集大纲草稿，完成修改后可统一确认并进入正文。` : `已整理 ${roadmapResult.roadmaps.length} 集分集规划，逐集确认后即可进入正文。`
          : `资料已读入，但还有 ${roadmapResult.blocks.length} 项内容需要补充，暂时不能加入分集规划。`,
      );
    } catch (error) {
      setEpisodePlanImportMessage(userFacingError(error, "来源映射保存失败，请重新预览后重试。"));
    } finally {
      setEpisodePlanMaterializationBusy(null);
    }
  }
  async function undoLatestRevision() {
    const last = revisionHistory[revisionHistory.length - 1];
    if (planningLocked || !last || busy || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0) return;
    setMessage(null);
    try {
      await last.restore();
      setRevisionHistory((current) => current.slice(0, -1));
      markPlanningAwaitingReview();
      setMessage("已撤回上一版修改。可继续撤回之前的版本。");
    } catch (error) {
      setMessage(userFacingError(error, t("storyPlanNode.saveFailed")));
    }
  }
  async function savePlanningCheckpoint() {
    if (
      planningLocked
      || planningActionInFlightRef.current
      || busy
      || topLevelTaskActive
      || roadmapBatchTaskActive
      || activeBranchInteractions.size > 0
      || !topLevelNodes.length
    ) return;
    planningActionInFlightRef.current = true;
    const requestProject = latestProjectRef.current;
    setBusy("save");
    setMessage(null);
    try {
      const syncState = await syncProjectSnapshot(requestProject);
      if (syncState.status !== "synced") {
        throw new Error(syncState.error ?? t("storyBible.syncRequired"));
      }
      if (isPlanningRevisionActive(requestProject)) {
        setMessage(scriptWorkflow === true ? "后续大纲草稿已保存，完成调整后点击“确认后续大纲”，系统会检查前后衔接。" : "后续规划修订草稿已保存，仍需逐集批准及完整审校。");
        return;
      }
      const planningSession = updatePlanningSession(requestProject, {
        phase: planningComplete ? "episode_roadmap" : "story_tree",
        status: "active",
        treeAuthorInstruction: "",
      });
      const saved = await savePlanningSession(requestProject, planningSession);
      latestProjectRef.current = { ...requestProject, planningSession: saved };
      await persistProjectUpdate(onProjectUpdate, { planningSession: saved });
      setMessage("剧情规划已保存。你仍可继续修改；确认后规划将锁定。");
    } catch (error) {
      setMessage(userFacingError(error, t("storyPlanNode.planningConfirmFailed")));
    } finally {
      planningActionInFlightRef.current = false;
      setBusy(null);
    }
  }
  async function reopenFuturePlanning() {
    if (busy || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size) return;
    setBusy("revision");
    setMessage(null);
    try {
      const source = latestProjectRef.current;
      if (isScriptGenerationRunning(source.id) || getPlanningTasks(source.id).some((task) => task.status === "running" || task.status === "queued")) {
        throw new Error("请先停止当前任务并保存，再修订后续规划。");
      }
      const sync = await syncProjectSnapshot(source);
      if (sync.status !== "synced") throw new Error(sync.error ?? "当前项目尚未保存到服务器。");
      const current = getProject(source.id) ?? { ...source, serverSync: sync };
      const next = startPlanningRevision(current, revisionStartEpisode);
      const saved = await persistPlanningRevisionTransition(current, next, savePlanningRevisionSnapshot, adoptServerProjectSnapshot);
      latestProjectRef.current = saved;
      setRevisionHistory([]);
      setTreeRefreshToken((value) => value + 1);
      setMessage(scriptWorkflow === true ? `第${revisionStartEpisode}集起的大纲已重开，原文和原审核已保留。完成调整后统一确认后续大纲。` : `第${revisionStartEpisode}集起的规划已重开，原文和原审核已保留。请修订并确认各集规划，完成时会自动核对前后衔接。`);
    } catch (error) {
      setMessage(userFacingError(error, "未能开启后续修订，规划锁保持不变。"));
    } finally { setBusy(null); }
  }

  async function finishFuturePlanningRevision() {
    if (busy || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size) return;
    setBusy("review");
    setMessage(null);
    try {
      const source = latestProjectRef.current;
      const nodes = await loadActiveStoryPlanNodes(source.id, storyBible.story_bible_id, storyBible.version);
      const leaves = episodeReadyStoryPlanLeaves(nodes);
      if (approvedDirectScriptCoverageThrough(nodes, { episodeRoadmaps: source.episodeRoadmaps, roadmapRequired: true }) < source.generationSettings.episodeCount) {
        throw new Error("请先逐集批准本次修订范围内的全部规划。");
      }
      const audit = await auditStoryPlanQuality(source, storyBible, leaves);
      await persistProjectUpdate(onProjectUpdate, { storyTreeQualityAudit: audit });
      const reviewed = { ...(getProject(source.id) ?? source), storyTreeQualityAudit: audit };
      const sync = await syncProjectSnapshot(reviewed);
      if (sync.status !== "synced") throw new Error(sync.error ?? "最新审校尚未保存到服务器。");
      const current = getProject(source.id) ?? { ...reviewed, serverSync: sync };
      const next = completePlanningRevision(current, nodes, audit);
      const saved = await persistPlanningRevisionTransition(current, next, savePlanningRevisionSnapshot, adoptServerProjectSnapshot);
      latestProjectRef.current = saved;
      setRevisionHistory([]);
      setMessage(audit.status === "needs_revision" || audit.findings.length
        ? "本次未来范围及已保存正文衔接审校通过，修订已完成；历史问题仍保留可见，不代表全剧通过。可返回正文继续生成。"
        : "本次未来范围及已保存正文衔接审校通过，修订已完成并锁定；原规划与审核历史仍可查看。可返回正文继续生成。");
    } catch (error) {
      setMessage(userFacingError(error, "后续规划仍待修订或批准，正文生成继续暂停。"));
    } finally { setBusy(null); }
  }

  async function createPlanningRevision() {
    if (hostProjectId()) {
      setMessage("另起一版请在主站新建项目。");
      return;
    }
    if (busy || planningActionInFlightRef.current || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size) return;
    planningActionInFlightRef.current = true;
    setBusy("revision");
    setRevisionCopyMissing(false);
    setMessage(null);
    try {
      const source = latestProjectRef.current;
      const seed = storyPlanningRevisionSeed(source);
      const pendingId = readPendingProjectCopy(source.id, "planning");
      if (pendingId) revisionCopyRef.current = { sourceProjectId: source.id, projectId: pendingId };
      if (revisionCopyRef.current?.sourceProjectId !== source.id) {
        const created = await createProject(seed.draft);
        // Record immediately, before any later local or server save can fail.
        revisionCopyRef.current = { sourceProjectId: source.id, projectId: created.id };
        rememberPendingProjectCopy(source.id, "planning", created.id);
      }
      const copyId = revisionCopyRef.current.projectId;
      setPendingRevisionCopyId(copyId);
      let copy = getProject(copyId);
      if (!copy) {
        setRevisionCopyMissing(true);
        setMessage("上次的修订副本尚未加载或已删除。请先从项目列表核对；不会自动创建另一份副本。");
        return;
      }
      if (copy.id === source.id || (copy.sourceProjectId && copy.sourceProjectId !== source.id)) {
        setMessage("上次的副本记录与当前作品不匹配，请从项目列表核对，已有内容未修改。");
        return;
      }
      // Do not overwrite edits made in an already initialized copy on retry.
      if (!copy.sourceProjectId && !await updateProject(copyId, seed.patch)) throw new Error("修订副本尚未保存，请重试。");
      copy = getProject(copyId);
      if (!copy) throw new Error("无法读取已创建的修订副本，请从项目列表打开。");
      const sync = await retryProjectSync(copyId);
      if (sync?.status !== "synced") throw new Error(sync?.error ?? "修订副本尚未同步，请重试。");
      // Recover a successful server save whose response was interrupted.
      const draft = await loadStoryBible(copyId) ?? await saveStoryBibleDraft(storyBibleRevisionSeed(
        storyBible, copyId, storyBibleIdForProject(copyId), new Date().toISOString(),
      ), copy);
      const saved = await updateProject(copyId, {
        storyBibleInputSignature: storyPlanningInputSignature(copy),
        storyBibleVersion: draft.version,
        storyBibleStatus: draft.status,
      });
      if (!saved) throw new Error("总纲已复制，项目检查点尚未保存，请重试。");
      copy = getProject(copyId);
      if (!copy) throw new Error("无法读取修订副本，请从项目列表打开。");
      const finalSync = await retryProjectSync(copyId);
      if (finalSync?.status !== "synced") throw new Error(finalSync?.error ?? "修订副本尚未同步，请重试。");
      clearPendingProjectCopy(source.id, "planning");
      setPendingRevisionCopyId(null);
      if (latestProjectRef.current.id === source.id) {
        router.push(`/projects/${copyId}/${copy.storySynopsis?.status === "confirmed" ? "planning" : "synopsis"}`);
      }
    } catch (error) {
      setMessage(userFacingError(error, "创建修订副本未完成，请重试。"));
    } finally {
      planningActionInFlightRef.current = false;
      setBusy(null);
    }
  }

  function forgetMissingPlanningCopy() {
    if (busy || planningActionInFlightRef.current || !revisionCopyMissing) return;
    if (!window.confirm("请先在项目列表确认上次的修订副本已删除。清除续建记录后，再次创建会生成新的副本。确定清除？")) return;
    clearPendingProjectCopy(project.id, "planning");
    revisionCopyRef.current = null;
    setPendingRevisionCopyId(null);
    setRevisionCopyMissing(false);
    setMessage("续建记录已清除。需要新副本时，请再次点击创建。");
  }

  async function confirmPlanning(outputMode?: ProjectOutputMode) {
    if (isHostScriptWorkflow()) {
      await confirmWholePlanning();
      return;
    }
    if (isPlanningRevisionActive(latestProjectRef.current)) {
      await finishFuturePlanningRevision();
      return;
    }
    if (
      planningLocked
      || planningActionInFlightRef.current
      || !planningComplete
      || busy
      || topLevelTaskActive
      || roadmapBatchTaskActive
      || activeBranchInteractions.size > 0
    ) return;
    if (currentQualityAudit?.status === "needs_revision" || currentQualityAudit?.findings.length) {
      showQualityRevisionSuggestions();
      return;
    }
    const integratedScriptWorkflow = isHostScriptWorkflow();
    const effectiveOutputMode = integratedScriptWorkflow ? "script_only" : outputMode;
    if (!effectiveOutputMode) {
      setOutputModeChoiceOpen(true);
      return;
    }
    planningActionInFlightRef.current = true;
    const outputModeUpdate = integratedScriptWorkflow ? {} : { productionOutputMode: outputMode };
    const requestProject = {
      ...latestProjectRef.current,
      ...outputModeUpdate,
    };
    setOutputModeChoiceOpen(false);
    setBusy("confirm");
    setMessage(null);
    try {
      const finalNodes = await loadActiveStoryPlanNodes(
        requestProject.id,
        storyBible.story_bible_id,
        storyBible.version,
      );
      const finalProgress = summarizeStoryPlanTreeProgress(
        finalNodes,
        requestProject.episodeRoadmaps ?? [],
        requestProject.generationSettings.episodeCount,
      );
      if (
        !finalProgress.expansionComplete
        || finalProgress.plannedEpisodeCount !== requestProject.generationSettings.episodeCount
        || finalProgress.generatedRoadmapCount !== requestProject.generationSettings.episodeCount
      ) {
        throw new Error("单集路线图尚未完整覆盖全部集数，当前规划不能保存或进入正文。");
      }
      setBusy("review");
      const finalLeaves = episodeReadyStoryPlanLeaves(finalNodes);
      requestProject.storyTreeQualityAudit = await requireStoryPlanQuality({
        cachedAudit: storyPlanQualityAuditMatchesNodes(
          requestProject.storyTreeQualityAudit, finalLeaves, requestProject.episodeRoadmaps,
          { project: requestProject },
        ) ? requestProject.storyTreeQualityAudit : undefined,
        runAudit: () => auditStoryPlanQuality(requestProject, storyBible, finalLeaves),
        onCheckpoint: async (audit) => {
          await persistProjectUpdate(onProjectUpdate, { storyTreeQualityAudit: audit });
        },
      });
      setBusy("confirm");
      const syncState = await syncProjectSnapshot(requestProject);
      if (syncState.status !== "synced") {
        throw new Error(t("storyBible.syncRequired"));
      }
      const planningSession = updatePlanningSession(requestProject, {
        phase: "script",
        status: "approved",
        activeNodeId: undefined,
        treeAuthorInstruction: "",
      });
      const saved = await savePlanningSession(requestProject, planningSession);
      latestProjectRef.current = { ...requestProject, planningSession: saved };
      await persistProjectUpdate(onProjectUpdate, {
        ...outputModeUpdate,
        planningSession: saved,
      });
      setRevisionHistory([]);
      // Host navigation only opens the script stage. Generation remains an
      // explicit script action; standalone delivery keeps its existing path.
      router.push(isHostScriptWorkflow() ? `/projects/${requestProject.id}/workspace`
        : `/projects/${requestProject.id}/workspace?generate=1${effectiveOutputMode === "script_and_storyboard" ? "&autoStoryboard=1" : ""}`);
    } catch (error) {
      setMessage(error instanceof StoryPlanQualityError ? error.message : userFacingError(error, t("storyPlanNode.planningConfirmFailed")));
    } finally {
      planningActionInFlightRef.current = false;
      setBusy(null);
    }
  }

  async function confirmWholePlanning() {
    if (!isHostScriptWorkflow() || planningLocked || planningActionInFlightRef.current || busy || loadError
      || !onProjectUpdate || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size
      || episodePlanImportBusy || episodePlanMaterializationBusy) return;
    if (qualityRevisionMessage) { showQualityRevisionSuggestions(); return; }
    planningActionInFlightRef.current = true;
    setBusy("confirm");
    setMessage("正在核对整份大纲…");
    const source = getProject(project.id) ?? latestProjectRef.current;
    const requestScope = batchConfirmationScopeRef.current;
    const projectSnapshot = planningConfirmationProjectSnapshot(source);
    const nodeSnapshot = planningConfirmationNodeSnapshot(latestTreeNodesRef.current);
    const assertSourceCurrent = () => {
      const current = getProject(source.id) ?? latestProjectRef.current;
      if (batchConfirmationScopeRef.current !== requestScope || latestProjectRef.current.id !== source.id
        || planningConfirmationProjectSnapshot(current) !== projectSnapshot
        || planningConfirmationNodeSnapshot(latestTreeNodesRef.current) !== nodeSnapshot) {
        throw new Error("确认期间大纲或项目内容有了新修改，请查看最新内容后重新确认。已有内容已保留。");
      }
      return current;
    };
    try {
      const sync = await syncProjectSnapshot(source);
      if (sync.status !== "synced") throw new Error(sync.error ?? "大纲草稿尚未保存到服务器，请稍后重试确认。");
      const synced = { ...assertSourceCurrent(), serverSync: sync };
      const nodes = await loadActiveStoryPlanNodes(source.id, storyBible.story_bible_id, storyBible.version);
      assertSourceCurrent();
      if (planningConfirmationNodeSnapshot(nodes) !== nodeSnapshot) {
        throw new Error("服务器上的剧情结构已有更新，请重新读取后确认大纲。");
      }
      const unfinishedSource = nodes.find(node => node.status !== "approved");
      if (unfinishedSource) {
        setFullPlanningStructure(true);
        const anchor = storyPlanNodeAnchor(unfinishedSource.node_id);
        setActiveOutlineId(anchor);
        focusAssistant(unfinishedSource.node_id);
        window.requestAnimationFrame(() => revealPlanningTarget(anchor));
        throw new Error("请先完成上层剧情调整，并在完整剧情结构中确认修改，再统一确认大纲。");
      }
      const episodeRoadmaps = await preparePlanningBatchApproval({
        project: synced, nodes, prepare: prepareEpisodePlanItem,
        onProgress: (episodeNumber, total) => {
          assertSourceCurrent();
          setMessage(`正在核对第${episodeNumber}集大纲（共${total}集）…`);
        },
      });
      assertSourceCurrent();
      const prepared: ScriptProject = {
        ...synced, episodeRoadmaps,
        episodePlansReadyThrough: approvedDirectScriptCoverageThrough(nodes, { episodeRoadmaps, roadmapRequired: true }),
      };
      setBusy("review");
      setMessage("正在检查整份大纲的剧情与前后衔接…");
      const leaves = episodeReadyStoryPlanLeaves(nodes);
      let audit: StoryTreeQualityAudit | undefined;
      const retainFailedReview = async () => {
        if (!audit) return;
        assertSourceCurrent();
        const currentNodes = await loadActiveStoryPlanNodes(source.id, storyBible.story_bible_id, storyBible.version);
        assertSourceCurrent();
        if (planningConfirmationNodeSnapshot(currentNodes) !== nodeSnapshot) {
          throw new Error("审校期间剧情结构已有更新，原大纲已保留，请重新读取后确认。");
        }
        const draftRoadmaps = episodeRoadmaps.map(item => {
          const original = synced.episodeRoadmaps?.find(previous => sameEpisodeRoadmapIdentity(previous, item));
          return original && isApprovedEpisodeRoadmap(original) ? original : { ...item, status: "draft" as const };
        });
        const draftCandidate = {
          ...synced, episodeRoadmaps: draftRoadmaps, storyTreeQualityAudit: audit,
          episodePlansReadyThrough: approvedDirectScriptCoverageThrough(nodes, { episodeRoadmaps: draftRoadmaps, roadmapRequired: true }) || undefined,
          updatedAt: new Date().toISOString(),
        };
        try {
          latestProjectRef.current = await persistPlanningRevisionTransition(synced, draftCandidate, savePlanningRevisionSnapshot, adoptServerProjectSnapshot);
        } catch {
          throw new Error("剧情检查未通过，整理后的大纲草稿尚未保存。原稿已保留，请重试确认。");
        }
      };
      let candidate: ScriptProject;
      if (isPlanningRevisionActive(prepared)) {
        audit = await auditStoryPlanQuality(prepared, storyBible, leaves);
        assertSourceCurrent();
        try { candidate = completePlanningRevision(prepared, nodes, audit); }
        catch (error) { await retainFailedReview(); throw error; }
      } else {
        try {
          audit = await requireStoryPlanQuality({
            cachedAudit: storyPlanQualityAuditMatchesNodes(prepared.storyTreeQualityAudit, leaves, episodeRoadmaps, { project: prepared })
              ? prepared.storyTreeQualityAudit : undefined,
            runAudit: async () => {
              audit = await auditStoryPlanQuality(prepared, storyBible, leaves);
              assertSourceCurrent();
              return audit;
            },
          });
        } catch (error) { assertSourceCurrent(); await retainFailedReview(); throw error; }
        candidate = {
          ...prepared, storyTreeQualityAudit: audit,
          planningSession: updatePlanningSession(prepared, { phase: "episode_roadmap", status: "awaiting_review", treeAuthorInstruction: "" }),
          updatedAt: new Date().toISOString(),
        };
      }
      assertSourceCurrent();
      const currentNodes = await loadActiveStoryPlanNodes(source.id, storyBible.story_bible_id, storyBible.version);
      assertSourceCurrent();
      if (planningConfirmationNodeSnapshot(currentNodes) !== nodeSnapshot) {
        throw new Error("审校期间剧情结构已有更新，请重新读取后确认大纲。");
      }
      setBusy("confirm");
      setMessage("正在保存整份大纲的确认结果…");
      const saved = await persistPlanningRevisionTransition(synced, candidate, savePlanningRevisionSnapshot, adoptServerProjectSnapshot);
      if (batchConfirmationScopeRef.current !== requestScope) return;
      latestProjectRef.current = saved;
      if (!isPlanningRevisionActive(source)) {
        const savedSnapshot = planningConfirmationProjectSnapshot(saved);
        const approvedSession = await savePlanningSession(saved, updatePlanningSession(saved, {
          phase: "script", status: "approved", activeNodeId: undefined, treeAuthorInstruction: "",
        }));
        if (batchConfirmationScopeRef.current !== requestScope) return;
        await persistProjectUpdate(onProjectUpdate, current => {
          if (planningConfirmationProjectSnapshot(current) !== savedSnapshot
            || planningConfirmationNodeSnapshot(latestTreeNodesRef.current) !== nodeSnapshot) {
            throw new Error("保存期间大纲有了新修改，请重新确认最新版本。");
          }
          return { planningSession: approvedSession };
        });
        latestProjectRef.current = { ...saved, planningSession: approvedSession };
      }
      setRevisionHistory([]);
      router.push(`/projects/${source.id}/workspace`);
    } catch (error) {
      setMessage(error instanceof StoryPlanQualityError ? error.message
        : userFacingError(error, "整份大纲尚未确认完成，现有草稿已保留，请重试。"));
    } finally {
      planningActionInFlightRef.current = false;
      setBusy(null);
    }
  }

  function showQualityRevisionSuggestions() {
    const suggestions = document.getElementById("story-plan-quality-suggestions") as HTMLDetailsElement | null;
    if (suggestions?.tagName === "DETAILS") suggestions.open = true;
    const target = suggestions?.querySelector("summary") ?? document.getElementById("story-plan-feedback");
    const visibleTarget = suggestions?.tagName === "DETAILS" ? target : suggestions ?? target;
    visibleTarget?.scrollIntoView({ behavior: "smooth", block: "start" });
    visibleTarget?.focus({ preventScroll: true });
  }

  const reviewActionsDisabled = planningLocked || Boolean(busy) || Boolean(loadError)
    || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0
    || episodePlanImportBusy || Boolean(episodePlanMaterializationBusy);

  useEffect(() => {
    if (!pendingStageFocus || reviewActionsDisabled) return;
    const frame = window.requestAnimationFrame(() => {
      const toolbar = document.getElementById("planning-stage-toolbar");
      const action = toolbar?.querySelector<HTMLButtonElement>("button.primary-action:not(:disabled)");
      if (!action) return;
      toolbar?.scrollIntoView({ behavior: "smooth", block: "start" });
      action.focus({ preventScroll: true });
      setPendingStageFocus(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingStageFocus, reviewActionsDisabled, planningComplete, pendingRoadmapReviewCount, qualityAuditRetryAvailable]);

  function canUseReviewAssistant(finding: PlanningReviewFinding) {
    const node = latestTreeNodesRef.current.find(item => item.node_id === finding.node_id);
    const target = assistantGettersRef.current.get(finding.node_id)?.();
    return Boolean(node && node.version === finding.node_version && target && !target.disabled && !target.busy);
  }

  function useReviewAdvice(finding: PlanningReviewFinding, replace = false) {
    if (reviewActionsDisabled || !canUseReviewAssistant(finding)
      || !currentQualityAudit?.findings.some(item => item === finding)) return;
    const target = assistantGettersRef.current.get(finding.node_id)!();
    const advice = finding.repair_instruction?.trim() || storyPlanQualityFindingAdvice(finding);
    if (!replace && [target.instruction, target.nodeInstruction].some(value => value.trim() && value.trim() !== advice)) {
      setPendingReviewAdvice(finding);
      return;
    }
    target.onUseNodeInstruction(advice);
    if (scriptWorkflow === true) setFullPlanningStructure(true);
    focusAssistant(finding.node_id);
    setReviewAdviceNodeId(finding.node_id);
    setReviewAdviceRange(planningReviewRange(finding));
    setPendingReviewAdvice(null);
    setAssistantFocusRequest(value => value + 1);
  }

  function locateReviewFinding(finding: PlanningReviewFinding) {
    if (reviewActionsDisabled) return;
    if (scriptWorkflow === true) setFullPlanningStructure(true);
    focusAssistant(finding.node_id);
    const anchor = storyPlanNodeAnchor(finding.node_id);
    setActiveOutlineId(anchor);
    window.requestAnimationFrame(() => revealPlanningTarget(anchor));
  }

  function showNextEpisodeReview(confirmedEpisodeNumber: number) {
    const latest = getProject(project.id) ?? latestProjectRef.current;
    const currentSources = new Set(latestTreeNodesRef.current.map(node => (
      `${node.node_id}:${node.version}:${node.story_bible_version}`
    )));
    const pending = (latest.episodeRoadmaps ?? []).filter(item => (
      item.episode_number !== confirmedEpisodeNumber
      && currentSources.has(`${item.source_node_id}:${item.source_node_version}:${item.story_bible_version}`)
      && !isApprovedEpisodeRoadmap(item)
    )).sort((left, right) => left.episode_number - right.episode_number);
    const next = pending.find(item => item.episode_number > confirmedEpisodeNumber) ?? pending[0];
    if (next) {
      if (scriptWorkflow === true) {
        setSelectedPlanningEpisode(next.episode_number);
        setFullPlanningStructure(false);
      }
      const id = storyPlanRoadmapAnchor(next.source_node_id, next.episode_number);
      setActiveOutlineId(id);
      focusAssistant(next.source_node_id);
      window.requestAnimationFrame(() => revealPlanningTarget(id));
      setMessage(`第${confirmedEpisodeNumber}集规划已确认，请继续查看第${next.episode_number}集。`);
    } else {
      setMessage("分集规划已逐集确认，请在顶部继续下一步。");
      setPendingStageFocus(true);
    }
  }

  function runNextPlanningStage() {
    if (planningLocked || planningComplete || revisingFuturePlanning) return;
    if (qualityRevisionMessage) {
      showQualityRevisionSuggestions();
      return;
    }
    if (scriptWorkflow === true && roadmapDraftsComplete) {
      void confirmWholePlanning();
      return;
    }
    if (planningPartId) {
      void expandFullTree(false);
      return;
    }
    if (roadmapDraftsComplete && pendingRoadmapReviewCount > 0) {
      const pending = (project.episodeRoadmaps ?? []).filter((item) => (
        activeRoadmapSources.has(`${item.source_node_id}:${item.source_node_version}:${item.story_bible_version}`)
        && !isApprovedEpisodeRoadmap(item)
      )).sort((left, right) => left.episode_number - right.episode_number)[0];
      if (pending) {
        if (scriptWorkflow === true) {
          setSelectedPlanningEpisode(pending.episode_number);
          setFullPlanningStructure(false);
        }
        const id = storyPlanRoadmapAnchor(pending.source_node_id, pending.episode_number);
        setActiveOutlineId(id);
        window.requestAnimationFrame(() => revealPlanningTarget(id));
      }
      setMessage("查看本集规划后，点击“确认本集规划”，再继续下一集。");
      return;
    }
    if (treeProgress.expansionComplete && activeTreeNodes.length > 0
      && activeTreeNodes.every((node) => node.status === "approved")) {
      // Resume the remaining episode drafts directly. Walking the already
      // approved tree would review partial scenes before the leaf can finish.
      void generateAllEpisodeRoadmaps();
    } else if (!stepByStep) {
      void expandFullTree(true);
    } else if (!topLevelNodes.length) {
      void generateInteractiveTopLevel();
    } else if (!treeProgress.expansionComplete) {
      void expandFullTree();
    } else {
      void generateAllEpisodeRoadmaps();
    }
  }
  function exportConfirmedPlanning() {
    if (isHostScriptWorkflow() || !planningLocked || !planningComplete) return;
    downloadPlanningFile(
      toStoryPlanningMarkdown(project.title, activeTreeNodes, project.episodeRoadmaps ?? [], project.characters),
      storyPlanningFilename(project.title),
    );
  }
  const assistant = activeAssistantNodeId
    ? assistantGettersRef.current.get(activeAssistantNodeId)?.() ?? null
    : null;
  const selectOutlineEntry = useCallback((entry: DocumentOutlineEntry) => {
    const nodeEntry = outlineEntries.find((candidate) => candidate.id === entry.id);
    if (!nodeEntry) return;
    if (scriptWorkflow === true) {
      const episode = hostEpisodePlans.find(item => storyPlanRoadmapAnchor(item.source_node_id, item.episode_number) === entry.id);
      setFullPlanningStructure(!episode);
      if (episode) setSelectedPlanningEpisode(episode.episode_number);
    }
    setActiveOutlineId(entry.id);
    focusAssistant(nodeEntry.nodeId);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        revealPlanningTarget(entry.id);
      });
    }
  }, [focusAssistant, outlineEntries, scriptWorkflow, hostEpisodePlans]);
  const selectPlanningDirectoryEntry = useCallback((entry: DocumentOutlineEntry) => {
    if (entry.id === "workspace-section-planning") {
      setActiveOutlineId(null);
      return;
    }
    selectOutlineEntry(entry);
  }, [selectOutlineEntry]);

  function selectPlanningEpisode(episodeNumber: number) {
    const episode = hostEpisodePlans.find(item => item.episode_number === episodeNumber);
    if (!episode) return;
    setSelectedPlanningEpisode(episodeNumber);
    setFullPlanningStructure(false);
    setActiveOutlineId(storyPlanRoadmapAnchor(episode.source_node_id, episodeNumber));
    focusAssistant(episode.source_node_id);
  }

  return (
    <section className={`story-bible-panel story-plan-node-panel${scriptWorkflow === true ? " host-stage-content" : ""}${focusedEpisodeNumber !== null ? " is-focused-episode" : ""}`}>
      <div className="story-plan-workbench">
        <div className="story-plan-document-column">
          <SelectionEditToolbar
            actions={NODE_QUICK_ACTIONS}
            disabled={planningLocked || !assistant || assistant.disabled || assistant.busy}
            onAction={assistant?.onQuickAction ?? (() => undefined)}
            onClear={assistant?.onClearSelection ?? (() => undefined)}
            selection={planningLocked ? null : assistant?.selection ?? null}
          />
          <div className="story-plan-document-layout">
            <WorkspaceSectionDirectory
              activeEntryId={activeOutlineId}
              activeSection="planning"
              currentEntries={outlineEntries}
              onSelect={selectPlanningDirectoryEntry}
              projectId={project.id}
            />
            <div className="story-plan-document-surface">
          {scriptWorkflow === true && hostEpisodePlans.length > 0 ? <EpisodePlanningNavigator
            entries={hostEpisodePlans.map(item => ({
              episodeNumber: item.episode_number,
              title: episodeRoadmapDisplayTitle(item),
              status: item.source_revision_review ? "待调整" : isApprovedEpisodeRoadmap(item) ? "已确认" : "草稿",
            }))}
            currentEpisodeNumber={focusedEpisodePlan?.episode_number ?? null}
            totalEpisodes={project.generationSettings.episodeCount}
            generating={busy === "generate" || busy === "roadmap" || topLevelTaskActive || roadmapBatchTaskActive}
            fullStructure={fullPlanningStructure}
            onSelect={selectPlanningEpisode}
            onToggleStructure={() => setFullPlanningStructure(value => !value)}
          /> : null}
          <div className="story-plan-toolbar-stack">
          <div id="planning-stage-toolbar" className="document-edit-toolbar story-plan-document-toolbar" role="toolbar" aria-label="文字编辑与规划进度工具">
            <span className="story-plan-stage-summary">
              <small>{planningLocked ? <><LockKeyhole aria-hidden="true" size={13} />规划已确认</> : revisingFuturePlanning ? `正在修订第${project.planningRevision!.startEpisode}集起的规划` : planningProgressDetail}</small>
            </span>
            <button
              aria-label="撤回上一版修改"
              className="document-edit-toolbar-action story-plan-undo"
              disabled={planningLocked || !revisionHistory.length || Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0}
              onClick={() => void undoLatestRevision()}
              title="撤回上一版修改"
              type="button"
            >
              <Undo2 aria-hidden="true" size={15} />
              <span>撤回</span>
            </button>
            <div className="story-plan-stage-actions">
              {!planningLocked && !revisingFuturePlanning && !roadmapDraftsComplete ? (
                <div className="story-plan-round-control">
                  <button
                    aria-controls="story-tree-round-instruction"
                    aria-expanded={treeInstructionOpen}
                    aria-label="生成设置"
                    className={`story-plan-round-control-toggle${treeAuthorInstruction.trim() ? " has-value" : ""}`}
                    disabled={Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0}
                    onClick={() => setTreeInstructionOpen((current) => !current)}
                    title="生成设置"
                    type="button"
                  >
                    <SlidersHorizontal aria-hidden="true" size={14} />
                    <span>生成设置</span>
                    {treeAuthorInstruction.trim() ? <span aria-hidden="true" className="story-plan-round-control-dot" /> : null}
                    <ChevronDown aria-hidden="true" className={treeInstructionOpen ? "is-open" : undefined} size={13} />
                  </button>
                  {treeInstructionOpen ? (
                    <div className="story-plan-round-control-popover" id="story-tree-round-instruction">
                      {topLevelNodes.length > 0 && <label className="story-plan-round-control-heading">
                        <span>本次规划范围</span>
                        <select aria-label="本次规划范围" value={planningPartId} onChange={(event) => {
                          setPlanningPartId(event.target.value);
                          if (event.target.value) setStepByStep(true);
                        }}>
                          <option value="">所有部分</option>
                          {topLevelNodes.map((node, index) => <option key={node.node_id} value={node.node_id}>{index + 1} {node.title}</option>)}
                        </select>
                      </label>}
                      <label className="planning-stepwise-option"><input type="checkbox" checked={stepByStep} disabled={Boolean(planningPartId)} onChange={(event) => setStepByStep(event.target.checked)} />逐层规划，每层停下来检查</label>
                      {!treeProgress.expansionComplete && <>
                      <div className="story-plan-round-control-heading">
                        <label htmlFor="story-tree-author-instruction">{stepByStep ? "本轮下一层要求" : "本次规划要求"}</label>
                        <small>仅作用于当前轮</small>
                      </div>
                      <div className="story-plan-direction-chips">
                        {["优先推进主线冲突", "强化人物关系变化", "提前揭示关键秘密", "提高中段反转密度"].map((suggestion) => (
                          <button key={suggestion} onClick={() => setTreeAuthorInstruction((current) => current ? `${current}；${suggestion}` : suggestion)} type="button">{suggestion}</button>
                        ))}
                      </div>
                      <textarea
                        id="story-tree-author-instruction"
                        maxLength={2000}
                        onChange={(event) => setTreeAuthorInstruction(event.target.value)}
                        placeholder="指定事件顺序、人物选择、伏笔揭示、节奏或必须避免的内容……"
                        rows={2}
                        value={treeAuthorInstruction}
                      />
                      </>}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {planningLocked ? (
                <>
                  {workspaceSectionAccess(project).script ? (
                    <Link className="primary-action" href={`/projects/${project.id}/workspace`}>
                      <Play aria-hidden="true" size={15} />
                      {project.episodes.length ? "进入正文工作区" : "开始创作正文"}
                    </Link>
                  ) : null}
                  {scriptWorkflow === false ? <button
                    className="outline-action"
                    disabled={!planningComplete}
                    onClick={exportConfirmedPlanning}
                    type="button"
                  >
                    <Download aria-hidden="true" size={15} />
                    导出规划
                  </button> : null}
                </>
              ) : (
                <>
                  {topLevelNodes.length ? (
                    <button
                      aria-label="保存规划草稿"
                      className="workspace-tool planning-save-action"
                      disabled={Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0}
                      onClick={() => void savePlanningCheckpoint()}
                      title={busy === "save" ? "保存中" : planningCheckpointSaved ? "草稿已保存" : "保存规划草稿"}
                      type="button"
                    >
                      <Save aria-hidden="true" size={15} />
                      <span>{busy === "save" ? "保存中…" : "保存草稿"}</span>
                    </button>
                  ) : null}
                  {qualityRevisionMessage ? (
                    <button className="primary-action" disabled={reviewActionsDisabled}
                      onClick={showQualityRevisionSuggestions} type="button">处理待调整项</button>
                  ) : scriptWorkflow === true && (roadmapDraftsComplete || revisingFuturePlanning) ? (
                    <button className="primary-action" disabled={reviewActionsDisabled || !onProjectUpdate}
                      onClick={() => void confirmWholePlanning()} type="button">
                      {busy === "review" ? "正在检查整份大纲…" : busy === "confirm" ? "正在确认大纲…"
                        : revisingFuturePlanning ? "确认后续大纲" : "确认大纲并进入正文"}
                    </button>
                  ) : qualityAuditRetryAvailable ? (
                    <button
                      className="primary-action"
                      disabled={!onProjectUpdate || Boolean(loadError) || Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0 || episodePlanImportBusy || Boolean(episodePlanMaterializationBusy)}
                      onClick={() => void retryStoryPlanQualityAudit()}
                      type="button"
                    >
                      {busy === "review" ? "正在检查剧情…" : "重新检查剧情"}
                    </button>
                  ) : planningComplete || revisingFuturePlanning ? (
                    <button
                      className="primary-action"
                      disabled={Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0}
                      onClick={() => void confirmPlanning()}
                      title="保存并确认规划，进入正文"
                      type="button"
                    >
                      {busy === "confirm" ? t("storyPlanNode.confirmPlanningBusy") : <Check aria-hidden="true" size={15} />}
                      {busy === "confirm" ? null : revisingFuturePlanning ? "确认修订" : t("storyPlanNode.confirmPlanning")}
                    </button>
                  ) : (
                    <button
                      className={focusedEpisodeNumber !== null && pendingRoadmapReviewCount > 0 ? "outline-action" : "primary-action"}
                      disabled={Boolean(loadError) || revisingFuturePlanning || Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0}
                      onClick={runNextPlanningStage}
                      type="button"
                    >
                      {busy === "review" ? "正在核对规划…"
                        : busy === "generate" || topLevelTaskActive ? "正在整理规划…"
                        : busy === "roadmap" || roadmapBatchTaskActive ? "正在生成分集…"
                        : <>{planningActionIcon}{planningActionLabel}</>}
                    </button>
                  )}
                  {(topLevelTaskActive || roadmapBatchTaskActive) && <button className="outline-action" disabled={planningPauseState === "pausing"} onClick={() => planningPauseState === "running" ? requestPlanningPause(project.id) : resumePlanningTasks(project.id)} type="button">
                    {planningPauseState === "paused" ? <Play aria-hidden="true" size={15} /> : <Pause aria-hidden="true" size={15} />}
                    {planningPauseState === "running" ? "暂停" : planningPauseState === "pausing" ? "正在暂停" : "继续"}
                  </button>}
                </>
              )}
            </div>
          </div>
          {planningLocked && nextUnwrittenPlanningEpisode(project) <= project.generationSettings.episodeCount ? (
            <div className="inline-notice">
              <strong>修订后续规划</strong>
              <p>只重开尚无正文的后续集数，原规划和审核留档。已有正文对应的规划继续锁定。</p>
              <label>从第 <input aria-label="后续规划修订起始集" type="number" min={nextUnwrittenPlanningEpisode(project)} max={project.generationSettings.episodeCount} value={revisionStartEpisode} onChange={(event) => setRevisionStartEpisode(Number(event.target.value))} /> 集起</label>
              <button className="outline-action" disabled={Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0} onClick={() => void reopenFuturePlanning()} type="button">修订后续规划</button>
            </div>
          ) : null}
          {revisingFuturePlanning ? <div className="inline-notice">正在修订第{project.planningRevision!.startEpisode}集起的规划。已有正文保持不变，完成后可继续生成后续内容。</div> : null}
          <ProducedPlanAmendmentPanel
            project={project}
            storyBible={storyBible}
            disabled={Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0}
            onBusyChange={(active) => setBusy(active ? "revision" : null)}
            onApplied={(saved) => {
              latestProjectRef.current = saved;
              setRevisionHistory([]);
              setTreeRefreshToken((value) => value + 1);
            }}
          />
          {loadError ? <div className="inline-notice story-plan-feedback is-error" role="alert"><p>{loadError}</p><button className="outline-action" onClick={() => setLoadAttempt(attempt => attempt + 1)} type="button">重新读取已保存规划</button></div> : null}
          {message && !(qualityRevisionMessage && message.startsWith("剧情检查发现")) ? <div id="story-plan-feedback" tabIndex={-1} className={`inline-notice story-plan-feedback${latestPlanningTask?.status === "failed" ? " is-error" : ""}`} role="status">{message}</div> : null}
          {message && (planningFailure || latestPlanningTask?.status === "failed") ? <GenerationDiagnostics
            projectId={project.id} stage="episode-planning" error={planningFailure}
            requestId={planningGenerationProgress?.requestId}
            revision={project.serverSync?.workspaceRevision}
            savedEpisodes={draftedEpisodeNumbers.size}
          /> : null}
          </div>
          {episodePlanImportAvailable ? (
            <section className="story-plan-import-review" aria-labelledby="episode-plan-import-title">
              <div className="story-plan-import-review-header">
                <div>
                  <span className="section-kicker">已有资料</span>
                  <h3 id="episode-plan-import-title">分集规划资料</h3>
                </div>
                <button
                  className="outline-action"
                  disabled={planningLocked || episodePlanImportBusy || Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0}
                  onClick={() => void inspectEpisodePlanSource()}
                  type="button"
                >
                  <FileSearch aria-hidden="true" size={15} />
                  {episodePlanImportBusy ? "读取中" : episodePlanImportDraft ? "重新读取" : "读取分集规划"}
                </button>
              </div>
              <p className="story-plan-import-review-help">
                先看看已有分集规划是否完整，再决定是否纳入当前故事。
              </p>
          {episodePlanImportDraft && episodePlanImportDraftIsCurrent ? (
                <>
                  <div className="story-plan-import-review-stats" aria-label="分集原文检查结果">
                    <span>已读到 {episodePlanImportDraft.rows.length} 集</span>
                    <span>集号 {episodePlanImportDraft.episodeNumbers.length ? `${episodePlanImportDraft.episodeNumbers[0]}–${episodePlanImportDraft.episodeNumbers.at(-1)}` : "—"}</span>
                    {episodePlanImportMissing.length ? <span>缺少 {episodePlanImportDraft.missingEpisodeCount} 集</span> : <span>集数完整</span>}
                    {episodePlanImportDuplicates.length ? <span>重复 {episodePlanImportDuplicates.length} 集</span> : <span>没有重复集数</span>}
                  </div>
                  {episodePlanImportWarnings.length ? (
                    <details className="story-plan-import-review-warnings">
                      <summary>查看 {episodePlanImportWarnings.length} 条需要留意的信息</summary>
                      <ul>
                        {episodePlanImportWarnings.slice(0, 8).map((warning, index) => (
                          <li key={`${index}-${warning}`}>{warning}</li>
                        ))}
                      </ul>
                    </details>
                  ) : <small className="story-plan-import-review-ok">这份资料看起来完整。</small>}
                  <details className="story-plan-import-review-rows">
                    <summary>
                      查看前 {Math.min(12, episodePlanImportDraft.rows.length)} 集
                    </summary>
                    <ol>
                      {episodePlanImportDraft.rows.slice(0, 12).map((row) => (
                        <li key={`${row.ordinal}-${row.episodeNumber}-${row.sourceStart}`}>
                          <div className="story-plan-import-row-heading">
                            <strong>第{row.episodeNumber}集{row.headingTitle ? ` · ${row.headingTitle}` : ""}</strong>
                            <span className={`story-plan-import-row-status is-${row.completeness}`}>
                              {row.completeness === "complete" ? "内容完整" : row.completeness === "partial" ? "还需补充" : "仅有原文"}
                            </span>
                          </div>
                          <small>
                            {row.recognizedFields.length ? `已读出：${row.recognizedFields.slice(0, 6).join("、")}` : "暂未读出可用信息"}
                            {row.missingCoreFields.length ? `；还需补充：${row.missingCoreFields.join("、")}` : ""}
                          </small>
                          <pre>{row.bodyText.trim().slice(0, 220)}{row.bodyText.trim().length > 220 ? "…" : ""}</pre>
                        </li>
                      ))}
                    </ol>
                  </details>
                  <div className="story-plan-import-materialize-preview">
                    <div className="story-plan-import-materialize-actions">
                      <button
                        className="outline-action"
                        disabled={planningLocked || Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || Boolean(episodePlanMaterializationBusy)}
                        onClick={() => void previewEpisodePlanMaterialization()}
                        type="button"
                      >
                        <ListTree aria-hidden="true" size={15} />
                        {episodePlanMaterializationBusy === "preview" ? "整理中" : "预览如何纳入规划"}
                      </button>
                      {episodePlanMaterializationDraft ? (
                        <button
                          className="primary-action"
                          disabled={planningLocked || Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || Boolean(episodePlanMaterializationBusy) || Boolean(currentEpisodePlanMaterializationReceipt)}
                          onClick={() => void confirmEpisodePlanMaterializationDraft()}
                          type="button"
                        >
                          <Check aria-hidden="true" size={15} />
                          {currentEpisodePlanMaterializationReceipt
                            ? "已保存草稿"
                            : episodePlanMaterializationBusy === "confirm"
                              ? "保存中"
                              : "确认并加入规划"}
                        </button>
                      ) : null}
                    </div>
                    <small>预览不会改变当前规划。确认后，内容完整的分集会加入待审核的分集规划。</small>
                    {episodePlanMaterializationBlocks.length ? (
                      <details open className="story-plan-import-review-warnings">
                        <summary>需要补充（{episodePlanMaterializationBlocks.length} 项）</summary>
                        <ul>
                          {episodePlanMaterializationBlocks.slice(0, 12).map((item, index) => (
                            <li key={`${item.code}-${item.episodeNumber ?? "all"}-${index}`}>{item.message}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {episodePlanMaterializationDraft ? (
                      <details open className="story-plan-import-review-rows">
                        <summary>纳入规划预览（{episodePlanMaterializationDraft.mappings.length} 集）</summary>
                        <ol>
                          {episodePlanMaterializationDraft.mappings.slice(0, 12).map((mapping) => (
                            <li key={`${mapping.sourceRowOrdinal}-${mapping.episodeNumber}`}>
                              第{mapping.episodeNumber}集
                              {mapping.unresolvedFields.length ? ` · 还需补充：${mapping.unresolvedFields.join("、")}` : " · 内容完整"}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                    {episodePlanRoadmapDraftBlocks.length ? (
                      <details open className="story-plan-import-review-warnings">
                        <summary>分集规划还需补充（{episodePlanRoadmapDraftBlocks.length} 项）</summary>
                        <ul>
                          {episodePlanRoadmapDraftBlocks.slice(0, 12).map((item, index) => (
                            <li key={`${item.code}-${item.episodeNumber}-${index}`}>{item.message}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {currentEpisodePlanMaterializationReceipt ? (
                      <small className="story-plan-import-review-ok">
                        已保存 {currentEpisodePlanMaterializationReceipt.roadmapDraftCount} 集分集规划，等待审核。
                      </small>
                    ) : null}
                  </div>
                </>
              ) : (
                <small className="story-plan-import-review-preview">
                  {episodePlanImportDraft
                    ? "输入资料或故事总纲已经变化，请重新读取这份分集规划。"
                    : `已从输入资料中发现 ${importedPlanningSnapshot.episodeNumbers.length} 个集号；点击读取后查看内容。`}
              </small>
              )}
              {episodePlanImportMessage ? <div className="inline-notice" role="status">{episodePlanImportMessage}</div> : null}
            </section>
          ) : null}
          {currentQualityAudit?.future_revision_review?.status === "pass"
            && currentQualityAudit.future_revision_review.revision_id === project.planningRevision?.revisionId ? (
              <div className="inline-notice">第{currentQualityAudit.future_revision_review.start_episode}—{currentQualityAudit.future_revision_review.end_episode}集规划已经和已有正文衔接完成，可以继续推进。</div>
            ) : null}
          {currentQualityAudit?.findings.length && !planningLocked ? <StoryPlanReview
            findings={currentQualityAudit.findings}
            pendingReplacement={pendingReviewAdvice}
            disabled={reviewActionsDisabled}
            canUseAssistant={canUseReviewAssistant}
            onUseAssistant={finding => useReviewAdvice(finding)}
            onLocate={locateReviewFinding}
            onKeepInput={() => setPendingReviewAdvice(null)}
            onReplaceInput={() => { if (pendingReviewAdvice) useReviewAdvice(pendingReviewAdvice, true); }}
          /> : null}
          {currentQualityAudit?.findings.length && planningLocked ? (
            <details id="story-plan-quality-suggestions" className="story-plan-import-review story-plan-quality-record" aria-label="剧情修订建议" open={!planningLocked}>
              <summary>{planningLocked ? `历史修改建议（${currentQualityAudit.findings.length} 项）` : "需要调整的剧情"}</summary>
              {planningLocked ? <p>当前规划已确认。以下保留此前的检查意见，供后续修订时参考。</p> : null}
              {currentQualityAudit.findings.map((finding) => (
                <article key={`${finding.node_id}-${finding.node_version}`}>
                  <p><strong>第{finding.start_episode}—{finding.end_episode}集 · {finding.title}</strong></p>
                  <p>{storyPlanQualityFindingAdvice(finding)}</p>
                  <button className="outline-action" type="button" disabled={planningLocked || Boolean(busy)} onClick={() => {
                    focusAssistant(finding.node_id);
                    assistantGettersRef.current.get(finding.node_id)?.().onUseNodeInstruction(finding.repair_instruction);
                    document.getElementById(storyPlanNodeAnchor(finding.node_id))?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}>带入修改建议</button>
                </article>
              ))}
              {planningLocked ? <div>
                <p>以当前总纲创建一份新的规划版本，确认后重新规划。已有正文和分镜会继续保留。</p>
                <button className="outline-action" type="button" disabled={Boolean(busy) || projectCopyLocked}
                  aria-describedby={projectCopyLocked ? "host-planning-copy-hint" : undefined} onClick={() => void createPlanningRevision()}>
                  {busy === "revision" ? "正在创建修订副本…" : pendingRevisionCopyId ? "继续创建修订副本" : "以当前总纲创建修订副本"}
                </button>
                {projectCopyLocked ? <p id="host-planning-copy-hint">另起一版请在主站新建项目。可在当前项目中继续修订后续规划。</p> : null}
                {revisionCopyMissing ? <p><Link href="/">核对项目列表</Link>{" "}<button className="outline-action" type="button" disabled={Boolean(busy)} onClick={forgetMissingPlanningCopy}>副本已删除，清除续建记录</button></p> : null}
              </div> : null}
            </details>
          ) : null}
          {currentQualityAudit?.execution_requirements?.length ? (
            <section className="story-plan-import-review" aria-label="后续分集执行要求">
              <strong>后续分集需落实</strong>
              <p>这些要求会带入对应分集的生成，并在场景完成后检查。</p>
              {currentQualityAudit.execution_requirements.map((item) => (
                <p key={`${item.node_id}-${item.node_version}-${item.episode_number}-${item.source_event_index}`}>
                  <strong>第{item.episode_number}集：</strong>{item.instruction}
                </p>
              ))}
            </section>
          ) : null}
          {busy === "review" || expansionProgress?.phase === "quality_review" && (busy === "generate" || topLevelTaskActive)
            || roadmapGenerationProgress?.phase === "quality_review" && (busy === "roadmap" || roadmapBatchTaskActive)
            ? <div className="inline-notice" role="status">正在检查剧情容量、重复与前后因果，完成后再继续分集。</div> : null}
          {busy === "load" ? <p>{t("storyPlanNode.loading")}</p> : null}
          {busy === "generate" ? <div className="inline-notice">{expansionProgress?.level && expansionProgress.totalNodes !== undefined ? t("storyPlanNode.expandLayerProgress").replace("{level}", String(expansionProgress.level)).replace("{completed}", String(expansionProgress.completedNodes ?? 0)).replace("{total}", String(expansionProgress.totalNodes)) : expansionProgress?.nodeTitle ? t("storyPlanNode.expandAllProgress").replace("{title}", expansionProgress.nodeTitle).replace("{count}", String(expansionProgress.completedLeaves)) : t(topLevelNodes.length ? "storyPlanNode.expandAllHelp" : "storyPlanNode.generatingHelp")}</div> : null}
          {busy === "roadmap" || roadmapBatchTaskActive ? <div className="inline-notice">{roadmapGenerationProgress?.currentEpisode ? t("storyPlanNode.roadmapAllProgress").replace("{episode}", String(roadmapGenerationProgress.currentEpisode)).replace("{completed}", String(roadmapGenerationProgress.completedEpisodes)).replace("{total}", String(roadmapGenerationProgress.totalEpisodes)) : t("storyPlanNode.roadmapAllHelp")}</div> : null}
          {!busy && !loadError && !topLevelNodes.length ? <div className="story-bible-empty"><p>{t("storyPlanNode.empty")}</p></div> : null}
          {topLevelNodes.map((node, index) => <PlanNodeBranch wholeOutlineConfirmation={scriptWorkflow === true} focusedEpisodeNumber={focusedEpisodeNumber} depth={0} initialNode={node} key={`${node.node_id}-${node.version}`} outlineNumber={String(index + 1)} planningLocked={planningLocked} project={project} storyBible={storyBible} storyPlanNodes={activeTreeNodes} onProjectUpdate={onProjectUpdate} onInteractionChange={updateBranchInteraction} onRegisterRevision={registerRevision} onRequestResplit={() => setAutoExpansionRequested(true)} onTreeSnapshotChange={setActiveTreeNodes} refreshToken={treeRefreshToken} treeBusy={busy === "review" || busy === "generate" || topLevelTaskActive || busy === "roadmap" || roadmapBatchTaskActive} treeCheckpointRefreshes={treeCheckpointRefreshes} treeUnlockedNodeIds={busy === "review" || !stepByStep || busy === "roadmap" || roadmapBatchTaskActive ? new Set() : treeUnlockedNodeIds} onRoadmapConfirmed={showNextEpisodeReview} onAssistantRegister={registerAssistant} onAssistantFocus={focusAssistant} onAssistantUpdate={notifyAssistant} />)}
            </div>
          </div>
        </div>
        <PlanningCanvasCopilot
          busy={assistant?.busy ?? false}
          disabled={planningLocked || (assistant?.disabled ?? true)}
          instruction={assistant?.instruction ?? ""}
          focusRequest={assistantFocusRequest}
          instructionNotice={reviewAdviceNodeId === activeAssistantNodeId && assistant?.instruction.trim()
            ? `修改范围：${reviewAdviceRange}。建议已填入，你可以调整后发送；发送前不会修改剧情。`
            : undefined}
          messages={assistant?.messages ?? []}
          progress={planningGenerationProgress?.status === "running" ? planningGenerationProgress : assistant?.progress ?? planningGenerationProgress}
          onClearSelection={assistant?.onClearSelection ?? (() => undefined)}
          onEditMessage={assistant?.onEditMessage}
          onInstructionChange={value => { setReviewAdviceNodeId(null); assistant?.onInstructionChange(value); }}
          onPause={assistant?.onPause}
          onQuickAction={assistant?.onQuickAction ?? (() => undefined)}
          onSubmit={assistant?.onSubmit ?? (() => undefined)}
          scopeLabel={assistant?.scopeLabel ?? "剧情规划"}
          disabledReason={planningLocked ? "这份规划已确认。如需调整尚未创作的部分，请先开启后续规划修订。" : !assistant ? "请先生成剧情规划，再选择需要讨论的部分。" : "当前正在保存或整理规划，请稍候再修改。"}
          selection={planningLocked ? null : assistant?.selection ?? null}
          thinking={assistant?.busy ?? false}
          variant="document"
        />
      </div>
      {scriptWorkflow === false && outputModeChoiceOpen ? (
          <dialog ref={outputModeDialogRef} aria-labelledby="output-mode-title" className="tag-dialog output-mode-dialog" onCancel={() => setOutputModeChoiceOpen(false)}>
            <button aria-label="关闭" className="tag-dialog-close" onClick={() => setOutputModeChoiceOpen(false)} type="button"><X size={17} /></button>
            <span className="section-kicker">进入剧本</span>
            <h3 id="output-mode-title">接下来要生成什么？</h3>
            <p>先完成剧本，再决定是否把已保存的剧本继续编排成分镜。这个选择会保存到当前项目。</p>
            <div className="output-mode-options">
              <button className="outline-action" disabled={busy !== null} onClick={() => void confirmPlanning("script_only")} type="button">
                <strong>只要剧本</strong>
                <span>生成并编辑剧本，暂不自动编排分镜。</span>
              </button>
              <button className="primary-action" disabled={busy !== null} onClick={() => void confirmPlanning("script_and_storyboard")} type="button">
                <strong>直接出分镜</strong>
                <span>剧本保存后，自动根据正式剧本生成分镜。</span>
              </button>
            </div>
          </dialog>
      ) : null}
    </section>
  );
}

const PlanningNameDisplayContext = createContext<(value: string) => string>((value) => value);

function PlanNodeBranch({ wholeOutlineConfirmation = false, focusedEpisodeNumber = null, depth, initialNode, onAssistantFocus, onAssistantRegister, onAssistantUpdate, onRoadmapConfirmed, onInteractionChange, onRegisterRevision, onProjectUpdate, onRequestResplit, onTreeSnapshotChange, outlineNumber, planningLocked = false, project, refreshToken = 0, storyBible, storyPlanNodes, treeBusy = false, treeCheckpointRefreshes, treeUnlockedNodeIds }: {
  wholeOutlineConfirmation?: boolean;
  focusedEpisodeNumber?: number | null;
  depth: number;
  initialNode: StoryPlanNode;
  outlineNumber?: string;
  planningLocked?: boolean;
  project: ScriptProject;
  storyPlanNodes: StoryPlanNode[];
  storyBible: StoryBible;
  onInteractionChange?: (key: string, active: boolean) => void;
  onRegisterRevision?: (restore: () => Promise<void>) => void;
  onProjectUpdate?: ProjectUpdateHandler;
  onRequestResplit?: () => void;
  onTreeSnapshotChange?: (nodes: StoryPlanNode[]) => void;
  refreshToken?: number;
  treeBusy?: boolean;
  treeCheckpointRefreshes?: ReadonlyMap<string, number>;
  treeUnlockedNodeIds?: ReadonlySet<string>;
  onAssistantRegister?: (nodeId: string, getter: () => StoryPlanAssistantState) => void;
  onAssistantFocus?: (nodeId: string) => void;
  onAssistantUpdate?: (nodeId: string) => void;
  onRoadmapConfirmed?: (episodeNumber: number) => void;
}) {
  const { t } = useLocale();
  const { getProject, syncProjectSnapshot, adoptServerProjectSnapshot } = useProjects();
  const displayName = useMemo(() => planningCharacterNameFormatter(project), [project.canonicalCharacterNames, project.generationSettings.releaseRegion]);
  const [node, setNode] = useState(initialNode);
  const [children, setChildren] = useState<StoryPlanNode[]>([]);
  const [busy, setBusy] = useState<
    "load" | "save" | "confirm" | "ai" | "roadmap-ai" | "rebuild" | null
  >("load");
  const [message, setMessage] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState("");
  const { progress: copilotProgress, begin: beginCopilotProgress } = useCopilotProgress(`${project.id}:node:${initialNode.node_id}`);
  const aiRevisionMode: PlanningRevisionMode = "targeted";
  const [descendantDecision, setDescendantDecision] = useState<{
    candidate: StoryPlanNode;
    source: "ai" | "manual";
  } | null>(null);
  const [roadmapAiInstruction, setRoadmapAiInstruction] = useState("");
  const [episodeAssistantDrafts, setEpisodeAssistantDrafts] = useState<Record<number, {
    instruction: string; selection: StoryBibleSelectionContext | null;
  }>>({});
  const roadmapAiRevisionMode: PlanningRevisionMode = "targeted";
  const [documentSelection, setDocumentSelection] = useState<StoryBibleSelectionContext | null>(null);
  const [chatMessages, setChatMessages] = useState<PlanningCanvasMessage[]>(() => (
    loadWorkspaceChatMessages(project.id, "planning") as PlanningCanvasMessage[]
  ));
  const [selectionTarget, setSelectionTarget] = useState<
    { kind: "node" } | { kind: "roadmap"; item: EpisodeRoadmapItem } | null
  >(null);
  const nodeRef = useRef(node);
  const childrenRef = useRef(children);
  const storyPlanNodesRef = useRef(storyPlanNodes);
  const aiAbortControllerRef = useRef<AbortController | null>(null);
  const roadmapManualRevisionTailRef = useRef<Promise<void>>(Promise.resolve());
  const roadmapManualRevisionPendingRef = useRef(0);
  const rebuildStartingRef = useRef(false);
  const rebuildTaskKey = `future-roadmap:${project.id}:${project.planningRevisionEpoch ?? 0}:${node.node_id}:${node.version}`;
  const rebuildTask = useTrackedPlanningTask(rebuildTaskKey);
  const rebuildTaskActive = rebuildTask?.status === "running" || rebuildTask?.status === "queued";
  const rebuildPauseState = usePlanningPauseState(project.id);
  useEffect(() => () => aiAbortControllerRef.current?.abort(), []);
  useEffect(() => {
    if (!planningLocked) return;
    aiAbortControllerRef.current?.abort();
    setDocumentSelection(null);
    setSelectionTarget(null);
  }, [planningLocked]);
  useEffect(() => { nodeRef.current = node; }, [node]);
  useEffect(() => { childrenRef.current = children; }, [children]);
  useEffect(() => { storyPlanNodesRef.current = storyPlanNodes; }, [storyPlanNodes]);
  useEffect(() => {
    saveWorkspaceChatMessages(project.id, "planning", chatMessages);
  }, [chatMessages, project.id]);
  useEffect(() => subscribeWorkspaceChatMessages(project.id, "planning", () => {
    const next = loadWorkspaceChatMessages(project.id, "planning") as PlanningCanvasMessage[];
    setChatMessages((current) => (
      JSON.stringify(current) === JSON.stringify(next) ? current : next
    ));
  }), [project.id]);
  const checkpointRefresh = treeCheckpointRefreshes?.get(node.node_id) ?? 0;
  const interactionKey = `${node.node_id}:${node.version}`;
  const localInteractionActive = (
    Boolean(descendantDecision)
    || rebuildTaskActive
    || (busy !== null && busy !== "load")
  );

  useEffect(() => {
    onInteractionChange?.(interactionKey, localInteractionActive);
    return () => onInteractionChange?.(interactionKey, false);
  }, [interactionKey, localInteractionActive, onInteractionChange]);

  useEffect(() => {
    let active = true;
    loadChildStoryPlanNodes(
      project.id,
      node.node_id,
      node.story_bible_id,
      node.story_bible_version,
      node.version,
    )
      .then((value) => { if (active) setChildren(value); })
      .catch((error) => {
        if (active) setMessage(userFacingError(error, t("storyPlanNode.loadFailed")));
      })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [checkpointRefresh, node.node_id, node.version, project.id, refreshToken, t]);

  async function requestNodeSave(candidate: StoryPlanNode, source: "ai" | "manual") {
    if (treeInteractionLocked || candidate.status === "superseded" || generatedRangeLocked) return false;
    if (source === "manual") assertStoryPlanEventEditPreservesSources(nodeRef.current, candidate);
    if (children.length > 0) {
      setDescendantDecision({ candidate, source });
      setMessage("修改方案已生成，请选择如何处理下层剧情；保存后才会生效。");
      return false;
    }
    if (candidate.status === "approved" && !window.confirm(t("storyPlanNode.modifyConfirmedConfirm"))) {
      return false;
    }
    return persistNode(candidate, source, "invalidate");
  }

  async function persistNode(
    candidate: StoryPlanNode,
    source: "ai" | "manual",
    descendantPolicy: "invalidate" | "rebase",
    recordHistory = true,
  ) {
    if (treeInteractionLocked) return false;
    const currentNode = nodeRef.current;
    if (source === "manual") assertStoryPlanEventEditPreservesSources(currentNode, candidate);
    const currentChildren = childrenRef.current;
    setBusy("save");
    setMessage(null);
    try {
      const previousTree = currentChildren.length
        ? await loadActiveStoryPlanNodes(
          project.id,
          currentNode.story_bible_id,
          currentNode.story_bible_version,
        )
        : [];
      const previousSubtree = collectStoryPlanSubtreeVersions(previousTree, currentNode);
      if (isPlanningRevisionActive(project) && currentChildren.length && descendantPolicy === "invalidate") {
        throw new Error("后续规划修订需保留现有下层原文，请选择保留下层并重新审阅。");
      }
      const saved = await saveStoryPlanNodeDraft(candidate, descendantPolicy, project);
      setNode(saved);
      const nextTree = descendantPolicy === "rebase"
        ? await loadActiveStoryPlanNodes(
          project.id,
          saved.story_bible_id,
          saved.story_bible_version,
        )
        : [];
      const nextVersions = new Map(nextTree.map((item) => [item.node_id, item.version]));
      await persistProjectUpdate(onProjectUpdate, (current) => ({
        episodePlansReadyThrough: undefined,
        storyTreeQualityAudit: undefined,
        episodeRoadmaps: isPlanningRevisionActive(current)
          ? retainRevisionRoadmaps(current,
            new Map([...previousSubtree, [currentNode.node_id, currentNode.version]]),
            new Map([...nextVersions, [saved.node_id, saved.version]]))
          : reconcileRoadmapsAfterNodeRevision(current.episodeRoadmaps ?? [], currentNode, saved,
            previousSubtree, nextVersions, descendantPolicy),
      }));
      setChildren(await loadChildStoryPlanNodes(
        project.id,
        saved.node_id,
        saved.story_bible_id,
        saved.story_bible_version,
        saved.version,
      ));
      const refreshedTree = nextTree.length
        ? nextTree
        : await loadActiveStoryPlanNodes(
          project.id,
          saved.story_bible_id,
          saved.story_bible_version,
        );
      onTreeSnapshotChange?.(refreshedTree);
      if (recordHistory) onRegisterRevision?.(async () => {
        const latest = nodeRef.current;
        await persistNode({ ...currentNode, version: latest.version }, "ai", "invalidate", false);
      });
      if (source === "ai") setAiInstruction("");
      setDescendantDecision(null);
      setMessage(source === "ai" ? t("storyPlanNode.aiModificationApplied") : "剧情部分修改已保存，可继续修改。");
      if (currentChildren.length > 0 && descendantPolicy === "invalidate" && !isPlanningRevisionActive(project)) onRequestResplit?.();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function approveRevisedNode() {
    if (!isPlanningRevisionActive(project) || nodeRevisionLocked || busy || treeInteractionLocked) return;
    setBusy("confirm");
    setMessage(null);
    try {
      const previous = nodeRef.current;
      const saved = await confirmStoryPlanNode(previous, "rebase", project.generationSettings.episodeCount, project);
      const refreshed = await loadActiveStoryPlanNodes(project.id, saved.story_bible_id, saved.story_bible_version);
      const previousVersions = new Map(storyPlanNodesRef.current.map((entry) => [entry.node_id, entry.version]));
      const nextVersions = new Map(refreshed.map((entry) => [entry.node_id, entry.version]));
      await persistProjectUpdate(onProjectUpdate, (current) => ({
        episodeRoadmaps: retainRevisionRoadmaps(current, previousVersions, nextVersions),
        episodePlansReadyThrough: undefined, storyTreeQualityAudit: undefined,
      }));
      setNode(saved);
      setChildren(await loadChildStoryPlanNodes(project.id, saved.node_id, saved.story_bible_id, saved.story_bible_version, saved.version));
      onTreeSnapshotChange?.(refreshed);
      setMessage("剧情节点已批准，请复核并批准其分集规划。");
    } catch (error) { reportNodeSaveError(error); }
    finally { setBusy(null); }
  }

  function reportNodeSaveError(error: unknown) {
    setMessage(userFacingError(error, t("storyPlanNode.saveFailed")));
  }

  async function requestAiModification(
    instructionOverride?: string,
    selectionOverride: StoryBibleSelectionContext | null = documentSelection,
  ) {
    const submittedInstruction = (instructionOverride ?? aiInstruction).trim();
    if (
      planningLocked
      || treeBusy
      || node.status === "superseded"
      || generatedRangeLocked
      || (aiRevisionMode === "targeted" && !submittedInstruction)
    ) return;
    const controller = new AbortController();
    aiAbortControllerRef.current = controller;
    const progressRun = beginCopilotProgress(controller.signal);
    progressRun.mark("context", "正在准备当前故事和修改要求");
    setBusy("ai");
    setMessage(null);
    setAiInstruction("");
    setChatMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: submittedInstruction,
        quote: selectionOverride,
      },
    ]);
    try {
      setDocumentSelection((current) => current === selectionOverride ? null : current);
      const candidate = await modifyStoryPlanNode(
        project,
        node,
        submittedInstruction,
        aiRevisionMode,
        selectionOverride,
        controller.signal,
        progressRun.onEvent,
      );
      controller.signal.throwIfAborted();
      progressRun.mark("validating", "正在保存修改后的剧情规划");
      const saved = await requestNodeSave(candidate, "ai");
      if (!saved) { progressRun.finish("error"); return; }
      const completedProgress = progressRun.finish("completed");
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: describeAppliedRevision(node, candidate, selectionOverride),
          progress: completedProgress,
        },
      ]);
      setMessage(null);
    } catch (error) {
      const trace = progressRun.finish(controller.signal.aborted ? "paused" : "error");
      if (isRequestAborted(error, controller.signal)) {
        setChatMessages((current) => [
          ...current,
          { id: `assistant-paused-${Date.now()}`, role: "assistant", text: "已暂停本次思考。你可以编辑刚才的消息后重新发送。", progress: trace },
        ]);
      } else {
        const errorMessage = userFacingError(error, t("storyPlanNode.aiModifyFailed"));
        setMessage(errorMessage);
        setChatMessages(current => [...current, { id: `assistant-error-${Date.now()}`, role: "assistant", text: errorMessage, progress: trace }]);
      }
    } finally {
      if (aiAbortControllerRef.current === controller) aiAbortControllerRef.current = null;
      setBusy(null);
    }
  }

  function pauseAiModification() {
    aiAbortControllerRef.current?.abort();
  }

  function editChatMessage(
    messageId: string,
    text: string,
    quote?: StoryBibleSelectionContext | null,
  ) {
    setChatMessages((current) => {
      const messageIndex = current.findIndex((item) => item.id === messageId);
      return messageIndex >= 0 ? current.slice(0, messageIndex) : current;
    });
    if (activeSelectionTarget?.kind === "roadmap") {
      void requestRoadmapAiModification(text, quote ?? null, activeSelectionTarget.item);
      return;
    }
    void requestAiModification(text, quote ?? null);
  }

  function requestQuickNodeAction(action: PlanningCanvasAction, instruction: string) {
    const resolved = action === "continue" && !activeDocumentSelection
      ? activeSelectionTarget?.kind === "roadmap"
        ? `请补充第${activeSelectionTarget.item.episode_number}集的剧情发展，保持本集目标、前后集衔接与已确认规划一致。`
        : "请补充当前剧情节点的下一步发展，保持父节点、前置节点和后续交接压力一致。"
      : instruction;
    if (!focusedRoadmap) setAiInstruction(resolved);
    if (activeSelectionTarget?.kind === "roadmap") {
      if (!focusedRoadmap) setRoadmapAiInstruction(resolved);
      void requestRoadmapAiModification(resolved, activeDocumentSelection, activeSelectionTarget.item);
      return;
    }
    void requestAiModification(resolved, activeDocumentSelection);
  }

  function submitCanvasInstruction() {
    if (activeSelectionTarget?.kind === "roadmap") {
      void requestRoadmapAiModification(activeRoadmapInstruction, activeDocumentSelection, activeSelectionTarget.item);
      return;
    }
    void requestAiModification();
  }

  function capturePlanningSelection(event: SyntheticEvent<HTMLElement>) {
    // Keep the visible target attached to the in-flight modification.
    if (planningLocked || aiAbortControllerRef.current) return;
    const selection = window.getSelection();
    const eventTarget = event.target instanceof HTMLElement ? event.target : null;
    if (eventTarget?.closest(".selection-edit-toolbar")) return;
    const controlSelectedText = eventTarget instanceof HTMLTextAreaElement
      && eventTarget.selectionStart !== eventTarget.selectionEnd
      ? eventTarget.value.slice(eventTarget.selectionStart, eventTarget.selectionEnd).trim()
      : "";
    const selectedText = controlSelectedText || selection?.toString().trim() || "";
    if (!selectedText) return;
    const anchorElement = selection?.anchorNode instanceof HTMLElement
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement ?? null;
    const selectionOrigin = controlSelectedText ? eventTarget : anchorElement;
    const target = selectionOrigin?.closest<HTMLElement>("[data-planning-field]")
      ?? selectionOrigin?.closest<HTMLElement>("article, p, li, strong, small");
    if (!target || !event.currentTarget.contains(target)) return;
    const fullText = eventTarget instanceof HTMLTextAreaElement && controlSelectedText
      ? eventTarget.value
      : target.dataset.planningFieldText ?? target.innerText ?? selectedText;
    const roadmapCard = target.closest<HTMLElement>("[data-roadmap-episode]");
    const roadmapEpisode = roadmapCard ? Number(roadmapCard.dataset.roadmapEpisode) : NaN;
    const roadmapItem = Number.isFinite(roadmapEpisode)
      ? roadmap.find((item) => item.episode_number === roadmapEpisode)
      : undefined;
    if (focusedRoadmap && roadmapItem?.episode_number !== focusedRoadmap.episode_number) return;
    if (!focusedRoadmap) setSelectionTarget(roadmapItem ? { kind: "roadmap", item: roadmapItem } : { kind: "node" });
    onAssistantFocus?.(node.node_id);
    onAssistantUpdate?.(node.node_id);
    const selectedIndex = Math.max(0, fullText.indexOf(selectedText));
    const afterStart = selectedIndex + selectedText.length;
    const nextSelection = {
      source_field: target.dataset.planningField ?? "剧情规划正文",
      selected_text: selectedText.slice(0, 4_000),
      before_text: selectedIndex > 0 ? fullText.slice(Math.max(0, selectedIndex - 320), selectedIndex) : "",
      after_text: fullText.slice(afterStart, afterStart + 320),
    };
    if (focusedRoadmap) updateEpisodeAssistantDraft(focusedRoadmap.episode_number, { selection: nextSelection });
    else setDocumentSelection(nextSelection);
  }

  function updateEpisodeAssistantDraft(episodeNumber: number, patch: { instruction?: string; selection?: StoryBibleSelectionContext | null }) {
    setEpisodeAssistantDrafts(current => ({ ...current, [episodeNumber]: {
      instruction: current[episodeNumber]?.instruction ?? "",
      selection: current[episodeNumber]?.selection ?? null,
      ...patch,
    } }));
  }

  function updateNodeField(
    field: "title" | "narrative_purpose" | "synopsis" | "entry_state" | "central_conflict" | "emotional_direction" | "exit_state" | "unit_resolution" | "handoff_pressure",
    value: string,
  ) {
    if (nodeRevisionLocked) return;
    const candidate = field === "entry_state" || field === "exit_state"
      ? editStoryPlanNodeBoundary(nodeRef.current, field, value)
      : { ...nodeRef.current, [field]: value };
    void requestNodeSave(candidate, "manual").catch(reportNodeSaveError);
  }

  function updateNodeStoryBeats(value: string[]) {
    if (nodeRevisionLocked) return;
    const candidate = { ...nodeRef.current, unit_story_beats: value };
    void requestNodeSave(candidate, "manual").catch(reportNodeSaveError);
  }

  function updateNodeEpisodeState(episodeNumber: number, field: "entry_state" | "exit_state", value: string) {
    if (nodeRevisionLocked || !isPlanningRevisionActive(project)) return;
    const current = nodeRef.current;
    const candidate = editStoryPlanEpisodeBoundary(current, episodeNumber, field, value);
    if (candidate === current) return;
    void requestNodeSave(candidate, "manual").catch(reportNodeSaveError);
  }

  async function requestRoadmapAiModification(
    instructionOverride?: string,
    selectionOverride: StoryBibleSelectionContext | null = activeDocumentSelection,
    targetOverride: EpisodeRoadmapItem | null = activeSelectionTarget?.kind === "roadmap" ? activeSelectionTarget.item : null,
  ) {
    const submittedInstruction = (instructionOverride ?? activeRoadmapInstruction).trim();
    if (
      planningLocked
      || treeBusy
      || !targetOverride
      || roadmapItemLocked(targetOverride)
      || (roadmapAiRevisionMode === "targeted" && !submittedInstruction)
    ) return;
    const controller = new AbortController();
    aiAbortControllerRef.current = controller;
    const progressRun = beginCopilotProgress(controller.signal);
    progressRun.mark("context", "正在准备当前故事和修改要求");
    setBusy("roadmap-ai");
    if (focusedRoadmap?.episode_number === targetOverride.episode_number) {
      updateEpisodeAssistantDraft(targetOverride.episode_number, { instruction: "", selection: null });
    } else {
      setAiInstruction("");
      setRoadmapAiInstruction("");
    }
    setChatMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: submittedInstruction,
        quote: selectionOverride,
      },
    ]);
    try {
      if (!focusedRoadmap) setDocumentSelection((current) => current === selectionOverride ? null : current);
      const activeNodesForMemory = storyPlanNodesRef.current;
      const acceptedPlans = roadmap.filter(
        (item) => item.episode_number < targetOverride.episode_number,
      );
      const candidate = await modifyEpisodePlanItem(
        project,
        node,
        targetOverride,
        acceptedPlans,
        submittedInstruction,
        roadmapAiRevisionMode,
        selectionOverride,
        controller.signal,
        activeNodesForMemory,
        progressRun.onEvent,
      );
      controller.signal.throwIfAborted();
      progressRun.mark("validating", "正在保存修改后的本集规划");
      const saved = await applyRoadmapRevision(candidate, targetOverride);
      if (!saved) { progressRun.finish("error"); return; }
      const completedProgress = progressRun.finish("completed");
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: describeAppliedRevision(targetOverride, candidate, selectionOverride),
          progress: completedProgress,
        },
      ]);
    } catch (error) {
      const trace = progressRun.finish(controller.signal.aborted ? "paused" : "error");
      if (isRequestAborted(error, controller.signal)) {
        setChatMessages((current) => [
          ...current,
          { id: `assistant-paused-${Date.now()}`, role: "assistant", text: "已暂停本次思考。你可以编辑刚才的消息后重新发送。", progress: trace },
        ]);
      } else {
        const errorMessage = userFacingError(error, t("storyPlanNode.roadmapAiFailed"));
        setMessage(errorMessage);
        setChatMessages(current => [...current, { id: `assistant-error-${Date.now()}`, role: "assistant", text: errorMessage, progress: trace }]);
      }
    } finally {
      if (aiAbortControllerRef.current === controller) aiAbortControllerRef.current = null;
      setBusy(null);
    }
  }

  async function rebuildPendingLeafRoadmaps() {
    if (rebuildStartingRef.current || rebuildTaskActive || operationLocked) return;
    rebuildStartingRef.current = true;
    setBusy("rebuild");
    setMessage(null);
    try {
      const initial = getProject(project.id) ?? project;
      const sync = await syncProjectSnapshot(initial);
      if (sync.status !== "synced") throw new Error("请先同步已保存规划，再重建本段。");
      const source = getProject(project.id) ?? { ...initial, serverSync: sync };
      const job = enqueuePlanningTask({
        key: rebuildTaskKey, kind: "episode_roadmap", projectId: source.id, nodeId: node.node_id,
        label: `重建第${node.planned_start_episode}—${node.planned_end_episode}集待复核规划`,
        run: () => rebuildFutureRoadmapLeaf({
          project: source, node,
          getCurrent: () => getProject(source.id) ?? source,
          beforeStep: async () => { await waitForPlanningTaskResume(rebuildTaskKey); },
          onProgress: number => setMessage(wholeOutlineConfirmation ? `正在按已确认剧情重建第${number}集大纲草稿…` : `正在按批准事件重建第${number}集；已保存结果保留，仍需逐集批准。`),
          generate: (current, sourceNode, item, prefix) => rebuildFutureEpisodePlan(current, sourceNode, item, prefix, storyPlanNodesRef.current),
          save: savePlanningRevisionSnapshot,
          apply: adoptServerProjectSnapshot,
        }),
        onSuccess: completed => {
          setMessage(wholeOutlineConfirmation ? `本段已保存${completed.length}集重建草稿，完成调整后可在顶部统一确认后续大纲。` : `本段已保存${completed.length}集重建草稿。请逐集复核并批准；下一段需在本段末集批准后继续。`);
          setBusy(null);
        },
        onFailure: error => { setMessage(userFacingError(error, "本次重建已停止，已保存结果保留，可继续未完成项。")); setBusy(null); },
      });
      void job.promise.catch(() => undefined).finally(() => { rebuildStartingRef.current = false; });
    } catch (error) {
      rebuildStartingRef.current = false;
      setBusy(null);
      setMessage(userFacingError(error, "无法开始本段重建。"));
    }
  }

  async function applyRoadmapRevision(
    candidate: EpisodeRoadmapItem,
    previousItem?: EpisodeRoadmapItem,
    recordHistory = true,
    mergeWithLatest?: RoadmapRevisionMerger,
  ) {
    if (treeInteractionLocked || roadmapItemLocked(previousItem ?? candidate)) return false;
    const currentStoryPlanNodes = storyPlanNodesRef.current;
    // AI and manual edits are reviewable drafts.  Approval is a separate,
    // explicit author action so readiness can never advance implicitly.
    let appliedCandidate = draftEpisodeRoadmapItem(candidate);
    let snapshot = previousItem ?? candidate;
    let revisionApplied = false;
    await persistProjectUpdate(onProjectUpdate, (current) => {
      const currentRoadmap = current.episodeRoadmaps ?? [];
      const latestItem = currentRoadmap.find((item) => (
        sameEpisodeRoadmapIdentity(item, previousItem ?? candidate)
      )) ?? previousItem ?? candidate;
      snapshot = latestItem;
      const sourceReview = latestItem.source_revision_review;
      const { rebuilt: _rebuilt, ...pendingSourceReview } = sourceReview ?? {};
      appliedCandidate = {
        ...draftEpisodeRoadmapItem(mergeWithLatest ? mergeWithLatest(latestItem) : candidate),
        ...(sourceReview ? { source_revision_review: pendingSourceReview as NonNullable<EpisodeRoadmapItem["source_revision_review"]> } : {}),
      };
      const changedRoadmaps = isPlanningRevisionActive(current)
        ? replaceRevisionRoadmap(current, appliedCandidate)
        : replaceEpisodeRoadmapItem(currentRoadmap, appliedCandidate, { retainDependentDrafts: current.episodes.length === 0 });
      const episodeRoadmaps = clearRebuildReceiptsAfterEdit(current, appliedCandidate, changedRoadmaps);
      revisionApplied = true;
      return {
        episodeRoadmaps,
        storyTreeQualityAudit: undefined,
        episodePlansReadyThrough: approvedDirectScriptCoverageThrough(currentStoryPlanNodes, {
          episodeRoadmaps,
          roadmapRequired: true,
        }) || undefined,
      };
    });
    if (recordHistory && revisionApplied) {
      onRegisterRevision?.(async () => {
        await applyRoadmapRevision(snapshot, appliedCandidate, false);
      });
    }
    return revisionApplied;
  }

  async function rebindRoadmapSource(item: EpisodeRoadmapItem) {
    if (roadmapItemLocked(item) || !isPlanningRevisionActive(project)) return;
    setBusy("save");
    setMessage(null);
    try {
      await persistProjectUpdate(onProjectUpdate, (current) => ({
        episodeRoadmaps: retainRevisionRoadmaps(current, new Map([[node.node_id, item.source_node_version]]), new Map([[node.node_id, node.version]])),
        episodePlansReadyThrough: undefined, storyTreeQualityAudit: undefined,
      }));
      setMessage("原文已关联当前上层，仍需核对本集起止状态和事件，再明确批准。");
    } catch (error) { reportNodeSaveError(error); }
    finally { setBusy(null); }
  }

  async function confirmEpisodeRoadmapItem(item: EpisodeRoadmapItem) {
    if (planningLocked || treeInteractionLocked || roadmapItemLocked(item) || isApprovedEpisodeRoadmap(item)) return;
    const currentStoryPlanNodes = storyPlanNodesRef.current;
    setBusy("save");
    setMessage(null);
    try {
      let prepared = item;
      if (isPlanningRevisionActive(project)) {
        const issues = planningRevisionSourceIssues(item, node);
        if (issues.length) throw new Error(issues.join("；"));
      }
      if (episodeRoadmapReadinessIssues(item).length) {
        setMessage(`正在整理第${item.episode_number}集的场次细节…`);
        prepared = await prepareEpisodePlanItem(
          project, node, item,
          roadmap.filter((entry) => entry.episode_number < item.episode_number),
          undefined, currentStoryPlanNodes,
        );
        if (episodeRoadmapReadinessIssues(prepared).length) {
          setMessage("这集的场次还没有整理好，原稿已保留，请稍后再确认。");
          return;
        }
      }
      if (isPlanningRevisionActive(project)) {
        const issues = planningRevisionSourceIssues(prepared, node);
        if (issues.length) throw new Error(issues.join("；"));
      }
      const { source_revision_review: _review, ...reviewed } = prepared;
      const approved = approveEpisodeRoadmapItem(reviewed);
      await persistProjectUpdate(onProjectUpdate, (current) => {
        const currentRoadmap = current.episodeRoadmaps ?? [];
        const latest = currentRoadmap.find((entry) => sameEpisodeRoadmapIdentity(entry, item));
        if (!latest || JSON.stringify(latest) !== JSON.stringify(item)) {
          throw new Error("这集在整理期间有了新修改，请查看最新内容后再确认。");
        }
        const episodeRoadmaps = mergeEpisodeRoadmaps(currentRoadmap, [approved]);
        return {
          episodeRoadmaps,
          episodePlansReadyThrough: approvedDirectScriptCoverageThrough(currentStoryPlanNodes, {
            episodeRoadmaps,
            roadmapRequired: true,
          }) || undefined,
        };
      });
      setMessage(`第${item.episode_number}集规划已确认。`);
      onRoadmapConfirmed?.(item.episode_number);
    } catch (error) {
      setMessage(userFacingError(error, t("storyPlanNode.saveFailed")));
    } finally {
      setBusy((current) => current === "save" ? null : current);
    }
  }

  function requestRoadmapManualRevision(
    item: EpisodeRoadmapItem,
    mergeWithLatest: RoadmapRevisionMerger,
  ) {
    if (roadmapItemLocked(item) || treeInteractionLocked) return;
    roadmapManualRevisionPendingRef.current += 1;
    setBusy("save");
    setMessage(null);
    const operation = roadmapManualRevisionTailRef.current.then(() => (
      applyRoadmapRevision(item, item, true, mergeWithLatest)
    ));
    roadmapManualRevisionTailRef.current = operation.then(() => undefined, () => undefined);
    void operation
      .catch((error) => {
        setMessage(userFacingError(error, t("storyPlanNode.saveFailed")));
      })
      .finally(() => {
        roadmapManualRevisionPendingRef.current -= 1;
        if (roadmapManualRevisionPendingRef.current === 0) {
          setBusy((current) => current === "save" ? null : current);
        }
      });
  }

  function updateRoadmapTextField(
    item: EpisodeRoadmapItem,
    field: "episode_title" | "synopsis" | "locations" | "episode_goal" | "central_conflict" | "protagonist_cost" | "ending_hook_type" | "cliffhanger" | "entry_state" | "exit_state" | "next_episode_obligation" | "protagonist_decision" | "reveal" | "emotional_movement" | "stage_opposition" | "episode_payoff" | "pressure_escalation",
    value: string,
  ) {
    requestRoadmapManualRevision(item, (latest) => ({
      ...latest,
      [field]: field === "episode_title" || field === "protagonist_cost"
        ? value.trim() || null
        : field === "locations"
          ? value.split(/[、,，;；\n]/).map((location) => location.trim()).filter(Boolean)
          : value,
    }));
  }

  function updateRoadmapDramaticUnit(
    item: EpisodeRoadmapItem,
    index: number,
    field: keyof EpisodeDramaticUnit,
    value: string,
  ) {
    requestRoadmapManualRevision(item, (latest) => ({
      ...latest,
      dramatic_units: (latest.dramatic_units ?? []).map((unit, unitIndex) => (
        unitIndex === index
          ? { ...unit, [field]: field === "evidence_hint" ? value.trim() || null : value.trim() }
          : unit
      )),
    }));
  }

  function addRoadmapDramaticUnit(item: EpisodeRoadmapItem, unit: EpisodeDramaticUnit) {
    requestRoadmapManualRevision(item, (latest) => ({
      ...latest,
      dramatic_units: (latest.dramatic_units ?? []).length < MAX_DRAMATIC_UNITS
        ? [...(latest.dramatic_units ?? []), unit]
        : latest.dramatic_units,
    }));
  }

  function removeRoadmapDramaticUnit(item: EpisodeRoadmapItem, index: number) {
    requestRoadmapManualRevision(item, (latest) => ({
      ...latest,
      dramatic_units: (latest.dramatic_units ?? []).filter((_, unitIndex) => unitIndex !== index),
    }));
  }

  function updateRoadmapSceneField(
    item: EpisodeRoadmapItem,
    sceneNumber: number,
    field: "scene_heading" | "scene_objective" | "visible_action" | "dialogue_objective" | "opposition" | "information_shift" | "choice_or_cost" | "turn_or_reveal" | "exit_state",
    value: string,
  ) {
    requestRoadmapManualRevision(item, (latest) => ({
      ...latest,
      scene_execution_plan: latest.scene_execution_plan?.map((scene) => (
        scene.scene_number === sceneNumber ? { ...scene, [field]: value } : scene
      )),
    }));
  }

  function updateRoadmapSetupPayoffRefs(item: EpisodeRoadmapItem, field: "setup_refs" | "payoff_refs", values: string[]) {
    requestRoadmapManualRevision(item, (latest) => ({
      ...latest,
      // Select exact source identities; display-name projection never changes them.
      [field]: [...new Set(values)],
    }));
  }

  function updateRoadmapContinuityItem(item: EpisodeRoadmapItem, index: number, value: string) {
    requestRoadmapManualRevision(item, (latest) => ({
      ...latest,
      continuity_requirements: latest.continuity_requirements.map((entry, itemIndex) => itemIndex === index ? value : entry),
    }));
  }

  function updateRoadmapSceneCharacter(item: EpisodeRoadmapItem, sceneNumber: number, reference: string, present: boolean) {
    requestRoadmapManualRevision(item, (latest) => {
      if (!node.character_refs.includes(reference)) return latest;
      const scenes = latest.scene_execution_plan?.map((scene) => {
        if (scene.scene_number !== sceneNumber) return scene;
        const refs = present ? [...new Set([...scene.character_refs, reference])] : scene.character_refs.filter((entry) => entry !== reference);
        return refs.length ? { ...scene, character_refs: refs } : scene;
      });
      const stillPresent = scenes?.some((scene) => scene.character_refs.includes(reference));
      return {
        ...latest,
        scene_execution_plan: scenes,
        character_refs: stillPresent
          ? [...new Set([...latest.character_refs, reference])]
          : latest.character_refs.filter((entry) => entry !== reference),
      };
    });
  }

  function updateRoadmapSceneListItem(
    item: EpisodeRoadmapItem, sceneNumber: number,
    field: "evidence_requirements" | "forbidden_changes", index: number, value: string,
  ) {
    requestRoadmapManualRevision(item, (latest) => ({
      ...latest,
      scene_execution_plan: latest.scene_execution_plan?.map((scene) => scene.scene_number === sceneNumber ? {
        ...scene, [field]: (scene[field] ?? []).map((entry, itemIndex) => itemIndex === index ? value : entry),
      } : scene),
    }));
  }

  function describeAppliedRevision<T extends object>(
    source: T,
    candidate: T,
    selection: StoryBibleSelectionContext | null,
  ) {
    const sourceValues = source as Record<string, unknown>;
    const candidateValues = candidate as Record<string, unknown>;
    const changedFields = Object.keys(candidate).filter((key) => (
      JSON.stringify(sourceValues[key]) !== JSON.stringify(candidateValues[key])
    ));
    if (!selection) return "已检查整体上下文并直接写入修改结果。可使用撤回回到上一版。";
    return changedFields.length > 1
      ? `已判断本次修改会影响上下文，已同步更新 ${changedFields.length} 个关联部分并直接写入。可使用撤回回到上一版。`
      : "已判断本次修改不会影响其他部分，仅更新选中内容并直接写入。可使用撤回回到上一版。";
  }

  const range = node.planned_start_episode && node.planned_end_episode
    ? `${node.planned_start_episode}-${node.planned_end_episode}`
    : "-";
  const directScriptReady = isDirectScriptNode(node);
  const episodeSpan = storyPlanNodeEpisodeSpan(node);
  const requiresParentCoordination = episodeSpan !== null
    && (episodeSpan < 8 || (episodeSpan >= 13 && episodeSpan <= 15));
  const episodeReadyShape = episodeSpan !== null
    && episodeSpan >= 8
    && episodeSpan <= 12
    && node.expansion_status === "episode_ready";
  const roadmap = revisionRoadmapsForNode(project, node);
  const focusedRoadmap = focusedEpisodeNumber === null ? undefined
    : roadmap.find(item => item.episode_number === focusedEpisodeNumber);
  const activeSelectionTarget = focusedRoadmap ? { kind: "roadmap" as const, item: focusedRoadmap } : selectionTarget;
  const activeRoadmapInstruction = focusedRoadmap
    ? episodeAssistantDrafts[focusedRoadmap.episode_number]?.instruction ?? "" : roadmapAiInstruction;
  const activeDocumentSelection = focusedRoadmap
    ? episodeAssistantDrafts[focusedRoadmap.episode_number]?.selection ?? null : documentSelection;
  useEffect(() => {
    if (focusedEpisodeNumber === null) return;
    window.getSelection()?.removeAllRanges();
    const frame = window.requestAnimationFrame(() => {
      const details = document.getElementById(storyPlanRoadmapAnchor(node.node_id, focusedEpisodeNumber))
        ?.querySelector<HTMLDetailsElement>(".episode-planning-details");
      if (details) details.open = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedEpisodeNumber]);
  const generatedEpisodesInRange = project.episodes.filter((episode) => (
    node.planned_start_episode !== null
    && node.planned_end_episode !== null
    && episode.episodeNumber >= node.planned_start_episode
    && episode.episodeNumber <= node.planned_end_episode
  ));
  const generatedEpisodeCount = new Set(
    generatedEpisodesInRange.map((episode) => episode.episodeNumber),
  ).size;
  const generatedRangeLocked = generatedEpisodeCount > 0 || planningRevisionNodeLocked(project, node);
  const nodeRevisionLocked = planningLocked || generatedRangeLocked;
  const concurrentLeafAccess = treeBusy
    && episodeReadyShape
    && Boolean(treeUnlockedNodeIds?.has(node.node_id))
    && children.length === 0;
  const treeInteractionLocked = planningLocked || (treeBusy && !concurrentLeafAccess);
  const operationLocked = Boolean(busy) || rebuildTaskActive || treeInteractionLocked;
  const branchLocked = operationLocked;
  function roadmapItemLocked(item: EpisodeRoadmapItem): boolean {
    return planningLocked || rebuildTaskActive || treeInteractionLocked || (busy !== null && busy !== "save" && busy !== "roadmap-ai")
      || (isPlanningRevisionActive(project) ? planningRevisionEpisodeLocked(project, item.episode_number) : generatedRangeLocked);
  }
  const effectiveEditing = false;

  useEffect(() => {
    onAssistantRegister?.(node.node_id, () => ({
      busy: busy === "ai" || busy === "roadmap-ai",
      disabled: planningLocked || (branchLocked && busy !== "ai" && busy !== "roadmap-ai") || (activeSelectionTarget?.kind === "roadmap" ? roadmapItemLocked(activeSelectionTarget.item) : nodeRevisionLocked),
      instruction: activeSelectionTarget?.kind === "roadmap" ? activeRoadmapInstruction : aiInstruction,
      nodeInstruction: aiInstruction,
      messages: chatMessages,
      progress: copilotProgress,
      onClearSelection: () => {
        if (aiAbortControllerRef.current) return;
        if (focusedRoadmap) {
          updateEpisodeAssistantDraft(focusedRoadmap.episode_number, { selection: null });
          return;
        }
        setDocumentSelection(null);
        setSelectionTarget(null);
      },
      onEditMessage: editChatMessage,
      onInstructionChange: (value: string) => {
        if (focusedRoadmap) {
          updateEpisodeAssistantDraft(focusedRoadmap.episode_number, { instruction: value });
          return;
        }
        setAiInstruction(value);
        if (activeSelectionTarget?.kind === "roadmap") setRoadmapAiInstruction(value);
      },
      onUseNodeInstruction: (value: string) => {
        if (aiAbortControllerRef.current) return;
        setDocumentSelection(null);
        setSelectionTarget(null);
        setAiInstruction(value);
      },
      onPause: pauseAiModification,
      onQuickAction: requestQuickNodeAction,
      onSubmit: submitCanvasInstruction,
      scopeLabel: activeSelectionTarget?.kind === "roadmap"
        ? `第${activeSelectionTarget.item.episode_number}集大纲`
        : `剧情节点：${displayName(node.title)}`,
      selection: activeDocumentSelection,
    }));
    onAssistantUpdate?.(node.node_id);
  }, [
    aiInstruction,
    branchLocked,
    busy,
    chatMessages,
    copilotProgress,
    documentSelection,
    node.node_id,
    node.title,
    nodeRevisionLocked,
    planningLocked,
    onAssistantRegister,
    onAssistantUpdate,
    roadmapAiInstruction,
    selectionTarget,
    focusedEpisodeNumber,
    project.episodeRoadmaps,
    episodeAssistantDrafts,
  ]);

  return (
    <PlanningNameDisplayContext.Provider value={displayName}>
    <div className="story-plan-branch" data-focused-roadmap={focusedEpisodeNumber !== null && roadmap.some(item => item.episode_number === focusedEpisodeNumber) || undefined}
      style={{ marginLeft: focusedEpisodeNumber === null ? `${Math.min(depth, 5) * 18}px` : 0 }}>
      <details
        className="story-plan-node-card is-document-node"
        data-depth={depth}
        id={storyPlanNodeAnchor(node.node_id)}
        onClick={(event) => {
          const summary = (event.target as HTMLElement).closest("summary");
          if (summary?.parentElement === event.currentTarget) event.preventDefault();
          onAssistantFocus?.(node.node_id);
        }}
        onToggle={(event) => {
          if (!event.currentTarget.open) event.currentTarget.open = true;
        }}
        open
      >
        <summary className="story-plan-node-summary">
          <span className="story-plan-node-toggle"><ArrowIcon /></span>
          <span className="story-plan-node-depth">
            {outlineNumber}
          </span>
          <span className="story-plan-node-title" onKeyUp={capturePlanningSelection} onMouseUp={capturePlanningSelection}>
            <InlinePlanningText
              label={t("storyPlanNode.nodeTitle")}
              locked={nodeRevisionLocked}
              minLength={1}
              onChange={(value) => updateNodeField("title", value)}
              value={node.title}
            />
          </span>
          <span className="story-plan-node-meta">
            {t("storyPlanNode.range").replace("{range}", range)}
            {node.estimated_script_body_characters
              ? ` · ${t("storyPlanNode.characterBudget").replace("{count}", String(node.estimated_script_body_characters))}`
              : ""}
            {(storyPlanNodeEpisodeSpan(node) ?? 0) > 12 && !children.length ? " · 待细分" : ""}
          </span>
        </summary>
        <div
          className="story-plan-node-content"
          onKeyUp={capturePlanningSelection}
          onMouseUp={capturePlanningSelection}
        >
          <div className="story-plan-node-document">
            {depth > 0 ? (
              <div className="story-plan-node-help-row">
                <span>{t("storyPlanNode.branchDetails")}</span>
                <SectionHelp content={t("guide.storyBranch")} label={t("guide.openHelp")} />
              </div>
            ) : null}
            {depth === 0 && !effectiveEditing ? (
              <PlanField
                editing={false}
                label={t("storyPlanNode.synopsis")}
                locked={nodeRevisionLocked}
                onChange={(value) => updateNodeField("synopsis", value)}
                showLabel={false}
                value={node.synopsis}
              />
            ) : depth === 1 && !effectiveEditing ? (
              <>
                <PlanField
                  editing={false}
                  label={t("storyPlanNode.synopsis")}
                  locked={nodeRevisionLocked}
                  onChange={(value) => updateNodeField("synopsis", value)}
                  value={node.synopsis}
                />
                <PlanListField
                  editing={false}
                  label={t("storyPlanNode.storyProgression")}
                  locked={nodeRevisionLocked}
                  onChange={updateNodeStoryBeats}
                  values={node.unit_story_beats ?? []}
                />
              <PlanField
                editing={false}
                label={t("storyPlanNode.partResolution")}
                locked={nodeRevisionLocked}
                onChange={(value) => updateNodeField("unit_resolution", value)}
                value={node.unit_resolution ?? ""}
              />
              <PlanField
                editing={false}
                label={t("storyPlanNode.nextPartPressure")}
                locked={nodeRevisionLocked}
                onChange={(value) => updateNodeField("handoff_pressure", value)}
                value={node.handoff_pressure ?? ""}
              />
            </>
          ) : (
            <>
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.narrativePurpose")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("narrative_purpose", value)} value={node.narrative_purpose} />
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.synopsis")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("synopsis", value)} value={node.synopsis} />
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.centralConflict")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("central_conflict", value)} value={node.central_conflict} />
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.emotionalDirection")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("emotional_direction", value)} value={node.emotional_direction} />
              <PlanListField
                editing={effectiveEditing}
                label={t("storyPlanNode.storyProgression")}
                locked={nodeRevisionLocked}
                onChange={updateNodeStoryBeats}
                values={node.unit_story_beats ?? []}
              />
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.partResolution")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("unit_resolution", value)} value={node.unit_resolution ?? ""} />
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.nextPartPressure")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("handoff_pressure", value)} value={node.handoff_pressure ?? ""} />
            </>
          )}
          <details className="story-plan-boundary-details" open={isPlanningRevisionActive(project) || depth > 1 || effectiveEditing}>
            <summary>入场与结局</summary>
            <div className="story-plan-node-boundary-states">
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.entryState")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("entry_state", value)} value={node.entry_state} />
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.exitState")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("exit_state", value)} value={node.exit_state} />
            </div>
          </details>
          <StoryPlanDetailsEditor
            key={`details-${node.node_id}-${node.version}`}
            locked={nodeRevisionLocked || operationLocked}
            node={node}
            onSave={(candidate) => requestNodeSave(candidate, "manual")}
            storyBible={storyBible}
          />
          {isPlanningRevisionActive(project) && node.status === "draft" && !nodeRevisionLocked ? (
            <button className="outline-action" disabled={Boolean(busy) || treeInteractionLocked} onClick={() => void approveRevisedNode()} type="button">批准修订节点</button>
          ) : null}
          {node.episode_developments?.length ? (
            <div className="story-plan-children">
              <h3>{t("storyPlanNode.episodeDevelopments")}</h3>
              {node.episode_developments.map((item) => (
                <article className="story-plan-episode-development" key={item.episode_number}>
                  <strong>第{item.episode_number}集</strong>
                  <p>{displayName(item.synopsis)}</p>
                  <details className="story-plan-boundary-details" open={isPlanningRevisionActive(project)}>
                    <summary>入场与结局</summary>
                    <p>{t("storyPlanNode.entryState")}：<InlinePlanningText label={`上层第${item.episode_number}集入场状态`} locked={nodeRevisionLocked || !isPlanningRevisionActive(project)} onChange={(value) => updateNodeEpisodeState(item.episode_number, "entry_state", value)} value={item.entry_state} /></p>
                    <p>{t("storyPlanNode.exitState")}：<InlinePlanningText label={`上层第${item.episode_number}集离场状态`} locked={nodeRevisionLocked || !isPlanningRevisionActive(project)} onChange={(value) => updateNodeEpisodeState(item.episode_number, "exit_state", value)} value={item.exit_state} /></p>
                  </details>
                </article>
              ))}
            </div>
          ) : null}
          {requiresParentCoordination ? (
            <div className="inline-notice">{t("storyPlanNode.rangeNeedsAdjustment")}</div>
          ) : null}
          {roadmap.length ? (
            <div className="story-plan-children story-plan-episode-plans">
              <div className="section-title-with-help story-plan-roadmap-heading">
                <h3>{t("storyPlanNode.episodePlans")}</h3>
                <SectionHelp content={t("guide.episodeRoadmap")} label={t("guide.openHelp")} />
              </div>
              {isPlanningRevisionActive(project) && node.status === "approved" && roadmap.some(item => item.source_revision_review) ? (
                <div className="inline-notice">
                  <p>{wholeOutlineConfirmation ? "按本段已确认剧情重建大纲草稿，保留既定预算与已确认内容。完成修改后统一确认。" : "按本段已批准事件重建待复核规划，保留既定预算与已批准集数。每集保存后继续，仍需逐集审核。"}</p>
                  <button className="outline-action" type="button" disabled={operationLocked || futureLeafRebuildCandidates(project, node).length === 0}
                    onClick={() => void rebuildPendingLeafRoadmaps()}>重建本段待复核规划</button>
                  {rebuildTaskActive ? <button className="outline-action" type="button"
                    onClick={() => rebuildPauseState === "running" ? requestPlanningPause(project.id) : resumePlanningTasks(project.id)}>
                    {rebuildPauseState === "running" ? "保存本集后暂停" : "继续重建"}
                  </button> : null}
                </div>
              ) : null}
              {roadmap.map((item) => (
                <div className="host-episode-planning-slot" hidden={focusedEpisodeNumber !== null && item.episode_number !== focusedEpisodeNumber}
                  key={`${node.node_id}-roadmap-${item.episode_number}`}>
                <EpisodePlanningCard
                  episodeNumber={item.episode_number}
                  title={displayName(episodeRoadmapDisplayTitle(item))}
                  synopsis={displayName(episodeRoadmapSynopsis(item))}
                  status={hasCurrentRoadmapRebuild(project, node, item) ? wholeOutlineConfirmation ? "草稿" : "待确认" : item.source_revision_review || item.source_node_version !== node.version ? wholeOutlineConfirmation ? "待调整" : "待复核" : isApprovedEpisodeRoadmap(item) ? "已确认" : wholeOutlineConfirmation ? "草稿" : "待确认"}
                  id={storyPlanRoadmapAnchor(node.node_id, item.episode_number)}
                  key={`${node.node_id}-roadmap-${item.episode_number}`}
                >
                  <strong>
                    {t("workspace.episodeLabel").replace("{number}", String(item.episode_number))} ·{" "}
                    <InlinePlanningText
                      label={`第${item.episode_number}集标题`}
                      locked={roadmapItemLocked(item)}
                      onChange={(value) => updateRoadmapTextField(item, "episode_title", value)}
                      value={episodeRoadmapDisplayTitle(item)}
                    />
                  </strong>
                  <p>
                    场地：
                    <InlinePlanningText
                      label={`第${item.episode_number}集场地`}
                      locked={roadmapItemLocked(item)}
                      onChange={(value) => updateRoadmapTextField(item, "locations", value)}
                      value={episodeRoadmapLocations(item)}
                    />
                  </p>
                  <p>
                    出场人物 & 性别：{displayName(episodeRoadmapCharacters(item, project.characters))}
                  </p>
                  <p>
                    梗概：
                    <InlinePlanningText
                      label={`第${item.episode_number}集梗概`}
                      locked={roadmapItemLocked(item)}
                      onChange={(value) => updateRoadmapTextField(item, "synopsis", value)}
                      value={episodeRoadmapSynopsis(item)}
                    />
                  </p>
                  <p>
                    目标：
                    <InlinePlanningText
                      label={`第${item.episode_number}集目标`}
                      locked={roadmapItemLocked(item)}
                      onChange={(value) => updateRoadmapTextField(item, "episode_goal", value)}
                      value={item.episode_goal}
                    />
                  </p>
                  <p>
                    冲突：
                    <InlinePlanningText
                      label={`第${item.episode_number}集冲突`}
                      locked={roadmapItemLocked(item)}
                      onChange={(value) => updateRoadmapTextField(item, "central_conflict", value)}
                      value={item.central_conflict}
                    />
                  </p>
                  {isPlanningRevisionActive(project) ? <>
                    <p>本集入场状态：<InlinePlanningText label={`第${item.episode_number}集入场状态`} locked={roadmapItemLocked(item)} onChange={(value) => updateRoadmapTextField(item, "entry_state", value)} value={item.entry_state} /></p>
                    <p>本集离场状态：<InlinePlanningText label={`第${item.episode_number}集离场状态`} locked={roadmapItemLocked(item)} onChange={(value) => updateRoadmapTextField(item, "exit_state", value)} value={item.exit_state} /></p>
                  </> : null}
                  <p>
                    人物代价：
                    <InlinePlanningText
                      label={`第${item.episode_number}集人物代价`}
                      locked={roadmapItemLocked(item)}
                      allowEmpty
                      minLength={3}
                      maxLength={500}
                      onChange={(value) => updateRoadmapTextField(item, "protagonist_cost", value)}
                      value={item.protagonist_cost ?? ""}
                    />
                  </p>
                  <RoadmapDramaticUnits
                    episodeNumber={item.episode_number}
                    locked={roadmapItemLocked(item)}
                    structuralLocked={roadmapItemLocked(item) || Boolean(busy)}
                    onAdd={(unit) => addRoadmapDramaticUnit(item, unit)}
                    onRemove={(index) => removeRoadmapDramaticUnit(item, index)}
                    onUpdate={(index, field, value) => updateRoadmapDramaticUnit(item, index, field, value)}
                    units={item.dramatic_units ?? []}
                  />
                  <small>
                    {item.target_duration_seconds ?? 90} 秒 · {item.planned_scene_count ?? 3} 场 · {normalizeEpisodeDialogueLines(item.planned_dialogue_line_count)} 句台词 · {item.planned_shot_count ?? 16} 镜头
                  </small>
                  <div className="story-plan-roadmap-review-actions">
                    <small>{wholeOutlineConfirmation ? item.source_revision_review || item.source_node_version !== node.version ? "上层大纲已变化，请检查本集后统一确认" : isApprovedEpisodeRoadmap(item) ? "已确认" : "草稿 · 完成修改后在顶部统一确认" : hasCurrentRoadmapRebuild(project, node, item) ? "已更新规划，请查看后确认" : item.source_revision_review || item.source_node_version !== node.version ? "上层规划已变化，原文保留待复核" : isApprovedEpisodeRoadmap(item) ? "已确认" : "待确认"}</small>
                    {isPlanningRevisionActive(project) && item.source_node_version !== node.version ? (
                      <button className="outline-action" disabled={roadmapItemLocked(item) || Boolean(busy)} onClick={() => void rebindRoadmapSource(item)} type="button">关联当前上层并复核</button>
                    ) : null}
                    {!wholeOutlineConfirmation && !planningLocked && !isApprovedEpisodeRoadmap(item) ? (
                      <button
                        className="primary-action"
                        disabled={roadmapItemLocked(item) || Boolean(busy)}
                        onClick={() => void confirmEpisodeRoadmapItem(item)}
                        type="button"
                      >
                        确认本集规划
                      </button>
                    ) : null}
                  </div>
                  <small>
                    <InlinePlanningText
                      label={`第${item.episode_number}集结尾钩子类型`}
                      locked={roadmapItemLocked(item)}
                      onChange={(value) => updateRoadmapTextField(item, "ending_hook_type", value)}
                      value={item.ending_hook_type}
                    />
                    ：
                    <InlinePlanningText
                      label={`第${item.episode_number}集结尾钩子`}
                      locked={roadmapItemLocked(item)}
                      onChange={(value) => updateRoadmapTextField(item, "cliffhanger", value)}
                      value={item.cliffhanger}
                    />
                  </small>
                  {item.scene_execution_plan?.length ? (
                    <details
                      className="roadmap-scene-blueprint"
                    >
                      <summary>
                        {t("storyPlanNode.sceneExecutionPlan").replace(
                          "{count}",
                          String(item.scene_execution_plan.length),
                        )}
                      </summary>
                      <ol>
                        {item.scene_execution_plan.map((scene) => (
                          <li key={`${item.episode_number}-scene-${scene.scene_number}`}>
                            <strong>
                              {scene.scene_number}.{" "}
                              <InlinePlanningText
                                label={`第${item.episode_number}集第${scene.scene_number}场标题`}
                                locked={roadmapItemLocked(item)}
                                onChange={(value) => updateRoadmapSceneField(
                                  item,
                                  scene.scene_number,
                                  "scene_heading",
                                  value,
                                )}
                                value={scene.scene_heading}
                              />
                            </strong>
                            <span>
                              <InlinePlanningText
                                label={`第${item.episode_number}集第${scene.scene_number}场目标`}
                                locked={roadmapItemLocked(item)}
                                onChange={(value) => updateRoadmapSceneField(
                                  item,
                                  scene.scene_number,
                                  "scene_objective",
                                  value,
                                )}
                                value={scene.scene_objective}
                              />
                            </span>
                            <small>{scene.dialogue_line_target} 条台词 · {scene.shot_target} 镜头</small>
                            <fieldset className="scene-cast-picker" disabled={roadmapItemLocked(item) || Boolean(busy)}>
                              <legend>本场出场人物 <span>已选 {scene.character_refs.length} 人</span></legend>
                              {node.character_refs.map((reference) => {
                                const character = project.characters.find((entry) => characterMatchesReference(entry, reference));
                                if (!character) return null;
                                return <label key={reference} data-selected={scene.character_refs.includes(reference)}>
                                  <input
                                    type="checkbox"
                                    aria-label={`第${item.episode_number}集第${scene.scene_number}场出场人物${displayName(character.name)}`}
                                    checked={scene.character_refs.includes(reference)}
                                    disabled={scene.character_refs.length === 1 && scene.character_refs.includes(reference)}
                                    onChange={(event) => updateRoadmapSceneCharacter(item, scene.scene_number, reference, event.target.checked)}
                                  /><span>{displayName(character.name)}</span>
                                </label>;
                              })}
                            </fieldset>
                            {([
                              ["visible_action", "可见行动"],
                              ["opposition", "现场阻力"],
                              ["information_shift", "信息变化"],
                              ["choice_or_cost", "选择与代价"],
                              ["turn_or_reveal", "转折与揭示"],
                              ["dialogue_objective", "对白目的"],
                              ["exit_state", "离场状态"],
                            ] as const).map(([key, label]) => (
                              <p key={key}>{label}：<InlinePlanningText
                                label={`第${item.episode_number}集第${scene.scene_number}场${label}`}
                                locked={roadmapItemLocked(item)}
                                allowEmpty={key === "opposition" || key === "information_shift" || key === "choice_or_cost"}
                                onChange={(value) => updateRoadmapSceneField(item, scene.scene_number, key, value)}
                                value={scene[key] ?? ""}
                              /></p>
                            ))}
                            {([
                              ["evidence_requirements", "行动依据"],
                              ["forbidden_changes", "不可改动事实"],
                            ] as const).map(([key, label]) => (scene[key] ?? []).map((value, index) => (
                              <p key={`${key}-${index}`}>{label} {index + 1}：<InlinePlanningText
                                label={`第${item.episode_number}集第${scene.scene_number}场${label}${index + 1}`}
                                locked={roadmapItemLocked(item)}
                                onChange={(next) => updateRoadmapSceneListItem(item, scene.scene_number, key, index, next)}
                                value={value}
                              /></p>
                            )))}
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                  <details className="roadmap-scene-blueprint">
                    <summary>前后集衔接与连续性</summary>
                    <p>选择首次声明的同一条伏笔；本集动作和结果写在“本集兑现”。没有对应伏笔时可取消选择；同集建立并兑现的伏笔在两处选择同一条。</p>
                    {([["setup_refs", "铺垫引用"], ["payoff_refs", "回收引用"]] as const).map(([field, label]) => {
                      const approved = [...new Set([...(node.setup_refs ?? []), ...(node.payoff_refs ?? []), ...(project.episodeRoadmaps ?? []).filter((row) => row.episode_number <= item.episode_number).flatMap((row) => row.setup_refs ?? [])])];
                      const choices = [...new Set([...approved, ...(item[field] ?? [])])];
                      return <label key={field} style={{ display: "block" }}>{label}
                        <select
                          aria-label={`第${item.episode_number}集${label}`}
                          multiple
                          size={Math.min(6, Math.max(2, choices.length))}
                          disabled={roadmapItemLocked(item)}
                          value={item[field] ?? []}
                          onChange={(event) => updateRoadmapSetupPayoffRefs(item, field, Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
                          style={{ display: "block", width: "100%" }}
                        >
                          {choices.map((ref) => <option key={ref} value={ref}>{displayName(ref)}{approved.includes(ref) ? "" : "（当前引用，待复核）"}</option>)}
                        </select>
                      </label>;
                    })}
                    {([
                      ["protagonist_decision", "主角决定"],
                      ["reveal", "本集揭示"],
                      ["emotional_movement", "情绪推进"],
                      ["stage_opposition", "当前阻力"],
                      ["episode_payoff", "本集兑现"],
                      ["pressure_escalation", "后续压力"],
                    ] as const).map(([key, label]) => (
                      <p key={key}>{label}：<InlinePlanningText
                        label={`第${item.episode_number}集${label}`}
                        locked={roadmapItemLocked(item)}
                        allowEmpty={key === "reveal"}
                        onChange={(value) => updateRoadmapTextField(item, key, value)}
                        value={item[key] ?? ""}
                      /></p>
                    ))}
                    {(item.continuity_requirements ?? []).map((value, index) => (
                      <p key={index}>连续性 {index + 1}：<InlinePlanningText
                        label={`第${item.episode_number}集连续性${index + 1}`}
                        locked={roadmapItemLocked(item)}
                        onChange={(next) => updateRoadmapContinuityItem(item, index, next)}
                        value={value}
                      /></p>
                    ))}
                    <p>下集承接：<InlinePlanningText
                      label={`第${item.episode_number}集下集承接`}
                      locked={roadmapItemLocked(item)}
                      allowEmpty
                      onChange={(value) => updateRoadmapTextField(item, "next_episode_obligation", value)}
                      value={item.next_episode_obligation}
                    /></p>
                  </details>
                </EpisodePlanningCard>
                </div>
              ))}
            </div>
          ) : null}
          {message ? <div className="inline-notice">{message}</div> : null}
          </div>
        </div>
      </details>
      {descendantDecision ? (
        <div className="tag-dialog-backdrop" role="presentation">
          <div aria-modal="true" className="tag-dialog planning-descendant-dialog" role="dialog">
            <span className="section-kicker">{t("storyPlanNode.descendantDecisionKicker")}</span>
            <h3>{t("storyPlanNode.descendantDecisionTitle")}</h3>
            <p>{t("storyPlanNode.descendantDecisionHelp")}</p>
            <div className="planning-descendant-options">
              <button
                className="outline-action"
                disabled={busy === "save" || treeBusy}
                onClick={() => setDescendantDecision(null)}
                type="button"
              >
                {t("storyPlanNode.descendantDecisionCancel")}
              </button>
              <button
                className="outline-action"
                disabled={busy === "save" || treeBusy}
                onClick={() => void persistNode(descendantDecision.candidate, descendantDecision.source, "rebase").catch(reportNodeSaveError)}
                type="button"
              >
                {t("storyPlanNode.descendantDecisionKeep")}
              </button>
              <button
                className="primary-action"
                disabled={isPlanningRevisionActive(project) || busy === "save" || treeBusy}
                onClick={() => void persistNode(descendantDecision.candidate, descendantDecision.source, "invalidate").catch(reportNodeSaveError)}
                type="button"
              >
                {t("storyPlanNode.descendantDecisionResplit")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {children.length && !directScriptReady ? (
        <details
          className="story-plan-children-group is-document-group"
          onClick={(event) => {
            // Keep this group open without cancelling nested scene/ref editors.
            const summary = (event.target as HTMLElement).closest("summary");
            if (summary?.parentElement === event.currentTarget) event.preventDefault();
          }}
          onToggle={(event) => {
            if (!event.currentTarget.open) event.currentTarget.open = true;
          }}
          open
        >
          <summary>
            <span className="story-plan-node-toggle"><ArrowIcon /></span>
            {t("storyPlanNode.childCount").replace("{count}", String(children.length))}
          </summary>
          <div className="story-plan-children">
              {children.map((child, index) => (
              <PlanNodeBranch wholeOutlineConfirmation={wholeOutlineConfirmation} focusedEpisodeNumber={focusedEpisodeNumber} depth={depth + 1} initialNode={child} key={`${child.node_id}-${child.version}`} outlineNumber={outlineNumber ? `${outlineNumber}.${index + 1}` : String(index + 1)} onRoadmapConfirmed={onRoadmapConfirmed} onAssistantFocus={onAssistantFocus} onAssistantRegister={onAssistantRegister} onAssistantUpdate={onAssistantUpdate} onInteractionChange={onInteractionChange} onRegisterRevision={onRegisterRevision} onProjectUpdate={onProjectUpdate} onRequestResplit={onRequestResplit} onTreeSnapshotChange={onTreeSnapshotChange} planningLocked={planningLocked} project={project} refreshToken={refreshToken} storyBible={storyBible} storyPlanNodes={storyPlanNodes} treeBusy={treeBusy} treeCheckpointRefreshes={treeCheckpointRefreshes} treeUnlockedNodeIds={treeUnlockedNodeIds} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
    </PlanningNameDisplayContext.Provider>
  );
}

function downloadPlanningFile(content: string, filename: string) {
  downloadBlob(new Blob([content], { type: "text/markdown;charset=utf-8" }), filename);
}

function collectStoryPlanSubtreeVersions(
  nodes: StoryPlanNode[],
  root: StoryPlanNode,
): Map<string, number> {
  const descendants = new Map<string, number>();
  const queue = [{ nodeId: root.node_id, version: root.version }];
  while (queue.length) {
    const parent = queue.shift();
    if (!parent) break;
    for (const candidate of nodes) {
      if (
        candidate.parent_node_id === parent.nodeId
        && candidate.parent_node_version === parent.version
      ) {
        descendants.set(candidate.node_id, candidate.version);
        queue.push({ nodeId: candidate.node_id, version: candidate.version });
      }
    }
  }
  return descendants;
}

function remapRoadmapsForRebasedSubtree(
  items: EpisodeRoadmapItem[],
  previousVersions: Map<string, number>,
  nextVersions: Map<string, number>,
  forceDraft = false,
): EpisodeRoadmapItem[] {
  return mergeEpisodeRoadmaps([], items.map((item) => {
    const previousVersion = previousVersions.get(item.source_node_id);
    const nextVersion = nextVersions.get(item.source_node_id);
    if (
      previousVersion === undefined
      || nextVersion === undefined
      || item.source_node_version !== previousVersion
    ) return item;
    return {
      ...item,
      source_node_version: nextVersion,
      status: forceDraft ? "draft" as const : item.status,
    };
  }));
}

function reconcileRoadmapsAfterNodeRevision(
  items: EpisodeRoadmapItem[],
  previousRoot: StoryPlanNode,
  nextRoot: StoryPlanNode,
  previousDescendants: Map<string, number>,
  nextVersions: Map<string, number>,
  policy: "invalidate" | "rebase",
): EpisodeRoadmapItem[] {
  const withoutPreviousRoot = mergeEpisodeRoadmaps(
    items.filter((item) => !(item.source_node_id === previousRoot.node_id
      && item.source_node_version === previousRoot.version)),
    unchangedRoadmapPrefixAfterNodeRevision(items, previousRoot, nextRoot),
  );
  if (policy === "rebase") {
    return remapRoadmapsForRebasedSubtree(
      withoutPreviousRoot,
      previousDescendants,
      nextVersions,
      true,
    );
  }
  return withoutPreviousRoot.filter((item) => (
    previousDescendants.get(item.source_node_id) !== item.source_node_version
  ));
}

function PlanListField({ editing, label, locked = false, onChange, values: sourceValues }: {
  editing: boolean;
  label: string;
  locked?: boolean;
  onChange: (value: string[]) => void;
  values: string[];
}) {
  const displayName = useContext(PlanningNameDisplayContext);
  const values = sourceValues.map(displayName);
  return (
    <label className="story-bible-field">
      <span>{label}</span>
      {editing ? (
        <textarea
          disabled={locked}
          onChange={(event) => onChange(event.target.value.split("\n").map((value) => value.trim()).filter(Boolean))}
          rows={6}
          value={values.join("\n")}
        />
      ) : (
        <ol>{values.map((value, index) => (
          <li
            aria-readonly={locked}
            contentEditable={!locked}
            key={`${index}-${value}`}
            onBlur={(event) => {
              const nextValue = event.currentTarget.textContent?.trim() ?? "";
              if (nextValue !== value) {
                onChange(sourceValues.map((item, itemIndex) => itemIndex === index ? nextValue : item));
              }
            }}
            suppressContentEditableWarning
          >
            {value}
          </li>
        ))}</ol>
      )}
    </label>
  );
}

function PlanField({ editing, label, locked = false, onChange, showLabel = true, value: sourceValue }: {
  editing: boolean;
  label: string;
  locked?: boolean;
  onChange: (value: string) => void;
  showLabel?: boolean;
  value: string;
}) {
  const value = useContext(PlanningNameDisplayContext)(sourceValue);
  return (
    <label className="story-bible-field">
      {showLabel ? <span>{label}</span> : null}
      {editing
        ? <textarea disabled={locked} onChange={(event) => onChange(event.target.value)} rows={3} value={value} />
        : (
          <p
            aria-readonly={locked}
            className="story-bible-inline-document-text"
            contentEditable={!locked}
            data-planning-field={label}
            data-planning-field-text={value}
            onBlur={(event) => {
              const nextValue = event.currentTarget.textContent ?? "";
              if (nextValue !== value) onChange(nextValue);
            }}
            suppressContentEditableWarning
          >
            {value}
          </p>
        )}
    </label>
  );
}

function RoadmapDramaticUnits({ episodeNumber, locked, structuralLocked, onAdd, onRemove, onUpdate, units }: {
  episodeNumber: number;
  locked: boolean;
  structuralLocked: boolean;
  onAdd: (unit: EpisodeDramaticUnit) => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof EpisodeDramaticUnit, value: string) => void;
  units: EpisodeDramaticUnit[];
}) {
  const [adding, setAdding] = useState(false);
  return (
    <details className="roadmap-scene-blueprint roadmap-dramatic-units">
      <summary>戏剧单位{units.length ? `（${units.length}）` : "（可选）"}</summary>
      {units.length ? (
        <ol>
          {units.map((unit, index) => (
            <li key={`${episodeNumber}-dramatic-unit-${index}`}>
              {DRAMATIC_UNIT_FIELDS.map(({ key, label, minLength, maxLength }) => (
                <p key={key}>
                  {label}：
                  <InlinePlanningText
                    allowEmpty={key === "evidence_hint"}
                    label={`第${episodeNumber}集第${index + 1}个戏剧单位${label}`}
                    locked={locked}
                    minLength={minLength}
                    maxLength={maxLength}
                    onChange={(value) => onUpdate(index, key, value)}
                    value={unit[key] ?? ""}
                  />
                </p>
              ))}
              {!locked ? (
                <button
                  aria-label={`删除第${index + 1}个戏剧单位`}
                  className="small-icon-button danger"
                  disabled={structuralLocked}
                  onClick={() => onRemove(index)}
                  title="删除戏剧单位"
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {adding && !locked ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (structuralLocked || units.length >= MAX_DRAMATIC_UNITS) return;
            const data = new FormData(event.currentTarget);
            const unit = Object.fromEntries(DRAMATIC_UNIT_FIELDS.map(({ key }) => [
              key, String(data.get(key) ?? "").trim(),
            ])) as unknown as EpisodeDramaticUnit;
            const invalidField = DRAMATIC_UNIT_FIELDS.find(({ key, minLength }) => (
              (key !== "evidence_hint" || unit[key]) && (unit[key]?.length ?? 0) < minLength
            ));
            if (invalidField) {
              const input = event.currentTarget.elements.namedItem(invalidField.key) as HTMLTextAreaElement;
              input.setCustomValidity(`请填写至少${invalidField.minLength}个字。`);
              input.reportValidity();
              return;
            }
            onAdd({ ...unit, evidence_hint: unit.evidence_hint || null });
            setAdding(false);
          }}
        >
          {DRAMATIC_UNIT_FIELDS.map(({ key, label, minLength, maxLength }) => (
            <label className="story-bible-field" key={key}>
              <span>{label}{key === "evidence_hint" ? "（可选）" : ""}</span>
              <textarea
                aria-label={`第${episodeNumber}集新增戏剧单位${label}`}
                disabled={structuralLocked}
                minLength={minLength}
                maxLength={maxLength}
                name={key}
                onInput={(event) => event.currentTarget.setCustomValidity("")}
                required={key !== "evidence_hint"}
                rows={key === "change_type" ? 1 : 2}
              />
            </label>
          ))}
          <div className="character-card-actions">
            <button aria-label="保存戏剧单位" className="small-icon-button" disabled={structuralLocked} title="保存戏剧单位" type="submit">
              <Save aria-hidden="true" />
            </button>
            <button aria-label="取消添加" className="small-icon-button" onClick={() => setAdding(false)} title="取消添加" type="button">
              <X aria-hidden="true" />
            </button>
          </div>
        </form>
      ) : !locked ? (
        <button
          aria-label="添加戏剧单位"
          className="small-icon-button"
          disabled={structuralLocked || units.length >= MAX_DRAMATIC_UNITS}
          onClick={() => setAdding(true)}
          title={units.length >= MAX_DRAMATIC_UNITS ? "戏剧单位已达上限" : "添加戏剧单位"}
          type="button"
        >
          <Plus aria-hidden="true" />
        </button>
      ) : null}
    </details>
  );
}

function InlinePlanningText({ allowEmpty = false, label, locked = false, minLength, maxLength, onChange, value: sourceValue }: {
  allowEmpty?: boolean;
  label: string;
  locked?: boolean;
  minLength?: number;
  maxLength?: number;
  onChange: (value: string) => void;
  value: string;
}) {
  const value = useContext(PlanningNameDisplayContext)(sourceValue);
  const [validationError, setValidationError] = useState<string | null>(null);
  return (
    <>
    <span
      aria-label={label}
      aria-invalid={Boolean(validationError)}
      aria-multiline="true"
      aria-placeholder={allowEmpty ? "未填写" : undefined}
      aria-readonly={locked}
      className="story-bible-inline-editable"
      contentEditable={!locked}
      data-planning-field={label}
      data-planning-field-text={value}
      onBlur={(event) => {
        const rawValue = event.currentTarget.textContent ?? "";
        const nextValue = minLength === undefined ? rawValue : rawValue.trim();
        if (!(allowEmpty && !nextValue) && minLength !== undefined && nextValue.length < minLength) {
          event.currentTarget.textContent = value;
          setValidationError(`请填写至少${minLength}个字。`);
          return;
        }
        if (maxLength !== undefined && nextValue.length > maxLength) {
          event.currentTarget.textContent = value;
          setValidationError(`请控制在${maxLength}个字以内。`);
          return;
        }
        setValidationError(null);
        if (nextValue !== value) onChange(nextValue);
      }}
      onInput={() => setValidationError(null)}
      role="textbox"
      style={value ? { display: "inline" } : { display: "inline-block", minWidth: "4em", minHeight: "1.5em", borderBottom: "1px solid var(--line)", verticalAlign: "bottom" }}
      suppressContentEditableWarning
    >
      {value}
    </span>
    {validationError ? <small role="alert">{validationError}</small> : null}
    </>
  );
}
