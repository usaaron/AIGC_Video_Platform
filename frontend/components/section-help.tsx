"use client";

import { CircleHelp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function SectionHelp({ content, label }: { content: string; label: string }) {
  const tooltipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  function cancelHoverTimer() {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  function startHoverTimer() {
    cancelHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => setOpen(true), 2_000);
  }

  useEffect(() => {
    if (!pinned) return;
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPinned(false);
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPinned(false);
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pinned]);

  useEffect(() => () => cancelHoverTimer(), []);

  return (
    <span
      className="section-help"
      onMouseEnter={startHoverTimer}
      onMouseLeave={() => {
        cancelHoverTimer();
        if (!pinned) setOpen(false);
      }}
      ref={rootRef}
    >
      <button
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          cancelHoverTimer();
          setPinned((current) => {
            const next = !current;
            setOpen(next);
            return next;
          });
        }}
        type="button"
      >
        <CircleHelp aria-hidden="true" size={15} strokeWidth={1.8} />
      </button>
      {open ? <span className="section-help-popover" id={tooltipId} role="tooltip">{content}</span> : null}
    </span>
  );
}
