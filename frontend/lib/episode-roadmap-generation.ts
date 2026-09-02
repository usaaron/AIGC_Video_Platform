import {
  mergeEpisodeRoadmaps,
} from "@/lib/episode-generation-planning";
import {
  auditStoryPlanQuality,
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

export interface EpisodeRoadmapGenerationProgress {
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
  let progress = summarizeStoryPlanTreeProgress(
    activeNodes,
    workingRoadmaps,
    episodeCount,
  );
  if (!progress.expansionComplete) {
    throw new Error("请先完成覆盖全部集数的剧情树拆分，再生成单集路线图。");
  }

  const readyLeaves = episodeReadyStoryPlanLeaves(activeNodes);
  const shouldRunQualityAudit = !storyPlanQualityAuditMatchesNodes(
    project.storyTreeQualityAudit,
    readyLeaves,
  );

  await input.onProgress?.({
    completedEpisodes: progress.generatedRoadmapCount,
    totalEpisodes: progress.plannedEpisodeCount,
  });

  for (const node of readyLeaves) {
    await input.beforeStep?.();
    const generated = await generateEpisodePlanBatch(
      { ...project, episodeRoadmaps: workingRoadmaps },
      node,
      async (checkpoint) => {
        workingRoadmaps = mergeEpisodeRoadmaps(workingRoadmaps, [checkpoint]);
        await input.onCheckpoint?.(checkpoint);
        progress = summarizeStoryPlanTreeProgress(
          activeNodes,
          workingRoadmaps,
          episodeCount,
        );
        await input.onProgress?.({
          completedEpisodes: progress.generatedRoadmapCount,
          totalEpisodes: progress.plannedEpisodeCount,
          nodeTitle: node.title,
          currentEpisode: checkpoint.episode_number,
        });
      },
      input.beforeStep,
      { activeNodes },
    );
    workingRoadmaps = mergeEpisodeRoadmaps(workingRoadmaps, generated);
  }

  // Quality monitoring is advisory. Start it only after the resumable roadmap
  // checkpoints are complete so a slow or empty audit response never delays the
  // user's usable roadmap. The audit itself is one short, bounded request.
  if (shouldRunQualityAudit) {
    void auditStoryPlanQuality(project, storyBible, readyLeaves, {
      timeoutMs: 12_000,
    })
      .then((audit) => input.onQualityCheckpoint?.(audit))
      .catch(() => undefined);
  }

  return { activeNodes, episodeRoadmaps: workingRoadmaps };
}
