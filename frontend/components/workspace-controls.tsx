"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { LoaderCircle, X } from "lucide-react";

export function ToolButton({ label, disabled, onClick, children, pressed, className = "" }: {
  label: string; disabled?: boolean; onClick: () => void; children: ReactNode; pressed?: boolean; className?: string;
}) {
  const tooltipId = useId();
  return <span className={"workspace-tool " + className}>
    <button aria-label={label} aria-describedby={tooltipId} aria-pressed={pressed} disabled={disabled}
      onClick={onClick} type="button">{children}</button>
    <span className="workspace-tooltip" id={tooltipId} role="tooltip">{label}</span>
  </span>;
}

export function ConfirmationDialog({ open, title, children, confirmLabel, cancelLabel, busy, onConfirm, onClose }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; cancelLabel: string;
  busy?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      cancel.current?.focus({ preventScroll: true });
    }
    if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={dialog} className="workspace-confirm-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="workspace-confirm-body">
      <header><h2 id={titleId}>{title}</h2><ToolButton label={cancelLabel} disabled={busy} onClick={onClose}><X size={17} /></ToolButton></header>
      {children}
      <footer><button ref={cancel} autoFocus className="outline-action" disabled={busy} onClick={onClose} type="button">{cancelLabel}</button>
        <button className="danger-action" disabled={busy} onClick={onConfirm} type="button">
          {busy && <LoaderCircle className="ui-spinner" size={16} />}{confirmLabel}
        </button>
      </footer>
    </div>
  </dialog>;
}
