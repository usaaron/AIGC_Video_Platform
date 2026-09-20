import {
  approveEpisodeRoadmapItem, episodeRoadmapReadinessIssues, isApprovedEpisodeRoadmap,
} from "./planning-coverage";
import {
  isPlanningRevisionActive, planningRevisionEpisodeLocked, planningRevisionSourceIssues,
} from "./planning-revision";
import { episodeReadyStoryPlanLeaves, summarizeStoryPlanTreeProgress } from "./story-plan-tree-progress";
import type { prepareEpisodePlanItem, StoryPlanNode } from "./story-planning-client";
import type { EpisodeRoadmapItem, ScriptProject } from "./types";

function identityMatches(item: EpisodeRoadmapItem, node: StoryPlanNode, number: number) {
  return item.episode_number === number && item.source_node_id === node.node_id
    && item.source_node_version === node.version && item.story_bible_version === node.story_bible_version;
}

/** Prepare a candidate only. The caller must audit it and save with a version check. */
export async function preparePlanningBatchApproval({ project, nodes, prepare, onProgress }: {
  project: ScriptProject;
  nodes: StoryPlanNode[];
  prepare: typeof prepareEpisodePlanItem;
  onProgress?: (episodeNumber: number, total: number) => void;
}): Promise<EpisodeRoadmapItem[]> {
  const total = project.generationSettings.episodeCount;
  const original = project.episodeRoadmaps ?? [];
  const progress = summarizeStoryPlanTreeProgress(nodes, original, total);
  if (!Number.isInteger(total) || total < 1 || !progress.expansionComplete
    || progress.plannedEpisodeCount !== total) {
    throw new Error("大纲尚未完整覆盖全部集数，请先完成剧情规划。");
  }
  const leaves = episodeReadyStoryPlanLeaves(nodes);
  for (const node of leaves) {
    if (original.some(item => item.source_node_id === node.node_id && item.source_node_version === node.version
      && item.story_bible_version === node.story_bible_version
      && (!Number.isInteger(item.episode_number) || item.episode_number < node.planned_start_episode!
        || item.episode_number > node.planned_end_episode!))) {
      throw new Error("当前大纲存在超出所属剧情范围的集数，请先检查分集安排。");
    }
  }
  const revising = isPlanningRevisionActive(project);
  const written = new Set(project.episodes.map(episode => episode.episodeNumber));
  const targets: { index: number; node: StoryPlanNode; item: EpisodeRoadmapItem; protected: boolean }[] = [];
  // Validate the whole batch before spending a call on any missing scene details.
  for (let number = 1; number <= total; number++) {
    const owners = leaves.filter(node => node.planned_start_episode! <= number && node.planned_end_episode! >= number);
    if (owners.length !== 1) throw new Error(`第${number}集的所属剧情不唯一，请先检查大纲。`);
    const node = owners[0];
    if (project.storyBibleVersion != null && node.story_bible_version !== project.storyBibleVersion) {
      throw new Error(`第${number}集的故事设定版本已变化，请重新读取大纲。`);
    }
    const matches = original.map((item, index) => ({ item, index }))
      .filter(({ item }) => identityMatches(item, node, number));
    if (matches.length !== 1) throw new Error(`第${number}集缺少唯一的当前大纲，请先补齐或复核来源。`);
    const { item, index } = matches[0];
    const protectedEpisode = written.has(number) || planningRevisionEpisodeLocked(project, number);
    if (protectedEpisode && (!isApprovedEpisodeRoadmap(item) || item.source_revision_review
      || episodeRoadmapReadinessIssues(item).length)) {
      throw new Error(`第${number}集属于已保存正文或冻结范围，不能在本次确认中重新批准或改写。`);
    }
    if (!protectedEpisode && (revising || node.episode_developments?.length)) {
      const issues = planningRevisionSourceIssues(item, node);
      if (issues.length) throw new Error(`第${number}集：${issues.join("；")}`);
    }
    if (!revising && item.source_revision_review) {
      throw new Error(`第${number}集来源待复核，请先处理上层规划的变化。`);
    }
    if (isApprovedEpisodeRoadmap(item) && (episodeRoadmapReadinessIssues(item).length
      || (!protectedEpisode && item.execution_ready !== true))) {
      throw new Error(`第${number}集已确认的大纲缺少完整场次，请先修订后再整体确认。`);
    }
    targets.push({ index, node, item, protected: protectedEpisode });
  }

  const working = [...original];
  for (const target of targets) {
    if (target.protected || (isApprovedEpisodeRoadmap(target.item) && !target.item.source_revision_review)) continue;
    const number = target.item.episode_number;
    onProgress?.(number, total);
    let item = target.item;
    if (episodeRoadmapReadinessIssues(item).length || item.execution_ready !== true) {
      // Earlier prepared items remain drafts. Draft handoffs carry continuity
      // across leaves until the complete candidate has passed its audit.
      const accepted = targets.filter(previous => previous.node.node_id === target.node.node_id
        && previous.node.version === target.node.version && previous.item.episode_number < number)
        .map(previous => working[previous.index]);
      try {
        item = await prepare({ ...project, episodeRoadmaps: working }, target.node, item, accepted, undefined, nodes);
      } catch (error) {
        throw new Error(`第${number}集场次整理未完成，已保存大纲保留。${error instanceof Error ? ` ${error.message}` : "请稍后重试。"}`);
      }
    }
    if (!identityMatches(item, target.node, number)) {
      throw new Error(`第${number}集整理结果的来源不匹配，原稿已保留，请重新检查。`);
    }
    const issues = episodeRoadmapReadinessIssues(item);
    if (item.execution_ready !== true) issues.push("场次还未完成正文准备");
    if (revising || target.node.episode_developments?.length) issues.push(...planningRevisionSourceIssues(item, target.node));
    if (issues.length) throw new Error(`第${number}集：${issues.join("；")}。原稿已保留，请修改后再确认大纲。`);
    working[target.index] = { ...item, status: "draft" };
  }

  // No project object was mutated and no per-episode approval was persisted.
  for (const target of targets) {
    if (target.protected || (isApprovedEpisodeRoadmap(target.item) && !target.item.source_revision_review)) continue;
    const { source_revision_review: _review, ...reviewed } = working[target.index];
    working[target.index] = approveEpisodeRoadmapItem(reviewed);
  }
  return working;
}
