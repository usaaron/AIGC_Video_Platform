"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Download, Pencil, Save } from "lucide-react";

import { PlanningCanvasCopilot, type PlanningCanvasMessage, type PlanningCanvasQuickAction } from "@/components/planning-canvas-copilot";
import { WorkspaceSectionDirectory } from "@/components/workspace-section-directory";
import { generateStoryInspirationTurn, generateStorySynopsisDraft, prepareStoryPlanningProject } from "@/lib/story-planning-client";
import { EMPTY_INSPIRATION_BRIEF, INSPIRATION_SESSION_KEY, mergeStoryInspirationBrief, normalizeStoryInspirationSession } from "@/lib/story-inspiration-session";
import { seedInspirationBriefFromInput } from "@/lib/input-readiness-workflow";
import { updatePlanningSession } from "@/lib/planning-session";
import { verifiedInputFacts } from "@/lib/input-readiness";
import { storySynopsisMarkdown, storySynopsisMarkdownFilename } from "@/lib/story-synopsis-export";
import { downloadBlob } from "@/lib/download";
import { isHostScriptWorkflow } from "@/lib/host-navigation";
import { useHostScriptWorkflow } from "@/lib/use-host-script-workflow";
import { extractSourceSynopsis, synopsisSourceProject } from "@/lib/story-synopsis-source";
import { synopsisAuthorNotes } from "@/lib/story-synopsis-notes";
import { requireCompleteSynopsisText, resolveSynopsisUnresolvedItem, synopsisAfterDiscussion, synopsisAfterManualEdit, synopsisBriefParagraphs, synopsisHasPendingChanges, synopsisOperationIsCurrent, synopsisUnresolvedItems, synopsisWithRevision, type SynopsisUnresolvedItem } from "@/lib/story-synopsis-context";
import type { ScriptProject, StoryInspirationMessage, StorySynopsis } from "@/lib/types";
import { useProjects } from "@/providers/project-provider";
import { useUnsavedDocument } from "@/lib/use-unsaved-document";
import { hostProjectId } from "@/lib/host-session";
import { useCopilotProgress } from "@/lib/use-copilot-progress";
import type { CopilotProgress } from "@/lib/copilot-progress";
import { loadWorkspaceChatMessages, saveWorkspaceChatMessages } from "@/lib/workspace-section-memory";

const SYNOPSIS_QUICK_ACTIONS: PlanningCanvasQuickAction[] = [
  { id: "rewrite", label: "主动修改", instruction: "请根据我的下一条要求修改故事梗概，保持主线、人物目标和因果关系清楚。" },
  { id: "expand", label: "寻找灵感", instruction: "请从资深编剧的角度，找出故事梗概目前最需要补上的冲突、人物选择或结局压力。" },
];

export function StorySynopsisPanel({ project }: { project: ScriptProject }) {
  const scriptWorkflow = useHostScriptWorkflow();
  const { getProject, updateProject, retryProjectSync } = useProjects();
  const router = useRouter();
  const existingSession = useMemo(() => normalizeStoryInspirationSession(project.planningSession?.storyBibleSections?.[INSPIRATION_SESSION_KEY]), [project.planningSession?.storyBibleSections]);
  const seededBrief = useMemo(() => project.storySynopsis?.conversation?.brief
    ?? seedInspirationBriefFromInput(synopsisSourceProject(project), existingSession.brief), [existingSession.brief, project]);
  const [synopsis, setSynopsis] = useState<StorySynopsis>(() => project.storySynopsis ?? makeSynopsisRecord(seededBrief, project));
  const [editing, setEditing] = useState(false);
  const [editorText, setEditorText] = useState("");
  const [mode, setMode] = useState<"direct" | "grill">("direct");
  const [messages, setMessages] = useState<StoryInspirationMessage[]>(project.storySynopsis?.conversation?.messages ?? existingSession.messages);
  const [brief, setBrief] = useState(seededBrief);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { progress: copilotProgress, begin: beginCopilotProgress } = useCopilotProgress(`${project.id}:synopsis`);
  const [progressArchive, setProgressArchive] = useState(() => ({
    projectId: project.id,
    messages: loadWorkspaceChatMessages(project.id, "synopsis-progress") as PlanningCanvasMessage[],
  }));
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const synopsisRef = useRef(synopsis);
  const projectIdRef = useRef(project.id);
  const visibleProjectIdRef = useRef(project.id);
  const editingRef = useRef(editing);
  synopsisRef.current = synopsis;
  editingRef.current = editing;
  visibleProjectIdRef.current = project.id;
  useUnsavedDocument(editing && editorText !== synopsis.text);

  useEffect(() => {
    const switchedProject = projectIdRef.current !== project.id;
    if (switchedProject) {
      abortRef.current?.abort();
      abortRef.current = null;
      projectIdRef.current = project.id;
      setBusy(false);
      setEditing(false);
      setInput("");
      setMessage(null);
      setProgressArchive({ projectId: project.id, messages: loadWorkspaceChatMessages(project.id, "synopsis-progress") as PlanningCanvasMessage[] });
    }
    if (!switchedProject && (abortRef.current || editingRef.current)) return;
    const current = project.storySynopsis ?? makeSynopsisRecord(seededBrief, project);
    synopsisRef.current = current;
    setSynopsis(current);
    setBrief(current.conversation?.brief ?? seededBrief);
    setMessages(current.conversation?.messages ?? existingSession.messages);
  }, [project.id, project.storySynopsis, existingSession, seededBrief]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (progressArchive.projectId === project.id) {
      saveWorkspaceChatMessages(project.id, "synopsis-progress", progressArchive.messages);
    }
  }, [progressArchive, project.id]);

  function archiveProgress(progress: CopilotProgress, id: string, text = "") {
    if (visibleProjectIdRef.current !== project.id) return;
    const entry: PlanningCanvasMessage = { id, role: "assistant", text, progress, createdAt: new Date().toISOString() };
    setProgressArchive(current => current.projectId === project.id
      ? { ...current, messages: [...current.messages.filter(item => item.id !== id), entry].slice(-30) }
      : current);
  }

  async function saveSynopsis(next: StorySynopsis = synopsis, nextBrief = brief, nextMessages = messages) {
    const savingController = abortRef.current;
    const saved = { ...next, conversation: { brief: nextBrief, messages: nextMessages }, updatedAt: new Date().toISOString() };
    const persisted = await updateProject(project.id, (current) => ({
      storySynopsis: saved,
      ...(current.storyBibleVersion && saved.text !== current.storySynopsis?.text
        ? { storyBibleSynopsisOutdated: true }
        : {}),
      planningSession: updatePlanningSession(current, {
        storyBibleSections: {
          ...(current.planningSession?.storyBibleSections ?? {}),
          [INSPIRATION_SESSION_KEY]: {
            ...normalizeStoryInspirationSession(current.planningSession?.storyBibleSections?.[INSPIRATION_SESSION_KEY]),
            messages: nextMessages,
            brief: nextBrief,
            updatedAt: saved.updatedAt,
          },
        },
      }),
    }));
    if (!persisted) throw new Error("梗概未能保存，请保留当前页面并重试。");
    if (savingController && isCurrentOperation(savingController)) {
      synopsisRef.current = saved;
      setSynopsis(saved);
    }
    return saved;
  }

  function isCurrentOperation(controller: AbortController): boolean {
    return synopsisOperationIsCurrent(controller, abortRef.current, project.id, visibleProjectIdRef.current);
  }

  function assertCurrentOperation(controller: AbortController) {
    if (!isCurrentOperation(controller)) throw new DOMException("这次操作已结束。", "AbortError");
  }

  function beginOperation(allowEditing = false): AbortController | null {
    if (abortRef.current) return null;
    if (editing && !allowEditing) {
      setMessage("请先保存手动修改，再继续对话或整理梗概。");
      return null;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setMessage(null);
    return controller;
  }

  function endOperation(controller: AbortController) {
    if (abortRef.current !== controller) return;
    abortRef.current = null;
    if (visibleProjectIdRef.current === project.id) setBusy(false);
  }

  async function prepareProject(controller: AbortController) {
    const current = getProject(project.id) ?? project;
    const prepared = await prepareStoryPlanningProject(current);
    assertCurrentOperation(controller);
    // Preparation only owns creative context; replacing the whole old project
    // would overwrite a recently saved synopsis, conversation or planning work.
    if (prepared.contentSpecId !== current.contentSpecId
      || prepared.generationStrategyId !== current.generationStrategyId
      || prepared.storyBibleInputSignature !== current.storyBibleInputSignature) {
      const persisted = await updateProject(project.id, {
        contentSpecId: prepared.contentSpecId,
        generationStrategyId: prepared.generationStrategyId,
        resolvedCreativeContext: prepared.resolvedCreativeContext,
        storyBibleInputSignature: prepared.storyBibleInputSignature,
      });
      if (!persisted) throw new Error("创作资料未能保存，请保留当前页面并重试。");
    }
    assertCurrentOperation(controller);
    return { ...prepared, storySynopsis: synopsisRef.current };
  }

  async function sendMessage(valueOverride?: string, messageBase = messages, requestedMode = mode) {
    const value = (valueOverride ?? input).trim();
    if (!value) return;
    const controller = beginOperation();
    if (!controller) return;
    const progressRun = beginCopilotProgress(controller.signal);
    progressRun.mark("context", "正在准备当前故事和修改要求");
    const user: StoryInspirationMessage = { id: `synopsis.user.${crypto.randomUUID()}`, role: "user", content: value, questions: [], createdAt: new Date().toISOString() };
    const nextMessages = [...messageBase, user];
    setMessages(nextMessages);
    setInput("");
    try {
      await saveSynopsis(synopsisRef.current, brief, nextMessages);
      assertCurrentOperation(controller);
      const preparedProject = await prepareProject(controller);
      const result = await generateStoryInspirationTurn(preparedProject, nextMessages, brief, requestedMode === "direct" ? `请直接根据这条修改意见更新故事方向：${value}` : value, controller.signal, undefined, progressRun.onEvent);
      assertCurrentOperation(controller);
      const assistant: StoryInspirationMessage = { id: `synopsis.assistant.${crypto.randomUUID()}`, role: "assistant", content: result.assistant_message, questions: result.questions, createdAt: new Date().toISOString() };
      const updatedMessages = [...nextMessages, assistant];
      const updatedBrief = mergeStoryInspirationBrief(brief, result.brief);
      setMessages(updatedMessages);
      setBrief(updatedBrief);
      progressRun.mark("validating", "正在保存这轮讨论");
      await saveSynopsis(synopsisAfterDiscussion(synopsisRef.current, brief, updatedBrief), updatedBrief, updatedMessages);
      assertCurrentOperation(controller);
      const completedProgress = progressRun.finish("completed");
      archiveProgress(completedProgress, assistant.id);
      setMessages(updatedMessages.map(item => item.id === assistant.id ? { ...item, progress: completedProgress } : item));
    } catch (error) {
      const trace = progressRun.finish(controller.signal.aborted ? "paused" : "error");
      if (abortRef.current === controller && visibleProjectIdRef.current === project.id) {
        const text = controller.signal.aborted ? "已暂停，当前梗概和已保存的讨论仍然保留。" : error instanceof Error ? error.message : "这轮对话暂时没有完成，请重试。";
        const statusId = `synopsis.status.${crypto.randomUUID()}`;
        archiveProgress(trace, statusId, text);
        setMessage(text);
        setMessages(current => [...current, { id: statusId, role: "assistant", content: text, questions: [], createdAt: new Date().toISOString(), progress: trace }]);
      }
    } finally {
      endOperation(controller);
    }
  }

  function pauseConversation() {
    abortRef.current?.abort();
    setMessage("已暂停。当前梗概和已保存的讨论仍然保留。");
  }

  function editConversationMessage(messageId: string, text: string) {
    if (abortRef.current || editing) return;
    const messageIndex = messages.findIndex((item) => item.id === messageId);
    if (messageIndex < 0) return;
    const nextMessages = messages.slice(0, messageIndex);
    setMessages(nextMessages);
    void sendMessage(text, nextMessages);
  }

  function synopsisMessages(): PlanningCanvasMessage[] {
    const archive = progressArchive.projectId === project.id ? progressArchive.messages : [];
    const currentMessages: PlanningCanvasMessage[] = messages.map((item) => ({
      id: item.id,
      role: item.role,
      text: [
        item.content,
        ...item.questions.map((question) => [
          question.question,
          ...question.choices.map((choice) => `· ${choice}`),
        ].join("\n")),
      ].filter(Boolean).join("\n\n"),
      createdAt: item.createdAt,
      progress: archive.find(entry => entry.id === item.id)?.progress ?? item.progress,
    }));
    const knownIds = new Set(currentMessages.map(item => item.id));
    return [...currentMessages, ...archive.filter(entry => entry.text && !knownIds.has(entry.id))]
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  }

  function runSynopsisQuickAction(action: string, instruction: string) {
    const nextMode = action === "expand" ? "grill" : "direct";
    setMode(nextMode);
    if (action === "rewrite") {
      setMessage("请在对话框中写下你想修改的内容，再点击发送。");
      document.querySelector<HTMLTextAreaElement>('.story-synopsis-panel .story-bible-chat-composer textarea')?.focus();
      return;
    }
    void sendMessage(instruction, messages, nextMode);
  }

  async function finishConversation() {
    const controller = beginOperation();
    if (!controller) return;
    const progressRun = beginCopilotProgress(controller.signal);
    progressRun.mark("context", "正在准备梗概和已保存的讨论");
    try {
      const previous = synopsisRef.current;
      requireCompleteSynopsisText(previous.text);
      const preparedProject = await prepareProject(controller);
      const result = await generateStorySynopsisDraft(preparedProject, messages, brief, previous.text, controller.signal, progressRun.onEvent);
      assertCurrentOperation(controller);
      progressRun.mark("validating", "正在保存整理后的梗概");
      await saveSynopsis(synopsisWithRevision(previous, {
        ...previous,
        text: result.text,
        status: "draft",
        source: "generated",
        pendingChanges: false,
        review: result.review,
      }));
      assertCurrentOperation(controller);
      archiveProgress(progressRun.finish("completed"), `synopsis.organized.${crypto.randomUUID()}`, "已整理成梗概，请核对后确认。");
      setMessage("已整理成梗概，请核对故事内容和下方建议后确认。");
    } catch (error) {
      archiveProgress(progressRun.finish(controller.signal.aborted ? "paused" : "error"), `synopsis.organized.${crypto.randomUUID()}`,
        controller.signal.aborted ? "已暂停整理，原稿和讨论已保留。" : "梗概暂时未能整理，原稿和讨论已保留。");
      if (isCurrentOperation(controller)) setMessage(error instanceof Error ? error.message : "梗概暂时未能整理，原稿和讨论已保留，请重试。");
    } finally {
      endOperation(controller);
    }
  }

  async function saveManualEdit() {
    const controller = beginOperation(true);
    if (!controller) return;
    try {
      await saveSynopsis(synopsisWithRevision(synopsisRef.current, synopsisAfterManualEdit(synopsisRef.current, editorText)));
      assertCurrentOperation(controller);
      // updateProject acknowledges the browser copy. A bound host project also
      // needs the shared workspace to accept the explicit save before closing.
      if (hostProjectId() || process.env.NEXT_PUBLIC_BASE_PATH?.trim() || process.env.NEXT_PUBLIC_HOST_LAUNCH_URL?.trim()) {
        const serverSync = await retryProjectSync(project.id);
        assertCurrentOperation(controller);
        if (serverSync?.status !== "synced") {
          throw new Error("修改已保留在当前浏览器，尚未同步到服务端，请重试。");
        }
      }
      setEditing(false);
      setMessage("手动修改已保存。");
    } catch (error) {
      if (isCurrentOperation(controller)) setMessage(error instanceof Error ? error.message : "修改未能保存，请重试。");
    } finally {
      endOperation(controller);
    }
  }

  async function confirmSynopsis() {
    if (!synopsis.text.trim() || editing) return;
    if (synopsisHasPendingChanges(synopsis)) {
      setMessage("讨论中的修改还未写入梗概，请先重新整理。");
      return;
    }
    const controller = beginOperation();
    if (!controller) return;
    try {
      requireCompleteSynopsisText(synopsisRef.current.text);
      await saveSynopsis(synopsisWithRevision(synopsisRef.current, { ...synopsisRef.current, status: "confirmed", pendingChanges: false }));
      assertCurrentOperation(controller);
      router.push(`/projects/${project.id}/planning`);
    } catch (error) {
      if (isCurrentOperation(controller)) setMessage(error instanceof Error ? error.message : "梗概未能确认，请重试。");
    } finally {
      endOperation(controller);
    }
  }

  async function markUnresolvedItemHandled(item: SynopsisUnresolvedItem) {
    if (!synopsisRef.current.text.trim()) return;
    const controller = beginOperation();
    if (!controller) return;
    try {
      const current = { ...synopsisRef.current, conversation: { brief, messages } };
      const next = resolveSynopsisUnresolvedItem(current, item);
      if (next === current) return;
      await saveSynopsis(next, next.conversation!.brief, messages);
      assertCurrentOperation(controller);
      setBrief(next.conversation!.brief);
      setMessage("已将这项标记为已处理，请核对梗概后确认。");
    } catch (error) {
      if (isCurrentOperation(controller)) setMessage(error instanceof Error ? error.message : "这项修改未能保存，请重试。");
    } finally {
      endOperation(controller);
    }
  }

  function exportSynopsis() {
    if (isHostScriptWorkflow()) return;
    if (!synopsis.text.trim() || busy) return;
    const blob = new Blob([storySynopsisMarkdown(project.title, synopsis)], {
      type: "text/markdown;charset=utf-8",
    });
    downloadBlob(blob, storySynopsisMarkdownFilename(project.title, synopsis.version));
  }

  const pendingChanges = synopsisHasPendingChanges(synopsis);
  const needsSynopsisDraft = !project.storySynopsis || !synopsis.text.trim() || pendingChanges;
  const synopsisConfirmed = synopsis.status === "confirmed" && !pendingChanges;
  const unresolvedItems = synopsisUnresolvedItems(brief);
  const authorNotes = synopsisAuthorNotes(synopsis).filter((note) => !unresolvedItems.some((item) => item.kind === "unresolved" && item.label === note));
  const entries = [{ id: "story-synopsis-body", label: "故事梗概" }];
  return <section className={`story-bible-panel is-canvas-mode story-synopsis-panel${scriptWorkflow === true ? " host-stage-content" : ""}`}>
    <div className="story-bible-heading">
      <div><span className="section-kicker">{scriptWorkflow === true ? "故事设定" : "前期创作"}</span><h2>故事梗概</h2><p>{scriptWorkflow === true ? "确认故事主线，再完善人物与世界观。" : "先把故事讲清楚，再进入总纲规划。"}</p></div>
      <div className="story-bible-actions">
        {editing ? <>
          <button className="outline-action" disabled={busy} onClick={() => {
            if (editorText !== synopsis.text && !window.confirm("放弃这次手动修改，恢复已保存的梗概吗？")) return;
            setEditorText(synopsis.text);
            setEditing(false);
          }} type="button">取消编辑</button>
          <button className="primary-action" disabled={busy} onClick={() => void saveManualEdit()} type="button"><Save size={15} />保存修改</button>
        </> : <>
          <button className="outline-action" disabled={busy} onClick={() => { setEditorText(synopsis.text); setEditing(true); }} type="button"><Pencil size={15} />编辑</button>
          {synopsis.text.trim() ? <details className="workflow-more-actions">
            <summary>更多操作</summary>
            <div className="workflow-more-actions-content">
              {!needsSynopsisDraft ? <button className="outline-action" disabled={busy} onClick={() => void finishConversation()} type="button">{messages.length ? "完成对话并重新整理" : "重新整理梗概"}</button> : null}
              {!project.storySynopsis && synopsis.text.trim() && !pendingChanges ? <button className="outline-action" disabled={busy} onClick={() => void confirmSynopsis()} type="button"><Check size={15} />{scriptWorkflow === true ? "确认梗概，继续设定" : "确认梗概，进入总纲"}</button> : null}
              {scriptWorkflow === false && synopsis.text.trim() ? <button className="outline-action" disabled={busy} onClick={exportSynopsis} type="button"><Download size={15} />导出梗概</button> : null}
            </div>
          </details> : null}
          {needsSynopsisDraft ? <button className="primary-action" disabled={busy} onClick={() => void finishConversation()} type="button">{pendingChanges ? "完成对话并重新整理" : "整理成故事梗概"}</button>
            : synopsisConfirmed ? <Link className="primary-action" aria-disabled={busy || undefined} onClick={(event) => { if (busy) event.preventDefault(); }} href={`/projects/${project.id}/planning`}>{scriptWorkflow === true ? "完善人物与世界观" : "进入故事总纲"}</Link>
              : <button className="primary-action" disabled={busy} onClick={() => void confirmSynopsis()} type="button"><Check size={15} />{scriptWorkflow === true ? "确认梗概，继续设定" : "确认梗概，进入总纲"}</button>}
        </>}
      </div>
    </div>
    {busy ? <div className="inline-notice" role="status">正在处理你的故事，请稍候…</div> : null}
    {message ? <div className="inline-notice" role="status">{message}</div> : null}
    {pendingChanges ? <div className="inline-notice" role="status">讨论中的修改还未写入梗概，请先重新整理。</div> : null}
    <div className="story-bible-workbench has-section-directory">
      <WorkspaceSectionDirectory activeEntryId="story-synopsis-body" activeSection="story-synopsis" currentEntries={entries} onSelect={(entry) => document.getElementById(entry.id)?.scrollIntoView({ behavior: "smooth", block: "start" })} projectId={project.id} />
      <div className="story-bible-document-column story-synopsis-document-column">
        <div className="story-bible-content">
          <div className="story-bible-status"><span>{synopsis.status === "confirmed" ? "已确认" : synopsis.status === "refining" ? "正在完善" : "待确认"}</span></div>
          <section className="story-bible-chapter story-synopsis-body" id="story-synopsis-body">
            <div className="story-bible-chapter-heading"><div><span className="story-bible-chapter-index">故事内容</span><h3>故事梗概</h3><p>确认故事的主线、人物目标、主要冲突和结局方向。</p></div></div>
            {editing ? <textarea aria-label="故事梗概正文" className="story-synopsis-editor" disabled={busy} onChange={(event) => setEditorText(event.target.value)} rows={18} value={editorText} /> : <div className="story-synopsis-text">{synopsis.text.trim() ? synopsis.text.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p className="muted">还没有故事梗概。可以先手动编辑，也可以点击“整理成故事梗概”。</p>}</div>}
            {!editing && synopsis.review ? <div className="inline-notice">
              <p>{synopsis.review.status === "draft" ? "这是可继续发展的梗概草稿，尚有内容需要斟酌。" : "已整理出完整故事方向，请按你的创作意图核对。"}</p>
            </div> : null}
            {!editing && (authorNotes.length || unresolvedItems.length) ? <details className="inline-notice" open={authorNotes.length + unresolvedItems.length <= 4}>
              <summary>创作要求与待完善事项</summary>
              {unresolvedItems.length ? <p>手动补齐后，可将对应事项标记为已处理。</p> : null}
              <ul>
                {unresolvedItems.map((item) => <li key={item.kind === "unresolved" ? `unresolved.${item.index}` : `decision.${item.decisionKey}`}>
                  <span>{item.label}</span>{" "}
                  <button className="outline-action" disabled={busy || !synopsis.text.trim()} onClick={() => void markUnresolvedItemHandled(item)} type="button">已在梗概中处理</button>
                </li>)}
                {authorNotes.map((note, index) => <li key={`note.${index}`}>{note}</li>)}
              </ul>
            </details> : null}
          </section>
        </div>
      </div>
      <PlanningCanvasCopilot
        busy={busy}
        progress={copilotProgress}
        disabled={editing}
        disabledReason="请先保存手动修改或取消编辑，再继续讨论故事。"
        instruction={input}
        messages={synopsisMessages()}
        onClearSelection={() => undefined}
        onEditMessage={editConversationMessage}
        onInstructionChange={setInput}
        onPause={pauseConversation}
        onQuickAction={runSynopsisQuickAction}
        onSubmit={() => void sendMessage()}
        allowQuickActionsWithoutSelection
        quickActions={SYNOPSIS_QUICK_ACTIONS}
        scopeLabel="故事梗概"
        selection={null}
        thinking={busy && copilotProgress?.status === "running"}
        variant="document"
      />
    </div>
  </section>;
}

function makeSynopsisRecord(brief: typeof EMPTY_INSPIRATION_BRIEF, project: ScriptProject): StorySynopsis {
  const fields = synopsisBriefParagraphs(brief);
  const sourceProject = synopsisSourceProject(project);
  const source = extractSourceSynopsis(sourceProject) || (fields.length ? fields.join("\n\n") : sourceProject.creativePrompt.trim() || verifiedInputFacts(sourceProject.inputReadiness, sourceProject).map((fact) => fact.quote).join("\n"));
  return { text: source, status: "draft", version: 1, source: "generated", updatedAt: new Date().toISOString() };
}
