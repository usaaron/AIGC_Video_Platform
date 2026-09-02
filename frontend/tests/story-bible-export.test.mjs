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
