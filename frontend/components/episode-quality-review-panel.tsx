"use client";

import {
  Check,
  ChevronDown,
  CircleAlert,
  Gauge,
  MessageSquareText,
  Route,
  ShieldCheck,
} from "lucide-react";

import {
  episodeQualityReview,
  type EpisodeQualityMetricRange,
  type EpisodeQualityReview,
} from "@/lib/episode-quality-review";
import type { GeneratedDraft } from "@/lib/types";

type Translator = (key: string) => string;

const REVIEW_REASON_KEYS: Record<string, string> = {
  dramatic_unit_evidence_missing: "workspace.qualityReview.reason.dramaticUnit",
  protagonist_cost_evidence_missing: "workspace.qualityReview.reason.protagonistCost",
  visible_scene_change_missing: "workspace.qualityReview.reason.visibleChange",
  production_count_out_of_range: "workspace.qualityReview.reason.productionCount",
  dialogue_function_warning: "workspace.qualityReview.reason.dialogueFunction",
  segmented_change_evidence_missing: "workspace.qualityReview.reason.segments",
};

const DIALOGUE_CATEGORY_KEYS: Record<string, string> = {
  threat: "workspace.qualityReview.dialogue.threat",
  correction: "workspace.qualityReview.dialogue.correction",
  refusal: "workspace.qualityReview.dialogue.refusal",
  admission: "workspace.qualityReview.dialogue.admission",
  lie: "workspace.qualityReview.dialogue.lie",
  bargain: "workspace.qualityReview.dialogue.bargain",
  request: "workspace.qualityReview.dialogue.request",
  probe: "workspace.qualityReview.dialogue.probe",
  deflection: "workspace.qualityReview.dialogue.deflection",
  silence: "workspace.qualityReview.dialogue.silence",
  misread: "workspace.qualityReview.dialogue.misread",
};

function reasonLabel(reason: string, t: Translator): string {
  return t(REVIEW_REASON_KEYS[reason] ?? "workspace.qualityReview.reason.other");
}

function dialogueCategoryLabel(category: string, t: Translator): string {
  return t(DIALOGUE_CATEGORY_KEYS[category] ?? "workspace.qualityReview.dialogue.other");
}

function sceneNumbersLabel(sceneNumbers: number[], t: Translator): string {
  return sceneNumbers.length
    ? t("workspace.qualityReview.scenes").replace("{scenes}", sceneNumbers.join("、"))
    : t("workspace.qualityReview.noSceneCandidate");
}

function QualityMetric({
  label,
  metric,
  suffix = "",
  t,
}: {
  label: string;
  metric: EpisodeQualityMetricRange;
  suffix?: string;
  t: Translator;
}) {
  return (
    <div className={metric.warning ? "is-warning" : "is-ready"}>
      <dt>{label}</dt>
      <dd>{metric.value}{suffix}</dd>
      <small>
        {t("workspace.qualityReview.range")
          .replace("{minimum}", String(metric.minimum))
          .replace("{maximum}", String(metric.maximum))}
      </small>
    </div>
  );
}

function QualityStatusIcon({ ready }: { ready: boolean }) {
  return ready
    ? <Check aria-hidden="true" size={13} />
    : <CircleAlert aria-hidden="true" size={13} />;
}

function DesignEvidence({
  review,
  t,
}: {
  review: EpisodeQualityReview;
  t: Translator;
}) {
  if (review.designEvidenceStatus === "not_applicable") {
    return <p className="episode-quality-empty">{t("workspace.qualityReview.designNotProvided")}</p>;
  }
  return (
    <div className="episode-quality-design">
      <div className="episode-quality-design-summary">
        <span>
          {t("workspace.qualityReview.designUnits")
            .replace("{candidate}", String(review.candidateUnitCount))
            .replace("{total}", String(review.dramaticUnitCount))}
        </span>
        <span className={`is-${review.protagonistCostReview.status}`}>
          {review.protagonistCostReview.status === "candidate_found"
            ? t("workspace.qualityReview.costCandidate")
            : review.protagonistCostReview.status === "review_required"
              ? t("workspace.qualityReview.costReview")
              : t("workspace.qualityReview.costNotProvided")}
        </span>
      </div>
      {review.unitReviews.length ? (
        <ol className="episode-quality-unit-list">
          {review.unitReviews.map((unit) => (
            <li className={`is-${unit.status}`} key={unit.unitIndex}>
              <div>
                <strong>
                  {t("workspace.qualityReview.unit")
                    .replace("{number}", String(unit.unitIndex + 1))}
                </strong>
                <span>
                  <QualityStatusIcon ready={unit.status === "candidate_found"} />
                  {unit.status === "candidate_found"
                    ? t("workspace.qualityReview.evidenceCandidate")
                    : t("workspace.qualityReview.needsReview")}
                </span>
              </div>
              <p>{unit.choice}</p>
              <p>{unit.visibleConsequence}</p>
              <small>{sceneNumbersLabel(unit.candidateSceneNumbers, t)}</small>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function EpisodeQualityReviewPanel({
  draft,
  stale = false,
  t,
}: {
  draft: GeneratedDraft;
  stale?: boolean;
  t: Translator;
}) {
  const review = episodeQualityReview(draft);
  if (!review) return null;
  const ready = review.status === "review_signal_ready" && !stale;
  const warningCount = review.reviewReasons.length;
  const production = review.productionCountReview;
  const dialogue = review.dialogueFunctionReview;
  const segments = review.segmentedChangeReview.segments;

  return (
    <details className={`episode-quality-review is-${ready ? "ready" : "review"}${stale ? " is-stale" : ""}`}>
      <summary>
        <span className="episode-quality-review-icon">
          {ready
            ? <ShieldCheck aria-hidden="true" size={17} />
            : <CircleAlert aria-hidden="true" size={17} />}
        </span>
        <span className="episode-quality-review-heading">
          <strong>{t("workspace.qualityReview.title")}</strong>
          <small>
            {stale
              ? t("workspace.qualityReview.staleSummary")
              : ready
                ? t("workspace.qualityReview.readySummary")
                : t("workspace.qualityReview.reviewSummary")
                    .replace("{count}", String(warningCount))}
          </small>
        </span>
        <span className="episode-quality-review-state">
          {ready
            ? t("workspace.qualityReview.ready")
            : t("workspace.qualityReview.review")}
        </span>
        <ChevronDown aria-hidden="true" className="episode-quality-review-chevron" size={16} />
      </summary>

      <div className="episode-quality-review-body">
        {stale ? (
          <div className="episode-quality-stale" role="status">
            <CircleAlert aria-hidden="true" size={14} />
            {t("workspace.qualityReview.stale")}
          </div>
        ) : null}

        {review.reviewReasons.length ? (
          <ul className="episode-quality-reasons">
            {review.reviewReasons.map((reason) => (
              <li key={reason}>
                <CircleAlert aria-hidden="true" size={13} />
                <span>{reasonLabel(reason, t)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="episode-quality-ready-copy">
            <Check aria-hidden="true" size={14} />
            {t("workspace.qualityReview.noWarnings")}
          </div>
        )}

        <section className="episode-quality-section">
          <h4><Gauge aria-hidden="true" size={14} />{t("workspace.qualityReview.production")}</h4>
          <dl className="episode-quality-metrics">
            <QualityMetric label={t("workspace.qualityReview.metric.scenes")} metric={production.sceneCount} t={t} />
            <QualityMetric label={t("workspace.qualityReview.metric.dialogue")} metric={production.dialogueLineCount} t={t} />
            <QualityMetric label={t("workspace.qualityReview.metric.actions")} metric={production.observableActionUnitCount} t={t} />
            <QualityMetric label={t("workspace.qualityReview.metric.duration")} metric={production.estimatedDurationSeconds} suffix={t("workspace.qualityReview.seconds")} t={t} />
          </dl>
        </section>

        <section className="episode-quality-section">
          <h4><MessageSquareText aria-hidden="true" size={14} />{t("workspace.qualityReview.dialogue")}</h4>
          <div className="episode-quality-dialogue-summary">
            <strong>
              {t("workspace.qualityReview.dialogueCoverage")
                .replace("{classified}", String(dialogue.classifiedLineCount))
                .replace("{total}", String(dialogue.lineCount))}
            </strong>
            <span>
              {dialogue.coveredCategories.length
                ? dialogue.coveredCategories
                    .map((category) => dialogueCategoryLabel(category, t))
                    .join("、")
                : t("workspace.qualityReview.dialogueNoCandidates")}
            </span>
          </div>
          {dialogue.repeatedRuns.length ? (
            <ul className="episode-quality-dialogue-runs">
              {dialogue.repeatedRuns.map((run, index) => (
                <li key={`${run.category}-${index}`}>
                  <CircleAlert aria-hidden="true" size={12} />
                  <span>
                    {t("workspace.qualityReview.dialogueRun")
                      .replace("{category}", dialogueCategoryLabel(run.category, t))
                      .replace("{count}", String(run.lineCount))}
                    {` · ${sceneNumbersLabel(run.sceneNumbers, t)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="episode-quality-section">
          <h4><Route aria-hidden="true" size={14} />{t("workspace.qualityReview.segments")}</h4>
          <div className="episode-quality-segments">
            {segments.map((segment) => {
              const segmentReady = segment.status === "evidence_candidate";
              return (
                <div className={segmentReady ? "is-ready" : "is-warning"} key={segment.name}>
                  <span>
                    <QualityStatusIcon ready={segmentReady} />
                    {t(`workspace.qualityReview.segment.${segment.name}`)}
                  </span>
                  <small>
                    {segmentReady
                      ? t("workspace.qualityReview.evidenceCandidate")
                      : t("workspace.qualityReview.needsReview")}
                  </small>
                </div>
              );
            })}
          </div>
        </section>

        <section className="episode-quality-section">
          <h4><ShieldCheck aria-hidden="true" size={14} />{t("workspace.qualityReview.design")}</h4>
          <DesignEvidence review={review} t={t} />
        </section>

        <footer>{t("workspace.qualityReview.advisory")}</footer>
      </div>
    </details>
  );
}
