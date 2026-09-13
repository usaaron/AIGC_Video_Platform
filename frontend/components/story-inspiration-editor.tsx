"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowUp, Check, ChevronRight, Copy, LoaderCircle, Pencil, Plus, RefreshCw } from "lucide-react";
import type { StoryInspirationBrief, StoryInspirationFrontierQuestion, StoryInspirationMessage, StoryInspirationSession } from "@/lib/types";
import { buildStoryInspirationRoundMessage, recommendedChoiceForQuestion, storyInspirationAnswerIsComplete, type StoryInspirationAnswerKind, type StoryInspirationRoundAnswer } from "@/lib/story-inspiration-round";
import { CONTINUE_CREATION_REFINEMENT_MESSAGE } from "@/lib/creation-setting-flow";

export function StoryInspirationEditor({ session, questions, index, answers, onAnswersChange, onQuestionChange, busy: requestBusy, saving, error, candidateRequest, pendingMessage, failedMessage, input, onInputChange, onSend, onEditMessage, onRetry, onRefreshQuestions, brief, thinkingElapsedMs }: {
  session: StoryInspirationSession;
  questions: StoryInspirationFrontierQuestion[];
  index: number;
  answers: Record<string, StoryInspirationRoundAnswer>;
  onAnswersChange: Dispatch<SetStateAction<Record<string, StoryInspirationRoundAnswer>>>;
  onQuestionChange: (index: number) => void;
  busy: boolean;
  saving: boolean;
  error: string | null;
  candidateRequest: boolean;
  pendingMessage: string | null;
  failedMessage: string | null;
  input: string;
  onInputChange: (value: string) => void;
  onSend: (value: string, candidateDecisionKey?: string) => void;
  onEditMessage: (id: string, text: string) => void;
  onRetry: () => void;
  onRefreshQuestions: (brief: StoryInspirationBrief) => void;
  brief: StoryInspirationBrief;
  thinkingElapsedMs: number;
}) {
  const busy = requestBusy || saving;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const customInput = useRef<HTMLTextAreaElement>(null);
  const question = questions[index];
  const answer = question ? answers[question.decision_key] : undefined;
  const recommended = question ? recommendedChoiceForQuestion(question) : null;
  const latest = session.messages.at(-1);
  const history = session.messages.slice(0, -1);
  const outdatedQuestions = questions.some((item) => item.decision_key.endsWith(".foundation")
    && !storyInspirationAnswerIsComplete(answers[item.decision_key])
    && typeof session.brief[item.decision_key.split(".")[0] as keyof StoryInspirationBrief] === "string"
    && Boolean(session.brief[item.decision_key.split(".")[0] as keyof StoryInspirationBrief]));

  function select(kind: StoryInspirationAnswerKind, value = "") {
    if (!question) return;
    onAnswersChange((current) => ({ ...current, [question.decision_key]: {kind, value, note: current[question.decision_key]?.note ?? ""} }));
  }
  function changeNote(note: string) {
    if (!question) return;
    onAnswersChange((current) => ({ ...current, [question.decision_key]: {
      kind: current[question.decision_key]?.kind ?? "custom", value: current[question.decision_key]?.value ?? "", note,
    } }));
  }
  function refreshCandidates() {
    if (!question || busy) return;
    const others = questions.filter((item) => item.decision_key !== question.decision_key && storyInspirationAnswerIsComplete(answers[item.decision_key]));
    onSend([
      "我还没想好，请给几个有实质差异、与此前不同的候选方案。",
      ...(answer?.note.trim() ? ["补充条件：" + answer.note.trim()] : []),
      ...(others.length ? ["本轮其他已选方向（本轮尚未提交，请据此保持一致）：", buildStoryInspirationRoundMessage(others, answers)] : []),
    ].join("\n"), question.decision_key);
  }
  async function copyMessage(message: StoryInspirationMessage) {
    try { await navigator.clipboard.writeText(message.content); setCopiedId(message.id); } catch { setCopiedId(null); }
  }
  function sendEdit() {
    if (!editingId || !editingText.trim() || busy) return;
    onEditMessage(editingId, editingText.trim()); setEditingId(null); setEditingText("");
  }
  function renderMessage(message: StoryInspirationMessage) {
    return <div className="creation-history-message" key={message.id}>
      <header><strong>{message.role === "user" ? "你" : "剧本大师"}</strong><div>
        <button aria-label={copiedId === message.id ? "已复制" : "复制消息"} className="workspace-tool" onClick={() => void copyMessage(message)} title="复制消息" type="button">{copiedId === message.id ? <Check size={14} /> : <Copy size={14} />}</button>
        {message.role === "user" && <button aria-label="编辑并重新发送消息" className="workspace-tool" disabled={busy} onClick={() => {setEditingId(message.id);setEditingText(message.content);}} title="编辑并重新发送" type="button"><Pencil size={14} /></button>}
      </div></header>
      {editingId === message.id ? <div className="creation-history-editor">
        <textarea aria-label="编辑已发送消息" autoFocus disabled={busy} maxLength={2000} onChange={(event) => setEditingText(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditingId(null); }
        }} rows={4} value={editingText} />
        <div><button className="outline-action" onClick={() => setEditingId(null)} type="button">取消</button><button className="primary-action" disabled={busy || !editingText.trim()} onClick={sendEdit} type="button">保存并重新整理</button></div>
      </div> : <p>{message.content}</p>}
      {message.questions.length > 0 && <details className="creation-history-questions"><summary>{message.questions.length} 项创作问题</summary><ol>{message.questions.map((item) => <li key={item.decision_key}>{item.question}</li>)}</ol></details>}
    </div>;
  }

  return <section aria-label="确认方向" className="creation-refinement">
    {outdatedQuestions && <div className="creation-question-update"><span>已有设定可用于更新本轮问题</span><button className="outline-action" disabled={busy} onClick={() => onRefreshQuestions(brief)} type="button"><RefreshCw aria-hidden="true" size={14} />更新待确认问题</button></div>}
    {question && <>
      <article className="creation-question" aria-labelledby="creation-question-title">
        <header><div className="creation-question-position"><span>待确认 · {index + 1} / {questions.length}</span>{questions.length > 1 && <select aria-label="切换问题" disabled={busy} onChange={(event) => onQuestionChange(Number(event.target.value))} value={index}>{questions.map((item, itemIndex) => <option key={item.decision_key} value={itemIndex}>{itemIndex + 1}. {item.title}{storyInspirationAnswerIsComplete(answers[item.decision_key]) ? "（已回答）" : ""}</option>)}</select>}</div><h4 id="creation-question-title" tabIndex={-1}>{question.title}</h4></header>
        <p className="creation-question-text">{question.question}</p>
        {question.choices.length > 0 && <div aria-label={question.title} className="creation-question-choices story-inspiration-question-choices" role="radiogroup" onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const choices = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)'));
          const current = choices.indexOf(event.target as HTMLButtonElement);
          const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? choices.length - 1 : 1;
          const next = choices[(current + delta) % choices.length];
          next?.click(); next?.focus();
        }}>
          {question.choices.map((choice) => {
            const selected = answer?.kind === "choice" && answer.value === choice;
            return <button aria-checked={selected} className={selected ? "is-selected" : ""} disabled={busy} key={choice} onClick={() => select("choice", choice)} role="radio" type="button"><span aria-hidden="true" className="story-inspiration-choice-indicator" /><span className="story-inspiration-choice-copy"><span>{choice}</span>{recommended === choice && question.recommended_answer && <small>{question.recommended_answer}</small>}</span>{recommended === choice && <b>推荐</b>}</button>;
          })}
        </div>}
        {(question.choices.length === 0 || answer?.kind === "custom") && <label className="creation-answer-input"><span>你的想法</span><textarea disabled={busy} maxLength={260} onChange={(event) => select("custom", event.target.value)} placeholder="我希望……" ref={customInput} rows={3} value={answer?.kind === "custom" ? answer.value : ""} /></label>}
        {answer?.kind === "unsure" && <p className="creation-deferred-state">已暂缓决定</p>}
        <div className="creation-question-tools"><button aria-label={question.choices.length ? "刷新候选方案" : "获取候选方案"} className="outline-action" disabled={busy} onClick={refreshCandidates} title={question.choices.length ? "换一批不同的候选方案" : "获取候选方案"} type="button"><RefreshCw aria-hidden="true" size={14} />{question.choices.length ? "换一批候选" : "给我几个方案"}</button>
          {question.choices.length > 0 && answer?.kind !== "custom" && <button className="creation-text-action" disabled={busy} onClick={() => select("custom")} type="button"><Pencil aria-hidden="true" size={14} />自己填写</button>}
          {!(noteKey === question.decision_key || answer?.note) && <button className="creation-text-action" disabled={busy} onClick={() => setNoteKey(question.decision_key)} type="button"><Plus aria-hidden="true" size={14} />补充条件</button>}
        </div>
        {(noteKey === question.decision_key || answer?.note) && <label className="creation-answer-input is-note"><span>补充说明 <small>可选</small></span><textarea disabled={busy} maxLength={140} onChange={(event) => changeNote(event.target.value)} placeholder="必须保留或避免的内容……" rows={2} value={answer?.note ?? ""} /></label>}
      </article>
    </>}
    {requestBusy && <div aria-live="polite" className="creation-thinking" role="status"><LoaderCircle aria-hidden="true" size={17} /><span>正在整理创作方向 <small>{Math.floor(thinkingElapsedMs / 1000)} 秒</small></span></div>}
    {error && <div className="inline-notice is-error creation-editor-error" role="alert"><span>{error}</span><button className="outline-action" disabled={busy} onClick={onRetry} type="button">{candidateRequest ? "重新获取候选" : "重试本轮"}</button></div>}
    {pendingMessage && <p className="creation-pending-message">{pendingMessage}</p>}
    {failedMessage && <p className="creation-pending-message">{failedMessage}</p>}
    {latest && <details className="creation-turn-note" open={!question && !busy}><summary>{question ? "查看分析" : "整理结果"}<ChevronRight aria-hidden="true" size={14} /></summary>{renderMessage(latest)}</details>}
    {!question && !session.readyToGenerate && !busy && <form className="creation-followup" onSubmit={(event) => {event.preventDefault();if(input.trim()) onSend(input);}}><label><span>补充创作方向</span><textarea aria-label="补充创作方向" maxLength={2000} onChange={(event) => onInputChange(event.target.value)} placeholder="补充新的创作条件……" rows={3} value={input} /></label><button aria-label="发送" className="primary-action" disabled={!input.trim()} title="发送" type="submit"><ArrowUp size={17} /></button></form>}
    {session.readyToGenerate && !busy && <button className="outline-action" onClick={() => onSend(CONTINUE_CREATION_REFINEMENT_MESSAGE)} type="button"><Plus size={14} />继续完善</button>}
    {history.length > 0 && <details className="creation-history"><summary>对话记录 <span>{history.length} 条</span><ChevronRight aria-hidden="true" size={14} /></summary>{history.map(renderMessage)}</details>}
  </section>;
}
