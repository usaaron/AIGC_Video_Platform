import type { EpisodeExecutionPlan } from "./episode-generation-planning";
import type { CopilotProgressEvent } from "./copilot-progress";
import type { CharacterActingProfile, GeneratedDraft, ScriptProject } from "./types";

export interface QuickScriptSettings {
  /** Dialogue language only; planning, reasoning and narrative remain Chinese. */
  language: "zh" | "en";
  target_total_characters: number;
  episode_count: number;
  target_duration_seconds: number;
  storyline_count: number;
}

export interface QuickScriptCharacter {
  character_ref: string; name: string; role: string; motivation: string;
  fixed_identity: string; abilities_and_limits: string; appearance: string;
  acting_profile?: CharacterActingProfile | null;
}

export interface QuickScriptProductionAsset {
  asset_ref: string; name: string; kind: "scene" | "prop";
  appearance: string; fixed_details: string[];
}

export interface QuickScriptPlan {
  id: string; version: number; source_synopsis_hash: string; content_hash: string;
  title: string; characters: QuickScriptCharacter[]; fixed_facts: string[];
  production_assets?: QuickScriptProductionAsset[] | null;
  relationships: string[]; main_storyline: string; subplot: string | null;
  opening: string; turning_points: string[]; ending: string;
  episodes: Array<EpisodeExecutionPlan & { episode_title?: string | null; synopsis?: string | null; locations: string[] }>;
}

export interface QuickScriptIssue {
  code: string; severity: "critical" | "ambiguity" | "warning"; message: string;
  episode_number?: number | null; scene_number?: number | null;
  path?: string | null; evidence_quote: string;
}

export interface QuickScriptReview {
  status: "passed" | "blocked" | "needs_author"; summary: string;
  issues: QuickScriptIssue[]; accepted_facts: unknown[]; source_body_hashes: Record<string, string>;
}

export interface QuickScriptEpisode {
  episode_number: number; revision: number; status: "drafted" | "passed" | "blocked" | "stale";
  draft: GeneratedDraft; initial_draft?: GeneratedDraft | null; source_plan_hash: string;
  source_episode_hashes: Record<string, string>; body_hash: string;
  review?: QuickScriptReview | null; repair_count: number; repair_attempts?: number; metrics: Record<string, unknown>;
  artifact_id?: string | null; updated_at: string;
}

export interface QuickScriptState {
  schema_version: "quick_script.v1"; project_id: string; revision: number;
  phase: "setup" | "synopsis" | "plan" | "writing" | "review" | "complete" | "paused" | "standard";
  status: "idle" | "busy" | "blocked" | "stale" | "completed";
  next_step: "synopsis" | "plan" | "draft" | "review" | "repair" | "recheck" | "final_review" | "done";
  settings: QuickScriptSettings; idea: string; source_material: string;
  overseas_story_profile?: Record<string, string> | null;
  supplied_characters: QuickScriptCharacter[]; synopsis: string; synopsis_confirmed: boolean;
  synopsis_hash: string; plan: QuickScriptPlan | null; plan_confirmed: boolean;
  episodes: QuickScriptEpisode[]; facts: unknown[]; final_review: QuickScriptReview | null;
  blocked_reason: string | null; active_operation: Record<string, unknown> | null;
  operation_records: Array<Record<string, unknown>>; model_calls: Array<Record<string, unknown>>;
  created_at: string; updated_at: string;
}

export type QuickScriptAction = "setup" | "draft_synopsis" | "confirm_synopsis" | "draft_plan" | "confirm_plan"
  | "advance" | "save_episode" | "switch_standard" | "resume";

export type QuickScriptRecoveryAction = "repair" | "switch_standard" | null;

export interface QuickScriptResponse {
  data: {
    state: QuickScriptState | null;
    recovery_action?: QuickScriptRecoveryAction;
    workspace_snapshot: { revision: number; workspace_payload: ScriptProject; updated_at: string; [key: string]: unknown };
    project_revision: number;
  };
}

export interface QuickScriptRequestOptions { signal?: AbortSignal; onProgress?: (event: CopilotProgressEvent) => void }

export type QuickScriptStage = "synopsis" | "plan" | "script";

export function quickScriptStage(state: QuickScriptState | null): QuickScriptStage {
  if (state?.plan_confirmed || state?.episodes.length) return "script";
  if (state?.synopsis_confirmed) return "plan";
  return "synopsis";
}

export function quickScriptCanAdvance(state: QuickScriptState): boolean {
  return state.plan_confirmed && state.phase !== "paused" && state.phase !== "standard"
    && state.phase !== "complete" && state.status !== "blocked" && !state.active_operation && state.next_step !== "done";
}

export function quickScriptOperationActive(state: QuickScriptState | null, now = Date.now()): boolean {
  if (!state?.active_operation) return false;
  const expires = Date.parse(String(state.active_operation.expires_at ?? ""));
  return !Number.isFinite(expires) || expires > now;
}

export function quickScriptRecoveryWaitLabel(state: QuickScriptState | null, now = Date.now()): string {
  const expires = Date.parse(String(state?.active_operation?.expires_at ?? ""));
  if (!Number.isFinite(expires)) return "正在确认上次请求的结果，确认前请勿重复生成。";
  const remaining = Math.max(0, Math.ceil((expires - now) / 1000));
  if (!remaining) return "等待保护已结束。可恢复已保存进度，再决定是否继续上次未完成的步骤。";
  const minutes = Math.floor(remaining / 60), seconds = remaining % 60;
  return `正在找回结果；最多再等待 ${minutes} 分 ${seconds.toString().padStart(2, "0")} 秒即可恢复操作。结果提前保存后会立即显示。`;
}

export function quickScriptSavedProgressLabel(state: QuickScriptState | null): string {
  if (!state) return "尚未开始创作";
  if (state.episodes.length) {
    const checked = state.episodes.filter(episode => episode.status === "passed").length;
    return `已保存 ${state.episodes.length} / ${state.settings.episode_count} 集 · 已检查 ${checked} 集`;
  }
  if (state.plan) return state.plan_confirmed ? "创作安排已确认，等待开始正文" : "创作安排已保存，等待确认";
  if (state.synopsis) return state.synopsis_confirmed ? "故事梗概已确认" : "故事梗概已保存，等待确认";
  return "故事想法与创作设置已保存";
}

export function quickScriptSelectedEpisode(state: QuickScriptState | null, preferredNumber: number): QuickScriptEpisode | undefined {
  if (state?.phase === "paused" && state.status === "blocked") {
    const blocked = state.episodes.find(episode => episode.status === "blocked");
    const finalIssue = state.final_review?.issues.find(issue => issue.severity !== "warning" && issue.episode_number);
    const affected = blocked ?? state.episodes.find(episode => episode.episode_number === finalIssue?.episode_number);
    if (affected) return affected;
  }
  return state?.episodes.find(episode => episode.episode_number === preferredNumber) ?? state?.episodes[0];
}

export function quickScriptProgressLabel(state: QuickScriptState): string {
  if (state.phase === "complete") return "整部剧本已保存并完成检查";
  if (state.phase === "paused") return "已暂停，已有正文已保留";
  const step = state.active_operation?.stage ?? state.next_step;
  if (step === "synopsis") return "正在整理故事梗概";
  if (step === "plan") return "正在安排人物与每集故事";
  if (step === "final_review") return "正在检查整部剧本";
  const pending = state.episodes.find((episode) => episode.status !== "passed");
  const number = pending?.episode_number ?? state.episodes.length + 1;
  if (step === "review" || step === "recheck") return `正在检查第 ${number} 集`;
  if (step === "repair") return `正在修正第 ${number} 集的问题`;
  return `正在创作第 ${number} 集`;
}
