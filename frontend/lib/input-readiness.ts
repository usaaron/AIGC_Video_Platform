import {
  type InputReadinessAnalysis,
  type InputReadinessCapacityStatus,
  type InputReadinessLevel,
  type InputReadinessSourceKind,
  type InputReadinessStage,
  type InputSourceFact,
  type InputEpisodeAudit,
  type ProjectDraft,
} from "./types.ts";
import { declaredEpisodeCountFromDocument } from "./input-import-adapter.ts";
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
  return declaredEpisodeCountFromDocument(source);
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
  if (candidate.assessment_version === 2) {
    parsed.assessmentVersion = 2;
    parsed.knownFacts = parseSourceFacts(candidate.known_facts);
    parsed.episodeAudit = parseEpisodeAudit(candidate.episode_audit);
    parsed.structurallyComplete = candidate.structurally_complete === true;
    parsed.analysisNotice = typeof candidate.analysis_notice === "string" ? candidate.analysis_notice : null;
  }
  return parsed;
}

const FACT_FIELDS = new Set(["story_promise", "protagonist_and_goal", "core_obstacle", "stakes",
  "relationship_direction", "reveal_or_twist", "ending_direction", "tone_and_pacing", "world_setting"]);

function parseSourceFacts(value: unknown): InputSourceFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): InputSourceFact[] => {
    if (!isRecord(item) || typeof item.field !== "string" || !FACT_FIELDS.has(item.field)
      || typeof item.source_id !== "string" || typeof item.source_name !== "string"
      || typeof item.quote !== "string" || !item.quote.trim()
      || !Number.isInteger(item.start) || !Number.isInteger(item.end)
      || Number(item.start) < 0 || Number(item.end) <= Number(item.start)) return [];
    return [{ field: item.field as InputSourceFact["field"], sourceId: item.source_id,
      sourceName: item.source_name, quote: item.quote, start: Number(item.start), end: Number(item.end) }];
  }).slice(0, 24);
}

function parseEpisodeAudit(value: unknown): InputEpisodeAudit | null {
  if (!isRecord(value) || !Number.isInteger(value.target_count) || Number(value.target_count) < 1 || Number(value.target_count) > 2000) return null;
  const numbers = (list: unknown): number[] => Array.isArray(list)
    ? [...new Set(list.filter((n): n is number => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 2000))].sort((a, b) => a - b) : [];
  return { targetCount: Number(value.target_count), suppliedNumbers: numbers(value.supplied_numbers),
    completePlanNumbers: numbers(value.complete_plan_numbers), scriptNumbers: numbers(value.script_numbers),
    missingNumbers: numbers(value.missing_numbers), incompleteNumbers: numbers(value.incomplete_numbers),
    duplicateNumbers: numbers(value.duplicate_numbers), outOfRangeNumbers: numbers(value.out_of_range_numbers),
    unnumberedScript: value.unnumbered_script === true };
}

export function verifiedInputFacts(analysis: InputReadinessAnalysis | undefined, source: Pick<ProjectDraft, "creativePrompt" | "referenceMaterials">): InputSourceFact[] {
  return (analysis?.knownFacts ?? []).filter((fact) => {
    const match = /^reference_(\d+)$/.exec(fact.sourceId);
    const document = fact.sourceId === "creative_prompt" ? source.creativePrompt.trim()
      : match ? source.referenceMaterials[Number(match[1]) - 1]?.extractedText.trim() : undefined;
    // Python source offsets count code points; JS strings use UTF-16 units.
    return document !== undefined && [...document].slice(fact.start, fact.end).join("") === fact.quote;
  });
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
  if (value === "not_estimated") return value;
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
