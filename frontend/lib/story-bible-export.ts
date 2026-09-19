import type { StoryBible } from "@/lib/story-planning-client";
import { safeFilename } from "@/lib/filename";
import { ACTING_PROFILE_FIELDS, ACTING_PROFILE_LABELS } from "@/lib/character-acting-profile";
import { planningExportLabels } from "./story-planning-export.ts";

function requireConfirmedStoryBible(storyBible: StoryBible): void {
  if (storyBible.status !== "approved") {
    throw new Error("Only a confirmed Story Bible can be exported.");
  }
}

function list(title: string, values: string[]): string[] {
  return values.length ? [`## ${title}`, "", ...values.map((value) => `- ${value}`), ""] : [];
}

export function storyBibleMarkdown(projectTitle: string, storyBible: StoryBible): string {
  requireConfirmedStoryBible(storyBible);
  const characterNames = new Map(
    storyBible.character_registry.map((character) => [character.character_ref, character.name]),
  );
  const labels = planningExportLabels(storyBible.character_registry.map(character => ({
    id: character.character_ref, name: character.name,
  })));
  const characterName = (reference: string) => characterNames.get(reference) ?? labels.character(reference);
  const decisionStatus = {
    current_direction: "当前方向", confirmed: "已确认", proposed: "待确认建议",
    unresolved: "待决定", delegated: "已委托补充", conflicted: "存在冲突",
  };
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
    ...(storyBible.character_registry.length ? [
      "## 核心人物", "",
      ...storyBible.character_registry.flatMap(character => [
        `### ${character.name}`, "",
        ...(character.role?.trim() ? [`- 人物定位：${character.role}`] : []), "",
      ]),
    ] : []),
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
    ...storyBible.character_registry.flatMap((character) => {
      const fields = ACTING_PROFILE_FIELDS.filter((field) => character.acting_profile?.[field]?.trim());
      return fields.length ? [
        `## ${character.name} · 表演档案`,
        "",
        ...fields.map((field) => `- ${ACTING_PROFILE_LABELS[field]}：${character.acting_profile?.[field]}`),
        "",
      ] : [];
    }),
    "## 人物弧线",
    "",
    ...storyBible.character_arc_targets.flatMap((arc) => [
      `### ${characterName(arc.character_ref)}`,
      "",
      `- 起始状态：${arc.starting_state}`,
      `- 外部目标：${arc.external_goal}`,
      ...(arc.internal_need ? [`- 内在需求：${arc.internal_need}`] : []),
      `- 目标状态：${arc.target_state}`,
      ...arc.key_turning_points.map((turn) => `- 关键变化：${turn}`),
      ...(arc.protected_traits ?? []).filter(value => value.trim()).map(value => `- 必须保留的人物特征：${value}`),
      "",
    ]),
    ...((storyBible.relationships ?? []).length ? [
      "## 核心关系", "",
      ...storyBible.relationships.flatMap(relationship => [
        `### ${characterName(relationship.source_character_ref)}与${characterName(relationship.target_character_ref)}`,
        "", `- 关系：${relationship.relationship_type}`,
        `- 初始状态：${relationship.initial_state}`,
        `- 发展方向：${relationship.target_direction}`,
        ...(relationship.locked ? ["- 已锁定：后续展开必须保留这段关系。"] : []), "",
      ]),
    ] : []),
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
    ...list("重要伏笔与兑现", (storyBible.major_setup_payoff_refs ?? []).map(labels.reference)),
    ...((storyBible.creative_decisions ?? []).length ? [
      "## 创意决策", "",
      ...storyBible.creative_decisions.flatMap((decision, index) => [
        `### ${decision.title?.trim() || `创意决定 ${index + 1}`}`, "",
        ...(decision.value?.trim() ? [decision.value.trim(), ""] : []),
        `- 状态：${decisionStatus[decision.status]}`,
        ...(decision.locked ? ["- 已锁定：后续展开必须遵守。"] : []), "",
      ]),
    ] : []),
  ];
  return `${lines.map(labels.text).join("\n").trim()}\n`;
}

export function storyBibleMarkdownFilename(projectTitle: string, version: number): string {
  return `${safeFilename(projectTitle, "story-bible")}-故事总纲-v${version}.md`;
}
