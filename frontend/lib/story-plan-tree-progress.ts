import { MAX_EPISODE_READY_SPAN, MIN_EPISODE_READY_SPAN } from "./episode-generation-planning.ts";
import { hasCompleteStoryPlanChildCoverage } from "./story-plan-coverage.ts";
import { isApprovedEpisodeRoadmap } from "./planning-coverage.ts";
import type { StoryPlanNode } from "./story-planning-client.ts";
import type { EpisodeRoadmapItem } from "./types.ts";

export interface StoryPlanTreeProgress {
  expansionComplete: boolean;
  readyLeafCount: number;
  plannedEpisodeCount: number;
  generatedRoadmapCount: number;
}

export function summarizeStoryPlanTreeProgress(
  activeNodes: StoryPlanNode[],
  episodeRoadmaps: EpisodeRoadmapItem[],
  expectedEpisodeCount?: number,
): StoryPlanTreeProgress {
  const activeNodeKeys = new Set(
    activeNodes.map((node) => nodeKey(node.node_id, node.version)),
  );
  const childrenByParent = new Map<string, StoryPlanNode[]>();
  for (const node of activeNodes) {
    if (
      node.parent_node_id === null
      || node.parent_node_version === null
      || !activeNodeKeys.has(nodeKey(node.parent_node_id, node.parent_node_version))
    ) continue;
    const parentKey = nodeKey(node.parent_node_id, node.parent_node_version);
    childrenByParent.set(parentKey, [
      ...(childrenByParent.get(parentKey) ?? []),
      node,
    ]);
  }

  const readyLeaves: StoryPlanNode[] = [];
  let everyBranchComplete = activeNodes.length > 0;
  for (const node of activeNodes) {
    const children = childrenByParent.get(nodeKey(node.node_id, node.version)) ?? [];
    if (children.length > 0) {
      if (
        node.status !== "approved"
        || node.expansion_status !== "expanded"
        || !hasCompleteStoryPlanChildCoverage(node, children)
      ) everyBranchComplete = false;
      continue;
    }

    const span = episodeSpan(node);
    const ready = node.status === "approved"
      && node.expansion_status === "episode_ready"
      && span !== null
      && span >= MIN_EPISODE_READY_SPAN
      && span <= MAX_EPISODE_READY_SPAN;
    if (ready) readyLeaves.push(node);
    else everyBranchComplete = false;
  }

  const expectedEpisodeKeys = new Set<string>();
  const coveredEpisodeNumbers = new Set<number>();
  for (const leaf of readyLeaves) {
    if (leaf.planned_start_episode === null || leaf.planned_end_episode === null) continue;
    for (
      let episodeNumber = leaf.planned_start_episode;
      episodeNumber <= leaf.planned_end_episode;
      episodeNumber += 1
    ) {
      expectedEpisodeKeys.add(roadmapKey(leaf.node_id, leaf.version, episodeNumber));
      coveredEpisodeNumbers.add(episodeNumber);
    }
  }

  const fullEpisodeRangeCovered = expectedEpisodeCount === undefined || (
    expectedEpisodeCount > 0
    && coveredEpisodeNumbers.size === expectedEpisodeCount
    && Array.from(
      { length: expectedEpisodeCount },
      (_, index) => index + 1,
    ).every((episodeNumber) => coveredEpisodeNumbers.has(episodeNumber))
  );

  const generatedEpisodeKeys = new Set<string>();
  for (const item of episodeRoadmaps) {
    if (!isApprovedEpisodeRoadmap(item)) continue;
    const key = roadmapKey(item.source_node_id, item.source_node_version, item.episode_number);
    if (!expectedEpisodeKeys.has(key)) continue;
    generatedEpisodeKeys.add(key);
  }

  return {
    expansionComplete: everyBranchComplete
      && readyLeaves.length > 0
      && fullEpisodeRangeCovered,
    readyLeafCount: readyLeaves.length,
    plannedEpisodeCount: expectedEpisodeKeys.size,
    generatedRoadmapCount: generatedEpisodeKeys.size,
  };
}

export function episodeReadyStoryPlanLeaves(
  activeNodes: StoryPlanNode[],
): StoryPlanNode[] {
  const activeNodeKeys = new Set(
    activeNodes.map((node) => nodeKey(node.node_id, node.version)),
  );
  const activeParentKeys = new Set(
    activeNodes
      .filter((node) => (
        node.parent_node_id !== null
        && node.parent_node_version !== null
        && activeNodeKeys.has(nodeKey(node.parent_node_id, node.parent_node_version))
      ))
      .map((node) => nodeKey(
        node.parent_node_id as string,
        node.parent_node_version as number,
      )),
  );

  return activeNodes
    .filter((node) => {
      const span = episodeSpan(node);
      return node.status === "approved"
        && node.expansion_status === "episode_ready"
        && span !== null
        && span >= MIN_EPISODE_READY_SPAN
        && span <= MAX_EPISODE_READY_SPAN
        && !activeParentKeys.has(nodeKey(node.node_id, node.version));
    })
    .sort((left, right) => (
      (left.planned_start_episode ?? Number.MAX_SAFE_INTEGER)
      - (right.planned_start_episode ?? Number.MAX_SAFE_INTEGER)
    ));
}

function episodeSpan(node: StoryPlanNode): number | null {
  if (node.planned_start_episode === null || node.planned_end_episode === null) return null;
  return node.planned_end_episode - node.planned_start_episode + 1;
}

function nodeKey(nodeId: string, version: number): string {
  return `${nodeId}:${version}`;
}

function roadmapKey(nodeId: string, version: number, episodeNumber: number): string {
  return `${nodeKey(nodeId, version)}:${episodeNumber}`;
}
