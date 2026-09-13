import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { episodeQualityReview } from "../lib/episode-quality-review.ts";

const workspace = await readFile(
  new URL("../components/script-workspace.tsx", import.meta.url),
  "utf8",
);

function draftWithReview(overrides = {}) {
  return {
    llm_metadata: {
      episode_quality_review: {
        schema_version: "episode_quality_review.v1",
        status: "review_required",
        review_reasons: ["production_count_out_of_range"],
        design_evidence_status: "review_signal_ready",
        dramatic_unit_count: 1,
        candidate_unit_count: 1,
        review_required_unit_count: 0,
        protagonist_cost_review: {
          planned_cost: "林夏失去匿名身份。",
          candidate_scene_numbers: [2],
          status: "candidate_found",
        },
        unit_reviews: [{
          unit_index: 0,
          choice: "林夏剪断门锁。",
          visible_consequence: "警报暴露她的位置。",
          candidate_scene_numbers: [1, 2],
          status: "candidate_found",
        }],
        production_count_review: {
          status: "warning",
          metrics: {
            scene_count: 2,
            dialogue_line_count: 24,
            observable_action_unit_count: 16,
            estimated_duration_seconds: 91,
          },
          bounds: {
            scene_count: { minimum: 1, maximum: 5 },
            dialogue_line_count: { minimum: 25, maximum: 35 },
            observable_action_unit_count: { minimum: 15, maximum: 20 },
            estimated_duration_seconds: { minimum: 75, maximum: 115 },
          },
          alerts: [{ metric: "dialogue_line_count", severity: "warning" }],
        },
        dialogue_function_review: {
          status: "warning",
          line_count: 24,
          classified_line_count: 18,
          classified_line_ratio: 0.75,
          covered_categories: ["request", "refusal"],
          repeated_runs: [{
            category: "refusal",
            line_count: 4,
            scene_numbers: [1],
          }],
        },
        segmented_change_review: {
          status: "review_required",
          body_entry_count: 40,
          segments: [{
            name: "opening",
            status: "evidence_candidate",
            scene_numbers: [1],
            candidate_unit_indices: [0],
            has_action: true,
            has_scene_exit_outcome_candidate: false,
          }, {
            name: "exit",
            status: "review_required",
            scene_numbers: [2],
            candidate_unit_indices: [],
            has_action: true,
            has_scene_exit_outcome_candidate: false,
          }],
        },
        limitations: ["仅用于编导审阅。"],
        ...overrides,
      },
    },
  };
}

test("episode quality metadata is parsed into a bounded UI model", () => {
  const review = episodeQualityReview(draftWithReview());

  assert.ok(review);
  assert.equal(review.status, "review_required");
  assert.deepEqual(review.reviewReasons, ["production_count_out_of_range"]);
  assert.equal(review.productionCountReview.dialogueLineCount.value, 24);
  assert.equal(review.productionCountReview.dialogueLineCount.warning, true);
  assert.equal(review.productionCountReview.sceneCount.warning, false);
  assert.deepEqual(review.dialogueFunctionReview.coveredCategories, [
    "request",
    "refusal",
  ]);
  assert.equal(review.dialogueFunctionReview.repeatedRuns[0].lineCount, 4);
  assert.equal(review.unitReviews[0].status, "candidate_found");
  assert.deepEqual(review.segmentedChangeReview.segments.map((item) => item.name), [
    "opening",
    "exit",
  ]);
});

test("unknown or incomplete quality metadata stays hidden", () => {
  assert.equal(episodeQualityReview({ llm_metadata: {} }), null);
  assert.equal(episodeQualityReview(draftWithReview({
    schema_version: "episode_quality_review.v2",
  })), null);
  assert.equal(episodeQualityReview(draftWithReview({
    production_count_review: null,
  })), null);
});

test("the script surface shows quality signals and marks unsaved results stale", () => {
  assert.match(workspace, /<EpisodeQualityReviewPanel/);
  assert.match(
    workspace,
    /stale=\{selectedDocumentView === "current" && currentEpisodeHasDirectEdits\}/,
  );
});
