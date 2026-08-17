import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hasCompleteStoryPlanChildCoverage } from "../lib/story-plan-coverage.ts";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the recursive story tree has one resumable full-tree coordinator", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const coordinator = await source("lib/story-tree-expansion.ts");
  const roadmapCoordinator = await source("lib/episode-roadmap-generation.ts");
  const background = await source("lib/story-planning-background.ts");

  assert.match(panel, /kind:\s*"full_tree"/);
  assert.match(panel, /runFullStoryTreeExpansion/);
  assert.match(panel, /summarizeStoryPlanTreeProgress/);
  assert.match(panel, /treeProgress\.expansionComplete/);
  assert.match(panel, /storyPlanNode\.roadmapOverallProgress/);
  assert.match(panel, /runFullEpisodeRoadmapGeneration/);
  assert.match(panel, /storyPlanNode\.generateAllRoadmaps/);
  assert.match(panel, /storyPlanNode\.continueAllRoadmaps/);
  assert.match(panel, /useTrackedPlanningTask/);
  assert.doesNotMatch(panel, /usePlanningTask/);
  assert.match(coordinator, /FULL_TREE_INITIAL_CONCURRENCY = 3/);
  assert.match(coordinator, /FULL_TREE_MINIMUM_CONCURRENCY = 2/);
  assert.match(coordinator, /FULL_TREE_MAXIMUM_CONCURRENCY = 4/);
  assert.match(coordinator, /FULL_TREE_SLOW_TASK_THRESHOLD_MS = 120_000/);
  assert.match(coordinator, /runAdaptiveDependencyQueue/);
  assert.match(coordinator, /minimumConcurrency: FULL_TREE_MINIMUM_CONCURRENCY/);
  assert.match(coordinator, /maximumConcurrency: FULL_TREE_MAXIMUM_CONCURRENCY/);
  assert.match(coordinator, /breadthFirst: true/);
  assert.match(coordinator, /loadActiveStoryPlanNodes/);
  assert.match(coordinator, /onTreeCheckpoint/);
  assert.match(coordinator, /onRoadmapCheckpoint/);
  assert.match(coordinator, /checkpointRebasedRoadmaps/);
  assert.match(coordinator, /episodeReadyLeafNodes\(activeNodes\)/);
  assert.doesNotMatch(coordinator, /generateEpisodePlanBatch/);
  assert.match(roadmapCoordinator, /generateEpisodePlanBatch/);
  assert.match(roadmapCoordinator, /onCheckpoint/);
  assert.match(roadmapCoordinator, /episodeReadyStoryPlanLeaves/);
  assert.match(roadmapCoordinator, /episodeRoadmaps: workingRoadmaps/);
  assert.match(background, /"full_tree"/);
  assert.match(background, /FULL_TREE_RESERVED_SLOTS = 4/);
  assert.match(background, /const result = await task\.run\(\)/);
  assert.doesNotMatch(background, /generateWithFailurePolicy/);
});

test("approved sibling versions keep a complete saved layer resumable", () => {
  const root = coverageNode({
    node_id: "root",
    version: 1,
    sequence_order: 1,
    planned_start_episode: 1,
    planned_end_episode: 100,
  });
  const children = [
    coverageNode({
      node_id: "branch-1",
      version: 14,
      parent_node_id: "root",
      parent_node_version: 1,
      sequence_order: 1,
      planned_start_episode: 1,
      planned_end_episode: 50,
    }),
    coverageNode({
      node_id: "branch-2",
      version: 14,
      parent_node_id: "root",
      parent_node_version: 1,
      predecessor_node_id: "branch-1",
      predecessor_node_version: 13,
      sequence_order: 2,
      planned_start_episode: 51,
      planned_end_episode: 100,
    }),
  ];

  assert.equal(hasCompleteStoryPlanChildCoverage(root, children), true);
  assert.equal(hasCompleteStoryPlanChildCoverage(root, [
    children[0],
    { ...children[1], predecessor_node_version: 15 },
  ]), false);
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
  assert.match(panel, /resolveStoryPlanNodeWorkflow/);
  assert.match(panel, /story-plan-node-action-menu/);
  assert.match(panel, /workflow\.action === "decompose"/);
  assert.match(panel, /onRequestResplit\?\.\(\)/);
  assert.match(panel, /autoExpansionRequested/);
  assert.match(panel, /onRoadmapCheckpoint: async/);
  assert.match(panel, /onTreeCheckpoint:/);
  assert.match(panel, /await persistProjectUpdate/);
  assert.match(panel, /const episodeRoadmaps = current\.episodeRoadmaps \?\? \[\]/);
  assert.match(panel, /const branchLocked = operationLocked \|\| isEditing/);
  assert.match(panel, /const concurrentLeafAccess = treeBusy/);
  assert.match(panel, /treeUnlockedNodeIds/);
  assert.match(panel, /if \(treeBusy \|\| isEditing \|\| decomposeTaskActive\) return/);
  assert.match(panel, /if \(treeInteractionLocked \|\| isEditing \|\| roadmapTaskActive/);
  assert.match(panel, /depth === 0 && !effectiveEditing/);
  assert.match(panel, /depth === 1 && !effectiveEditing/);
  assert.match(client, /descendant_policy=\$\{descendantPolicy\}/);
});

test("story parts use confirmation without exposing approval-state badges", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const locale = await source("providers/locale-provider.tsx");

  assert.match(panel, /workflow\.action === "confirm"/);
  assert.doesNotMatch(panel, /workflow\.action === "approve"/);
  assert.doesNotMatch(panel, /story-plan-node-state/);
  assert.doesNotMatch(panel, /storyPlanNode\.statusApproved/);
  assert.match(locale, /"storyPlanNode\.confirm": "确认这个部分"/);
  assert.doesNotMatch(locale, /"storyPlanNode\.statusApproved"/);
  assert.match(locale, /"workspace\.confirmEpisode": "批准本集"/);
});

test("each episode roadmap exposes manual and AI revision with candidate review", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const client = await source("lib/story-planning-client.ts");

  assert.match(panel, /storyPlanNode\.editRoadmap/);
  assert.match(panel, /storyPlanNode\.aiEditRoadmap/);
  assert.match(panel, /<EpisodeRoadmapEditorDialog/);
  assert.match(panel, /<EpisodeRoadmapCandidatePreview/);
  assert.match(panel, /replaceEpisodeRoadmapItem/);
  assert.doesNotMatch(panel, /approveRoadmap/);
  assert.match(client, /export async function modifyEpisodePlanItem/);
  assert.match(client, /episode-plans\/\$\{item\.episode_number\}\/modify/);
  assert.match(client, /predecessor_plan: predecessorPlan/);
});

function coverageNode(overrides) {
  return {
    node_id: "node",
    version: 1,
    parent_node_id: null,
    parent_node_version: null,
    predecessor_node_id: null,
    predecessor_node_version: null,
    sequence_order: 1,
    planned_start_episode: 1,
    planned_end_episode: 1,
    ...overrides,
  };
}
