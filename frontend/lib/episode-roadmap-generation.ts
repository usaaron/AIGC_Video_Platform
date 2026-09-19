import {
  mergeEpisodeRoadmaps,
} from "@/lib/episode-generation-planning";
import {
  auditStoryPlanQuality,
  canFinishUnreviewedRoadmapLeaf,
  generateEpisodePlanBatch,
  loadActiveStoryPlanNodes,
  storyPlanQualityAuditMatchesNodes,
  type StoryBible,
  type StoryPlanNode,
} from "@/lib/story-planning-client";
import {
  episodeReadyStoryPlanLeaves,
  summarizeStoryPlanTreeProgress,
} from "@/lib/story-plan-tree-progress";
import type {
  EpisodeRoadmapItem,
  ScriptProject,
  StoryTreeQualityAudit,
} from "@/lib/types";
import { requireStoryPlanQuality } from "@/lib/story-quality-gate";

export interface EpisodeRoadmapGenerationProgress {
  phase?: "quality_review" | "roadmap";
  completedEpisodes: number;
  totalEpisodes: number;
  nodeTitle?: string;
  currentEpisode?: number;
}

export interface EpisodeRoadmapGenerationResult {
  activeNodes: StoryPlanNode[];
  episodeRoadmaps: EpisodeRoadmapItem[];
}

export async function runFullEpisodeRoadmapGeneration(input: {
  project: ScriptProject;
  storyBible: StoryBible;
  beforeStep?: () => Promise<void> | void;
  onCheckpoint?: (item: EpisodeRoadmapItem) => Promise<void> | void;
  onProgress?: (progress: EpisodeRoadmapGenerationProgress) => Promise<void> | void;
  onQualityCheckpoint?: (audit: StoryTreeQualityAudit) => Promise<void> | void;
}): Promise<EpisodeRoadmapGenerationResult> {
  const { project, storyBible } = input;
  const activeNodes = await loadActiveStoryPlanNodes(
    project.id,
    storyBible.story_bible_id,
    storyBible.version,
  );
  const episodeCount = project.generationSettings.episodeCount;
  let workingRoadmaps = project.episodeRoadmaps ?? [];
  const progress = summarizeStoryPlanTreeProgress(
    activeNodes,
    workingRoadmaps,
    episodeCount,
  );
  if (!progress.expansionComplete) {
    throw new Error("请先完成覆盖全部集数的剧情树拆分，再生成单集路线图。");
  }

  const readyLeaves = episodeReadyStoryPlanLeaves(activeNodes);
  const completedEpisodeCount = () => new Set(workingRoadmaps.filter((item) => readyLeaves.some((node) => (
    node.node_id === item.source_node_id && node.version === item.source_node_version
    && node.story_bible_version === item.story_bible_version
    && item.episode_number >= (node.planned_start_episode ?? 1)
    && item.episode_number <= (node.planned_end_episode ?? 0)
  ))).map((item) => item.episode_number)).size;
  const shouldRunQualityAudit = !(storyPlanQualityAuditMatchesNodes(
    project.storyTreeQualityAudit,
    readyLeaves,
    workingRoadmaps,
    { project },
  ) || canFinishUnreviewedRoadmapLeaf(project.storyTreeQualityAudit, readyLeaves, workingRoadmaps, { project }));

  await input.onProgress?.({
    completedEpisodes: completedEpisodeCount(),
    totalEpisodes: progress.plannedEpisodeCount,
  });

  await input.beforeStep?.();
  if (shouldRunQualityAudit) {
    await input.onProgress?.({
      phase: "quality_review",
      completedEpisodes: completedEpisodeCount(),
      totalEpisodes: progress.plannedEpisodeCount,
    });
  }
  let qualityAudit = await requireStoryPlanQuality({
    cachedAudit: shouldRunQualityAudit ? undefined : project.storyTreeQualityAudit,
    runAudit: () => auditStoryPlanQuality(project, storyBible, readyLeaves),
    onCheckpoint: input.onQualityCheckpoint,
  });

  for (const node of readyLeaves) {
    await input.beforeStep?.();
    const priorRoadmaps = workingRoadmaps;
    const generated = await generateEpisodePlanBatch(
      { ...project, storyTreeQualityAudit: qualityAudit, episodeRoadmaps: workingRoadmaps },
      node,
      async (checkpoint) => {
        workingRoadmaps = mergeEpisodeRoadmaps(workingRoadmaps, [checkpoint]);
        await input.onCheckpoint?.(checkpoint);
        await input.onProgress?.({
          phase: "roadmap",
          completedEpisodes: completedEpisodeCount(),
          totalEpisodes: progress.plannedEpisodeCount,
          nodeTitle: node.title,
          currentEpisode: checkpoint.episode_number,
        });
      },
      input.beforeStep,
      { activeNodes },
    );
    workingRoadmaps = mergeEpisodeRoadmaps(workingRoadmaps, generated);
    // Review the realized movement while its causal neighbors are still drafts.
    // A passing tree review cannot certify content that did not exist yet.
    if (JSON.stringify(priorRoadmaps) !== JSON.stringify(workingRoadmaps)) {
      await input.beforeStep?.();
      await input.onProgress?.({
        phase: "quality_review",
        completedEpisodes: completedEpisodeCount(),
        totalEpisodes: progress.plannedEpisodeCount,
        nodeTitle: node.title,
      });
      qualityAudit = await requireStoryPlanQuality({
        runAudit: () => auditStoryPlanQuality({ ...project, storyTreeQualityAudit: qualityAudit, episodeRoadmaps: workingRoadmaps }, storyBible, readyLeaves),
        onCheckpoint: input.onQualityCheckpoint,
      });
    }
  }

  return { activeNodes, episodeRoadmaps: workingRoadmaps };
}
