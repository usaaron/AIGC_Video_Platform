export interface StoryPlanCoverageNode {
  node_id: string;
  version: number;
  parent_node_id: string | null;
  parent_node_version: number | null;
  predecessor_node_id: string | null;
  predecessor_node_version: number | null;
  sequence_order: number;
  planned_start_episode: number | null;
  planned_end_episode: number | null;
}

export function hasCompleteStoryPlanChildCoverage(
  parent: StoryPlanCoverageNode,
  children: StoryPlanCoverageNode[],
  maxEpisodeReadySpan = 12,
): boolean {
  if (
    parent.planned_start_episode === null
    || parent.planned_end_episode === null
  ) return false;
  const parentSpan = parent.planned_end_episode - parent.planned_start_episode + 1;
  if (children.length < (parentSpan > maxEpisodeReadySpan ? 2 : 1)) return false;
  const ordered = [...children].sort((left, right) => left.sequence_order - right.sequence_order);
  let nextEpisode = parent.planned_start_episode;
  for (let index = 0; index < ordered.length; index += 1) {
    const child = ordered[index];
    const predecessor = ordered[index - 1];
    if (
      child.parent_node_id !== parent.node_id
      || child.parent_node_version !== parent.version
      || child.sequence_order !== index + 1
      || (index === 0 && (
        child.predecessor_node_id !== null
        || child.predecessor_node_version !== null
      ))
      || (index > 0 && (
        child.predecessor_node_id !== predecessor?.node_id
        || child.predecessor_node_version === null
        || child.predecessor_node_version < 1
        || child.predecessor_node_version > predecessor.version
      ))
      || child.planned_start_episode !== nextEpisode
      || child.planned_end_episode === null
      || child.planned_end_episode < nextEpisode
      || child.planned_end_episode > parent.planned_end_episode
    ) return false;
    nextEpisode = child.planned_end_episode + 1;
  }
  return nextEpisode === parent.planned_end_episode + 1;
}
