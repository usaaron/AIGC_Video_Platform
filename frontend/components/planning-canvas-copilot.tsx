"use client";

import { Aperture, ArrowUp, Check, Copy, Pencil, Square, X } from "lucide-react";
import { useState } from "react";

import type { StoryBibleSelectionContext } from "@/lib/story-planning-client";

export type PlanningCanvasAction = "continue" | "polish" | "rewrite" | "expand" | "shorten";

export type PlanningCanvasQuickAction = {
  id: PlanningCanvasAction;
  label: string;
  instruction: string;
};

export type PlanningCanvasMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  quote?: StoryBibleSelectionContext | null;
  episodeId?: string;
  createdAt?: string;
  withdrawnAt?: string;
};

const ACTIONS: PlanningCanvasQuickAction[] = [
  { id: "continue", label: "续写", instruction: "请补充选中内容之后的下一步发展，保持前后因果、人物状态和交接压力一致。" },
  { id: "polish", label: "润色", instruction: "请润色选中内容，只优化表达和节奏，不改变剧情事实。" },
  { id: "rewrite", label: "改写", instruction: "请改写选中内容，保留其在当前结构中的因果职责，并让前后文保持一致。" },
  { id: "expand", label: "扩写", instruction: "请扩写选中内容，补足必要的动作、因果或情绪信息，但不要越过当前规划层级。" },
  { id: "shorten", label: "精简", instruction: "请精简选中内容，删除重复和空泛表述，保留全部关键因果信息。" },
];

export function PlanningCanvasCopilot({
  busy,
  disabled,
  disabledReason = "当前内容已锁定，需先创建可编辑版本后才能修改。",
  instruction,
  instructionMaxLength = 1_000,
  messages,
  onClearSelection,
  onEditMessage,
  onWithdrawMessage,
  onInstructionChange,
  onPause,
  onQuickAction,
  allowQuickActionsWithoutSelection = false,
  onSubmit,
  quickActions = ACTIONS,
  selection,
  title = "剧本大师",
  scopeLabel = "当前规划",
  thinking,
  variant = "node",
}: {
  busy: boolean;
  disabled: boolean;
  disabledReason?: string;
  instruction: string;
  instructionMaxLength?: number;
  messages: PlanningCanvasMessage[];
  onClearSelection: () => void;
  onEditMessage?: (messageId: string, text: string, quote?: StoryBibleSelectionContext | null) => void;
  onWithdrawMessage?: (messageId: string) => void;
  onInstructionChange: (value: string) => void;
  onPause?: () => void;
  onQuickAction: (action: PlanningCanvasAction, instruction: string) => void;
  allowQuickActionsWithoutSelection?: boolean;
  onSubmit: () => void;
  quickActions?: PlanningCanvasQuickAction[];
  selection: StoryBibleSelectionContext | null;
  title?: string;
  scopeLabel?: string;
  thinking?: boolean;
  variant?: "document" | "node";
}) {
  const isThinking = thinking ?? busy;
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copyMessage(message: PlanningCanvasMessage) {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1_500);
    } catch {
      setCopiedMessageId(null);
      setCopyError("暂时无法复制，请选中消息文字后手动复制。");
    }
  }

  function beginEditingMessage(message: PlanningCanvasMessage) {
    setEditingMessageId(message.id);
    setEditingMessageText(message.text);
  }

  function submitEditedMessage(message: PlanningCanvasMessage) {
    const nextText = editingMessageText.trim();
    if (!nextText || busy || disabled || !onEditMessage) return;
    setEditingMessageId(null);
    setEditingMessageText("");
    onEditMessage(message.id, nextText, message.quote);
  }
  const actionBar = (
    <div className="planning-canvas-actions" aria-label="快捷修改">
      {quickActions.map((action) => (
        <button
          className="planning-canvas-action"
          disabled={disabled || busy || (!allowQuickActionsWithoutSelection && action.id !== "continue" && !selection)}
          key={action.id}
          onClick={() => onQuickAction(action.id, action.instruction)}
          title={action.id === "continue" && !selection ? "未选中文字时，将按当前规划补充内容" : action.label}
          type="button"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
  return (
    <aside className={`story-bible-copilot planning-canvas-copilot is-${variant}-copilot`} aria-label={`${scopeLabel}修改助手`}>
      <div className="story-bible-copilot-heading story-bible-chat-header">
        {variant === "document" ? (
          <div className="story-bible-copilot-identity">
            <span className="story-bible-copilot-mark"><Aperture aria-hidden="true" size={16} /></span>
            <div>
              <h3>{title}</h3>
              <span className="story-bible-chat-status">已连接{scopeLabel}</span>
            </div>
          </div>
        ) : (
          <>
            <div>
              <span className="section-kicker">针对性修改</span>
              <h3>{title}</h3>
            </div>
            <span className="story-bible-chat-status">已连接{scopeLabel}</span>
          </>
        )}
      </div>
      {onWithdrawMessage ? <p className="muted">本集已发送的要求会持续生效。放弃候选不撤回要求；编辑旧消息会撤回该消息及后续要求，再保存新的要求。</p> : null}
      {copyError ? <p className="inline-notice" role="alert">{copyError}</p> : null}
      {variant === "node" ? actionBar : null}
      <div className="story-bible-chat-thread">
        <div className="story-bible-chat-bubble is-assistant">
          <strong>{title}</strong>
          <p>我已同步{scopeLabel}。告诉我你想调整的内容，我会同时检查关联上下文。</p>
        </div>
        {messages.map((item) => (
          <div className={`story-bible-chat-bubble is-${item.role}`} key={item.id}>
            <div className="conversation-message-heading">
              <strong>{item.role === "assistant" ? title : "你"}</strong>
              <span className="conversation-message-actions">
                <button
                  aria-label={copiedMessageId === item.id ? "已复制" : "复制消息"}
                  onClick={() => void copyMessage(item)}
                  title={copiedMessageId === item.id ? "已复制" : "复制"}
                  type="button"
                >
                  {copiedMessageId === item.id ? <Check aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
                </button>
                {item.role === "user" && !item.withdrawnAt && onEditMessage ? (
                  <button
                    aria-label="编辑并重新发送消息"
                    disabled={busy || disabled}
                    onClick={() => beginEditingMessage(item)}
                    title="编辑并重新发送"
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={13} />
                  </button>
                ) : null}
                {item.role === "user" && onWithdrawMessage ? (
                  item.withdrawnAt ? <span>已撤回</span> : <button aria-label="撤回这条作者要求" disabled={busy || disabled}
                    onClick={() => onWithdrawMessage(item.id)} type="button">撤回要求</button>
                ) : null}
              </span>
            </div>
            {editingMessageId === item.id ? (
              <div className="conversation-message-editor">
                <textarea
                  aria-label="编辑已发送消息"
                  autoFocus
                  maxLength={instructionMaxLength}
                  onChange={(event) => setEditingMessageText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setEditingMessageId(null);
                      setEditingMessageText("");
                    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      submitEditedMessage(item);
                    }
                  }}
                  rows={3}
                  value={editingMessageText}
                />
                <div>
                  <button className="conversation-message-edit-cancel" onClick={() => {
                    setEditingMessageId(null);
                    setEditingMessageText("");
                  }} type="button">取消</button>
                  <button className="conversation-message-edit-submit" disabled={busy || disabled || !editingMessageText.trim()} onClick={() => submitEditedMessage(item)} type="button">发送</button>
                </div>
              </div>
            ) : <p>{item.text}</p>}
            {item.quote ? (
              <blockquote>
                <span>引用「{item.quote.source_field}」</span>
                {item.quote.selected_text}
              </blockquote>
            ) : null}
          </div>
        ))}
        {selection ? (
          <div className="story-bible-chat-bubble is-user is-quote">
            <div>
              <strong>你引用了「{selection.source_field}」</strong>
              <button aria-label="取消引用" onClick={onClearSelection} type="button"><X size={13} /></button>
            </div>
            <blockquote>{selection.selected_text}</blockquote>
          </div>
        ) : null}
        {isThinking ? (
          <div aria-live="polite" className="story-bible-chat-bubble is-assistant is-thinking">
            <strong>{title}</strong>
            <p><span className="story-bible-thinking-dots" aria-hidden="true"><i /><i /><i /></span>正在思考并检查上下文</p>
          </div>
        ) : null}
        {disabled ? <div className="story-bible-chat-bubble is-assistant"><p>{disabledReason}</p></div> : null}
      </div>
      {variant === "document" ? actionBar : null}
      <div className="story-bible-chat-composer">
        <label className="story-bible-copilot-instruction">
          {variant === "node" ? <span>回复{title}</span> : null}
          <textarea
            aria-label={`回复${title}`}
            disabled={disabled}
            maxLength={instructionMaxLength}
            onChange={(event) => onInstructionChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!busy && !disabled && instruction.trim()) onSubmit();
              }
            }}
            placeholder={selection ? "例如：请重写这段情节，并保持前后因果一致。" : `告诉我你想怎样调整${scopeLabel}…`}
            rows={variant === "document" ? 4 : 5}
            value={instruction}
          />
        </label>
        <div className="story-bible-chat-composer-footer">
          <span>{variant === "document"
            ? selection ? `已引用「${selection.source_field}」` : `发送给${title}`
            : "发送后会先检查上下文，再直接写入修改"}</span>
          <button
            aria-label={isThinking ? "暂停当前思考" : "发送修改指令"}
            className={`primary-action story-bible-copilot-submit${isThinking ? " is-running" : ""}`}
            disabled={isThinking ? !onPause : busy || disabled || !instruction.trim()}
            onClick={isThinking ? onPause : onSubmit}
            title={isThinking ? "暂停" : "发送"}
            type="button"
          >
            {isThinking
              ? <Square aria-hidden="true" size={12} />
              : <ArrowUp aria-hidden="true" size={17} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
