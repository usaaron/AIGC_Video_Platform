import type { EpisodeRoadmapItem } from "./types.ts";

/** Return the first contiguous episode range covered by saved roadmaps. */
export function episodeRoadmapCoverageThrough(
  episodeRoadmaps: EpisodeRoadmapItem[],
): number {
  const plannedEpisodes = new Set(
    episodeRoadmaps.map((item) => item.episode_number),
  );
  let readyThrough = 0;
  while (plannedEpisodes.has(readyThrough + 1)) readyThrough += 1;
  return readyThrough;
}
