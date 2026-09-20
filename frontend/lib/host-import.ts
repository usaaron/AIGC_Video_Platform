import { ensureHostToken } from "./api-client";
import { assertHostSessionActive, hostSessionSignal } from "./host-session";
import { loadStoryboard } from "./storyboard";
import { resolveSavedDraft } from "./script-draft-state";
import { buildImportMaterial, type ImportMaterial, type ImportReadOptions } from "./host-import-payload";
import { bindHostAssetEvidence } from "./host-asset-evidence";
import type { ScriptProject } from "./types";

export interface ImportReceipt { status: "completed"; targetProjectId: string; importedEpisodes: number; updatedEpisodes: number; importedAssets: number; updatedAssets: number; preservedAssets: number; importedShots: number; updatedShots: number; warnings?: string[]; revisionSummary?: { episodeNumbers: number[]; preservedShots: number; renewedShots: number } }
export class HostImportError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) { super(message); this.name = "HostImportError"; this.code = code; }
}
const base = (process.env.NEXT_PUBLIC_HOST_DELIVERY_URL?.trim() ?? "").replace(/\/deliveries$/, "");

async function hostRequest<T>(path: string, body?: unknown): Promise<T> {
  if (!base) throw new Error("主项目导入接口尚未配置。");
  const token = await ensureHostToken();
  const response = await fetch(`${base}/${path}`, { method: body ? "POST" : "GET", credentials: token ? "omit" : "same-origin", cache: "no-store", signal: hostSessionSignal, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
    throw new HostImportError(data?.error?.message || `主项目暂未完成请求（${response.status}），请重试。`, data?.error?.code);
  }
  const result = await response.json() as T;
  assertHostSessionActive();
  return result;
}

export function loadImportTargets() { return hostRequest<Array<{ id: string; name: string }>>("targets"); }

export async function readImportMaterial(project: ScriptProject, options: ImportReadOptions = {}): Promise<ImportMaterial> {
  if (options.scriptsOnly) return buildImportMaterial(project, new Map(), options);
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

export async function importMaterial(project: ScriptProject, targetProjectId: string, material: ImportMaterial, options: { episodeIds: string[]; assets: boolean; shots: boolean; storyboardRevision?: "preserve-history" }): Promise<ImportReceipt> {
  const warnings: string[] = [];
  const episodes = await Promise.all(material.episodes.filter(e => options.episodeIds.includes(e.sourceEpisodeId)).map(async ({ shots, assetEvidence: pending, ...episode }) => {
    const content = episode.content.trim();
    const assetEvidence = await bindHostAssetEvidence(pending, content);
    if (pending && !assetEvidence) {
      const warning = `第 ${episode.episodeNumber} 集正文或资料已变化，本次按当前正文交付，资产资料将在主项目重新分析。`;
      warnings.push(warning);
    }
    return { ...episode, content, ...(assetEvidence ? { assetEvidence } : {}), ...(options.shots && shots ? { shots } : {}) };
  }));
  const body = { contractVersion: "script_master_delivery.v2", targetProjectId, sourceProjectId: project.id, sourceRevision: Math.max(1, project.deliveryContentRevision ?? project.storyBibleVersion ?? 1), episodes, assets: options.assets ? material.assets : [], ...(options.storyboardRevision ? { storyboardRevision: options.storyboardRevision } : {}) };
  const checksum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body))))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const receipt = await hostRequest<ImportReceipt>("imports", { ...body, idempotencyKey: `sm2:${checksum}` });
  return warnings.length ? { ...receipt, warnings: [...(receipt.warnings ?? []), ...warnings] } : receipt;
}
