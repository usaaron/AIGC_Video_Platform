import assert from "node:assert/strict";
import test from "node:test";
import { preparePlanningBatchApproval } from "../lib/planning-batch-approval.ts";

function scene(number) {
  return { scene_number: number, scene_heading: `车站第${number}处`, scene_objective: `核对第${number}份证据`,
    opposition: "站长阻拦调查", information_shift: `出现第${number}个线索`, choice_or_cost: "决定公开证据",
    turn_or_reveal: "证人现身作证", visible_action: "播放现场录音", exit_state: "乘客得知真相",
    dialogue_objective: "核实录音来源", evidence_requirements: ["手机中的原录音"] };
}
function fixture(total = 8) {
  const nodes = Array.from({ length: total / 8 }, (_, index) => ({
    node_id: `node-${index + 1}`, version: 2, story_bible_id: "bible", story_bible_version: 3,
    status: "approved", expansion_status: "episode_ready", parent_node_id: null, parent_node_version: null,
    planned_start_episode: index * 8 + 1, planned_end_episode: index * 8 + 8,
    episode_developments: Array.from({ length: 8 }, (_, episode) => ({
      episode_number: index * 8 + episode + 1, entry_state: "调查开始", exit_state: "证据公开",
      source_turning_points: ["公开录音"], source_unit_story_beats: ["证人作证"],
    })),
  }));
  const project = { id: "batch-test", storyBibleVersion: 3, episodes: [], generationSettings: { episodeCount: total },
    episodeRoadmaps: nodes.flatMap(node => node.episode_developments.map(event => ({
      ...event, source_node_id: node.node_id, source_node_version: node.version, story_bible_version: 3,
      status: "draft", execution_ready: true, episode_title: `第${event.episode_number}集`, planned_scene_count: 3,
      scene_execution_plan: [scene(1), scene(2), scene(3)],
    }))),
  };
  return { project, nodes };
}
const unusedPrepare = async () => { throw new Error("complete plans must not call the model"); };

test("one explicit batch produces a complete approved candidate without mutating any saved draft", async () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = await preparePlanningBatchApproval({ ...input, prepare: unusedPrepare });
  assert.deepEqual(input, before);
  assert.equal(result.length, 8);
  assert.ok(result.every(item => item.status === "approved"));
  assert.deepEqual(result.map(({ status, ...item }) => item), before.project.episodeRoadmaps.map(({ status, ...item }) => item));
});

test("already approved, legacy approved and historical records remain exactly as saved", async () => {
  const input = fixture();
  input.project.episodeRoadmaps[0].status = "approved";
  delete input.project.episodeRoadmaps[1].status;
  const historical = { ...input.project.episodeRoadmaps[2], source_node_version: 1, episode_title: "旧版本" };
  input.project.episodeRoadmaps.push(historical);
  const result = await preparePlanningBatchApproval({ ...input, prepare: unusedPrepare });
  assert.equal(result[0], input.project.episodeRoadmaps[0]);
  assert.equal(result[1], input.project.episodeRoadmaps[1]);
  assert.equal(result.at(-1), historical);
  assert.equal(result[2].episode_title, "第3集");
});

test("sequential preparation carries draft handoffs across leaves and never invents an approved prefix", async () => {
  const input = fixture(16);
  input.project.episodeRoadmaps[7].scene_execution_plan = [];
  input.project.episodeRoadmaps[8].scene_execution_plan = [];
  input.project.episodeRoadmaps[9].scene_execution_plan = [];
  const calls = [], progress = [];
  const result = await preparePlanningBatchApproval({ ...input,
    onProgress: (number, total) => progress.push([number, total]),
    prepare: async (working, node, item, accepted, signal, nodes) => {
      calls.push(item.episode_number);
      assert.equal(nodes, input.nodes);
      assert.equal(signal, undefined);
      assert.deepEqual(accepted.map(previous => previous.episode_number),
        Array.from({ length: item.episode_number - node.planned_start_episode }, (_, i) => node.planned_start_episode + i));
      assert.ok(working.episodeRoadmaps.every(previous => previous.status === "draft"));
      if (item.episode_number === 9) assert.equal(working.episodeRoadmaps[7].scene_execution_plan.length, 3);
      if (item.episode_number === 10) assert.equal(accepted[0].scene_execution_plan.length, 3);
      return { ...item, scene_execution_plan: [scene(1), scene(2), scene(3)] };
    },
  });
  assert.deepEqual(calls, [8, 9, 10]);
  assert.equal(progress.length, 16);
  assert.ok(result.every(item => item.status === "approved"));
  assert.equal(input.project.episodeRoadmaps[7].scene_execution_plan.length, 0);
});

for (const failure of ["request", "incomplete", "wrong-episode", "wrong-source"]) {
  test(`a ${failure} preparation result leaves the entire original batch unchanged`, async () => {
    const input = fixture();
    input.project.episodeRoadmaps[0].scene_execution_plan = [];
    input.project.episodeRoadmaps[1].scene_execution_plan = [];
    const before = structuredClone(input);
    await assert.rejects(preparePlanningBatchApproval({ ...input, prepare: async (_project, _node, item) => {
      const ready = { ...item, scene_execution_plan: [scene(1), scene(2), scene(3)] };
      if (item.episode_number === 1) return ready;
      if (failure === "request") throw new Error("service unavailable");
      if (failure === "incomplete") return item;
      if (failure === "wrong-episode") return { ...ready, episode_number: 8 };
      return { ...ready, source_node_version: 9 };
    } }), /第2集/);
    assert.deepEqual(input, before);
  });
}

for (const invalid of ["missing", "duplicate", "stale-node", "stale-bible", "overlap", "pending-tree", "unreviewed-source", "extra-current-episode"]) {
  test(`${invalid} coverage is rejected before any scene preparation`, async () => {
    const input = fixture();
    input.project.episodeRoadmaps[0].scene_execution_plan = [];
    if (invalid === "missing") input.project.episodeRoadmaps.pop();
    if (invalid === "duplicate") input.project.episodeRoadmaps.push({ ...input.project.episodeRoadmaps[7] });
    if (invalid === "stale-node") input.project.episodeRoadmaps[7].source_node_version = 1;
    if (invalid === "stale-bible") input.project.episodeRoadmaps[7].story_bible_version = 2;
    if (invalid === "overlap") input.nodes.push({ ...input.nodes[0], node_id: "overlapping" });
    if (invalid === "pending-tree") input.nodes[0].status = "draft";
    if (invalid === "unreviewed-source") input.project.episodeRoadmaps[7].source_revision_review = { previous_version: 1, current_version: 2 };
    if (invalid === "extra-current-episode") input.project.episodeRoadmaps.push({ ...input.project.episodeRoadmaps[7], episode_number: 9 });
    let calls = 0;
    await assert.rejects(preparePlanningBatchApproval({ ...input, prepare: async () => { calls++; } }));
    assert.equal(calls, 0);
  });
}

test("future revision approves only the editable suffix and retains the written prefix", async () => {
  const input = fixture(16);
  input.project.planningRevision = { status: "active", startEpisode: 9 };
  input.project.episodes = [{ episodeNumber: 1, body: "保留已有正文" }];
  input.project.episodeRoadmaps.slice(0, 8).forEach(item => { item.status = "approved"; });
  input.project.episodeRoadmaps[8].source_revision_review = { previous_version: 1, current_version: 2 };
  const before = structuredClone(input);
  const result = await preparePlanningBatchApproval({ ...input, prepare: unusedPrepare });
  assert.deepEqual(result.slice(0, 8), before.project.episodeRoadmaps.slice(0, 8));
  assert.ok(result.slice(8).every(item => item.status === "approved" && !item.source_revision_review));
  assert.deepEqual(input, before);
});

for (const field of ["entry_state", "exit_state", "source_turning_points", "source_unit_story_beats"]) {
  test(`ordinary approval rejects a changed ${field} even when every scene is complete`, async () => {
    const input = fixture();
    input.project.episodeRoadmaps[0][field] = field.endsWith("state") ? "未经确认的边界" : ["未经确认的事件"];
    const before = structuredClone(input);
    await assert.rejects(preparePlanningBatchApproval({ ...input, prepare: unusedPrepare }), /第1集.*最新上层规划不一致/);
    assert.deepEqual(input, before);
  });
}

test("ordinary preparation cannot rewrite a confirmed source boundary while completing scenes", async () => {
  const input = fixture();
  input.project.episodeRoadmaps[0].scene_execution_plan = [];
  await assert.rejects(preparePlanningBatchApproval({ ...input, prepare: async (_project, _node, item) => ({
    ...item, exit_state: "准备时偷偷变更", scene_execution_plan: [scene(1), scene(2), scene(3)],
  }) }), /第1集.*最新上层规划不一致/);
});

test("complete scenes still run readiness preparation when the execution flag is missing", async () => {
  const input = fixture();
  delete input.project.episodeRoadmaps[0].execution_ready;
  const calls = [];
  const result = await preparePlanningBatchApproval({ ...input, prepare: async (_project, _node, item) => {
    calls.push(item.episode_number);
    return { ...item, execution_ready: true };
  } });
  assert.deepEqual(calls, [1]);
  assert.equal(result[0].execution_ready, true);
  assert.equal(input.project.episodeRoadmaps[0].execution_ready, undefined);
});

test("preparation cannot certify a draft whose execution flag is still false", async () => {
  const input = fixture();
  input.project.episodeRoadmaps[0].execution_ready = false;
  await assert.rejects(preparePlanningBatchApproval({ ...input, prepare: async (_project, _node, item) => item }), /第1集.*正文准备/);
});

for (const invalid of ["written-draft", "frozen-draft", "source-event", "prepared-event", "approved-incomplete"]) {
  test(`${invalid} cannot be bypassed by confirming the whole outline`, async () => {
    const input = fixture(16);
    input.project.planningRevision = { status: "active", startEpisode: 9 };
    input.project.episodeRoadmaps.slice(0, 8).forEach(item => { item.status = "approved"; });
    if (invalid === "written-draft") input.project.episodes = [{ episodeNumber: 10 }];
    if (invalid === "frozen-draft") input.project.episodeRoadmaps[0].status = "draft";
    if (invalid === "source-event") input.project.episodeRoadmaps[8].entry_state = "不匹配的状态";
    if (invalid === "prepared-event") input.project.episodeRoadmaps[8].scene_execution_plan = [];
    if (invalid === "approved-incomplete") input.project.episodeRoadmaps[0].scene_execution_plan = [];
    const before = structuredClone(input);
    await assert.rejects(preparePlanningBatchApproval({ ...input, prepare: async (_project, _node, item) => ({
      ...item, entry_state: "准备后不匹配", scene_execution_plan: [scene(1), scene(2), scene(3)],
    }) }));
    assert.deepEqual(input, before);
  });
}
