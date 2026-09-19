"use client";

import { useState } from 'react';
import type { EpisodeWorkspace, ScriptProject } from '@/lib/types';
import { authorConflictSourceSnapshot } from '@/lib/author-conflict';
import { synchronizeContinuity } from '@/lib/continuity';
import { buildProducedBodyResolution, producedBodyEvidence } from '@/lib/produced-body-resolution';
import { refreshEpisodeSourceForModification, reviewEpisodeDraft } from '@/lib/generation-client';
import { savePlanningRevisionSnapshot, saveEpisodeArtifactOnServer } from '@/lib/project-sync';
import { resolveWorkingDraft } from '@/lib/script-draft-state';
import { useProjects } from '@/providers/project-provider';

export function ProducedBodyReviewPanel({ project, episode }: { project: ScriptProject; episode: EpisodeWorkspace }) {
  const { getProject, syncProjectSnapshot, adoptServerProjectSnapshot, updateProject } = useProjects();
  const [summary, setSummary] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [existingBodyConfirmation, setExistingBodyConfirmation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const marker = episode.sourceAmendment;
  if (!marker) return message ? <p role="status">{message}</p> : null;
  const candidate = episode.modificationCandidate?.candidate_generation_run;
  const draft = candidate?.draft_master_script ?? resolveWorkingDraft(episode);
  const reviewSource = JSON.stringify([marker, draft]);
  const existingBodyConforms = existingBodyConfirmation === reviewSource;
  const evidence = producedBodyEvidence(draft);
  const first = Math.min(...project.episodes.filter(item => item.sourceAmendment).map(item => item.episodeNumber));
  const blocked = busy || project.planningRevision?.status === 'active' || first !== episode.episodeNumber;
  const requiresExistingBodyConfirmation = marker.status === 'revision_required' && !candidate;
  async function resolve() {
    if (blocked || (requiresExistingBodyConfirmation && !existingBodyConforms)) return;
    setBusy(true); setMessage(null);
    try {
      const initial = getProject(project.id);
      const initialEpisode = initial?.episodes.find(item => item.id === episode.id);
      if (!initial || !initialEpisode) throw new Error('当前项目已变化，请重新载入。');
      const currentCandidate = initialEpisode.modificationCandidate?.candidate_generation_run;
      if (JSON.stringify(currentCandidate?.draft_master_script ?? resolveWorkingDraft(initialEpisode)) !== JSON.stringify(draft)) throw new Error('候选正文已变化，请重新复核。');
      if (currentCandidate && initialEpisode.modificationCandidateSourceSnapshot !== authorConflictSourceSnapshot(initial, initialEpisode, resolveWorkingDraft(initialEpisode))) throw new Error('候选来源已变化，请重新生成候选。');
      const sourceIdentity = authorConflictSourceSnapshot(initial, initialEpisode, resolveWorkingDraft(initialEpisode));
      const refreshed = await refreshEpisodeSourceForModification(currentCandidate ?? initialEpisode.generationRun, initial);
      const reviewed = await reviewEpisodeDraft(refreshed, draft, initial.planningRevisionEpoch ?? 0);
      const sync = await syncProjectSnapshot(initial);
      if (sync.status !== 'synced') throw new Error('请先完成当前项目保存再复核。');
      const current = getProject(project.id) ?? { ...initial, serverSync: sync };
      const currentEpisode = current.episodes.find(item => item.id === episode.id);
      if (!currentEpisode || authorConflictSourceSnapshot(current, currentEpisode, resolveWorkingDraft(currentEpisode)) !== sourceIdentity) throw new Error('正文或规划在复核期间已变化，请重新复核。');
      const selectedEvidence = evidence.filter(item => selected.includes(`${item.sceneNumber}:${item.bodyOrderRef}`));
      const next = await buildProducedBodyResolution(current, episode.episodeNumber, reviewed, selectedEvidence, summary, {
        existingBodyConforms: requiresExistingBodyConfirmation && existingBodyConforms,
      });
      const saved = await savePlanningRevisionSnapshot(current, next);
      if (saved.producedPlanAmendmentResolutionRequest || saved.episodes.find(item => item.id === episode.id)?.sourceAmendment) throw new Error('服务器未确认本集复核结果，请重新加载核对。');
      if (!await adoptServerProjectSnapshot(saved, current)) throw new Error('复核已保存，请重新加载当前项目。');
      await updateProject(project.id, latest => synchronizeContinuity(latest.creativePrompt, latest.characters, latest.episodes, latest.storyLines, latest.characterRelationships, latest.continuityStates));
      // The workspace resolution is authoritative. Store a fresh provisional
      // artifact after acknowledgment; older final artifacts remain in history.
      try {
        const latest = getProject(project.id) ?? saved;
        const artifact = await saveEpisodeArtifactOnServer({ project: latest, episodeNumber: episode.episodeNumber,
          artifactKind: 'draft', memoryLayer: 'provisional', contentSchemaVersion: 'draft_master_script.v1',
          contentPayload: reviewed.draft_master_script, lineageRefs: { draft_master_script_id: reviewed.draft_master_script.id,
            generation_strategy_id: reviewed.generation_strategy_id } });
        if (artifact) await updateProject(project.id, value => ({ episodes: value.episodes.map(item => item.id === episode.id ? { ...item, artifactRefs: { draft: artifact } } : item) }));
      } catch { setMessage('正文与复核记录已保存；独立正文归档尚未同步，请稍后重试归档。'); }
      setSummary(''); setSelected([]); setExistingBodyConfirmation(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : '本集复核未保存。'); }
    finally { setBusy(false); }
  }
  return <section className="inline-notice" aria-label="来源修订正文复核">
    <h3>{marker.status === 'revision_required' ? '执行规划已修订，本集正文待修改或复核' : '前序规划已修订，本集正文待复核'}</h3>
    <p>原稿已留档。请按新规划核对人物知情、行动因果、上下集衔接和25–35句台词；选择具体正文依据后保存复核结论。</p>
    {first !== episode.episodeNumber && <p>请先完成第{first}集。</p>}
    {requiresExistingBodyConfirmation && <>
      <p>可先在修改助手中生成候选；如果现有正文已经落实本次规划修改，请明确选择保留，并说明具体依据。</p>
      <label><input type="checkbox" aria-label="现有正文已符合修订规划" disabled={blocked}
        checked={existingBodyConforms} onChange={event => setExistingBodyConfirmation(event.target.checked ? reviewSource : null)} />现有正文已符合修订规划</label>
    </>}
    <label>复核结论<textarea aria-label="来源修订复核结论" value={summary} disabled={blocked} onChange={event => setSummary(event.target.value)} /></label>
    <details><summary>选择正文依据</summary>{evidence.map(item => {
      const key = `${item.sceneNumber}:${item.bodyOrderRef}`;
      return <label key={key} style={{display:'block'}}><input type="checkbox" disabled={blocked} checked={selected.includes(key)}
        aria-label={`复核依据第${item.sceneNumber}场${item.bodyOrderRef}`} onChange={event => setSelected(event.target.checked ? [...selected,key] : selected.filter(value => value !== key))} />第{item.sceneNumber}场：{item.quote}</label>;
    })}</details>
    <button type="button" disabled={blocked || summary.trim().length < 8 || !selected.length || (requiresExistingBodyConfirmation && !existingBodyConforms)} onClick={() => void resolve()}>{busy ? '正在保存复核' : candidate ? '采用候选并保存来源复核' : requiresExistingBodyConfirmation ? '保留现有正文并保存来源复核' : '保留本集正文并确认依赖复核'}</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
