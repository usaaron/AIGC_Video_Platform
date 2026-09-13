"use client";

import { Check, GitBranch, LoaderCircle, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AuthorConflictOption, PendingAuthorConflict } from "@/lib/types";
import { authorConflictSourceLabel } from "@/lib/author-conflict";
import styles from "./author-conflict-dialog.module.css";

export interface AuthorConflictDialogDraft {
  selected_option_id?: string;
  custom_direction: string;
}

export function AuthorConflictDialog({ pending, busy, error, onConfirm, onRecheck, onDefer, onWithdraw }: {
  pending: PendingAuthorConflict;
  busy: boolean;
  error: string | null;
  onConfirm: (option: AuthorConflictOption, draft: AuthorConflictDialogDraft) => Promise<void>;
  onRecheck: (draft: AuthorConflictDialogDraft) => Promise<void>;
  onDefer: (draft: AuthorConflictDialogDraft) => Promise<void>;
  onWithdraw: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState(pending.selected_option_id ?? "");
  const [customDirection, setCustomDirection] = useState(pending.custom_direction ?? "");
  const option = pending.review.options.find((item) => item.option_id === selectedId);
  const customNeedsReview = Boolean(customDirection.trim());
  const formDraft = { selected_option_id: selectedId || undefined, custom_direction: customDirection };

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      aria-labelledby="author-conflict-title"
      className={styles.dialog}
      onCancel={(event) => { event.preventDefault(); if (!busy) void onDefer(formDraft); }}
      ref={dialogRef}
    >
      <header className={styles.header}>
        <div><TriangleAlert aria-hidden="true" size={20} /><h2 id="author-conflict-title">这次修改涉及已有设定</h2></div>
        <button aria-label="暂不处理" className={styles.iconButton} disabled={busy} onClick={() => void onDefer(formDraft)} title="暂不处理" type="button"><X aria-hidden="true" size={18} /></button>
      </header>
      <div className={styles.body}>
        <section className={styles.goal}>
          <h3>你的修改目标</h3>
          <p>{pending.review.user_goal}</p>
        </section>
        <section className={styles.evidence} aria-label="冲突依据与影响">
          {pending.review.conflicts.map((conflict, index) => (
            <div className={styles.conflict} key={`${conflict.source_ref}-${index}`}>
              <h3>{authorConflictSourceLabel(conflict.source_ref)}</h3>
              <dl>
                <dt>已有设定</dt><dd>{conflict.established_fact}</dd>
                <dt>本次要求</dt><dd>{conflict.requested_change}</dd>
                <dt>影响</dt><dd>{conflict.impact}</dd>
              </dl>
            </div>
          ))}
        </section>
        <fieldset className={styles.options} disabled={busy}>
          <legend>选择处理方式</legend>
          {pending.review.options.map((item) => (
            <label className={styles.option} key={item.option_id}>
              <input checked={selectedId === item.option_id} name="author-conflict-option" onChange={() => setSelectedId(item.option_id)} type="radio" value={item.option_id} />
              <span><strong>{item.title}</strong><span>{item.plan}</span><small>{item.impact}</small>
                {item.kind === "revise_upstream" ? <small className={styles.revisionNotice}><GitBranch aria-hidden="true" size={14} />建立新修订版本，保留原稿；新版总纲和全部规划需要重新确认。</small> : null}
              </span>
            </label>
          ))}
        </fieldset>
        <div className={styles.custom}>
          <label htmlFor="author-conflict-custom">其他处理方向</label>
          <textarea disabled={busy} id="author-conflict-custom" maxLength={500} onChange={(event) => setCustomDirection(event.target.value)} rows={3} value={customDirection} />
          <button className="outline-action" disabled={busy} onClick={() => void onRecheck(formDraft)} type="button"><RefreshCw aria-hidden="true" size={15} />重新检查影响</button>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
      <footer className={styles.footer}>
        <button className={styles.withdraw} disabled={busy} onClick={() => void onWithdraw()} type="button">撤回本次要求</button>
        <div>
          <button className="outline-action" disabled={busy} onClick={() => void onDefer(formDraft)} type="button">暂不处理</button>
          <button className="primary-action" disabled={busy || !option || customNeedsReview} onClick={() => { if (option && !customNeedsReview) void onConfirm(option, formDraft); }} type="button">
            {busy ? <LoaderCircle aria-hidden="true" className={styles.spinner} size={16} /> : <Check aria-hidden="true" size={16} />}
            {busy ? "处理中" : customNeedsReview ? "请先重新检查影响" : option?.kind === "revise_upstream" ? "确认并建立修订版本" : "确认处理方式"}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
