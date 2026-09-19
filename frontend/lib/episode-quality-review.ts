import { draftMetadata } from "./draft-metadata.ts";
import type { GeneratedDraft } from "./types.ts";

export type EpisodeQualityStatus = "review_required" | "review_signal_ready";
export type EpisodeDesignEvidenceStatus = EpisodeQualityStatus | "not_applicable";
export type EpisodeQualitySegmentName =
  | "opening"
  | "complication"
  | "decision"
  | "exit";

export interface EpisodeQualityMetricRange {
  value: number;
  minimum: number;
  maximum: number;
  warning: boolean;
}

export interface EpisodeQualityUnitReview {
  unitIndex: number;
  choice: string;
  visibleConsequence: string;
  candidateSceneNumbers: number[];
  status: "candidate_found" | "review_required";
}

export interface EpisodeQualityReview {
  schemaVersion: "episode_quality_review.v1";
  status: EpisodeQualityStatus;
  reviewReasons: string[];
  designEvidenceStatus: EpisodeDesignEvidenceStatus;
  dramaticUnitCount: number;
  candidateUnitCount: number;
  reviewRequiredUnitCount: number;
  protagonistCostReview: {
    plannedCost: string | null;
    candidateSceneNumbers: number[];
    status: "candidate_found" | "review_required" | "not_provided";
  };
  unitReviews: EpisodeQualityUnitReview[];
  productionCountReview: {
    status: "warning" | "within_range";
    sceneCount: EpisodeQualityMetricRange;
    dialogueLineCount: EpisodeQualityMetricRange;
    observableActionUnitCount: EpisodeQualityMetricRange;
    estimatedDurationSeconds: EpisodeQualityMetricRange;
  };
  dialogueFunctionReview: {
    status: "diagnostic_only";
    lineCount: number;
    classifiedLineCount: number;
    classifiedLineRatio: number;
    coveredCategories: string[];
    repeatedRuns: Array<{
      category: string;
      lineCount: number;
      sceneNumbers: number[];
    }>;
  };
  segmentedChangeReview: {
    status: EpisodeQualityStatus;
    bodyEntryCount: number;
    segments: Array<{
      name: EpisodeQualitySegmentName;
      status: "evidence_candidate" | "review_required";
      sceneNumbers: number[];
      candidateUnitIndices: number[];
      hasAction: boolean;
      hasSceneExitOutcomeCandidate: boolean;
    }>;
  };
  limitations: string[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeNumber(value: unknown): number {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : 0;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function integers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => Number.isSafeInteger(item) && item >= 0)
    : [];
}

function metricRange(
  metricName: string,
  metrics: UnknownRecord,
  bounds: UnknownRecord,
  warningMetrics: Set<string>,
): EpisodeQualityMetricRange | null {
  const range = record(bounds[metricName]);
  const value = finiteNumber(metrics[metricName]);
  const minimum = finiteNumber(range?.minimum);
  const maximum = finiteNumber(range?.maximum);
  if (value === null || minimum === null || maximum === null) return null;
  return {
    value,
    minimum,
    maximum,
    warning: warningMetrics.has(metricName),
  };
}

/** Parse the versioned diagnostic stored inside the intentionally open metadata map. */
export function episodeQualityReview(
  draft: GeneratedDraft,
): EpisodeQualityReview | null {
  const raw = record(draftMetadata(draft).episode_quality_review);
  if (raw?.schema_version !== "episode_quality_review.v1") return null;
  const storedStatus = raw.status === "review_required"
    ? "review_required"
    : raw.status === "review_signal_ready"
      ? "review_signal_ready"
      : null;
  const designEvidenceStatus = raw.design_evidence_status === "not_applicable"
    ? "not_applicable"
    : raw.design_evidence_status === "review_required"
      ? "review_required"
      : raw.design_evidence_status === "review_signal_ready"
        ? "review_signal_ready"
        : null;
  if (!storedStatus || !designEvidenceStatus) return null;

  const production = record(raw.production_count_review);
  const metrics = record(production?.metrics);
  const bounds = record(production?.bounds);
  if (!production || !metrics || !bounds) return null;
  const warningMetrics = new Set(
    (Array.isArray(production.alerts) ? production.alerts : [])
      .map((item) => record(item)?.metric)
      .filter((item): item is string => typeof item === "string"),
  );
  const sceneCount = metricRange("scene_count", metrics, bounds, warningMetrics);
  const dialogueLineCount = metricRange(
    "dialogue_line_count",
    metrics,
    bounds,
    warningMetrics,
  );
  const observableActionUnitCount = metricRange(
    "observable_action_unit_count",
    metrics,
    bounds,
    warningMetrics,
  );
  const estimatedDurationSeconds = metricRange(
    "estimated_duration_seconds",
    metrics,
    bounds,
    warningMetrics,
  );
  if (
    !sceneCount
    || !dialogueLineCount
    || !observableActionUnitCount
    || !estimatedDurationSeconds
  ) return null;

  const cost = record(raw.protagonist_cost_review) ?? {};
  const costStatus = cost.status === "candidate_found"
    ? "candidate_found"
    : cost.status === "review_required"
      ? "review_required"
      : "not_provided";
  const unitReviews = (Array.isArray(raw.unit_reviews) ? raw.unit_reviews : [])
    .map((value): EpisodeQualityUnitReview | null => {
      const unit = record(value);
      const unitIndex = finiteNumber(unit?.unit_index);
      const unitStatus = unit?.status === "candidate_found"
        ? "candidate_found"
        : unit?.status === "review_required"
          ? "review_required"
          : null;
      if (unitIndex === null || !unitStatus) return null;
      return {
        unitIndex,
        choice: typeof unit?.choice === "string" ? unit.choice : "",
        visibleConsequence: typeof unit?.visible_consequence === "string"
          ? unit.visible_consequence
          : "",
        candidateSceneNumbers: integers(unit?.candidate_scene_numbers),
        status: unitStatus,
      };
    })
    .filter((value): value is EpisodeQualityUnitReview => value !== null);

  const dialogue = record(raw.dialogue_function_review) ?? {};
  const repeatedRuns = (Array.isArray(dialogue.repeated_runs)
    ? dialogue.repeated_runs
    : [])
    .map((value) => record(value))
    .filter((value): value is UnknownRecord => value !== null)
    .map((run) => ({
      category: typeof run.category === "string" ? run.category : "other",
      lineCount: nonNegativeNumber(run.line_count),
      sceneNumbers: integers(run.scene_numbers),
    }));

  const segmented = record(raw.segmented_change_review) ?? {};
  const segments = (Array.isArray(segmented.segments) ? segmented.segments : [])
    .map((value) => record(value))
    .filter((value): value is UnknownRecord => value !== null)
    .map((segment) => {
      const name = ["opening", "complication", "decision", "exit"].includes(
        String(segment.name),
      )
        ? segment.name as EpisodeQualitySegmentName
        : null;
      const segmentStatus = segment.status === "evidence_candidate"
        ? "evidence_candidate"
        : segment.status === "review_required"
          ? "review_required"
          : null;
      if (!name || !segmentStatus) return null;
      return {
        name,
        status: segmentStatus,
        sceneNumbers: integers(segment.scene_numbers),
        candidateUnitIndices: integers(segment.candidate_unit_indices),
        hasAction: segment.has_action === true,
        hasSceneExitOutcomeCandidate:
          segment.has_scene_exit_outcome_candidate === true,
      };
    })
    .filter((value): value is EpisodeQualityReview["segmentedChangeReview"]["segments"][number] => (
      value !== null
    ));

  // Legacy keyword-only warnings are diagnostic too. Keep other saved risks,
  // including partial reports whose nested warnings lack a top-level reason.
  const storedReasons = strings(raw.review_reasons);
  const reviewReasons = storedReasons.filter((reason) => reason !== "dialogue_function_warning");
  const hasOtherReviewSignal = production.status === "warning"
    || warningMetrics.size > 0
    || designEvidenceStatus === "review_required"
    || costStatus === "review_required"
    || nonNegativeNumber(raw.review_required_unit_count) > 0
    || unitReviews.some((unit) => unit.status === "review_required")
    || segmented.status === "review_required"
    || segments.some((segment) => segment.status === "review_required");
  const status = storedStatus === "review_required"
    && storedReasons.includes("dialogue_function_warning")
    && reviewReasons.length === 0 && !hasOtherReviewSignal
    ? "review_signal_ready"
    : storedStatus;

  return {
    schemaVersion: "episode_quality_review.v1",
    status,
    reviewReasons,
    designEvidenceStatus,
    dramaticUnitCount: nonNegativeNumber(raw.dramatic_unit_count),
    candidateUnitCount: nonNegativeNumber(raw.candidate_unit_count),
    reviewRequiredUnitCount: nonNegativeNumber(raw.review_required_unit_count),
    protagonistCostReview: {
      plannedCost: typeof cost.planned_cost === "string" ? cost.planned_cost : null,
      candidateSceneNumbers: integers(cost.candidate_scene_numbers),
      status: costStatus,
    },
    unitReviews,
    productionCountReview: {
      status: production.status === "warning" ? "warning" : "within_range",
      sceneCount,
      dialogueLineCount,
      observableActionUnitCount,
      estimatedDurationSeconds,
    },
    dialogueFunctionReview: {
      status: "diagnostic_only",
      lineCount: nonNegativeNumber(dialogue.line_count),
      classifiedLineCount: nonNegativeNumber(dialogue.classified_line_count),
      classifiedLineRatio: nonNegativeNumber(dialogue.classified_line_ratio),
      coveredCategories: strings(dialogue.covered_categories),
      repeatedRuns,
    },
    segmentedChangeReview: {
      status: segmented.status === "review_required"
        ? "review_required"
        : "review_signal_ready",
      bodyEntryCount: nonNegativeNumber(segmented.body_entry_count),
      segments,
    },
    limitations: strings(raw.limitations),
  };
}
