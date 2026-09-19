"use client";

import { useEffect, useState } from "react";

import type { DocumentOutlineEntry } from "@/components/document-outline";

// Reading position is local UI state: scrolling must not select an episode or save a project.
export function useDocumentScrollPosition(
  entries: DocumentOutlineEntry[],
  selectedId?: string | null,
) {
  const anchorIds = JSON.stringify(entries.filter((entry) => !entry.disabled).map((entry) => entry.id));
  const key = `${anchorIds}:${selectedId ?? ""}`;
  const [position, setPosition] = useState<{ key: string; id: string | null } | null>(null);

  useEffect(() => {
    const ids: string[] = JSON.parse(anchorIds);
    let frame = 0;
    const update = () => {
      frame = 0;
      const anchors = ids.flatMap((id) => {
        const element = document.getElementById(id);
        if (!element || !element.getClientRects().length) return [];
        const rect = element.getBoundingClientRect();
        return rect.height && rect.width ? [{ id, element, top: rect.top }] : [];
      });
      let id = selectedId ?? null;
      if (anchors.length) {
        let root = anchors[0].element.parentElement;
        while (root && (!/(auto|scroll)/.test(getComputedStyle(root).overflowY)
          || root.scrollHeight - root.clientHeight <= 2)) {
          root = root.parentElement;
        }
        if (root === document.body || root === document.documentElement) root = null;
        const rootRect = root?.getBoundingClientRect();
        const top = Math.max(0, rootRect?.top ?? 0);
        const bottom = Math.min(window.innerHeight, rootRect?.bottom ?? window.innerHeight);
        const readingLine = top + Math.min(120, Math.max(0, bottom - top) * 0.2);
        id = anchors[0].id;
        for (const anchor of anchors) {
          if (anchor.top <= readingLine) id = anchor.id;
        }
        const scroller = root ?? document.scrollingElement;
        if (scroller && scroller.scrollTop > 0
          && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2
          && anchors[anchors.length - 1].element.getBoundingClientRect().bottom <= bottom + 2) {
          id = anchors[anchors.length - 1].id;
        }
      }
      setPosition((current) => current?.key === key && current.id === id ? current : { key, id });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onScroll = (event: Event) => {
      // The directory has its own scroll area; moving it must not move the reading position.
      if (event.target instanceof Element && event.target.closest(".workspace-section-directory")) return;
      schedule();
    };
    const observer = new ResizeObserver(schedule);
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    schedule();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", schedule);
    };
  }, [anchorIds, key, selectedId]);

  return position?.key === key ? position.id : selectedId;
}
