import assert from "node:assert/strict";
import test from "node:test";

import { toStoryPlanningMarkdown } from "../lib/story-planning-export.ts";

const node = {
  node_id: "family.dinner", version: 1, status: "approved", sequence_order: 1,
  title: "空下来的座位", narrative_purpose: "女儿重新理解母亲的等待。",
  entry_state: "父亲离家后，两人都不再提起他。", central_conflict: "女儿准备离家，母亲仍做三人份晚饭。",
  emotional_direction: "从躲避到愿意留在饭桌旁。", exit_state: "女儿留下吃饭。",
  synopsis: "母女在收拾碗筷时试探彼此。", planned_start_episode: 1, planned_end_episode: 1,
};
const roadmap = {
  source_node_id: node.node_id, source_node_version: node.version, status: "approved", episode_number: 1,
  episode_title: "两只碗", locations: ["厨房"], character_refs: ["女儿", "母亲"],
  synopsis: "女儿借递碗的动作问母亲是否愿意放下等待。",
};

test("planning export retains the dramatic choice, consequence, cost, and visible evidence", () => {
  const content = toStoryPlanningMarkdown("空座位", [node], [{
    ...roadmap,
    protagonist_cost: "女儿放弃了当晚离家的计划。",
    dramatic_units: [{
      trigger: "母亲把留给父亲的碗收进橱柜。",
      choice: "女儿把自己的碗也递过去。",
      visible_consequence: "母亲把两只碗重新放回桌上。",
      change_type: "关系松动",
      evidence_hint: "母亲的手停在柜门上，最后没有关门。",
    }],
  }]);
  assert.match(content, /主角代价：女儿放弃了当晚离家的计划。/);
  assert.match(content, /关系松动：母亲把留给父亲的碗收进橱柜。 → 女儿把自己的碗也递过去。 → 母亲把两只碗重新放回桌上。/);
  assert.match(content, /动作或对白证据：母亲的手停在柜门上，最后没有关门。/);
});

test("optional dramatic details are omitted when absent or cleared", () => {
  for (const optionalFields of [{}, { dramatic_units: [], protagonist_cost: null }, { protagonist_cost: "  " }]) {
    const content = toStoryPlanningMarkdown("空座位", [node], [{ ...roadmap, ...optionalFields }]);
    assert.match(content, /EP01｜两只碗/);
    assert.doesNotMatch(content, /主角代价：|戏剧单位：|undefined|null|未填写/);
  }
});

test("an omitted evidence hint does not invent evidence in the export", () => {
  const content = toStoryPlanningMarkdown("空座位", [node], [{
    ...roadmap,
    dramatic_units: [{ trigger: "电话响起。", choice: "母亲没有接听。", visible_consequence: "女儿坐回餐桌。", change_type: "关系松动" }],
  }]);
  assert.match(content, /母亲没有接听。/);
  assert.doesNotMatch(content, /动作或对白证据：|undefined|null/);
});

test("roadmap export resolves canonical references to imported character card names", () => {
  const content = toStoryPlanningMarkdown("空座位", [node], [{
    ...roadmap, character_refs: ["character.daughter"],
  }], [{ id: "story-bible-character.daughter", name: "林夏", gender: "女" }]);
  assert.match(content, /林夏（女）/);
  assert.doesNotMatch(content, /character\.daughter/);
});

test("planning export carries saved execution constraints, exact zero scene budget and cross-episode setup identity", () => {
  const approvedNode = { ...node, planned_end_episode: 2, setup_refs: ["setup.receipt"], payoff_refs: [], turning_points: ["原件到场"] };
  const first = {
    ...roadmap, target_duration_seconds: 90, planned_scene_count: 2, planned_shot_count: 8, planned_dialogue_line_count: 25,
    entry_state: "原件尚未核验", episode_goal: "核对回执", central_conflict: "对手要求交出原件", stage_opposition: "限于窗口查验",
    protagonist_decision: "character.daughter 留在现场", reveal: "编号相符", emotional_movement: "从慌乱到坚决",
    episode_payoff: "拿到查验记录", pressure_escalation: "需继续核对经办人", exit_state: "原件仍由本人持有",
    cliffhanger: "经办人来电", ending_hook_type: "强制选择", next_episode_obligation: "先回应来电再离开", hook_payoff_target_episode: 2,
    character_refs: ["character.daughter", "柜员"], continuity_requirements: ["不得把查验当作移交"],
    setup_refs: ["setup.receipt", "电话仅响一次，尚未接听", "generated.setup_payoff.a1b2c3d4e5f6", "generated.setup_payoff.a1b2c3d4e5f6 所指伏笔尚待证人核对"], payoff_refs: [],
    scene_execution_plan: [
      { scene_number: 1, scene_heading: "INT. 窗口 日", character_refs: ["character.daughter"], scene_objective: "看清封条",
        opposition: "玻璃反光", information_shift: "封条完好", choice_or_cost: "暂停交接", visible_action: "character.daughter 按住回执。",
        turn_or_reveal: "看见旧章", dialogue_objective: "此场不说话", dialogue_line_target: 0, shot_target: 2,
        evidence_requirements: ["封条始终在画面中"], forbidden_changes: ["不得揭开封条"], exit_state: "仍持有原件" },
      { scene_number: 2, scene_heading: "INT. 窗口 日", character_refs: ["story-bible-character.daughter", "柜员"], scene_objective: "要求出具查验记录",
        visible_action: "柜员推出回执", turn_or_reveal: "查验成立", dialogue_objective: "逐项争取记录", dialogue_line_target: 25, shot_target: 6,
        exit_state: "下一集回应来电" },
    ],
  };
  const second = { ...roadmap, episode_number: 2, setup_refs: [], payoff_refs: ["setup.receipt", "generated.setup_payoff.a1b2c3d4e5f6"] };
  const characters = [{ id: "story-bible-character.daughter", name: "林夏", gender: "女" }];
  const snapshot = JSON.stringify([approvedNode, first, second, characters]);
  const content = toStoryPlanningMarkdown("回执", [approvedNode], [first, second], characters);
  for (const value of ["进入状态：原件尚未核验", "主角决定：林夏 留在现场", "退出状态：原件仍由本人持有",
    "下一集必须承接：先回应来电再离开", "连续性要求", "不得把查验当作移交", "电话仅响一次，尚未接听",
    "目标时长：90 秒", "计划对白：25 条", "场 1｜INT. 窗口 日", "对白预算：0 条", "对白预算：25 条",
    "出场人物：林夏、柜员", "可见行动：林夏 按住回执。", "对白目的：此场不说话", "封条始终在画面中",
    "本场不得改变", "不得揭开封条", "信息变化：封条完好", "选择或代价：暂停交接", "场末状态：仍持有原件"]) {
    assert.ok(content.includes(value), value);
  }
  assert.equal(content.match(/伏笔 1（原规划未附文字说明）/g)?.length, 3);
  assert.equal(content.match(/伏笔 2（原规划未附文字说明）/g)?.length, 2);
  assert.match(content, /generated\.setup_payoff\.a1b2c3d4e5f6 所指伏笔尚待证人核对/);
  assert.doesNotMatch(content, /^\s*- generated\.setup_payoff\.a1b2c3d4e5f6$/m);
  assert.doesNotMatch(content, /character\.|setup\.receipt|schema_version|source_node_id|undefined|null/);
  assert.equal(JSON.stringify([approvedNode, first, second, characters]), snapshot);
});

test("export includes only approved current lineage and preserves unknown readable cast", () => {
  const content = toStoryPlanningMarkdown("空座位", [node, { ...node, node_id: "other", title: "未批准节点", status: "draft" }], [
    { ...roadmap, character_refs: ["邻居", "character.missing", "character.other"], scene_execution_plan: [{
      scene_number: 1, scene_heading: "厨房", character_refs: ["character.other", "character.missing", "邻居"],
      scene_objective: "留在现场", visible_action: "坐下", turn_or_reveal: "留门", dialogue_objective: "等回答",
      dialogue_line_target: 25, shot_target: 3, exit_state: "坐下等待",
    }] },
    { ...roadmap, episode_number: 2, status: "draft", synopsis: "未批准新稿" },
    { ...roadmap, episode_number: 3, source_node_version: 99, synopsis: "旧节点引用" },
  ]);
  assert.match(content, /出场人物 & 性别：邻居、未匹配人物（1）、未匹配人物（2）/);
  assert.match(content, /出场人物：未匹配人物（2）、未匹配人物（1）、邻居/);
  assert.doesNotMatch(content, /未批准节点|未批准新稿|旧节点引用|character\./);
});
