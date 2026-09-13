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
