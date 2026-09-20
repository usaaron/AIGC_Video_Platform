"use client";

import type { ReactNode } from "react";

export function EpisodePlanningCard({ id, episodeNumber, title, synopsis, status, children }: {
  id: string;
  episodeNumber: number;
  title: string;
  synopsis: string;
  status: string;
  children: ReactNode;
}) {
  return <article className="continuity-card episode-planning-card" id={id}
    data-roadmap-episode={episodeNumber} tabIndex={-1} aria-label={`第${episodeNumber}集规划`}>
    <header className="episode-planning-card-heading">
      <strong>第{episodeNumber}集 · {title}</strong>
      <span>{status}</span>
    </header>
    <p className="episode-planning-card-preview">{synopsis}</p>
    <details className="episode-planning-details">
      <summary>查看与编辑本集规划</summary>
      <div className="episode-planning-card-fields">{children}</div>
    </details>
  </article>;
}
