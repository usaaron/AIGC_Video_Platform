import { DEFAULT_GENERATION_SETTINGS, type GenerationSettings, type ScriptProject } from "./types";
import { normalizeGenerationSettings } from "./generation-planning";
import type { QuickScriptSettings } from "./quick-script-types";

export const DEFAULT_QUICK_GENERATION_SETTINGS: GenerationSettings = {
  ...DEFAULT_GENERATION_SETTINGS,
  episodeCount: 8,
  targetTotalCharacters: 8_000,
  preferredEpisodeDurationMinutes: 1.5,
  batchSize: 1,
  sceneCount: 3,
  releaseRegion: "cn_mainland",
  outputLanguage: "zh",
};

/** Rebudget only an explicit, valid episode-count change; never rewrite saved scope on load. */
export function quickTargetCharactersAfterEpisodeChange(
  currentEpisodeCount: number,
  nextEpisodeCount: number,
  currentTarget: number,
): number {
  if (nextEpisodeCount === currentEpisodeCount || !Number.isInteger(nextEpisodeCount)
    || nextEpisodeCount < 1 || nextEpisodeCount > 12) return currentTarget;
  return Math.min(10_000, Math.max(1_000, nextEpisodeCount * 1_000));
}

export function quickSettingsForHost(durationSeconds?: number | null): GenerationSettings | null {
  if (durationSeconds != null && (!Number.isInteger(durationSeconds) || durationSeconds < 75 || durationSeconds > 115)) return null;
  return { ...DEFAULT_QUICK_GENERATION_SETTINGS, preferredEpisodeDurationMinutes: (durationSeconds ?? 90) / 60 };
}

export function canStartQuickScript(project: ScriptProject): boolean {
  return project.quickWorkflow?.phase !== "standard" && project.episodes.length === 0 && project.marketProfile !== "overseas_tiktok"
    && project.generationSettings.releaseRegion !== "overseas" && project.generationSettings.outputLanguage !== "en";
}

export function quickInitialInputs(project: ScriptProject): {
  idea: string; material: string; synopsis: string; settings: QuickScriptSettings;
} {
  const duration = Math.round(project.generationSettings.preferredEpisodeDurationMinutes * 60);
  return {
    idea: project.creativePrompt ?? "",
    material: (project.referenceMaterials ?? []).map(item => item.extractedText).filter(Boolean).join("\n\n"),
    synopsis: project.storySynopsis?.text ?? "",
    settings: { language: "zh", episode_count: project.creationMode === "quick" ? project.generationSettings.episodeCount : 8,
      target_total_characters: project.creationMode === "quick" ? project.generationSettings.targetTotalCharacters : 8000,
      target_duration_seconds: duration >= 75 && duration <= 115 ? duration : 90, storyline_count: 1 },
  };
}

/** Explicit mode only: a short legacy project must never silently change workflow. */
export function isQuickScriptProject(project: Pick<ScriptProject, "creationMode" | "marketProfile" | "generationSettings">): boolean {
  return project.creationMode === "quick" && project.marketProfile !== "overseas_tiktok"
    && project.generationSettings.releaseRegion !== "overseas";
}

/** Restore short targets without the standard workflow's 80,000-character floor.
 * Preserve out-of-range author values for server validation, rather than silently
 * shrinking a work to fit the quick mode's advertised limits.
 */
export function normalizeProjectGenerationSettings(
  creationMode: ScriptProject["creationMode"],
  settings?: Partial<GenerationSettings>,
  options: { legacy?: boolean; quickHistory?: boolean } = {},
): GenerationSettings {
  if (creationMode !== "quick" && !options.quickHistory) return normalizeGenerationSettings(settings, options);
  const value = { ...DEFAULT_QUICK_GENERATION_SETTINGS, ...settings };
  for (const field of ["episodeCount", "targetTotalCharacters", "preferredEpisodeDurationMinutes", "sceneCount"] as const) {
    if (!Number.isFinite(value[field]) || value[field] <= 0) value[field] = DEFAULT_QUICK_GENERATION_SETTINGS[field];
  }
  return value;
}

export function quickScriptHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/quick`;
}

export function projectSourceHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function hostScriptEntryHref(project: ScriptProject, standardHref: string, integrated: boolean): string {
  if (!integrated || !isQuickScriptProject(project)) return standardHref;
  return project.quickWorkflow || project.storySynopsis || project.episodes.length
    ? quickScriptHref(project.id) : projectSourceHref(project.id);
}

/** Source inputs remain a real destination; other legacy URLs resume quick work. */
export function hostQuickRedirectHref(project: ScriptProject, pathname: string, integrated: boolean): string | null {
  if (!integrated || !isQuickScriptProject(project)
    || pathname === projectSourceHref(project.id) || pathname === quickScriptHref(project.id)) return null;
  return hostScriptEntryHref(project, pathname, true);
}

export function quickSourceInputsLocked(project: ScriptProject): boolean {
  return isQuickScriptProject(project) && Boolean(project.episodes.length || project.quickWorkflow?.synopsis_confirmed
    || project.quickWorkflow?.plan_confirmed || project.quickWorkflow?.active_operation);
}
