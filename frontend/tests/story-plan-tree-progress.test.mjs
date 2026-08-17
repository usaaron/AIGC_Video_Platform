import assert from "node:assert/strict";
import test from "node:test";

import { summarizeStoryPlanTreeProgress } from "../lib/story-plan-tree-progress.ts";

const root = node({
  node_id: "root",
  planned_start_episode: 1,
  planned_end_episode: 16,
  expansion_status: "expanded",
});
const firstLeaf = node({
  node_id: "leaf-1",
  parent_node_id: "root",
  parent_node_version: 1,
  planned_start_episode: 1,
  planned_end_episode: 8,
  expansion_status: "episode_ready",
});
const secondLeaf = node({
  node_id: "leaf-2",
  parent_node_id: "root",
  parent_node_version: 1,
  predecessor_node_id: "leaf-1",
  predecessor_node_version: 1,
  sequence_order: 2,
  planned_start_episode: 9,
  planned_end_episode: 16,
  expansion_status: "episode_ready",
});

test("a complete tree reports saved roadmap coverage without a separate approval stage", () => {
  const progress = summarizeStoryPlanTreeProgress(
    [root, firstLeaf, secondLeaf],
    [
      roadmap(1, "draft"),
      roadmap(2, "approved"),
      roadmap(2, "approved"),
      { ...roadmap(3, "approved"), source_node_version: 2 },
    ],
  );

  assert.deepEqual(progress, {
    expansionComplete: true,
    readyLeafCount: 2,
    plannedEpisodeCount: 16,
    generatedRoadmapCount: 2,
  });
});

test("missing or unfinished branches keep the split action available", () => {
  assert.equal(
    summarizeStoryPlanTreeProgress([root, firstLeaf], []).expansionComplete,
    false,
  );
  assert.equal(
    summarizeStoryPlanTreeProgress([
      root,
      firstLeaf,
      { ...secondLeaf, status: "draft" },
    ], []).expansionComplete,
    false,
  );
});

test("tree completion requires continuous coverage through the user episode count", () => {
  assert.equal(
    summarizeStoryPlanTreeProgress(
      [root, firstLeaf, secondLeaf],
      [],
      16,
    ).expansionComplete,
    true,
  );
  assert.equal(
    summarizeStoryPlanTreeProgress(
      [root, firstLeaf, secondLeaf],
      [],
      17,
    ).expansionComplete,
    false,
  );
});

function node(overrides) {
  return {
    node_id: "node",
    version: 1,
    parent_node_id: null,
    parent_node_version: null,
    predecessor_node_id: null,
    predecessor_node_version: null,
    sequence_order: 1,
    planned_start_episode: 1,
    planned_end_episode: 8,
    expansion_status: "unexpanded",
    status: "approved",
    ...overrides,
  };
}

function roadmap(episodeNumber, status) {
  return {
    source_node_id: "leaf-1",
    source_node_version: 1,
    episode_number: episodeNumber,
    status,
  };
}
