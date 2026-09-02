import assert from "node:assert/strict";
import test from "node:test";

import { buildEpisodePlanningMemory } from "../lib/episode-planning-memory.ts";

const activeNode = (nodeId, version, overrides = {}) => ({
  node_id: nodeId,
  version,
  story_bible_version: 4,
  planned_start_episode: 1,
  status: "approved",
  expansion_status: "episode_ready",
  ...overrides,
});

const roadmap = (sourceNodeId, sourceNodeVersion, episodeNumber, overrides = {}) => ({
  source_node_id: sourceNodeId,
  source_node_version: sourceNodeVersion,
  story_bible_version: 4,
  status: "approved",
  episode_number: episodeNumber,
  setup_refs: [],
  payoff_refs: [],
  continuity_requirements: [],
  story_line_refs: [],
  ending_hook_type: "因果压力",
  next_episode_obligation: `下一集必须处理第${episodeNumber}集留下的压力。`,
  hook_payoff_target_episode: null,
  exit_state: `第${episodeNumber}集的结尾状态。`,
  pressure_escalation: `第${episodeNumber}集的升级压力。`,
  ...overrides,
});

test("memory excludes historical versions, drafts, foreign bible versions, and retired nodes", () => {
  const project = {
    episodeRoadmaps: [
      roadmap("leaf.alpha", 3, 1, {
        setup_refs: ["setup.keep"],
        payoff_refs: ["payoff.keep"],
        continuity_requirements: ["保留已确认事实"],
        story_line_refs: ["line.truth"],
      }),
      roadmap("leaf.alpha", 3, 2, {
        status: "draft",
        setup_refs: ["setup.draft"],
      }),
      roadmap("leaf.alpha", 2, 3, {
        setup_refs: ["setup.old-version"],
      }),
      roadmap("leaf.retired", 1, 4, {
        setup_refs: ["setup.retired"],
      }),
      roadmap("leaf.alpha", 3, 5, {
        story_bible_version: 3,
        setup_refs: ["setup.foreign-bible"],
      }),
    ],
  };
  const memory = buildEpisodePlanningMemory(
    project,
    { story_bible_version: 4, planned_start_episode: 9 },
    [activeNode("leaf.alpha", 3)],
  );

  assert.equal(memory.last_confirmed_episode, 1);
  assert.deepEqual(memory.unresolved_setup_refs, ["setup.keep"]);
  assert.deepEqual(memory.recorded_payoff_refs, ["payoff.keep"]);
  assert.deepEqual(memory.active_story_line_refs, ["line.truth"]);
  assert.equal(memory.open_hooks.length, 1);
  assert.equal(memory.open_hooks[0].source_episode, 1);
  assert.equal(memory.recent_state_handoffs.length, 1);
});

test("memory carries bounded continuity across consecutive approved leaves", () => {
  const firstLeaf = activeNode("leaf.alpha", 2);
  const secondLeaf = activeNode("leaf.beta", 1);
  const roadmaps = [];
  for (let episodeNumber = 1; episodeNumber <= 16; episodeNumber += 1) {
    const sourceNode = episodeNumber <= 8 ? firstLeaf : secondLeaf;
    roadmaps.push(roadmap(sourceNode.node_id, sourceNode.version, episodeNumber, {
      setup_refs: [`setup.${episodeNumber}`],
      payoff_refs: episodeNumber === 16 ? ["setup.1"] : [],
      continuity_requirements: [`约束${episodeNumber}`],
      story_line_refs: [`line.${episodeNumber % 3}`],
      hook_payoff_target_episode: episodeNumber === 8 ? 18 : null,
    }));
  }

  const memory = buildEpisodePlanningMemory(
    { episodeRoadmaps: roadmaps },
    { story_bible_version: 4, planned_start_episode: 17 },
    [firstLeaf, secondLeaf, activeNode("leaf.gamma", 1)],
  );

  assert.equal(memory.last_confirmed_episode, 16);
  assert.equal(memory.active_continuity_requirements.length, 6);
  assert.equal(memory.recent_state_handoffs.length, 6);
  assert.deepEqual(
    memory.recent_state_handoffs.map((handoff) => handoff.episode_number),
    [11, 12, 13, 14, 15, 16],
  );
  assert.equal(memory.open_hooks.some((hook) => hook.source_episode === 8), true);
  assert.equal(memory.unresolved_setup_refs.includes("setup.1"), false);
  assert.equal(memory.active_story_line_refs.length, 3);
});

test("rebased roadmap drafts do not leak into the next leaf memory", () => {
  const memory = buildEpisodePlanningMemory(
    {
      episodeRoadmaps: [
        roadmap("leaf.alpha", 1, 1, { setup_refs: ["setup.superseded"] }),
        roadmap("leaf.alpha", 2, 1, {
          status: "draft",
          setup_refs: ["setup.rebased-draft"],
        }),
        roadmap("leaf.beta", 1, 9, {
          setup_refs: ["setup.previous-leaf"],
        }),
      ],
    },
    { story_bible_version: 4, planned_start_episode: 17 },
    [
      activeNode("leaf.alpha", 2),
      activeNode("leaf.beta", 1),
    ],
  );

  assert.equal(memory.last_confirmed_episode, 9);
  assert.deepEqual(memory.unresolved_setup_refs, ["setup.previous-leaf"]);
  assert.equal(memory.unresolved_setup_refs.includes("setup.superseded"), false);
  assert.equal(memory.unresolved_setup_refs.includes("setup.rebased-draft"), false);
});

test("legacy callers still prefer the latest source-node version", () => {
  const memory = buildEpisodePlanningMemory(
    {
      episodeRoadmaps: [
        roadmap("leaf.alpha", 1, 1, { setup_refs: ["setup.old"] }),
        roadmap("leaf.alpha", 2, 1, { setup_refs: ["setup.current"] }),
      ],
    },
    { story_bible_version: 4, planned_start_episode: 9 },
  );

  assert.deepEqual(memory.unresolved_setup_refs, ["setup.current"]);
  assert.equal(memory.last_confirmed_episode, 1);
});

test("an uncompressed active-node history uses only the newest node version", () => {
  const memory = buildEpisodePlanningMemory(
    {
      episodeRoadmaps: [
        roadmap("leaf.alpha", 2, 1, { setup_refs: ["setup.new"] }),
        roadmap("leaf.alpha", 1, 1, { setup_refs: ["setup.old"] }),
      ],
    },
    { story_bible_version: 4, planned_start_episode: 9 },
    [
      activeNode("leaf.alpha", 1),
      activeNode("leaf.alpha", 2),
    ],
  );

  assert.deepEqual(memory.unresolved_setup_refs, ["setup.new"]);
});

test("active nodes from another Story Bible version cannot authorize memory", () => {
  const memory = buildEpisodePlanningMemory(
    {
      episodeRoadmaps: [
        roadmap("leaf.alpha", 1, 1, { setup_refs: ["setup.foreign-node"] }),
      ],
    },
    { story_bible_version: 4, planned_start_episode: 9 },
    [activeNode("leaf.alpha", 1, { story_bible_version: 3 })],
  );

  assert.equal(memory.last_confirmed_episode, null);
  assert.deepEqual(memory.unresolved_setup_refs, []);
});
