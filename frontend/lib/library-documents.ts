import { toEpisodePlainText } from './episode-export';
import { resolveWorkingDraft } from './script-draft-state';
import type { ScriptProject } from './types';

export function libraryDocuments(project: ScriptProject) {
  const documents = [...(project.episodes || [])].sort((a, b) => a.episodeNumber - b.episodeNumber).flatMap((episode) => {
    if (!episode.generationRun && !episode.workingDraftJson && !episode.confirmedDraftJson && !episode.finalizationResult) return [];
    const draft = resolveWorkingDraft({ ...episode, generationRun: episode.generationRun || { draft_master_script: null } } as typeof episode);
    if (!draft?.scenes?.length) return [];
    return [{ title: `${project.title} · 第 ${episode.episodeNumber} 集`, content: toEpisodePlainText(draft, episode.episodeNumber), createdAt: episode.updatedAt || project.updatedAt }];
  });
  if (documents.length > 1) documents.push({ title: `${project.title} · 长剧本合本`, content: documents.map((item) => item.content).join('\n\n'), createdAt: project.updatedAt });
  return documents.map((document) => ({ ...document, projectId: project.id, projectName: project.title }));
}
