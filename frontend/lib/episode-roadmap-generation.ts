import {
  mergeEpisodeRoadmaps,
} from "@/lib/episode-generation-planning";
import {
  generateEpisodePlanBatch,
  loadActiveStoryPlanNodes,
  type StoryBible,
  type StoryPlanNode,
} from "@/lib/story-planning-client";
import {
  episodeReadyStoryPlanLeaves,
  summarizeStoryPlanTreeProgress,
} from "@/lib/story-plan-tree-progress";
import type { EpisodeRoadmapItem, ScriptProject } from "@/lib/types";

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

  await input.onProgress?.({
    completedEpisodes: progress.generatedRoadmapCount,
    totalEpisodes: progress.plannedEpisodeCount,
  });

  for (const node of episodeReadyStoryPlanLeaves(activeNodes)) {
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
    );
    workingRoadmaps = mergeEpisodeRoadmaps(workingRoadmaps, generated);
  }

  return { activeNodes, episodeRoadmaps: workingRoadmaps };
}
