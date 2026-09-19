import type { EpisodeRoadmapItem, FutureRoadmapRebuildReceipt, ScriptProject } from './types';
import type { StoryPlanNode } from './story-planning-client';
import { planningRevisionEpoch, planningRevisionSourceIssues, revisionRoadmapsForNode } from './planning-revision';
import { episodeRoadmapReadinessIssues } from './episode-generation-planning';

export function roadmapRebuildBudget(item: EpisodeRoadmapItem) {
  return {
    target_duration_seconds: item.target_duration_seconds,
    planned_scene_count: item.planned_scene_count,
    planned_shot_count: item.planned_shot_count,
    planned_dialogue_line_count: item.planned_dialogue_line_count,
    scenes: (item.scene_execution_plan ?? []).map(scene => ({
      scene_number: scene.scene_number, dialogue_line_target: scene.dialogue_line_target, shot_target: scene.shot_target,
    })),
  };
}

/** Receipts are verified by the server on persistence; edits discard them. */
export function hasCurrentRoadmapRebuild(project: ScriptProject, node: StoryPlanNode, item: EpisodeRoadmapItem): boolean {
  const receipt = item.source_revision_review?.rebuilt;
  return Boolean(receipt && receipt.planning_revision_epoch === planningRevisionEpoch(project)
    && receipt.revision_id === project.planningRevision?.revisionId && receipt.episode_number === item.episode_number
    && receipt.source_node_id === node.node_id && receipt.source_node_version === node.version
    && (receipt.ending_mode ?? 'serial_hook') === (item.ending_mode ?? 'serial_hook')
    && receipt.evidence_signature && receipt.candidate_signature && receipt.agent_request_id && receipt.agent_run_id
    && JSON.stringify(receipt.budget) === JSON.stringify(roadmapRebuildBudget(item))
    && ['entry_state', 'exit_state', 'source_turning_points', 'source_unit_story_beats'].every(field => (
      JSON.stringify(receipt.source_evidence[field as keyof typeof receipt.source_evidence])
      === JSON.stringify(item[field as keyof EpisodeRoadmapItem])
    ))
    && planningRevisionSourceIssues(item, node).length === 0);
}

export function futureLeafRebuildCandidates(project: ScriptProject, node: StoryPlanNode): EpisodeRoadmapItem[] {
  const revision = project.planningRevision;
  if (revision?.status !== 'active' || node.status !== 'approved' || node.expansion_status !== 'episode_ready') return [];
  return revisionRoadmapsForNode(project, node).filter(item => item.episode_number >= revision.startEpisode
    && !project.episodes.some(episode => episode.episodeNumber === item.episode_number)
    && item.status !== 'approved' && Boolean(item.source_revision_review)
    && item.source_node_version === node.version
    && !hasCurrentRoadmapRebuild(project, node, item));
}

export interface FutureRoadmapRebuildResult { plan: EpisodeRoadmapItem; receipt: FutureRoadmapRebuildReceipt }

export function clearRebuildReceiptsAfterEdit(project: ScriptProject, edited: EpisodeRoadmapItem, rows: EpisodeRoadmapItem[]): EpisodeRoadmapItem[] {
  return rows.map(row => {
    const previous = project.episodeRoadmaps?.find(item => item.episode_number === row.episode_number);
    if (row.episode_number < edited.episode_number || previous?.status === 'approved'
      || row.source_node_id !== edited.source_node_id || row.source_node_version !== edited.source_node_version
      || !row.source_revision_review?.rebuilt) return row;
    const { rebuilt: _receipt, ...review } = row.source_revision_review;
    return { ...row, source_revision_review: review };
  });
}

/** Every request depends on the acknowledged previous checkpoint, never a cleared leaf. */
export async function rebuildFutureRoadmapLeaf(input: {
  project: ScriptProject;
  node: StoryPlanNode;
  getCurrent: () => ScriptProject;
  generate: (project: ScriptProject, node: StoryPlanNode, item: EpisodeRoadmapItem, prefix: EpisodeRoadmapItem[]) => Promise<FutureRoadmapRebuildResult>;
  save: (source: ScriptProject, candidate: ScriptProject) => Promise<ScriptProject>;
  apply: (saved: ScriptProject, source: ScriptProject) => Promise<unknown>;
  beforeStep?: () => Promise<void>;
  onProgress?: (episode: number) => void;
}): Promise<number[]> {
  const epoch = planningRevisionEpoch(input.project);
  const revisionId = input.project.planningRevision?.revisionId;
  const completed: number[] = [];
  while (true) {
    await input.beforeStep?.();
    const source = input.getCurrent();
    if (source.planningRevision?.status !== 'active' || source.planningRevision.revisionId !== revisionId
      || planningRevisionEpoch(source) !== epoch) throw new Error('后续规划修订已变化，请重新加载后继续。');
    const candidates = futureLeafRebuildCandidates(source, input.node);
    const item = candidates[0];
    if (!item) return completed;
    const rows = revisionRoadmapsForNode(source, input.node);
    const prefix = rows.filter(row => row.episode_number < item.episode_number);
    const start = input.node.planned_start_episode;
    if (start == null || prefix.length !== item.episode_number - start || prefix.some((row, index) => (
      row.episode_number !== start + index || planningRevisionSourceIssues(row, input.node).length > 0
      || (row.status !== 'approved' && !hasCurrentRoadmapRebuild(source, input.node, row))
    ))) throw new Error(`请先完成并复核第${item.episode_number}集之前的本段规划，再继续重建。`);
    if (start > 1 && !source.episodeRoadmaps?.some(row => row.episode_number === start - 1 && row.status === 'approved')) {
      throw new Error(`请先批准第${start - 1}集规划，再重建下一段。`);
    }
    input.onProgress?.(item.episode_number);
    const { plan, receipt } = await input.generate(source, input.node, item, prefix);
    if (JSON.stringify(roadmapRebuildBudget(plan)) !== JSON.stringify(roadmapRebuildBudget(item))) {
      throw new Error(`第${item.episode_number}集重建改变了既定时长或场景预算，原稿已保留。`);
    }
    if (plan.episode_number !== item.episode_number || planningRevisionSourceIssues(plan, input.node).length
      || episodeRoadmapReadinessIssues(plan).length) throw new Error('重建结果的来源或场景合同不完整，原稿已保留。');
    const replacement: EpisodeRoadmapItem = { ...plan, status: 'draft',
      source_revision_review: { ...item.source_revision_review!, rebuilt: receipt } };
    if (!hasCurrentRoadmapRebuild(source, input.node, replacement)) throw new Error('重建结果缺少当前来源的服务端凭证。');
    // The strict save and adoption compare the complete source snapshot, including
    // edits made while the model was working. No conflict rebase or auto-approval.
    const candidate: ScriptProject = { ...source,
      episodeRoadmaps: source.episodeRoadmaps!.map(row => row === item ? replacement : row),
      storyTreeQualityAudit: undefined, episodePlansReadyThrough: undefined, updatedAt: new Date().toISOString() };
    const current = input.getCurrent();
    if (JSON.stringify({ ...current, serverSync: undefined }) !== JSON.stringify({ ...source, serverSync: undefined })) {
      throw new Error('模型处理期间规划已有修改，旧结果未写入，请核对最新内容后继续。');
    }
    const saved = await input.save(source, candidate);
    if (await input.apply(saved, source) === false) throw new Error('服务端已保存重建结果，但本地状态已变化，请重新加载。');
    completed.push(item.episode_number);
  }
}
