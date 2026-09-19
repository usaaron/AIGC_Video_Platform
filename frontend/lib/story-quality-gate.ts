import type { ScriptProject, StoryTreeQualityAudit } from "@/lib/types";
import { storyPlanQualityAuditMatchesNodes, type StoryPlanNode } from "@/lib/story-planning-client";

export function storyPlanQualityFindingAdvice(finding: Pick<StoryTreeQualityAudit["findings"][number], "summary" | "repair_instruction">): string {
  const advice = finding.repair_instruction?.trim() || finding.summary?.trim() || "请核对本段剧情并保存修改。";
  return advice
    .replace(/\breview_\d+\b(?:[ \t]*节点)?/g, "这一部分")
    .replace(/\bentry_state\b/g, "进入状态")
    .replace(/\bexit_state\b/g, "退出状态")
    .replace(/\bepisode_developments\b/g, "逐集事件安排")
    .replace(/\bestimated_script_body_characters\b/g, "预计正文篇幅")
    .replace(/\bdecomposition_reason\b/g, "集数分配理由")
    .replace(/叶节点/g, "剧情段落")
    .replace(/父节点/g, "所属部分")
    .replace(/子节点/g, "细分章节")
    .replace(/因果节拍/g, "剧情事件");
}

export function storyPlanQualityRevisionMessage(audit: StoryTreeQualityAudit): string {
  const reasons = audit.findings.slice(0, 3)
    .map((finding) => `第${finding.start_episode}—${finding.end_episode}集「${finding.title}」：${storyPlanQualityFindingAdvice(finding)}`)
    .join("；");
  return `剧情检查发现需要先修订的内容：${reasons || audit.summary || "请检查当前规划。"} 请查看修订建议并保存修改，继续规划时会自动核对。已保存的规划会保留。`;
}

export class StoryPlanQualityError extends Error {
  constructor(audit: StoryTreeQualityAudit) {
    super(storyPlanQualityRevisionMessage(audit));
    this.name = "StoryPlanQualityError";
  }
}

/** A locked older project must also honor a current failed content review. */
export function storyQualityRejectionForEpisode(
  project: Pick<ScriptProject, "storyTreeQualityAudit" | "episodeRoadmaps" | "planningRevision" | "planningRevisionEpoch">,
  nodes: StoryPlanNode[],
  episodeNumber: number,
): string | null {
  const audit = project.storyTreeQualityAudit;
  if (!audit || audit.status !== "needs_revision"
    || !storyPlanQualityAuditMatchesNodes(audit, nodes, project.episodeRoadmaps, { allowLegacyFailure: true })) return null;
  const scope = audit.future_revision_review;
  const revision = project.planningRevision;
  if (revision?.status === "completed" && scope?.status === "pass" && scope.boundary_status === "pass"
    && scope.revision_id === revision.revisionId && scope.planning_revision_epoch === (project.planningRevisionEpoch ?? 0)
    && scope.start_episode === revision.startEpisode && episodeNumber >= scope.start_episode && episodeNumber <= scope.end_episode
    && !audit.findings.some(item => item.end_episode >= scope.start_episode)) return null;
  const roadmap = project.episodeRoadmaps?.find((item) => item.episode_number === episodeNumber);
  const finding = audit.findings.find((item) => item.node_id === roadmap?.source_node_id
    && item.node_version === roadmap?.source_node_version);
  return finding
    ? `第${episodeNumber}集所属剧情部分「${finding.title}」还需要调整：${storyPlanQualityFindingAdvice(finding)} 请先修订并保存规划，再继续创作；已保存正文保留。`
    : null;
}

/** Resolve and retain a review before spending calls on dependent roadmaps. */
export async function requireStoryPlanQuality(input: {
  cachedAudit?: StoryTreeQualityAudit;
  runAudit: () => Promise<StoryTreeQualityAudit>;
  onCheckpoint?: (audit: StoryTreeQualityAudit) => Promise<void> | void;
}): Promise<StoryTreeQualityAudit> {
  const audit = input.cachedAudit ?? await input.runAudit();
  if (!input.cachedAudit) await input.onCheckpoint?.(audit);
  if (audit.status === "needs_revision" || audit.findings.length > 0) {
    throw new StoryPlanQualityError(audit);
  }
  return audit;
}
