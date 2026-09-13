import type { StoryPlanNode } from "./story-planning-client.ts";
import type { CharacterDraft, EpisodeRoadmapItem } from "./types.ts";
import { isApprovedEpisodeRoadmap } from "./planning-coverage.ts";

const STORY_PLAN_ROOT_MARKER = "system_story_bible_root.v1";

export function episodeRoadmapSynopsis(item: EpisodeRoadmapItem): string {
  const synopsis = item.synopsis?.trim();
  if (synopsis) return synopsis;
  return [
    item.episode_goal,
    item.central_conflict,
    item.protagonist_decision,
    item.episode_payoff,
    item.exit_state,
  ].filter(Boolean).join("。 ");
}

export function episodeRoadmapLocations(item: EpisodeRoadmapItem): string {
  const locations = (item.locations ?? []).map((location) => location.trim()).filter(Boolean);
  if (locations.length) return locations.join("、");
  const headings = (item.scene_execution_plan ?? [])
    .map((scene) => scene.scene_heading
      .replace(/^(?:INT|EXT)\.\s*/i, "")
      .replace(/\s+(?:DAY|NIGHT|日|夜)\s*$/i, "")
      .trim())
    .filter(Boolean);
  return Array.from(new Set(headings)).join("、") || "场地待定";
}

function normalizedGenderLabel(gender: string): string {
  const normalized = gender.trim().toLowerCase();
  if (["女", "女性", "woman", "female"].includes(normalized)) return "女";
  if (["男", "男性", "man", "male"].includes(normalized)) return "男";
  return gender.trim() || "未指定";
}

export function episodeRoadmapCharacters(
  item: EpisodeRoadmapItem,
  characters: CharacterDraft[],
): string {
  return (item.character_refs ?? []).map((reference) => {
    const character = characters.find((candidate) => candidate.id === reference || candidate.name === reference);
    return character
      ? `${character.name}（${normalizedGenderLabel(character.gender)}）`
      : reference;
  }).join("、") || "人物待定";
}

export function toStoryPlanningMarkdown(
  projectTitle: string,
  nodes: StoryPlanNode[],
  roadmaps: EpisodeRoadmapItem[],
  characters: CharacterDraft[] = [],
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
      isApprovedEpisodeRoadmap(item)
      && nodeVersions.has(`${item.source_node_id}:${item.source_node_version}`)
    ))
    .sort((left, right) => left.episode_number - right.episode_number)
    .map((item) => {
      const title = item.episode_title?.trim() || "本集待命名";
      return [
      `## EP${String(item.episode_number).padStart(2, "0")}｜${title}`,
      `- 场地：${episodeRoadmapLocations(item)}`,
      `- 出场人物 & 性别：${episodeRoadmapCharacters(item, characters)}`,
      `- 梗概：${episodeRoadmapSynopsis(item)}`,
      ...(item.protagonist_cost?.trim() ? [`- 主角代价：${item.protagonist_cost.trim()}`] : []),
      ...(item.dramatic_units?.length
        ? ["- 戏剧单位：", ...item.dramatic_units.map((unit, index) => (
          `  ${index + 1}. ${unit.change_type}：${unit.trigger} → ${unit.choice} → ${unit.visible_consequence}`
            + (unit.evidence_hint?.trim() ? `（动作或对白证据：${unit.evidence_hint.trim()}）` : "")
        ))]
        : []),
      ].join("\n");
    });

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
