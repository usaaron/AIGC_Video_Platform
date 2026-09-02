import type { StoryBible } from "@/lib/story-planning-client";

function requireConfirmedStoryBible(storyBible: StoryBible): void {
  if (storyBible.status !== "approved") {
    throw new Error("Only a confirmed Story Bible can be exported.");
  }
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-") || "story-bible";
}

function list(title: string, values: string[]): string[] {
  return values.length ? [`## ${title}`, "", ...values.map((value) => `- ${value}`), ""] : [];
}

export function storyBibleMarkdown(projectTitle: string, storyBible: StoryBible): string {
  requireConfirmedStoryBible(storyBible);
  const characterNames = new Map(
    storyBible.character_registry.map((character) => [character.character_ref, character.name]),
  );
  const lines = [
    `# ${projectTitle} - 故事总纲`,
    "",
    `> 已确认版本 v${storyBible.version}`,
    "",
    "## 故事核心",
    "",
    `- 核心前提：${storyBible.core_premise}`,
    `- 系列目标：${storyBible.series_goal}`,
    `- 中心冲突：${storyBible.central_conflict}`,
    `- 主题：${storyBible.theme}`,
    `- 结局方向：${storyBible.ending_direction}`,
    "",
    "## 升级阶梯",
    "",
    ...storyBible.escalation_stages.flatMap((stage, index) => [
      `### ${index + 1}. ${stage.title}`,
      "",
      `- 阶段目标：${stage.stage_goal}`,
      `- 阶段阻力：${stage.stage_opposition}`,
      `- 阶段兑现：${stage.stage_payoff}`,
      `- 下一阶段升级：${stage.escalation_to_next}`,
      "",
    ]),
    "## 人物弧线",
    "",
    ...storyBible.character_arc_targets.flatMap((arc) => [
      `### ${characterNames.get(arc.character_ref) ?? arc.character_ref}`,
      "",
      `- 起始状态：${arc.starting_state}`,
      `- 外部目标：${arc.external_goal}`,
      ...(arc.internal_need ? [`- 内在需求：${arc.internal_need}`] : []),
      `- 目标状态：${arc.target_state}`,
      ...arc.key_turning_points.map((turn) => `- 关键变化：${turn}`),
      "",
    ]),
    "## 故事线",
    "",
    ...storyBible.story_lines.flatMap((storyLine) => [
      `### ${storyLine.title}`,
      "",
      storyLine.premise,
      "",
      `计划结局：${storyLine.planned_resolution}`,
      "",
    ]),
    ...list("世界规则", storyBible.world_rules),
    ...list("锁定事实", storyBible.locked_facts),
    ...list("避免模式", storyBible.avoid_patterns),
  ];
  return `${lines.join("\n").trim()}\n`;
}

export function storyBibleMarkdownFilename(projectTitle: string, version: number): string {
  return `${safeFilename(projectTitle)}-故事总纲-v${version}.md`;
}
