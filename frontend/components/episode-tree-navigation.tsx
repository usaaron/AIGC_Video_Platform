"use client";

import { useEffect, useMemo, useState } from "react";

import { ArrowIcon, PlusIcon } from "@/components/icons";
import { SectionHelp } from "@/components/section-help";
import {
  buildEpisodeNavigationTree,
  episodeNavigationPath,
  type EpisodeNavigationBranch,
} from "@/lib/episode-navigation-tree";
import {
  loadActiveStoryPlanNodes,
  storyBibleIdForProject,
  type StoryPlanNode,
} from "@/lib/story-planning-client";
import { useLocale } from "@/providers/locale-provider";

export interface EpisodeNavigationEntry {
  id: string;
  episodeNumber: number;
  label: string;
  statusLabel: string;
}

export function EpisodeTreeNavigation({
  activeEpisodeNumber,
  entries,
  heading,
  nextBatchLabel,
  onNextBatch,
  onSelectEpisode,
  projectId,
  showNextBatch,
  storyBibleVersion,
  totalEpisodes,
  nextBatchDisabled = false,
}: {
  activeEpisodeNumber: number;
  entries: EpisodeNavigationEntry[];
  heading: string;
  nextBatchLabel: string;
  onNextBatch: () => void;
  onSelectEpisode: (episodeNumber: number) => void;
  projectId: string;
  showNextBatch: boolean;
  storyBibleVersion?: number;
  totalEpisodes: number;
  nextBatchDisabled?: boolean;
}) {
  const { t } = useLocale();
  const [storyPlanNodes, setStoryPlanNodes] = useState<StoryPlanNode[]>([]);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const sortedEntries = useMemo(
    () => entries.slice().sort((left, right) => left.episodeNumber - right.episodeNumber),
    [entries],
  );
  const entryByEpisode = useMemo(
    () => new Map(sortedEntries.map((entry) => [entry.episodeNumber, entry])),
    [sortedEntries],
  );
  const tree = useMemo(
    () => buildEpisodeNavigationTree(
      storyPlanNodes,
      sortedEntries.map((entry) => entry.episodeNumber),
    ),
    [sortedEntries, storyPlanNodes],
  );

  useEffect(() => {
    if (!storyBibleVersion) {
      setStoryPlanNodes([]);
      return;
    }
    let cancelled = false;
    void loadActiveStoryPlanNodes(
      projectId,
      storyBibleIdForProject(projectId),
      storyBibleVersion,
    ).then((nodes) => {
      if (!cancelled) setStoryPlanNodes(nodes);
    }).catch(() => {
      if (!cancelled) setStoryPlanNodes([]);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, storyBibleVersion]);

  useEffect(() => {
    const activePath = episodeNavigationPath(tree.branches, activeEpisodeNumber);
    if (!activePath.length) return;
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      activePath.forEach((nodeId) => next.add(nodeId));
      return next.size === current.size ? current : next;
    });
  }, [activeEpisodeNumber, tree.branches]);

  function toggleNode(nodeId: string): void {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function renderEpisode(episodeNumber: number, depth: number) {
    const entry = entryByEpisode.get(episodeNumber);
    if (!entry) return null;
    return (
      <button
        className={`episode-rail-episode ${episodeNumber === activeEpisodeNumber ? "is-active" : ""}`}
        key={entry.id}
        onClick={() => onSelectEpisode(episodeNumber)}
        style={{ paddingLeft: `${13 + Math.min(depth, 6) * 12}px` }}
        type="button"
      >
        <span>{String(episodeNumber).padStart(2, "0")}</span>
        <strong>{entry.label}</strong>
        <small>{entry.statusLabel}</small>
      </button>
    );
  }

  function renderBranch(branch: EpisodeNavigationBranch, depth: number) {
    const isOpen = expandedNodeIds.has(branch.nodeId);
    return (
      <div className="episode-tree-branch" key={branch.nodeId}>
        <button
          aria-expanded={isOpen}
          className={`episode-tree-node ${branch.episodeNumbers.includes(activeEpisodeNumber) ? "has-active-episode" : ""}`}
          onClick={() => toggleNode(branch.nodeId)}
          style={{ paddingLeft: `${10 + Math.min(depth, 6) * 12}px` }}
          title={branch.title}
          type="button"
        >
          <ArrowIcon />
          <span>{branch.title}</span>
        </button>
        {isOpen ? (
          <div className="episode-tree-children">
            {branch.children.map((child) => renderBranch(child, depth + 1))}
            {branch.directEpisodeNumbers.map((episodeNumber) => renderEpisode(episodeNumber, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  }

  const hasTree = tree.branches.length > 0;
  return (
    <aside className="episode-rail">
      <div className="episode-rail-heading">
        <span className="episode-rail-heading-label">
          {heading}
          <SectionHelp content={t("guide.episodeNavigation")} label={t("guide.openHelp")} />
        </span>
        <strong>{entries.length}/{totalEpisodes}</strong>
      </div>
      <div className="episode-tree-scroll">
        {hasTree ? tree.branches.map((branch) => renderBranch(branch, 0)) : null}
        {(hasTree ? tree.unassignedEpisodeNumbers : sortedEntries.map((entry) => entry.episodeNumber))
          .map((episodeNumber) => renderEpisode(episodeNumber, 0))}
      </div>
      {showNextBatch ? (
        <button
          className="episode-add"
          disabled={nextBatchDisabled}
          onClick={onNextBatch}
          type="button"
        >
          <PlusIcon /> {nextBatchLabel}
        </button>
      ) : null}
    </aside>
  );
}
