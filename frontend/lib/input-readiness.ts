import {
  type InputReadinessAnalysis,
  type InputReadinessCapacityStatus,
  type InputReadinessLevel,
  type InputReadinessSourceKind,
  type InputReadinessStage,
  type ProjectDraft,
} from "./types.ts";
import { referenceMaterialsForApi } from "./reference-materials.ts";

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

/**
 * Quickly infer an episode count from headings already present in the input.
 * This mirrors the server's heading vocabulary so the count can be filled
 * before the user submits the (slower) readiness analysis request.
 */
export function detectEpisodeCountFromCreativeInput(
  draft: Pick<ProjectDraft, "creativePrompt" | "referenceMaterials">,
): number | null {
  const source = [
    draft.creativePrompt,
    ...draft.referenceMaterials.map((material) => material.extractedText),
  ].join("\n");
  const headingPattern = /(?:^\s*(?:#{1,6}\s*)?(?:第\s*0*(\d{1,4})\s*集|episode\s*0*(\d{1,4})\b|ep\.?\s*0*(\d{1,4})\b))/gim;
  const episodeNumbers = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(source)) !== null) {
    const episodeNumber = Number(match[1] ?? match[2] ?? match[3]);
    if (Number.isInteger(episodeNumber) && episodeNumber >= 1 && episodeNumber <= 2_000) {
      episodeNumbers.add(episodeNumber);
    }
  }
  return episodeNumbers.size > 0 ? episodeNumbers.size : null;
}

export function buildInputReadinessRequest(draft: ProjectDraft) {
  return {
    creative_prompt: draft.creativePrompt.trim(),
    reference_materials: referenceMaterialsForApi(draft.referenceMaterials),
    episode_count: draft.generationSettings.episodeCount,
    target_total_characters: draft.generationSettings.targetTotalCharacters,
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
  const parsed: InputReadinessAnalysis = {
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
  if (
    "detected_episode_count" in candidate
    || "source_character_count" in candidate
    || "estimated_supported_characters" in candidate
    || "capacity_status" in candidate
    || "recommended_target_total_characters" in candidate
    || "source_kinds" in candidate
    || "supplement_questions" in candidate
  ) {
    parsed.detectedEpisodeCount = nullableInteger(candidate.detected_episode_count);
    parsed.sourceCharacterCount = integerNumber(candidate.source_character_count);
    parsed.sourceKinds = sourceKinds(candidate.source_kinds);
    parsed.estimatedSupportedCharacters = integerNumber(candidate.estimated_supported_characters);
    parsed.capacityStatus = capacityStatus(candidate.capacity_status);
    parsed.recommendedTargetTotalCharacters = nullableInteger(candidate.recommended_target_total_characters);
    parsed.supplementQuestions = stringArray(candidate.supplement_questions);
  }
  return parsed;
}

function boundedNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function integerNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return integerNumber(value);
}

function capacityStatus(value: unknown): InputReadinessCapacityStatus {
  if (value === "supplement_recommended" || value === "target_reduce_recommended") {
    return value;
  }
  return "sufficient";
}

function sourceKinds(value: unknown): InputReadinessSourceKind[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<InputReadinessSourceKind>([
    "premise", "story_bible", "episode_plan", "script", "mixed",
  ]);
  return value.filter((item): item is InputReadinessSourceKind => (
    typeof item === "string" && allowed.has(item as InputReadinessSourceKind)
  ));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
