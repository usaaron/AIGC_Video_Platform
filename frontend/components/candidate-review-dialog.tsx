"use client";

import { useEffect, useId, type ReactNode } from "react";

import { CloseIcon } from "@/components/icons";

export function CandidateReviewDialog({
  busy = false,
  children,
  confirmLabel,
  description,
  discardLabel,
  error,
  eyebrow,
  onConfirm,
  onDiscard,
  title,
  warning,
}: {
  busy?: boolean;
  children: ReactNode;
  confirmLabel: string;
  description: string;
  discardLabel: string;
  error?: string;
  eyebrow: string;
  onConfirm: () => void;
  onDiscard: () => void;
  title: string;
  warning?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onDiscard();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onDiscard]);

  return (
    <div
      className="candidate-review-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onDiscard();
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="candidate-review-dialog"
        role="dialog"
      >
        <button
          aria-label={discardLabel}
          autoFocus
          className="candidate-review-close"
          disabled={busy}
          onClick={onDiscard}
          type="button"
        >
          <CloseIcon />
        </button>
        <header className="candidate-review-header">
          <span className="section-kicker">{eyebrow}</span>
          <h2 id={titleId}>{title}</h2>
          <p>{description}</p>
          {warning ? <div className="inline-notice">{warning}</div> : null}
          {error ? <div className="inline-notice is-error" role="alert">{error}</div> : null}
        </header>
        <div className="candidate-review-content">{children}</div>
        <footer className="candidate-review-actions">
          <button className="outline-action" disabled={busy} onClick={onDiscard} type="button">
            {discardLabel}
          </button>
          <button className="primary-action" disabled={busy} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function CandidatePreviewField({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null;
  return (
    <section className="candidate-preview-field">
      <h3>{label}</h3>
      <p>{value}</p>
    </section>
  );
}

export function CandidatePreviewList({
  label,
  ordered = false,
  values,
}: {
  label: string;
  ordered?: boolean;
  values?: string[] | null;
}) {
  if (!values?.length) return null;
  const items = values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>);
  return (
    <section className="candidate-preview-field">
      <h3>{label}</h3>
      {ordered ? <ol>{items}</ol> : <ul>{items}</ul>}
    </section>
  );
}
