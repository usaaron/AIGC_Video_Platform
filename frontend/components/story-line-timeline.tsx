"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { SectionHelp } from "@/components/section-help";
import { synchronizeContinuity } from "@/lib/continuity";
import {
  buildStoryLineTimeline,
  type StoryLineTimelineEvent,
} from "@/lib/story-line-timeline";
import {
  loadActiveStoryPlanNodes,
  storyBibleIdForProject,
  type StoryPlanNode,
} from "@/lib/story-planning-client";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

type TimelineViewMode = "overview" | "stage" | "episode";

export function StoryLineTimeline() {
  const params = useParams<{ projectId: string }>();
  const { getProject, isReady, updateProject } = useProjects();
  const { t } = useLocale();
  const project = getProject(params.projectId);
  const [viewMode, setViewMode] = useState<TimelineViewMode>("overview");
  const [storyPlanNodes, setStoryPlanNodes] = useState<StoryPlanNode[]>([]);
  const [selectedStageId, setSelectedStageId] = useState("");
  const [selectedEpisode, setSelectedEpisode] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [includeLegacyBackfill, setIncludeLegacyBackfill] = useState(true);

  useEffect(() => {
    if (!project?.storyBibleVersion) return;
    void loadActiveStoryPlanNodes(
      project.id,
      storyBibleIdForProject(project.id),
      project.storyBibleVersion,
    ).then((nodes) => {
      setStoryPlanNodes(nodes);
      const firstStage = stageNodes(nodes)[0];
      if (firstStage) setSelectedStageId((current) => current || firstStage.node_id);
    }).catch(() => setStoryPlanNodes([]));
  }, [project?.id, project?.storyBibleVersion]);

  const model = useMemo(
    () => project
      ? buildStoryLineTimeline(project, includeLegacyBackfill, storyPlanNodes)
      : null,
    [includeLegacyBackfill, project, storyPlanNodes],
  );
  const stages = useMemo(() => stageNodes(storyPlanNodes), [storyPlanNodes]);
  const selectedStage = stages.find((node) => node.node_id === selectedStageId) ?? stages[0];
  const selectedEvent = model?.lanes
    .flatMap((lane) => lane.events)
    .find((event) => event.id === selectedEventId);

  if (!isReady) return <main className="centered-state"><div className="loading-mark" /></main>;
  if (!project || !model) {
    return <main className="centered-state" />;
  }
  const currentProject = project;

  const range = timelineRange(
    viewMode,
    model.maxEpisode,
    selectedStage,
    selectedEpisode,
  );
  const ticks = episodeTicks(range.start, range.end, viewMode === "overview" ? 8 : 12);
  const lanes = model.lanes;
  const width = 1200;
  const labelWidth = 245;
  const plotEnd = 1160;
  const top = 66;
  const laneHeight = 82;
  const height = Math.max(260, top + lanes.length * laneHeight + 42);
  const xForEpisode = (episodeNumber: number) => range.start === range.end
    ? (labelWidth + plotEnd) / 2
    : labelWidth + ((episodeNumber - range.start) / (range.end - range.start)) * (plotEnd - labelWidth);

  function refreshLedger() {
    updateProject(currentProject.id, synchronizeContinuity(
      currentProject.creativePrompt,
      currentProject.characters,
      currentProject.episodes,
      currentProject.storyLines,
      currentProject.characterRelationships,
      currentProject.continuityStates,
    ));
  }

  return (
    <main className="story-line-page page-reveal">
      <header className="workspace-header story-line-header">
        <div>
          <span className="section-kicker">{t("storyLineTimeline.kicker")}</span>
          <div className="section-title-with-help">
            <h1>{t("storyLineTimeline.title")}</h1>
            <SectionHelp content={t("guide.storyLines")} label={t("guide.openHelp")} />
          </div>
          <p>{project.title}</p>
        </div>
        <div className="workspace-header-actions">
          <button className="outline-action" onClick={refreshLedger} type="button">
            {t("continuity.refresh")}
          </button>
          <Link className="outline-action" href={`/projects/${project.id}/workspace?view=continuity`}>
            {t("storyLineTimeline.back")}
          </Link>
        </div>
      </header>

      <div className="story-line-controls">
        <div className="story-line-view-tabs" role="tablist" aria-label={t("storyLineTimeline.viewMode")}>
          {(["overview", "stage", "episode"] as const).map((mode) => (
            <button
              aria-pressed={viewMode === mode}
              key={mode}
              onClick={() => setViewMode(mode)}
              type="button"
            >
              {t(`storyLineTimeline.mode.${mode}`)}
            </button>
          ))}
        </div>
        {viewMode === "stage" ? (
          <label>
            <span>{t("storyLineTimeline.stage")}</span>
            <select onChange={(event) => setSelectedStageId(event.target.value)} value={selectedStage?.node_id ?? ""}>
              {stages.length ? stages.map((stage) => (
                <option key={stage.node_id} value={stage.node_id}>
                  {stage.title} · {stage.planned_start_episode}-{stage.planned_end_episode}
                </option>
              )) : <option value="">{t("storyLineTimeline.noStages")}</option>}
            </select>
          </label>
        ) : null}
        {viewMode === "episode" ? (
          <label>
            <span>{t("storyLineTimeline.episode")}</span>
            <input
              max={model.maxEpisode}
              min={1}
              onChange={(event) => setSelectedEpisode(Math.max(1, Math.min(model.maxEpisode, Number(event.target.value) || 1)))}
              type="number"
              value={selectedEpisode}
            />
          </label>
        ) : null}
        <label className="story-line-backfill-toggle">
          <input
            checked={includeLegacyBackfill}
            onChange={(event) => setIncludeLegacyBackfill(event.target.checked)}
            type="checkbox"
          />
          <span>{t("storyLineTimeline.legacyBackfill")}</span>
        </label>
      </div>

      <div className="story-line-layout">
        <section className="story-line-canvas" aria-label={t("storyLineTimeline.graphLabel")}>
          {lanes.length ? (
            <svg role="img" viewBox={`0 0 ${width} ${height}`}>
              <title>{t("storyLineTimeline.graphLabel")}</title>
              <desc>{t("storyLineTimeline.graphDescription")}</desc>
              <g className="story-line-axis">
                {ticks.map((episodeNumber) => {
                  const x = xForEpisode(episodeNumber);
                  return (
                    <g key={episodeNumber}>
                      <line x1={x} x2={x} y1={42} y2={height - 30} />
                      <text textAnchor="middle" x={x} y={28}>{episodeNumber}</text>
                    </g>
                  );
                })}
              </g>
              <g className="story-line-intersections">
                {model.intersectionEpisodes
                  .filter((episodeNumber) => episodeNumber >= range.start && episodeNumber <= range.end)
                  .map((episodeNumber) => (
                    <g key={episodeNumber}>
                      <line x1={xForEpisode(episodeNumber)} x2={xForEpisode(episodeNumber)} y1={top - 18} y2={top + (lanes.length - 1) * laneHeight + 18} />
                    </g>
                  ))}
              </g>
              {lanes.map((lane, laneIndex) => {
                const y = top + laneIndex * laneHeight;
                const visibleEvents = lane.events.filter((event) => (
                  event.episodeNumber >= range.start && event.episodeNumber <= range.end
                ));
                const laneTitle = lane.type === "setup_payoff"
                  ? t("continuity.setupPayoffs")
                  : lane.title;
                return (
                  <g className={`story-line-lane is-${lane.type}`} key={lane.id}>
                    <text className="story-line-lane-title" x={16} y={y + 4}>{compactLabel(laneTitle, 16)}</text>
                    <text className="story-line-lane-meta" x={16} y={y + 23}>
                      {lane.type === "setup_payoff" ? t("storyLineTimeline.setupLane") : t(`continuity.type.${lane.type}`)}
                    </text>
                    <line className="story-line-lane-track" x1={labelWidth} x2={plotEnd} y1={y} y2={y} />
                    {visibleEvents.length > 1 ? (
                      <polyline
                        className="story-line-progress-path"
                        points={visibleEvents.map((event) => `${xForEpisode(event.episodeNumber)},${y}`).join(" ")}
                      />
                    ) : null}
                    {visibleEvents.map((event) => (
                      <TimelineEventMark
                        event={event}
                        key={event.id}
                        selected={event.id === selectedEventId}
                        setSelectedEventId={setSelectedEventId}
                        showEpisodeLabel={range.end - range.start <= 50}
                        t={t}
                        x={xForEpisode(event.episodeNumber)}
                        y={y}
                      />
                    ))}
                    {!visibleEvents.length ? (
                      <text className="story-line-empty-label" x={labelWidth + 12} y={y - 10}>{t("storyLineTimeline.noEventsInRange")}</text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="continuity-empty-state">
              <p>{t("continuity.emptyStoryLines")}</p>
              <Link className="outline-action" href={`/projects/${project.id}/planning`}>
                {t("navigation.planning")}
              </Link>
            </div>
          )}
          <div className="story-line-legend" aria-label={t("storyLineTimeline.legend")}>
            {(["planned", "actual", "expanded", "deviated", "missing", "backfilled", "paid_off", "overdue"] as const).map((status) => (
              <span key={status}><i className={`is-${status}`} />{t(`storyLineTimeline.status.${status}`)}</span>
            ))}
            <span><i className="is-intersection" />{t("storyLineTimeline.intersection")}</span>
          </div>
        </section>

        <aside className="story-line-detail">
          {selectedEvent ? (
            <EventDetail
              event={selectedEvent}
              projectId={project.id}
              setActiveEpisode={() => updateProject(project.id, { activeEpisodeNumber: selectedEvent.episodeNumber })}
              t={t}
            />
          ) : (
            <div className="story-line-empty-detail">
              <span className="section-kicker">{t("storyLineTimeline.detail")}</span>
              <strong>{t("storyLineTimeline.range").replace("{start}", String(range.start)).replace("{end}", String(range.end))}</strong>
              <p>{t("storyLineTimeline.selectEvent")}</p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function TimelineEventMark({
  event,
  selected,
  setSelectedEventId,
  showEpisodeLabel,
  t,
  x,
  y,
}: {
  event: StoryLineTimelineEvent;
  selected: boolean;
  setSelectedEventId: (id: string) => void;
  showEpisodeLabel: boolean;
  t: (key: string) => string;
  x: number;
  y: number;
}) {
  const select = () => setSelectedEventId(event.id);
  return (
    <g
      aria-label={`${t("workspace.episodeLabel").replace("{number}", String(event.episodeNumber))} ${event.summary}`}
      className={`story-line-event is-${event.status}${selected ? " is-selected" : ""}`}
      onClick={select}
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") select();
      }}
      role="button"
      tabIndex={0}
      transform={`translate(${x} ${y})`}
    >
      {event.status === "deviated" || event.status === "missing" ? (
        <rect height="16" transform="rotate(45)" width="16" x="-8" y="-8" />
      ) : event.status === "planned" || event.status === "backfilled" ? (
        <circle r="8" />
      ) : (
        <circle r="9" />
      )}
      {showEpisodeLabel ? <text textAnchor="middle" y={-14}>{event.episodeNumber}</text> : null}
    </g>
  );
}

function EventDetail({
  event,
  projectId,
  setActiveEpisode,
  t,
}: {
  event: StoryLineTimelineEvent;
  projectId: string;
  setActiveEpisode: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="story-line-event-detail">
      <span className="section-kicker">{t("workspace.episodeLabel").replace("{number}", String(event.episodeNumber))}</span>
      <div className="section-title-with-help">
        <h2>{event.setupPayoffRef || t(`storyLineTimeline.status.${event.status}`)}</h2>
        <SectionHelp content={t("guide.storyLineDetail")} label={t("guide.openHelp")} />
      </div>
      <p className="story-line-detail-summary">{event.summary}</p>
      <dl>
        <div><dt>{t("storyLineTimeline.source")}</dt><dd>{t(`storyLineTimeline.source.${event.source}`)}</dd></div>
        {event.contributionType ? <div><dt>{t("continuity.contributionType")}</dt><dd>{t(`continuity.contribution.${event.contributionType}`)}</dd></div> : null}
        {event.plannedBeat ? <div><dt>{t("continuity.plannedBeat")}</dt><dd>{event.plannedBeat}</dd></div> : null}
        {event.cause ? <div><dt>{t("continuity.changeCause")}</dt><dd>{event.cause}</dd></div> : null}
        {event.evidenceSceneNumbers?.length ? <div><dt>{t("continuity.evidenceScenes")}</dt><dd>{event.evidenceSceneNumbers.join("、")}</dd></div> : null}
        {event.nextRequiredStep ? <div><dt>{t("continuity.nextRequiredStep")}</dt><dd>{event.nextRequiredStep}</dd></div> : null}
      </dl>
      <Link
        className="outline-action"
        href={`/projects/${projectId}/workspace`}
        onClick={setActiveEpisode}
      >
        {t("storyLineTimeline.openEpisode")}
      </Link>
    </div>
  );
}

function stageNodes(nodes: StoryPlanNode[]): StoryPlanNode[] {
  const ranged = nodes.filter((node) => (
    node.status === "approved"
    && node.planned_start_episode !== null
    && node.planned_end_episode !== null
  ));
  const parents = new Set(ranged.map((node) => node.parent_node_id).filter(Boolean));
  const stages = ranged.filter((node) => (
    node.expansion_status !== "episode_ready"
    || parents.has(node.node_id)
  ));
  return (stages.length ? stages : ranged).sort((left, right) => (
    (left.planned_start_episode ?? 0) - (right.planned_start_episode ?? 0)
    || (left.planned_end_episode ?? 0) - (right.planned_end_episode ?? 0)
  ));
}

function timelineRange(
  mode: TimelineViewMode,
  maxEpisode: number,
  stage: StoryPlanNode | undefined,
  selectedEpisode: number,
): { start: number; end: number } {
  if (mode === "episode") return { start: selectedEpisode, end: selectedEpisode };
  if (mode === "stage" && stage?.planned_start_episode && stage.planned_end_episode) {
    return { start: stage.planned_start_episode, end: stage.planned_end_episode };
  }
  return { start: 1, end: maxEpisode };
}

function episodeTicks(start: number, end: number, preferredCount: number): number[] {
  if (start === end) return [start];
  const span = end - start;
  const step = Math.max(1, Math.ceil(span / Math.max(1, preferredCount - 1)));
  const ticks = [start];
  for (let value = Math.ceil(start / step) * step; value < end; value += step) {
    if (value > start) ticks.push(value);
  }
  if (ticks.at(-1) !== end) ticks.push(end);
  return ticks;
}

function compactLabel(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
