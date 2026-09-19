"use client";

import { useMemo } from "react";

import { authorConflictSourceSnapshot } from "@/lib/author-conflict";
import { synchronizeContinuity } from "@/lib/continuity";
import { reviewEpisodeDraft } from "@/lib/generation-client";
import { saveEpisodeArtifactOnServer } from "@/lib/project-sync";
import { editedDraftPatch, episodeIsLocked, resolveWorkingDraft, type ScriptDraftUpdater } from "@/lib/script-draft-state";
import type { EpisodeWorkspace, GeneratedDraft, ScriptGenerationRun, ScriptProject } from "@/lib/types";
import type { useProjects } from "@/providers/project-provider";

interface DraftEditingOptions {
  projectId: string;
  getProject: ReturnType<typeof useProjects>["getProject"];
  updateProject: ReturnType<typeof useProjects>["updateProject"];
}

export class ScriptDraftSaveError extends Error {}

function episodePatch(
  project: ScriptProject,
  episode: EpisodeWorkspace,
  patch: Partial<EpisodeWorkspace>,
  skipContinuitySync = false,
): Partial<ScriptProject> {
  const episodes = project.episodes.map((item) => item === episode
    ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item);
  return {
    episodes,
    ...(skipContinuitySync ? {} : synchronizeContinuity(
      project.creativePrompt, project.characters, episodes,
      project.storyLines, project.characterRelationships, project.continuityStates,
    )),
  };
}

function candidateSnapshot(episode: EpisodeWorkspace): string {
  return JSON.stringify([episode.modificationCandidate, episode.deepeningRun]);
}

function episodeContentSnapshot(episode: EpisodeWorkspace): string {
  const { updatedAt: _updatedAt, ...content } = episode;
  return JSON.stringify(content);
}

export function useScriptDraftEditing({ projectId, getProject, updateProject }: DraftEditingOptions) {
  // Keep same-numbered episodes in different projects isolated, including late saves.
  const { pendingInlineDraftsRef, candidateBaseInlineEditsRef, saves } = useMemo(() => ({
    pendingInlineDraftsRef: { current: new Map<number, GeneratedDraft>() },
    candidateBaseInlineEditsRef: { current: new Set<number>() },
    saves: new Map<number, Promise<Awaited<ReturnType<typeof saveEpisodeArtifactOnServer>>>>(),
  }), [projectId]);

  function hasInlineEdits(episodeNumber: number): boolean {
    return pendingInlineDraftsRef.current.has(episodeNumber)
      || candidateBaseInlineEditsRef.current.has(episodeNumber);
  }

  function replaceEpisode(episodeNumber: number, patch: Partial<EpisodeWorkspace>, skipContinuitySync = false) {
    return updateProject(projectId, (latest) => {
      const episode = latest.episodes.find((item) => item.episodeNumber === episodeNumber);
      return episode ? episodePatch(latest, episode, patch, skipContinuitySync) : {};
    });
  }

  function updateDraft(episodeNumber: number, update: ScriptDraftUpdater) {
    const project = getProject(projectId);
    const episode = project?.episodes.find((item) => item.episodeNumber === episodeNumber);
    if (!episode || episode.sourceAmendment || episodeIsLocked(episode) || episode.modificationCandidate
      || episode.deepeningRun?.candidate_draft_master_script) return;
    const sourceDraft = pendingInlineDraftsRef.current.get(episodeNumber) ?? resolveWorkingDraft(episode);
    const nextDraft = update(sourceDraft);
    if (JSON.stringify(nextDraft) === JSON.stringify(sourceDraft)) return;
    pendingInlineDraftsRef.current.set(episodeNumber, nextDraft);
    void updateProject(projectId, (latest) => {
      const current = latest.episodes.find((item) => item.id === episode.id && item.episodeNumber === episodeNumber);
      if (!current || current.sourceAmendment || episodeIsLocked(current) || current.modificationCandidate
        || current.deepeningRun?.candidate_draft_master_script) return {};
      return episodePatch(latest, current, {
        ...editedDraftPatch(nextDraft), status: "editing", hasLocalDraftEdits: true,
        generationRun: { ...current.generationRun, draft_master_script: nextDraft },
      }, true);
    });
  }

  async function persistReviewedDraft(
    sourceProject: ScriptProject,
    sourceEpisode: EpisodeWorkspace,
    reviewedRun: ScriptGenerationRun,
    sourceSnapshot = authorConflictSourceSnapshot(sourceProject, sourceEpisode, resolveWorkingDraft(sourceEpisode)),
  ) {
    if (sourceEpisode.sourceAmendment) throw new ScriptDraftSaveError("请在来源修订正文复核区填写依据并采用候选。");
    const episodeNumber = sourceEpisode.episodeNumber;
    const candidates = candidateSnapshot(sourceEpisode);
    const pendingDraft = pendingInlineDraftsRef.current.get(episodeNumber);
    function currentSource(project: ScriptProject | undefined) {
      const episode = project?.episodes.find((item) => item.id === sourceEpisode.id && item.episodeNumber === episodeNumber);
      return project && episode && !episodeIsLocked(episode)
        && candidateSnapshot(episode) === candidates
        && authorConflictSourceSnapshot(project, episode, resolveWorkingDraft(episode)) === sourceSnapshot
        ? episode : undefined;
    }
    function changedError() {
      return new ScriptDraftSaveError("正文或规划已变化，请重新保存或生成候选。最新内容已保留。");
    }
    const latest = getProject(projectId);
    if (!currentSource(latest)) throw changedError();
    const reviewedDraft = reviewedRun.draft_master_script;
    const artifactRef = await saveEpisodeArtifactOnServer({
      project: latest!, episodeNumber, artifactKind: "draft", memoryLayer: "provisional",
      contentSchemaVersion: "draft_master_script.v1", contentPayload: reviewedDraft,
      lineageRefs: {
        draft_master_script_id: reviewedDraft.id,
        generation_strategy_id: reviewedRun.generation_strategy_id,
      },
    });
    let sourceChanged = false;
    let previousEpisode: EpisodeWorkspace | undefined;
    let committedSnapshot: string | undefined;
    const saved = await updateProject(projectId, (project) => {
      const episode = currentSource(project);
      if (!episode) { sourceChanged = true; return {}; }
      previousEpisode = episode;
      const patch = episodePatch(project, episode, {
        ...editedDraftPatch(reviewedDraft), status: "saved", generationRun: reviewedRun,
        hasLocalDraftEdits: false, modificationCandidate: undefined,
        modificationCandidateSourceSnapshot: undefined, deepeningRun: undefined,
        artifactRefs: artifactRef ? { ...episode.artifactRefs, draft: artifactRef } : episode.artifactRefs,
      });
      committedSnapshot = episodeContentSnapshot(patch.episodes!.find((item) => item.id === episode.id)!);
      return patch;
    });
    if (sourceChanged || !committedSnapshot) throw changedError();
    if (!saved) {
      // Restore the unsaved source only if no later edit replaced this commit.
      await updateProject(projectId, (project) => {
        const episode = project.episodes.find((item) => item.id === sourceEpisode.id);
        return episode && episodeContentSnapshot(episode) === committedSnapshot && previousEpisode
          ? episodePatch(project, episode, { ...previousEpisode, artifactRefs: previousEpisode.artifactRefs }) : {};
      });
      throw new ScriptDraftSaveError("正文未能保存在本地，请重试。");
    }
    const current = getProject(projectId)?.episodes.find((item) => item.id === sourceEpisode.id);
    if (current && episodeContentSnapshot(current) === committedSnapshot
      && pendingInlineDraftsRef.current.get(episodeNumber) === pendingDraft) {
      pendingInlineDraftsRef.current.delete(episodeNumber);
      candidateBaseInlineEditsRef.current.delete(episodeNumber);
    }
    return artifactRef;
  }

  function saveDraft(episodeNumber: number) {
    const existing = saves.get(episodeNumber);
    if (existing) return existing;
    const project = getProject(projectId);
    const episode = project?.episodes.find((item) => item.episodeNumber === episodeNumber);
    if (!project || !episode || episodeIsLocked(episode) || !episode.hasLocalDraftEdits
      || episode.modificationCandidate || episode.deepeningRun?.candidate_draft_master_script) return;
    const draft = pendingInlineDraftsRef.current.get(episodeNumber) ?? resolveWorkingDraft(episode);
    const sourceSnapshot = authorConflictSourceSnapshot(project, episode, draft);
    const save = reviewEpisodeDraft(episode.generationRun, draft, project.planningRevisionEpoch ?? 0)
      .then((reviewedRun) => persistReviewedDraft(project, episode, reviewedRun, sourceSnapshot))
      .finally(() => saves.delete(episodeNumber));
    saves.set(episodeNumber, save);
    return save;
  }

  return {
    pendingInlineDraftsRef, candidateBaseInlineEditsRef,
    hasInlineEdits, replaceEpisode, updateDraft, saveDraft, persistReviewedDraft,
  };
}
