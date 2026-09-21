"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Check, Download, Pause, Play, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HostImportPanel } from "@/components/host-import-panel";
import { PlanningCanvasCopilot, CopilotProgressView, type PlanningCanvasMessage } from "@/components/planning-canvas-copilot";
import { GenerationDiagnostics } from "@/components/generation-diagnostics";
import { QuickProductionAssets } from "@/components/quick-production-assets";
import { WorkspaceMissingProject } from "@/components/workspace-missing-project";
import { ApiError } from "@/lib/api-client";
import { quickEpisodePlainText } from "@/lib/quick-script-export";
import { projectStorageKey } from "@/lib/host-session";
import { acceptQuickWorkspaceSnapshot } from "@/lib/project-sync";
import { actQuickScript, advanceQuickScriptSequentially, loadQuickScript } from "@/lib/quick-script-client";
import { canStartQuickScript, quickInitialInputs, quickScriptHref, quickTargetCharactersAfterEpisodeChange, shortQuickSettingsForLegacyProject } from "@/lib/quick-script-project";
import { pendingQuickSourceInputs } from "@/lib/quick-source-recovery";
import { quickScriptOperationActive, quickScriptProgressLabel, quickScriptRecoveryWaitLabel, quickScriptSavedProgressLabel, quickScriptSelectedEpisode, quickScriptStage, type QuickScriptAction, type QuickScriptPlan, type QuickScriptResponse, type QuickScriptSettings, type QuickScriptStage, type QuickScriptState } from "@/lib/quick-script-types";
import type { GeneratedDraft, ScriptProject } from "@/lib/types";
import { useCopilotProgress } from "@/lib/use-copilot-progress";
import { useHostScriptWorkflow } from "@/lib/use-host-script-workflow";
import { currentWorkspaceHref } from "@/lib/workspace-stage";
import { useProjects } from "@/providers/project-provider";
import styles from "./quick-script-workspace.module.css";

const DEFAULTS: QuickScriptSettings = { language: "zh", target_total_characters: 8000, episode_count: 8, target_duration_seconds: 90, storyline_count: 1 };
const STAGES: Array<{ id: QuickScriptStage; label: string }> = [{ id: "synopsis", label: "故事梗概" }, { id: "plan", label: "创作安排" }, { id: "script", label: "剧本正文" }];

function quickScriptRequiresAuthorEdit(state: QuickScriptState | null): boolean {
  return state?.phase === "paused" && (state.next_step === "done"
    || (["review", "recheck"].includes(state.next_step) && state.episodes.some((episode) => episode.review && episode.review.status !== "passed"))
    || (state.next_step === "repair" && state.episodes.some((episode) => (episode.repair_count >= 1 || (episode.repair_attempts ?? 0) >= 1) && episode.status !== "passed")));
}

function quickScriptFailureMessage(state: QuickScriptState, paused: boolean): string {
  const stage = quickScriptStage(state);
  const needsEdit = quickScriptRequiresAuthorEdit(state);
  const title = stage === "plan" ? "创作安排暂未完成" : stage === "synopsis" ? "故事梗概暂未完成"
    : needsEdit ? "本次生成未通过检查" : "本次剧本生成未完成";
  // blocked_reason is the server's public explanation, never a provider response body.
  const reason = state.blocked_reason?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 600);
  const nextStep = needsEdit ? "请按页面提示调整正文，再点击“保存正文修改”继续检查。"
    : stage === "plan" ? state.plan ? "可在右侧补充要求并发送，重新整理创作安排。"
      : `点击“${state.blocked_reason ? "重新生成" : "生成"}创作安排”重试，无需重新填写。`
    : stage === "synopsis" ? state.synopsis ? "可在右侧补充要求并发送，重新整理故事梗概。"
      : `点击“${state.blocked_reason ? "重新整理故事梗概" : "整理成故事梗概"}”重试。`
    : `点击“${!state.episodes.length ? paused ? "继续生成剧本" : "生成整部剧本" : state.next_step === "review" || state.status === "stale" ? "检查修改并继续" : paused ? "继续生成剩余剧本" : "继续生成剧本"}”，从已保存进度继续。`;
  return `${title}。${reason ? `原因：${reason}\n` : ""}已保存的内容和检查进度保持不变。${nextStep}`;
}

export function QuickScriptWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const { getProject, isReady } = useProjects();
  const integrated = useHostScriptWorkflow();
  const project = getProject(projectId);
  if (!isReady || integrated === null) return <p className={styles.empty} role="status">正在恢复剧本创作…</p>;
  if (!project) return <WorkspaceMissingProject />;
  if (!integrated || (project.creationMode !== "quick" && !canStartQuickScript(project))) {
    return <div className={styles.empty}><p>这部作品保留原有创作流程，已保存的内容不受影响。</p><Link className={styles.secondary} href={currentWorkspaceHref(project)}>继续原有创作</Link></div>;
  }
  return <QuickScriptEditor key={project.id} project={project} />;
}

function QuickScriptEditor({ project }: { project: ScriptProject }) {
  const router = useRouter();
  const { getProject, syncProjectSnapshot, adoptServerProjectSnapshot } = useProjects();
  const [state, setState] = useState<QuickScriptState | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workingLabel, setWorkingLabel] = useState("");
  const [paused, setPaused] = useState(false);
  const [pauseRequested, setPauseRequested] = useState(false);
  const [error, setError] = useState("");
  const [failureDetails, setFailureDetails] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const [recoveredDraft, setRecoveredDraft] = useState("");
  const [reload, setReload] = useState(0);
  const [recoveryNeeded, setRecoveryNeeded] = useState(false);
  const [checkingSaved, setCheckingSaved] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [checkedAt, setCheckedAt] = useState(Date.now());
  const [stage, setStage] = useState<QuickScriptStage>("synopsis");
  const [idea, setIdea] = useState("");
  const [material, setMaterial] = useState("");
  const [settings, setSettings] = useState<QuickScriptSettings>(DEFAULTS);
  const [synopsis, setSynopsis] = useState("");
  const [plan, setPlan] = useState<QuickScriptPlan | null>(null);
  const [episodeNumber, setEpisodeNumber] = useState(1);
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const [instruction, setInstruction] = useState("");
  const [messages, setMessages] = useState<PlanningCanvasMessage[]>([]);
  const [deliver, setDeliver] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const recoveryRead = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  const episodeRef = useRef(episodeNumber);
  const mounted = useRef(true);
  const stop = useRef(false);
  const { progress, begin } = useCopilotProgress(`${project.id}:quick`);
  const initial = quickInitialInputs(project);
  const hasSynopsis = Boolean(state?.synopsis || (!state && synopsis.trim()));
  const sourceChanged = Boolean(state && !state.synopsis_confirmed && (idea !== state.idea || material !== state.source_material
    || JSON.stringify(settings) !== JSON.stringify(state.settings)));
  stateRef.current = state;
  episodeRef.current = episodeNumber;
  const currentEpisode = state?.episodes.find((item) => item.episode_number === episodeNumber);
  const bodyDirty = Boolean(draft && currentEpisode && JSON.stringify(draft) !== JSON.stringify(currentEpisode.draft));
  const synopsisDirty = synopsis !== (state?.synopsis ?? initial.synopsis);
  const planDirty = JSON.stringify(plan) !== JSON.stringify(state?.plan ?? null);
  const dirty = bodyDirty || synopsisDirty || planDirty || idea !== (state?.idea ?? initial.idea) || material !== (state?.source_material ?? initial.material)
    || JSON.stringify(settings) !== JSON.stringify(state?.settings ?? initial.settings);
  const pendingKey = projectStorageKey(`ai-comic.quick-editor.v1:${project.id}`);
  const recovering = recoveryNeeded || checkingSaved || Boolean(state?.active_operation);
  const waitingForPrevious = quickScriptOperationActive(state, checkedAt);
  const settingsValid = Number.isInteger(settings.target_total_characters) && settings.target_total_characters >= 1000 && settings.target_total_characters <= 10000
    && Number.isInteger(settings.episode_count) && settings.episode_count >= 1 && settings.episode_count <= 12
    && Number.isInteger(settings.target_duration_seconds) && settings.target_duration_seconds >= 75 && settings.target_duration_seconds <= 115;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop.current = true; operation.current?.abort(); recoveryRead.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const pending = { revision: state?.revision ?? 0, dirty, idea, material, settings, synopsis, plan, episodeNumber, draft, messages };
    try { window.sessionStorage.setItem(pendingKey, JSON.stringify(pending)); } catch { /* The existing server copy is still available. */ }
  }, [ready, pendingKey, state?.revision, dirty, idea, material, settings, synopsis, plan, episodeNumber, draft, messages]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!ready || busy || checkingSaved || !recovering) return;
    // A recovery poll only reads persisted state. It never restarts a model
    // command, resets the editor, or continues generation after navigation.
    const timer = window.setTimeout(() => { void refreshSavedState(); }, recoveryError ? 5000 : 2500);
    return () => window.clearTimeout(timer);
  }, [ready, busy, checkingSaved, recovering, checkedAt, recoveryError]);

  function applyState(next: QuickScriptState | null) {
    stateRef.current = next;
    setState(next);
    setIdea(next?.idea ?? initial.idea);
    setMaterial(next?.source_material ?? initial.material);
    setSettings(next?.settings ?? initial.settings);
    setSynopsis(next?.synopsis ?? initial.synopsis);
    setPlan(next?.plan ?? null);
  }

  async function adopt(response: QuickScriptResponse, source: ScriptProject) {
    if (!mounted.current) throw new Error("页面已关闭，重新打开后可继续。");
    const saved = acceptQuickWorkspaceSnapshot(source, response.data);
    if (!await adoptServerProjectSnapshot(saved, source)) throw new Error("作品在另一处已有修改，已停止后续生成。请重新读取当前作品。");
    if (!mounted.current) throw new Error("页面已关闭，重新打开后可继续。");
    applyState(response.data.state);
    setStage(quickScriptStage(response.data.state));
    const selected = quickScriptSelectedEpisode(response.data.state, episodeRef.current);
    setEpisodeNumber(selected?.episode_number ?? 1); setDraft(selected?.draft ?? null);
    return response.data.state;
  }

  async function syncedSource() {
    let source = getProject(project.id);
    if (!source) throw new Error("暂时无法读取当前作品。");
    if (source.serverSync?.status !== "synced") {
      if (source.serverSync?.status === "conflict") throw new Error("请先处理作品版本冲突，再继续创作。");
      const result = await syncProjectSnapshot(source);
      if (result.status !== "synced") throw new Error("当前修改尚未保存到服务端，请重试保存后继续。");
      source = getProject(project.id)!;
    }
    return source;
  }

  async function refreshSavedState() {
    if (operation.current || recoveryRead.current || !mounted.current) return;
    const controller = new AbortController();
    recoveryRead.current = controller;
    setCheckingSaved(true);
    try {
      // Recovery must remain read-only, including when host autosave is offline.
      const source = getProject(project.id);
      if (!source || source.serverSync?.status !== "synced") throw new Error("作品有未同步修改，请先处理同步状态，再读取保存进度。");
      const response = await loadQuickScript(project.id, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      const previous = stateRef.current;
      const changed = response.data.state?.revision !== previous?.revision;
      if (changed) {
        try {
          const raw = window.sessionStorage.getItem(pendingKey);
          const pending = raw ? JSON.parse(raw) : null;
          if (raw && pending?.dirty === true && pending.revision !== (response.data.state?.revision ?? 0)) {
            window.sessionStorage.setItem(`${pendingKey}:recovery:${pending.revision}`, raw);
            window.sessionStorage.setItem(`${pendingKey}:recovery-latest`, raw);
            setRecoveredDraft(quickRecoveryText(pending));
          }
        } catch { /* Recovery of server results must not depend on local cache access. */ }
      }
      const loaded = changed ? await adopt(response, source) : response.data.state;
      setRecoveryNeeded(false); setRecoveryError(""); setError("");
      if (!loaded?.active_operation) {
        setPaused(Boolean(loaded?.plan_confirmed && loaded.phase !== "complete"));
        setNotice(loaded?.blocked_reason ? "上次处理已结束，已读取保存进度，请按提示继续。"
          : loaded?.phase === "complete" ? "已找回完整剧本，保存与检查均已完成。"
          : "已读取保存进度。确认后点击继续，不会自动开始下一步。");
      }
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) {
        setRecoveryNeeded(true);
        setRecoveryError(failure instanceof Error ? failure.message : "暂时无法读取保存进度，正在重试。");
      }
    } finally {
      if (recoveryRead.current === controller) recoveryRead.current = null;
      if (mounted.current) { setCheckingSaved(false); setCheckedAt(Date.now()); }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setReady(false); setError("");
    void (async () => {
      const source = await syncedSource();
      const response = await loadQuickScript(project.id, controller.signal);
      if (!active) return;
      const changedSources = pendingQuickSourceInputs(source, response.data.state);
      const loaded = await adopt(response, source);
      if (!active) return;
      // This query is an explicit source-page intent, not a persisted workflow.
      // Existing server state always wins; merely opening this page issues no setup command.
      const entrySource = getProject(project.id) ?? source;
      const shortSettings = !loaded ? shortQuickSettingsForLegacyProject(entrySource,
        Number(new URLSearchParams(window.location.search).get("episodes"))) : null;
      setStage(quickScriptStage(loaded));
      setPaused(Boolean(loaded?.plan_confirmed && loaded.phase !== "complete"));
      const first = quickScriptSelectedEpisode(loaded, 1);
      setEpisodeNumber(first?.episode_number ?? 1); setDraft(first?.draft ?? null);
      try {
        const raw = window.sessionStorage.getItem(pendingKey);
        const pending = raw ? JSON.parse(raw) : null;
        const pendingMarketMismatch = pending?.settings?.language
          && pending.settings.language !== (loaded?.settings.language ?? initial.settings.language);
        if (pending && raw && pending.dirty !== false && (shortSettings || pendingMarketMismatch || pending.revision !== (loaded?.revision ?? 0))) {
          // Preserve the original cache before the new server revision is adopted.
          window.sessionStorage.setItem(`${pendingKey}:recovery:${pending.revision}`, raw);
          window.sessionStorage.setItem(`${pendingKey}:recovery-latest`, raw);
        }
        const recovery = window.sessionStorage.getItem(`${pendingKey}:recovery-latest`);
        if (recovery) setRecoveredDraft(quickRecoveryText(JSON.parse(recovery)));
        if (pending?.revision === (loaded?.revision ?? 0) && !pendingMarketMismatch) {
          // Clean caches hold navigation/history, never a newer source of content.
          if (pending.dirty === true) {
            if (typeof pending.idea === "string") setIdea(pending.idea);
            if (typeof pending.material === "string") setMaterial(pending.material);
            if (typeof pending.synopsis === "string") setSynopsis(pending.synopsis);
            if (pending.settings?.language === "zh" || pending.settings?.language === "en") setSettings(pending.settings);
            if (pending.plan?.id === loaded?.plan?.id) setPlan(pending.plan);
          }
          const episode = loaded?.episodes.find((item) => item.episode_number === pending.episodeNumber);
          if (episode) { setEpisodeNumber(episode.episode_number); setDraft(pending.dirty === true && pending.draft?.id === episode.draft.id ? pending.draft : episode.draft); }
          if (Array.isArray(pending.messages)) setMessages(pending.messages.filter((item: PlanningCanvasMessage) => typeof item.text === "string").slice(-50));
        }
      } catch { /* A damaged local editor cache does not prevent server recovery. */ }
      if (changedSources) {
        setIdea(changedSources.idea); setMaterial(changedSources.material); setSettings(changedSources.settings);
        setNotice("原始资料已更新。点击重新整理梗概，让新资料进入本次创作。");
      }
      if (shortSettings) {
        const entryInputs = quickInitialInputs(entrySource);
        setIdea(entryInputs.idea); setMaterial(entryInputs.material); setSynopsis(entryInputs.synopsis); setSettings(shortSettings);
        setNotice(`已按 ${shortSettings.episode_count} 集准备快速创作，请核对后继续。`);
        router.replace(quickScriptHref(project.id));
      }
      setReady(true);
      setRecoveryNeeded(false); setRecoveryError(""); setCheckedAt(Date.now());
    })().catch((failure) => { if (active && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "读取失败，请重试。"); });
    return () => { active = false; controller.abort(); };
    // Reload is explicit; updates from our own adopted snapshots must not restart this read.
  }, [project.id, reload]);

  function pause() { stop.current = true; setPauseRequested(true); setNotice("本次处理保存后暂停，已完成内容会保留。"); }

  async function run(action: QuickScriptAction, payload: Record<string, unknown> = {}, auto = false) {
    if (operation.current || recoveryRead.current || recoveryNeeded || !ready) return;
    if (stateRef.current?.active_operation && (quickScriptOperationActive(stateRef.current) || action !== "resume")) {
      setError("上次操作仍需恢复，请先等待保存完成或使用恢复按钮。");
      return;
    }
    const controller = new AbortController();
    operation.current = controller; stop.current = false;
    setBusy(true); setPaused(false); setPauseRequested(false); setError(""); setFailureDetails(undefined); setNotice("");
    const progressRun = begin(controller.signal);
    progressRun.mark("requesting", "正在提交当前创作请求");
    let next = stateRef.current;
    let submitted = false;
    let needsRead = false;
    try {
      async function request(kind: QuickScriptAction, body: Record<string, unknown> = {}) {
        setWorkingLabel(kind === "draft_synopsis" ? "正在整理故事梗概" : kind === "draft_plan" ? "正在安排人物与每集故事"
          : kind === "advance" && stateRef.current ? quickScriptProgressLabel(stateRef.current) : kind === "resume" ? "正在恢复已保存的创作进度" : "正在保存当前内容");
        const source = await syncedSource();
        submitted = true;
        const response = await actQuickScript(project.id, stateRef.current?.revision ?? 0, kind, body, { signal: controller.signal, onProgress: progressRun.onEvent });
        next = await adopt(response, source);
        return next;
      }
      if ((!next && ["draft_synopsis", "confirm_synopsis", "draft_plan"].includes(action))
        || (action === "draft_synopsis" && next && (next.idea !== idea || next.source_material !== material || JSON.stringify(next.settings) !== JSON.stringify(settings)))) {
        await request("setup", { idea, source_material: material, settings });
      }
      // A deliberate retry must clear the durable paused state first. This is
      // one user-requested generation, never a loop or an automatic replay.
      if (next && ["blocked", "stale"].includes(next.status) && ["draft_synopsis", "draft_plan"].includes(action)) {
        next = await request("resume");
        if (!next || ["blocked", "stale"].includes(next.status)) throw new Error("当前步骤尚未恢复，请读取保存进度后继续。");
      }
      next = await request(action, payload);
      if (action === "confirm_synopsis" && next?.synopsis_confirmed && !stop.current) {
        progressRun.mark("requesting", "正在安排人物设定与每集故事");
        next = await request("draft_plan");
      }
      if (auto && next) next = await advanceQuickScriptSequentially(next, {
        stopped: () => stop.current || controller.signal.aborted || !mounted.current,
        advance: async (current) => {
          progressRun.mark("requesting", quickScriptProgressLabel(current));
          const advanced = await request("advance");
          if (!advanced) throw new Error("未收到当前创作状态，请重新读取。");
          return advanced;
        },
      });
      if (!mounted.current) return;
      setStage(quickScriptStage(next));
      const selected = quickScriptSelectedEpisode(next, episodeRef.current);
      setEpisodeNumber(selected?.episode_number ?? 1); setDraft(selected?.draft ?? null);
      const isPaused = stop.current || next?.phase === "paused";
      const failed = next?.status === "blocked" || Boolean(next?.blocked_reason);
      setPaused(isPaused);
      const text = failed && next ? quickScriptFailureMessage(next, isPaused) : (isPaused ? "已暂停，已有内容已保存。" : next?.phase === "complete" ? "整部剧本已保存并完成检查，可以编辑或进入资产设计。" : action === "save_episode" ? "正文修改已保存，相关内容将重新检查。" : action === "draft_plan" || action === "confirm_synopsis" ? "创作安排已整理好，请核对人物设定和每集故事。" : action === "draft_synopsis" ? "故事梗概已整理好，请核对后确认。" : "当前修改已保存。");
      setMessages((items) => [...items.slice(-48), { id: crypto.randomUUID(), role: "assistant", text, progress: progressRun.finish(failed ? "error" : isPaused ? "paused" : "completed") }]);
      if (action === "switch_standard" || next?.phase === "standard") router.replace(currentWorkspaceHref(getProject(project.id)!));
    } catch (failure) {
      progressRun.finish(controller.signal.aborted ? "paused" : "error");
      if (mounted.current && !controller.signal.aborted) {
        setFailureDetails(failure);
        setPaused(true);
        setError(failure instanceof ApiError && failure.status === 409 ? "作品状态已有变化，请重新读取后继续。已保存正文不会被覆盖。" : failure instanceof Error ? failure.message : "本次处理未完成，已有内容已保留。");
        if (submitted && (!(failure instanceof ApiError) || failure.status === 409 || failure.status >= 500)) {
          stop.current = true;
          needsRead = true;
          setRecoveryNeeded(true);
          setNotice("连接中断，正在读取已保存进度；请稍候，当前请求不会重复发送。");
        }
      }
    } finally {
      if (operation.current === controller) operation.current = null;
      if (mounted.current) { setBusy(false); setPauseRequested(false); }
      if (needsRead && mounted.current && !controller.signal.aborted) void refreshSavedState();
    }
  }

  function submitInstruction() {
    const text = instruction.trim();
    if (!text || busy) return;
    setMessages((items) => [...items.slice(-48), { id: crypto.randomUUID(), role: "user", text }]);
    setInstruction("");
    if (stage === "script") {
      setNotice("可以直接编辑左侧正文并保存，系统会重新检查受影响的内容。");
      return;
    }
    void run(stage === "plan" ? "draft_plan" : "draft_synopsis", { instruction: text,
      ...(stage === "plan" ? (plan ? { current_plan: plan } : {}) : { current_synopsis: synopsis }) });
  }

  function exportScript() {
    if (!state?.episodes.length) return;
    const content = state.episodes.map((item) => quickEpisodePlainText(item.draft, item.episode_number)).join("\n\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${plan?.title || project.title}.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const blockedIssues = [...(state?.final_review?.issues ?? []), ...(state?.episodes.flatMap(episode =>
    (episode.review?.issues ?? []).map(issue => ({ ...issue, episode_number: issue.episode_number ?? episode.episode_number }))) ?? [])].filter((issue) => issue.severity !== "warning");
  const arrangementLocked = Boolean(state?.plan_confirmed);
  const canDeliver = state?.phase === "complete" && !dirty;
  const activeStage = quickScriptStage(state);
  const requiresAuthorEdit = quickScriptRequiresAuthorEdit(state);
  const assistantPrimary = ready && (stage === "synopsis" ? !hasSynopsis : stage === "plan" ? !plan : !draft);
  const generationFailed = Boolean(state?.blocked_reason || error);
  const savedFailure = state?.blocked_reason ? state.operation_records?.findLast(record => record.error_code || record.diagnostics) : undefined;
  const focusedAction = !assistantPrimary ? null : busy
    ? <button className={styles.secondary} type="button" disabled={pauseRequested} onClick={pause}><Pause size={14} />{pauseRequested ? "当前处理保存后暂停" : "当前步骤完成后暂停"}</button>
    : stage === "synopsis"
      ? <button className={styles.primary} type="button" disabled={recovering || (!idea.trim() && !material.trim()) || !settingsValid} onClick={() => instruction.trim() ? submitInstruction() : void run("draft_synopsis")}>{sourceChanged ? "根据新资料重新整理梗概" : generationFailed ? "重新整理故事梗概" : project.creationMode === "quick" ? "整理成故事梗概" : "使用快速创作，整理梗概"}<ArrowRight size={15} /></button>
      : stage === "plan"
        ? <button className={styles.primary} type="button" disabled={recovering} onClick={() => instruction.trim() ? submitInstruction() : void run("draft_plan")}>{generationFailed ? "重新生成创作安排" : "生成创作安排"}<ArrowRight size={15} /></button>
        : state?.plan_confirmed && !requiresAuthorEdit
          ? <button className={styles.primary} type="button" disabled={recovering} onClick={() => void run(state.phase === "paused" ? "resume" : "advance", {}, true)}><Play size={15} />{paused ? "继续生成剧本" : "生成整部剧本"}</button> : null;

  return <section className={styles.workspace} aria-label="快速剧本创作">
    <header className={styles.header}>
      <Link className={styles.sourceLink} href={`/projects/${project.id}`} aria-disabled={busy || recovering || dirty || undefined}
        onClick={(event) => { if (busy || recovering || dirty) event.preventDefault(); }}>原始资料</Link>
      <nav className={styles.stages} aria-label="剧本创作阶段">{STAGES.map((item, index) => <button key={item.id} type="button" aria-current={stage === item.id ? "step" : undefined}
        disabled={busy || (item.id !== stage && (synopsisDirty || planDirty || bodyDirty)) || (item.id === "plan" && !state?.synopsis_confirmed) || (item.id === "script" && !state?.plan_confirmed && !state?.episodes.length)} onClick={() => setStage(item.id)}>
        <span className={styles.stageNumber}>{index < STAGES.findIndex((part) => part.id === activeStage) ? <Check size={12} /> : index + 1}</span>{item.label}</button>)}</nav>
      <p className={styles.saveState} role="status">{busy ? "正在处理…" : recovering ? "正在找回保存进度" : dirty ? "有未保存修改" : ready ? "已保存" : "正在读取…"}</p>
    </header>
    <div className={`${styles.body}${assistantPrimary ? ` ${styles.assistantPrimary}` : ""} host-workspace-content`}>
      <main className={styles.document}>
        {busy && <div className={styles.progress} role="status"><div><strong>{workingLabel || (state ? quickScriptProgressLabel(state) : "正在整理故事梗概")}</strong><p>{pauseRequested ? "当前处理保存后暂停" : "每一步完成即保存，切换主项目页面不会丢失已保存内容。"}</p></div></div>}
        {busy && progress && !assistantPrimary && <div className={styles.mobileProgress}><CopilotProgressView progress={progress} /></div>}
        {error && !state?.blocked_reason && <div className={`${styles.notice} ${styles.error}`} role="alert"><strong>{stage === "plan" ? "创作安排暂未完成" : "本次处理暂未完成"}</strong><p>{error}</p>{!ready && <button className={styles.secondary} disabled={busy || checkingSaved} type="button" onClick={() => setReload((value) => value + 1)}><RefreshCw size={14} />重新读取</button>}</div>}
        {(error || state?.blocked_reason || recoveryError) && <GenerationDiagnostics projectId={project.id} stage={state?.next_step ?? stage}
          error={savedFailure ?? failureDetails} requestId={progress?.requestId} revision={state?.revision} savedEpisodes={state?.episodes.length}
          operationId={typeof state?.active_operation?.operation_id === "string" ? state.active_operation.operation_id : typeof savedFailure?.operation_id === "string" ? savedFailure.operation_id : undefined} />}
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {ready && (synopsisDirty || planDirty || bodyDirty) && <p className={styles.intro}>先确认或保存本页修改，再切换阶段。</p>}
        {recoveredDraft && <details className={styles.notice}><summary>查看版本变化前保留的编辑内容</summary><p>当前显示服务端版本。你之前的编辑已另存，可从这里复制所需内容。</p><Field label="保留的编辑内容"><textarea rows={10} value={recoveredDraft} readOnly /></Field></details>}
        {ready && state && <p className={styles.intro}>{quickScriptSavedProgressLabel(state)}{state.updated_at && <> · 上次保存 {new Date(state.updated_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</>}</p>}
        {recovering && <div className={styles.notice} role="status"><strong>{state?.active_operation ? waitingForPrevious ? quickScriptProgressLabel(state) : "上次操作未返回结果，已有内容已保留。" : "正在确认上次操作的保存状态…"}</strong>
          <p>{state?.active_operation ? quickScriptRecoveryWaitLabel(state, checkedAt) : "会自动读取保存结果，确认前请勿重复生成。"}</p>
          {recoveryError && <p role="alert">暂时无法读取：{recoveryError} 会自动重试。</p>}
          <div className={styles.actions}><button className={styles.secondary} disabled={busy || checkingSaved || !ready} type="button" onClick={() => void refreshSavedState()}><RefreshCw size={14} />{checkingSaved ? "正在读取进度" : "刷新保存进度"}</button>
            {!!state?.active_operation && !waitingForPrevious && !recoveryNeeded && <button className={styles.secondary} disabled={busy || checkingSaved || !ready} type="button" onClick={() => void run("resume")}>恢复中断步骤</button>}</div>
        </div>}
        {!ready ? <p className={styles.empty}>正在读取已保存内容…</p> : <>
          {state?.blocked_reason && <div className={`${styles.notice} ${styles.error}`} role="alert"><strong>{requiresAuthorEdit ? "请调整标出的正文后再检查" : stage === "plan" ? "创作安排暂未完成" : stage === "synopsis" ? "故事梗概暂未完成" : "剧本生成已暂停"}</strong><p>{requiresAuthorEdit ? "已保存版本会保留，修改后点击“保存正文修改”。" : stage === "plan" ? "已确认的梗概已保存。点击“重新生成创作安排”即可继续，无需重新填写。" : "已有内容已保存，可以继续当前步骤。"}</p><details className={styles.failureDetails}><summary>查看原因</summary><p>{state.blocked_reason}</p></details>{blockedIssues.map((issue, index) => <p key={index}>{issue.episode_number ? `第 ${issue.episode_number} 集：` : ""}{issue.message}{issue.evidence_quote ? `（${issue.evidence_quote}）` : ""}</p>)}</div>}
          {stage === "synopsis" && <>
            <h1>{hasSynopsis ? "先把故事方向定下来" : "你想讲一个怎样的故事？"}</h1><p className={styles.intro}>{hasSynopsis ? "直接修改梗概，或告诉剧本大师你想怎么改。" : "写下一个想法，人物、背景或结局都可以从这里开始。"}</p>
            {settings.language === "en" && <p className={styles.intro}>海外发行：英文台词配中文翻译，故事梗概、创作安排和场景动作使用中文。</p>}
            {hasSynopsis && <p className={styles.intro}>快速创作篇幅：{settings.episode_count} 集 · 每集 {settings.target_duration_seconds} 秒 · 总正文约 {settings.target_total_characters.toLocaleString()} 字。已有故事梗概会继续沿用。</p>}
            {hasSynopsis ? <div className={styles.card}><Field label="故事梗概"><textarea className={styles.synopsis} rows={16} maxLength={8000} disabled={busy || recovering || arrangementLocked} value={synopsis} onChange={(event) => setSynopsis(event.target.value)} /></Field></div>
              : <div className={styles.card}><Field label="故事想法"><textarea className={styles.idea} rows={7} maxLength={10000} disabled={busy || recovering} value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="例如：一位能听见旧物记忆的修表师，在一只停走的怀表里发现了父亲失踪的线索。" /></Field>
                <details className={styles.settings}><summary>调整篇幅 · {settings.episode_count} 集 / 约 {settings.target_total_characters.toLocaleString()} 字</summary><div className={styles.settingsGrid}>
                  <p className={styles.intro}>正文目标约 {settings.target_total_characters.toLocaleString()} 字，上限 10,000 有效字。</p>
                  <NumberField label="集数" value={settings.episode_count} min={1} max={12} disabled={busy || recovering} onChange={(value) => setSettings((current) => ({ ...current, episode_count: value,
                    target_total_characters: quickTargetCharactersAfterEpisodeChange(current.episode_count, value, current.target_total_characters) }))} />
                  <NumberField label="每集时长（秒）" value={settings.target_duration_seconds} min={75} max={115} disabled={busy || recovering} onChange={(value) => setSettings({ ...settings, target_duration_seconds: value })} />
                </div></details><details className={styles.settings}><summary>补充已有资料或人物设定</summary><Field label="已有资料"><textarea rows={6} maxLength={20000} disabled={busy || recovering} value={material} onChange={(event) => setMaterial(event.target.value)} /></Field></details>
              </div>}
            {!hasSynopsis && !settingsValid && <p className={styles.notice}>快速创作支持 1–12 集、总正文 1000–10000 字、每集 75–115 秒。可以调整篇幅，或在下方转入标准流程。</p>}
            {!assistantPrimary && <div className={styles.actions}>{arrangementLocked ? <button className={styles.primary} type="button" onClick={() => setStage("script")}>回到剧本正文<ArrowRight size={15} /></button> : sourceChanged
              ? <button className={styles.primary} type="button" disabled={busy || recovering || !settingsValid} onClick={() => void run("draft_synopsis")}>根据新资料重新整理梗概<RefreshCw size={15} /></button> : hasSynopsis
              ? <button className={styles.primary} type="button" disabled={busy || recovering || !synopsis.trim()} onClick={() => void run("confirm_synopsis", { synopsis })}>确认梗概，安排每集故事<ArrowRight size={15} /></button>
              : <button className={styles.primary} type="button" disabled={busy || recovering || (!idea.trim() && !material.trim()) || !settingsValid} onClick={() => void run("draft_synopsis")}>{project.creationMode === "quick" ? "整理成故事梗概" : "使用快速创作，整理梗概"}<ArrowRight size={15} /></button>}</div>}
          </>}
          {stage === "plan" && <>
            <h1>{plan ? "人物与每集故事，一次确认" : "接下来，安排每集故事"}</h1><p className={styles.intro}>{plan ? "核对固定设定与剧情走向，确认后会按顺序生成并检查每一集。" : `根据已确认的梗概，整理人物和 ${settings.episode_count} 集剧情。生成后只需整体确认一次。`}</p>
            {!assistantPrimary && <div className={`${styles.actions} ${styles.stickyActions}`}>{arrangementLocked ? <button className={styles.primary} type="button" onClick={() => setStage("script")}>回到剧本正文<ArrowRight size={15} /></button>
              : plan ? <button className={styles.primary} type="button" disabled={busy || recovering} onClick={() => void run("confirm_plan", { plan }, true)}>确认安排，生成整部剧本<Play size={15} /></button>
                : <button className={styles.primary} type="button" disabled={busy || recovering} onClick={() => void run("draft_plan")}>生成创作安排<ArrowRight size={15} /></button>}</div>}
            {plan ? <QuickPlanEditor plan={plan} disabled={busy || recovering || arrangementLocked} onChange={setPlan} /> : <div className={styles.contextCard}><span className={styles.badge}><Check size={12} />梗概已确认</span><p className={styles.contextSynopsis}>{synopsis}</p><p className={styles.contextMeta}>{settings.episode_count} 集 · 每集 {settings.target_duration_seconds} 秒</p></div>}
          </>}
          {stage === "script" && <>
            <h1>{plan?.title || "剧本正文"}</h1><p className={styles.intro}>每一步完成后自动保存。可切换主项目页面；关闭或刷新网页后，回来读取保存进度再继续。</p>
            {!assistantPrimary && <div className={`${styles.actions} ${styles.stickyActions}`}>{bodyDirty ? <button className={styles.primary} type="button" disabled={busy || recovering} onClick={() => void run("save_episode", { episode_number: episodeNumber, draft })}>保存正文修改<Check size={15} /></button>
              : canDeliver ? <button className={styles.primary} type="button" disabled={busy || recovering} onClick={() => setDeliver(true)}>确认剧本，进入资产设计<ArrowRight size={15} /></button>
                : !busy && !recovering && state?.plan_confirmed && !requiresAuthorEdit ? <button className={styles.primary} type="button" onClick={() => void run(state.phase === "paused" ? "resume" : "advance", {}, true)}><Play size={15} />{state.next_step === "review" || state.status === "stale" ? "检查修改并继续" : paused ? "继续生成剩余剧本" : "继续生成剧本"}</button> : null}
              {busy && <button className={styles.secondary} type="button" disabled={pauseRequested} onClick={pause}><Pause size={14} />{pauseRequested ? "正在暂停" : "暂停生成"}</button>}
              {requiresAuthorEdit && !bodyDirty && <span className={styles.saveState}>请先修改提示对应的正文，再保存继续检查。</span>}
              {!!state?.episodes.length && <details className={styles.moreActions}><summary>更多</summary><button className={styles.secondary} disabled={busy || bodyDirty} type="button" onClick={exportScript}><Download size={15} />导出已保存正文</button></details>}
            </div>}
            <nav className={styles.episodePicker} aria-label="已保存剧集">{state?.episodes.map((episode) => <button type="button" key={episode.episode_number} aria-pressed={episodeNumber === episode.episode_number} disabled={bodyDirty}
              onClick={() => { episodeRef.current = episode.episode_number; setEpisodeNumber(episode.episode_number); setDraft(episode.draft); }}>第 {episode.episode_number} 集{episode.status === "stale" ? " · 待复核" : episode.status === "blocked" ? " · 待调整" : ""}</button>)}</nav>
            {draft ? <QuickDraftEditor draft={draft} disabled={busy || recovering} onChange={setDraft} /> : <div className={styles.contextCard}><span className={styles.badge}><Check size={12} />创作安排已确认</span><p className={styles.summary}>{plan?.main_storyline}</p><p className={styles.contextMeta}>共 {settings.episode_count} 集，完成一集便保存一集。</p></div>}
          </>}
          {busy && stage !== "script" && !assistantPrimary && <button className={styles.secondary} type="button" disabled={pauseRequested} onClick={pause}><Pause size={14} />{pauseRequested ? "当前处理保存后暂停" : "暂停"}</button>}
          {!busy && !recovering && <details className={styles.settings}><summary>其他创作方式</summary><p>更长篇幅或复杂故事，可保留已有内容并继续标准流程。</p><button className={styles.secondary} disabled={bodyDirty} type="button" onClick={() => void run("switch_standard", { idea, source_material: material, current_synopsis: synopsis, current_plan: plan, settings })}>保留成果，转标准流程</button></details>}
        </>}
      </main>
      <aside className={styles.copilot}><PlanningCanvasCopilot busy={busy} disabled={!ready || recovering || stage === "script" || arrangementLocked} disabledReason={stage === "script" ? "可直接编辑正文并保存，已有版本会保留。" : "当前设定已确认，可在正文中继续编辑。"}
        presentation={assistantPrimary ? "primary" : "rail"} primaryAction={focusedAction}
        welcomeMessage={assistantPrimary ? stage === "plan" ? "故事方向已经确定。我会沿用已确认的梗概，安排人物与每集故事；你也可以补充这次创作的要求。" : stage === "script" ? "创作安排已经确认。我会按顺序生成并检查每一集，正文保存后会自动展示在这里。" : "把故事想法写在资料区，然后点击“整理成故事梗概”。已有资料会一起参考，生成后由你确认故事方向。" : undefined}
        composerPlaceholder={stage === "plan" ? "可选：补充人物或剧情安排的要求…" : "可选：告诉我故事想突出什么…"}
        instruction={instruction} messages={messages} progress={progress} onInstructionChange={setInstruction} onSubmit={submitInstruction} onPause={pause}
        onQuickAction={(_action, text) => setInstruction(text)} onClearSelection={() => undefined} selection={null} quickActions={[]} scopeLabel={stage === "script" ? "剧本正文" : stage === "plan" ? "创作安排" : "故事梗概"} variant="document" /></aside>
    </div>
    {deliver && <HostImportPanel project={getProject(project.id) ?? project} onTarget={() => undefined} onClose={() => setDeliver(false)} />}
  </section>;
}

export function quickRecoveryText(pending: { idea?: string; material?: string; synopsis?: string; plan?: QuickScriptPlan | null; draft?: GeneratedDraft | null; episodeNumber?: number }): string {
  const plan = pending.plan;
  return [pending.idea && `故事想法\n${pending.idea}`, pending.material && `已有资料\n${pending.material}`,
    pending.synopsis && `故事梗概\n${pending.synopsis}`,
    plan && [plan.title, ...plan.characters.map(c => [c.name, c.role, c.motivation, c.fixed_identity, c.abilities_and_limits, c.appearance].filter(Boolean).join("\n")),
      ...(plan.production_assets ?? []).map(asset => [asset.kind === "scene" ? "场景资料" : "物品资料", asset.name, asset.appearance, ...asset.fixed_details].filter(Boolean).join("\n")),
      ...plan.fixed_facts, ...plan.relationships, plan.main_storyline, plan.subplot, plan.opening, ...plan.turning_points, plan.ending,
      ...plan.episodes.map(e => [`第 ${e.episode_number} 集`, e.synopsis ?? e.episode_goal, e.central_conflict, e.protagonist_decision, e.exit_state,
        ...e.scene_execution_plan.flatMap(s => [s.scene_heading, s.visible_action, s.turn_or_reveal])].filter(Boolean).join("\n"))].filter(Boolean).join("\n\n"),
    pending.draft && quickEpisodePlainText(pending.draft, pending.episodeNumber ?? 1)].filter(Boolean).join("\n\n");
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={styles.field}><span>{label}</span>{children}</label>; }
function NumberField({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void }) {
  return <Field label={label}><input type="number" value={value} min={min} max={max} disabled={disabled} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} /></Field>;
}

export function QuickPlanEditor({ plan, disabled, onChange }: { plan: QuickScriptPlan; disabled: boolean; onChange: (plan: QuickScriptPlan) => void }) {
  const text = (label: string, value: string, change: (value: string) => void, rows = 2) => <Field label={label}><textarea rows={rows} disabled={disabled} value={value} onChange={(event) => change(event.target.value)} /></Field>;
  return <>
    <div className={styles.card}><h2>人物与固定设定</h2><div className={styles.characters}>{plan.characters.map((character, index) => {
      const change = (key: keyof typeof character, value: string) => onChange({ ...plan, characters: plan.characters.map((item, position) => position === index ? { ...item, [key]: value } : item) });
      return <div key={character.character_ref} className={styles.character}><h3>{character.name}</h3><p className={styles.summary}>{character.fixed_identity || character.role}<br />{character.motivation}</p><details className={styles.sceneDetails}><summary>修改人物设定</summary>{text("人物姓名", character.name, (value) => change("name", value), 1)}{text("身份与角色", character.fixed_identity, (value) => change("fixed_identity", value))}{text("人物外观", character.appearance, (value) => change("appearance", value))}{text("想要什么", character.motivation, (value) => change("motivation", value))}{text("能力与限制", character.abilities_and_limits, (value) => change("abilities_and_limits", value))}</details></div>;
    })}</div><details className={styles.sceneDetails}><summary>查看与修改固定设定、人物关系</summary>{text("固定设定（每行一条）", plan.fixed_facts.join("\n"), (value) => onChange({ ...plan, fixed_facts: value.split("\n") }), 3)}{text("人物关系（每行一条）", plan.relationships.join("\n"), (value) => onChange({ ...plan, relationships: value.split("\n") }), 2)}</details></div>
    <QuickProductionAssets plan={plan} disabled={disabled} onChange={onChange} />
    <div className={styles.card}><h2>{plan.title} · 故事走向</h2><p className={styles.summary}>{plan.main_storyline}</p><p className={styles.summary}><strong>结局：</strong>{plan.ending}</p><details className={styles.sceneDetails}><summary>查看与修改故事走向</summary>{text("作品名称", plan.title, (value) => onChange({ ...plan, title: value }), 1)}{text("主线", plan.main_storyline, (value) => onChange({ ...plan, main_storyline: value }))}{text("开端", plan.opening, (value) => onChange({ ...plan, opening: value }))}{text("重要转折（每行一条）", plan.turning_points.join("\n"), (value) => onChange({ ...plan, turning_points: value.split("\n") }), 3)}{text("结局", plan.ending, (value) => onChange({ ...plan, ending: value }))}</details></div>
    {plan.episodes.map((episode, index) => {
      const change = (key: keyof typeof episode, value: unknown) => onChange({ ...plan, episodes: plan.episodes.map((item, position) => position === index ? { ...item, [key]: value } : item) });
      return <div className={styles.card} key={episode.episode_number}><div className={styles.episodeHeading}><strong>第 {episode.episode_number} 集</strong><span className={styles.badge}>{episode.target_duration_seconds} 秒</span></div>
        <p className={styles.summary}>{episode.synopsis || episode.episode_goal}</p><p className={styles.summary}><strong>本集变化：</strong>{episode.exit_state}</p><details className={styles.sceneDetails}><summary>修改本集故事</summary>{text("本集故事", episode.synopsis ?? episode.episode_goal, (value) => change(episode.synopsis == null ? "episode_goal" : "synopsis", value), 3)}
        {text("核心冲突", episode.central_conflict, (value) => change("central_conflict", value))}{text("人物的关键选择", episode.protagonist_decision, (value) => change("protagonist_decision", value))}{text("本集结束时发生了什么变化", episode.exit_state, (value) => change("exit_state", value))}</details>
        <details className={styles.sceneDetails}><summary>查看与修改 {episode.scene_execution_plan?.length ?? 0} 个场景</summary>{episode.scene_execution_plan?.map((scene, sceneIndex) => {
          const changeScene = (key: keyof typeof scene, value: string) => change("scene_execution_plan", episode.scene_execution_plan.map((item, position) => position === sceneIndex ? { ...item, [key]: value } : item));
          return <div className={styles.scene} key={scene.scene_number}><h3>场 {scene.scene_number}</h3>{text("地点与时间", scene.scene_heading, (value) => changeScene("scene_heading", value), 1)}{text("发生的行动", scene.visible_action, (value) => changeScene("visible_action", value))}{text("转折与变化", scene.turn_or_reveal, (value) => changeScene("turn_or_reveal", value))}</div>;
        })}</details>
      </div>;
    })}
  </>;
}

export function QuickDraftEditor({ draft, disabled, onChange }: { draft: GeneratedDraft; disabled: boolean; onChange: (draft: GeneratedDraft) => void }) {
  type Scene = GeneratedDraft["scenes"][number];
  type BodyPart = NonNullable<Scene["body_order"]>[number];
  const overseas = Boolean(draft.language?.toLowerCase().startsWith("en"));
  const changeDraft = (next: GeneratedDraft) => { if (!disabled) onChange(next); };
  const changeScene = (index: number, patch: Partial<Scene>) => changeDraft({ ...draft, scenes: draft.scenes.map((scene, position) => position === index ? { ...scene, ...patch } : scene) });
  const bodyOrder = (scene: Scene): BodyPart[] => scene.body_order?.length ? scene.body_order
    : [...scene.character_actions.map((_, position) => `action:${position}` as const), ...scene.dialogues.map((_, position) => `dialogue:${position}` as const)];
  function addPart(index: number, kind: "action" | "dialogue") {
    const scene = draft.scenes[index];
    if (disabled || (kind === "action" ? scene.character_actions.length >= 24 : scene.dialogues.length >= 35)) return;
    const partIndex = kind === "action" ? scene.character_actions.length : scene.dialogues.length;
    changeScene(index, { body_order: [...bodyOrder(scene), `${kind}:${partIndex}`],
      ...(kind === "action" ? { character_actions: [...scene.character_actions, ""] }
        : { dialogues: [...scene.dialogues, { character_name: scene.dialogues.at(-1)?.character_name || draft.characters[0]?.name || "", text: "", intent: "平静地", chinese_character_name: null, chinese_translation: null }] }) });
  }
  function removePart(index: number, kind: "action" | "dialogue", partIndex: number) {
    const scene = draft.scenes[index];
    const order = bodyOrder(scene).flatMap((part): BodyPart[] => {
      const [partKind, rawIndex] = part.split(":");
      const value = Number(rawIndex);
      if (partKind !== kind) return [part];
      if (value === partIndex) return [];
      return [`${kind}:${value > partIndex ? value - 1 : value}`];
    });
    changeScene(index, { body_order: order,
      ...(kind === "action" ? { character_actions: scene.character_actions.filter((_, position) => position !== partIndex) }
        : { dialogues: scene.dialogues.filter((_, position) => position !== partIndex) }) });
  }
  function removeScene(index: number) {
    if (disabled || draft.scenes.length <= 1) return;
    const remaining = draft.scenes.filter((_, position) => position !== index);
    const numbers = new Map(remaining.map((scene, position) => [scene.scene_number, position + 1]));
    changeDraft({ ...draft, scenes: remaining.map((scene, position) => ({ ...scene, scene_number: position + 1,
      ...(scene.scene_causality ? { scene_causality: { ...scene.scene_causality,
        caused_by_scene_number: scene.scene_causality.caused_by_scene_number == null ? null : numbers.get(scene.scene_causality.caused_by_scene_number) ?? null } } : {}) })) });
  }
  function addScene() {
    if (disabled || draft.scenes.length >= 5) return;
    const number = draft.scenes.length + 1;
    changeDraft({ ...draft, scenes: [...draft.scenes, { scene_number: number, slug: `新增场景${number}`, scene_heading: null,
      purpose: "推进本集故事", setting_hint: `新增场景${number}`, beat_summary: "补充本场具体行动与变化", emotional_shift: "情绪发生变化",
      character_refs: [], character_actions: [], dialogues: [], body_order: [], cliffhanger: false, content_manifest: null }] });
  }
  return <div className={styles.card}><Field label="本集标题"><input value={draft.title} disabled={disabled} onChange={(event) => changeDraft({ ...draft, title: event.target.value })} /></Field>
    {draft.scenes.map((scene, index) => <section className={styles.scene} key={scene.scene_number} aria-label={`场 ${scene.scene_number}`}><h3>场 {scene.scene_number}</h3>
      <Field label="场景"><input value={scene.scene_heading ?? scene.slug} disabled={disabled} onChange={(event) => changeScene(index, { scene_heading: event.target.value })} /></Field>
      {bodyOrder(scene).map((part, position) => {
        const [kind, rawIndex] = part.split(":");
        const partIndex = Number(rawIndex);
        if (kind === "action") return <Field key={`${part}-${position}`} label={`动作 ${partIndex + 1}`}><textarea rows={3} disabled={disabled} value={scene.character_actions[partIndex] ?? ""} onChange={(event) => changeScene(index, { character_actions: scene.character_actions.map((item, actionIndex) => actionIndex === partIndex ? event.target.value : item) })} /></Field>;
        const dialogueIndex = partIndex;
        const dialogue = scene.dialogues[dialogueIndex];
        if (!dialogue) return null;
        return <div className={styles.dialogue} key={`${part}-${position}`}>
        <Field label="人物"><input disabled={disabled} value={dialogue.character_name} onChange={(event) => changeScene(index, { dialogues: scene.dialogues.map((item, position) => position === dialogueIndex ? { ...item, character_name: event.target.value } : item) })} /></Field>
        <Field label={`${overseas ? "英文台词" : "台词"} ${dialogueIndex + 1}`}><textarea rows={2} disabled={disabled} value={dialogue.text} onChange={(event) => changeScene(index, { dialogues: scene.dialogues.map((item, position) => position === dialogueIndex ? { ...item, text: event.target.value } : item) })} /></Field>
        {overseas && <div className={styles.dialogueTranslation}><Field label={`中文翻译 ${dialogueIndex + 1}`}><textarea rows={2} disabled={disabled} value={dialogue.chinese_translation ?? ""}
          onChange={(event) => changeScene(index, { dialogues: scene.dialogues.map((item, position) => position === dialogueIndex ? { ...item, chinese_translation: event.target.value } : item) })} /></Field></div>}
      </div>;
      })}
      <details className={styles.sceneDetails}><summary>增删本场动作与台词</summary><p>新增后填写具体内容，再保存检查。删除只在保存后生效。</p>
        <div className={styles.actions}><button className={styles.secondary} type="button" disabled={disabled || scene.character_actions.length >= 24} onClick={() => addPart(index, "action")}>添加动作</button>
          <button className={styles.secondary} type="button" disabled={disabled || scene.dialogues.length >= 35} onClick={() => addPart(index, "dialogue")}>添加台词</button></div>
        {bodyOrder(scene).map((part) => {
          const [kind, rawIndex] = part.split(":");
          const partIndex = Number(rawIndex);
          const label = kind === "action" ? `动作 ${partIndex + 1}` : `台词 ${partIndex + 1}`;
          const text = kind === "action" ? scene.character_actions[partIndex] : scene.dialogues[partIndex]?.text;
          return <div className={styles.actions} key={part}><span>{label} · {text?.slice(0, 40) || "待填写"}</span><button className={styles.secondary} type="button" disabled={disabled}
            aria-label={`删除场 ${scene.scene_number} 的${label}`} onClick={() => removePart(index, kind === "action" ? "action" : "dialogue", partIndex)}>删除</button></div>;
        })}
      </details>
    </section>)}
    <details className={styles.sceneDetails}><summary>增删场景</summary><p>场次数量应与已确认的创作安排一致。新增场景后请补充场景、动作和台词。</p>
      <button className={styles.secondary} type="button" disabled={disabled || draft.scenes.length >= 5} onClick={addScene}>添加场景</button>
      {draft.scenes.map((scene, index) => <div className={styles.actions} key={scene.scene_number}><span>场 {scene.scene_number} · {scene.scene_heading || scene.slug}</span>
        <button className={styles.secondary} type="button" disabled={disabled || draft.scenes.length <= 1} aria-label={`删除场 ${scene.scene_number}`} onClick={() => removeScene(index)}>删除场景</button></div>)}
    </details>
  </div>;
}
