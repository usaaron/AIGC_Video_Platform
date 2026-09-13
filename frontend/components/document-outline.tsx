"use client";

import { List } from "lucide-react";

export interface DocumentOutlineEntry {
  id: string;
  label: string;
  meta?: string;
  depth?: number;
  disabled?: boolean;
  isCurrent?: boolean;
  status?: "queued" | "active" | "completed" | "failed";
  statusLabel?: string;
}

/** Compact document TOC used beside long-form planning and screenplay text. */
export function DocumentOutline({
  activeId,
  entries,
  heading = "目录",
  onSelect,
}: {
  activeId?: string | null;
  entries: DocumentOutlineEntry[];
  heading?: string;
  onSelect: (entry: DocumentOutlineEntry) => void;
}) {
  return (
    <aside className="document-outline">
      <div className="document-outline-heading">
        <span><List aria-hidden="true" size={14} />{heading}</span>
        <small>{entries.length}</small>
      </div>
      <nav aria-label={heading} className="document-outline-scroll">
        {entries.length ? entries.map((entry) => (
          <button
            aria-current={activeId === entry.id ? "location" : undefined}
            className={activeId === entry.id ? "is-active" : ""}
            key={entry.id}
            onClick={() => onSelect(entry)}
            style={{ paddingLeft: `${12 + Math.min(entry.depth ?? 0, 6) * 14}px` }}
            type="button"
          >
            <span>{entry.label}</span>
            {entry.meta ? <small>{entry.meta}</small> : null}
          </button>
        )) : (
          <p className="document-outline-empty">生成内容后会显示目录</p>
        )}
      </nav>
    </aside>
  );
}
