import {
  DEFAULT_GENERATION_SETTINGS,
  type GenerationSettings,
  type StoryDensity,
} from "./types.ts";

const MAX_EPISODES = 2000;

const ESTIMATED_CHARACTERS_PER_MINUTE: Record<StoryDensity, number> = {
  compact: 450,
  balanced: 600,
  detailed: 750,
};

export function recommendEpisodeCount(settings: Pick<
  GenerationSettings,
  "targetTotalCharacters" | "preferredEpisodeDurationMinutes" | "storyDensity"
>): number {
  const totalCharacters = clampInteger(settings.targetTotalCharacters, 1000, 5_000_000);
  const durationMinutes = clampNumber(settings.preferredEpisodeDurationMinutes, 0.5, 30);
  const estimatedEpisodeCharacters = Math.max(
    1,
    Math.round(durationMinutes * ESTIMATED_CHARACTERS_PER_MINUTE[settings.storyDensity]),
  );
  return clampInteger(Math.ceil(totalCharacters / estimatedEpisodeCharacters), 1, MAX_EPISODES);
}

export function normalizeGenerationSettings(
  settings?: Partial<GenerationSettings>,
  options: { legacy?: boolean } = {},
): GenerationSettings {
  const merged: GenerationSettings = {
    ...DEFAULT_GENERATION_SETTINGS,
    ...settings,
    episodeCountMode: settings?.episodeCountMode
      ?? (options.legacy ? "custom" : DEFAULT_GENERATION_SETTINGS.episodeCountMode),
  };
  const normalized = {
    ...merged,
    targetTotalCharacters: clampInteger(merged.targetTotalCharacters, 1000, 5_000_000),
    preferredEpisodeDurationMinutes: clampNumber(
      merged.preferredEpisodeDurationMinutes,
      0.5,
      30,
    ),
    batchSize: clampInteger(merged.batchSize, 1, 20),
    sceneCount: clampInteger(merged.sceneCount, 2, 8),
    episodeCount: clampInteger(merged.episodeCount, 1, MAX_EPISODES),
  };
  return normalized.episodeCountMode === "recommended"
    ? { ...normalized, episodeCount: recommendEpisodeCount(normalized) }
    : normalized;
}

export function nextBatchRange(
  generatedEpisodeCount: number,
  settings: GenerationSettings,
  progress: { generatedBodyCharacters?: number } = {},
): { startEpisode: number; endEpisode: number; totalEpisodes: number } | null {
  const generatedBodyCharacters = Math.max(
    0,
    Math.round(progress.generatedBodyCharacters ?? 0),
  );
  if (
    settings.episodeCountMode === "recommended"
    && generatedEpisodeCount > 0
    && generatedBodyCharacters >= settings.targetTotalCharacters
  ) {
    return null;
  }

  const observedAverage = generatedEpisodeCount > 0
    ? generatedBodyCharacters / generatedEpisodeCount
    : 0;
  const observedEpisodesToTarget = observedAverage > 0
    ? Math.ceil(settings.targetTotalCharacters / observedAverage)
    : settings.episodeCount;
  const totalEpisodes = settings.episodeCountMode === "recommended"
    ? clampInteger(Math.max(settings.episodeCount, observedEpisodesToTarget), 1, MAX_EPISODES)
    : settings.episodeCount;
  const startEpisode = generatedEpisodeCount + 1;
  if (startEpisode > totalEpisodes) return null;
  const requestedCount = settings.mode === "sequential" ? 1 : settings.batchSize;
  return {
    startEpisode,
    endEpisode: Math.min(totalEpisodes, startEpisode + requestedCount - 1),
    totalEpisodes,
  };
}

export function targetScriptBodyCharacters(
  settings: Pick<GenerationSettings, "targetTotalCharacters" | "episodeCount">,
): number {
  return clampInteger(
    Math.ceil(settings.targetTotalCharacters / Math.max(1, settings.episodeCount)),
    300,
    10_000,
  );
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const normalized = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, normalized));
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  const normalized = Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, normalized));
}
