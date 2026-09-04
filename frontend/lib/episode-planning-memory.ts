import type {
  ScriptProject,
} from "./types.ts";
import { isApprovedEpisodeRoadmap } from "./planning-coverage.ts";

export interface EpisodePlanningMemory {
  last_confirmed_episode: number | null;
  active_continuity_requirements: string[];
  unresolved_setup_refs: string[];
  recorded_payoff_refs: string[];
  active_story_line_refs: string[];
  open_hooks: Array<{
    source_episode: number;
    hook_type: string;
    obligation: string;
    target_episode: number | null;
  }>;
  recent_state_handoffs: Array<{
    episode_number: number;
    exit_state: string;
    pressure_escalation: string;
    next_episode_obligation: string;
  }>;
}

export interface EpisodePlanningMemoryNode {
  node_id: string;
  version: number;
  story_bible_version: number;
  planned_start_episode: number | null;
  status: "draft" | "approved" | "superseded";
  expansion_status: "unexpanded" | "expanded" | "episode_ready";
}

/**
 * Compile a bounded, confirmed roadmap ledger for the next leaf. When the
 * active tree snapshot is available, historical node versions are excluded;
 * the optional argument preserves compatibility with legacy callers.
 */
export function buildEpisodePlanningMemory(
  project: Pick<ScriptProject, "episodeRoadmaps">,
  node: Pick<EpisodePlanningMemoryNode, "story_bible_version" | "planned_start_episode">,
  activeNodes?: EpisodePlanningMemoryNode[],
): EpisodePlanningMemory {
  const activeNodeVersions = activeNodes && activeNodes.length > 0
    ? activeNodes.reduce((latest, activeNode) => {
      const current = latest.get(activeNode.node_id);
      if (!current || activeNode.version > current.version) {
        latest.set(activeNode.node_id, {
          version: activeNode.version,
          storyBibleVersion: activeNode.story_bible_version,
          status: activeNode.status,
          expansionStatus: activeNode.expansion_status,
        });
      }
      return latest;
    }, new Map<string, {
      version: number;
      storyBibleVersion: number;
      status: EpisodePlanningMemoryNode["status"];
      expansionStatus: EpisodePlanningMemoryNode["expansion_status"];
    }>())
    : undefined;
  const latestSourceVersions = new Map<string, number>();
  if (!activeNodeVersions) {
    for (const item of project.episodeRoadmaps ?? []) {
      if (item.story_bible_version !== node.story_bible_version) continue;
      // Compute lineage from every saved revision, including drafts. If a
      // newer draft exists, an older approved revision is stale and must not
      // be promoted into canonical memory while the new revision is pending.
      const latest = latestSourceVersions.get(item.source_node_id) ?? 0;
      if (item.source_node_version > latest) {
        latestSourceVersions.set(item.source_node_id, item.source_node_version);
      }
    }
  }
  const roadmaps = (project.episodeRoadmaps ?? [])
    .filter((item) => (
      item.story_bible_version === node.story_bible_version
      && item.episode_number < (node.planned_start_episode ?? 1)
      // Missing status is the legacy approved shape; explicit drafts (and
      // unknown future statuses) must never enter canonical planning memory.
      && isApprovedEpisodeRoadmap(item)
      && (!activeNodeVersions
        ? item.source_node_version === latestSourceVersions.get(item.source_node_id)
        : (() => {
            const activeNode = activeNodeVersions.get(item.source_node_id);
            return activeNode !== undefined
              && activeNode.storyBibleVersion === node.story_bible_version
              && activeNode.version === item.source_node_version
              && activeNode.status === "approved"
              && activeNode.expansionStatus === "episode_ready";
          })())
    ))
    .sort((left, right) => left.episode_number - right.episode_number);
  const unique = (values: string[], limit: number): string[] => {
    const seen = new Set<string>();
    return values
      .map((value) => value.trim())
      .filter((value) => {
        const key = value.toLocaleLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  };
  const payoffRefs = unique(
    roadmaps.flatMap((item) => item.payoff_refs),
    100,
  );
  const setupRefs = unique(
    roadmaps.flatMap((item) => item.setup_refs),
    100,
  );
  return {
    last_confirmed_episode: roadmaps.at(-1)?.episode_number ?? null,
    active_continuity_requirements: unique(
      roadmaps.slice(-6).flatMap((item) => item.continuity_requirements),
      50,
    ),
    unresolved_setup_refs: setupRefs.filter((ref) => !payoffRefs.includes(ref)),
    recorded_payoff_refs: payoffRefs,
    active_story_line_refs: unique(
      roadmaps.flatMap((item) => item.story_line_refs),
      50,
    ),
    open_hooks: roadmaps
      .filter((item) => (
        item.hook_payoff_target_episode === null
        || item.hook_payoff_target_episode >= (node.planned_start_episode ?? 1)
      ))
      .slice(-20)
      .map((item) => ({
        source_episode: item.episode_number,
        hook_type: item.ending_hook_type,
        obligation: item.next_episode_obligation,
        target_episode: item.hook_payoff_target_episode,
      })),
    recent_state_handoffs: roadmaps.slice(-6).map((item) => ({
      episode_number: item.episode_number,
      exit_state: item.exit_state,
      pressure_escalation: item.pressure_escalation,
      next_episode_obligation: item.next_episode_obligation,
    })),
  };
}
