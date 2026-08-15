import {
  DEFAULT_GENERATION_SETTINGS,
  type GenerationSettings,
  type StoryDensity,
} from "./types.ts";

const MAX_EPISODES = 2000;
export const CLIENT_MIN_SERIES_RUNTIME_MINUTES = 100;
export const MIN_TARGET_TOTAL_CHARACTERS = 80_000;
export const MAX_TARGET_TOTAL_CHARACTERS = 200_000;
export const MIN_EPISODE_DURATION_SECONDS = 75;
export const MAX_EPISODE_DURATION_SECONDS = 115;

export const TARGET_BODY_SCALE_BANDS = [
  { id: "80k-120k", minCharacters: 80_000, maxCharacters: 120_000, referenceCharacters: 100_000 },
  { id: "120k-160k", minCharacters: 120_000, maxCharacters: 160_000, referenceCharacters: 140_000 },
  { id: "160k-200k", minCharacters: 160_000, maxCharacters: 200_000, referenceCharacters: 180_000 },
] as const;

export type TargetBodyScaleBand = (typeof TARGET_BODY_SCALE_BANDS)[number];

const ESTIMATED_CHARACTERS_PER_MINUTE: Record<StoryDensity, number> = {
  compact: 1_000,
  balanced: 1_200,
  detailed: 1_400,
};

export function targetBodyScaleBand(totalCharacters: number): TargetBodyScaleBand {
  const normalized = clampInteger(
    totalCharacters,
    MIN_TARGET_TOTAL_CHARACTERS,
    MAX_TARGET_TOTAL_CHARACTERS,
  );
  return TARGET_BODY_SCALE_BANDS.find((band, index) => (
    normalized >= band.minCharacters
    && (normalized < band.maxCharacters || index === TARGET_BODY_SCALE_BANDS.length - 1)
  )) ?? TARGET_BODY_SCALE_BANDS[TARGET_BODY_SCALE_BANDS.length - 1];
}

export function recommendEpisodeCountRange(settings: Pick<
  GenerationSettings,
  "targetTotalCharacters" | "preferredEpisodeDurationMinutes" | "storyDensity"
>): { minEpisodes: number; maxEpisodes: number } {
  const band = targetBodyScaleBand(settings.targetTotalCharacters);
  const durationMinutes = normalizeShortDramaDuration(
    settings.preferredEpisodeDurationMinutes,
  );
  const estimatedEpisodeCharacters = Math.max(
    1,
    Math.round(durationMinutes * ESTIMATED_CHARACTERS_PER_MINUTE[settings.storyDensity]),
  );
  const minimumRuntimeEpisodes = minimumEpisodesForSeriesRuntime(durationMinutes);
  return {
    minEpisodes: clampInteger(Math.max(
      minimumRuntimeEpisodes,
      Math.ceil(band.minCharacters / estimatedEpisodeCharacters),
    ), 1, MAX_EPISODES),
    maxEpisodes: clampInteger(Math.max(
      minimumRuntimeEpisodes,
      Math.ceil(band.maxCharacters / estimatedEpisodeCharacters),
    ), 1, MAX_EPISODES),
  };
}

export function recommendEpisodeCount(settings: Pick<
  GenerationSettings,
  "targetTotalCharacters" | "preferredEpisodeDurationMinutes" | "storyDensity"
>): number {
  const totalCharacters = clampInteger(
    settings.targetTotalCharacters,
    MIN_TARGET_TOTAL_CHARACTERS,
    MAX_TARGET_TOTAL_CHARACTERS,
  );
  const durationMinutes = normalizeShortDramaDuration(
    settings.preferredEpisodeDurationMinutes,
  );
  const estimatedEpisodeCharacters = Math.max(
    1,
    Math.round(durationMinutes * ESTIMATED_CHARACTERS_PER_MINUTE[settings.storyDensity]),
  );
  return clampInteger(Math.max(
    minimumEpisodesForSeriesRuntime(durationMinutes),
    Math.ceil(totalCharacters / estimatedEpisodeCharacters),
  ), 1, MAX_EPISODES);
}

export function minimumEpisodesForSeriesRuntime(durationMinutes: number): number {
  return clampInteger(
    Math.ceil(CLIENT_MIN_SERIES_RUNTIME_MINUTES / normalizeShortDramaDuration(durationMinutes)),
    1,
    MAX_EPISODES,
  );
}

export function plannedSeriesRuntime(settings: Pick<
  GenerationSettings,
  "episodeCount" | "preferredEpisodeDurationMinutes"
>): { minutes: number; minimumEpisodes: number; meetsClientMinimum: boolean } {
  const durationMinutes = normalizeShortDramaDuration(settings.preferredEpisodeDurationMinutes);
  const episodeCount = clampInteger(settings.episodeCount, 1, MAX_EPISODES);
  const minimumEpisodes = minimumEpisodesForSeriesRuntime(durationMinutes);
  return {
    minutes: Math.round(episodeCount * durationMinutes * 10) / 10,
    minimumEpisodes,
    meetsClientMinimum: episodeCount >= minimumEpisodes,
  };
}

export function normalizeGenerationSettings(
  settings?: Partial<GenerationSettings>,
  _options: { legacy?: boolean } = {},
): GenerationSettings {
  const merged: GenerationSettings = {
    ...DEFAULT_GENERATION_SETTINGS,
    ...settings,
    // Sequential/full is no longer a creator choice. Runtime generation consumes
    // approved episode-ready leaves one episode at a time.
    mode: "full",
    episodeCountMode: "custom",
    // Infrastructure retries are mandatory and bounded. Persisted legacy
    // "manual" values must not disable recovery from network/provider faults.
    failureRetryMode: "automatic",
  };
  const normalized = {
    ...merged,
    targetTotalCharacters: clampInteger(
      merged.targetTotalCharacters,
      MIN_TARGET_TOTAL_CHARACTERS,
      MAX_TARGET_TOTAL_CHARACTERS,
    ),
    preferredEpisodeDurationMinutes: normalizeShortDramaDuration(
      merged.preferredEpisodeDurationMinutes,
    ),
    batchSize: clampInteger(merged.batchSize, 8, 12),
    sceneCount: clampInteger(merged.sceneCount, 2, 8),
    episodeCount: clampInteger(merged.episodeCount, 1, MAX_EPISODES),
    releaseRegion: merged.releaseRegion === "overseas"
      ? "overseas" as const
      : "cn_mainland" as const,
  };
  return {
    ...normalized,
    // A short or legacy project can contain fewer episodes than the normal
    // 8-12 episode execution batch. The persistence contract requires the
    // batch size to remain inside the project boundary.
    batchSize: Math.min(normalized.batchSize, normalized.episodeCount),
  };
}

export function nextBatchRange(
  generatedEpisodeCount: number,
  settings: GenerationSettings,
  _progress: { generatedBodyCharacters?: number } = {},
): { startEpisode: number; endEpisode: number; totalEpisodes: number } | null {
  // Once the story tree is planned, its episode boundary wins. The total-character
  // setting describes scale and must not silently add episodes to hit an exact sum.
  const totalEpisodes = settings.episodeCount;
  const startEpisode = generatedEpisodeCount + 1;
  if (startEpisode > totalEpisodes) return null;
  const remainingEpisodes = totalEpisodes - startEpisode + 1;
  const requestedCount = adaptiveExecutionBatchSize(
    remainingEpisodes,
    settings.batchSize,
  );
  return {
    startEpisode,
    endEpisode: Math.min(totalEpisodes, startEpisode + requestedCount - 1),
    totalEpisodes,
  };
}

export type LeafBatchDecision =
  | {
      status: "ready";
      range: { startEpisode: number; endEpisode: number; totalEpisodes: number };
    }
  | { status: "gap"; nextEpisode: number }
  | { status: "complete" };

export function nextLeafBatchRange(
  generatedEpisodeCount: number,
  settings: GenerationSettings,
  leafRange: { startEpisode: number; endEpisode: number },
  progress: { generatedBodyCharacters?: number } = {},
): LeafBatchDecision {
  const nextRange = nextBatchRange(generatedEpisodeCount, settings, progress);
  if (!nextRange || nextRange.startEpisode > leafRange.endEpisode) {
    return { status: "complete" };
  }
  if (nextRange.startEpisode < leafRange.startEpisode) {
    return { status: "gap", nextEpisode: nextRange.startEpisode };
  }
  const boundedLeafEnd = Math.min(leafRange.endEpisode, nextRange.totalEpisodes);
  const remainingLeafEpisodes = boundedLeafEnd - nextRange.startEpisode + 1;
  const requestedCount = adaptiveExecutionBatchSize(
    remainingLeafEpisodes,
    settings.batchSize,
  );
  return {
    status: "ready",
    range: {
      ...nextRange,
      // Narrative leaf size and operational execution size are independent. Keep
      // the story segment intact while processing it through balanced, resumable
      // groups of independent episode requests.
      endEpisode: nextRange.startEpisode + requestedCount - 1,
    },
  };
}

export function adaptiveExecutionBatchSize(
  remainingEpisodes: number,
  preferredEpisodes = 10,
): number {
  const remaining = Math.max(1, Math.round(remainingEpisodes));
  if (remaining <= 14) return remaining;
  const preferred = clampInteger(preferredEpisodes, 8, 12);
  const minimumBatchCount = Math.ceil(remaining / 14);
  const maximumBatchCount = Math.max(minimumBatchCount, Math.floor(remaining / 6));
  let batchCount = minimumBatchCount;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let candidate = minimumBatchCount; candidate <= maximumBatchCount; candidate += 1) {
    const distance = Math.abs(remaining / candidate - preferred);
    if (distance < closestDistance) {
      closestDistance = distance;
      batchCount = candidate;
    }
  }
  return clampInteger(Math.ceil(remaining / batchCount), 6, 14);
}

export function targetScriptBodyCharacters(
  settings: Pick<
    GenerationSettings,
    | "targetTotalCharacters"
    | "episodeCount"
    | "preferredEpisodeDurationMinutes"
    | "storyDensity"
  >,
  progress: {
    generatedEpisodeCount?: number;
    generatedBodyCharacters?: number;
  } = {},
): number {
  const totalEpisodes = Math.max(1, settings.episodeCount);
  const durationBaseline = normalizeShortDramaDuration(
    settings.preferredEpisodeDurationMinutes,
  ) * ESTIMATED_CHARACTERS_PER_MINUTE[settings.storyDensity];
  const seriesBaseline = settings.targetTotalCharacters / totalEpisodes;
  const plotScaleBaseline = Math.sqrt(durationBaseline * seriesBaseline);
  const generatedEpisodes = Math.max(0, progress.generatedEpisodeCount ?? 0);
  const generatedCharacters = Math.max(0, progress.generatedBodyCharacters ?? 0);
  if (generatedEpisodes < 3 || generatedCharacters <= 0) {
    return clampInteger(Math.ceil(plotScaleBaseline), 600, 2_400);
  }

  const observedAverage = generatedCharacters / generatedEpisodes;
  const remainingEpisodes = Math.max(0, totalEpisodes - generatedEpisodes);
  const projectedTotal = generatedCharacters + observedAverage * remainingEpisodes;
  if (projectedTotal <= 0) {
    return clampInteger(Math.ceil(plotScaleBaseline), 600, 2_400);
  }

  // Keep the series near its intended scale without turning later episodes into
  // exact-quota compensation. Correction is confidence-weighted and capped at 15%.
  const rawCorrection = Math.sqrt(settings.targetTotalCharacters / projectedTotal);
  const boundedCorrection = clampNumber(rawCorrection, 0.85, 1.15);
  const confidence = Math.min(1, generatedEpisodes / 12);
  const appliedCorrection = 1 + (boundedCorrection - 1) * confidence;
  return clampInteger(Math.ceil(plotScaleBaseline * appliedCorrection), 600, 2_400);
}

export interface ScriptBodyLengthGuidance {
  referenceCharacters: number;
  preferredMinCharacters: number;
  preferredMaxCharacters: number;
  truncationFloorCharacters: number;
}

export function scriptBodyLengthGuidance(
  referenceCharacters: number,
): ScriptBodyLengthGuidance {
  const reference = Math.max(1, Math.round(referenceCharacters));
  return {
    referenceCharacters: reference,
    preferredMinCharacters: Math.max(1, Math.round(reference * 0.70)),
    preferredMaxCharacters: Math.max(1, Math.round(reference * 1.40)),
    truncationFloorCharacters: Math.max(1, Math.round(reference * 0.25)),
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

function normalizeShortDramaDuration(value: number): number {
  const seconds = value * 60;
  if (
    !Number.isFinite(seconds)
    || seconds < MIN_EPISODE_DURATION_SECONDS
    || seconds > MAX_EPISODE_DURATION_SECONDS
  ) {
    return DEFAULT_GENERATION_SETTINGS.preferredEpisodeDurationMinutes;
  }
  return Math.round(seconds) / 60;
}

export function normalizeEpisodeDurationSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return Math.round(DEFAULT_GENERATION_SETTINGS.preferredEpisodeDurationMinutes * 60);
  }
  return Math.min(
    MAX_EPISODE_DURATION_SECONDS,
    Math.max(MIN_EPISODE_DURATION_SECONDS, Math.round(value)),
  );
}
