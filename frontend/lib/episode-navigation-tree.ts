import type { StoryPlanNode } from "./story-planning-client.ts";

const TECHNICAL_STORY_ROOT_MARKER = "system_story_bible_root.v1";

export interface EpisodeNavigationBranch {
  nodeId: string;
  title: string;
  children: EpisodeNavigationBranch[];
  directEpisodeNumbers: number[];
  episodeNumbers: number[];
}

export interface EpisodeNavigationTree {
  branches: EpisodeNavigationBranch[];
  unassignedEpisodeNumbers: number[];
}

export function buildEpisodeNavigationTree(
  storyPlanNodes: StoryPlanNode[],
  episodeNumbers: number[],
): EpisodeNavigationTree {
  const visibleEpisodes = [...new Set(episodeNumbers)]
    .filter((episodeNumber) => Number.isInteger(episodeNumber) && episodeNumber > 0)
    .sort((left, right) => left - right);
  const nodes = storyPlanNodes.filter((node) => (
    node.status === "approved"
    && node.decomposition_reason !== TECHNICAL_STORY_ROOT_MARKER
    && node.planned_start_episode !== null
    && node.planned_end_episode !== null
    && node.planned_end_episode >= node.planned_start_episode
  ));
  const nodeById = new Map(nodes.map((node) => [node.node_id, node]));
  const assignedEpisodes = new Map<string, number[]>();
  const includedNodeIds = new Set<string>();
  const unassignedEpisodeNumbers: number[] = [];

  function depthOf(node: StoryPlanNode): number {
    let depth = 0;
    let current = node;
    const visited = new Set([node.node_id]);
    while (current.parent_node_id) {
      const parent = nodeById.get(current.parent_node_id);
      if (!parent || visited.has(parent.node_id)) break;
      visited.add(parent.node_id);
      depth += 1;
      current = parent;
    }
    return depth;
  }

  function includeAncestors(node: StoryPlanNode): void {
    let current: StoryPlanNode | undefined = node;
    const visited = new Set<string>();
    while (current && !visited.has(current.node_id)) {
      visited.add(current.node_id);
      includedNodeIds.add(current.node_id);
      current = current.parent_node_id
        ? nodeById.get(current.parent_node_id)
        : undefined;
    }
  }

  for (const episodeNumber of visibleEpisodes) {
    const owner = nodes
      .filter((node) => (
        episodeNumber >= (node.planned_start_episode as number)
        && episodeNumber <= (node.planned_end_episode as number)
      ))
      .sort((left, right) => {
        const depthDifference = depthOf(right) - depthOf(left);
        if (depthDifference) return depthDifference;
        const leftSpan = (left.planned_end_episode as number) - (left.planned_start_episode as number);
        const rightSpan = (right.planned_end_episode as number) - (right.planned_start_episode as number);
        return leftSpan - rightSpan || left.sequence_order - right.sequence_order;
      })[0];
    if (!owner) {
      unassignedEpisodeNumbers.push(episodeNumber);
      continue;
    }
    assignedEpisodes.set(owner.node_id, [
      ...(assignedEpisodes.get(owner.node_id) ?? []),
      episodeNumber,
    ]);
    includeAncestors(owner);
  }

  const childrenByParent = new Map<string | null, StoryPlanNode[]>();
  for (const node of nodes) {
    if (!includedNodeIds.has(node.node_id)) continue;
    const parentId = node.parent_node_id && includedNodeIds.has(node.parent_node_id)
      ? node.parent_node_id
      : null;
    childrenByParent.set(parentId, [
      ...(childrenByParent.get(parentId) ?? []),
      node,
    ]);
  }

  function buildBranches(parentId: string | null, ancestry: Set<string>): EpisodeNavigationBranch[] {
    return (childrenByParent.get(parentId) ?? [])
      .slice()
      .sort((left, right) => (
        left.sequence_order - right.sequence_order
        || (left.planned_start_episode as number) - (right.planned_start_episode as number)
        || left.title.localeCompare(right.title)
      ))
      .flatMap((node) => {
        if (ancestry.has(node.node_id)) return [];
        const nextAncestry = new Set(ancestry).add(node.node_id);
        const children = buildBranches(node.node_id, nextAncestry);
        const directEpisodeNumbers = assignedEpisodes.get(node.node_id) ?? [];
        const branchEpisodeNumbers = [
          ...directEpisodeNumbers,
          ...children.flatMap((child) => child.episodeNumbers),
        ].sort((left, right) => left - right);
        return [{
          nodeId: node.node_id,
          title: node.title.trim() || node.node_id,
          children,
          directEpisodeNumbers,
          episodeNumbers: branchEpisodeNumbers,
        }];
      });
  }

  return {
    branches: buildBranches(null, new Set()),
    unassignedEpisodeNumbers,
  };
}

export function episodeNavigationPath(
  branches: EpisodeNavigationBranch[],
  episodeNumber: number,
): string[] {
  for (const branch of branches) {
    if (!branch.episodeNumbers.includes(episodeNumber)) continue;
    return [branch.nodeId, ...episodeNavigationPath(branch.children, episodeNumber)];
  }
  return [];
}
