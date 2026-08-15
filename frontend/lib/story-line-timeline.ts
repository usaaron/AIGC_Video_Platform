import type {
  GeneratedDraft,
  PlotSetupPayoffRecord,
  ProjectStoryLine,
  ScriptProject,
  StoryLineEpisodeBeat,
} from "@/lib/types";
import type { StoryPlanNode } from "@/lib/story-planning-client";

export type StoryLineTimelineEventStatus =
  | "planned"
  | "actual"
  | "expanded"
  | "deviated"
  | "missing"
  | "backfilled"
  | "paid_off"
  | "overdue";

export interface StoryLineTimelineEvent {
  id: string;
  episodeNumber: number;
  lineId: string;
  summary: string;
  status: StoryLineTimelineEventStatus;
  contributionType?: StoryLineEpisodeBeat["contributionType"];
  cause?: string;
  evidenceSceneNumbers?: number[];
  plannedBeat?: string;
  plannedBeatRef?: string;
  nextRequiredStep?: string;
  source: "ledger" | "roadmap" | "legacy" | "setup_payoff";
  setupPayoffRef?: string;
}

export interface StoryLineTimelineLane {
  id: string;
  title: string;
  type: ProjectStoryLine["type"] | "setup_payoff";
  status?: ProjectStoryLine["status"];
  events: StoryLineTimelineEvent[];
}

export interface StoryLineTimelineModel {
  lanes: StoryLineTimelineLane[];
  intersectionEpisodes: number[];
  maxEpisode: number;
}

export function buildStoryLineTimeline(
  project: ScriptProject,
  includeLegacyBackfill = true,
  storyPlanNodes: StoryPlanNode[] = [],
): StoryLineTimelineModel {
  const roadmapByLine = new Map<string, Set<number>>();
  const roadmapSummaryByLineEpisode = new Map<string, string>();
  for (const roadmap of project.episodeRoadmaps ?? []) {
    for (const lineId of roadmap.story_line_refs) {
      const key = `${lineId}::${roadmap.episode_number}`;
      const episodes = roadmapByLine.get(lineId) ?? new Set<number>();
      episodes.add(roadmap.episode_number);
      roadmapByLine.set(lineId, episodes);
      roadmapSummaryByLineEpisode.set(key, roadmap.episode_goal);
    }
  }
  const nodeParents = new Set(
    storyPlanNodes.map((node) => node.parent_node_id).filter(Boolean),
  );
  const timelineNodes = storyPlanNodes.filter((node) => (
    node.status === "approved"
    && node.planned_start_episode !== null
    && node.planned_end_episode !== null
    && (node.expansion_status === "episode_ready" || !nodeParents.has(node.node_id))
  ));
  for (const node of timelineNodes) {
    for (const lineId of node.story_line_refs) {
      const episodes = roadmapByLine.get(lineId) ?? new Set<number>();
      for (
        let episodeNumber = node.planned_start_episode as number;
        episodeNumber <= (node.planned_end_episode as number);
        episodeNumber += 1
      ) {
        episodes.add(episodeNumber);
        const key = `${lineId}::${episodeNumber}`;
        if (!roadmapSummaryByLineEpisode.has(key)) {
          roadmapSummaryByLineEpisode.set(
            key,
            `${node.title}：${node.narrative_purpose}`,
          );
        }
      }
      roadmapByLine.set(lineId, episodes);
    }
  }

  const lanes: StoryLineTimelineLane[] = project.storyLines.map((line) => {
    const events: StoryLineTimelineEvent[] = line.episodeBeats.map((beat) => ({
      id: `${line.id}::ledger::${beat.episodeNumber}`,
      episodeNumber: beat.episodeNumber,
      lineId: line.id,
      summary: beat.summary,
      status: beat.alignment === "missing"
        ? "missing"
        : beat.alignment === "deviated"
          ? "deviated"
          : beat.alignment === "expanded"
            ? "expanded"
            : "actual",
      contributionType: beat.contributionType,
      cause: beat.cause,
      evidenceSceneNumbers: beat.evidenceSceneNumbers,
      plannedBeat: beat.plannedBeat,
      plannedBeatRef: beat.plannedBeatRef,
      nextRequiredStep: beat.nextRequiredStep,
      source: "ledger",
    }));
    const actualEpisodes = new Set(events.map((event) => event.episodeNumber));
    for (const episodeNumber of roadmapByLine.get(line.id) ?? []) {
      if (actualEpisodes.has(episodeNumber)) continue;
      const episode = project.episodes.find((item) => item.episodeNumber === episodeNumber);
      const roadmapSummary = roadmapSummaryByLineEpisode.get(`${line.id}::${episodeNumber}`);
      if (episode && includeLegacyBackfill) {
        const draft = readEpisodeDraft(episode);
        events.push({
          id: `${line.id}::legacy::${episodeNumber}`,
          episodeNumber,
          lineId: line.id,
          summary: draft?.episode_goal || draft?.synopsis || roadmapSummary || "Legacy episode requires ledger review.",
          status: "backfilled",
          plannedBeat: roadmapSummary,
          source: "legacy",
          evidenceSceneNumbers: draft?.scenes?.map((scene) => scene.scene_number),
        });
      } else {
        events.push({
          id: `${line.id}::roadmap::${episodeNumber}`,
          episodeNumber,
          lineId: line.id,
          summary: roadmapSummary || "Planned story-line duty",
          status: "planned",
          plannedBeat: roadmapSummary,
          source: "roadmap",
        });
      }
    }
    return {
      id: line.id,
      title: line.title,
      type: line.type,
      status: line.status,
      events: events.sort((left, right) => left.episodeNumber - right.episodeNumber),
    };
  });

  const setupPayoffLane = buildSetupPayoffLane(project.setupPayoffs ?? []);
  if (setupPayoffLane.events.length) lanes.push(setupPayoffLane);

  const episodeLaneCounts = new Map<number, number>();
  for (const lane of lanes.filter((item) => item.type !== "setup_payoff")) {
    for (const event of lane.events) {
      episodeLaneCounts.set(event.episodeNumber, (episodeLaneCounts.get(event.episodeNumber) ?? 0) + 1);
    }
  }
  const maxEpisode = Math.max(
    1,
    project.generationSettings.episodeCount,
    ...project.episodes.map((episode) => episode.episodeNumber),
    ...lanes.flatMap((lane) => lane.events.map((event) => event.episodeNumber)),
  );
  return {
    lanes,
    intersectionEpisodes: [...episodeLaneCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([episodeNumber]) => episodeNumber)
      .sort((left, right) => left - right),
    maxEpisode,
  };
}

function buildSetupPayoffLane(records: PlotSetupPayoffRecord[]): StoryLineTimelineLane {
  const events: StoryLineTimelineEvent[] = [];
  for (const record of records) {
    for (const change of record.history) {
      events.push({
        id: `${record.ref}::${change.episodeNumber}::${change.action}`,
        episodeNumber: change.episodeNumber,
        lineId: "storyline.setup_payoff",
        summary: change.summary,
        status: change.action === "payoff" ? "paid_off" : change.action === "defer" ? "overdue" : "actual",
        cause: change.cause,
        evidenceSceneNumbers: change.evidenceSceneNumbers,
        source: "setup_payoff",
        setupPayoffRef: record.ref,
        nextRequiredStep: record.nextRequiredStep,
      });
    }
    if (
      record.targetPayoffEpisode
      && record.status !== "paid_off"
      && !events.some((event) => event.setupPayoffRef === record.ref && event.episodeNumber === record.targetPayoffEpisode)
    ) {
      events.push({
        id: `${record.ref}::target::${record.targetPayoffEpisode}`,
        episodeNumber: record.targetPayoffEpisode,
        lineId: "storyline.setup_payoff",
        summary: record.description,
        status: record.status === "overdue" ? "overdue" : "planned",
        source: "setup_payoff",
        setupPayoffRef: record.ref,
        nextRequiredStep: record.nextRequiredStep,
      });
    }
  }
  return {
    id: "storyline.setup_payoff",
    title: "Long-range setups and payoffs",
    type: "setup_payoff",
    events: events.sort((left, right) => left.episodeNumber - right.episodeNumber),
  };
}

function readEpisodeDraft(episode: ScriptProject["episodes"][number]): GeneratedDraft | null {
  try {
    const parsed = JSON.parse(episode.workingDraftJson) as GeneratedDraft;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return episode.generationRun?.draft_master_script ?? null;
  }
}
