import assert from "node:assert/strict";
import test from "node:test";

import { buildStoryLineTimeline } from "../lib/story-line-timeline.ts";

function project() {
  return {
    generationSettings: { episodeCount: 20 },
    storyLines: [{
      id: "storyline.truth",
      title: "真相调查线",
      type: "main",
      summary: "追查旧案",
      status: "active",
      characterIds: [],
      episodeBeats: [{
        episodeNumber: 2,
        summary: "取得第一份账页",
        alignment: "aligned",
        contributionType: "progress",
        cause: "进入仓库",
        evidenceSceneNumbers: [1],
      }],
      userEdited: false,
    }, {
      id: "storyline.family",
      title: "家庭关系线",
      type: "subplot",
      summary: "父女重新理解彼此",
      status: "active",
      characterIds: [],
      episodeBeats: [],
      userEdited: false,
    }],
    episodeRoadmaps: [{
      episode_number: 1,
      story_line_refs: ["storyline.truth"],
      episode_goal: "建立账页疑点",
    }, {
      episode_number: 2,
      story_line_refs: ["storyline.family"],
      episode_goal: "父女第一次谈及旧案",
    }, {
      episode_number: 5,
      story_line_refs: ["storyline.truth"],
      episode_goal: "公开账页来源",
    }],
    episodes: [{
      episodeNumber: 1,
      workingDraftJson: JSON.stringify({
        episode_goal: "旧分集建立账页疑点",
        synopsis: "林夏发现旧账页。",
        scenes: [{ scene_number: 1 }],
      }),
    }],
    setupPayoffs: [{
      ref: "setup.old_letter",
      description: "旧信日期被涂改",
      status: "open",
      lastUpdatedEpisode: 2,
      targetPayoffEpisode: 4,
      warnings: [],
      history: [{
        episodeNumber: 2,
        action: "setup",
        summary: "发现日期异常",
        cause: "检查旧信",
        evidenceSceneNumbers: [1],
      }],
    }],
  };
}

test("story-line timeline merges actual, planned, legacy, and setup/payoff events", () => {
  const model = buildStoryLineTimeline(project());
  const truth = model.lanes.find((lane) => lane.id === "storyline.truth");
  const family = model.lanes.find((lane) => lane.id === "storyline.family");
  const setup = model.lanes.find((lane) => lane.type === "setup_payoff");

  assert.equal(model.maxEpisode, 20);
  assert.equal(truth.events.find((event) => event.episodeNumber === 2).status, "actual");
  assert.equal(truth.events.find((event) => event.episodeNumber === 1).status, "backfilled");
  assert.equal(truth.events.find((event) => event.episodeNumber === 5).status, "planned");
  assert.equal(family.events[0].status, "planned");
  assert.equal(setup.events[0].setupPayoffRef, "setup.old_letter");
  assert.ok(model.intersectionEpisodes.includes(2));
});

test("legacy backfill can be hidden without losing planned roadmap events", () => {
  const model = buildStoryLineTimeline(project(), false);
  const truth = model.lanes.find((lane) => lane.id === "storyline.truth");

  assert.equal(truth.events.find((event) => event.episodeNumber === 1).status, "planned");
  assert.equal(truth.events.find((event) => event.episodeNumber === 5).status, "planned");
});

test("approved leaf nodes can rebuild a legacy index when episode roadmaps are absent", () => {
  const legacyProject = project();
  legacyProject.episodeRoadmaps = [];
  const model = buildStoryLineTimeline(legacyProject, true, [{
    node_id: "node.truth.stage",
    parent_node_id: "node.root",
    status: "approved",
    expansion_status: "episode_ready",
    planned_start_episode: 1,
    planned_end_episode: 2,
    story_line_refs: ["storyline.truth"],
    title: "账页疑点阶段",
    narrative_purpose: "建立并推进账页来源疑点",
  }]);
  const truth = model.lanes.find((lane) => lane.id === "storyline.truth");

  assert.equal(truth.events.find((event) => event.episodeNumber === 1).status, "backfilled");
  assert.equal(truth.events.find((event) => event.episodeNumber === 2).status, "actual");
});
