import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

function dialogueDiagnosticDraft(status = "warning") {
  const draft = draftWithReview();
  const raw = draft.llm_metadata.episode_quality_review;
  raw.review_reasons = status === "warning" ? ["dialogue_function_warning"] : [];
  raw.status = status === "warning" ? "review_required" : "review_signal_ready";
  raw.production_count_review.status = "within_range";
  raw.production_count_review.metrics.dialogue_line_count = 28;
  raw.production_count_review.alerts = [];
  raw.dialogue_function_review.status = status;
  raw.dialogue_function_review.line_count = 28;
  raw.dialogue_function_review.classified_line_count = 4;
  raw.dialogue_function_review.classified_line_ratio = 4 / 28;
  raw.segmented_change_review.status = "review_signal_ready";
  raw.segmented_change_review.segments.forEach(segment => { segment.status = "evidence_candidate"; });
  return draft;
}

for (const status of ["warning", "diagnostic_only"]) test(`${status} keyword statistics stay readable without requiring editorial repair`, () => {
  const draft = dialogueDiagnosticDraft(status);
  const persisted = JSON.parse(JSON.stringify(draft));
  const review = episodeQualityReview(persisted);
  assert.equal(review.status, "review_signal_ready");
  assert.deepEqual(review.reviewReasons, []);
  assert.equal(review.dialogueFunctionReview.status, "diagnostic_only");
  assert.equal(review.dialogueFunctionReview.classifiedLineCount, 4);
  assert.equal(review.dialogueFunctionReview.classifiedLineRatio, 4 / 28);
  assert.deepEqual(review.dialogueFunctionReview.coveredCategories, ["request", "refusal"]);
  assert.deepEqual(review.dialogueFunctionReview.repeatedRuns, [{category:"refusal",lineCount:4,sceneNumbers:[1]}]);
  assert.deepEqual(persisted, draft);
});

for (const reason of ["production_count_out_of_range", "continuity_fact_risk", "segmented_change_evidence_missing"]) {
  test(`removing legacy keyword warning preserves ${reason}`, () => {
    const draft = dialogueDiagnosticDraft();
    draft.llm_metadata.episode_quality_review.review_reasons.push(reason);
    const review = episodeQualityReview(draft);
    assert.equal(review.status, "review_required");
    assert.deepEqual(review.reviewReasons, [reason]);
  });
}

test("incomplete legacy reasons cannot hide nested count, duration or evidence warnings", () => {
  for (const update of [
    raw => { raw.production_count_review.status = "warning"; },
    raw => { raw.production_count_review.alerts = [{metric:"estimated_duration_seconds",severity:"warning"}]; },
    raw => { raw.design_evidence_status = "review_required"; },
    raw => { raw.protagonist_cost_review.status = "review_required"; },
    raw => { raw.unit_reviews[0].status = "review_required"; },
    raw => { raw.segmented_change_review.segments[0].status = "review_required"; },
  ]) {
    const draft = dialogueDiagnosticDraft();
    update(draft.llm_metadata.episode_quality_review);
    assert.equal(episodeQualityReview(draft).status, "review_required");
  }
  const draft = dialogueDiagnosticDraft();
  draft.llm_metadata.episode_quality_review.review_reasons = [];
  assert.equal(episodeQualityReview(draft).status, "review_required");
});

const componentCode = ts.transpileModule(await readFile(
  new URL("../components/episode-quality-review-panel.tsx", import.meta.url), "utf8",
), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX} }).outputText;
const componentModule = {exports:{}};
const runtimeRequire = createRequire(import.meta.url);
vm.runInNewContext(componentCode, {module:componentModule,exports:componentModule.exports,
  require:name => name === "@/lib/episode-quality-review" ? {episodeQualityReview} : runtimeRequire(name)});
const {EpisodeQualityReviewPanel} = componentModule.exports;

test("rendered legacy report uses neutral dialogue statistics without a warning badge", () => {
  const t = key => key === "workspace.qualityReview.dialogueRun" ? "{count} lines labeled {category}" : key;
  const html = renderToStaticMarkup(createElement(EpisodeQualityReviewPanel, {draft:dialogueDiagnosticDraft(),t}));
  assert.match(html, /episode-quality-review is-ready/);
  assert.match(html, /workspace.qualityReview.dialogueDiagnostic/);
  assert.match(html, /4 lines labeled workspace.qualityReview.dialogue.refusal/);
  assert.doesNotMatch(html, /lucide-circle-alert|workspace.qualityReview.reviewSummary|episode-quality-reasons/);
  const draft = draftWithReview();
  const warned = renderToStaticMarkup(createElement(EpisodeQualityReviewPanel, {draft,t}));
  assert.match(warned, /episode-quality-review is-review/);
  assert.match(warned, /workspace.qualityReview.reason.productionCount/);
  assert.match(warned, /lucide-circle-alert/);
});
