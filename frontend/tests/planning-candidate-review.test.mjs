import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("planning AI candidates stay in a review dialog instead of replacing the original view", async () => {
  const storyBible = await source("components/story-bible-panel.tsx");
  const storyNode = await source("components/story-plan-node-panel.tsx");

  assert.doesNotMatch(storyBible, /aiCandidate\s*\?\?\s*storyBible/);
  assert.doesNotMatch(storyNode, /aiCandidate\s*\?\?\s*node/);
  assert.match(storyBible, /<CandidateReviewDialog[\s\S]*<StoryBibleCandidatePreview/);
  assert.match(storyNode, /<CandidateReviewDialog[\s\S]*<StoryPlanNodeCandidatePreview/);
  assert.doesNotMatch(storyBible, /candidate-decision-bar/);
  assert.doesNotMatch(storyNode, /candidate-decision-bar/);
});

test("planning candidates update local state only after the confirmed save succeeds", async () => {
  const storyBible = await source("components/story-bible-panel.tsx");
  const storyNode = await source("components/story-plan-node-panel.tsx");

  assert.match(
    storyBible,
    /const saved = await saveStoryBibleDraft\(aiCandidate\);[\s\S]*setStoryBible\(saved\);/,
  );
  assert.match(
    storyNode,
    /const saved = await saveStoryPlanNodeDraft\(candidate, descendantPolicy\);[\s\S]*setNode\(saved\);/,
  );
  assert.match(storyBible, /error=\{message \?\? undefined\}/);
  assert.match(storyNode, /error=\{message \?\? undefined\}/);
});

test("candidate review uses a wide, scrollable modal with persistent actions", async () => {
  const dialog = await source("components/candidate-review-dialog.tsx");
  const styles = await source("app/globals.css");

  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /role="alert"/);
  assert.match(dialog, /candidate-review-content/);
  assert.match(dialog, /candidate-review-actions/);
  assert.match(styles, /\.candidate-review-dialog\s*\{[\s\S]*width:\s*min\(920px,/);
  assert.match(styles, /\.candidate-review-content\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(styles, /\.candidate-review-dialog\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/);
});
