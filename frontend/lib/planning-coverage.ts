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

/** Scene handoff checks used before author approval, mirroring the backend gate. */
export function episodeRoadmapReadinessIssues(
  item: EpisodeRoadmapItem,
): string[] {
  const scenes = item.scene_execution_plan ?? [];
  if (!scenes.length || scenes.length !== item.planned_scene_count) {
    return ["本集的场次安排需要补齐"];
  }
  if (scenes.some((scene, index) => scene.scene_number !== index + 1
    || ["opposition", "information_shift", "choice_or_cost"].some((field) => {
      const value = scene[field as "opposition"];
      return typeof value !== "string" || value.trim().length < 3;
    })
    || !scene.evidence_requirements?.some((value) => value.trim())
    || [scene.scene_objective, scene.visible_action, scene.turn_or_reveal,
      scene.dialogue_objective, scene.exit_state].some((value) => !value?.trim()))) {
    return ["本集有场次细节需要整理"];
  }
  const fields = [
    "scene_heading", "scene_objective", "opposition", "information_shift",
    "choice_or_cost", "turn_or_reveal", "visible_action", "exit_state",
  ] as const;
  const fingerprints = scenes.map((scene) => fields.map((field) => (
    String(scene[field] ?? "").toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, "")
  )).join("|"));
  return new Set(fingerprints).size < fingerprints.length
    ? ["本集有重复场次需要整理"]
    : [];
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
