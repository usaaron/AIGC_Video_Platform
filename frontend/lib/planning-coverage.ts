import type { EpisodeRoadmapItem } from "./types.ts";

/** Return the first contiguous episode range fully covered by approved roadmaps. */
export function approvedEpisodeRoadmapCoverageThrough(
  episodeRoadmaps: EpisodeRoadmapItem[],
): number {
  const approvedEpisodes = new Set(
    episodeRoadmaps
      .filter((item) => item.status === "approved")
      .map((item) => item.episode_number),
  );
  let readyThrough = 0;
  while (approvedEpisodes.has(readyThrough + 1)) readyThrough += 1;
  return readyThrough;
}
