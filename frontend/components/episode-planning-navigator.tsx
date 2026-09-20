"use client";

import { useState } from "react";

export type PlanningEpisodeEntry = {
  episodeNumber: number;
  title: string;
  status: string;
};

const PAGE_SIZE = 24;

/** Reading saved episodes must never acquire a generation or editing lock. */
export function EpisodePlanningNavigator({ entries, currentEpisodeNumber, totalEpisodes, generating, fullStructure, onSelect, onToggleStructure }: {
  entries: PlanningEpisodeEntry[];
  currentEpisodeNumber: number | null;
  totalEpisodes: number;
  generating: boolean;
  fullStructure: boolean;
  onSelect: (episodeNumber: number) => void;
  onToggleStructure: () => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const sorted = [...entries].sort((left, right) => left.episodeNumber - right.episodeNumber);
  const byNumber = new Map(sorted.map(entry => [entry.episodeNumber, entry]));
  const count = Math.max(totalEpisodes, ...sorted.map(entry => entry.episodeNumber), 0);
  const search = query.trim().toLocaleLowerCase();
  const numberQuery = /^(?:第\s*)?(\d+)(?:\s*集)?$/.exec(search);
  const matches = Array.from({ length: count }, (_, index) => index + 1).filter(number => {
    if (!search) return true;
    if (numberQuery) return number === Number(numberQuery[1]);
    return byNumber.get(number)?.title.toLocaleLowerCase().includes(search);
  });
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const currentIndex = sorted.findIndex(entry => entry.episodeNumber === currentEpisodeNumber);

  function select(number: number) {
    if (byNumber.has(number)) onSelect(number);
  }

  return <section className="host-episode-planning-nav" aria-label="分集大纲浏览">
    <div className="host-episode-planning-current">
      <label>当前集<select aria-label="选择分集大纲" value={currentEpisodeNumber ?? ""}
        onChange={event => select(Number(event.target.value))}>
        {sorted.map(entry => <option key={entry.episodeNumber} value={entry.episodeNumber}>
          第{entry.episodeNumber}集 · {entry.title} · {entry.status}
        </option>)}
      </select></label>
      <div className="host-episode-planning-paging">
        <button className="outline-action" type="button" disabled={currentIndex <= 0}
          onClick={() => select(sorted[currentIndex - 1].episodeNumber)}>上一集</button>
        <button className="outline-action" type="button" disabled={currentIndex < 0 || currentIndex >= sorted.length - 1}
          onClick={() => select(sorted[currentIndex + 1].episodeNumber)}>下一集</button>
      </div>
    </div>
    {generating ? <p className="host-episode-planning-read-status" role="status">
      已生成 {byNumber.size}/{count} 集，可随时查看已完成内容。生成会继续进行。
    </p> : null}
    <details className="host-episode-planning-overview" onToggle={event => {
      if (event.currentTarget.open && !query && currentEpisodeNumber) setPage(Math.floor((currentEpisodeNumber - 1) / PAGE_SIZE));
    }}>
      <summary>全部分集总览 · {count} 集</summary>
      <div className="host-episode-overview-controls">
        <label>查找分集<input type="search" aria-label="按集数或标题查找分集" placeholder="输入集数或标题"
          value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
        <span>{byNumber.size} 集已生成</span>
      </div>
      <div className="host-episode-overview-grid">
        {visible.map(number => {
          const entry = byNumber.get(number);
          return <button className="host-episode-overview-item" type="button" key={number}
            aria-label={`查看第${number}集${entry ? `：${entry.title}` : "：待生成"}`}
            aria-pressed={!fullStructure && currentEpisodeNumber === number} disabled={!entry}
            title={entry ? `第${number}集 · ${entry.title} · ${entry.status}` : `第${number}集尚未生成`}
            onClick={() => select(number)}>
            <strong>第{number}集</strong><span>{entry?.status ?? "待生成"}</span>
            <p>{entry?.title ?? "生成后可查看"}</p>
          </button>;
        })}
      </div>
      {visible.length === 0 ? <p className="host-episode-overview-empty">没有匹配的集数或标题</p> : null}
      {pages > 1 ? <nav className="host-episode-overview-pages" aria-label="分集总览分页">
        <button className="outline-action" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
        <span>第 {currentPage + 1}/{pages} 页</span>
        <button className="outline-action" type="button" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>下一页</button>
      </nav> : null}
    </details>
    <button className="text-action host-planning-structure-toggle" type="button" aria-pressed={fullStructure}
      onClick={onToggleStructure}>{fullStructure ? "返回当前集" : "查看完整剧情结构"}</button>
  </section>;
}
