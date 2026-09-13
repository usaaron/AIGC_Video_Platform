"use client";

import { useId, useState } from "react";
import { ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { TagChoice } from "@/components/tag-choice";
import { ToolButton } from "@/components/workspace-controls";
import type { useHongguoCatalog } from "@/components/use-hongguo-catalog";
import { hongguoTrendOptions, type HongguoTrend } from "@/lib/hongguo-tags";
import { creatorTagMatchesQuery, matchingSelectedTagIds } from "@/lib/tag-catalog";
import type { CreatorTag, CustomTagDraft } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";

type Feed = ReturnType<typeof useHongguoCatalog>;

export function HongguoCatalogStatus({ feed, showCount = false }: { feed: Feed; showCount?: boolean }) {
  const { locale, t } = useLocale();
  const { data, loading, stale } = feed;
  return <>
    <div className="hongguo-toolbar">
      <a className="hongguo-source" href="https://hongguoduanju.com/" target="_blank" rel="noreferrer">{t("tags.hongguoSource")}<ExternalLink size={13} /></a>
      <ToolButton label={t("tags.refresh")} disabled={loading} onClick={feed.refresh}>
        <RefreshCw size={16} className={loading ? "ui-spinner" : ""} />
      </ToolButton>
    </div>
    <div className="hongguo-data-status" role="status">
      {data ? <>
        {data.fetched_at && <span>{t("tags.lastUpdated")} {new Date(data.fetched_at).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
        {showCount && <span>{data.sample_work_count} {t("tags.sampleWorks")}</span>}
        {stale && <span className="is-stale">{t("tags.cachedData")}</span>}
      </> : <span>{loading ? t("tags.loading") : t("tags.trendsUnavailable")}</span>}
    </div>
  </>;
}

export function HongguoTagPanel({ feed, availableTags, customTags, selectedTagIds, readOnly, query, onToggle }: {
  feed: Feed;
  availableTags: CreatorTag[]; customTags: CustomTagDraft[]; selectedTagIds: string[]; readOnly: boolean;
  query: string; onToggle: (tag: CreatorTag) => void;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const { data, loading } = feed;
  const visible = hongguoTrendOptions(data?.recommendations ?? [], availableTags, customTags)
    .filter(({ record, tag }) => creatorTagMatchesQuery(tag, query) || record.raw_labels.some((label) => label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const limited = !query && !expanded && visible.length > 12;
  const shown = limited ? visible.slice(0, 12) : visible;
  return <div className="hongguo-tag-panel" aria-busy={loading}>
    <HongguoCatalogStatus feed={feed} showCount />
    {data && <p className="hongguo-method">{t("tags.hongguoMethod")}</p>}
    <div className="hongguo-trend-list">
      {shown.map(({ record, tag }) => <HongguoTrendRow key={tag.id} record={record}
        tag={tag} selected={matchingSelectedTagIds(tag, selectedTagIds, customTags).length > 0} readOnly={readOnly} onToggle={onToggle} />)}
      {data && !visible.length && <p className="tag-empty-state">{t("tags.noResults")}</p>}
    </div>
    {!query && visible.length > 12 && <button className="tag-show-more" type="button" onClick={() => setExpanded((value) => !value)}>
      {t(limited ? "tags.showMore" : "tags.showLess")} {limited ? `(${visible.length - 12})` : ""}<ChevronDown size={14} className={limited ? "" : "is-expanded"} />
    </button>}
  </div>;
}

function HongguoTrendRow({ record, tag, selected, readOnly, onToggle }: {
  record: HongguoTrend; tag: CreatorTag; selected: boolean; readOnly: boolean; onToggle: (tag: CreatorTag) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="hongguo-trend-row">
    <span className="hongguo-trend-rank">{String(record.rank).padStart(2, "0")}</span>
    <TagChoice tag={tag} label={tag.labelZh} selected={selected} disabled={readOnly} onToggle={onToggle} />
    <span className="hongguo-work-count">{record.ranked_work_count} {t("tags.rankedWorks")}</span>
    <button className="hongguo-evidence-toggle" type="button" aria-expanded={open} aria-controls={id}
      aria-label={`${t("tags.viewWorks")} · ${tag.labelZh}`} onClick={() => setOpen((value) => !value)}>
      {t("tags.viewWorks")}<ChevronDown size={14} />
    </button>
    <ul id={id} className="hongguo-evidence-works" hidden={!open}>{open && record.sample_works?.map((work) => <li key={work.url}>
      {work.cover_url && <img src={work.cover_url} alt="" width={36} height={48} loading="lazy" />}
      <span className="hongguo-work-rank">#{work.rank}</span>
      <a href={work.url} target="_blank" rel="noreferrer">{work.title}<ExternalLink size={12} /></a>
    </li>)}</ul>
  </div>;
}
