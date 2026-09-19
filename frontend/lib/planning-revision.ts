import type { EpisodeRoadmapItem, ScriptProject, StoryTreeQualityAudit } from "./types";
import { CURRENT_STORY_REVIEW_CONTRACT_VERSION, type StoryPlanNode } from "./story-planning-client";

export function planningRevisionEpoch(project: Pick<ScriptProject, "planningRevisionEpoch">): number {
  return project.planningRevisionEpoch ?? 0;
}

export function isPlanningRevisionActive(project: Pick<ScriptProject, "planningRevision">): boolean {
  return project.planningRevision?.status === "active";
}

/** Include saved raw bodies and edited bodies; an unconfirmed body is still written. */
export function nextUnwrittenPlanningEpisode(project: Pick<ScriptProject, "episodes">): number {
  return Math.max(0, ...project.episodes.map((episode) => episode.episodeNumber)) + 1;
}

export function planningRevisionNodeLocked(project: ScriptProject, node: StoryPlanNode): boolean {
  const revision = project.planningRevision;
  return revision?.status === "active" && (node.planned_start_episode == null
    || node.planned_end_episode == null || node.planned_start_episode < revision.startEpisode);
}

export function planningRevisionEpisodeLocked(project: ScriptProject, episodeNumber: number): boolean {
  const revision = project.planningRevision;
  return revision?.status === "active" && episodeNumber < revision.startEpisode;
}

export function startPlanningRevision(project: ScriptProject, startEpisode = nextUnwrittenPlanningEpisode(project)): ScriptProject {
  if (isPlanningRevisionActive(project)) throw new Error("后续规划修订已经开始，请继续当前修订。");
  if (project.planningSession?.phase !== "script" || project.planningSession.status !== "approved") {
    throw new Error("请先确认当前规划，再开启后续修订。");
  }
  if (!Number.isInteger(startEpisode) || startEpisode < nextUnwrittenPlanningEpisode(project)
    || startEpisode > project.generationSettings.episodeCount) {
    throw new Error("只能修订尚无正文的后续集数。");
  }
  if (project.activeGenerationTask?.status === "running") {
    throw new Error("请等待当前生成任务停止并保存，再修订后续规划。");
  }
  const now = new Date().toISOString();
  return {
    ...project,
    planningRevisionEpoch: planningRevisionEpoch(project) + 1,
    planningRevision: {
      revisionId: `planning-revision.${crypto.randomUUID()}`,
      status: "active", startEpisode,
      sourceWorkspaceRevision: project.serverSync?.workspaceRevision ?? 0,
      startedAt: now,
      originalRoadmaps: structuredClone((project.episodeRoadmaps ?? []).filter((item) => item.episode_number >= startEpisode)),
      ...(project.storyTreeQualityAudit ? { originalAudit: structuredClone(project.storyTreeQualityAudit) } : {}),
      ...(project.planningSession ? { originalPlanningSession: structuredClone(project.planningSession) } : {}),
      invalidatedJobIds: project.activeGenerationTask ? [project.activeGenerationTask.jobId] : [],
    },
    planningRevisionHistory: [
      ...(project.planningRevisionHistory ?? []),
      ...(project.planningRevision ? [structuredClone(project.planningRevision)] : []),
    ],
    episodeRoadmaps: (project.episodeRoadmaps ?? []).map((item) => item.episode_number < startEpisode
      ? item : { ...item, status: "draft" }),
    episodePlansReadyThrough: Math.min(project.episodePlansReadyThrough ?? 0, startEpisode - 1) || undefined,
    storyTreeQualityAudit: undefined,
    activeGenerationTask: undefined,
    deliveryConfirmation: undefined,
    updatedAt: now,
  };
}

/** Recover the visible draft if a node save succeeded before its workspace checkpoint. */
export function revisionRoadmapsForNode(project: ScriptProject, node: StoryPlanNode): EpisodeRoadmapItem[] {
  const candidates = (project.episodeRoadmaps ?? []).filter((item) => item.source_node_id === node.node_id
    && item.story_bible_version === node.story_bible_version
    && (isPlanningRevisionActive(project) || item.source_node_version === node.version));
  const byEpisode = new Map<number, EpisodeRoadmapItem>();
  for (const item of candidates) {
    const previous = byEpisode.get(item.episode_number);
    if (!previous || item.source_node_version === node.version
      || (previous.source_node_version !== node.version && item.source_node_version > previous.source_node_version)) {
      byEpisode.set(item.episode_number, item);
    }
  }
  return [...byEpisode.values()].sort((left, right) => left.episode_number - right.episode_number);
}

/** A source identity match alone cannot make stale episode events approvable. */
export function planningRevisionSourceIssues(item: EpisodeRoadmapItem, node: StoryPlanNode): string[] {
  if (item.source_node_id !== node.node_id || item.source_node_version !== node.version
    || item.story_bible_version !== node.story_bible_version) return ["分集的上层来源已变化，请先复核来源。"];
  const event = node.episode_developments?.find((entry) => entry.episode_number === item.episode_number);
  if (!event) return ["上层节点缺少本集事件，请先补齐上层规划。"];
  const fields = ["entry_state", "exit_state", "source_turning_points", "source_unit_story_beats"] as const;
  const mismatches = fields.filter((field) => JSON.stringify(item[field]) !== JSON.stringify(event[field]));
  return mismatches.length ? ["本集的起止状态或来源事件与最新上层规划不一致，请先修订本集，再批准。"] : [];
}

/** During an explicit revision, downstream prose survives even a boundary edit. */
export function replaceRevisionRoadmap(project: ScriptProject, replacement: EpisodeRoadmapItem): EpisodeRoadmapItem[] {
  if (!isPlanningRevisionActive(project) || planningRevisionEpisodeLocked(project, replacement.episode_number)) {
    throw new Error("该集不在本次后续规划修订范围内。");
  }
  let replaced = false;
  const result = (project.episodeRoadmaps ?? []).map((item) => {
    if (item.episode_number === replacement.episode_number && item.source_node_id === replacement.source_node_id
      && item.source_node_version === replacement.source_node_version && item.story_bible_version === replacement.story_bible_version) {
      replaced = true;
      return { ...replacement, status: "draft" as const };
    }
    return item.episode_number > replacement.episode_number ? { ...item, status: "draft" as const } : item;
  });
  if (!replaced) throw new Error("本集来源已经变化，请重新加载当前规划后再修改。");
  return result;
}

/** Preserve every text field while making a changed source explicitly reviewable. */
export function retainRevisionRoadmaps(
  project: ScriptProject, previousVersions: Map<string, number>, nextVersions: Map<string, number>,
): EpisodeRoadmapItem[] {
  const changedFrom = Math.min(...(project.episodeRoadmaps ?? []).filter((item) => (
    previousVersions.get(item.source_node_id) === item.source_node_version
    && nextVersions.get(item.source_node_id) != null
    && nextVersions.get(item.source_node_id) !== item.source_node_version
  )).map((item) => item.episode_number));
  return (project.episodeRoadmaps ?? []).map((item) => {
    if (planningRevisionEpisodeLocked(project, item.episode_number)) return item;
    const previous = previousVersions.get(item.source_node_id);
    const next = nextVersions.get(item.source_node_id);
    if (previous !== item.source_node_version || next == null || next === previous) {
      return item.episode_number >= changedFrom ? { ...item, status: "draft" as const } : item;
    }
    return {
      ...item, source_node_version: next, status: "draft" as const,
      source_revision_review: { previous_version: previous, current_version: next },
    };
  });
}

export function completePlanningRevision(
  project: ScriptProject, nodes: StoryPlanNode[], audit: StoryTreeQualityAudit,
): ScriptProject {
  const revision = project.planningRevision;
  if (revision?.status !== "active") throw new Error("当前没有进行中的后续规划修订。");
  const scope = audit.future_revision_review;
  if (!scope || scope.revision_id !== revision.revisionId
    || scope.planning_revision_epoch !== planningRevisionEpoch(project)
    || scope.start_episode !== revision.startEpisode
    || scope.end_episode !== project.generationSettings.episodeCount
    || scope.status !== "pass" || scope.boundary_status !== "pass"
    || audit.findings.some(item => item.end_episode >= revision.startEpisode)
    || audit.review_contract_version !== CURRENT_STORY_REVIEW_CONTRACT_VERSION
    || !Number.isFinite(Date.parse(audit.created_at))
    || Date.parse(audit.created_at) < Date.parse(revision.startedAt)) {
    throw new Error("请完成本次修订后的完整剧情审校，确认未来范围及已保存正文衔接通过，再结束修订。");
  }
  for (let number = revision.startEpisode; number <= project.generationSettings.episodeCount; number += 1) {
    const matches = (project.episodeRoadmaps ?? []).filter((item) => item.episode_number === number
      && nodes.some((node) => node.node_id === item.source_node_id && node.version === item.source_node_version));
    const node = nodes.find((entry) => entry.node_id === matches[0]?.source_node_id
      && entry.version === matches[0]?.source_node_version);
    if (matches.length !== 1 || matches[0].status !== "approved" || matches[0].source_revision_review
      || !node || planningRevisionSourceIssues(matches[0], node).length) {
      throw new Error(`请先复核并逐集批准第${number}集规划。`);
    }
  }
  const now = new Date().toISOString();
  return {
    ...project, storyTreeQualityAudit: audit,
    planningRevision: { ...revision, status: "completed", completedAt: now },
    updatedAt: now,
  };
}

/** Do not expose an unlocked local state until the server accepts the transition. */
export async function persistPlanningRevisionTransition(
  project: ScriptProject,
  next: ScriptProject,
  save: (source: ScriptProject, candidate: ScriptProject) => Promise<ScriptProject>,
  apply: (saved: ScriptProject, source: ScriptProject) => Promise<unknown>,
): Promise<ScriptProject> {
  const saved = await save(project, next);
  if (await apply(saved, project) === false) throw new Error("服务器已保存本次修订，但本地未能更新，请重新加载项目。");
  return saved;
}
