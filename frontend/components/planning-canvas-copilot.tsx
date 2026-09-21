"use client";

import { Aperture, ArrowUp, Check, ChevronDown, ChevronUp, Copy, Pencil, Square, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { isHostEmbedded } from "@/lib/host-navigation";
import type { StoryBibleSelectionContext } from "@/lib/story-planning-client";
import type { CopilotProgress } from "@/lib/copilot-progress";
import { copilotProgressForDisplay } from "@/lib/copilot-progress-display";

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
  progress?: CopilotProgress;
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
  instructionNotice,
  focusRequest,
  messages,
  progress,
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
  presentation = "rail",
  welcomeMessage,
  composerPlaceholder,
  primaryAction,
}: {
  busy: boolean;
  disabled: boolean;
  disabledReason?: string;
  instruction: string;
  instructionMaxLength?: number;
  instructionNotice?: string;
  focusRequest?: number;
  messages: PlanningCanvasMessage[];
  progress?: CopilotProgress | null;
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
  presentation?: "rail" | "primary";
  welcomeMessage?: string;
  composerPlaceholder?: string;
  primaryAction?: ReactNode;
}) {
  const isThinking = thinking ?? busy;
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const [copyError, setCopyError] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState(false);
  const [compact, setCompact] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const copilotRef = useRef<HTMLElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const threadContentRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusRequest = useRef(focusRequest ?? 0);
  const pendingInstructionFocus = useRef(false);
  const panelId = useId();
  const collapsed = presentation !== "primary" && embedded && !expanded;
  const progressInLastMessage = Boolean(progress && messages.at(-1)?.progress?.id === progress.id);

  useEffect(() => {
    if (collapsed || !followLatest.current) return;
    const frame = window.requestAnimationFrame(() => {
      const thread = threadRef.current;
      if (thread && followLatest.current) thread.scrollTop = thread.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, progress, isThinking, collapsed]);

  useEffect(() => {
    const content = threadContentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const thread = threadRef.current;
      if (thread && followLatest.current && !thread.hidden) thread.scrollTop = thread.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isHostEmbedded()) return;
    setEmbedded(true);
    const content = copilotRef.current?.closest(".host-workspace-content");
    let previousCompact: boolean | null = null;
    const updateWidth = () => {
      const nextCompact = (content?.clientWidth ?? window.innerWidth) < 800;
      if (nextCompact === previousCompact) return;
      previousCompact = nextCompact;
      setCompact(nextCompact);
      let preference: string | null = null;
      try {
        preference = window.sessionStorage.getItem(`seqora:script-assistant:${nextCompact ? "compact" : "wide"}`);
      } catch {
        // The assistant remains usable when browser storage is unavailable.
      }
      setExpanded(preference === null ? !nextCompact : preference === "expanded");
    };
    updateWidth();
    const observer = content && typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateWidth) : null;
    if (content && observer) observer.observe(content);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  useEffect(() => {
    const request = focusRequest ?? 0;
    const previous = lastFocusRequest.current;
    lastFocusRequest.current = request;
    if (request <= previous) return;
    pendingInstructionFocus.current = true;
    // An explicit suggestion opens this instance without changing layout preferences.
    setExpanded(true);
  }, [focusRequest]);

  useEffect(() => {
    if (!pendingInstructionFocus.current || collapsed || disabled) return;
    const frame = window.requestAnimationFrame(() => {
      const input = instructionRef.current;
      if (!input || input.disabled) return;
      input.scrollIntoView({ block: "center", behavior: "instant" });
      input.focus({ preventScroll: true });
      pendingInstructionFocus.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, collapsed, disabled]);

  function toggleAssistant() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    try {
      window.sessionStorage.setItem(`seqora:script-assistant:${compact ? "compact" : "wide"}`, nextExpanded ? "expanded" : "collapsed");
    } catch {
      // Collapsing does not depend on saving a layout preference.
    }
    if (compact) {
      window.requestAnimationFrame(() => copilotRef.current?.scrollIntoView({ block: "start", behavior: "instant" }));
    }
  }

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
    <div className="planning-canvas-actions" aria-label="快捷修改" hidden={collapsed} id={`${panelId}-actions`}>
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
    <aside
      className={`story-bible-copilot planning-canvas-copilot is-${variant}-copilot${embedded ? ` is-host-copilot${compact ? " is-host-compact" : ""}${collapsed ? " is-host-collapsed" : ""}` : ""}`}
      aria-label={`${scopeLabel}修改助手`}
      data-presentation={presentation}
      ref={copilotRef}
    >
      <div className="story-bible-copilot-heading story-bible-chat-header">
        {embedded ? <>
          <div className="story-bible-copilot-identity">
            <span className="story-bible-copilot-mark"><Aperture aria-hidden="true" size={16} /></span>
            <div>
              <h3>剧本大师</h3>
              <span className="story-bible-chat-status" title={`当前上下文：${scopeLabel}`} aria-live="polite">{isThinking ? `正在处理：${scopeLabel}` : collapsed && selection ? `已引用「${selection.source_field}」` : collapsed && instruction.trim() ? "有未发送的修改要求" : `当前：${scopeLabel}`}</span>
            </div>
          </div>
          {presentation !== "primary" && <button
            aria-controls={`${panelId}-actions ${panelId}-thread ${panelId}-composer`}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "展开" : "收起"}${scopeLabel}修改助手`}
            className="host-copilot-toggle"
            onClick={toggleAssistant}
            type="button"
          >
            {collapsed ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronUp aria-hidden="true" size={15} />}
            <span>{collapsed ? "展开" : "收起"}</span>
          </button>}
        </> : variant === "document" ? (
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
      {onWithdrawMessage ? <p className="muted" hidden={collapsed}>本集已发送的要求会持续生效。放弃候选不撤回要求；编辑旧消息会撤回该消息及后续要求，再保存新的要求。</p> : null}
      {copyError ? <p className="inline-notice" hidden={collapsed} role="alert">{copyError}</p> : null}
      {variant === "node" && quickActions.length ? actionBar : null}
      <div className="story-bible-chat-thread" hidden={collapsed} id={`${panelId}-thread`} ref={threadRef}
        onScroll={(event) => {
          const thread = event.currentTarget;
          followLatest.current = thread.scrollHeight - thread.clientHeight - thread.scrollTop <= 48;
        }}
        onWheel={(event) => { if (event.deltaY < 0) followLatest.current = false; }}
      >
        <div className="copilot-thread-content" ref={threadContentRef}>
        <div className="story-bible-chat-bubble is-assistant">
          <strong>{title}</strong>
          <p>{welcomeMessage ?? <>我已同步{scopeLabel}。告诉我你想调整的内容，我会同时检查关联上下文。</>}</p>
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
            {item.progress ? <CopilotProgressView progress={item.progress} historical /> : null}
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
        {progress && !progressInLastMessage ? <CopilotProgressView key={progress.id} progress={progress} /> : null}
        {isThinking && !progress ? (
          <div aria-live="polite" className="story-bible-chat-bubble is-assistant is-thinking">
            <strong>{title}</strong>
            <p><span className="story-bible-thinking-dots" aria-hidden="true"><i /><i /><i /></span>正在处理你的请求…</p>
          </div>
        ) : null}
        {disabled ? <div className="story-bible-chat-bubble is-assistant"><p>{disabledReason}</p></div> : null}
        </div>
      </div>
      {variant === "document" && quickActions.length ? actionBar : null}
      {primaryAction ? <div className="planning-canvas-primary-action">{primaryAction}</div> : null}
      <div className="story-bible-chat-composer" hidden={collapsed} id={`${panelId}-composer`}>
        {instructionNotice ? <p className="inline-notice planning-canvas-instruction-notice" id={`${panelId}-instruction-notice`} role="status">{instructionNotice}</p> : null}
        <label className="story-bible-copilot-instruction">
          {variant === "node" ? <span>回复{title}</span> : null}
          <textarea
            aria-label={`回复${title}`}
            aria-describedby={instructionNotice ? `${panelId}-instruction-notice` : undefined}
            disabled={disabled}
            maxLength={instructionMaxLength}
            onChange={(event) => onInstructionChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!busy && !disabled && instruction.trim()) onSubmit();
              }
            }}
            placeholder={selection ? "例如：请重写这段情节，并保持前后因果一致。" : composerPlaceholder ?? `告诉我你想怎样调整${scopeLabel}…`}
            ref={instructionRef}
            rows={presentation === "primary" ? 3 : variant === "document" ? 4 : 5}
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

function progressDuration(startedAt: number, endedAt: number) {
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1_000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function CopilotProgressView({ progress, historical = false }: { progress: CopilotProgress; historical?: boolean }) {
  const [open, setOpen] = useState(!historical && progress.status !== "completed");
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [now, setNow] = useState(Date.now);
  const display = copilotProgressForDisplay(progress);
  const thinkingText = display.thinking ?? "";
  const thinkingRef = useRef<HTMLParagraphElement>(null);
  const followThinking = useRef(!historical);
  useEffect(() => {
    setOpen(!historical && progress.status !== "completed");
  }, [progress.id, progress.status, historical]);
  useEffect(() => {
    followThinking.current = !historical;
    setThinkingOpen(true);
  }, [progress.id, historical]);
  useEffect(() => {
    const thinking = thinkingRef.current;
    if (!open || !thinkingOpen || !thinking || !followThinking.current) return;
    thinking.scrollTop = thinking.scrollHeight;
  }, [progress.id, thinkingText, open, thinkingOpen]);
  useEffect(() => {
    const thinking = thinkingRef.current;
    if (!thinking || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followThinking.current && thinking.clientHeight) thinking.scrollTop = thinking.scrollHeight;
    });
    observer.observe(thinking);
    return () => observer.disconnect();
  }, [Boolean(thinkingText)]);
  useEffect(() => {
    if (progress.status !== "running") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [progress.id, progress.status]);

  const status = { running: "进行中", completed: "已完成", paused: "已暂停", error: "未完成" }[progress.status];
  const latest = display.steps.at(-1);
  return <details className={`copilot-progress is-${progress.status}`} data-progress-id={progress.id} data-progress-status={progress.status}
    aria-label="处理进度" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span className="copilot-progress-label">处理进度 · {status}</span>
      <time className="copilot-progress-elapsed" aria-label={`已用时 ${progressDuration(progress.startedAt, progress.endedAt ?? now)}`}>
        {progressDuration(progress.startedAt, progress.endedAt ?? now)}
      </time>
      <ChevronDown size={13} aria-hidden="true" />
    </summary>
    {progress.status === "running" && latest ? <p className="copilot-progress-current" role="status">{latest.message}</p> : null}
    <div className="copilot-progress-body">
      {display.notices?.length ? <div className="copilot-progress-notices" role="note" aria-label="过程说明">
        {display.notices.map(notice => <small key={notice}>{notice}</small>)}
      </div> : null}
      {display.thinking || display.thinkingNotice ? <details className="copilot-progress-thinking" aria-label="模型思考" open={thinkingOpen}
        onToggle={(event) => setThinkingOpen(event.currentTarget.open)}>
        <summary aria-label={thinkingOpen ? "收起模型思考" : "展开模型思考"}><h4>思考链路</h4><ChevronDown size={13} aria-hidden="true" /></summary>
        {display.thinkingNotice ? <small className="copilot-progress-thinking-notice">{display.thinkingNotice}</small> : null}
        {display.thinking ? <p ref={thinkingRef} tabIndex={0} aria-label="思考链路内容"
          onScroll={(event) => {
            const element = event.currentTarget;
            followThinking.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 24;
          }}
          onWheel={(event) => {
            // The inner reading surface owns its scroll; do not switch the
            // conversation thread out of follow mode when reading this text.
            event.stopPropagation();
            if (event.deltaY < 0) followThinking.current = false;
          }}
          onKeyDown={(event) => {
            if (["ArrowUp", "PageUp", "Home"].includes(event.key)) followThinking.current = false;
          }}>
          {display.thinking}
        </p> : null}
      </details> : null}
      {display.summary ? <section className="copilot-progress-summary" aria-label="公开思考摘要">
        <h4>公开思考摘要</h4>
        <p>{display.summary}</p>
      </section> : null}
      {progress.steps.length ? <details className="copilot-progress-steps">
        <summary>处理步骤 · {progress.steps.length}<ChevronDown size={13} aria-hidden="true" /></summary>
        <ol aria-label="已到达的处理步骤" tabIndex={0}>
          {display.steps.map((step, index) => {
            const active = progress.status === "running" && index === progress.steps.length - 1;
            return <li className={active ? "is-active" : ""} data-progress-stage={step.stage} key={`${index}-${step.stage}`}>
              <span className="copilot-progress-step-marker" aria-hidden="true">{index + 1}</span>
              <span>{step.message}</span>
              <time>{progressDuration(step.startedAt, step.endedAt ?? progress.endedAt ?? now)}</time>
            </li>;
          })}
        </ol>
      </details> : <p className="muted">等待处理进度…</p>}
      {progress.status === "paused" ? <p className="copilot-progress-outcome">已暂停，以上处理记录已保留。</p> : null}
      {progress.status === "error" ? <p className="copilot-progress-outcome">本次未完成，以上处理记录已保留。</p> : null}
    </div>
  </details>;
}
