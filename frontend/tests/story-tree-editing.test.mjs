import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the recursive story tree has one resumable full-tree coordinator", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const coordinator = await source("lib/story-tree-expansion.ts");
  const background = await source("lib/story-planning-background.ts");

  assert.match(panel, /kind:\s*"full_tree"/);
  assert.match(panel, /runFullStoryTreeExpansion/);
  assert.match(coordinator, /const FULL_TREE_CONCURRENCY = 7/);
  assert.match(coordinator, /loadActiveStoryPlanNodes/);
  assert.match(coordinator, /onRoadmapCheckpoint/);
  assert.match(coordinator, /await Promise\.all\(workers\)/);
  assert.match(coordinator, /if \(firstFailure !== undefined\) throw firstFailure/);
  assert.match(coordinator, /const episodeReadyLeaves = activeNodes/);
  assert.match(coordinator, /for \(const leaf of episodeReadyLeaves\)/);
  assert.match(background, /"full_tree"/);
  assert.match(background, /FULL_TREE_RESERVED_SLOTS = 7/);
  assert.match(background, /const result = await task\.run\(\)/);
  assert.doesNotMatch(background, /generateWithFailurePolicy/);
});

test("parent revisions require an explicit descendant policy", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const client = await source("lib/story-planning-client.ts");

  assert.match(panel, /descendantDecisionKeep/);
  assert.match(panel, /descendantDecisionResplit/);
  assert.match(panel, /persistNode\([^)]*"rebase"\)/s);
  assert.match(panel, /persistNode\([^)]*"invalidate"\)/s);
  assert.match(panel, /aiCandidate && !descendantDecision/);
  assert.match(panel, /activeBranchInteractions\.size > 0/);
  assert.match(panel, /onInteractionChange=\{updateBranchInteraction\}/);
  assert.match(panel, /onClick=\{isEditing \? cancelEditing : startEditing\}/);
  assert.match(panel, /onRequestResplit\?\.\(\)/);
  assert.match(panel, /autoExpansionRequested/);
  assert.match(panel, /onRoadmapCheckpoint: async/);
  assert.match(panel, /await persistProjectUpdate/);
  assert.match(panel, /const branchLocked = operationLocked \|\| isEditing/);
  assert.match(panel, /if \(treeBusy \|\| isEditing \|\| decomposeTaskActive\) return/);
  assert.match(panel, /if \(treeBusy \|\| isEditing \|\| roadmapTaskActive\) return/);
  assert.match(client, /descendant_policy=\$\{descendantPolicy\}/);
});

test("each episode roadmap exposes manual and AI revision with candidate review", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const client = await source("lib/story-planning-client.ts");

  assert.match(panel, /storyPlanNode\.editRoadmap/);
  assert.match(panel, /storyPlanNode\.aiEditRoadmap/);
  assert.match(panel, /<EpisodeRoadmapEditorDialog/);
  assert.match(panel, /<EpisodeRoadmapCandidatePreview/);
  assert.match(panel, /replaceEpisodeRoadmapDraft/);
  assert.match(client, /export async function modifyEpisodePlanItem/);
  assert.match(client, /episode-plans\/\$\{item\.episode_number\}\/modify/);
  assert.match(client, /predecessor_plan: predecessorPlan/);
});
