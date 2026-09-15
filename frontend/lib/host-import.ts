import { ensureHostToken } from "./api-client";
import { assertHostSessionActive, hostSessionSignal } from "./host-session";
import { loadStoryboard } from "./storyboard";
import { resolveSavedDraft } from "./script-draft-state";
import { buildImportMaterial, type ImportMaterial } from "./host-import-payload";
import type { ScriptProject } from "./types";

export interface ImportReceipt { status: "completed"; targetProjectId: string; importedEpisodes: number; updatedEpisodes: number; importedAssets: number; updatedAssets: number; preservedAssets: number; importedShots: number; updatedShots: number }
const base = (process.env.NEXT_PUBLIC_HOST_DELIVERY_URL?.trim() ?? "").replace(/\/deliveries$/, "");

async function hostRequest<T>(path: string, body?: unknown): Promise<T> {
  if (!base) throw new Error("主项目导入接口尚未配置。");
  const token = await ensureHostToken();
  const response = await fetch(`${base}/${path}`, { method: body ? "POST" : "GET", credentials: token ? "omit" : "same-origin", cache: "no-store", signal: hostSessionSignal, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message || `主项目暂未完成请求（${response.status}），请重试。`);
  }
  const result = await response.json() as T;
  assertHostSessionActive();
  return result;
}

export function loadImportTargets() { return hostRequest<Array<{ id: string; name: string }>>("targets"); }

export async function readImportMaterial(project: ScriptProject): Promise<ImportMaterial> {
  const episodes = project.episodes.filter(e => e.episodeNumber <= project.generationSettings.episodeCount && resolveSavedDraft(e));
  const boards = new Map<number, Awaited<ReturnType<typeof loadStoryboard>>>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, episodes.length) }, async () => {
    while (next < episodes.length) {
      const episode = episodes[next++];
      boards.set(episode.episodeNumber, await loadStoryboard(project.id, episode.episodeNumber));
    }
  }));
  return buildImportMaterial(project, boards);
}

export async function importMaterial(project: ScriptProject, targetProjectId: string, material: ImportMaterial, options: { episodeIds: string[]; assets: boolean; shots: boolean }): Promise<ImportReceipt> {
  const body = { contractVersion: "script_master_delivery.v2", targetProjectId, sourceProjectId: project.id, sourceRevision: Math.max(1, project.deliveryContentRevision ?? project.storyBibleVersion ?? 1), episodes: material.episodes.filter(e => options.episodeIds.includes(e.sourceEpisodeId)).map(({ shots, ...e }) => ({ ...e, ...(options.shots && shots ? { shots } : {}) })), assets: options.assets ? material.assets : [] };
  const checksum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body))))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return hostRequest<ImportReceipt>("imports", { ...body, idempotencyKey: `sm2:${checksum}` });
}
