import type { EpisodeRoadmapItem } from "./types.ts";

/**
 * Roadmap records created before the approval gate did not always carry a
 * status. Treat only a missing status as the legacy approved state; any
 * explicit non-approved value remains a draft so a malformed/new payload can
 * never increase readiness by accident.
 */
export function normalizeEpisodeRoadmapItem(
  item: EpisodeRoadmapItem,
): EpisodeRoadmapItem {
  const status = (item as EpisodeRoadmapItem & { status?: unknown }).status;
  if (status === "approved" || status === "draft") return item;
  return { ...item, status: status == null ? "approved" : "draft" };
}

export function normalizeEpisodeRoadmaps(
  episodeRoadmaps: EpisodeRoadmapItem[],
): EpisodeRoadmapItem[] {
  return episodeRoadmaps.map(normalizeEpisodeRoadmapItem);
}

/** Return true only for an approved roadmap (including legacy missing status). */
export function isApprovedEpisodeRoadmap(item: EpisodeRoadmapItem): boolean {
  const status = (item as EpisodeRoadmapItem & { status?: unknown }).status;
  // Missing status is the only legacy compatibility case. Do not treat an
  // arbitrary future/invalid status as approved.
  return status === "approved" || status == null;
}

/** AI output and local edits remain reviewable drafts until author approval. */
export function draftEpisodeRoadmapItem(
  item: EpisodeRoadmapItem,
): EpisodeRoadmapItem {
  return item.status === "draft" ? item : { ...item, status: "draft" };
}

/** Explicit author approval for one roadmap item. */
export function approveEpisodeRoadmapItem(
  item: EpisodeRoadmapItem,
): EpisodeRoadmapItem {
  return item.status === "approved" ? item : { ...item, status: "approved" };
}

/** Return the first contiguous episode range covered by saved roadmaps. */
export function episodeRoadmapCoverageThrough(
  episodeRoadmaps: EpisodeRoadmapItem[],
): number {
  const plannedEpisodes = new Set(
    episodeRoadmaps
      .filter(isApprovedEpisodeRoadmap)
      .map((item) => item.episode_number),
  );
  let readyThrough = 0;
  while (plannedEpisodes.has(readyThrough + 1)) readyThrough += 1;
  return readyThrough;
}
