import {
  DEFAULT_GENERATION_SETTINGS,
  type GenerationSettings,
  type StoryDensity,
} from "@/lib/types";

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
): { startEpisode: number; endEpisode: number } | null {
  const startEpisode = generatedEpisodeCount + 1;
  if (startEpisode > settings.episodeCount) return null;
  const requestedCount = settings.mode === "sequential" ? 1 : settings.batchSize;
  return {
    startEpisode,
    endEpisode: Math.min(settings.episodeCount, startEpisode + requestedCount - 1),
  };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const normalized = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, normalized));
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  const normalized = Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, normalized));
}
