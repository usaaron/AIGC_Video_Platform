"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  CandidatePreviewField,
  CandidatePreviewList,
  CandidateReviewDialog,
} from "@/components/candidate-review-dialog";
import { ArrowIcon, CloseIcon } from "@/components/icons";
import { PlanningRevisionModeControl } from "@/components/planning-revision-mode-control";
import { SectionHelp } from "@/components/section-help";
import { userFacingError } from "@/lib/api-error";
import {
  approvedDirectScriptCoverageThrough,
  contiguousEpisodeCoverageThrough,
  hasCompleteApprovedRoadmap,
  isDirectScriptNode,
  isOversizedStoryPlanNode,
  mergeEpisodeRoadmaps,
  replaceEpisodeRoadmapDraft,
  storyPlanNodeEpisodeSpan,
} from "@/lib/episode-generation-planning";
import {
  approveStoryPlanNode,
  decomposeStoryPlanNode,
  generateEpisodePlanBatch,
  loadChildStoryPlanNodes,
  loadActiveStoryPlanNodes,
  loadTopLevelStoryPlanNodes,
  modifyEpisodePlanItem,
  modifyStoryPlanNode,
  saveStoryPlanNodeDraft,
  type PlanningRevisionMode,
  type StoryBible,
  type StoryPlanNode,
} from "@/lib/story-planning-client";
import {
  enqueuePlanningTask,
  useTrackedPlanningTask,
  waitForPlanningTaskResume,
} from "@/lib/story-planning-background";
import {
  runFullStoryTreeExpansion,
  type StoryTreeExpansionProgress,
} from "@/lib/story-tree-expansion";
import type { EpisodeRoadmapItem, ScriptProject } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

type ProjectUpdate = Partial<ScriptProject>
  | ((current: ScriptProject) => Partial<ScriptProject>);
type ProjectUpdateHandler = (
  patch: ProjectUpdate,
) => Promise<boolean | void> | boolean | void;

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
  const [topLevelNodes, setTopLevelNodes] = useState<StoryPlanNode[]>([]);
  const [busy, setBusy] = useState<"load" | "generate" | null>("load");
  const [message, setMessage] = useState<string | null>(null);
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
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
  const [autoExpansionRequested, setAutoExpansionRequested] = useState(false);
  const topLevelTaskKey = `full-tree:${project.id}:${storyBible.story_bible_id}:${storyBible.version}`;
  const topLevelTask = useTrackedPlanningTask(topLevelTaskKey);
  const topLevelTaskActive = topLevelTask?.status === "queued" || topLevelTask?.status === "running";
  const updateBranchInteraction = useCallback((key: string, active: boolean) => {
    setActiveBranchInteractions((current) => {
      if (current.has(key) === active) return current;
      const next = new Set(current);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    let active = true;
    setBusy("load");
    setTopLevelNodes([]);
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
    if (busy !== "generate" && !topLevelTaskActive) {
      setGenerationElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setGenerationElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busy, topLevelTaskActive]);

  useEffect(() => {
    if (topLevelTask?.status !== "completed") return;
    let active = true;
    loadTopLevelStoryPlanNodes(
      project.id,
      storyBible.story_bible_id,
      storyBible.version,
    ).then((value) => {
      if (active) setTopLevelNodes(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [project.id, storyBible.story_bible_id, storyBible.version, topLevelTask?.status]);

  useEffect(() => {
    if (topLevelTask?.status !== "failed") return;
    setBusy(null);
    setMessage((current) => current ?? userFacingError(
      new Error(topLevelTask.error ?? ""),
      t("storyPlanNode.generateFailed"),
    ));
  }, [topLevelTask?.error, topLevelTask?.status, t]);

  useEffect(() => {
    if (
      !autoExpansionRequested
      || busy
      || topLevelTaskActive
      || activeBranchInteractions.size > 0
    ) return;
    setAutoExpansionRequested(false);
    void expandFullTree();
  }, [activeBranchInteractions.size, autoExpansionRequested, busy, topLevelTaskActive]);

  async function expandFullTree() {
    if (topLevelTaskActive || activeBranchInteractions.size > 0) return;
    setBusy("generate");
    setMessage(null);
    const syncState = await syncProjectSnapshot(project);
    if (syncState.status !== "synced") {
      setBusy(null);
      setMessage(t("storyBible.syncRequired"));
      return;
    }
    const background = enqueuePlanningTask({
      key: topLevelTaskKey,
      kind: "full_tree",
      projectId: project.id,
      label: t("storyPlanNode.expandAllRunning"),
      run: () => runFullStoryTreeExpansion({
        project,
        storyBible,
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
        setMessage(t("storyPlanNode.expandAllComplete"));
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
          await persistProjectUpdate(onProjectUpdate, (current) => ({
            episodePlansReadyThrough: approvedDirectScriptCoverageThrough(activeNodes, {
              episodeRoadmaps: current.episodeRoadmaps ?? [],
              roadmapRequired: current.episodeRoadmapRequired === true,
            }) || undefined,
          }));
        } catch {
          // Keep the original generation error because it is the actionable failure.
        }
        setMessage(userFacingError(error, t("storyPlanNode.generateFailed")));
        setExpansionProgress(null);
        setBusy(null);
      },
    });
    void background.promise.catch(() => undefined);
  }

  return (
    <section className="story-bible-panel story-plan-node-panel">
      <div className="story-bible-heading">
        <div>
          <span className="section-kicker">{t("storyPlanNode.kicker")}</span>
          <div className="section-title-with-help">
            <h2>{t("storyPlanNode.title")}</h2>
            <SectionHelp content={t("guide.storyTree")} label={t("guide.openHelp")} />
          </div>
        </div>
        <button className="primary-action" disabled={Boolean(busy) || topLevelTaskActive || activeBranchInteractions.size > 0} onClick={() => void expandFullTree()} type="button">
          {busy === "generate" || topLevelTaskActive
            ? t("storyPlanNode.expandAllElapsed")
              .replace("{seconds}", String(generationElapsedSeconds))
            : topLevelNodes.length
              ? t("storyPlanNode.continueExpandAll")
              : t("storyPlanNode.expandAll")}
        </button>
      </div>
      {busy === "load" ? <p>{t("storyPlanNode.loading")}</p> : null}
      {busy === "generate" ? (
        <div className="inline-notice">
          {expansionProgress?.level && expansionProgress.totalNodes !== undefined
            ? t("storyPlanNode.expandLayerProgress")
              .replace("{level}", String(expansionProgress.level))
              .replace("{completed}", String(expansionProgress.completedNodes ?? 0))
              .replace("{total}", String(expansionProgress.totalNodes))
            : expansionProgress?.nodeTitle
            ? t("storyPlanNode.expandAllProgress")
              .replace("{title}", expansionProgress.nodeTitle)
              .replace("{count}", String(expansionProgress.completedLeaves))
            : t("storyPlanNode.expandAllHelp")}
        </div>
      ) : null}
      {message ? (
        <div
          className={`inline-notice${topLevelTask?.status === "failed" ? " is-error" : ""}`}
          role={topLevelTask?.status === "failed" ? "alert" : undefined}
        >
          {message}
        </div>
      ) : null}
      {!busy && !topLevelNodes.length ? <div className="story-bible-empty"><p>{t("storyPlanNode.empty")}</p></div> : null}
      {topLevelNodes.map((node) => (
        <PlanNodeBranch
          depth={0}
          initialNode={node}
          key={`${node.node_id}-${node.version}`}
          project={project}
          onProjectUpdate={onProjectUpdate}
          onInteractionChange={updateBranchInteraction}
          onRequestResplit={() => setAutoExpansionRequested(true)}
          refreshToken={treeRefreshToken}
          treeBusy={busy === "generate" || topLevelTaskActive}
          treeCheckpointRefreshes={treeCheckpointRefreshes}
          treeUnlockedNodeIds={treeUnlockedNodeIds}
        />
      ))}
    </section>
  );
}

function PlanNodeBranch({ depth, initialNode, onInteractionChange, onProjectUpdate, onRequestResplit, project, refreshToken = 0, treeBusy = false, treeCheckpointRefreshes, treeUnlockedNodeIds }: {
  depth: number;
  initialNode: StoryPlanNode;
  project: ScriptProject;
  onInteractionChange?: (key: string, active: boolean) => void;
  onProjectUpdate?: ProjectUpdateHandler;
  onRequestResplit?: () => void;
  refreshToken?: number;
  treeBusy?: boolean;
  treeCheckpointRefreshes?: ReadonlyMap<string, number>;
  treeUnlockedNodeIds?: ReadonlySet<string>;
}) {
  const { t } = useLocale();
  const [node, setNode] = useState(initialNode);
  const [children, setChildren] = useState<StoryPlanNode[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingSnapshot, setEditingSnapshot] = useState<StoryPlanNode | null>(null);
  const [busy, setBusy] = useState<
    "load" | "save" | "approve" | "decompose" | "roadmap" | "ai" | "roadmap-edit" | "roadmap-ai" | null
  >("load");
  const [message, setMessage] = useState<string | null>(null);
  const [aiCandidate, setAiCandidate] = useState<StoryPlanNode | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDialogMessage, setAiDialogMessage] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiRevisionMode, setAiRevisionMode] = useState<PlanningRevisionMode>("targeted");
  const [descendantDecision, setDescendantDecision] = useState<{
    candidate: StoryPlanNode;
    source: "manual" | "ai";
  } | null>(null);
  const [roadmapEditor, setRoadmapEditor] = useState<EpisodeRoadmapItem | null>(null);
  const [roadmapAiTarget, setRoadmapAiTarget] = useState<EpisodeRoadmapItem | null>(null);
  const [roadmapAiCandidate, setRoadmapAiCandidate] = useState<EpisodeRoadmapItem | null>(null);
  const [roadmapAiInstruction, setRoadmapAiInstruction] = useState("");
  const [roadmapAiRevisionMode, setRoadmapAiRevisionMode] = useState<PlanningRevisionMode>("targeted");
  const [roadmapDialogMessage, setRoadmapDialogMessage] = useState<string | null>(null);
  const decomposeTaskKey = `decompose:${project.id}:${node.node_id}:${node.version}`;
  const roadmapTaskKey = `episode-roadmap:${project.id}:${node.node_id}:${node.version}`;
  const decomposeTask = useTrackedPlanningTask(decomposeTaskKey);
  const roadmapTask = useTrackedPlanningTask(roadmapTaskKey);
  const decomposeTaskActive = decomposeTask?.status === "queued" || decomposeTask?.status === "running";
  const roadmapTaskActive = roadmapTask?.status === "queued" || roadmapTask?.status === "running";
  const checkpointRefresh = treeCheckpointRefreshes?.get(node.node_id) ?? 0;
  const interactionKey = `${node.node_id}:${node.version}`;
  const localInteractionActive = (
    isEditing
    || aiDialogOpen
    || Boolean(aiCandidate)
    || Boolean(descendantDecision)
    || Boolean(roadmapEditor)
    || Boolean(roadmapAiTarget)
    || Boolean(roadmapAiCandidate)
    || (busy !== null && busy !== "load")
    || decomposeTaskActive
    || roadmapTaskActive
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

  useEffect(() => {
    if (decomposeTask?.status !== "completed") return;
    let active = true;
    loadChildStoryPlanNodes(
      project.id,
      node.node_id,
      node.story_bible_id,
      node.story_bible_version,
      node.version,
    ).then((value) => {
      if (active) setChildren(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [decomposeTask?.status, node.node_id, node.story_bible_id, node.story_bible_version, project.id]);

  const failedPlanningTask = decomposeTask?.status === "failed"
    ? decomposeTask
    : roadmapTask?.status === "failed"
      ? roadmapTask
      : undefined;

  useEffect(() => {
    if (!failedPlanningTask) return;
    setBusy(null);
    setMessage((current) => current ?? userFacingError(
      new Error(failedPlanningTask.error ?? ""),
      failedPlanningTask.kind === "decompose"
        ? t("storyPlanNode.decomposeFailed")
        : t("storyPlanNode.roadmapFailed"),
    ));
  }, [failedPlanningTask?.error, failedPlanningTask?.id, failedPlanningTask?.kind, t]);

  async function approveNode() {
    if (treeInteractionLocked || isEditing) return;
    setBusy("approve");
    setMessage(null);
    try {
      const previousTree = children.length
        ? await loadActiveStoryPlanNodes(
          project.id,
          node.story_bible_id,
          node.story_bible_version,
        )
        : [];
      const previousSubtree = collectStoryPlanSubtreeVersions(previousTree, node);
      const approved = await approveStoryPlanNode(node, children.length ? "rebase" : "invalidate");
      setNode(approved);
      if (children.length) {
        const nextTree = await loadActiveStoryPlanNodes(
          project.id,
          approved.story_bible_id,
          approved.story_bible_version,
        );
        const nextVersions = new Map(nextTree.map((item) => [item.node_id, item.version]));
        await persistProjectUpdate(onProjectUpdate, (current) => {
          const episodeRoadmaps = remapRoadmapsForRebasedSubtree(
            current.episodeRoadmaps ?? [],
            previousSubtree,
            nextVersions,
          );
          return {
            episodeRoadmaps,
            episodePlansReadyThrough: approvedDirectScriptCoverageThrough(nextTree, {
              episodeRoadmaps,
              roadmapRequired: current.episodeRoadmapRequired === true,
            }) || undefined,
          };
        });
        setChildren(await loadChildStoryPlanNodes(
          project.id,
          approved.node_id,
          approved.story_bible_id,
          approved.story_bible_version,
          approved.version,
        ));
      }
      if (isDirectScriptNode(approved)) {
        const allNodes = await loadActiveStoryPlanNodes(
          project.id,
          approved.story_bible_id,
          approved.story_bible_version,
        );
        await persistProjectUpdate(onProjectUpdate, (current) => ({
          episodePlansReadyThrough: approvedDirectScriptCoverageThrough(allNodes, {
            episodeRoadmaps: current.episodeRoadmaps ?? [],
            roadmapRequired: current.episodeRoadmapRequired === true,
          }) || undefined,
        }));
      }
      setMessage(t("storyPlanNode.approved"));
    } catch (error) {
      setMessage(userFacingError(error, t("storyPlanNode.approveFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function saveNode() {
    if (treeInteractionLocked || node.status === "superseded" || generatedRangeLocked) return;
    await requestNodeSave(node, "manual");
  }

  async function requestNodeSave(candidate: StoryPlanNode, source: "manual" | "ai") {
    if (treeInteractionLocked || candidate.status === "superseded" || generatedRangeLocked) return;
    if (children.length > 0) {
      setDescendantDecision({ candidate, source });
      return;
    }
    if (candidate.status === "approved" && !window.confirm(t("storyPlanNode.modifyApprovedConfirm"))) {
      return;
    }
    await persistNode(candidate, source, "invalidate");
  }

  async function persistNode(
    candidate: StoryPlanNode,
    source: "manual" | "ai",
    descendantPolicy: "invalidate" | "rebase",
  ) {
    if (treeInteractionLocked) return;
    setBusy("save");
    setMessage(null);
    try {
      const previousTree = children.length
        ? await loadActiveStoryPlanNodes(
          project.id,
          node.story_bible_id,
          node.story_bible_version,
        )
        : [];
      const previousSubtree = collectStoryPlanSubtreeVersions(previousTree, node);
      const saved = await saveStoryPlanNodeDraft(candidate, descendantPolicy);
      setNode(saved);
      if (source === "manual") {
        setIsEditing(false);
        setEditingSnapshot(null);
      }
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
          node,
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
      setAiCandidate(null);
      if (source === "ai") setAiInstruction("");
      setDescendantDecision(null);
      setMessage(source === "ai" ? t("storyPlanNode.aiModificationApplied") : t("storyPlanNode.saved"));
      if (children.length > 0 && descendantPolicy === "invalidate") onRequestResplit?.();
    } catch (error) {
      setMessage(userFacingError(error, t("storyPlanNode.saveFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function requestAiModification() {
    if (
      treeBusy
      || isEditing
      || node.status === "superseded"
      || generatedRangeLocked
      || (aiRevisionMode === "targeted" && !aiInstruction.trim())
    ) return;
    setBusy("ai");
    setMessage(null);
    setAiDialogMessage(null);
    try {
      const candidate = await modifyStoryPlanNode(
        project,
        node,
        aiInstruction.trim(),
        aiRevisionMode,
      );
      setAiCandidate(candidate);
      setAiDialogOpen(false);
      setMessage(null);
    } catch (error) {
      const errorMessage = userFacingError(error, t("storyPlanNode.aiModifyFailed"));
      setMessage(errorMessage);
      setAiDialogMessage(errorMessage);
    } finally {
      setBusy(null);
    }
  }

  async function applyAiModification() {
    if (treeBusy || !aiCandidate) return;
    await requestNodeSave(aiCandidate, "ai");
  }

  function updateNodeField(
    field: "title" | "narrative_purpose" | "synopsis" | "entry_state" | "central_conflict" | "emotional_direction" | "exit_state" | "unit_resolution" | "handoff_pressure",
    value: string,
  ) {
    setNode((current) => ({ ...current, [field]: value }));
  }

  function decomposeNode() {
    if (treeBusy || isEditing || decomposeTaskActive) return;
    setBusy("decompose");
    setMessage(null);
    const background = enqueuePlanningTask({
      key: decomposeTaskKey,
      kind: "decompose",
      projectId: project.id,
      nodeId: node.node_id,
      label: node.title,
      run: () => decomposeStoryPlanNode(project, node),
      onSuccess: (generated) => {
        setChildren(generated);
        setMessage(t("storyPlanNode.decomposed"));
        setBusy(null);
      },
      onFailure: (error) => {
        setMessage(userFacingError(error, t("storyPlanNode.decomposeFailed")));
        setBusy(null);
      },
    });
    void background.promise.catch(() => undefined);
  }

  function generateRoadmap() {
    if (treeInteractionLocked || isEditing || roadmapTaskActive || !roadmapPredecessorReady) return;
    setBusy("roadmap");
    setMessage(null);
    const background = enqueuePlanningTask({
      key: roadmapTaskKey,
      kind: "episode_roadmap",
      projectId: project.id,
      nodeId: node.node_id,
      label: node.title,
      run: () => generateEpisodePlanBatch(
        project,
        node,
        async (checkpoint) => {
          await persistProjectUpdate(onProjectUpdate, (current) => ({
            episodeRoadmaps: mergeEpisodeRoadmaps(
              current.episodeRoadmaps ?? [],
              [checkpoint],
            ),
          }));
        },
        async () => { await waitForPlanningTaskResume(roadmapTaskKey); },
      ),
      onSuccess: async (generated) => {
        await persistProjectUpdate(onProjectUpdate, (current) => ({
          episodeRoadmaps: mergeEpisodeRoadmaps(
            current.episodeRoadmaps ?? [],
            generated,
          ),
        }));
        setMessage(t("storyPlanNode.roadmapGenerated"));
        setBusy(null);
      },
      onFailure: (error) => {
        setMessage(userFacingError(error, t("storyPlanNode.roadmapFailed")));
        setBusy(null);
      },
    });
    void background.promise.catch(() => undefined);
  }

  async function approveRoadmap() {
    if (treeInteractionLocked || isEditing) return;
    setBusy("roadmap");
    setMessage(null);
    try {
      const allNodes = await loadActiveStoryPlanNodes(
        project.id,
        node.story_bible_id,
        node.story_bible_version,
      );
      await persistProjectUpdate(onProjectUpdate, (current) => {
        const approvedRoadmaps = (current.episodeRoadmaps ?? []).map((item) => (
          item.source_node_id === node.node_id && item.source_node_version === node.version
            ? { ...item, status: "approved" as const }
            : item
        ));
        return {
          episodeRoadmaps: approvedRoadmaps,
          episodePlansReadyThrough: approvedDirectScriptCoverageThrough(allNodes, {
            episodeRoadmaps: approvedRoadmaps,
            roadmapRequired: true,
          }) || undefined,
        };
      });
      setMessage(t("storyPlanNode.roadmapApproved"));
    } catch (error) {
      setMessage(userFacingError(error, t("storyPlanNode.roadmapFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function saveRoadmapEditor() {
    if (treeInteractionLocked || isEditing || !roadmapEditor || generatedRangeLocked) return;
    const validationError = validateRoadmapDraft(
      roadmapEditor,
      t("storyPlanNode.roadmapEditInvalid"),
    );
    if (validationError) {
      setRoadmapDialogMessage(validationError);
      return;
    }
    setBusy("roadmap-edit");
    await applyRoadmapRevision(normalizeRoadmapDraft(roadmapEditor));
    setRoadmapEditor(null);
    setRoadmapDialogMessage(null);
    setMessage(t("storyPlanNode.roadmapEditSaved"));
    setBusy(null);
  }

  async function requestRoadmapAiModification() {
    if (
      treeBusy
      || isEditing
      || !roadmapAiTarget
      || generatedRangeLocked
      || (roadmapAiRevisionMode === "targeted" && !roadmapAiInstruction.trim())
    ) return;
    setBusy("roadmap-ai");
    setRoadmapDialogMessage(null);
    try {
      const acceptedPlans = roadmap.filter(
        (item) => item.episode_number < roadmapAiTarget.episode_number,
      );
      const candidate = await modifyEpisodePlanItem(
        project,
        node,
        roadmapAiTarget,
        acceptedPlans,
        roadmapAiInstruction,
        roadmapAiRevisionMode,
      );
      setRoadmapAiCandidate(candidate);
      setRoadmapAiTarget(null);
    } catch (error) {
      setRoadmapDialogMessage(userFacingError(error, t("storyPlanNode.roadmapAiFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function applyRoadmapRevision(candidate: EpisodeRoadmapItem) {
    if (treeInteractionLocked || isEditing) return;
    await persistProjectUpdate(onProjectUpdate, (current) => ({
      episodePlansReadyThrough: undefined,
      episodeRoadmaps: replaceEpisodeRoadmapDraft(
        current.episodeRoadmaps ?? [],
        { ...candidate, status: "draft" },
      ),
    }));
  }

  async function applyRoadmapAiCandidate() {
    if (treeBusy || isEditing || !roadmapAiCandidate) return;
    await applyRoadmapRevision(roadmapAiCandidate);
    setRoadmapAiCandidate(null);
    setRoadmapAiInstruction("");
    setRoadmapDialogMessage(null);
    setMessage(t("storyPlanNode.roadmapAiApplied"));
  }

  const range = node.planned_start_episode && node.planned_end_episode
    ? `${node.planned_start_episode}-${node.planned_end_episode}`
    : "-";
  const directScriptReady = isDirectScriptNode(node);
  const requiresFurtherDecomposition = isOversizedStoryPlanNode(node);
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
  const expectedRoadmapCount = node.planned_start_episode && node.planned_end_episode
    ? node.planned_end_episode - node.planned_start_episode + 1
    : 0;
  const roadmapEpisodes = new Set(roadmap.map((item) => item.episode_number));
  const roadmapComplete = roadmap.length === expectedRoadmapCount
    && roadmapEpisodes.size === expectedRoadmapCount
    && node.planned_start_episode !== null
    && node.planned_end_episode !== null
    && Array.from(
      { length: expectedRoadmapCount },
      (_, index) => (node.planned_start_episode as number) + index,
    ).every((episodeNumber) => roadmapEpisodes.has(episodeNumber));
  const roadmapApproved = hasCompleteApprovedRoadmap(node, project.episodeRoadmaps ?? []);
  const roadmapRequired = project.episodeRoadmapRequired === true;
  const roadmapPredecessorReady = node.planned_start_episode === 1 || (
    node.planned_start_episode !== null
    && (project.episodeRoadmaps ?? []).some((item) => (
      item.story_bible_version === node.story_bible_version
      && item.episode_number === (node.planned_start_episode as number) - 1
      && item.status === "approved"
    ))
  );
  const generatedThrough = contiguousEpisodeCoverageThrough(
    project.episodes.map((episode) => episode.episodeNumber),
  );
  const scriptPredecessorReady = node.planned_start_episode === 1 || (
    node.planned_start_episode !== null
    && generatedThrough >= node.planned_start_episode - 1
  );
  const generatedRangeLocked = project.episodes.some((episode) => (
    node.planned_start_episode !== null
    && node.planned_end_episode !== null
    && episode.episodeNumber >= node.planned_start_episode
    && episode.episodeNumber <= node.planned_end_episode
  ));
  const nodeRevisionLocked = generatedRangeLocked;
  const nodeRevisionLockedMessage = generatedRangeLocked
    ? t("storyPlanNode.modificationLocked")
    : undefined;
  const concurrentLeafAccess = treeBusy
    && episodeReadyShape
    && Boolean(treeUnlockedNodeIds?.has(node.node_id))
    && children.length === 0;
  const treeInteractionLocked = treeBusy && !concurrentLeafAccess;
  const operationLocked = Boolean(busy)
    || treeInteractionLocked
    || decomposeTaskActive
    || roadmapTaskActive;
  const branchLocked = operationLocked || isEditing;
  const effectiveEditing = isEditing && !treeInteractionLocked;

  function startEditing() {
    if (branchLocked || nodeRevisionLocked) return;
    setEditingSnapshot(node);
    setIsEditing(true);
  }

  function cancelEditing() {
    if (treeInteractionLocked) return;
    if (editingSnapshot) setNode(editingSnapshot);
    setEditingSnapshot(null);
    setIsEditing(false);
  }
  return (
    <div className="story-plan-branch" style={{ marginLeft: `${Math.min(depth, 5) * 18}px` }}>
      <details className="story-plan-node-card">
        <summary className="story-plan-node-summary">
          <span className="story-plan-node-toggle"><ArrowIcon /></span>
          <span className="story-plan-node-depth">
            {t("storyPlanNode.depth").replace("{depth}", String(depth + 1))}
          </span>
          <span className="story-plan-node-title">{effectiveEditing ? t("storyPlanNode.editing") : node.title}</span>
          <span className="story-plan-node-meta">
            {t("storyPlanNode.range").replace("{range}", range)}
            {node.estimated_script_body_characters
              ? ` · ${t("storyPlanNode.characterBudget").replace("{count}", String(node.estimated_script_body_characters))}`
              : ""}
          </span>
          <span className={`story-plan-node-state is-${node.status}`}>
            {node.status === "approved" ? t("storyPlanNode.statusApproved") : t("storyPlanNode.statusDraft")}
          </span>
        </summary>
        <div className="story-plan-node-content">
          <div className="story-plan-node-help-row">
            <span>{t("storyPlanNode.branchDetails")}</span>
            <SectionHelp content={t("guide.storyBranch")} label={t("guide.openHelp")} />
          </div>
          <PlanField editing={effectiveEditing} label={t("storyPlanNode.nodeTitle")} onChange={(value) => updateNodeField("title", value)} value={node.title} />
          <PlanField editing={effectiveEditing} label={t("storyPlanNode.narrativePurpose")} onChange={(value) => updateNodeField("narrative_purpose", value)} value={node.narrative_purpose} />
          <PlanField editing={effectiveEditing} label={t("storyPlanNode.synopsis")} onChange={(value) => updateNodeField("synopsis", value)} value={node.synopsis} />
          <PlanField editing={effectiveEditing} label={t("storyPlanNode.entryState")} onChange={(value) => updateNodeField("entry_state", value)} value={node.entry_state} />
          <PlanField editing={effectiveEditing} label={t("storyPlanNode.centralConflict")} onChange={(value) => updateNodeField("central_conflict", value)} value={node.central_conflict} />
          <PlanField editing={effectiveEditing} label={t("storyPlanNode.emotionalDirection")} onChange={(value) => updateNodeField("emotional_direction", value)} value={node.emotional_direction} />
          <PlanField editing={effectiveEditing} label={t("storyPlanNode.exitState")} onChange={(value) => updateNodeField("exit_state", value)} value={node.exit_state} />
          <PlanListField
            editing={effectiveEditing}
            label={t("storyPlanNode.storyProgression")}
            onChange={(value) => setNode((current) => ({ ...current, unit_story_beats: value }))}
            values={node.unit_story_beats ?? []}
          />
          <PlanField editing={effectiveEditing} label={t("storyPlanNode.partResolution")} onChange={(value) => updateNodeField("unit_resolution", value)} value={node.unit_resolution ?? ""} />
          <PlanField editing={effectiveEditing} label={t("storyPlanNode.nextPartPressure")} onChange={(value) => updateNodeField("handoff_pressure", value)} value={node.handoff_pressure ?? ""} />
          {requiresParentCoordination ? (
            <div className="inline-notice">{t("storyPlanNode.rangeNeedsAdjustment")}</div>
          ) : null}
          <div className="story-plan-node-actions">
            {node.status !== "superseded" ? (
              <>
                <button className="outline-action" disabled={operationLocked || nodeRevisionLocked} onClick={isEditing ? cancelEditing : startEditing} title={nodeRevisionLockedMessage} type="button">
                  {isEditing ? t("storyPlanNode.cancelEdit") : t("storyPlanNode.edit")}
                </button>
                <button
                  className="outline-action"
                  disabled={operationLocked || treeBusy || nodeRevisionLocked || isEditing || Boolean(aiCandidate)}
                  onClick={() => { setAiInstruction(""); setAiRevisionMode("targeted"); setAiDialogMessage(null); setAiDialogOpen(true); }}
                  title={nodeRevisionLockedMessage}
                  type="button"
                >
                  {t("workspace.aiModify")}
                </button>
                {isEditing ? (
                  <button className="primary-action" disabled={operationLocked} onClick={() => void saveNode()} type="button">
                    {busy === "save" ? t("storyPlanNode.saving") : t("storyPlanNode.save")}
                  </button>
                ) : null}
                {node.status === "draft" ? (
                  <button className="primary-action" disabled={branchLocked || isEditing || Boolean(aiCandidate) || requiresParentCoordination} onClick={() => void approveNode()} type="button">
                    {busy === "approve" ? t("storyPlanNode.approving") : t("storyPlanNode.approve")}
                  </button>
                ) : null}
              </>
            ) : null}
            {node.status === "approved" && (node.expansion_status === "expanded" || requiresFurtherDecomposition) && !directScriptReady && children.length === 0 ? (
              <button className="outline-action" disabled={branchLocked} onClick={() => void decomposeNode()} type="button">
                {busy === "decompose" || decomposeTaskActive ? t("storyPlanNode.decomposing") : t("storyPlanNode.decompose")}
              </button>
            ) : null}
            {directScriptReady ? (
              <>
                <span className="planning-ready-badge">
                  {roadmapRequired && !roadmapApproved
                    ? roadmapPredecessorReady
                      ? t("storyPlanNode.roadmapPending")
                      : t("storyPlanNode.previousRoadmapPending")
                    : t("storyPlanNode.directScriptReady")}
                </span>
                {roadmapRequired && !roadmapComplete ? (
                  <button className="primary-action" disabled={branchLocked || generatedRangeLocked || !roadmapPredecessorReady} onClick={() => void generateRoadmap()} type="button">
                    {busy === "roadmap" || roadmapTaskActive
                      ? t("storyPlanNode.roadmapGenerating")
                      : roadmap.length
                        ? t("storyPlanNode.continueRoadmap")
                        : t("storyPlanNode.generateRoadmap")}
                  </button>
                ) : null}
                {roadmapRequired && roadmapComplete && !roadmapApproved ? (
                  <button className="primary-action" disabled={branchLocked || generatedRangeLocked} onClick={() => void approveRoadmap()} type="button">
                    {t("storyPlanNode.approveRoadmap")}
                  </button>
                ) : null}
                {(!roadmapRequired || roadmapApproved) && !branchLocked && scriptPredecessorReady ? (
                  <Link
                    className="primary-action"
                    href={`/projects/${project.id}/workspace?generate=1&start=${node.planned_start_episode}&end=${node.planned_end_episode}`}
                  >
                    {t("storyPlanNode.generateScriptDirectly")}
                  </Link>
                ) : null}
                {(!roadmapRequired || roadmapApproved) && !scriptPredecessorReady ? (
                  <span className="planning-ready-badge">
                    {t("storyPlanNode.previousScriptPending")}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
          {roadmap.length ? (
            <div className="story-plan-children">
              <div className="section-title-with-help story-plan-roadmap-heading">
                <h3>{t("storyPlanNode.episodePlans")}</h3>
                <SectionHelp content={t("guide.episodeRoadmap")} label={t("guide.openHelp")} />
              </div>
              {roadmap.map((item) => (
                <article className="continuity-card" key={`${node.node_id}-roadmap-${item.episode_number}`}>
                  <strong>{t("workspace.episodeLabel").replace("{number}", String(item.episode_number))} · {item.episode_goal}</strong>
                  <p>{item.central_conflict}</p>
                  <small>
                    {item.target_duration_seconds ?? 90} 秒 · {item.planned_scene_count ?? 3} 场 · {item.planned_shot_count ?? 16} 镜头
                  </small>
                  <small>{item.ending_hook_type}：{item.cliffhanger}</small>
                  <div className="roadmap-card-actions">
                    <button
                      className="outline-action"
                      disabled={branchLocked || generatedRangeLocked}
                      onClick={() => { setRoadmapDialogMessage(null); setRoadmapEditor({ ...item }); }}
                      title={nodeRevisionLockedMessage}
                      type="button"
                    >
                      {t("storyPlanNode.editRoadmap")}
                    </button>
                    <button
                      className="outline-action"
                      disabled={branchLocked || treeBusy || generatedRangeLocked}
                      onClick={() => {
                        setRoadmapAiInstruction("");
                        setRoadmapAiRevisionMode("targeted");
                        setRoadmapDialogMessage(null);
                        setRoadmapAiTarget(item);
                      }}
                      title={nodeRevisionLockedMessage}
                      type="button"
                    >
                      {t("storyPlanNode.aiEditRoadmap")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {message && !failedPlanningTask ? <div className="inline-notice">{message}</div> : null}
        </div>
      </details>
      {message && failedPlanningTask ? (
        <div className="inline-notice is-error" role="alert">
          {message}
        </div>
      ) : null}
      {aiCandidate && !descendantDecision ? (
        <CandidateReviewDialog
          busy={busy === "save" || treeBusy}
          confirmLabel={busy === "save" ? t("storyPlanNode.saving") : t("candidateReview.confirmReplace")}
          description={t("candidateReview.unchangedUntilConfirm")}
          discardLabel={t("candidateReview.keepOriginal")}
          error={message ?? undefined}
          eyebrow={t("storyPlanNode.aiCandidate")}
          onConfirm={() => void applyAiModification()}
          onDiscard={() => { setAiCandidate(null); setAiInstruction(""); setMessage(null); }}
          title={t("candidateReview.storyNodeTitle")}
          warning={node.status === "approved" ? t("storyPlanNode.candidateImpactWarning") : undefined}
        >
          {aiInstruction ? (
            <div className="candidate-review-request">
              <span>{t("candidateReview.request")}</span>
              <p>{aiInstruction}</p>
            </div>
          ) : null}
          <StoryPlanNodeCandidatePreview candidate={aiCandidate} t={t} />
        </CandidateReviewDialog>
      ) : null}
      {roadmapAiCandidate ? (
        <CandidateReviewDialog
          busy={treeBusy}
          confirmLabel={t("candidateReview.confirmReplace")}
          description={t("storyPlanNode.roadmapCandidateDescription")}
          discardLabel={t("candidateReview.keepOriginal")}
          eyebrow={t("storyPlanNode.roadmapAiCandidate")}
          onConfirm={applyRoadmapAiCandidate}
          onDiscard={() => {
            setRoadmapAiCandidate(null);
            setRoadmapAiInstruction("");
            setRoadmapDialogMessage(null);
          }}
          title={t("storyPlanNode.roadmapCandidateTitle").replace(
            "{number}",
            String(roadmapAiCandidate.episode_number),
          )}
          warning={t("storyPlanNode.roadmapRevisionImpact")}
        >
          {roadmapAiInstruction ? (
            <div className="candidate-review-request">
              <span>{t("candidateReview.request")}</span>
              <p>{roadmapAiInstruction}</p>
            </div>
          ) : null}
          <EpisodeRoadmapCandidatePreview candidate={roadmapAiCandidate} t={t} />
        </CandidateReviewDialog>
      ) : null}
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
      {aiDialogOpen ? (
        <div className="tag-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !branchLocked) setAiDialogOpen(false); }}>
          <div aria-modal="true" className="tag-dialog episode-instruction-dialog" role="dialog">
            <button aria-label={t("tags.cancelCustom")} className="tag-dialog-close" disabled={branchLocked} onClick={() => setAiDialogOpen(false)} type="button"><CloseIcon /></button>
            <span className="section-kicker">{t("workspace.aiModify")}</span>
            <div className="section-title-with-help">
              <h3>{t("storyPlanNode.aiModifyTitle")}</h3>
              <SectionHelp content={t("guide.aiRevision")} label={t("guide.openHelp")} />
            </div>
            <p>{t("storyPlanNode.aiModifyHelp")}</p>
            <PlanningRevisionModeControl disabled={branchLocked} onChange={setAiRevisionMode} value={aiRevisionMode} />
            {busy === "ai" ? (
              <div aria-live="polite" className="planning-revision-progress">
                <span className="loading-mark" />
                <div>
                  <strong>{t(aiRevisionMode === "rewrite" ? "planningRevision.rewritingNode" : "planningRevision.adjustingNode")}</strong>
                  <span>{t("planningRevision.inProgressHelp")}</span>
                </div>
              </div>
            ) : null}
            {aiDialogMessage ? <div className="inline-notice is-error" role="alert">{aiDialogMessage}</div> : null}
            <textarea autoFocus disabled={branchLocked} maxLength={1000} onChange={(event) => setAiInstruction(event.target.value)} placeholder={aiRevisionMode === "rewrite" ? t("planningRevision.rewritePlaceholder") : t("storyPlanNode.aiModifyPlaceholder")} rows={5} value={aiInstruction} />
            <div className="tag-dialog-actions">
              <button className="outline-action" disabled={branchLocked} onClick={() => setAiDialogOpen(false)} type="button">{t("tags.cancelCustom")}</button>
              <button className="primary-action" disabled={branchLocked || (aiRevisionMode === "targeted" && !aiInstruction.trim())} onClick={() => void requestAiModification()} type="button">{busy === "ai" ? t("workspace.processing") : t("tags.confirmCustom")}</button>
            </div>
          </div>
        </div>
      ) : null}
      {roadmapEditor ? (
        <EpisodeRoadmapEditorDialog
          busy={branchLocked}
          error={roadmapDialogMessage}
          onCancel={() => { setRoadmapEditor(null); setRoadmapDialogMessage(null); }}
          onChange={setRoadmapEditor}
          onSave={saveRoadmapEditor}
          t={t}
          value={roadmapEditor}
        />
      ) : null}
      {roadmapAiTarget ? (
        <div
          className="tag-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !branchLocked) {
              setRoadmapAiTarget(null);
              setRoadmapDialogMessage(null);
            }
          }}
          role="presentation"
        >
          <div aria-modal="true" className="tag-dialog episode-instruction-dialog" role="dialog">
            <button
              aria-label={t("tags.cancelCustom")}
              className="tag-dialog-close"
              disabled={branchLocked}
              onClick={() => { setRoadmapAiTarget(null); setRoadmapDialogMessage(null); }}
              type="button"
            >
              <CloseIcon />
            </button>
            <span className="section-kicker">{t("workspace.aiModify")}</span>
            <h3>{t("storyPlanNode.roadmapAiTitle").replace("{number}", String(roadmapAiTarget.episode_number))}</h3>
            <p>{t("storyPlanNode.roadmapAiHelp")}</p>
            <PlanningRevisionModeControl
              disabled={branchLocked}
              onChange={setRoadmapAiRevisionMode}
              value={roadmapAiRevisionMode}
            />
            {busy === "roadmap-ai" ? (
              <div aria-live="polite" className="planning-revision-progress">
                <span className="loading-mark" />
                <div>
                  <strong>{t("storyPlanNode.roadmapAiRunning")}</strong>
                  <span>{t("planningRevision.inProgressHelp")}</span>
                </div>
              </div>
            ) : null}
            {roadmapDialogMessage ? <div className="inline-notice is-error" role="alert">{roadmapDialogMessage}</div> : null}
            <textarea
              autoFocus
              disabled={branchLocked}
              maxLength={1000}
              onChange={(event) => setRoadmapAiInstruction(event.target.value)}
              placeholder={roadmapAiRevisionMode === "rewrite"
                ? t("planningRevision.rewritePlaceholder")
                : t("storyPlanNode.roadmapAiPlaceholder")}
              rows={5}
              value={roadmapAiInstruction}
            />
            <div className="tag-dialog-actions">
              <button className="outline-action" disabled={branchLocked} onClick={() => setRoadmapAiTarget(null)} type="button">{t("tags.cancelCustom")}</button>
              <button
                className="primary-action"
                disabled={branchLocked || (roadmapAiRevisionMode === "targeted" && !roadmapAiInstruction.trim())}
                onClick={() => void requestRoadmapAiModification()}
                type="button"
              >
                {busy === "roadmap-ai" ? t("workspace.processing") : t("tags.confirmCustom")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {children.length && !directScriptReady ? (
        <details className="story-plan-children-group" open={treeBusy || depth === 0}>
          <summary>
            <span className="story-plan-node-toggle"><ArrowIcon /></span>
            {t("storyPlanNode.childCount").replace("{count}", String(children.length))}
          </summary>
          <div className="story-plan-children">
            {children.map((child) => (
              <PlanNodeBranch depth={depth + 1} initialNode={child} key={`${child.node_id}-${child.version}`} onInteractionChange={onInteractionChange} onProjectUpdate={onProjectUpdate} onRequestResplit={onRequestResplit} project={project} refreshToken={refreshToken} treeBusy={treeBusy} treeCheckpointRefreshes={treeCheckpointRefreshes} treeUnlockedNodeIds={treeUnlockedNodeIds} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

type RoadmapEditableTextField =
  | "episode_goal"
  | "entry_state"
  | "central_conflict"
  | "protagonist_decision"
  | "reveal"
  | "emotional_movement"
  | "stage_opposition"
  | "episode_payoff"
  | "pressure_escalation"
  | "exit_state"
  | "cliffhanger"
  | "ending_hook_type"
  | "next_episode_obligation";

const ROADMAP_EDITABLE_TEXT_FIELDS: Array<{
  key: RoadmapEditableTextField;
  labelKey: string;
  rows: number;
}> = [
  { key: "episode_goal", labelKey: "storyPlanNode.episodeGoal", rows: 3 },
  { key: "entry_state", labelKey: "storyPlanNode.entryState", rows: 3 },
  { key: "central_conflict", labelKey: "storyPlanNode.centralConflict", rows: 3 },
  { key: "protagonist_decision", labelKey: "storyPlanNode.protagonistDecision", rows: 3 },
  { key: "reveal", labelKey: "storyPlanNode.reveal", rows: 3 },
  { key: "emotional_movement", labelKey: "storyPlanNode.emotionalMovement", rows: 3 },
  { key: "stage_opposition", labelKey: "storyPlanNode.stageOpposition", rows: 3 },
  { key: "episode_payoff", labelKey: "storyPlanNode.episodePayoff", rows: 3 },
  { key: "pressure_escalation", labelKey: "storyPlanNode.pressureEscalation", rows: 3 },
  { key: "exit_state", labelKey: "storyPlanNode.exitState", rows: 3 },
  { key: "cliffhanger", labelKey: "storyPlanNode.cliffhanger", rows: 3 },
  { key: "ending_hook_type", labelKey: "storyPlanNode.endingHookType", rows: 2 },
  { key: "next_episode_obligation", labelKey: "storyPlanNode.nextEpisodeObligation", rows: 3 },
];

function EpisodeRoadmapEditorDialog({ busy, error, onCancel, onChange, onSave, t, value }: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onChange: (value: EpisodeRoadmapItem) => void;
  onSave: () => void;
  t: (key: string) => string;
  value: EpisodeRoadmapItem;
}) {
  return (
    <div
      className="tag-dialog-backdrop"
      onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onCancel(); }}
      role="presentation"
    >
      <div aria-modal="true" className="tag-dialog roadmap-editor-dialog" role="dialog">
        <button aria-label={t("tags.cancelCustom")} className="tag-dialog-close" disabled={busy} onClick={onCancel} type="button"><CloseIcon /></button>
        <span className="section-kicker">{t("storyPlanNode.episodePlans")}</span>
        <h3>{t("storyPlanNode.roadmapEditorTitle").replace("{number}", String(value.episode_number))}</h3>
        <p>{t("storyPlanNode.roadmapEditorHelp")}</p>
        <div className="inline-notice">{t("storyPlanNode.roadmapRevisionImpact")}</div>
        {error ? <div className="inline-notice is-error" role="alert">{error}</div> : null}
        <div className="roadmap-editor-scroll">
          <div className="roadmap-editor-metrics">
            <label>
              <span>{t("storyPlanNode.targetDuration")}</span>
              <input
                disabled={busy}
                max={115}
                min={75}
                onChange={(event) => onChange({ ...value, target_duration_seconds: Number(event.target.value) })}
                type="number"
                value={value.target_duration_seconds}
              />
              <small>75-115</small>
            </label>
            <label>
              <span>{t("storyPlanNode.plannedScenes")}</span>
              <input
                disabled={busy}
                max={5}
                min={2}
                onChange={(event) => onChange({ ...value, planned_scene_count: Number(event.target.value) })}
                type="number"
                value={value.planned_scene_count}
              />
              <small>2-5</small>
            </label>
            <label>
              <span>{t("storyPlanNode.plannedShots")}</span>
              <input
                disabled={busy}
                max={24}
                min={8}
                onChange={(event) => onChange({ ...value, planned_shot_count: Number(event.target.value) })}
                type="number"
                value={value.planned_shot_count}
              />
              <small>8-24</small>
            </label>
          </div>
          <div className="roadmap-editor-fields">
            {ROADMAP_EDITABLE_TEXT_FIELDS.map((field) => (
              <label key={field.key}>
                <span>{t(field.labelKey)}</span>
                <textarea
                  disabled={busy}
                  maxLength={1000}
                  onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
                  rows={field.rows}
                  value={value[field.key] ?? ""}
                />
              </label>
            ))}
            <label>
              <span>{t("storyPlanNode.continuityRequirements")}</span>
              <textarea
                disabled={busy}
                maxLength={3000}
                onChange={(event) => onChange({
                  ...value,
                  continuity_requirements: splitPlanningLines(event.target.value),
                })}
                rows={5}
                value={value.continuity_requirements.join("\n")}
              />
            </label>
          </div>
          <p className="roadmap-editor-boundary-note">{t("storyPlanNode.roadmapBoundaryLocked")}</p>
        </div>
        <div className="tag-dialog-actions">
          <button className="outline-action" disabled={busy} onClick={onCancel} type="button">{t("tags.cancelCustom")}</button>
          <button className="primary-action" disabled={busy} onClick={onSave} type="button">{busy ? t("storyPlanNode.saving") : t("storyPlanNode.saveRoadmap")}</button>
        </div>
      </div>
    </div>
  );
}

function EpisodeRoadmapCandidatePreview({ candidate, t }: {
  candidate: EpisodeRoadmapItem;
  t: (key: string) => string;
}) {
  return (
    <div className="candidate-preview-grid">
      <CandidatePreviewField label={t("storyPlanNode.episodeGoal")} value={candidate.episode_goal} />
      <CandidatePreviewField label={t("storyPlanNode.entryState")} value={candidate.entry_state} />
      <CandidatePreviewField label={t("storyPlanNode.centralConflict")} value={candidate.central_conflict} />
      <CandidatePreviewField label={t("storyPlanNode.protagonistDecision")} value={candidate.protagonist_decision} />
      <CandidatePreviewField label={t("storyPlanNode.reveal")} value={candidate.reveal} />
      <CandidatePreviewField label={t("storyPlanNode.emotionalMovement")} value={candidate.emotional_movement} />
      <CandidatePreviewField label={t("storyPlanNode.stageOpposition")} value={candidate.stage_opposition} />
      <CandidatePreviewField label={t("storyPlanNode.episodePayoff")} value={candidate.episode_payoff} />
      <CandidatePreviewField label={t("storyPlanNode.pressureEscalation")} value={candidate.pressure_escalation} />
      <CandidatePreviewField label={t("storyPlanNode.exitState")} value={candidate.exit_state} />
      <CandidatePreviewField label={t("storyPlanNode.cliffhanger")} value={`${candidate.ending_hook_type}：${candidate.cliffhanger}`} />
      <CandidatePreviewField label={t("storyPlanNode.nextEpisodeObligation")} value={candidate.next_episode_obligation} />
      <CandidatePreviewList label={t("storyPlanNode.continuityRequirements")} values={candidate.continuity_requirements} />
    </div>
  );
}

function splitPlanningLines(value: string): string[] {
  return Array.from(new Set(value.split("\n").map((item) => item.trim()).filter(Boolean)));
}

function normalizeRoadmapDraft(item: EpisodeRoadmapItem): EpisodeRoadmapItem {
  const normalized = { ...item };
  for (const field of ROADMAP_EDITABLE_TEXT_FIELDS) {
    const value = normalized[field.key];
    if (field.key === "reveal") {
      normalized.reveal = value?.trim() || null;
    } else {
      (normalized as Record<string, unknown>)[field.key] = value?.trim() ?? "";
    }
  }
  normalized.continuity_requirements = Array.from(new Set(
    normalized.continuity_requirements.map((value) => value.trim()).filter(Boolean),
  ));
  return normalized;
}

function validateRoadmapDraft(item: EpisodeRoadmapItem, fallbackMessage: string): string | null {
  if (!Number.isInteger(item.target_duration_seconds) || item.target_duration_seconds < 75 || item.target_duration_seconds > 115) return fallbackMessage;
  if (!Number.isInteger(item.planned_scene_count) || item.planned_scene_count < 2 || item.planned_scene_count > 5) return fallbackMessage;
  if (!Number.isInteger(item.planned_shot_count) || item.planned_shot_count < 8 || item.planned_shot_count > 24) return fallbackMessage;
  const minimumLengths: Partial<Record<RoadmapEditableTextField, number>> = {
    episode_goal: 5,
    entry_state: 5,
    central_conflict: 5,
    protagonist_decision: 5,
    emotional_movement: 3,
    stage_opposition: 3,
    episode_payoff: 3,
    pressure_escalation: 3,
    exit_state: 5,
    cliffhanger: 5,
    ending_hook_type: 2,
    next_episode_obligation: 3,
  };
  for (const [field, minimum] of Object.entries(minimumLengths) as Array<[RoadmapEditableTextField, number]>) {
    if ((item[field] ?? "").trim().length < minimum) return fallbackMessage;
  }
  if (item.reveal !== null && item.reveal.trim() && item.reveal.trim().length < 3) return fallbackMessage;
  return null;
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

function PlanListField({ editing, label, onChange, values }: {
  editing: boolean;
  label: string;
  onChange: (value: string[]) => void;
  values: string[];
}) {
  return (
    <label className="story-bible-field">
      <span>{label}</span>
      {editing ? (
        <textarea
          onChange={(event) => onChange(event.target.value.split("\n").map((value) => value.trim()).filter(Boolean))}
          rows={6}
          value={values.join("\n")}
        />
      ) : (
        <ol>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ol>
      )}
    </label>
  );
}

function StoryPlanNodeCandidatePreview({ candidate, t }: {
  candidate: StoryPlanNode;
  t: (key: string) => string;
}) {
  const range = candidate.planned_start_episode && candidate.planned_end_episode
    ? t("storyPlanNode.range").replace(
        "{range}",
        `${candidate.planned_start_episode}-${candidate.planned_end_episode}`,
      )
    : null;
  return (
    <div className="candidate-story-node-preview">
      <div className="candidate-preview-heading">
        <strong>{candidate.title}</strong>
        {range ? <span>{range}</span> : null}
      </div>
      <CandidatePreviewField label={t("storyPlanNode.narrativePurpose")} value={candidate.narrative_purpose} />
      <CandidatePreviewField label={t("storyPlanNode.synopsis")} value={candidate.synopsis} />
      <div className="candidate-preview-grid">
        <CandidatePreviewField label={t("storyPlanNode.entryState")} value={candidate.entry_state} />
        <CandidatePreviewField label={t("storyPlanNode.exitState")} value={candidate.exit_state} />
      </div>
      <CandidatePreviewField label={t("storyPlanNode.centralConflict")} value={candidate.central_conflict} />
      <CandidatePreviewField label={t("storyPlanNode.emotionalDirection")} value={candidate.emotional_direction} />
      <div className="candidate-preview-grid">
        <CandidatePreviewList label={t("storyPlanNode.turningPoints")} ordered values={candidate.turning_points} />
        <CandidatePreviewList label={t("storyPlanNode.storyProgression")} ordered values={candidate.unit_story_beats} />
      </div>
      <div className="candidate-preview-grid">
        <CandidatePreviewField label={t("storyPlanNode.partResolution")} value={candidate.unit_resolution} />
        <CandidatePreviewField label={t("storyPlanNode.nextPartPressure")} value={candidate.handoff_pressure} />
      </div>
    </div>
  );
}

function PlanField({ editing, label, onChange, value }: {
  editing: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="story-bible-field">
      <span>{label}</span>
      {editing
        ? <textarea onChange={(event) => onChange(event.target.value)} rows={3} value={value} />
        : <p>{value}</p>}
    </label>
  );
}
