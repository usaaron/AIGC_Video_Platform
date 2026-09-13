import { parseGeneratedDraft } from "./generated-draft-parser";
import type { EpisodeWorkspace, GeneratedDraft } from "./types";

export type ScriptDraftUpdater = (draft: GeneratedDraft) => GeneratedDraft;

export function normalizeEpisodeLifecycle(episode: EpisodeWorkspace): EpisodeWorkspace {
  const lockedAt = episode.lockedAt
    ?? (episode.status === "final" || episode.artifactRefs?.final
      ? episode.confirmedAt ?? episode.updatedAt
      : undefined);
  if (lockedAt) {
    const confirmedDraftJson = episode.confirmedDraftJson ?? episode.workingDraftJson;
    const lockedStatus = episode.status === "final"
      || Boolean(episode.finalizationResult?.master_script)
      || Boolean(episode.artifactRefs?.final)
      ? "final" : "confirmed";
    if (episode.status === lockedStatus && episode.lockedAt === lockedAt
      && episode.confirmedDraftJson === confirmedDraftJson
      && !episode.hasLocalDraftEdits && !episode.modificationCandidate) return episode;
    return {
      ...episode, status: lockedStatus, confirmedDraftJson,
      confirmedAt: episode.confirmedAt ?? lockedAt, lockedAt,
      hasLocalDraftEdits: false, modificationCandidate: undefined,
    };
  }
  const status = episode.hasLocalDraftEdits || episode.modificationCandidate ? "editing" : "saved";
  return episode.status === status && !episode.lockedAt
    ? episode : { ...episode, status, lockedAt: undefined };
}

export function episodeIsLocked(episode: EpisodeWorkspace): boolean {
  return Boolean(normalizeEpisodeLifecycle(episode).lockedAt);
}

export function episodeHasSavedDraft(episode: EpisodeWorkspace): boolean {
  const normalized = normalizeEpisodeLifecycle(episode);
  return ["saved", "confirmed", "final"].includes(normalized.status)
    && !normalized.deepeningRun?.candidate_draft_master_script;
}

export function parseWorkingDraft(value?: string): GeneratedDraft | null {
  return parseGeneratedDraft(value, { requireTitle: true, requireCompleteScenes: true });
}

export function resolveWorkingDraft(episode: EpisodeWorkspace): GeneratedDraft {
  const locked = episodeIsLocked(episode);
  return episode.finalizationResult?.master_script
    ?? parseWorkingDraft(locked ? episode.confirmedDraftJson : episode.workingDraftJson)
    ?? parseWorkingDraft(locked ? episode.workingDraftJson : episode.confirmedDraftJson)
    ?? episode.generationRun.draft_master_script;
}

export function resolveSavedDraft(episode: EpisodeWorkspace): GeneratedDraft | null {
  return episodeHasSavedDraft(episode) ? resolveWorkingDraft(episode) : null;
}

export function editedDraftPatch(draft: GeneratedDraft): Partial<EpisodeWorkspace> {
  return {
    workingDraftJson: JSON.stringify(draft, null, 2),
    confirmedDraftJson: undefined,
    confirmedAt: undefined,
    lockedAt: undefined,
    revisionRun: undefined,
    finalizationResult: undefined,
  };
}
