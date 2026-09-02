import type {
  InputReadinessAnalysis,
  InputReadinessLevel,
  InputReadinessStage,
  ProjectDraft,
} from "./types.ts";

const LEVELS = new Set<InputReadinessLevel>([
  "premise",
  "story_bible",
  "episode_plan",
  "script",
]);

const STAGES = new Set<InputReadinessStage>([
  "story_bible",
  "planning",
  "script",
]);

export function buildInputReadinessRequest(draft: ProjectDraft) {
  return {
    creative_prompt: draft.creativePrompt.trim(),
    reference_materials: (draft.referenceMaterials ?? []).map((item) => ({
      file_name: item.fileName.slice(0, 240),
      purpose: item.purpose,
      purpose_note: item.purposeNote.trim(),
      extracted_text: item.extractedText,
    })),
    episode_count: draft.generationSettings.episodeCount,
  };
}

export function parseInputReadinessResponse(
  response: unknown,
  analyzedAt = new Date().toISOString(),
): InputReadinessAnalysis | null {
  if (!isRecord(response)) return null;
  const candidate = isRecord(response.data) ? response.data : response;
  const detectedLevel = candidate.detected_level;
  const recommendedStage = candidate.recommended_stage;
  if (
    candidate.schema_version !== "input_readiness.v1"
    || typeof detectedLevel !== "string"
    || !LEVELS.has(detectedLevel as InputReadinessLevel)
    || typeof recommendedStage !== "string"
    || !STAGES.has(recommendedStage as InputReadinessStage)
  ) {
    return null;
  }

  const coverage = isRecord(candidate.coverage) ? candidate.coverage : {};
  return {
    schemaVersion: "input_readiness.v1",
    detectedLevel: detectedLevel as InputReadinessLevel,
    recommendedStage: recommendedStage as InputReadinessStage,
    confidence: boundedNumber(candidate.confidence),
    coverage: {
      premise: boundedNumber(coverage.premise),
      storyBible: boundedNumber(coverage.story_bible),
      episodePlan: boundedNumber(coverage.episode_plan),
      script: boundedNumber(coverage.script),
    },
    missingItems: stringArray(candidate.missing_items),
    evidence: stringArray(candidate.evidence),
    requiresUserConfirmation: candidate.requires_user_confirmation !== false,
    analysisMethod: candidate.analysis_method === "model_assisted"
      ? "model_assisted"
      : "heuristic",
    analyzedAt,
  };
}

function boundedNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
