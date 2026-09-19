import type { EpisodeWorkspace, GeneratedDraft, ScriptGenerationRun, ScriptProject } from './types';
import { producedDraftHash, producedEpisodeBodyHash } from './produced-plan-content';
import { editedDraftPatch } from './script-draft-state';

export interface ProducedBodyEvidence { sceneNumber: number; bodyOrderRef: string; quote: string }
export interface ProducedBodyResolutionRequest {
  amendmentId: string; episodeNumber: number; resolution: 'revised' | 'reviewed';
  sourcePlanHash: string; sourceBodyHash: string; acceptedBodyHash: string;
  predecessorBodyHash: string | null; evidence: ProducedBodyEvidence[]; summary: string;
}
export type ProducedBodyResolutionReceipt = ProducedBodyResolutionRequest & {
  resolvedAt: string; planningRevisionEpoch: number; previousEpisodeSnapshot: EpisodeWorkspace;
};

export function producedBodyEvidence(draft: GeneratedDraft): ProducedBodyEvidence[] {
  return draft.scenes.flatMap(scene => (scene.body_order ?? []).flatMap(ref => {
    const [kind, raw] = ref.split(':'); const index = Number(raw);
    const quote = kind === 'action' ? scene.character_actions[index] : kind === 'dialogue' ? scene.dialogues[index]?.text : undefined;
    return quote ? [{ sceneNumber: scene.scene_number, bodyOrderRef: ref, quote }] : [];
  }));
}

export async function buildProducedBodyResolution(
  project: ScriptProject, episodeNumber: number, reviewedRun: ScriptGenerationRun,
  evidence: ProducedBodyEvidence[], summary: string,
  options: { existingBodyConforms?: boolean } = {},
): Promise<ScriptProject> {
  const episode = project.episodes.find(item => item.episodeNumber === episodeNumber);
  const marker = episode?.sourceAmendment;
  if (!episode || !marker) throw new Error('当前集没有待处理的来源修订。');
  if (project.planningRevision?.status === 'active') throw new Error('请先完成规划审校，再处理正文。');
  const first = Math.min(...project.episodes.filter(item => item.sourceAmendment).map(item => item.episodeNumber));
  if (first !== episodeNumber) throw new Error(`请先处理第${first}集。`);
  const accepted = reviewedRun.draft_master_script;
  const [sourceHash, acceptedHash] = await Promise.all([producedEpisodeBodyHash(episode), producedDraftHash(accepted)]);
  const changed = sourceHash !== acceptedHash;
  if (marker.status === 'revision_required' && !changed && !options.existingBodyConforms) {
    throw new Error('请先审阅修改候选，或明确确认现有正文已符合修订规划后复核。');
  }
  if (options.existingBodyConforms && changed) throw new Error('现有正文已变化，请重新选择复核方式。');
  if (summary.trim().length < 8 || !evidence.length) throw new Error('请填写具体复核结论，并选择至少一处正文依据。');
  const available = producedBodyEvidence(accepted);
  if (evidence.some(item => !available.some(actual => actual.sceneNumber === item.sceneNumber && actual.bodyOrderRef === item.bodyOrderRef && actual.quote === item.quote))) throw new Error('正文依据已变化，请重新选择。');
  const predecessor = project.episodes.find(item => item.episodeNumber === episodeNumber - 1);
  const updated = changed ? {
    ...episode, ...editedDraftPatch(accepted), generationRun: reviewedRun, status: 'saved' as const,
    hasLocalDraftEdits: false, artifactRefs: undefined, modificationCandidate: undefined, modificationCandidateSourceSnapshot: undefined,
    deepeningRun: undefined, updatedAt: new Date().toISOString(),
  } : { ...episode, generationRun: reviewedRun, updatedAt: new Date().toISOString() };
  // Source marker stays until the server validates and acknowledges this command.
  return {
    ...project,
    episodes: project.episodes.map(item => item === episode ? updated : item),
    producedPlanAmendmentResolutionRequest: {
      amendmentId: marker.amendmentId, episodeNumber, resolution: changed ? 'revised' : 'reviewed',
      sourcePlanHash: marker.sourcePlanHash, sourceBodyHash: sourceHash, acceptedBodyHash: acceptedHash,
      predecessorBodyHash: predecessor ? await producedEpisodeBodyHash(predecessor) : null,
      evidence, summary: summary.trim(),
    },
    deliveryConfirmation: undefined, updatedAt: new Date().toISOString(),
  };
}
