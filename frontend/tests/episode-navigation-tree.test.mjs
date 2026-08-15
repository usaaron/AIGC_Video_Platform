import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEpisodeNavigationTree,
  episodeNavigationPath,
} from "../lib/episode-navigation-tree.ts";

function node(id, title, start, end, parentId = null, sequenceOrder = 0) {
  return {
    node_id: id,
    parent_node_id: parentId,
    title,
    planned_start_episode: start,
    planned_end_episode: end,
    sequence_order: sequenceOrder,
    status: "approved",
  };
}

test("episode navigation follows recursive story planning hierarchy", () => {
  const tree = buildEpisodeNavigationTree([
    { ...node("technical-root", "故事总纲技术根", 1, 200), decomposition_reason: "system_story_bible_root.v1" },
    node("act-1", "第一阶段", 1, 100, "technical-root"),
    node("arc-1", "旧案浮出", 1, 20, "act-1"),
    node("leaf-1", "雨夜证词", 1, 10, "arc-1"),
    node("leaf-2", "账本失踪", 11, 20, "arc-1", 1),
  ], [1, 2, 10, 11, 12]);

  assert.equal(tree.branches[0].title, "第一阶段");
  assert.equal(tree.branches[0].children[0].title, "旧案浮出");
  assert.deepEqual(
    tree.branches[0].children[0].children.map((branch) => branch.title),
    ["雨夜证词", "账本失踪"],
  );
  assert.deepEqual(
    tree.branches[0].children[0].children[0].directEpisodeNumbers,
    [1, 2, 10],
  );
  assert.deepEqual(episodeNavigationPath(tree.branches, 11), [
    "act-1",
    "arc-1",
    "leaf-2",
  ]);
});

test("episode navigation shows only available episodes and preserves unassigned legacy episodes", () => {
  const tree = buildEpisodeNavigationTree([
    node("planned", "已规划部分", 1, 10),
    { ...node("draft", "草稿节点", 11, 20), status: "draft" },
  ], [1, 5, 12]);

  assert.deepEqual(tree.branches[0].episodeNumbers, [1, 5]);
  assert.deepEqual(tree.unassignedEpisodeNumbers, [12]);
});
