import type { StoryPlanNode } from "./story-planning-client.ts";
import type { EpisodeRoadmapItem } from "./types.ts";

const STORY_PLAN_ROOT_MARKER = "system_story_bible_root.v1";

export function toStoryPlanningMarkdown(
  projectTitle: string,
  nodes: StoryPlanNode[],
  roadmaps: EpisodeRoadmapItem[],
): string {
  const activeNodes = nodes
    .filter((node) => (
      node.status === "approved"
      && node.decomposition_reason !== STORY_PLAN_ROOT_MARKER
    ))
    .sort(comparePlanningNodes);
  const nodeVersions = new Set(activeNodes.map((node) => `${node.node_id}:${node.version}`));

  const nodeSections = activeNodes.map((node) => {
    const range = node.planned_start_episode !== null && node.planned_end_episode !== null
      ? `第 ${node.planned_start_episode}-${node.planned_end_episode} 集`
      : "集数范围待定";
    return [
      `## ${node.title.trim() || "未命名剧情部分"}`,
      `- 集数范围：${range}`,
      `- 叙事作用：${node.narrative_purpose}`,
      `- 进入状态：${node.entry_state}`,
      `- 中心冲突：${node.central_conflict}`,
      `- 情绪走向：${node.emotional_direction}`,
      `- 退出状态：${node.exit_state}`,
      "",
      node.synopsis,
      ...(node.unit_story_beats?.length
        ? ["", "### 剧情推进", ...node.unit_story_beats.map((beat, index) => `${index + 1}. ${beat}`)]
        : []),
      ...(node.unit_resolution ? ["", `**本部分结算：** ${node.unit_resolution}`] : []),
      ...(node.handoff_pressure ? ["", `**下一部分压力：** ${node.handoff_pressure}`] : []),
    ].join("\n");
  });

  const roadmapSections = roadmaps
    .filter((item) => (
      item.status === "approved"
      && nodeVersions.has(`${item.source_node_id}:${item.source_node_version}`)
    ))
    .sort((left, right) => left.episode_number - right.episode_number)
    .map((item) => [
      `## 第 ${item.episode_number} 集${item.episode_title?.trim() ? `《${item.episode_title.trim()}》` : ""}`,
      `- 本集目标：${item.episode_goal}`,
      `- 进入状态：${item.entry_state}`,
      `- 中心冲突：${item.central_conflict}`,
      `- 主角决定：${item.protagonist_decision}`,
      `- 情绪变化：${item.emotional_movement}`,
      `- 本集回报：${item.episode_payoff}`,
      `- 退出状态：${item.exit_state}`,
      `- 结尾钩子：${item.ending_hook_type}：${item.cliffhanger}`,
      `- 下一集义务：${item.next_episode_obligation}`,
    ].join("\n"));

  return [
    `# ${projectTitle} · 剧情规划`,
    "",
    "# 剧情树",
    ...nodeSections.flatMap((section) => ["", section]),
    "",
    "# 分集路线图",
    ...roadmapSections.flatMap((section) => ["", section]),
    "",
  ].join("\n");
}

export function storyPlanningFilename(projectTitle: string): string {
  const safeTitle = projectTitle
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safeTitle || "未命名剧本"}-剧情规划.md`;
}

function comparePlanningNodes(left: StoryPlanNode, right: StoryPlanNode): number {
  const leftStart = left.planned_start_episode ?? Number.MAX_SAFE_INTEGER;
  const rightStart = right.planned_start_episode ?? Number.MAX_SAFE_INTEGER;
  return leftStart - rightStart
    || left.sequence_order - right.sequence_order
    || left.node_id.localeCompare(right.node_id);
}
