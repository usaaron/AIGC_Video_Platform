import {
  approveStoryPlanNode,
  decomposeStoryPlanNode,
  generateEpisodePlanBatch,
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
import type { EpisodeRoadmapItem, ScriptProject } from "@/lib/types";

const FULL_TREE_CONCURRENCY = 7;

export interface StoryTreeExpansionProgress {
  phase: "top_level" | "approving" | "decomposing" | "roadmap" | "complete";
  nodeTitle?: string;
  completedLeaves: number;
}

export interface StoryTreeExpansionResult {
  activeNodes: StoryPlanNode[];
  topLevelNodes: StoryPlanNode[];
  episodeRoadmaps: EpisodeRoadmapItem[];
  completedLeaves: number;
}

export async function runFullStoryTreeExpansion(input: {
  project: ScriptProject;
  storyBible: StoryBible;
  beforeStep?: () => Promise<void> | void;
  onProgress?: (progress: StoryTreeExpansionProgress) => Promise<void> | void;
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

  let workingRoadmaps = project.episodeRoadmaps ?? [];
  let completedLeaves = 0;
  let frontier = topLevelNodes;

  while (frontier.length) {
    const nextLevels = await mapWithConcurrency(
      frontier,
      FULL_TREE_CONCURRENCY,
      async (initialNode): Promise<StoryPlanNode[]> => {
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
            });
            const previousLineage = await loadActiveStoryPlanNodes(
              project.id,
              node.story_bible_id,
              node.story_bible_version,
            );
            const previousSubtree = collectSubtreeVersions(previousLineage, node);
            node = await approveStoryPlanNode(node, "rebase");
            const nextLineage = await loadActiveStoryPlanNodes(
              project.id,
              node.story_bible_id,
              node.story_bible_version,
            );
            const nextVersions = new Map(nextLineage.map((item) => [item.node_id, item.version]));
            const remapped = remapRoadmapsToRebasedLineage(
              workingRoadmaps,
              previousSubtree,
              nextVersions,
            );
            workingRoadmaps = remapped.items;
            for (const checkpoint of remapped.changed) {
              await input.onRoadmapCheckpoint?.(checkpoint);
            }
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
          });
          node = await approveStoryPlanNode(node);
          await input.beforeStep?.();
        }

        if (span > MAX_EPISODE_READY_SPAN) {
          await input.onProgress?.({
            phase: "decomposing",
            nodeTitle: node.title,
            completedLeaves,
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

        // Finish the complete tree before generating any episode roadmap. Leaves
        // can sit at different depths, so generating here could process a later
        // episode range before an earlier branch has finished decomposing.
        return [];
      },
    );
    frontier = nextLevels.flat();
  }

  const activeNodes = await loadActiveStoryPlanNodes(
    project.id,
    storyBible.story_bible_id,
    storyBible.version,
  );
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
  const episodeReadyLeaves = activeNodes
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

  // Roadmaps are intentionally sequential across leaves. The final checkpoint
  // of an earlier leaf is part of the causal handoff into the next leaf.
  for (const leaf of episodeReadyLeaves) {
    await input.beforeStep?.();
    await input.onProgress?.({
      phase: "roadmap",
      nodeTitle: leaf.title,
      completedLeaves,
    });
    const generated = await generateEpisodePlanBatch(
      { ...project, episodeRoadmaps: workingRoadmaps },
      leaf,
      async (checkpoint) => {
        workingRoadmaps = mergeEpisodeRoadmaps(workingRoadmaps, [checkpoint]);
        await input.onRoadmapCheckpoint?.(checkpoint);
      },
      input.beforeStep,
    );
    workingRoadmaps = mergeEpisodeRoadmaps(workingRoadmaps, generated);
    completedLeaves += 1;
    await input.onProgress?.({
      phase: "roadmap",
      nodeTitle: leaf.title,
      completedLeaves,
    });
  }

  const activeTopLevelIds = new Set(topLevelNodes.map((node) => node.node_id));
  topLevelNodes = activeNodes
    .filter((node) => activeTopLevelIds.has(node.node_id))
    .sort((left, right) => left.sequence_order - right.sequence_order);
  await input.onProgress?.({ phase: "complete", completedLeaves });
  return { activeNodes, topLevelNodes, episodeRoadmaps: workingRoadmaps, completedLeaves };
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

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  let firstFailure: unknown;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length && firstFailure === undefined) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = await worker(values[index] as T);
        } catch (error) {
          firstFailure ??= error;
        }
      }
    },
  );
  // Do not reject while sibling requests are still writing checkpoints. The
  // caller may safely expose “continue” only after every in-flight worker ends.
  await Promise.all(workers);
  if (firstFailure !== undefined) throw firstFailure;
  return results;
}
