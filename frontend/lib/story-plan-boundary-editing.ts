import type { StoryPlanNode } from "./story-planning-client";

type BoundaryField = "entry_state" | "exit_state";

/** Keep the node and its existing first/last event valid in one version save. */
export function editStoryPlanNodeBoundary(
  node: StoryPlanNode,
  field: BoundaryField,
  value: string,
): StoryPlanNode {
  const episodeNumber = field === "entry_state" ? node.planned_start_episode : node.planned_end_episode;
  return {
    ...node,
    [field]: value,
    ...(node.episode_developments ? {
      episode_developments: node.episode_developments.map((entry) => (
        entry.episode_number === episodeNumber ? { ...entry, [field]: value } : entry
      )),
    } : {}),
  };
}

/** Interior event edits do not silently rewrite adjacent episodes. */
export function editStoryPlanEpisodeBoundary(
  node: StoryPlanNode,
  episodeNumber: number,
  field: BoundaryField,
  value: string,
): StoryPlanNode {
  if (!node.episode_developments?.some((entry) => entry.episode_number === episodeNumber)) return node;
  const isNodeBoundary = episodeNumber === (field === "entry_state" ? node.planned_start_episode : node.planned_end_episode);
  return {
    ...node,
    ...(isNodeBoundary ? { [field]: value } : {}),
    episode_developments: node.episode_developments.map((entry) => (
      entry.episode_number === episodeNumber ? { ...entry, [field]: value } : entry
    )),
  };
}
