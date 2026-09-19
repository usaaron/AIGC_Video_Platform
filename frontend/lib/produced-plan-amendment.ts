import type { EpisodeRoadmapItem, ScriptProject } from "./types";
import type { StoryBible, StoryPlanNode } from "./story-planning-client";
import { episodeRoadmapReadinessIssues } from "./planning-coverage";
import { planningRevisionEpoch, planningRevisionSourceIssues } from "./planning-revision";

export const PRODUCED_PLAN_EDITABLE_FIELDS = [
  "episode_title", "synopsis", "locations", "character_refs", "scene_execution_plan",
  "dramatic_units", "emotional_movement", "protagonist_cost", "episode_goal", "central_conflict",
  "protagonist_decision", "stage_opposition", "episode_payoff", "pressure_escalation", "reveal",
  "continuity_requirements", "target_duration_seconds", "planned_scene_count", "planned_shot_count",
  "planned_dialogue_line_count",
] as const satisfies readonly (keyof EpisodeRoadmapItem)[];

export interface ProducedPlanAmendmentCandidate {
  source: ScriptProject;
  episodeNumbers: number[];
  plans: EpisodeRoadmapItem[];
  reason: string;
}

function amendmentEpisodeRange(project: ScriptProject, first: number, last: number, reason: string): number[] {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last - first >= 10) {
    throw new Error("请选择连续的已保存正文集数，每次最多10集。");
  }
  if (reason.trim().length < 5) throw new Error("请用至少5个字符说明本次执行规划修订的原因。");
  if (project.planningSession?.phase !== "script" || project.planningSession.status !== "approved") {
    throw new Error("请先确认规划，再修订已生成集的执行规划。");
  }
  const episodeNumbers = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  if (episodeNumbers.some((number) => !project.episodes.some((item) => item.episodeNumber === number))) {
    throw new Error("本次范围必须全部已有保存正文。");
  }
  if (project.episodes.some((episode) => Boolean(episode.sourceAmendment))) {
    throw new Error("请先完成已有正文修订和依赖复核，再开启新的执行规划修订。");
  }
  return episodeNumbers;
}

/** Candidates stay local; opening the editor never unlocks or mutates saved plans. */
export function createProducedPlanAmendmentCandidate(
  project: ScriptProject, first: number, last: number, reason: string,
): ProducedPlanAmendmentCandidate {
  const episodeNumbers = amendmentEpisodeRange(project, first, last, reason);
  const plans = episodeNumbers.map((number) => {
    const matches = (project.episodeRoadmaps ?? []).filter((item) => item.episode_number === number);
    if (matches.length !== 1) throw new Error(`第${number}集规划来源不唯一，请先核对当前版本。`);
    return { ...structuredClone(matches[0]), status: "draft" as const };
  });
  return { source: structuredClone(project), episodeNumbers, plans, reason };
}

function sourceContent(project: ScriptProject): string {
  const { serverSync: _serverSync, ...content } = project;
  return JSON.stringify(content);
}

export function producedPlanCandidateMatchesSource(candidate: ProducedPlanAmendmentCandidate, current: ScriptProject): boolean {
  return sourceContent(candidate.source) === sourceContent(current);
}

function frozenPlanFields(plan: EpisodeRoadmapItem): Record<string, unknown> {
  const editable = new Set<string>([...PRODUCED_PLAN_EDITABLE_FIELDS, "status", "execution_ready", "layer_contracts"]);
  return Object.fromEntries(Object.entries(plan).filter(([key]) => !editable.has(key)));
}

export function producedPlanAmendmentIssues(
  candidate: ProducedPlanAmendmentCandidate, nodes: StoryPlanNode[], bible: StoryBible,
): string[] {
  const issues: string[] = [];
  if (candidate.reason.trim().length < 5) issues.push("请用至少5个字符说明本次执行规划修订的原因。");
  if (!candidate.episodeNumbers.length || candidate.episodeNumbers.length > 10
    || candidate.episodeNumbers.some((number, index) => !Number.isInteger(number) || number < 1
      || (index > 0 && number !== candidate.episodeNumbers[index - 1] + 1))
    || candidate.plans.length !== candidate.episodeNumbers.length
    || candidate.plans.some((plan, index) => plan.episode_number !== candidate.episodeNumbers[index])) {
    return [...issues, "候选集数与本次修订范围不一致。"];
  }
  for (const plan of candidate.plans) {
    const prefix = `第${plan.episode_number}集：`;
    const original = candidate.source.episodeRoadmaps?.find((item) => item.episode_number === plan.episode_number);
    if (!original || JSON.stringify(frozenPlanFields(plan)) !== JSON.stringify(frozenPlanFields(original))) {
      issues.push(`${prefix}不能改动父层来源、批准事件、入场或离场状态。`);
      continue;
    }
    const node = nodes.find((entry) => entry.node_id === plan.source_node_id && entry.version === plan.source_node_version);
    if (!node || node.status !== "approved" || bible.status !== "approved" || bible.version !== plan.story_bible_version) {
      issues.push(`${prefix}当前已批准上层来源不存在或已变化。`); continue;
    }
    issues.push(...planningRevisionSourceIssues(plan, node).map((issue) => prefix + issue));
    const allowedCast = new Set(node.character_refs.filter((ref) => bible.character_refs.includes(ref)));
    if (!plan.character_refs.length || plan.character_refs.some((ref) => !allowedCast.has(ref))
      || plan.scene_execution_plan?.some((scene) => !scene.character_refs.length
        || scene.character_refs.some((ref) => !plan.character_refs.includes(ref)))) {
      issues.push(`${prefix}出场人物必须属于已批准上层角色，且场内角色包含在本集角色中。`);
    }
    const scenes = plan.scene_execution_plan ?? [];
    const total = plan.planned_dialogue_line_count;
    if (total == null || !Number.isInteger(total) || total < 25 || total > 35
      || scenes.some((scene) => !Number.isInteger(scene.dialogue_line_target) || scene.dialogue_line_target < 0 || scene.dialogue_line_target > 35)
      || scenes.reduce((sum, scene) => sum + scene.dialogue_line_target, 0) !== total) {
      issues.push(`${prefix}整集须为25–35句，分场对白目标之和须等于整集目标。`);
    }
    if (!Number.isInteger(plan.target_duration_seconds) || plan.target_duration_seconds < 75 || plan.target_duration_seconds > 115
      || scenes.length < 1 || scenes.length > 5 || scenes.length !== plan.planned_scene_count
      || !Number.isInteger(plan.planned_shot_count) || plan.planned_shot_count < 15 || plan.planned_shot_count > 20
      || scenes.some((scene) => !Number.isInteger(scene.shot_target) || scene.shot_target < 1)
      || scenes.reduce((sum, scene) => sum + scene.shot_target, 0) !== plan.planned_shot_count) {
      issues.push(`${prefix}请核对75–115秒、1–5场及15–20镜头，并保持分场数量合计一致。`);
    }
    if (scenes.at(-1)?.exit_state !== plan.exit_state) issues.push(`${prefix}末场离场状态须与已批准本集离场状态一致。`);
    issues.push(...episodeRoadmapReadinessIssues(plan).map((issue) => prefix + issue));
  }
  return issues;
}

export function buildProducedPlanAmendmentSnapshot(
  current: ScriptProject, candidate: ProducedPlanAmendmentCandidate,
  nodes: StoryPlanNode[], bible: StoryBible,
): ScriptProject {
  if (!producedPlanCandidateMatchesSource(candidate, current)) throw new Error("项目在候选编辑期间已变化，请重新载入当前规划后再修订。");
  amendmentEpisodeRange(current, candidate.episodeNumbers[0], candidate.episodeNumbers.at(-1)!, candidate.reason);
  if (current.activeGenerationTask?.status === "running") throw new Error("请等待当前任务停止并保存，再采用执行规划修订。");
  const issues = producedPlanAmendmentIssues(candidate, nodes, bible);
  if (issues.length) throw new Error(issues.join("\n"));
  const replacements = new Map(candidate.plans.map((plan) => {
    const { execution_ready: _ready, layer_contracts: _contracts, ...authored } = plan;
    return [plan.episode_number, { ...authored, status: "draft" as const }] as const;
  }));
  const unchanged = candidate.plans.filter((plan) => {
    const original = current.episodeRoadmaps!.find((item) => item.episode_number === plan.episode_number)!;
    return !PRODUCED_PLAN_EDITABLE_FIELDS.some((key) => JSON.stringify(plan[key]) !== JSON.stringify(original[key]));
  });
  if (unchanged.length) throw new Error(`第${unchanged.map(plan => plan.episode_number).join("、")}集尚未修改执行规划。每个所选集均须有实际修改，请缩小范围或完成候选。`);
  return {
    ...current,
    planningRevisionEpoch: planningRevisionEpoch(current) + 1,
    producedPlanAmendmentRequest: {
      amendmentId: `produced-plan-amendment.${crypto.randomUUID()}`,
      sourceWorkspaceRevision: current.serverSync?.workspaceRevision ?? 0,
      sourcePlanningRevisionEpoch: planningRevisionEpoch(current),
      episodeNumbers: [...candidate.episodeNumbers], reason: candidate.reason.trim(),
    },
    episodeRoadmaps: current.episodeRoadmaps!.map((item) => replacements.get(item.episode_number) ?? item),
    updatedAt: new Date().toISOString(),
  };
}

/** Planning approval never clears the independent body-revision/review marker. */
export function approveProducedPlanAmendmentEpisode(
  project: ScriptProject, episodeNumber: number, nodes: StoryPlanNode[], bible: StoryBible,
): ScriptProject {
  const receipt = project.producedPlanAmendments?.findLast((entry) => entry.episodeNumbers.includes(episodeNumber));
  if (!receipt) throw new Error("该集没有已采用的执行规划修订记录。");
  const plan = project.episodeRoadmaps?.find((entry) => entry.episode_number === episodeNumber);
  if (!plan || plan.status !== "draft") throw new Error("本集没有待批准的修订规划。");
  const marker = project.episodes.find(episode => episode.episodeNumber === episodeNumber)?.sourceAmendment;
  if (marker?.status !== "revision_required" || marker.amendmentId !== receipt.amendmentId) {
    throw new Error("本集不属于当前待处理的执行规划修订。");
  }
  const issues = producedPlanAmendmentIssues({ source: project, plans: [plan], episodeNumbers: [episodeNumber], reason: receipt.reason }, nodes, bible);
  if (issues.length) throw new Error(issues.join("\n"));
  return { ...project, episodeRoadmaps: project.episodeRoadmaps!.map((entry) => entry === plan ? { ...entry, status: "approved" } : entry), updatedAt: new Date().toISOString() };
}
