import type { EpisodeRoadmapItem, EpisodeWorkspace, PlotSetupPayoffRecord } from './types';

export interface SameEpisodeSetupPayoffSource {
  setup_payoff_ref: string;
  episode_number: number;
  source_node_id: string;
  source_node_version: number;
  story_bible_version: number;
}

type TimingProject = {
  episodeRoadmaps?: EpisodeRoadmapItem[];
  setupPayoffs?: PlotSetupPayoffRecord[];
  episodes?: EpisodeWorkspace[];
};
const key = (value: string) => value.trim().toLocaleLowerCase();

/** These are claims for server verification, never a fabricated memory capsule. */
export function sameEpisodeSetupPayoffSources(
  project: TimingProject, episodeNumber: number, storyBibleVersion?: number,
): SameEpisodeSetupPayoffSource[] {
  const version = storyBibleVersion ?? Math.max(0, ...(project.episodeRoadmaps ?? []).map(row => row.story_bible_version));
  if (!Number.isSafeInteger(version) || version < 1) return [];
  const rows = (project.episodeRoadmaps ?? []).filter(row => row.story_bible_version === version);
  const latest = new Map<string, number>();
  for (const row of rows) latest.set(row.source_node_id, Math.max(latest.get(row.source_node_id) ?? 0, row.source_node_version));
  const prefix: EpisodeRoadmapItem[] = [];
  for (let number = 1; number <= episodeNumber; number++) {
    const matches = rows.filter(row => row.episode_number === number && row.source_node_version === latest.get(row.source_node_id));
    if (matches.length !== 1 || matches[0].status !== 'approved' || matches[0].source_revision_review) return [];
    prefix.push(matches[0]);
  }
  const current = prefix.at(-1)!;
  const earlierRefs = new Set(prefix.slice(0, -1).flatMap(row => [...row.setup_refs, ...row.payoff_refs]).map(key));
  for (const record of project.setupPayoffs ?? []) {
    if ([record.setupEpisode, record.lastUpdatedEpisode, record.payoffEpisode, ...record.history.map(change => change.episodeNumber)]
      .some(number => number != null && number >= 0 && number < episodeNumber)) earlierRefs.add(key(record.ref));
  }
  for (const episode of project.episodes ?? []) {
    if (episode.episodeNumber <= 0 || episode.episodeNumber >= episodeNumber) continue;
    const drafts = [episode.generationRun?.draft_master_script, episode.finalizationResult?.master_script];
    for (const serialized of [episode.workingDraftJson, episode.confirmedDraftJson]) {
      try { if (serialized) drafts.push(JSON.parse(serialized)); } catch { /* Earlier projections remain available. */ }
    }
    for (const draft of drafts) for (const update of draft?.setup_payoff_updates ?? []) earlierRefs.add(key(update.source_ref || update.setup_payoff_ref));
  }
  const payoffs = new Set(current.payoff_refs.map(key));
  const seenBefore = (ref: string) => {
    const parts = [...new Set(ref.split(/[,，;；\s]+/).filter(Boolean).map(key))];
    return earlierRefs.has(key(ref)) || (parts.length > 1 && parts.every(part => earlierRefs.has(part)));
  };
  return [...new Set(current.setup_refs)].filter(ref => payoffs.has(key(ref)) && !seenBefore(ref)).map(ref => ({
    setup_payoff_ref: ref, episode_number: episodeNumber, source_node_id: current.source_node_id,
    source_node_version: current.source_node_version, story_bible_version: version,
  }));
}

/** Returned runs retain the validated source; replay still refuses an older actual setup. */
export function sameEpisodeSetupPayoffRefsForRun(episode: EpisodeWorkspace): Set<string> {
  const context = episode.generationRun.episode_context;
  const plan = context?.approved_episode_plan;
  const node = context?.approved_story_node;
  if (!context || !plan || !node || plan.episode_number !== episode.episodeNumber) return new Set();
  return new Set((context.memory_recall?.same_episode_setup_payoffs ?? []).filter(source => (
    source.episode_number === episode.episodeNumber && source.source_node_id === node.node_id
    && source.source_node_version === node.node_version
    && plan.setup_refs.includes(source.setup_payoff_ref) && plan.payoff_refs.includes(source.setup_payoff_ref)
    && (context.planned_setup_refs ?? []).includes(source.setup_payoff_ref) && (context.planned_payoff_refs ?? []).includes(source.setup_payoff_ref)
  )).map(source => source.setup_payoff_ref));
}
