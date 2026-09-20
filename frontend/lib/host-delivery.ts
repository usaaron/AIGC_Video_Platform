import { ensureHostToken } from "@/lib/api-client";
import { assertHostSessionActive, hostProjectId, hostSessionSignal } from "@/lib/host-session";
import { toEpisodePlainText } from "@/lib/episode-export";
import { buildEmbeddedOverseasDialogueView } from "@/lib/generation-client";
import { resolveSavedDraft } from "@/lib/script-draft-state";
import type { ScriptProject } from "@/lib/types";

export interface HostDeliveryResult {
  status: "completed";
  importedEpisodes: number;
  updatedEpisodes: number;
}

const HOST_DELIVERY_URL = process.env.NEXT_PUBLIC_HOST_DELIVERY_URL?.trim() ?? "";

export function hostDeliveryConfigured(): boolean {
  return HOST_DELIVERY_URL.length > 0;
}

export async function deliverSeriesToHost(project: ScriptProject): Promise<HostDeliveryResult> {
  if (!HOST_DELIVERY_URL) throw new Error("Host delivery is not configured.");
  const episodes = project.episodes
    .filter((episode) => episode.episodeNumber <= project.generationSettings.episodeCount)
    .sort((left, right) => left.episodeNumber - right.episodeNumber)
    .map((episode) => {
      const draft = resolveSavedDraft(episode);
      if (!draft) throw new Error(`Episode ${episode.episodeNumber} is not saved.`);
      return {
        sourceEpisodeId: episode.id,
        episodeNumber: episode.episodeNumber,
        title: draft.title || `第 ${episode.episodeNumber} 集`,
        content: toEpisodePlainText(draft, episode.episodeNumber, buildEmbeddedOverseasDialogueView(draft)),
      };
    });
  if (!episodes.length) throw new Error("At least one saved episode is required.");
  const sourceRevision = Math.max(1, project.deliveryContentRevision ?? project.storyBibleVersion ?? 1);
  const token = await ensureHostToken();
  const targetProjectId = hostProjectId() ?? project.id;
  assertHostSessionActive();
  const response = await fetch(HOST_DELIVERY_URL, {
    method: "POST",
    // Host delivery must use the verified ticket identity, even if host cookies
    // have changed since the most recent refresh.
    credentials: token ? "omit" : "same-origin",
    cache: "no-store",
    signal: hostSessionSignal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Idempotency-Key": `script-master:${project.id}:${sourceRevision}`,
    },
    body: JSON.stringify({
      targetProjectId,
      sourceProjectId: project.id,
      sourceRevision,
      idempotencyKey: `script-master:${project.id}:${sourceRevision}`,
      episodes,
    }),
  });
  if (!response.ok) {
    let message = `Host delivery failed (${response.status}).`;
    try {
      const payload = await response.json() as { error?: { message?: string }; detail?: string };
      message = payload.error?.message ?? payload.detail ?? message;
    } catch {
      // Keep the status based message when the host did not return JSON.
    }
    throw new Error(message);
  }
  const result = await response.json() as HostDeliveryResult;
  assertHostSessionActive();
  return result;
}
