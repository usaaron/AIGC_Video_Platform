import type {
  EpisodePlan,
  StoryBible,
  StoryPlanNode,
} from "@/lib/story-planning-client";
import type {
  EpisodeRoadmapItem,
  EpisodeDramaticUnit,
  EpisodeSceneExecutionBeat,
  ScriptProject,
  StorylineDuty,
  StorylineDutyRole,
  EndingMode,
} from "@/lib/types";
import type { EpisodeThreeLayerContract } from "@/lib/types";
import type { MemoryRecall } from "@/lib/memory-recall";
import {
  normalizeEpisodeDialogueLines,
  normalizeEpisodeDurationSeconds,
} from "./generation-planning.ts";

export {
  episodeRoadmapCoverageThrough,
  approveEpisodeRoadmapItem,
  draftEpisodeRoadmapItem,
  isApprovedEpisodeRoadmap,
  normalizeEpisodeRoadmapItem,
  normalizeEpisodeRoadmaps,
} from "./planning-coverage.ts";
import {
  approveEpisodeRoadmapItem,
  draftEpisodeRoadmapItem,
  isApprovedEpisodeRoadmap,
  normalizeEpisodeRoadmapItem,
} from "./planning-coverage.ts";

export interface EpisodeGenerationConstraint {
  episodeNumber: number;
  episodePlan?: EpisodePlan;
  episodeRoadmap?: EpisodeRoadmapItem;
  storyPlanNode?: StoryPlanNode;
}

export interface EpisodeInstructionOptions {
  isSeriesFinale?: boolean;
  endingMode?: EndingMode;
}

export interface EpisodeGenerationLedgerPlan {
  plannedStoryLineRefs: string[];
  plannedSetupRefs: string[];
  plannedPayoffRefs: string[];
  plannedStoryBeat?: string;
}

const STORYLINE_SILENCE_THRESHOLD = 3;
const STORYLINE_DUTY_LIMIT = 20;

export interface EpisodeExecutionPlan {
  episode_number: number;
  ending_mode?: EndingMode;
  target_duration_seconds: number;
  planned_scene_count: number;
  planned_shot_count: number;
  planned_dialogue_line_count: number;
  episode_goal: string;
  entry_state: string;
  central_conflict: string;
  protagonist_decision: string;
  reveal: string | null;
  emotional_movement: string;
  stage_opposition?: string | null;
  episode_payoff?: string | null;
  pressure_escalation?: string | null;
  dramatic_units: EpisodeDramaticUnit[];
  protagonist_cost?: string | null;
  setup_refs: string[];
  payoff_refs: string[];
  exit_state: string;
  cliffhanger: string;
  character_refs: string[];
  story_line_refs: string[];
  continuity_requirements: string[];
  source_turning_points: string[];
  source_unit_story_beats: string[];
  ending_hook_type?: string | null;
  next_episode_obligation?: string | null;
  hook_payoff_target_episode?: number | null;
  scene_execution_plan: EpisodeSceneExecutionBeat[];
  execution_ready?: boolean;
  layer_contracts?: EpisodeThreeLayerContract | null;
}

export interface StoryNodeExecutionContext {
  node_id: string;
  node_version: number;
  title: string;
  start_episode: number;
  end_episode: number;
  episode_position: number;
  episode_function: string;
  narrative_purpose: string;
  entry_state: string;
  central_conflict: string;
  turning_points: string[];
  unit_story_beats: string[];
  unit_resolution: string | null;
  handoff_pressure: string | null;
  emotional_direction: string;
  exit_state: string;
}

export function episodeGenerationCharacterRefs(
  constraint: EpisodeGenerationConstraint | undefined,
): string[] {
  const plan = planningContract(constraint);
  return [...new Set(
    plan?.character_refs?.length
      ? plan.character_refs
      : constraint?.storyPlanNode?.character_refs ?? [],
  )];
}

export function episodeGenerationExecutionPlan(
  constraint: EpisodeGenerationConstraint | undefined,
): EpisodeExecutionPlan | undefined {
  const plan = planningContract(constraint);
  if (!plan) return undefined;
  const endingMode = "ending_mode" in plan && isEndingMode(plan.ending_mode)
    ? plan.ending_mode
    : undefined;
  const storyLineRefs = "story_line_refs" in plan ? plan.story_line_refs : [];
  const plannedDialogueLineCount = normalizeEpisodeDialogueLines(
    "planned_dialogue_line_count" in plan ? plan.planned_dialogue_line_count : undefined,
  );
  const sceneExecutionPlan = "scene_execution_plan" in plan
    && Array.isArray(plan.scene_execution_plan)
    ? rebalanceSceneDialogueTargets(plan.scene_execution_plan, plannedDialogueLineCount)
    : [];
  return {
    episode_number: plan.episode_number,
    ...(endingMode ? { ending_mode: endingMode } : {}),
    target_duration_seconds: "target_duration_seconds" in plan
      ? normalizeEpisodeDurationSeconds(plan.target_duration_seconds)
      : 90,
    planned_scene_count: "planned_scene_count" in plan
      ? Math.min(5, Math.max(1, Math.round(plan.planned_scene_count)))
      : 3,
    planned_shot_count: "planned_shot_count" in plan
      ? Math.min(20, Math.max(15, Math.round(plan.planned_shot_count)))
      : 16,
    planned_dialogue_line_count: plannedDialogueLineCount,
    episode_goal: plan.episode_goal,
    entry_state: plan.entry_state,
    central_conflict: plan.central_conflict,
    protagonist_decision: plan.protagonist_decision,
    reveal: plan.reveal ?? null,
    emotional_movement: plan.emotional_movement,
    stage_opposition: "stage_opposition" in plan ? plan.stage_opposition : null,
    episode_payoff: "episode_payoff" in plan ? plan.episode_payoff : null,
    pressure_escalation: "pressure_escalation" in plan ? plan.pressure_escalation : null,
    dramatic_units: "dramatic_units" in plan && Array.isArray(plan.dramatic_units)
      ? plan.dramatic_units
      : [],
    protagonist_cost: "protagonist_cost" in plan ? plan.protagonist_cost?.trim() || null : null,
    setup_refs: plan.setup_refs ?? [],
    payoff_refs: plan.payoff_refs ?? [],
    exit_state: plan.exit_state,
    cliffhanger: plan.cliffhanger,
    character_refs: plan.character_refs ?? [],
    story_line_refs: storyLineRefs ?? [],
    continuity_requirements: plan.continuity_requirements ?? [],
    source_turning_points: plan.source_turning_points ?? [],
    source_unit_story_beats: plan.source_unit_story_beats ?? [],
    ending_hook_type: "ending_hook_type" in plan ? plan.ending_hook_type : null,
    next_episode_obligation: "next_episode_obligation" in plan
      ? plan.next_episode_obligation
      : null,
    hook_payoff_target_episode: "hook_payoff_target_episode" in plan
      ? plan.hook_payoff_target_episode
      : null,
    scene_execution_plan: sceneExecutionPlan,
    ...("layer_contracts" in plan && plan.layer_contracts
      ? { layer_contracts: plan.layer_contracts }
      : {}),
  };
}

function isEndingMode(value: unknown): value is EndingMode {
  return value === "serial_hook"
    || value === "season_finale"
    || value === "series_finale";
}

function rebalanceSceneDialogueTargets(
  scenes: EpisodeSceneExecutionBeat[],
  target: number,
): EpisodeSceneExecutionBeat[] {
  if (!scenes.length) return [];
  const counts = scenes.map((scene) => Math.max(0, Math.round(scene.dialogue_line_target)));
  let total = counts.reduce((sum, count) => sum + count, 0);
  let cursor = 0;
  while (total < target) {
    counts[cursor % counts.length] += 1;
    total += 1;
    cursor += 1;
  }
  while (total > target) {
    const index = counts.reduce(
      (largest, count, candidate) => count > counts[largest] ? candidate : largest,
      0,
    );
    if (counts[index] === 0) break;
    counts[index] -= 1;
    total -= 1;
  }
  return scenes.map((scene, index) => ({
    ...scene,
    dialogue_line_target: counts[index],
  }));
}

export function storyNodeExecutionContext(
  constraint: EpisodeGenerationConstraint | undefined,
): StoryNodeExecutionContext | undefined {
  const node = constraint?.storyPlanNode;
  if (
    !node
    || !constraint
    || node.planned_start_episode === null
    || node.planned_end_episode === null
  ) return undefined;
  return {
    node_id: node.node_id,
    node_version: node.version,
    title: node.title,
    start_episode: node.planned_start_episode,
    end_episode: node.planned_end_episode,
    episode_position: constraint.episodeNumber - node.planned_start_episode + 1,
    episode_function: directScriptEpisodeFunction(
      constraint.episodeNumber,
      node.planned_start_episode,
      node.planned_end_episode,
    ),
    narrative_purpose: node.narrative_purpose,
    entry_state: node.entry_state,
    central_conflict: node.central_conflict,
    turning_points: node.turning_points,
    unit_story_beats: node.unit_story_beats ?? [],
    unit_resolution: node.unit_resolution,
    handoff_pressure: node.handoff_pressure,
    emotional_direction: node.emotional_direction,
    exit_state: node.exit_state,
  };
}

export function adaptiveEpisodeSceneCount(
  constraint: EpisodeGenerationConstraint | undefined,
): number {
  const plan = planningContract(constraint);
  if (!plan) return 3;
  if (
    "planned_scene_count" in plan
    && typeof plan.planned_scene_count === "number"
  ) {
    return Math.min(5, Math.max(1, Math.round(plan.planned_scene_count)));
  }

  let complexity = 0;
  if (plan.reveal?.trim()) complexity += 1;
  complexity += Math.min(2, plan.source_turning_points?.length ?? 0);
  complexity += Math.min(2, plan.source_unit_story_beats?.length ?? 0);
  if ((plan.setup_refs?.length ?? 0) > 0) complexity += 1;
  if ((plan.payoff_refs?.length ?? 0) > 0) complexity += 1;
  if ((plan.continuity_requirements?.length ?? 0) >= 4) complexity += 1;
  if (
    "story_line_refs" in plan
    && (plan.story_line_refs?.length ?? 0) >= 2
  ) complexity += 1;

  if (complexity <= 1) return 1;
  if (complexity <= 3) return 2;
  if (complexity <= 5) return 3;
  if (complexity <= 7) return 4;
  return 5;
}

export function plannedEpisodeDurationSeconds(
  constraint: EpisodeGenerationConstraint | undefined,
): number {
  const plan = planningContract(constraint);
  const value = plan && "target_duration_seconds" in plan
    ? plan.target_duration_seconds
    : undefined;
  return typeof value === "number" && Number.isFinite(value)
    ? normalizeEpisodeDurationSeconds(value)
    : 90;
}

export function plannedEpisodeShotCount(
  constraint: EpisodeGenerationConstraint | undefined,
): number {
  const plan = planningContract(constraint);
  const value = plan && "planned_shot_count" in plan
    ? plan.planned_shot_count
    : undefined;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(20, Math.max(15, Math.round(value)))
    : 16;
}

export function plannedEpisodeBodyReference(
  constraint: EpisodeGenerationConstraint | undefined,
  referenceCharacters: number,
): number {
  const durationScale = plannedEpisodeDurationSeconds(constraint) / 90;
  const shotScale = Math.sqrt(plannedEpisodeShotCount(constraint) / 16);
  const productionScale = Math.min(1.35, Math.max(0.7, (durationScale + shotScale) / 2));
  return Math.max(300, Math.round(referenceCharacters * productionScale));
}

export const DEFAULT_EXECUTION_BATCH_EPISODES = 10;
export const MIN_EPISODE_READY_SPAN = 8;
export const MAX_EPISODE_READY_SPAN = 12;

export function storyPlanNodeEpisodeSpan(node: StoryPlanNode): number | null {
  const startEpisode = node.planned_start_episode;
  const endEpisode = node.planned_end_episode;
  if (
    startEpisode === null
    || endEpisode === null
    || endEpisode < startEpisode
  ) return null;
  return endEpisode - startEpisode + 1;
}

export function isOversizedStoryPlanNode(node: StoryPlanNode): boolean {
  const span = storyPlanNodeEpisodeSpan(node);
  return span !== null && span > MAX_EPISODE_READY_SPAN;
}

type EpisodePlanningContract = EpisodePlan | EpisodeRoadmapItem;

function planningContract(
  constraint: EpisodeGenerationConstraint | undefined,
): EpisodePlanningContract | undefined {
  if (constraint?.episodeRoadmap && isApprovedEpisodeRoadmap(constraint.episodeRoadmap)) {
    return constraint.episodeRoadmap;
  }
  if (constraint?.episodePlan?.status === "approved") return constraint.episodePlan;
  return undefined;
}

export function buildEpisodeGenerationWindows(
  episodeNumbers: number[],
): number[][] {
  return episodeNumbers.map((episodeNumber) => [episodeNumber]);
}

export function mergeEpisodeRoadmaps(
  current: EpisodeRoadmapItem[],
  replacements: EpisodeRoadmapItem[],
): EpisodeRoadmapItem[] {
  const byIdentity = new Map<string, EpisodeRoadmapItem>();
  for (const item of [...current, ...replacements]) {
    const normalized = normalizeEpisodeRoadmapItem(item);
    byIdentity.set(
      `${normalized.source_node_id}:${normalized.source_node_version}:${normalized.story_bible_version}:${normalized.episode_number}`,
      normalized,
    );
  }
  return [...byIdentity.values()].sort((left, right) => (
    left.episode_number - right.episode_number
      || left.source_node_id.localeCompare(right.source_node_id)
      || left.source_node_version - right.source_node_version
  ));
}

export function replaceEpisodeRoadmapItem(
  current: EpisodeRoadmapItem[],
  replacement: EpisodeRoadmapItem,
): EpisodeRoadmapItem[] {
  const retained = current.filter((item) => !(
    item.story_bible_version === replacement.story_bible_version
    && item.episode_number >= replacement.episode_number
  ));
  return mergeEpisodeRoadmaps(retained, [replacement]);
}

export function storySegmentBodyReference(
  constraint: EpisodeGenerationConstraint | undefined,
  fallbackReference: number,
  scale = 1,
): number {
  const node = constraint?.storyPlanNode;
  const start = node?.planned_start_episode;
  const end = node?.planned_end_episode;
  const estimate = node?.estimated_script_body_characters;
  if (
    typeof start !== "number"
    || typeof end !== "number"
    || end < start
    || typeof estimate !== "number"
    || !Number.isFinite(estimate)
    || estimate <= 0
  ) {
    return fallbackReference;
  }
  const durationFloor = Math.round(fallbackReference * 0.8);
  const durationCeiling = Math.round(fallbackReference * 1.2);
  return Math.min(
    durationCeiling,
    Math.max(durationFloor, Math.round((estimate / (end - start + 1)) * scale)),
  );
}

export function isDirectScriptNode(node: StoryPlanNode): boolean {
  const span = storyPlanNodeEpisodeSpan(node);
  return (
    node.status === "approved"
    && span !== null
    && span >= MIN_EPISODE_READY_SPAN
    && span <= MAX_EPISODE_READY_SPAN
    && node.expansion_status === "episode_ready"
  );
}

export interface ApprovedScriptLeafRange {
  startEpisode: number;
  endEpisode: number;
  sourceNodeId: string;
  sourceNodeVersion: number;
  storyBibleVersion: number;
}

export type ApprovedScriptLeafDecision =
  | { status: "ready"; range: ApprovedScriptLeafRange }
  | { status: "gap"; nextEpisode: number }
  | { status: "unapproved"; nextEpisode: number }
  | { status: "complete" };

export function hasCompleteEpisodeRoadmap(
  node: StoryPlanNode,
  episodeRoadmaps: EpisodeRoadmapItem[],
): boolean {
  if (!isDirectScriptNode(node)) return false;
  const startEpisode = node.planned_start_episode as number;
  const endEpisode = node.planned_end_episode as number;
  const matchingItems = episodeRoadmaps.filter((item) => (
    isApprovedEpisodeRoadmap(item)
    && item.source_node_id === node.node_id
    && item.source_node_version === node.version
    && item.story_bible_version === node.story_bible_version
  ));
  const plannedEpisodes = new Set(matchingItems.map((item) => item.episode_number));
  return matchingItems.length === endEpisode - startEpisode + 1
    && plannedEpisodes.size === endEpisode - startEpisode + 1
    && Array.from(
      { length: endEpisode - startEpisode + 1 },
      (_, index) => startEpisode + index,
    ).every((episodeNumber) => plannedEpisodes.has(episodeNumber));
}

export function approvedScriptLeafRanges(
  storyPlanNodes: StoryPlanNode[],
  episodeRoadmaps: EpisodeRoadmapItem[],
  roadmapRequired = false,
): ApprovedScriptLeafRange[] {
  return storyPlanNodes
    .filter(isDirectScriptNode)
    .filter((node) => !roadmapRequired || hasCompleteEpisodeRoadmap(node, episodeRoadmaps))
    .map((node) => ({
      startEpisode: node.planned_start_episode as number,
      endEpisode: node.planned_end_episode as number,
      sourceNodeId: node.node_id,
      sourceNodeVersion: node.version,
      storyBibleVersion: node.story_bible_version,
    }))
    .sort((left, right) => (
      left.startEpisode - right.startEpisode || left.endEpisode - right.endEpisode
    ));
}

export function contiguousEpisodeCoverageThrough(episodeNumbers: number[]): number {
  const generatedEpisodes = new Set(episodeNumbers);
  let generatedThrough = 0;
  while (generatedEpisodes.has(generatedThrough + 1)) generatedThrough += 1;
  return generatedThrough;
}

export function nextReadyScriptPartEpisode(
  generatedEpisodeNumbers: number[],
  plannedThrough: number,
  totalEpisodes: number,
): number | null {
  const nextEpisode = contiguousEpisodeCoverageThrough(generatedEpisodeNumbers) + 1;
  const readyThrough = Math.min(plannedThrough, totalEpisodes);
  return nextEpisode <= readyThrough ? nextEpisode : null;
}

export function nextApprovedScriptLeafRange(
  storyPlanNodes: StoryPlanNode[],
  episodeRoadmaps: EpisodeRoadmapItem[],
  generatedEpisodeNumbers: number[],
  requestedRange: { startEpisode: number; endEpisode: number },
  roadmapRequired = false,
): ApprovedScriptLeafDecision {
  const nextEpisode = contiguousEpisodeCoverageThrough(generatedEpisodeNumbers) + 1;
  if (nextEpisode > requestedRange.endEpisode) return { status: "complete" };
  if (nextEpisode < requestedRange.startEpisode) return { status: "gap", nextEpisode };
  const containingLeaf = approvedScriptLeafRanges(
    storyPlanNodes,
    episodeRoadmaps,
    roadmapRequired,
  ).find((range) => (
    range.startEpisode <= nextEpisode && range.endEpisode >= nextEpisode
  ));
  if (
    !containingLeaf
    || containingLeaf.startEpisode < requestedRange.startEpisode
    || containingLeaf.endEpisode > requestedRange.endEpisode
  ) {
    return { status: "unapproved", nextEpisode };
  }
  return { status: "ready", range: containingLeaf };
}

export function approvedDirectScriptCoverageThrough(
  storyPlanNodes: StoryPlanNode[],
  options: {
    episodeRoadmaps?: EpisodeRoadmapItem[];
    roadmapRequired?: boolean;
  } = {},
): number {
  const ranges = storyPlanNodes
    .filter(isDirectScriptNode)
    .filter((node) => !options.roadmapRequired || hasCompleteEpisodeRoadmap(
      node,
      options.episodeRoadmaps ?? [],
    ))
    .map((node) => ({
      start: node.planned_start_episode as number,
      end: node.planned_end_episode as number,
    }))
    .sort((left, right) => left.start - right.start || right.end - left.end);
  let readyThrough = 0;
  for (const range of ranges) {
    if (range.start > readyThrough + 1) break;
    readyThrough = Math.max(readyThrough, range.end);
  }
  return readyThrough;
}


export function resolveEpisodeGenerationConstraints(
  episodePlans: EpisodePlan[],
  storyPlanNodes: StoryPlanNode[],
  startEpisode: number,
  endEpisode: number,
  episodeRoadmaps: EpisodeRoadmapItem[] = [],
  roadmapRequired = false,
): EpisodeGenerationConstraint[] {
  const approvedPlans = new Map(
    episodePlans
      .filter((plan) => plan.status === "approved")
      .map((plan) => [plan.episode_number, plan]),
  );
  const directNodes = new Map<number, StoryPlanNode>();
  const savedRoadmaps = new Map(
    episodeRoadmaps
      .filter(isApprovedEpisodeRoadmap)
      .map((item) => [
        `${item.source_node_id}:${item.source_node_version}:${item.story_bible_version}:${item.episode_number}`,
        item,
      ]),
  );
  const orderedDirectNodes = storyPlanNodes
    .filter(isDirectScriptNode)
    .sort((left, right) => (
      ((left.planned_end_episode as number) - (left.planned_start_episode as number))
      - ((right.planned_end_episode as number) - (right.planned_start_episode as number))
    ));
  for (const node of orderedDirectNodes) {
    for (
      let episodeNumber = node.planned_start_episode as number;
      episodeNumber <= (node.planned_end_episode as number);
      episodeNumber += 1
    ) {
      if (!directNodes.has(episodeNumber)) directNodes.set(episodeNumber, node);
    }
  }

  const constraints: EpisodeGenerationConstraint[] = [];
  for (let episodeNumber = startEpisode; episodeNumber <= endEpisode; episodeNumber += 1) {
    const episodePlan = approvedPlans.get(episodeNumber);
    const storyPlanNode = directNodes.get(episodeNumber);
    const episodeRoadmap = storyPlanNode
      ? savedRoadmaps.get(
        `${storyPlanNode.node_id}:${storyPlanNode.version}:${storyPlanNode.story_bible_version}:${episodeNumber}`,
      )
      : undefined;
    const roadmapMatchesNode = Boolean(episodeRoadmap && storyPlanNode);
    if (roadmapRequired && storyPlanNode && !roadmapMatchesNode) continue;
    if (!episodePlan && !storyPlanNode) continue;
    constraints.push(
      storyPlanNode
        ? {
            episodeNumber,
            storyPlanNode,
            ...(episodePlan ? { episodePlan } : {}),
            ...(roadmapMatchesNode ? { episodeRoadmap } : {}),
          }
        : { episodeNumber, episodePlan },
    );
  }
  return constraints;
}

export function episodeGenerationInstruction(
  constraint: EpisodeGenerationConstraint | undefined,
  userInstruction = "",
  options: EpisodeInstructionOptions = {},
): string | undefined {
  const plan = planningContract(constraint);
  const node = constraint?.storyPlanNode;
  const leafEpisodeFunction = node && constraint
    ? directScriptEpisodeFunction(
        constraint.episodeNumber,
        node.planned_start_episode as number,
        node.planned_end_episode as number,
      )
    : "";
  const nodeProgress = node && constraint ? [
    `当前生成第${constraint.episodeNumber}集`,
    `本剧情阶段覆盖第${node.planned_start_episode}-${node.planned_end_episode}集`,
    `这是该阶段第${constraint.episodeNumber - (node.planned_start_episode as number) + 1}集`,
    `本集阶段职责：${leafEpisodeFunction}`,
    "只写当前一集的正式剧情，承接上一集并产生新的事件、选择和结尾压力，不得一次写完整个阶段",
  ] : [];
  const openingContinuation = constraint && constraint.episodeNumber > 1
    ? "开场承接义务：必须在前两个场景内通过可见行动回应上一集遗留问题；可以升级或转化问题，但不能忽略、跳过或用旁白敷衍解决"
    : "";
  const endingMode = options.endingMode
    ?? (options.isSeriesFinale ? "series_finale" : undefined)
    ?? (plan && "ending_mode" in plan ? plan.ending_mode : undefined)
    ?? "serial_hook";
  const endingContinuation = endingMode === "series_finale"
    ? "本集是全剧最终集：优先兑现总纲结局、主要人物弧和核心伏笔，形成完整情绪收束；除非总纲明确预留下一季，否则不要强行制造未解决危机"
    : endingMode === "season_finale"
      ? "本集是本季收束集：完成本季主要因果与情绪结算，可留下下一季入口，但不得用无关突发事件制造尾钩"
      : plan
      ? `结尾追看契约：落实“${plan.cliffhanger}”，让最后一个可见事件自然产生下一集必须处理的后果、问题或选择；next_episode_question必须具体指向该后果`
      : node && constraint
        ? `结尾追看点类型：${directScriptEndingHook(
            constraint.episodeNumber,
            node.planned_start_episode as number,
          )}；最后一个可见事件必须由本集因果自然产生，并形成下一集必须承接的具体后果、问题或选择；不得使用与本集无关的突然来电、突然开门或身份空降制造虚假悬念`
        : "非最终集必须以本集因果产生的未解决压力、具体问题或艰难选择结束，并由下一集实际承接";
  const planningText = plan
    ? (endingMode === "series_finale" || endingMode === "season_finale" ? endingContinuation : "")
    : node ? [
    `本集剧情节点：${node.title}`,
    ...nodeProgress,
    `本集叙事职责：${node.narrative_purpose}`,
    `剧情概要：${node.synopsis}`,
    `进入状态：${node.entry_state}`,
    `中心冲突：${node.central_conflict}`,
    `关键转折：${node.turning_points.join("、")}`,
    node.unit_story_beats?.length ? `单位剧情因果链：${node.unit_story_beats.join("、")}` : "",
    node.unit_resolution ? `本单元必须完成的结算：${node.unit_resolution}` : "",
    node.handoff_pressure ? `结算后交给下一段的压力：${node.handoff_pressure}` : "",
    `情绪推进：${node.emotional_direction}`,
    `退出状态：${node.exit_state}`,
    openingContinuation,
    endingContinuation,
    node.setup_refs.length ? `本集设置：${node.setup_refs.join("、")}` : "",
    node.payoff_refs.length ? `本集回收：${node.payoff_refs.join("、")}` : "",
  ].filter(Boolean).join("；") : "";
  const explicitInstruction = userInstruction.trim().slice(0, 800);
  const planningBudget = Math.max(
    0,
    4000 - explicitInstruction.length - (explicitInstruction ? 1 : 0),
  );
  const combined = [
    planningText.slice(0, planningBudget),
    explicitInstruction,
  ].filter(Boolean).join("；");
  return combined || undefined;
}

export function episodeGenerationLedgerPlan(
  constraint: EpisodeGenerationConstraint | undefined,
): EpisodeGenerationLedgerPlan {
  const plan = planningContract(constraint);
  const node = constraint?.storyPlanNode;
  const planStoryLineRefs = plan && "story_line_refs" in plan
    ? plan.story_line_refs
    : [];
  const plannedStoryLineRefs = planStoryLineRefs.length
    ? planStoryLineRefs
    : node?.story_line_refs ?? [];
  const plannedSetupRefs = plan?.setup_refs ?? node?.setup_refs ?? [];
  const plannedPayoffRefs = plan?.payoff_refs ?? node?.payoff_refs ?? [];
  const plannedStoryBeat = plan
    ? [
        plan.episode_goal,
        `中心冲突：${plan.central_conflict}`,
        `退出状态：${plan.exit_state}`,
      ].join("；")
    : node && constraint
      ? [
          `${node.title}：${directScriptEpisodeFunction(
            constraint.episodeNumber,
            node.planned_start_episode as number,
            node.planned_end_episode as number,
          )}`,
          `中心冲突：${node.central_conflict}`,
          `退出状态：${node.exit_state}`,
        ].join("；")
      : undefined;
  return {
    plannedStoryLineRefs: [...new Set(plannedStoryLineRefs)],
    plannedSetupRefs: [...new Set(plannedSetupRefs)],
    plannedPayoffRefs: [...new Set(plannedPayoffRefs)],
    ...(plannedStoryBeat ? { plannedStoryBeat: plannedStoryBeat.slice(0, 1_000) } : {}),
  };
}

/**
 * Compile a bounded narrative-resource schedule for one episode.
 *
 * The approved route remains the source of episode intent. This additional
 * schedule only allocates scene time for duties already named by the approved
 * route. Quiet lines remain visible as review reminders without authoring a
 * new event merely because a threshold was reached.
 */
export function buildStorylineDuties(
  project: Pick<ScriptProject, "storyLines">,
  episodeNumber: number,
  plannedStoryLineRefs: string[] = [],
  sceneCount = 3,
  memoryRecall?: Pick<MemoryRecall, "capsules"> | null,
): StorylineDuty[] {
  const recalledProgress = new Map<string, number>();
  for (const capsule of memoryRecall?.capsules ?? []) {
    if (capsule.memory_type !== "story_line" || capsule.source_episode == null) continue;
    for (const ref of capsule.entity_refs) {
      const key = normalizeStorylineRef(ref);
      recalledProgress.set(key, Math.max(recalledProgress.get(key) ?? 0, capsule.source_episode));
    }
  }
  const planned = new Set(plannedStoryLineRefs.map(normalizeStorylineRef));
  const linesById = new Map(
    (project.storyLines ?? []).map((line) => [normalizeStorylineRef(line.id), line]),
  );
  const candidateIds = new Set<string>([
    ...planned,
    ...linesById.keys(),
  ]);
  const candidates = [...candidateIds]
    .map((id) => linesById.get(id) ?? {
      id,
      title: id,
      type: "subplot" as const,
      summary: "本集需要通过可见事件补足该故事线。",
      currentState: "",
      lastProgressedEpisode: 0,
      nextRequiredStep: null,
      status: "active" as const,
      characterIds: [],
      episodeBeats: [],
      userEdited: false,
    })
    .filter((line) => line.status !== "resolved" || planned.has(normalizeStorylineRef(line.id)))
    .map((line) => {
      const lineId = normalizeStorylineRef(line.id);
      const role = storylineRole(line.type);
      const lastProgressedEpisode = Math.max(
        0,
        line.lastProgressedEpisode ?? 0,
        line.episodeBeats.at(-1)?.episodeNumber ?? 0,
        recalledProgress.get(lineId) ?? 0,
      );
      const silenceEpisodes = Math.max(
        0,
        episodeNumber - lastProgressedEpisode - 1,
      );
      const isPlanned = planned.has(lineId);
      const isMain = role === "main";
      const mustProgress = isPlanned;
      const needsReview = !isPlanned && silenceEpisodes >= STORYLINE_SILENCE_THRESHOLD;
      const nextRequiredStep = line.nextRequiredStep?.trim() || null;
      const objective = isPlanned && nextRequiredStep
        ? `完成${line.title}的本集局部目标：${nextRequiredStep}`
        : `推进${line.title}：${line.currentState?.trim() || line.summary.trim()}`;
      const requiredProgress = nextRequiredStep
        ? `通过可见事件让${line.title}完成：${nextRequiredStep}`
        : `通过可见事件改变${line.title}当前状态，并留下可验证结果。`;
      const canDefer = !isMain;
      return {
        story_line_id: line.id,
        role,
        must_progress: mustProgress,
        objective: compactDutyText(objective),
        required_progress: compactDutyText(requiredProgress),
        assigned_scene_numbers: [],
        can_defer: canDefer,
        defer_until_episode: mustProgress ? null : needsReview ? episodeNumber + 1 : episodeNumber + 2,
        defer_reason: mustProgress
          ? null
          : needsReview
            ? `系统复核提醒：已连续沉默${silenceEpisodes}集；尚未被本集批准规划引用，不自动生成剧情，请在下一集规划时决定推进或延期。`
            : silenceEpisodes > 0
              ? `本集资源优先给已批准职责；已连续沉默${silenceEpisodes}集，尚未达到复核阈值。`
            : "尚未达到支线沉默阈值，暂不占用本集场景。",
        last_progressed_episode: lastProgressedEpisode,
        silence_episodes: silenceEpisodes,
        next_required_step: nextRequiredStep,
      } satisfies StorylineDuty;
    })
    .sort((left, right) => (
      Number(right.must_progress) - Number(left.must_progress)
      || Number(right.role === "main") - Number(left.role === "main")
      || Number(planned.has(normalizeStorylineRef(right.story_line_id)))
        - Number(planned.has(normalizeStorylineRef(left.story_line_id)))
      || right.silence_episodes - left.silence_episodes
      || left.story_line_id.localeCompare(right.story_line_id)
    ))
    .slice(0, STORYLINE_DUTY_LIMIT);

  const safeSceneCount = Math.max(1, Math.min(50, Math.round(sceneCount) || 1));
  const sceneNumbers = Array.from({ length: safeSceneCount }, (_, index) => index + 1);
  let nextSupportScene = 1;
  return candidates.map((duty) => {
    if (!duty.must_progress) return duty;
    const isMain = duty.role === "main";
    const assigned = isMain
      ? [sceneNumbers[0]]
      : [sceneNumbers[Math.min(nextSupportScene++, sceneNumbers.length - 1)]];
    return { ...duty, assigned_scene_numbers: assigned };
  });
}

function storylineRole(value: string): StorylineDutyRole {
  return value === "main" || value === "character_arc" ? value : "subplot";
}

function normalizeStorylineRef(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function compactDutyText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 800);
}

function directScriptEndingHook(
  episodeNumber: number,
  startEpisode: number,
): string {
  const hookTypes = [
    "行动后果升级：本集选择产生更大且必须立即处理的代价",
    "信息揭示或认知反转：新事实改变人物对当前冲突的理解",
    "两难选择：把一个不可回避且会损失某物的决定留给下一集",
    "关系或立场突变：信任、联盟、身份或力量关系发生可见变化",
    "阶段性回报带出更大问题：先兑现当前期待，再暴露新的因果压力",
  ];
  return hookTypes[(episodeNumber - startEpisode) % hookTypes.length];
}

export function storyBibleEpisodeContext(
  storyBible: StoryBible,
  constraint: EpisodeGenerationConstraint | undefined,
): string {
  const node = constraint?.storyPlanNode;
  const plan = planningContract(constraint);
  const characterRefs = new Set(
    plan?.character_refs?.length
      ? plan.character_refs
      : node?.character_refs ?? [],
  );
  const planStoryLineRefs = plan && "story_line_refs" in plan
    ? plan.story_line_refs
    : [];
  const storyLineRefs = new Set(
    planStoryLineRefs.length ? planStoryLineRefs : node?.story_line_refs ?? [],
  );
  const relevantCharacters = characterRefs.size
    ? storyBible.character_registry.filter((item) => characterRefs.has(item.character_ref))
    : storyBible.character_registry;
  const relevantArcs = characterRefs.size
    ? storyBible.character_arc_targets.filter((item) => characterRefs.has(item.character_ref))
    : storyBible.character_arc_targets;
  const relevantRelationships = characterRefs.size
    ? storyBible.relationships.filter((item) => (
        characterRefs.has(item.source_character_ref)
        || characterRefs.has(item.target_character_ref)
      ))
    : storyBible.relationships;
  const relevantStoryLines = storyLineRefs.size
    ? storyBible.story_lines.filter((item) => storyLineRefs.has(item.story_line_id))
    : storyBible.story_lines;
  const relevantSetupPayoffRefs = new Set([
    ...(plan?.setup_refs ?? []),
    ...(plan?.payoff_refs ?? []),
  ]);
  const globalAnchor = [
    `总纲锚点：${storyBible.story_bible_id} v${storyBible.version}`,
    `故事核心：${compact(storyBible.core_premise, 320)}`,
    `全剧目标：${compact(storyBible.series_goal, 260)}`,
    `主题：${compact(storyBible.theme, 100)}`,
    `中心冲突：${compact(storyBible.central_conflict, 260)}`,
    `结局方向：${compact(storyBible.ending_direction, 260)}`,
    listLine("锁定事实", storyBible.locked_facts, 8, 420),
    listLine("世界规则", storyBible.world_rules, 6, 300),
    listLine("避免方向", storyBible.avoid_patterns, 6, 240),
  ].filter(Boolean).join("\n").slice(0, 980);
  const routeAnchor = [
    relevantCharacters.length
      ? `本模块角色：${relevantCharacters.slice(0, 8).map((item) => `${item.character_ref}=${item.name}（${item.role}）`).join("；")}`
      : "",
    relevantArcs.length
      ? `相关人物弧：${relevantArcs.slice(0, 6).map((item) => [
          item.character_ref,
          `外部目标=${item.external_goal}`,
          item.internal_need ? `内在需要=${item.internal_need}` : "",
          `目标状态=${item.target_state}`,
          item.protected_traits.length ? `保护特质=${item.protected_traits.join("、")}` : "",
        ].filter(Boolean).join("，")).join("；")}`
      : "",
    relevantRelationships.length
      ? `相关关系：${relevantRelationships.slice(0, 6).map((item) => [
          `${item.source_character_ref}->${item.target_character_ref}`,
          item.relationship_type,
          `目标=${item.target_direction}`,
          item.locked ? "锁定" : "可演化",
        ].join("，")).join("；")}`
      : "",
    relevantStoryLines.length
      ? `相关故事线：${relevantStoryLines.slice(0, 6).map((item) => `${item.story_line_id}《${item.title}》：${compact(item.premise, 180)}；收束=${compact(item.planned_resolution, 180)}`).join("；")}`
      : "",
    relevantSetupPayoffRefs.size
      ? listLine(
          "本集相关伏笔",
          storyBible.major_setup_payoff_refs.filter((ref) => relevantSetupPayoffRefs.has(ref)),
          12,
          360,
        )
      : "",
  ].filter(Boolean).join("\n").slice(0, 1_000);
  return [
    globalAnchor,
    routeAnchor,
    "总纲只负责全剧不变方向；本模块剧情由已批准剧情部分负责，本集事件由分集规划负责，最新人物与世界变化以连续性记忆为准。",
  ].filter(Boolean).join("\n").slice(0, 2_180);
}

export function longRangeStoryAnchor(storyBible: StoryBible): string {
  return [
    `故事核心：${compact(storyBible.core_premise, 420)}`,
    `全剧目标：${compact(storyBible.series_goal, 420)}`,
    `结局方向：${compact(storyBible.ending_direction, 420)}`,
    listLine("锁定事实", storyBible.locked_facts, 12, 700),
    listLine("世界规则", storyBible.world_rules, 8, 500),
  ].filter(Boolean).join("\n").slice(0, 1_800);
}

export function storyModuleHandoff(
  constraint: EpisodeGenerationConstraint | undefined,
): string | undefined {
  const node = constraint?.storyPlanNode;
  if (!node || node.planned_start_episode !== constraint?.episodeNumber) return undefined;
  return [
    `当前模块：${node.title}（第${node.planned_start_episode}-${node.planned_end_episode}集）`,
    `模块入口：${node.entry_state}`,
    `模块目标：${node.narrative_purpose}`,
    `中心冲突：${node.central_conflict}`,
    node.unit_resolution ? `模块必须结算：${node.unit_resolution}` : "",
    node.handoff_pressure ? `模块出口压力：${node.handoff_pressure}` : "",
  ].filter(Boolean).join("\n").slice(0, 3_000);
}

function compact(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function listLine(
  label: string,
  values: string[],
  maxItems: number,
  maxLength: number,
): string {
  if (!values.length) return "";
  return `${label}：${values.slice(0, maxItems).join("；")}`.slice(0, maxLength);
}

function directScriptEpisodeFunction(
  episodeNumber: number,
  startEpisode: number,
  endEpisode: number,
): string {
  const episodeCount = endEpisode - startEpisode + 1;
  const offset = episodeNumber - startEpisode;
  if (episodeCount <= 1) {
    return "在本集内完成该剧情节点的进入、对抗、转折与退出，并留下通向下一节点的新压力";
  }
  if (offset === 0) {
    return "用可见事件启动该阶段冲突，让主角作出第一次具体选择并立即承担后果";
  }
  if (offset === episodeCount - 1) {
    return "兑现该阶段的核心冲突与关键转折，形成明确状态变化并把压力传递给下一剧情节点";
  }
  const progress = offset / (episodeCount - 1);
  if (progress < 0.4) {
    return "增加新的阻力、信息或关系变化，迫使主角调整行动，不能重复阶段开端";
  }
  if (progress < 0.7) {
    return "制造改变理解或力量关系的中段反转，让既有做法失效并迫使主角重新选择";
  }
  return "提高代价并收紧选择空间，为阶段收束准备不可回避的决定或对抗";
}
