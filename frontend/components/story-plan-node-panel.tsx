"use client";

import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Download,
  GitBranch,
  ListTree,
  LockKeyhole,
  Save,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";

import { ArrowIcon } from "@/components/icons";
import { DocumentOutline, type DocumentOutlineEntry } from "@/components/document-outline";
import {
  PlanningCanvasCopilot,
  type PlanningCanvasAction,
  type PlanningCanvasMessage,
} from "@/components/planning-canvas-copilot";
import { SelectionEditToolbar } from "@/components/selection-edit-toolbar";
import { SectionHelp } from "@/components/section-help";
import { WorkspaceSectionDirectory } from "@/components/workspace-section-directory";
import { isRequestAborted, userFacingError } from "@/lib/api-error";
import {
  approvedDirectScriptCoverageThrough,
  approveEpisodeRoadmapItem,
  draftEpisodeRoadmapItem,
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
import {
  generateTopLevelStoryPlanNodes,
  loadChildStoryPlanNodes,
  loadActiveStoryPlanNodes,
  loadTopLevelStoryPlanNodes,
  modifyEpisodePlanItem,
  modifyStoryPlanNode,
  saveStoryPlanNodeDraft,
  savePlanningSession,
  type PlanningRevisionMode,
  type StoryBible,
  type StoryBibleSelectionContext,
  type StoryPlanNode,
} from "@/lib/story-planning-client";
import {
  enqueuePlanningTask,
  planningTaskElapsedSeconds,
  useTrackedPlanningTask,
  waitForPlanningTaskResume,
} from "@/lib/story-planning-background";
import {
  runFullStoryTreeExpansion,
  type StoryTreeExpansionProgress,
} from "@/lib/story-tree-expansion";
import {
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
  loadWorkspaceChatMessages,
  saveWorkspaceChatMessages,
  subscribeWorkspaceChatMessages,
} from "@/lib/workspace-section-memory";
import type {
  EpisodeRoadmapItem,
  ScriptProject,
} from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

type ProjectUpdate = Partial<ScriptProject>
  | ((current: ScriptProject) => Partial<ScriptProject>);
type ProjectUpdateHandler = (
  patch: ProjectUpdate,
) => Promise<boolean | void> | boolean | void;

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
  busy: boolean;
  disabled: boolean;
  instruction: string;
  messages: PlanningCanvasMessage[];
  onClearSelection: () => void;
  onEditMessage: (messageId: string, text: string, quote?: StoryBibleSelectionContext | null) => void;
  onInstructionChange: (value: string) => void;
  onPause: () => void;
  onQuickAction: (action: PlanningCanvasAction, instruction: string) => void;
  onSubmit: () => void;
  scopeLabel: string;
  selection: StoryBibleSelectionContext | null;
};

type StoryPlanOutlineEntry = DocumentOutlineEntry & { nodeId: string };

type RoadmapRevisionMerger = (latest: EpisodeRoadmapItem) => EpisodeRoadmapItem;

const STORY_PLAN_ROOT_MARKER = "system_story_bible_root.v1";

function storyPlanNodeAnchor(nodeId: string): string {
  return `story-plan-node-${nodeId}`;
}

function storyPlanRoadmapAnchor(nodeId: string, episodeNumber: number): string {
  return `story-plan-roadmap-${nodeId}-${episodeNumber}`;
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
  const { syncProjectSnapshot } = useProjects();
  const router = useRouter();
  const [topLevelNodes, setTopLevelNodes] = useState<StoryPlanNode[]>([]);
  const [activeTreeNodes, setActiveTreeNodes] = useState<StoryPlanNode[]>([]);
  const [busy, setBusy] = useState<"load" | "generate" | "roadmap" | "save" | "confirm" | null>("load");
  const [message, setMessage] = useState<string | null>(null);
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
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
  const planningActionInFlightRef = useRef(false);
  const latestProjectRef = useRef(project);
  const planningLocked = project.planningSession?.phase === "script"
    && project.planningSession.status === "approved";
  const planningCheckpointSaved = project.planningSession?.status === "active";
  const assistantGettersRef = useRef(new Map<string, () => StoryPlanAssistantState>());
  const [activeAssistantNodeId, setActiveAssistantNodeId] = useState<string | null>(null);
  const [, setAssistantRevision] = useState(0);
  const [autoExpansionRequested, setAutoExpansionRequested] = useState(false);
  const [revisionHistory, setRevisionHistory] = useState<GlobalRevisionEntry[]>([]);
  // This is deliberately transient: a top-level direction applies to one
  // generation round and must not become the default for later layers.
  const [treeAuthorInstruction, setTreeAuthorInstruction] = useState("");
  const [treeInstructionOpen, setTreeInstructionOpen] = useState(false);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const outlineEntries = useMemo(
    () => buildStoryPlanOutline(
      activeTreeNodes,
      topLevelNodes,
      project.episodeRoadmaps ?? [],
    ),
    [activeTreeNodes, project.episodeRoadmaps, topLevelNodes],
  );
  useEffect(() => {
    setTreeAuthorInstruction("");
    setTreeInstructionOpen(false);
  }, [project.id, storyBible.story_bible_id, storyBible.version]);
  useEffect(() => {
    latestProjectRef.current = project;
  }, [project]);
  useEffect(() => {
    setRevisionHistory([]);
  }, [project.id, storyBible.story_bible_id, storyBible.version]);
  const topLevelTaskKey = `full-tree:${project.id}:${storyBible.story_bible_id}:${storyBible.version}`;
  const topLevelTask = useTrackedPlanningTask(topLevelTaskKey);
  const topLevelTaskActive = topLevelTask?.status === "queued" || topLevelTask?.status === "running";
  const roadmapBatchTaskKey = `episode-roadmap-all:${project.id}:${storyBible.story_bible_id}:${storyBible.version}`;
  const roadmapBatchTask = useTrackedPlanningTask(roadmapBatchTaskKey);
  const roadmapBatchTaskActive = roadmapBatchTask?.status === "queued"
    || roadmapBatchTask?.status === "running";
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
        if (active) setMessage(userFacingError(error, t("storyPlanNode.loadFailed")));
      })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [project.id, storyBible.story_bible_id, storyBible.version, t]);

  useEffect(() => {
    if (
      busy !== "generate"
      && busy !== "roadmap"
      && !topLevelTaskActive
      && !roadmapBatchTaskActive
    ) {
      setGenerationElapsedSeconds(0);
      return;
    }
    const activeTask = roadmapBatchTaskActive
      ? roadmapBatchTask
      : topLevelTaskActive
        ? topLevelTask
        : undefined;
    const localStartedAt = Date.now();
    const updateElapsed = () => {
      const elapsed = activeTask
        ? planningTaskElapsedSeconds(activeTask)
        : Math.round((Date.now() - localStartedAt) / 1_000);
      setGenerationElapsedSeconds(Math.max(1, elapsed));
    };
    updateElapsed();
    const timer = window.setInterval(() => {
      updateElapsed();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    busy,
    roadmapBatchTask,
    roadmapBatchTaskActive,
    topLevelTask,
    topLevelTaskActive,
  ]);

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
    if (topLevelTask?.status !== "failed") return;
    setBusy(null);
    setMessage((current) => current ?? userFacingError(
      new Error(topLevelTask.error ?? ""),
      t("storyPlanNode.expandLayerFailed"),
    ));
  }, [topLevelTask?.error, topLevelTask?.status, t]);

  useEffect(() => {
    if (roadmapBatchTask?.status !== "failed") return;
    setBusy(null);
    setMessage((current) => current ?? userFacingError(
      new Error(roadmapBatchTask.error ?? ""),
      t("storyPlanNode.roadmapAllFailed"),
    ));
  }, [roadmapBatchTask?.error, roadmapBatchTask?.status, t]);

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

  async function expandFullTree() {
    if (
      planningLocked
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
      const background = enqueuePlanningTask({
        key: topLevelTaskKey,
        kind: "full_tree",
        projectId: requestProject.id,
        label: t("storyPlanNode.expandAllRunning"),
        run: () => runFullStoryTreeExpansion({
          project: requestProject,
          storyBible,
          authorInstruction: roundInstruction,
          stopAfterLayer: true,
          beforeStep: async () => { await waitForPlanningTaskResume(topLevelTaskKey); },
          onProgress: (progress) => setExpansionProgress(progress),
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
        }),
        onSuccess: async (result) => {
          setTopLevelNodes(result.topLevelNodes);
          setActiveTreeNodes(result.activeNodes);
          await persistProjectUpdate(onProjectUpdate, (current) => {
            // The full-tree coordinator no longer owns roadmap generation. Use
            // the latest project snapshot so a leaf edit made during expansion
            // cannot have an obsolete roadmap restored when the tree finishes.
            const episodeRoadmaps = current.episodeRoadmaps ?? [];
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
              activeNodeId: result.activeNodes.find((node) => node.parent_node_id !== null && node.status !== "approved")?.node_id,
            },
          });
          void savePlanningSession(latestProjectRef.current, {
            ...planningSession,
            treeAuthorInstruction: "",
            phase: "story_tree",
            status: "awaiting_review",
            activeNodeId: result.activeNodes.find((node) => node.parent_node_id !== null && node.status !== "approved")?.node_id,
          }).then((saved) => onProjectUpdate?.({ planningSession: saved })).catch(() => undefined);
          setTreeAuthorInstruction("");
          setMessage(t("storyPlanNode.expandLayerComplete"));
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
          const partialFailureMessage = t("storyPlanNode.expandLayerFailed");
          const failureDetail = userFacingError(error, partialFailureMessage);
          setMessage(
            failureDetail === partialFailureMessage
              ? partialFailureMessage
              : `${partialFailureMessage} ${failureDetail}`,
          );
          setExpansionProgress(null);
          setBusy(null);
        },
      });
      void background.promise
        .finally(() => { planningActionInFlightRef.current = false; })
        .catch(() => undefined);
    } catch (error) {
      planningActionInFlightRef.current = false;
      setMessage(userFacingError(error, t("storyPlanNode.expandLayerFailed")));
      setExpansionProgress(null);
      setBusy(null);
    }
  }

  async function generateAllEpisodeRoadmaps() {
    if (
      planningLocked
      || planningActionInFlightRef.current
      || topLevelTaskActive
      || roadmapBatchTaskActive
      || activeBranchInteractions.size > 0
    ) return;
    planningActionInFlightRef.current = true;
    const requestProject = latestProjectRef.current;
    setBusy("roadmap");
    setMessage(null);
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
        run: () => runFullEpisodeRoadmapGeneration({
          project: requestProject,
          storyBible,
          beforeStep: async () => { await waitForPlanningTaskResume(roadmapBatchTaskKey); },
          onProgress: (progress) => setRoadmapGenerationProgress(progress),
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
        }),
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
          setMessage(userFacingError(error, t("storyPlanNode.roadmapAllFailed")));
          setBusy(null);
        },
      });
      void background.promise
        .finally(() => { planningActionInFlightRef.current = false; })
        .catch(() => undefined);
    } catch (error) {
      planningActionInFlightRef.current = false;
      setMessage(userFacingError(error, t("storyPlanNode.roadmapAllFailed")));
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
  const planningActionLabel = !topLevelNodes.length
      ? t("storyPlanNode.startInteractive")
      : !treeProgress.expansionComplete
        ? t("storyPlanNode.continueExpandAll")
        : pendingRoadmapReviewCount > 0
          ? "请先审核并批准已生成路线图"
        : treeProgress.generatedRoadmapCount > 0
          ? t("storyPlanNode.continueAllRoadmaps")
          : t("storyPlanNode.generateAllRoadmaps");
  const planningActionIcon = treeProgress.expansionComplete
        ? <ListTree aria-hidden="true" size={15} />
        : <GitBranch aria-hidden="true" size={15} />;
  const planningProgressDetail = pendingReviewCount > 0
    ? t("storyPlanNode.layerReviewPending").replace("{count}", String(pendingReviewCount))
    : pendingRoadmapReviewCount > 0
      ? `已有${pendingRoadmapReviewCount}集路线图待审核，请逐集批准后继续`
    : !topLevelNodes.length
    ? t("storyPlanNode.waitingFirstLayer")
    : treeProgress.expansionComplete
      ? roadmapProgressLabel
      : t("storyPlanNode.readyLeafProgress")
        .replace("{count}", String(treeProgress.readyLeafCount));
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
  async function confirmPlanning() {
    if (
      planningLocked
      || planningActionInFlightRef.current
      || !planningComplete
      || !planningCheckpointSaved
      || busy
      || topLevelTaskActive
      || roadmapBatchTaskActive
      || activeBranchInteractions.size > 0
    ) return;
    planningActionInFlightRef.current = true;
    const requestProject = latestProjectRef.current;
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
      await persistProjectUpdate(onProjectUpdate, { planningSession: saved });
      setRevisionHistory([]);
      // Confirmation only unlocks the script workspace. Starting the first
      // generation remains an explicit action on that page, so a refresh or
      // redirect can never turn the approval click into an implicit request.
      router.push(`/projects/${requestProject.id}/workspace`);
    } catch (error) {
      setMessage(userFacingError(error, t("storyPlanNode.planningConfirmFailed")));
    } finally {
      planningActionInFlightRef.current = false;
      setBusy(null);
    }
  }

  function runNextPlanningStage() {
    if (planningLocked || planningComplete) return;
    if (treeProgress.expansionComplete && pendingRoadmapReviewCount > 0) {
      setMessage("请先审核并批准已生成的路线图；草稿不会自动进入正文。");
      return;
    }
    if (!topLevelNodes.length) {
      void generateInteractiveTopLevel();
    } else if (!treeProgress.expansionComplete) {
      void expandFullTree();
    } else {
      void generateAllEpisodeRoadmaps();
    }
  }
  function exportConfirmedPlanning() {
    if (!planningLocked || !planningComplete) return;
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
    setActiveOutlineId(entry.id);
    focusAssistant(nodeEntry.nodeId);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        document.getElementById(entry.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [focusAssistant, outlineEntries]);
  const selectPlanningDirectoryEntry = useCallback((entry: DocumentOutlineEntry) => {
    if (entry.id === "workspace-section-planning") {
      setActiveOutlineId(null);
      return;
    }
    selectOutlineEntry(entry);
  }, [selectOutlineEntry]);

  return (
    <section className="story-bible-panel story-plan-node-panel">
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
          <div className="document-edit-toolbar story-plan-document-toolbar" role="toolbar" aria-label="文字编辑与规划进度工具">
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
              <span className="story-plan-stage-summary">
                <small>{planningLocked ? <><LockKeyhole aria-hidden="true" size={13} />规划已确认并锁定</> : planningProgressDetail}</small>
              </span>
              {!planningLocked && !treeProgress.expansionComplete ? (
                <div className="story-plan-round-control">
                  <button
                    aria-controls="story-tree-round-instruction"
                    aria-expanded={treeInstructionOpen}
                    aria-label="设置本轮下一层要求"
                    className={`story-plan-round-control-toggle${treeAuthorInstruction.trim() ? " has-value" : ""}`}
                    disabled={Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0}
                    onClick={() => setTreeInstructionOpen((current) => !current)}
                    title="设置本轮下一层要求"
                    type="button"
                  >
                    <SlidersHorizontal aria-hidden="true" size={14} />
                    <span>本轮要求</span>
                    {treeAuthorInstruction.trim() ? <span aria-hidden="true" className="story-plan-round-control-dot" /> : null}
                    <ChevronDown aria-hidden="true" className={treeInstructionOpen ? "is-open" : undefined} size={13} />
                  </button>
                  {treeInstructionOpen ? (
                    <div className="story-plan-round-control-popover" id="story-tree-round-instruction">
                      <div className="story-plan-round-control-heading">
                        <label htmlFor="story-tree-author-instruction">本轮下一层要求</label>
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
                    </div>
                  ) : null}
                </div>
              ) : null}
              {planningLocked ? (
                <button
                  className="outline-action"
                  disabled={!planningComplete}
                  onClick={exportConfirmedPlanning}
                  type="button"
                >
                  <Download aria-hidden="true" size={15} />
                  导出规划
                </button>
              ) : (
                <>
                  {topLevelNodes.length ? (
                    <button
                      className="outline-action"
                      disabled={Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0}
                      onClick={() => void savePlanningCheckpoint()}
                      type="button"
                    >
                      <Save aria-hidden="true" size={15} />
                      {busy === "save" ? "保存中" : planningCheckpointSaved ? "再次保存" : "保存规划"}
                    </button>
                  ) : null}
                  {planningComplete ? (
                    <button
                      className="primary-action"
                      disabled={!planningCheckpointSaved || Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0}
                      onClick={() => void confirmPlanning()}
                      title={planningCheckpointSaved ? "确认后规划将锁定并进入正文" : "请先保存规划"}
                      type="button"
                    >
                      {busy === "confirm" ? t("storyPlanNode.confirmPlanningBusy") : <Check aria-hidden="true" size={15} />}
                      {busy === "confirm" ? null : t("storyPlanNode.confirmPlanning")}
                    </button>
                  ) : (
                    <button
                      className="primary-action"
                      disabled={(treeProgress.expansionComplete && pendingRoadmapReviewCount > 0) || Boolean(busy) || topLevelTaskActive || roadmapBatchTaskActive || activeBranchInteractions.size > 0}
                      onClick={runNextPlanningStage}
                      type="button"
                    >
                      {busy === "generate" || topLevelTaskActive
                        ? t(topLevelNodes.length ? "storyPlanNode.expandAllElapsed" : "storyPlanNode.generatingElapsed")
                          .replace("{seconds}", String(generationElapsedSeconds))
                        : busy === "roadmap" || roadmapBatchTaskActive
                          ? t("storyPlanNode.roadmapAllElapsed").replace("{seconds}", String(generationElapsedSeconds))
                          : planningActionIcon}
                      {busy === "generate" || topLevelTaskActive || busy === "roadmap" || roadmapBatchTaskActive
                        ? null
                        : planningActionLabel}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {busy === "load" ? <p>{t("storyPlanNode.loading")}</p> : null}
          {busy === "generate" ? <div className="inline-notice">{expansionProgress?.level && expansionProgress.totalNodes !== undefined ? t("storyPlanNode.expandLayerProgress").replace("{level}", String(expansionProgress.level)).replace("{completed}", String(expansionProgress.completedNodes ?? 0)).replace("{total}", String(expansionProgress.totalNodes)) : expansionProgress?.nodeTitle ? t("storyPlanNode.expandAllProgress").replace("{title}", expansionProgress.nodeTitle).replace("{count}", String(expansionProgress.completedLeaves)) : t(topLevelNodes.length ? "storyPlanNode.expandAllHelp" : "storyPlanNode.generatingHelp")}</div> : null}
          {busy === "roadmap" || roadmapBatchTaskActive ? <div className="inline-notice">{roadmapGenerationProgress?.currentEpisode ? t("storyPlanNode.roadmapAllProgress").replace("{episode}", String(roadmapGenerationProgress.currentEpisode)).replace("{completed}", String(roadmapGenerationProgress.completedEpisodes)).replace("{total}", String(roadmapGenerationProgress.totalEpisodes)) : t("storyPlanNode.roadmapAllHelp")}</div> : null}
          {message ? <div className={`inline-notice${topLevelTask?.status === "failed" || roadmapBatchTask?.status === "failed" ? " is-error" : ""}`} role={topLevelTask?.status === "failed" || roadmapBatchTask?.status === "failed" ? "alert" : undefined}>{message}</div> : null}
          {!busy && !topLevelNodes.length ? <div className="story-bible-empty"><p>{t("storyPlanNode.empty")}</p></div> : null}
          {topLevelNodes.map((node, index) => <PlanNodeBranch depth={0} initialNode={node} key={`${node.node_id}-${node.version}`} outlineNumber={String(index + 1)} planningLocked={planningLocked} project={project} storyPlanNodes={activeTreeNodes} onProjectUpdate={onProjectUpdate} onInteractionChange={updateBranchInteraction} onRegisterRevision={registerRevision} onRequestResplit={() => setAutoExpansionRequested(true)} onTreeSnapshotChange={setActiveTreeNodes} refreshToken={treeRefreshToken} treeBusy={busy === "generate" || topLevelTaskActive || busy === "roadmap" || roadmapBatchTaskActive} treeCheckpointRefreshes={treeCheckpointRefreshes} treeUnlockedNodeIds={busy === "roadmap" || roadmapBatchTaskActive ? new Set() : treeUnlockedNodeIds} onAssistantRegister={registerAssistant} onAssistantFocus={focusAssistant} onAssistantUpdate={notifyAssistant} />)}
            </div>
          </div>
        </div>
        <PlanningCanvasCopilot
          busy={assistant?.busy ?? false}
          disabled={planningLocked || (assistant?.disabled ?? true)}
          instruction={assistant?.instruction ?? ""}
          messages={assistant?.messages ?? []}
          onClearSelection={assistant?.onClearSelection ?? (() => undefined)}
          onEditMessage={assistant?.onEditMessage}
          onInstructionChange={assistant?.onInstructionChange ?? (() => undefined)}
          onPause={assistant?.onPause}
          onQuickAction={assistant?.onQuickAction ?? (() => undefined)}
          onSubmit={assistant?.onSubmit ?? (() => undefined)}
          scopeLabel={assistant?.scopeLabel ?? "剧情规划"}
          selection={planningLocked ? null : assistant?.selection ?? null}
          thinking={assistant?.busy ?? false}
          variant="document"
        />
      </div>
    </section>
  );
}

function PlanNodeBranch({ depth, initialNode, onAssistantFocus, onAssistantRegister, onAssistantUpdate, onInteractionChange, onRegisterRevision, onProjectUpdate, onRequestResplit, onTreeSnapshotChange, outlineNumber, planningLocked = false, project, refreshToken = 0, storyPlanNodes, treeBusy = false, treeCheckpointRefreshes, treeUnlockedNodeIds }: {
  depth: number;
  initialNode: StoryPlanNode;
  outlineNumber?: string;
  planningLocked?: boolean;
  project: ScriptProject;
  storyPlanNodes: StoryPlanNode[];
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
}) {
  const { t } = useLocale();
  const [node, setNode] = useState(initialNode);
  const [children, setChildren] = useState<StoryPlanNode[]>([]);
  const [busy, setBusy] = useState<
    "load" | "save" | "confirm" | "ai" | "roadmap-ai" | null
  >("load");
  const [message, setMessage] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState("");
  const aiRevisionMode: PlanningRevisionMode = "targeted";
  const [descendantDecision, setDescendantDecision] = useState<{
    candidate: StoryPlanNode;
    source: "ai" | "manual";
  } | null>(null);
  const [roadmapAiInstruction, setRoadmapAiInstruction] = useState("");
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
    if (treeInteractionLocked || candidate.status === "superseded" || generatedRangeLocked) return;
    if (children.length > 0) {
      setDescendantDecision({ candidate, source });
      return;
    }
    if (candidate.status === "approved" && !window.confirm(t("storyPlanNode.modifyConfirmedConfirm"))) {
      return;
    }
    await persistNode(candidate, source, "invalidate");
  }

  async function persistNode(
    candidate: StoryPlanNode,
    source: "ai" | "manual",
    descendantPolicy: "invalidate" | "rebase",
    recordHistory = true,
  ) {
    if (treeInteractionLocked) return;
    const currentNode = nodeRef.current;
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
      const saved = await saveStoryPlanNodeDraft(candidate, descendantPolicy);
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
        episodeRoadmaps: reconcileRoadmapsAfterNodeRevision(
          current.episodeRoadmaps ?? [],
          currentNode,
          previousSubtree,
          nextVersions,
          descendantPolicy,
        ),
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
      if (currentChildren.length > 0 && descendantPolicy === "invalidate") onRequestResplit?.();
    } catch (error) {
      setMessage(userFacingError(error, t("storyPlanNode.saveFailed")));
    } finally {
      setBusy(null);
    }
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
      );
      await requestNodeSave(candidate, "ai");
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: describeAppliedRevision(node, candidate, selectionOverride),
        },
      ]);
      setMessage(null);
    } catch (error) {
      if (isRequestAborted(error, controller.signal)) {
        setChatMessages((current) => [
          ...current,
          { id: `assistant-paused-${Date.now()}`, role: "assistant", text: "已暂停本次思考。你可以编辑刚才的消息后重新发送。" },
        ]);
      } else {
        const errorMessage = userFacingError(error, t("storyPlanNode.aiModifyFailed"));
        setMessage(errorMessage);
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
    if (selectionTarget?.kind === "roadmap") {
      void requestRoadmapAiModification(text, quote ?? null, selectionTarget.item);
      return;
    }
    void requestAiModification(text, quote ?? null);
  }

  function requestQuickNodeAction(action: PlanningCanvasAction, instruction: string) {
    const resolved = action === "continue" && !documentSelection
      ? "请补充当前剧情节点的下一步发展，保持父节点、前置节点和后续交接压力一致。"
      : instruction;
    setAiInstruction(resolved);
    if (selectionTarget?.kind === "roadmap") {
      setRoadmapAiInstruction(resolved);
      void requestRoadmapAiModification(resolved, documentSelection, selectionTarget.item);
      return;
    }
    void requestAiModification(resolved, documentSelection);
  }

  function submitCanvasInstruction() {
    if (selectionTarget?.kind === "roadmap") {
      void requestRoadmapAiModification(aiInstruction, documentSelection, selectionTarget.item);
      return;
    }
    void requestAiModification();
  }

  function capturePlanningSelection(event: SyntheticEvent<HTMLDivElement>) {
    if (planningLocked) return;
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
    setSelectionTarget(roadmapItem ? { kind: "roadmap", item: roadmapItem } : { kind: "node" });
    onAssistantFocus?.(node.node_id);
    onAssistantUpdate?.(node.node_id);
    const selectedIndex = Math.max(0, fullText.indexOf(selectedText));
    const afterStart = selectedIndex + selectedText.length;
    setDocumentSelection({
      source_field: target.dataset.planningField ?? "剧情规划正文",
      selected_text: selectedText.slice(0, 4_000),
      before_text: selectedIndex > 0 ? fullText.slice(Math.max(0, selectedIndex - 320), selectedIndex) : "",
      after_text: fullText.slice(afterStart, afterStart + 320),
    });
  }

  function updateNodeField(
    field: "title" | "narrative_purpose" | "synopsis" | "entry_state" | "central_conflict" | "emotional_direction" | "exit_state" | "unit_resolution" | "handoff_pressure",
    value: string,
  ) {
    if (nodeRevisionLocked) return;
    const candidate = { ...nodeRef.current, [field]: value };
    void requestNodeSave(candidate, "manual");
  }

  function updateNodeStoryBeats(value: string[]) {
    if (nodeRevisionLocked) return;
    const candidate = { ...nodeRef.current, unit_story_beats: value };
    void requestNodeSave(candidate, "manual");
  }

  async function requestRoadmapAiModification(
    instructionOverride?: string,
    selectionOverride: StoryBibleSelectionContext | null = documentSelection,
    targetOverride: EpisodeRoadmapItem | null = selectionTarget?.kind === "roadmap" ? selectionTarget.item : null,
  ) {
    const submittedInstruction = (instructionOverride ?? roadmapAiInstruction).trim();
    if (
      planningLocked
      || treeBusy
      || !targetOverride
      || generatedRangeLocked
      || (roadmapAiRevisionMode === "targeted" && !submittedInstruction)
    ) return;
    const controller = new AbortController();
    aiAbortControllerRef.current = controller;
    setBusy("roadmap-ai");
    setAiInstruction("");
    setRoadmapAiInstruction("");
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
      );
      await applyRoadmapRevision(candidate, targetOverride);
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: describeAppliedRevision(targetOverride, candidate, selectionOverride),
        },
      ]);
    } catch (error) {
      if (isRequestAborted(error, controller.signal)) {
        setChatMessages((current) => [
          ...current,
          { id: `assistant-paused-${Date.now()}`, role: "assistant", text: "已暂停本次思考。你可以编辑刚才的消息后重新发送。" },
        ]);
      } else {
        setMessage(userFacingError(error, t("storyPlanNode.roadmapAiFailed")));
      }
    } finally {
      if (aiAbortControllerRef.current === controller) aiAbortControllerRef.current = null;
      setBusy(null);
    }
  }

  async function applyRoadmapRevision(
    candidate: EpisodeRoadmapItem,
    previousItem?: EpisodeRoadmapItem,
    recordHistory = true,
    mergeWithLatest?: RoadmapRevisionMerger,
  ) {
    if (treeInteractionLocked || generatedRangeLocked) return;
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
      appliedCandidate = {
        ...draftEpisodeRoadmapItem(mergeWithLatest ? mergeWithLatest(latestItem) : candidate),
      };
      const episodeRoadmaps = replaceEpisodeRoadmapItem(
        currentRoadmap,
        appliedCandidate,
      );
      revisionApplied = true;
      return {
        episodeRoadmaps,
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
  }

  async function confirmEpisodeRoadmapItem(item: EpisodeRoadmapItem) {
    if (planningLocked || treeInteractionLocked || generatedRangeLocked || isApprovedEpisodeRoadmap(item)) return;
    const approved = approveEpisodeRoadmapItem(item);
    const currentStoryPlanNodes = storyPlanNodesRef.current;
    setBusy("save");
    try {
      await persistProjectUpdate(onProjectUpdate, (current) => {
        const episodeRoadmaps = mergeEpisodeRoadmaps(current.episodeRoadmaps ?? [], [approved]);
        return {
          episodeRoadmaps,
          episodePlansReadyThrough: approvedDirectScriptCoverageThrough(currentStoryPlanNodes, {
            episodeRoadmaps,
            roadmapRequired: true,
          }) || undefined,
        };
      });
      setMessage(`第${item.episode_number}集路线图已批准。`);
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
    if (nodeRevisionLocked || treeInteractionLocked) return;
    roadmapManualRevisionPendingRef.current += 1;
    setBusy("save");
    setMessage(null);
    const operation = roadmapManualRevisionTailRef.current.then(() => (
      applyRoadmapRevision(item, item, true, mergeWithLatest)
    ));
    roadmapManualRevisionTailRef.current = operation.catch(() => undefined);
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
    field: "episode_title" | "synopsis" | "locations" | "episode_goal" | "central_conflict" | "ending_hook_type" | "cliffhanger",
    value: string,
  ) {
    requestRoadmapManualRevision(item, (latest) => ({
      ...latest,
      [field]: field === "episode_title"
        ? value.trim() || null
        : field === "locations"
          ? value.split(/[、,，;；\n]/).map((location) => location.trim()).filter(Boolean)
          : value,
    }));
  }

  function updateRoadmapSceneField(
    item: EpisodeRoadmapItem,
    sceneNumber: number,
    field: "scene_heading" | "scene_objective",
    value: string,
  ) {
    requestRoadmapManualRevision(item, (latest) => ({
      ...latest,
      scene_execution_plan: latest.scene_execution_plan?.map((scene) => (
        scene.scene_number === sceneNumber ? { ...scene, [field]: value } : scene
      )),
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
  const roadmap = (project.episodeRoadmaps ?? [])
    .filter((item) => (
      item.source_node_id === node.node_id
      && item.source_node_version === node.version
      && item.story_bible_version === node.story_bible_version
    ))
    .sort((left, right) => left.episode_number - right.episode_number);
  const generatedEpisodesInRange = project.episodes.filter((episode) => (
    node.planned_start_episode !== null
    && node.planned_end_episode !== null
    && episode.episodeNumber >= node.planned_start_episode
    && episode.episodeNumber <= node.planned_end_episode
  ));
  const generatedEpisodeCount = new Set(
    generatedEpisodesInRange.map((episode) => episode.episodeNumber),
  ).size;
  const generatedRangeLocked = generatedEpisodeCount > 0;
  const nodeRevisionLocked = planningLocked || generatedRangeLocked;
  const nodeRevisionLockedMessage = planningLocked
    ? "整部剧情规划已经确认，当前版本不可再修改。"
    : generatedRangeLocked
      ? t("storyPlanNode.modificationLocked")
      : undefined;
  const concurrentLeafAccess = treeBusy
    && episodeReadyShape
    && Boolean(treeUnlockedNodeIds?.has(node.node_id))
    && children.length === 0;
  const treeInteractionLocked = planningLocked || (treeBusy && !concurrentLeafAccess);
  const operationLocked = Boolean(busy) || treeInteractionLocked;
  const branchLocked = operationLocked;
  const roadmapRevisionLocked = nodeRevisionLocked
    || treeInteractionLocked
    || (busy !== null && busy !== "save");
  const effectiveEditing = false;

  useEffect(() => {
    onAssistantRegister?.(node.node_id, () => ({
      busy: busy === "ai" || busy === "roadmap-ai",
      disabled: planningLocked || (branchLocked && busy !== "ai" && busy !== "roadmap-ai") || nodeRevisionLocked,
      instruction: selectionTarget?.kind === "roadmap" ? roadmapAiInstruction : aiInstruction,
      messages: chatMessages,
      onClearSelection: () => {
        setDocumentSelection(null);
        setSelectionTarget(null);
      },
      onEditMessage: editChatMessage,
      onInstructionChange: (value: string) => {
        setAiInstruction(value);
        if (selectionTarget?.kind === "roadmap") setRoadmapAiInstruction(value);
      },
      onPause: pauseAiModification,
      onQuickAction: requestQuickNodeAction,
      onSubmit: submitCanvasInstruction,
      scopeLabel: selectionTarget?.kind === "roadmap"
        ? `第${selectionTarget.item.episode_number}集路线图`
        : `剧情节点：${node.title}`,
      selection: documentSelection,
    }));
    onAssistantUpdate?.(node.node_id);
  }, [
    aiInstruction,
    branchLocked,
    busy,
    chatMessages,
    documentSelection,
    node.node_id,
    node.title,
    nodeRevisionLocked,
    planningLocked,
    onAssistantRegister,
    onAssistantUpdate,
    roadmapAiInstruction,
    selectionTarget,
  ]);

  return (
    <div className="story-plan-branch" style={{ marginLeft: `${Math.min(depth, 5) * 18}px` }}>
      <details
        className="story-plan-node-card is-document-node"
        data-depth={depth}
        id={storyPlanNodeAnchor(node.node_id)}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("summary")) event.preventDefault();
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
          <span className="story-plan-node-title">{node.title}</span>
          <span className="story-plan-node-meta">
            {t("storyPlanNode.range").replace("{range}", range)}
            {node.estimated_script_body_characters
              ? ` · ${t("storyPlanNode.characterBudget").replace("{count}", String(node.estimated_script_body_characters))}`
              : ""}
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
            <PlanField
              editing={false}
              label={t("storyPlanNode.nodeTitle")}
              locked={nodeRevisionLocked}
              onChange={(value) => updateNodeField("title", value)}
              value={node.title}
            />
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
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.entryState")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("entry_state", value)} value={node.entry_state} />
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.centralConflict")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("central_conflict", value)} value={node.central_conflict} />
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.emotionalDirection")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("emotional_direction", value)} value={node.emotional_direction} />
              <PlanField editing={effectiveEditing} label={t("storyPlanNode.exitState")} locked={nodeRevisionLocked} onChange={(value) => updateNodeField("exit_state", value)} value={node.exit_state} />
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
          {requiresParentCoordination ? (
            <div className="inline-notice">{t("storyPlanNode.rangeNeedsAdjustment")}</div>
          ) : null}
          {roadmap.length ? (
            <div className="story-plan-children story-plan-episode-plans">
              <div className="section-title-with-help story-plan-roadmap-heading">
                <h3>{t("storyPlanNode.episodePlans")}</h3>
                <SectionHelp content={t("guide.episodeRoadmap")} label={t("guide.openHelp")} />
              </div>
              {roadmap.map((item) => (
                <article
                  className="continuity-card"
                  data-roadmap-episode={item.episode_number}
                  id={storyPlanRoadmapAnchor(node.node_id, item.episode_number)}
                  key={`${node.node_id}-roadmap-${item.episode_number}`}
                >
                  <strong>
                    {t("workspace.episodeLabel").replace("{number}", String(item.episode_number))} ·{" "}
                    <InlinePlanningText
                      label={`第${item.episode_number}集标题`}
                      locked={roadmapRevisionLocked}
                      onChange={(value) => updateRoadmapTextField(item, "episode_title", value)}
                      value={episodeRoadmapDisplayTitle(item)}
                    />
                  </strong>
                  <p>
                    场地：
                    <InlinePlanningText
                      label={`第${item.episode_number}集场地`}
                      locked={roadmapRevisionLocked}
                      onChange={(value) => updateRoadmapTextField(item, "locations", value)}
                      value={episodeRoadmapLocations(item)}
                    />
                  </p>
                  <p>
                    出场人物 & 性别：{episodeRoadmapCharacters(item, project.characters)}
                  </p>
                  <p>
                    梗概：
                    <InlinePlanningText
                      label={`第${item.episode_number}集梗概`}
                      locked={roadmapRevisionLocked}
                      onChange={(value) => updateRoadmapTextField(item, "synopsis", value)}
                      value={episodeRoadmapSynopsis(item)}
                    />
                  </p>
                  <p>
                    目标：
                    <InlinePlanningText
                      label={`第${item.episode_number}集目标`}
                      locked={roadmapRevisionLocked}
                      onChange={(value) => updateRoadmapTextField(item, "episode_goal", value)}
                      value={item.episode_goal}
                    />
                  </p>
                  <p>
                    冲突：
                    <InlinePlanningText
                      label={`第${item.episode_number}集冲突`}
                      locked={roadmapRevisionLocked}
                      onChange={(value) => updateRoadmapTextField(item, "central_conflict", value)}
                      value={item.central_conflict}
                    />
                  </p>
                  <small>
                    {item.target_duration_seconds ?? 90} 秒 · {item.planned_scene_count ?? 3} 场 · {normalizeEpisodeDialogueLines(item.planned_dialogue_line_count)} 句台词 · {item.planned_shot_count ?? 16} 镜头
                  </small>
                  <div className="story-plan-roadmap-review-actions">
                    <small>{isApprovedEpisodeRoadmap(item) ? "已批准" : "待审核"}</small>
                    {!planningLocked && !isApprovedEpisodeRoadmap(item) ? (
                      <button
                        className="outline-action"
                        disabled={roadmapRevisionLocked || Boolean(busy)}
                        onClick={() => void confirmEpisodeRoadmapItem(item)}
                        type="button"
                      >
                        批准本集路线图
                      </button>
                    ) : null}
                  </div>
                  <small>
                    <InlinePlanningText
                      label={`第${item.episode_number}集结尾钩子类型`}
                      locked={roadmapRevisionLocked}
                      onChange={(value) => updateRoadmapTextField(item, "ending_hook_type", value)}
                      value={item.ending_hook_type}
                    />
                    ：
                    <InlinePlanningText
                      label={`第${item.episode_number}集结尾钩子`}
                      locked={roadmapRevisionLocked}
                      onChange={(value) => updateRoadmapTextField(item, "cliffhanger", value)}
                      value={item.cliffhanger}
                    />
                  </small>
                  {item.scene_execution_plan?.length ? (
                    <details
                      className="roadmap-scene-blueprint"
                      open
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("summary")) event.preventDefault();
                      }}
                      onToggle={(event) => {
                        if (!event.currentTarget.open) event.currentTarget.open = true;
                      }}
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
                                locked={roadmapRevisionLocked}
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
                                locked={roadmapRevisionLocked}
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
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </article>
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
                onClick={() => void persistNode(descendantDecision.candidate, descendantDecision.source, "rebase")}
                type="button"
              >
                {t("storyPlanNode.descendantDecisionKeep")}
              </button>
              <button
                className="primary-action"
                disabled={busy === "save" || treeBusy}
                onClick={() => void persistNode(descendantDecision.candidate, descendantDecision.source, "invalidate")}
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
            if ((event.target as HTMLElement).closest("summary")) event.preventDefault();
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
              <PlanNodeBranch depth={depth + 1} initialNode={child} key={`${child.node_id}-${child.version}`} outlineNumber={outlineNumber ? `${outlineNumber}.${index + 1}` : String(index + 1)} onAssistantFocus={onAssistantFocus} onAssistantRegister={onAssistantRegister} onAssistantUpdate={onAssistantUpdate} onInteractionChange={onInteractionChange} onRegisterRevision={onRegisterRevision} onProjectUpdate={onProjectUpdate} onRequestResplit={onRequestResplit} onTreeSnapshotChange={onTreeSnapshotChange} planningLocked={planningLocked} project={project} refreshToken={refreshToken} storyPlanNodes={storyPlanNodes} treeBusy={treeBusy} treeCheckpointRefreshes={treeCheckpointRefreshes} treeUnlockedNodeIds={treeUnlockedNodeIds} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function downloadPlanningFile(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
  previousDescendants: Map<string, number>,
  nextVersions: Map<string, number>,
  policy: "invalidate" | "rebase",
): EpisodeRoadmapItem[] {
  const withoutPreviousRoot = items.filter((item) => !(
    item.source_node_id === previousRoot.node_id
    && item.source_node_version === previousRoot.version
  ));
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

function PlanListField({ editing, label, locked = false, onChange, values }: {
  editing: boolean;
  label: string;
  locked?: boolean;
  onChange: (value: string[]) => void;
  values: string[];
}) {
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
                onChange(values.map((item, itemIndex) => itemIndex === index ? nextValue : item));
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

function PlanField({ editing, label, locked = false, onChange, showLabel = true, value }: {
  editing: boolean;
  label: string;
  locked?: boolean;
  onChange: (value: string) => void;
  showLabel?: boolean;
  value: string;
}) {
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

function InlinePlanningText({ label, locked = false, onChange, value }: {
  label: string;
  locked?: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <span
      aria-label={label}
      aria-multiline="true"
      aria-readonly={locked}
      className="story-bible-inline-editable"
      contentEditable={!locked}
      data-planning-field={label}
      data-planning-field-text={value}
      onBlur={(event) => {
        const nextValue = event.currentTarget.textContent ?? "";
        if (nextValue !== value) onChange(nextValue);
      }}
      role="textbox"
      style={{ display: "inline" }}
      suppressContentEditableWarning
    >
      {value}
    </span>
  );
}
