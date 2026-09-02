"use client";

import { ArrowRight, Expand, Minimize2, PenLine, Sparkles, WandSparkles, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { StoryBibleSelectionContext } from "@/lib/story-planning-client";
import type { PlanningCanvasAction, PlanningCanvasQuickAction } from "@/components/planning-canvas-copilot";

const ACTION_ICONS = {
  continue: ArrowRight,
  polish: WandSparkles,
  rewrite: PenLine,
  expand: Expand,
  shorten: Minimize2,
} satisfies Record<PlanningCanvasAction, LucideIcon>;

const PERSISTENT_SELECTION_HIGHLIGHT = "interactive-edit-selection";
let persistentHighlightOwner: symbol | null = null;

/** Small, selection-preserving action strip shared by every planning document. */
export function SelectionEditToolbar({
  actions,
  disabled = false,
  onAction,
  onClear,
  selection,
}: {
  actions: PlanningCanvasQuickAction[];
  disabled?: boolean;
  onAction: (action: PlanningCanvasAction, instruction: string) => void;
  onClear?: () => void;
  selection: StoryBibleSelectionContext | null;
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const highlightOwnerRef = useRef(Symbol("interactive-edit-selection"));

  useLayoutEffect(() => {
    if (!selection || typeof window === "undefined") {
      setPosition(null);
      clearPersistentSelectionHighlight(highlightOwnerRef.current);
      return;
    }
    const nativeSelection = window.getSelection();
    const range = nativeSelection && nativeSelection.rangeCount > 0
      ? nativeSelection.getRangeAt(0)
      : null;
    if (range && !nativeSelection?.isCollapsed) {
      persistSelectionHighlight(range.cloneRange(), highlightOwnerRef.current);
    }
    const activeControl = document.activeElement instanceof HTMLTextAreaElement
      && activeControlHasSelection(document.activeElement)
      ? document.activeElement
      : null;
    const rect = range?.getBoundingClientRect() ?? activeControl?.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      setPosition(null);
      return;
    }
    const width = Math.min(560, Math.max(280, actions.length * 76 + 44));
    const left = Math.max(12, Math.min(
      window.innerWidth - width - 12,
      rect.left + rect.width / 2 - width / 2,
    ));
    const top = rect.top >= 58 ? rect.top - 48 : rect.bottom + 10;
    setPosition({ left, top: Math.max(8, top) });
  }, [actions.length, selection]);

  useEffect(() => () => {
    clearPersistentSelectionHighlight(highlightOwnerRef.current);
  }, []);

  useEffect(() => {
    if (!selection || typeof document === "undefined") return;
    let animationFrame = 0;
    const hideCollapsedSelectionToolbar = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        if (!hasActiveTextSelection()) setPosition(null);
      });
    };
    const hideOnOutsideInteraction = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node) || !toolbarRef.current?.contains(target)) {
        setPosition(null);
      }
    };
    document.addEventListener("selectionchange", hideCollapsedSelectionToolbar);
    document.addEventListener("pointerdown", hideOnOutsideInteraction, true);
    document.addEventListener("focusin", hideOnOutsideInteraction, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("selectionchange", hideCollapsedSelectionToolbar);
      document.removeEventListener("pointerdown", hideOnOutsideInteraction, true);
      document.removeEventListener("focusin", hideOnOutsideInteraction, true);
    };
  }, [selection]);

  if (!selection || !position) return null;
  return (
    <div
      aria-label="选中文字快捷操作"
      className="selection-edit-toolbar"
      onKeyUp={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.preventDefault()}
      onMouseUp={(event) => event.stopPropagation()}
      ref={toolbarRef}
      role="toolbar"
      style={{ left: position.left, top: position.top }}
    >
      <span className="selection-edit-toolbar-quote" title={selection.source_field}>
        <Sparkles aria-hidden="true" size={14} />
      </span>
      {actions.map((action) => {
        const Icon = ACTION_ICONS[action.id];
        return (
          <button
            aria-label={action.label}
            className="selection-edit-toolbar-action"
            disabled={disabled}
            key={action.id}
            onClick={() => onAction(action.id, action.instruction)}
            title={action.label}
            type="button"
          >
            <Icon aria-hidden="true" size={14} />
            <span>{action.label}</span>
          </button>
        );
      })}
      {onClear ? (
        <button
          aria-label="取消选中"
          className="selection-edit-toolbar-clear"
          onClick={onClear}
          title="取消选中"
          type="button"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function hasActiveTextSelection(): boolean {
  const activeControl = document.activeElement;
  if (
    activeControl instanceof HTMLTextAreaElement
    || activeControl instanceof HTMLInputElement
  ) {
    return activeControlHasSelection(activeControl);
  }
  const nativeSelection = window.getSelection();
  return Boolean(
    nativeSelection
    && !nativeSelection.isCollapsed
    && nativeSelection.toString().trim(),
  );
}

function activeControlHasSelection(control: HTMLTextAreaElement | HTMLInputElement): boolean {
  return control.selectionStart !== null
    && control.selectionEnd !== null
    && control.selectionStart !== control.selectionEnd;
}

type HighlightRegistry = {
  delete: (name: string) => boolean;
  set: (name: string, highlight: unknown) => void;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;

function persistSelectionHighlight(range: Range, owner: symbol) {
  const registry = (CSS as typeof CSS & { highlights?: HighlightRegistry }).highlights;
  const HighlightApi = (window as typeof window & { Highlight?: HighlightConstructor }).Highlight;
  if (!registry || !HighlightApi) return;
  registry.set(PERSISTENT_SELECTION_HIGHLIGHT, new HighlightApi(range));
  persistentHighlightOwner = owner;
}

function clearPersistentSelectionHighlight(owner: symbol) {
  if (persistentHighlightOwner !== owner || typeof CSS === "undefined") return;
  const registry = (CSS as typeof CSS & { highlights?: HighlightRegistry }).highlights;
  registry?.delete(PERSISTENT_SELECTION_HIGHLIGHT);
  persistentHighlightOwner = null;
}
