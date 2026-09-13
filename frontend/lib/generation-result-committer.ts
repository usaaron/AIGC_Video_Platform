import { synchronizeContinuity } from "@/lib/continuity";
import { firstMissingRecoveryEpisode } from "@/lib/generation-recovery";
import { GenerationSessionError } from "@/lib/script-generation-session";
import type { EpisodeWorkspace, GenerationBatchRecord, GenerationRecoveryTask, ScriptProject } from "@/lib/types";
import type { useProjects } from "@/providers/project-provider";

interface GenerationResultCommitterOptions {
  project: ScriptProject;
  updateProject: ReturnType<typeof useProjects>["updateProject"];
  getTask: () => GenerationRecoveryTask | undefined;
  initial: boolean;
}

export function createGenerationResultCommitter({
  project: source, updateProject, getTask, initial,
}: GenerationResultCommitterOptions) {
  const projectId = source.id;
  const checkpointSnapshot = (task?: GenerationRecoveryTask) => JSON.stringify(task ?? null);
  const initialCheckpoint = checkpointSnapshot(source.activeGenerationTask);

  async function save(status: GenerationBatchRecord["status"], episode?: EpisodeWorkspace) {
    const task = getTask();
    if (!task && (episode || status === "completed")) {
      throw new GenerationSessionError("请先保存生成任务检查点。", "persistence");
    }
    const expectedCheckpoint = task ? checkpointSnapshot(task) : initialCheckpoint;
    const completedAt = new Date().toISOString();
    let applied = false;
    let conflict = "生成任务或规划版本已变化，请从当前任务继续。";
    const saved = await updateProject(projectId, (project) => {
      if (checkpointSnapshot(project.activeGenerationTask) !== expectedCheckpoint
        || project.storyBibleVersion !== source.storyBibleVersion) return {};

      let episodes = project.episodes;
      if (episode) {
        if (episode.episodeNumber < task!.startEpisode || episode.episodeNumber > task!.endEpisode) {
          conflict = "生成结果不属于当前批次。";
          return {};
        }
        const existing = episodes.find((item) => item.episodeNumber === episode.episodeNumber);
        if (existing && existing.id !== episode.id) {
          conflict = "这一集已有其他来源的正文，请检查现有内容。";
          return {};
        }
        // Repeated saves retain any edits made since this result was first stored.
        if (!existing) episodes = [...episodes, episode].sort((left, right) => left.episodeNumber - right.episodeNumber);
      }
      if (status === "completed" && firstMissingRecoveryEpisode(task!, episodes.map((item) => item.episodeNumber)) !== null) {
        conflict = "当前批次还有正文未保存，请检查后继续生成。";
        return {};
      }

      const id = task ? `batch-${projectId}-${task.batchNumber}` : undefined;
      const previous = project.generationBatches.find((batch) => batch.id === id);
      const batch: GenerationBatchRecord | undefined = task ? {
        id: id!,
        batchNumber: task.batchNumber,
        startEpisode: task.startEpisode,
        endEpisode: task.endEpisode,
        requestedEpisodeCount: task.endEpisode - task.startEpisode + 1,
        generatedEpisodeCount: episodes.filter((item) => (
          item.episodeNumber >= task.startEpisode && item.episodeNumber <= task.endEpisode
        )).length,
        instruction: task.instruction,
        status,
        createdAt: previous?.createdAt ?? task.createdAt,
        ...(status === "completed" ? { completedAt: previous?.completedAt ?? completedAt } : {}),
      } : undefined;
      const first = initial && project.episodes.length === 0 ? episodes[0] : undefined;
      applied = true;
      return {
        ...(episodes !== project.episodes ? {
          episodes,
          ...synchronizeContinuity(
            project.creativePrompt, project.characters, episodes,
            project.storyLines, project.characterRelationships, project.continuityStates,
          ),
        } : {}),
        ...(batch ? {
          generationBatches: [...project.generationBatches.filter((item) => item.id !== id), batch],
        } : {}),
        ...(status === "completed" && !initial && project.activeEpisodeNumber === source.activeEpisodeNumber
          ? { activeEpisodeNumber: task!.startEpisode } : {}),
        ...(first && !project.generationRun ? {
          activeEpisodeNumber: first.episodeNumber,
          generationRun: first.generationRun,
          workingDraftJson: first.workingDraftJson,
          hasLocalDraftEdits: false,
          revisionRun: undefined,
          finalizationResult: undefined,
          contentSpecId: first.generationRun.content_spec_id ?? project.contentSpecId,
        } : {}),
        status: initial && episode ? "generating" : episodes.length ? "draft" : "idea",
      };
    });
    if (!applied) throw new GenerationSessionError(conflict, "conflict");
    if (!saved) throw new GenerationSessionError("生成结果未能保存在本地，请重试。", "persistence");
  }

  return {
    commitEpisode: (episode: EpisodeWorkspace) => save("partial", episode),
    complete: () => save("completed"),
    partial: () => save("partial"),
  };
}
