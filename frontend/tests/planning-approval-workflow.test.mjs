import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  storyPlanningFilename,
  toStoryPlanningMarkdown,
} from "../lib/story-planning-export.ts";

const source = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("planning requires a saved checkpoint before approval and locks the approved session", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");

  assert.match(
    panel,
    /const planningLocked = project\.planningSession\?\.phase === "script"[\s\S]*project\.planningSession\.status === "approved"/,
  );
  assert.match(panel, /async function savePlanningCheckpoint\(\)/);
  assert.match(
    panel,
    /savePlanningCheckpoint[\s\S]*syncProjectSnapshot\(requestProject\)[\s\S]*status: "active"[\s\S]*savePlanningSession\(/,
  );
  assert.match(
    panel,
    /confirmPlanning[\s\S]*!planningCheckpointSaved[\s\S]*phase: "script",[\s\S]*status: "approved"/,
  );
  assert.match(panel, /registerRevision[\s\S]*markPlanningAwaitingReview\(\)/);
  assert.match(panel, /status: "awaiting_review"/);
  assert.match(panel, /disabled=\{planningLocked \|\| !assistant/);
  assert.match(panel, /disabled=\{planningLocked \|\| \(assistant\?\.disabled/);
  assert.match(panel, /contentEditable=\{!locked\}/);
  assert.match(panel, /if \(!planningLocked \|\| !planningComplete\) return;/);
  assert.match(panel, /planningLocked \? \([\s\S]*导出规划/);
});

test("a new Story Bible lineage invalidates a prior episode import audit", async () => {
  const [panel, state] = await Promise.all([
    source("components/story-bible-panel.tsx"),
    source("lib/story-planning-state.ts"),
  ]);

  assert.match(panel, /episodePlanImportDraft:\s*undefined/);
  assert.match(state, /episodePlanImportDraft:\s*undefined/);
});

test("the planning export includes only the confirmed active roadmap lineage", () => {
  const nodes = [
    planningNode({ node_id: "active", version: 2, title: "当前剧情" }),
    planningNode({ node_id: "old", status: "superseded", title: "旧剧情" }),
    planningNode({ node_id: "draft", status: "draft", title: "未确认剧情" }),
  ];
  const roadmaps = [
    roadmap({ source_node_id: "active", source_node_version: 1, episode_title: "旧路线" }),
    roadmap({ source_node_id: "active", source_node_version: 2, episode_title: "新路线" }),
    roadmap({ source_node_id: "active", source_node_version: 2, status: "draft", episode_number: 2 }),
  ];

  const exported = toStoryPlanningMarkdown("测试项目", nodes, roadmaps);

  assert.match(exported, /# 测试项目 · 剧情规划/);
  assert.match(exported, /当前剧情/);
  assert.match(exported, /新路线/);
  assert.doesNotMatch(exported, /旧剧情|未确认剧情|旧路线/);
  assert.equal(storyPlanningFilename(" 测试/项目 "), "测试-项目-剧情规划.md");
});

function planningNode(overrides = {}) {
  return {
    node_id: "node",
    version: 1,
    sequence_order: 1,
    title: "剧情部分",
    narrative_purpose: "推进主线",
    synopsis: "剧情梗概",
    entry_state: "进入",
    central_conflict: "冲突",
    emotional_direction: "上升",
    exit_state: "退出",
    unit_story_beats: ["事件一"],
    unit_resolution: "阶段结算",
    handoff_pressure: "后续压力",
    planned_start_episode: 1,
    planned_end_episode: 1,
    decomposition_reason: null,
    status: "approved",
    ...overrides,
  };
}

function roadmap(overrides = {}) {
  return {
    source_node_id: "active",
    source_node_version: 2,
    status: "approved",
    episode_number: 1,
    episode_title: "路线",
    episode_goal: "目标",
    entry_state: "进入",
    central_conflict: "冲突",
    protagonist_decision: "决定",
    emotional_movement: "变化",
    episode_payoff: "回报",
    exit_state: "退出",
    ending_hook_type: "疑问悬念",
    cliffhanger: "悬念",
    next_episode_obligation: "承接",
    ...overrides,
  };
}
