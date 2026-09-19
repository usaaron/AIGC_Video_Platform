import type { EpisodeRoadmapItem, EpisodeWorkspace, GeneratedDraft } from "./types";
import { resolveWorkingDraft } from "./script-draft-state";

const PLAN_DERIVED = new Set(["status", "source_revision_review", "execution_ready", "layer_contracts"]);
const BODY_DERIVED = new Set(["id", "created_at", "updated_at", "llm_metadata"]);

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, character => character.codePointAt(0)!);
  const b = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => sortedJson(item === undefined ? null : item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => compareCodePoints(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Matches the server's canonical UTF-8 JSON SHA-256 receipt identity. */
export async function producedPlanContentHash(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(sortedJson(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function producedPlanHash(plan: EpisodeRoadmapItem): Promise<string> {
  return producedPlanContentHash(Object.fromEntries(Object.entries(plan).filter(([key]) => !PLAN_DERIVED.has(key))));
}

export function producedDraftHash(draft: GeneratedDraft): Promise<string> {
  return producedPlanContentHash(Object.fromEntries(Object.entries(draft).filter(([key]) => !BODY_DERIVED.has(key))));
}

export function producedEpisodeBodyHash(episode: EpisodeWorkspace): Promise<string> {
  const draft = resolveWorkingDraft(episode);
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error("本集正文不完整，请重新载入保存稿。");
  return producedDraftHash(draft);
}
