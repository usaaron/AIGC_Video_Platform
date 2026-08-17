import {
  confirmStoryPlanNode,
  decomposeStoryPlanNode,
  generateTopLevelStoryPlanNodes,
  hasCompleteStoryPlanChildCoverage,
  loadActiveStoryPlanNodes,
  loadChildStoryPlanNodes,
  loadRootStoryPlanNode,
  loadTopLevelStoryPlanNodes,
  type StoryBible,
  type StoryPlanNode,
} from "@/lib/story-planning-client";
import {
  MAX_EPISODE_READY_SPAN,
  MIN_EPISODE_READY_SPAN,
  mergeEpisodeRoadmaps,
  storyPlanNodeEpisodeSpan,
} from "@/lib/episode-generation-planning";
import { runAdaptiveDependencyQueue } from "@/lib/adaptive-dependency-queue";
import type { EpisodeRoadmapItem, ScriptProject } from "@/lib/types";

const FULL_TREE_INITIAL_CONCURRENCY = 3;
const FULL_TREE_MINIMUM_CONCURRENCY = 2;
const FULL_TREE_MAXIMUM_CONCURRENCY = 4;
const FULL_TREE_SUCCESSES_BEFORE_INCREASE = 3;
const FULL_TREE_SLOW_TASK_THRESHOLD_MS = 120_000;

export interface StoryTreeExpansionProgress {
  phase: "top_level" | "approving" | "decomposing" | "roadmap" | "complete";
  nodeTitle?: string;
  completedLeaves: number;
  level?: number;
  completedNodes?: number;
  totalNodes?: number;
}

export interface StoryTreeExpansionResult {
  activeNodes: StoryPlanNode[];
  topLevelNodes: StoryPlanNode[];
  episodeRoadmaps: EpisodeRoadmapItem[];
  completedLeaves: number;
}

export interface StoryTreeCheckpoint {
  topLevelNodes: StoryPlanNode[];
  depth: number;
  completedNodes: number;
  totalNodes: number;
  completedNodeId?: string;
  refreshNodeIds?: string[];
}

export async function runFullStoryTreeExpansion(input: {
  project: ScriptProject;
  storyBible: StoryBible;
  beforeStep?: () => Promise<void> | void;
  onProgress?: (progress: StoryTreeExpansionProgress) => Promise<void> | void;
  onTreeCheckpoint?: (checkpoint: StoryTreeCheckpoint) => Promise<void> | void;
  onRoadmapCheckpoint?: (item: EpisodeRoadmapItem) => Promise<void> | void;
}): Promise<StoryTreeExpansionResult> {
  const { project, storyBible } = input;
  await input.beforeStep?.();
  await input.onProgress?.({ phase: "top_level", completedLeaves: 0 });
  let topLevelNodes = await loadTopLevelStoryPlanNodes(
    project.id,
    storyBible.story_bible_id,
    storyBible.version,
  );
  const root = await loadRootStoryPlanNode(
    project.id,
    storyBible.story_bible_id,
    storyBible.version,
  );
  if (root && topLevelNodes.length && !hasCompleteStoryPlanChildCoverage(root, topLevelNodes)) {
    topLevelNodes = [];
  }
  if (!topLevelNodes.length) {
    topLevelNodes = await generateTopLevelStoryPlanNodes(project, storyBible);
  }
  await input.onTreeCheckpoint?.({
    topLevelNodes,
    depth: 0,
    completedNodes: 0,
    totalNodes: topLevelNodes.length,
  });

  let workingRoadmaps = project.episodeRoadmaps ?? [];
  let completedLeaves = 0;
  let completedNodes = 0;
  let totalNodes = topLevelNodes.length;
  let deepestLevel = 1;
  let roadmapMutationTail = Promise.resolve();
  const checkpointRebasedRoadmaps = async (
    previousSubtree: Map<string, number>,
    nextVersions: Map<string, number>,
  ) => {
    const operation = roadmapMutationTail.then(async () => {
      const remapped = remapRoadmapsToRebasedLineage(
        workingRoadmaps,
        previousSubtree,
        nextVersions,
      );
      workingRoadmaps = remapped.items;
      for (const checkpoint of remapped.changed) {
        await input.onRoadmapCheckpoint?.(checkpoint);
      }
    });
    roadmapMutationTail = operation.catch(() => undefined);
    await operation;
  };

  await input.onProgress?.({
    phase: "decomposing",
    completedLeaves,
    level: 1,
    completedNodes,
    totalNodes,
  });
  await runAdaptiveDependencyQueue({
    initialValues: topLevelNodes,
    initialConcurrency: FULL_TREE_INITIAL_CONCURRENCY,
    minimumConcurrency: FULL_TREE_MINIMUM_CONCURRENCY,
    maximumConcurrency: FULL_TREE_MAXIMUM_CONCURRENCY,
    successesBeforeIncrease: FULL_TREE_SUCCESSES_BEFORE_INCREASE,
    slowTaskThresholdMs: FULL_TREE_SLOW_TASK_THRESHOLD_MS,
    breadthFirst: true,
    shouldReduceConcurrencyOnError: isPlanningPressureFailure,
    process: async ({ value: initialNode, depth }): Promise<StoryPlanNode[]> => {
      deepestLevel = Math.max(deepestLevel, depth);
      await input.beforeStep?.();
      let node = initialNode;
      let children = await loadChildStoryPlanNodes(
        project.id,
        node.node_id,
        node.story_bible_id,
        node.story_bible_version,
        node.version,
      );

      if (children.length && !hasCompleteStoryPlanChildCoverage(node, children)) {
        children = [];
      }

      if (children.length) {
        if (node.status !== "approved") {
          await input.onProgress?.({
            phase: "approving",
            nodeTitle: node.title,
            completedLeaves,
            level: deepestLevel,
            completedNodes,
            totalNodes,
          });
          const previousLineage = await loadActiveStoryPlanNodes(
            project.id,
            node.story_bible_id,
            node.story_bible_version,
          );
          const previousSubtree = collectSubtreeVersions(previousLineage, node);
          node = await confirmStoryPlanNode(node, "rebase");
          const nextLineage = await loadActiveStoryPlanNodes(
            project.id,
            node.story_bible_id,
            node.story_bible_version,
          );
          const nextVersions = new Map(nextLineage.map((item) => [item.node_id, item.version]));
          await checkpointRebasedRoadmaps(previousSubtree, nextVersions);
          children = await loadChildStoryPlanNodes(
            project.id,
            node.node_id,
            node.story_bible_id,
            node.story_bible_version,
            node.version,
          );
        }
        return children;
      }

      const span = storyPlanNodeEpisodeSpan(node);
      if (span === null) {
        throw new Error(`“${node.title}”缺少完整集数范围，无法继续一键拆分。`);
      }
      if (span < MIN_EPISODE_READY_SPAN || (span >= 13 && span <= 15)) {
        throw new Error(`“${node.title}”覆盖 ${span} 集，需返回上一层与相邻部分共同调整。`);
      }

      if (node.status !== "approved") {
        await input.onProgress?.({
          phase: "approving",
          nodeTitle: node.title,
          completedLeaves,
          level: deepestLevel,
          completedNodes,
          totalNodes,
        });
        node = await confirmStoryPlanNode(node);
        await input.beforeStep?.();
      }

      if (span > MAX_EPISODE_READY_SPAN) {
        await input.onProgress?.({
          phase: "decomposing",
          nodeTitle: node.title,
          completedLeaves,
          level: deepestLevel,
          completedNodes,
          totalNodes,
        });
        children = await loadChildStoryPlanNodes(
          project.id,
          node.node_id,
          node.story_bible_id,
          node.story_bible_version,
          node.version,
        );
        if (!children.length) children = await decomposeStoryPlanNode(project, node);
        return children;
      }

      // Episode-ready leaves are exposed to the interactive roadmap workflow.
      return [];
    },
    onProgress: async ({ item, depthCompleted, depthScheduled }) => {
      completedNodes = depthCompleted;
      totalNodes = depthScheduled;
      deepestLevel = Math.max(deepestLevel, item.depth);
      topLevelNodes = await loadTopLevelStoryPlanNodes(
        project.id,
        storyBible.story_bible_id,
        storyBible.version,
      );
      const checkpointNodes = await loadActiveStoryPlanNodes(
        project.id,
        storyBible.story_bible_id,
        storyBible.version,
      );
      completedLeaves = episodeReadyLeafNodes(checkpointNodes).length;
      await input.onTreeCheckpoint?.({
        topLevelNodes,
        depth: item.depth,
        completedNodes,
        totalNodes,
        completedNodeId: item.value.node_id,
        refreshNodeIds: [
          item.value.node_id,
          ...(item.value.parent_node_id ? [item.value.parent_node_id] : []),
        ],
      });
      await input.onProgress?.({
        phase: "decomposing",
        nodeTitle: item.value.title,
        completedLeaves,
        level: item.depth,
        completedNodes,
        totalNodes,
      });
    },
  });

  const activeNodes = await loadActiveStoryPlanNodes(
    project.id,
    storyBible.story_bible_id,
    storyBible.version,
  );
  completedLeaves = episodeReadyLeafNodes(activeNodes).length;

  const activeTopLevelIds = new Set(topLevelNodes.map((node) => node.node_id));
  topLevelNodes = activeNodes
    .filter((node) => activeTopLevelIds.has(node.node_id))
    .sort((left, right) => left.sequence_order - right.sequence_order);
  await input.onProgress?.({ phase: "complete", completedLeaves });
  return { activeNodes, topLevelNodes, episodeRoadmaps: workingRoadmaps, completedLeaves };
}

function episodeReadyLeafNodes(activeNodes: StoryPlanNode[]): StoryPlanNode[] {
  const activeParents = new Set(
    activeNodes
      .filter((candidate) => (
        candidate.parent_node_id !== null
        && candidate.parent_node_version !== null
      ))
      .map((candidate) => (
        `${candidate.parent_node_id}:${candidate.parent_node_version}`
      )),
  );
  return activeNodes
    .filter((candidate) => {
      const span = storyPlanNodeEpisodeSpan(candidate);
      return candidate.status === "approved"
        && candidate.expansion_status === "episode_ready"
        && span !== null
        && span >= MIN_EPISODE_READY_SPAN
        && span <= MAX_EPISODE_READY_SPAN
        && !activeParents.has(`${candidate.node_id}:${candidate.version}`);
    })
    .sort((left, right) => (
      (left.planned_start_episode ?? Number.MAX_SAFE_INTEGER)
      - (right.planned_start_episode ?? Number.MAX_SAFE_INTEGER)
    ));
}

function collectSubtreeVersions(
  nodes: StoryPlanNode[],
  root: StoryPlanNode,
): Map<string, number> {
  const result = new Map<string, number>();
  const queue = [{ nodeId: root.node_id, version: root.version }];
  while (queue.length) {
    const parent = queue.shift();
    if (!parent) break;
    for (const candidate of nodes) {
      if (
        candidate.parent_node_id === parent.nodeId
        && candidate.parent_node_version === parent.version
      ) {
        result.set(candidate.node_id, candidate.version);
        queue.push({ nodeId: candidate.node_id, version: candidate.version });
      }
    }
  }
  return result;
}

function remapRoadmapsToRebasedLineage(
  items: EpisodeRoadmapItem[],
  previousVersions: Map<string, number>,
  nextVersions: Map<string, number>,
): { items: EpisodeRoadmapItem[]; changed: EpisodeRoadmapItem[] } {
  const changed: EpisodeRoadmapItem[] = [];
  const remapped = items.map((item) => {
    const previousVersion = previousVersions.get(item.source_node_id);
    const nextVersion = nextVersions.get(item.source_node_id);
    if (
      previousVersion === undefined
      || nextVersion === undefined
      || item.source_node_version !== previousVersion
      || item.source_node_version === nextVersion
    ) return item;
    const checkpoint = {
      ...item,
      source_node_version: nextVersion,
      status: "draft" as const,
    };
    changed.push(checkpoint);
    return checkpoint;
  });
  return { items: mergeEpisodeRoadmaps([], remapped), changed };
}

function isPlanningPressureFailure(error: unknown): boolean {
  const metadata = error && typeof error === "object"
    ? error as { status?: unknown; failureClass?: unknown; errorType?: unknown }
    : {};
  if ([408, 429, 502, 503, 504].includes(Number(metadata.status))) return true;
  const classification = typeof metadata.failureClass === "string"
    ? metadata.failureClass
    : typeof metadata.errorType === "string"
      ? metadata.errorType
      : "";
  if (/rate_limit|timeout|gateway|network|empty|incomplete/.test(
    classification.toLocaleLowerCase(),
  )) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /(?:^|\D)(?:408|429|502|503|504)(?:\D|$)|rate.?limit|too many requests|timed?\s*out|timeout|gateway|empty (?:response|output)|incomplete (?:response|output|stream)|network error/i.test(message);
}
