import type { StoryPlanNode } from "./story-planning-client.ts";
import type { CharacterDraft, EpisodeRoadmapItem } from "./types.ts";
import { isApprovedEpisodeRoadmap } from "./planning-coverage.ts";
import { characterMatchesReference, characterReferenceAliases } from "./character-reference";

const STORY_PLAN_ROOT_MARKER = "system_story_bible_root.v1";

/** Read-only labels for authored exports; unknown technical references never become invented facts. */
export function planningExportLabels(characters: ReadonlyArray<Pick<CharacterDraft, "id" | "name">>) {
  const names = new Map(characters.flatMap(character => characterReferenceAliases(character.id)
    .map(reference => [reference, character.name] as const)));
  const missingCharacters = new Map<string, string>();
  const references = new Map<string, string>();
  const technicalCharacter = /^(?:story-bible-)?character[.:][A-Za-z0-9_.:-]+$/;
  const character = (reference: string): string => {
    const known = names.get(reference) ?? names.get(reference.replace(/^story-bible-/, ""));
    if (known) return known;
    if (!technicalCharacter.test(reference)) return reference;
    if (!missingCharacters.has(reference)) missingCharacters.set(reference, `未匹配人物（${missingCharacters.size + 1}）`);
    return missingCharacters.get(reference)!;
  };
  const text = (value: string): string => value.replace(
    /(?<![A-Za-z0-9_.:-])(?:story-bible-)?character[.:][A-Za-z0-9_.:-]+/g,
    character,
  );
  const reference = (value: string): string => {
    if (!/^(?:(?:setup|payoff)[._:-][A-Za-z0-9_.:-]+|generated\.setup_payoff\.[a-f0-9]{12})$/.test(value.trim())) return text(value);
    if (!references.has(value)) references.set(value, `伏笔 ${references.size + 1}（原规划未附文字说明）`);
    return references.get(value)!;
  };
  return { character, text, reference };
}

function detail(label: string, value: string | null | undefined): string[] {
  return value?.trim() ? [`- ${label}：${value.trim()}`] : [];
}

function details(label: string, values: string[] | undefined): string[] {
  const present = (values ?? []).filter(value => value.trim());
  return present.length ? [`- ${label}：`, ...present.map(value => `  - ${value}`)] : [];
}

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
  labels = planningExportLabels(characters),
): string {
  return (item.character_refs ?? []).map((reference) => {
    const character = characters.find((candidate) => characterMatchesReference(candidate, reference));
    return character
      ? `${character.name}（${normalizedGenderLabel(character.gender)}）`
      : labels.character(reference);
  }).join("、") || "人物待定";
}

export function toStoryPlanningMarkdown(
  projectTitle: string,
  nodes: StoryPlanNode[],
  roadmaps: EpisodeRoadmapItem[],
  characters: CharacterDraft[] = [],
): string {
  const labels = planningExportLabels(characters);
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
      ...(node.episode_developments?.length
        ? ["", "### 逐集事件安排", ...node.episode_developments.map((item) => `第${item.episode_number}集：${item.synopsis}\n\n进入：${item.entry_state}\n退出：${item.exit_state}`)]
        : []),
      ...(node.handoff_pressure ? ["", `**下一部分压力：** ${node.handoff_pressure}`] : []),
      ...details("关键转折", node.turning_points),
      ...details("本部分埋下的伏笔", node.setup_refs?.map(labels.reference)),
      ...details("本部分兑现的伏笔", node.payoff_refs?.map(labels.reference)),
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
      `- 出场人物 & 性别：${episodeRoadmapCharacters(item, characters, labels)}`,
      `- 梗概：${episodeRoadmapSynopsis(item)}`,
      "", "### 本集剧情与衔接",
      ...detail("进入状态", item.entry_state),
      ...detail("本集目标", item.episode_goal),
      ...detail("中心冲突", item.central_conflict),
      ...detail("本阶段阻力", item.stage_opposition),
      ...detail("主角决定", item.protagonist_decision),
      ...detail("本集揭示", item.reveal),
      ...detail("情绪变化", item.emotional_movement),
      ...detail("本集兑现", item.episode_payoff),
      ...detail("压力升级", item.pressure_escalation),
      ...detail("退出状态", item.exit_state),
      ...detail("结尾悬念", item.cliffhanger),
      ...detail("结尾钩子类型", item.ending_hook_type),
      ...detail("下一集必须承接", item.next_episode_obligation),
      ...(item.hook_payoff_target_episode != null ? [`- 钩子计划兑现：第 ${item.hook_payoff_target_episode} 集`] : []),
      ...details("连续性要求", item.continuity_requirements),
      ...details("本集埋下的伏笔", item.setup_refs?.map(labels.reference)),
      ...details("本集兑现的伏笔", item.payoff_refs?.map(labels.reference)),
      ...(item.protagonist_cost?.trim() ? [`- 主角代价：${item.protagonist_cost.trim()}`] : []),
      ...(item.dramatic_units?.length
        ? ["- 戏剧单位：", ...item.dramatic_units.map((unit, index) => (
          `  ${index + 1}. ${unit.change_type}：${unit.trigger} → ${unit.choice} → ${unit.visible_consequence}`
            + (unit.evidence_hint?.trim() ? `（动作或对白证据：${unit.evidence_hint.trim()}）` : "")
        ))]
        : []),
      "", "### 执行预算",
      ...(item.target_duration_seconds != null ? [`- 目标时长：${item.target_duration_seconds} 秒`] : []),
      ...(item.planned_scene_count != null ? [`- 计划场数：${item.planned_scene_count}`] : []),
      ...(item.planned_shot_count != null ? [`- 计划镜头数：${item.planned_shot_count}`] : []),
      ...(item.planned_dialogue_line_count != null ? [`- 计划对白：${item.planned_dialogue_line_count} 条`] : []),
      ...(item.scene_execution_plan ?? []).flatMap(scene => [
        "", `### 场 ${scene.scene_number}｜${scene.scene_heading}`,
        ...detail("出场人物", scene.character_refs.map(labels.character).join("、")),
        ...detail("场景目标", scene.scene_objective),
        ...detail("阻力", scene.opposition),
        ...detail("信息变化", scene.information_shift),
        ...detail("选择或代价", scene.choice_or_cost),
        ...detail("可见行动", scene.visible_action),
        ...detail("转折或揭示", scene.turn_or_reveal),
        ...detail("对白目的", scene.dialogue_objective),
        `- 对白预算：${scene.dialogue_line_target} 条`,
        `- 镜头预算：${scene.shot_target} 个`,
        ...details("动作或对白证据", scene.evidence_requirements),
        ...details("本场不得改变", scene.forbidden_changes),
        ...detail("场末状态", scene.exit_state),
      ]),
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
  ].map(labels.text).join("\n");
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
