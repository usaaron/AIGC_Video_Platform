import assert from "node:assert/strict";
import test from "node:test";

import {
  storyBibleMarkdown,
  storyBibleMarkdownFilename,
} from "../lib/story-bible-export.ts";

function buildStoryBible(status = "approved") {
  return {
    story_bible_id: "story-bible.export.1",
    story_project_id: "project.export.1",
    version: 3,
    status,
    market_profile: "overseas_tiktok",
    core_premise: "她必须在直播前揭开真相。",
    series_goal: "找出幕后操盘者。",
    central_conflict: "公开真相会伤害她最信任的人。",
    theme: "信任必须经受选择。",
    ending_direction: "她公开证据并承担代价。",
    escalation_stages: [{
      title: "证据浮现",
      stage_goal: "找到原始录像",
      stage_opposition: "对手删除备份",
      stage_payoff: "确认录像仍存在",
      escalation_to_next: "证人突然失踪",
    }],
    character_registry: [{
      character_ref: "lead",
      name: "林夏",
    }],
    character_arc_targets: [{
      character_ref: "lead",
      starting_state: "不再信任任何人",
      external_goal: "公开证据",
      internal_need: "重新学会合作",
      target_state: "愿意承担共同选择",
      key_turning_points: ["接受搭档帮助"],
    }],
    story_lines: [{
      title: "失踪录像",
      premise: "一份录像牵出旧案。",
      planned_resolution: "录像在直播中公开。",
    }],
    world_rules: ["证据必须可核验"],
    locked_facts: ["录像拍摄于三年前"],
    avoid_patterns: ["无代价反转"],
  };
}

test("confirmed Story Bible exports a readable versioned Markdown document", () => {
  const content = storyBibleMarkdown("逆光而行", buildStoryBible());

  assert.match(content, /^# 逆光而行 - 故事总纲$/m);
  assert.match(content, /> 已确认版本 v3/);
  assert.match(content, /核心前提：她必须在直播前揭开真相。/);
  assert.match(content, /### 林夏/);
  assert.match(content, /## 锁定事实/);
  assert.equal(storyBibleMarkdownFilename("逆光/而行", 3), "逆光-而行-故事总纲-v3.md");
});

test("unconfirmed Story Bible cannot be exported", () => {
  assert.throws(
    () => storyBibleMarkdown("逆光而行", buildStoryBible("draft")),
    /Only a confirmed Story Bible can be exported/,
  );
});

test("bible export includes reviewed performance without empty-field placeholders", () => {
  const bible = buildStoryBible();
  bible.character_registry[0].acting_profile = { voice: "低声短句，停顿后再问依据", pressureResponse: "", permanentVoicePrompt: "中低声区，句尾收住" };
  const content = storyBibleMarkdown("旧案回声", bible);
  assert.match(content, /林夏 · 表演档案/);
  assert.match(content, /声音与节奏：低声短句/);
  assert.doesNotMatch(content, /压力下的反应|undefined/);
});

test("approved bible exports current people, relationships, protected traits, setups and creative decisions without changing source", () => {
  const bible = buildStoryBible();
  bible.character_registry = [
    { character_ref: "character.lena", name: "Lena", role: "主唱" },
    { character_ref: "character.noah", name: "Noah", role: "吉他手" },
  ];
  bible.character_arc_targets[0].character_ref = "character.lena";
  bible.character_arc_targets[0].protected_traits = ["不替 character.noah 承担选择"];
  bible.relationships = [{
    relationship_id: "relationship.private", source_character_ref: "story-bible-character.lena",
    target_character_ref: "character.noah", relationship_type: "旧搭档", initial_state: "互不信任",
    target_direction: "用同一次演出重建合作", locked: true,
  }];
  bible.major_setup_payoff_refs = ["录音中断的真正原因", "setup.old_take", "setup.old_take"];
  bible.creative_decisions = [{
    decision_key: "debug.private_decision", title: "最终选择", value: "Lena 留下完整录音。",
    status: "confirmed", locked: true, source: "user_input", owner: "user", ai_permission: "none",
  }, { decision_key: "private.pending", title: "片尾安排", value: null, status: "unresolved", locked: false }];
  const snapshot = JSON.stringify(bible);
  const content = storyBibleMarkdown("打烊以后", bible);
  for (const value of ["## 核心人物", "人物定位：主唱", "### Lena与Noah", "关系：旧搭档",
    "初始状态：互不信任", "发展方向：用同一次演出重建合作", "必须保留的人物特征：不替 Noah 承担选择",
    "## 重要伏笔与兑现", "录音中断的真正原因", "## 创意决策", "Lena 留下完整录音。", "状态：已确认", "状态：待决定"]) {
    assert.ok(content.includes(value), value);
  }
  assert.equal(content.match(/伏笔 1（原规划未附文字说明）/g)?.length, 2);
  assert.doesNotMatch(content, /character\.|relationship\.private|setup\.old_take|debug\.private|user_input|ai_permission|undefined|null/);
  assert.equal(JSON.stringify(bible), snapshot);
});

test("unknown readable identities remain readable and only missing technical identities get stable labels", () => {
  const bible = buildStoryBible();
  bible.relationships = [
    { source_character_ref: "不知名店员", target_character_ref: "character.missing", relationship_type: "同事", initial_state: "相识", target_direction: "互助", locked: false },
    { source_character_ref: "character.missing", target_character_ref: "林夏", relationship_type: "证人", initial_state: "谨慎", target_direction: "作证", locked: false },
  ];
  const content = storyBibleMarkdown("旧案", bible);
  assert.match(content, /不知名店员与未匹配人物（1）/);
  assert.match(content, /未匹配人物（1）与林夏/);
  assert.doesNotMatch(content, /character\.missing/);
});
