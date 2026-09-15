"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Check, CheckCheck, ChevronDown, CircleAlert, Clapperboard, Clock3, Copy, Download, Eye, FileText, GitMerge, History, List, LoaderCircle, Lock, Pause, Pencil, Save, Scissors, Sparkles, TriangleAlert, Undo2, Unlock, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { WorkspaceSectionDirectory } from "@/components/workspace-section-directory";
import type { DocumentOutlineEntry } from "@/components/document-outline";
import { ConfirmationDialog, ToolButton } from "@/components/workspace-controls";
import { loadStoryboard, mergeStoryboardShot, moveStoryboardShot, sameStoryboardSource, splitStoryboardShot, storyboardEditError, storyboardMarkdown, writeStoryboard, type Storyboard, type StoryboardScene, type StoryboardShot } from "@/lib/storyboard";
import { orderedScreenplayBody } from "@/lib/screenplay-body-order";
import { parseGeneratedDraft } from "@/lib/generated-draft-parser";
import type { ScriptProject } from "@/lib/types";
import { useProjects } from "@/providers/project-provider";
import { BASE_PATH } from "@/lib/base-path";

export function StoryboardWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const { getProject, isReady, updateProject } = useProjects();
  const project = getProject(projectId);
  const [selection, setSelection] = useState<number | null>(null);
  if (!isReady) return <main className="centered-state" role="status"><LoaderCircle className="ui-spinner" size={20} />正在加载分镜...</main>;
  if (!project) return <main className="centered-state"><h1>项目不存在</h1><Link href="/">返回项目</Link></main>;
  const preferred = selection ?? project.activeEpisodeNumber;
  const episode = project.episodes.some(item => item.episodeNumber === preferred)
    ? preferred! : project.episodes[0]?.episodeNumber ?? 1;
  return <StoryboardEpisode key={projectId + ":" + episode} project={project} episode={episode} onEpisode={async value => {
    if (!await updateProject(projectId, { activeEpisodeNumber: value })) throw new Error("集数位置未保存，请重试切换。");
    setSelection(value);
  }} />;
}

function StoryboardEpisode({ project, episode, onEpisode }: {
  project: ScriptProject; episode: number; onEpisode: (value: number) => Promise<void>;
}) {
  const router = useRouter();
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [plan, setPlan] = useState<Storyboard | null>(null);
  const [saved, setSaved] = useState<Storyboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [instructions, setInstructions] = useState<Record<number, string>>({});
  const [instructionOpen, setInstructionOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [viewCandidate, setViewCandidate] = useState(false);
  const [historical, setHistorical] = useState<Storyboard | null>(null);
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [generationMode, setGenerationMode] = useState<"episode" | "scene" | null>(null);
  const [generatingScene, setGeneratingScene] = useState<number | null>(null);
  const [pauseRequested, setPauseRequested] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const active = useRef(true);
  const inFlight = useRef(false);
  const pause = useRef(false);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const sceneHeading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const dirty = useMemo(() => !!plan && !!saved && JSON.stringify(plan) !== JSON.stringify(saved), [plan, saved]);
  const item = project.episodes.find(value => value.episodeNumber === episode);
  const source = useMemo(() => parseGeneratedDraft(item?.workingDraftJson, {
    requireNonEmptyScenes: true, requireCompleteScenes: true, requireTitle: true,
  }), [item?.workingDraftJson]);
  const sourceChanged = useMemo(() => !!plan && !!source && !sameStoryboardSource(plan.source_draft, source), [plan?.source_draft, source]);
  const display = historical ?? plan;
  const displaySource = useMemo(() => historical
    ? parseGeneratedDraft(JSON.stringify(historical.source_draft), { requireCompleteScenes: true })
    : source, [historical, source]);
  const sceneNumbers = [...new Set([
    ...(displaySource?.scenes.map(scene => scene.scene_number) ?? []),
    ...(display?.scenes.map(scene => scene.scene_number) ?? []),
  ])].sort((a, b) => a - b);
  const sceneNumber = selected !== null && sceneNumbers.includes(selected) ? selected : sceneNumbers[0] ?? null;
  const instruction = sceneNumber === null ? "" : instructions[sceneNumber] ?? "";
  const candidate = plan?.candidate;
  const showingCandidate = viewCandidate && candidate?.scene_number === sceneNumber && !historical;
  const currentScene = display?.scenes.find(value => value.scene_number === sceneNumber);
  const scene = showingCandidate ? candidate : currentScene;
  const original = displaySource?.scenes.find(value => value.scene_number === sceneNumber);
  const sceneManifest = original?.content_manifest;
  const sceneCausality = original?.scene_causality;
  const sceneCharacters = [...new Set(sceneManifest?.character_refs?.length ? sceneManifest.character_refs
    : original?.character_refs?.length ? original.character_refs
      : original?.dialogues.map(dialogue => dialogue.chinese_character_name || dialogue.character_name) ?? [])];
  const sceneProps = [...new Set(sceneManifest?.props ?? [])];
  const stale = !!display?.stale_scene_numbers.includes(sceneNumber ?? 0);
  const readOnly = !!busy || !!historical || showingCandidate || stale;
  const shots = display?.scenes.flatMap(value => value.shots) ?? [];
  const duration = shots.reduce((total, shot) => total + shot.duration_seconds, 0);
  const remaining = source?.scenes.filter(s => !plan?.scenes.some(current => current.scene_number === s.scene_number)) ?? [];
  const hasLocks = !!scene?.shots.some(shot => shot.locked);
  const sceneEntries: DocumentOutlineEntry[] = sceneNumbers.map(number => {
    const current = display?.scenes.find(value => value.scene_number === number);
    const originalScene = displaySource?.scenes.find(value => value.scene_number === number);
    const isStale = display?.stale_scene_numbers.includes(number);
    const slug = (originalScene?.slug || "场 " + number)
      .replace(/^INT\/EXT\.\s*/i, "")
      .replace(/^(?:INT|EXT)\.\s*/i, "")
      .replace(/\s+(?:黎明|清晨|早晨|上午|中午|下午|傍晚|黄昏|夜晚|深夜|白天|日间|夜|日)$/i, "");
    return { id: "scene-" + number, label: String(number).padStart(2, "0") + " · " + slug, depth: 1,
      status: generatingScene === number ? "active" : isStale ? "failed" : current ? "completed" : "queued",
      meta: generatingScene === number ? "编排中" : isStale ? "来源变化" : current ? current.shots.length + " 镜" : "待编排" };
  });
  const entries: DocumentOutlineEntry[] = project.episodes.flatMap(value => {
    const episodeEntry: DocumentOutlineEntry = {
      id: "episode-" + value.episodeNumber,
      label: "第 " + value.episodeNumber + " 集",
      meta: value.episodeNumber === episode ? `${sceneNumbers.length} 场` : "打开查看",
      isCurrent: value.episodeNumber === episode,
      disabled: value.episodeNumber !== episode && (!!busy || dirty),
    };
    return value.episodeNumber === episode ? [episodeEntry, ...sceneEntries] : [episodeEntry];
  });

  function receive(next: Storyboard) {
    if (!active.current) return;
    setPlan(next); setSaved(next); setHistorical(null);
  }

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    loadStoryboard(project.id, episode).then(value => {
      if (!cancelled) { setPlan(value); setSaved(value); }
    }).catch(error => {
      if (!cancelled) {
        setLoadFailed(true);
        setNotice({ kind: "error", text: error instanceof Error ? error.message : "加载失败。" });
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; active.current = false; pause.current = true; };
  }, [project.id, episode]);

  useEffect(() => {
    if (!generationMode) return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [generationMode]);

  useEffect(() => {
    if (selected !== null) sceneHeading.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [selected]);

  useEffect(() => {
    if (notice?.kind === "error") feedback.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [notice]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const beforeLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.download || (link.target && link.target !== "_self")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname) return;
      event.preventDefault(); event.stopPropagation();
      if (busy) {
        setNotice({ kind: "error", text: "分镜正在处理，请等待本次操作完成后离开。整集编排可先暂停，已完成的场次会保留。" });
        return;
      }
      // Next's router adds basePath; browser anchor URLs already contain it.
      const pathname = BASE_PATH && (destination.pathname === BASE_PATH || destination.pathname.startsWith(`${BASE_PATH}/`))
        ? destination.pathname.slice(BASE_PATH.length) || "/"
        : destination.pathname;
      setPendingNavigation(pathname + destination.search + destination.hash);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLink, true);
    };
  }, [dirty, busy]);

  async function run(label: string, action: () => Promise<void>, generation: "episode" | "scene" | null = null) {
    if (inFlight.current) return;
    inFlight.current = true; pause.current = false;
    setBusy(label); setNotice(null); setGenerationMode(generation); setPauseRequested(false);
    try { await action(); }
    catch (error) { if (active.current) setNotice({ kind: "error", text: error instanceof Error ? error.message : "操作未完成，已保存分镜仍保留。" }); }
    finally {
      inFlight.current = false;
      if (active.current) { setBusy(""); setGenerationMode(null); setGeneratingScene(null); }
    }
  }

  function persist(next: Storyboard, candidateAction: "keep" | "accept" | "reject" = "keep") {
    const error = storyboardEditError(next);
    if (error) throw new Error(error);
    return writeStoryboard(project.id, episode, "PUT", {
      expected_revision: next.revision, visual_direction: next.visual_direction,
      scenes: next.scenes, candidate_action: candidateAction,
    });
  }

  async function arrangeAll() {
    if (!source || dirty || historical) return;
    await run("准备分镜", async () => {
      let next = await writeStoryboard(project.id, episode, "POST", { source_draft: source, expected_revision: plan?.revision ?? 0 });
      receive(next);
      for (const original of source!.scenes) {
        if (pause.current || !active.current || next.candidate) break;
        if (next.scenes.some(value => value.scene_number === original.scene_number)) continue;
        setGeneratingScene(original.scene_number); setBusy("正在编排场 " + original.scene_number);
        next = await writeStoryboard(project.id, episode, "POST", { expected_revision: next.revision, instruction: "" },
          "/scenes/" + original.scene_number + "/generate");
        receive(next);
      }
      if (pause.current && active.current) setNotice({ kind: "success", text: "本场已保存，编排已暂停。" });
    }, "episode");
  }

  async function generateScene() {
    if (!plan || sceneNumber === null || dirty || sourceChanged) return;
    await run("正在编排场 " + sceneNumber, async () => {
      setGeneratingScene(sceneNumber);
      const next = await writeStoryboard(project.id, episode, "POST", { expected_revision: plan.revision, instruction },
        "/scenes/" + sceneNumber + "/generate");
      receive(next); setViewCandidate(!!next.candidate); setInstructionOpen(false);
      if (next.candidate) setMode("read");
    }, "scene");
  }

  function editScene(transform: (value: StoryboardScene) => StoryboardScene) {
    if (!plan || readOnly) return;
    setPlan({ ...plan, scenes: plan.scenes.map(value => value.scene_number === sceneNumber ? transform(value) : value) });
  }

  async function toggleLock(id: string) {
    if (!plan || dirty || historical || showingCandidate) return;
    const next = { ...plan, scenes: plan.scenes.map(value => ({
      ...value, shots: value.shots.map(shot => shot.shot_id === id ? { ...shot, locked: !shot.locked } : shot),
    })) };
    await run("保存锁定状态", async () => receive(await persist(next)));
  }

  function download(format: "md" | "json") {
    const snapshot = historical ?? saved;
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([format === "md" ? storyboardMarkdown(snapshot) : JSON.stringify(snapshot, null, 2)],
      { type: format === "md" ? "text/markdown;charset=utf-8" : "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "episode-" + episode + "-storyboard-v" + snapshot.revision + "." + format;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (exportMenu.current) exportMenu.current.open = false;
  }

  async function copyPrompt(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice({ kind: "success", text: "视频描述已复制。" }); }
    catch { setNotice({ kind: "error", text: "复制未完成，请从描述中选择文字复制。" }); }
  }

  async function showRevision(value: string) {
    if (!plan || dirty) return;
    if (!value) { setHistorical(null); return; }
    await run("加载历史版本", async () => {
      const previous = await loadStoryboard(project.id, episode, Number(value));
      if (!previous) throw new Error("未找到该历史版本。");
      if (active.current) { setHistorical(previous); setViewCandidate(false); setMode("read"); }
    });
  }

  const generationDisabled = !!busy || dirty || !!candidate || sourceChanged || hasLocks || !original;
  return <main className="storyboard-page">
    <ConfirmationDialog open={pendingNavigation !== null} title="离开分镜？" confirmLabel="放弃修改并离开" cancelLabel="继续编辑"
      onClose={() => setPendingNavigation(null)} onConfirm={() => {
        if (!pendingNavigation) return;
        const destination = pendingNavigation;
        setPlan(saved); setPendingNavigation(null); router.push(destination);
      }}>
      <p>当前分镜有未保存的修改。</p>
    </ConfirmationDialog>
    <div className="episode-workspace-layout">
      <WorkspaceSectionDirectory activeSection="storyboard"
        activeEntryId={selected === null ? "episode-" + episode : "scene-" + sceneNumber}
        currentEntries={entries} projectId={project.id} onSelect={entry => {
          if (entry.id.startsWith("episode-")) {
            const nextEpisode = Number(entry.id.slice("episode-".length));
            if (nextEpisode !== episode) {
              void run("切换集数", () => onEpisode(nextEpisode));
              return;
            }
            setSelected(null);
          } else {
            setSelected(Number(entry.id.slice("scene-".length)));
          }
          setViewCandidate(false); setInstructionOpen(false);
        }} />
      <section className="storyboard-content" aria-label="分镜工作区">
        <header className="storyboard-header">
          <div className="storyboard-title"><span className="library-kicker">{project.title}</span><h1>分镜</h1></div>
          <div className="storyboard-header-actions">
            <Link className="storyboard-back-link" href={"/projects/" + project.id + "/workspace"}><ArrowLeft size={14} />正文</Link>
            <details ref={exportMenu} className="storyboard-export" onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
            }} onKeyDown={event => { if (event.key === "Escape") event.currentTarget.open = false; }}>
              <summary className="outline-action"><Download size={15} />导出<ChevronDown size={13} /></summary>
              <div className="storyboard-export-options">
                <button disabled={!saved || dirty || !!busy || (!historical && sourceChanged)} onClick={() => download("md")}><FileText size={15} />Markdown 草稿</button>
                <button disabled={!saved || dirty || !!busy || (!historical && sourceChanged)} onClick={() => download("json")}><Download size={15} />JSON 草稿</button>
              </div>
            </details>
          </div>
        </header>
        {notice && <div ref={feedback} role={notice.kind === "error" ? "alert" : "status"} className={"workspace-feedback is-" + notice.kind}>
          {notice.kind === "error" ? <CircleAlert size={17} /> : <Check size={17} />}<span>{notice.text}</span>
          {notice.kind === "error" && <button className="text-button" disabled={!!busy || dirty}
            onClick={() => void run("重新加载", async () => {
              const latest = await loadStoryboard(project.id, episode);
              setPlan(latest); setSaved(latest); setHistorical(null); setLoadFailed(false);
            })}>重新加载</button>}
          {!loadFailed && <ToolButton label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></ToolButton>}
        </div>}
        {loading ? <div className="storyboard-loading" role="status"><LoaderCircle className="ui-spinner" size={20} /><span>正在加载分镜...</span></div>
          : loadFailed ? <div className="storyboard-empty"><CircleAlert size={32} /><h2>分镜暂未加载</h2></div>
          : !source ? <div className="storyboard-empty"><FileText size={32} /><h2>本集暂无完整正文</h2>
            <Link className="outline-action" href={"/projects/" + project.id + "/workspace"}><ArrowLeft size={15} />返回正文</Link>
          </div> : !plan ? <div className="storyboard-empty"><Clapperboard size={34} /><h2>{source.title}</h2>
            <p>第 {episode} 集 · {source.scenes.length} 场 · 待编排</p>
            <button className="primary-action" disabled={!!busy} onClick={() => void arrangeAll()}><Sparkles size={16} />编排本集分镜</button>
          </div> : <>
          <div className="storyboard-toolbar">
            <div className="storyboard-view-control" role="group" aria-label="分镜视图">
              <button aria-pressed={mode === "read"} onClick={() => setMode("read")}><Eye size={15} />阅读</button>
              <button aria-pressed={mode === "edit"} disabled={!!historical || showingCandidate} onClick={() => setMode("edit")}><Pencil size={15} />编辑</button>
            </div>
            <div className={"storyboard-save-state" + (dirty ? " is-dirty" : "")} role="status">
              {busy && !generationMode ? <LoaderCircle className="ui-spinner" size={14} /> : dirty ? <span className="unsaved-dot" /> : <CheckCheck size={15} />}
              <span>{historical ? "历史版本" : busy && !generationMode ? busy : dirty ? "未保存" : "已保存"}</span>
            </div>
            <div className="storyboard-toolbar-actions">
              <label className="storyboard-version"><History aria-hidden="true" size={14} />
                <select aria-label="分镜版本" disabled={!!busy || dirty} value={historical?.revision ?? ""} onChange={event => void showRevision(event.target.value)}>
                  <option value="">当前 v{plan.revision}</option>
                  {Array.from({ length: Math.min(plan.revision - 1, 200) }, (_, index) => plan.revision - index - 1).map(revision =>
                    <option value={revision} key={revision}>v{revision}</option>)}
                </select>
              </label>
              <ToolButton label="撤销未保存修改" disabled={!dirty || !!busy} onClick={() => setPlan(saved)}><Undo2 size={16} /></ToolButton>
              <button className="primary-action" disabled={!dirty || !!busy || !!historical} onClick={() => void run("保存修订", async () => receive(await persist(plan)))}>
                <Save size={15} />保存
              </button>
            </div>
          </div>
          <div className="storyboard-overview">
            <span><Clapperboard size={16} /><strong>{display?.scenes.length}</strong> / {displaySource?.scenes.length ?? 0} 场</span>
            <span><strong>{shots.length}</strong> 镜</span><span><Clock3 size={15} />{formatDuration(duration)}</span>
            {!!remaining.length && !historical && <button className="outline-action" disabled={!!busy || dirty || !!candidate || sourceChanged}
              onClick={() => void arrangeAll()}><Sparkles size={14} />继续编排 · {remaining.length} 场</button>}
          </div>
          {generationMode && <div className="storyboard-generation">
            <div><LoaderCircle className="ui-spinner" size={18} /><span role="status">{pauseRequested ? "本场完成后暂停" : busy}</span>
              <span className="storyboard-elapsed">{formatDuration(elapsed)}</span>
              {generationMode === "episode" && <button className="outline-action" disabled={pauseRequested}
                onClick={() => { pause.current = true; setPauseRequested(true); }}><Pause size={14} />暂停</button>}
            </div>
            <progress aria-label="分镜编排进度" value={generationMode === "episode" ? plan.scenes.length : undefined} max={source.scenes.length} />
          </div>}
          {sourceChanged && !historical && <div role="status" className="workspace-feedback is-warning"><TriangleAlert size={17} />
            <span>正文已更新，分镜仍绑定旧稿。</span>
            <button className="outline-action" disabled={!!busy || dirty} onClick={() => void run("更新正文来源", async () =>
              receive(await writeStoryboard(project.id, episode, "POST", { source_draft: source, expected_revision: plan.revision })))}>
              更新来源
            </button>
          </div>}
          {historical && <div className="workspace-feedback"><History size={16} /><span>正在查看 v{historical.revision}</span>
            <button className="text-button" onClick={() => setHistorical(null)}>返回当前版本</button></div>}
          <details className="storyboard-visual"><summary><Eye size={15} />本集视觉方向<span>{display?.visual_direction ? "已设定" : "待设定"}</span></summary>
            {mode === "edit" && !historical ? <Field label="视觉方向" value={plan.visual_direction}
              disabled={!!busy || plan.scenes.some(s => s.shots.some(shot => shot.locked))}
              onChange={value => setPlan({ ...plan, visual_direction: value })} />
              : <p className="storyboard-read-copy">{display?.visual_direction || "尚未设定"}</p>}
          </details>
          {candidate && !historical && <div className="storyboard-candidate">
            <div><Sparkles size={17} /><strong>场 {candidate.scene_number} · 新候选</strong><span>{candidate.shots.length} 镜</span></div>
            <div className="storyboard-candidate-actions">
              <div className="storyboard-view-control" role="group" aria-label="分镜版本比较">
                <button aria-pressed={!showingCandidate} onClick={() => { setSelected(candidate.scene_number); setViewCandidate(false); }}>当前</button>
                <button aria-pressed={showingCandidate} onClick={() => { setSelected(candidate.scene_number); setViewCandidate(true); setMode("read"); }}>候选</button>
              </div>
              <button disabled={!!busy || dirty || sourceChanged} className="primary-action" onClick={() => void run("采用候选", async () => {
                receive(await persist(plan, "accept")); setViewCandidate(false);
              })}><Check size={15} />采用</button>
              <button disabled={!!busy || dirty} className="outline-action" onClick={() => void run("放弃候选", async () => {
                receive(await persist(plan, "reject")); setViewCandidate(false);
              })}>放弃</button>
            </div>
          </div>}
          {sceneNumber !== null && <div className="storyboard-detail">
            <div className="storyboard-scene-heading">
              <div><span className="library-kicker">场 {String(sceneNumber).padStart(2, "0")}{showingCandidate ? " · 候选" : ""}</span>
                <h2 ref={sceneHeading}>{original?.scene_heading || original?.slug || "场 " + sceneNumber}</h2></div>
              {!historical && (scene ? <button className="outline-action" aria-expanded={instructionOpen}
                disabled={!!busy || !!candidate} onClick={() => setInstructionOpen(value => !value)}><Sparkles size={15} />调整本场</button>
                : <button className="primary-action" disabled={generationDisabled} onClick={() => void generateScene()}><Sparkles size={15} />编排本场</button>)}
            </div>
            {stale && !showingCandidate && <div className="workspace-feedback is-warning"><TriangleAlert size={17} />
              <span>来源已变化 · 旧镜头保留于正文快照 v{scene?.source_revision}</span>
              {!original && <button className="outline-action" disabled={!!busy || dirty || hasLocks}
                onClick={() => void run("移除旧场景", async () => receive(await persist({ ...plan, scenes: plan.scenes.filter(s => s.scene_number !== sceneNumber) })))}>
                移除旧场景
              </button>}
            </div>}
            {instructionOpen && !historical && <div className="storyboard-instruction">
              <Field label="本场修改要求" value={instruction} disabled={!!busy || !!candidate}
                onChange={value => setInstructions(current => ({ ...current, [sceneNumber]: value }))} />
              <div>{hasLocks ? <span><Lock size={13} />本场含已锁定镜头</span> : <span />}
                <button className="primary-action" disabled={generationDisabled} onClick={() => void generateScene()}><Sparkles size={15} />生成候选</button></div>
            </div>}
            {scene && <>
              <p className="storyboard-purpose">{scene.design.purpose}</p>
              <details className="storyboard-scene-brief">
                <summary><List size={15} />执行摘要<span>正文事实与制作输入</span></summary>
                <div className="storyboard-scene-brief-grid">
                  <BriefField label="地点" value={sceneManifest?.location || original?.setting_hint || original?.slug} />
                  <BriefField label="时段" value={sceneManifest?.time_of_day || "正文未明确"} />
                  <BriefField label="人物" value={sceneCharacters.join("、") || "正文未明确"} />
                  <BriefField label="道具 / 素材候选" value={sceneProps.join("、") || "正文未明确"} />
                  <BriefField label="场景目标" value={sceneManifest?.objective || sceneCausality?.goal || original?.purpose} />
                  <BriefField label="冲突 / 阻力" value={sceneManifest?.conflict || sceneCausality?.conflict || "正文未明确"} />
                  <BriefField label="关键转折" value={sceneManifest?.turning_point || original?.turning_point || "正文未明确"} />
                  <BriefField label="场景结果" value={sceneManifest?.outcome || sceneCausality?.outcome || "正文未明确"} />
                  <BriefField label="进入状态" value={sceneManifest?.entry_state || "正文未明确"} />
                  <BriefField label="退出状态" value={sceneManifest?.exit_state || "正文未明确"} />
                </div>
              </details>
              <details className="storyboard-scene-design"><summary><FileText size={15} />场景设计</summary>
                <div className="storyboard-design-grid">
                  {(["spatial_layout", "reveal_order", "action_rhythm", "transition"] as const).map((key, i) => mode === "edit" && !readOnly
                    ? <Field key={key} label={["空间布局", "信息揭示", "动作节拍", "转场"][i]} value={scene.design[key]}
                      onChange={value => editScene(current => ({ ...current, design: { ...current.design, [key]: value } }))} />
                    : <div key={key}><span>{["空间布局", "信息揭示", "动作节拍", "转场"][i]}</span><p>{scene.design[key]}</p></div>)}
                </div>
                {mode === "edit" && !readOnly && <Field label="待确认事项" value={scene.unresolved_questions.join("\n")}
                  onChange={value => editScene(current => ({ ...current, unresolved_questions: value.split("\n").filter(Boolean) }))} />}
              </details>
              {!!scene.unresolved_questions.length && <div className="storyboard-scene-questions" role="note" aria-label="本场待确认事项">
                <span className="storyboard-field-label"><TriangleAlert size={14} />本场待确认事项</span>
                <ul>{scene.unresolved_questions.map((question, index) => <li key={index}>{question}</li>)}</ul>
              </div>}
              <div className="storyboard-shot-list">{scene.shots.map((shot, index) => <ShotCard key={shot.shot_id} scene={scene} index={index}
                editing={mode === "edit" && !showingCandidate && !historical} readOnly={readOnly}
                lockDisabled={!!busy || dirty || !!historical || showingCandidate} dirty={dirty}
                onLock={() => void toggleLock(shot.shot_id)} onTransform={editScene}
                onEdit={patch => editScene(current => ({ ...current, shots: current.shots.map(value => value.shot_id === shot.shot_id && !value.locked ? { ...value, ...patch } : value) }))}
                onCopy={() => void copyPrompt(shot.prompt)} />)}</div>
            </>}
            {!scene && <div className="storyboard-scene-empty"><Clapperboard size={24} /><span>本场待编排</span></div>}
            <details className="storyboard-source"><summary><FileText size={15} />{historical ? "本版本正文快照" : "当前正文"}</summary>
              {original && orderedScreenplayBody(original).map((part, index) => <p key={index} className={part.kind === "dialogue" ? "is-dialogue" : ""}>
                {part.kind === "action" ? part.action : part.dialogue.character_name + ": " + part.dialogue.text}
              </p>)}
            </details>
          </div>}
          <details className="storyboard-footer" open={!!display?.findings.some(finding => finding.severity === "error")}>
            <summary><TriangleAlert size={16} />检查<span>{display?.findings.length ?? 0} 项待处理</span></summary>
            {!display?.findings.length && <p><CheckCheck size={15} />正文引用检查通过，创作内容待审阅。</p>}
            <ul>{display?.findings.map((finding, index) => <li key={index} className={"finding-" + finding.severity}>
              {finding.scene_number && <button onClick={() => { setSelected(finding.scene_number!); setViewCandidate(false); }}>场 {finding.scene_number}</button>}
              <span>{finding.message}</span>
            </li>)}</ul>
          </details>
        </>}
      </section>
    </div>
  </main>;
}

function ShotCard({ scene, index, editing, readOnly, lockDisabled, dirty, onLock, onTransform, onEdit, onCopy }: {
  scene: StoryboardScene; index: number; editing: boolean; readOnly: boolean; lockDisabled: boolean; dirty: boolean;
  onLock: () => void; onTransform: (transform: (scene: StoryboardScene) => StoryboardScene) => void;
  onEdit: (patch: Partial<StoryboardShot>) => void; onCopy: () => void;
}) {
  const shot = scene.shots[index];
  const durationErrorId = useId();
  const durationInvalid = !Number.isFinite(shot.duration_seconds) || shot.duration_seconds <= 0 || shot.duration_seconds > 600;
  const disabled = readOnly || shot.locked;
  const lockedAfter = scene.shots.slice(index + 1).some(value => value.locked);
  return <article className={"storyboard-shot" + (shot.locked ? " is-locked" : "")} aria-label={"镜 " + scene.scene_number + "-" + (index + 1)}>
    <header>
      <span className="storyboard-shot-number">{String(index + 1).padStart(2, "0")}</span>
      <div className="storyboard-shot-heading"><strong>{shot.purpose}</strong><span>{shot.framing}</span></div>
      <span className="storyboard-shot-duration"><Clock3 size={13} />{formatDuration(shot.duration_seconds)}</span>
      {shot.locked && <span className="storyboard-lock-label"><Lock size={12} />已锁定</span>}
    </header>
    {editing && <div className="storyboard-shot-tools">
      <ToolButton label={shot.locked ? "解锁镜头" : "锁定镜头"} disabled={lockDisabled} onClick={onLock}>{shot.locked ? <Lock size={15} /> : <Unlock size={15} />}</ToolButton>
      <span className="storyboard-tool-divider" />
      <ToolButton label="上移镜头" disabled={disabled || !index || scene.shots[index - 1]?.locked}
        onClick={() => onTransform(current => moveStoryboardShot(current, index, -1))}><ArrowUp size={15} /></ToolButton>
      <ToolButton label="下移镜头" disabled={disabled || index === scene.shots.length - 1 || scene.shots[index + 1]?.locked}
        onClick={() => onTransform(current => moveStoryboardShot(current, index, 1))}><ArrowDown size={15} /></ToolButton>
      <ToolButton label="拆分镜头" disabled={disabled || lockedAfter || shot.source_refs.length < 2 || shot.duration_seconds < 1 || scene.shots.length >= 100}
        onClick={() => onTransform(current => splitStoryboardShot(current, index, "shot." + crypto.randomUUID()))}><Scissors size={15} /></ToolButton>
      <ToolButton label="合并下一镜" disabled={disabled || lockedAfter || index === scene.shots.length - 1
        || shot.duration_seconds + (scene.shots[index + 1]?.duration_seconds ?? 0) > 600
        || shot.source_refs.length + (scene.shots[index + 1]?.source_refs.length ?? 0) > 60
        || shot.action_sequence.length + (scene.shots[index + 1]?.action_sequence.length ?? 0) > 30}
        onClick={() => onTransform(current => mergeStoryboardShot(current, index))}><GitMerge size={15} /></ToolButton>
    </div>}
    <div className="storyboard-shot-body">
      {editing ? <Field label="画面动作" value={shot.action_sequence.join("\n")} disabled={disabled}
        onChange={value => onEdit({ action_sequence: value.split("\n") })} />
        : <div className="storyboard-action-copy"><span className="storyboard-field-label">画面</span><ol>{shot.action_sequence.map((action, i) => <li key={i}>{action}</li>)}</ol></div>}
      {!!shot.dialogue.length && <div className="storyboard-dialogue"><span className="storyboard-field-label">对白</span>{shot.dialogue.map((text, i) => <p key={i}>{text}</p>)}</div>}
      <details className="storyboard-shot-details"><summary><ChevronDown size={14} />摄影与连续性</summary>
        <div className="storyboard-shot-fields">
          {editing ? <>
            <label>预计时长（秒）<input type="number" min={0.1} max={600} step={0.1} disabled={disabled}
              aria-invalid={durationInvalid} aria-describedby={durationInvalid ? durationErrorId : undefined}
              value={shot.duration_seconds} onChange={event => onEdit({ duration_seconds: Number(event.target.value) })} /></label>
            {durationInvalid && <p id={durationErrorId} className="storyboard-field-error">时长须大于 0 且不超过 600 秒。</p>}
            <Field label="景别" value={shot.framing} disabled={disabled} onChange={value => onEdit({ framing: value })} />
            {(["purpose", "camera", "sound", "continuity_in", "continuity_out"] as const).map((key, i) => <Field key={key}
              label={["镜头作用", "机位与运镜", "声音", "起始状态", "结束状态"][i]} value={shot[key]} disabled={disabled}
              onChange={value => onEdit({ [key]: value })} />)}
          </> : (["camera", "sound", "continuity_in", "continuity_out"] as const).map((key, i) => <div key={key}>
            <span className="storyboard-field-label">{["机位与运镜", "声音", "起始状态", "结束状态"][i]}</span><p>{shot[key] || "未设定"}</p>
          </div>)}
        </div>
        <p className="storyboard-source-id">{shot.shot_id} · 正文快照 v{scene.source_revision} · {shot.source_refs.join(", ")}</p>
      </details>
      <details className="storyboard-prompt"><summary><FileText size={14} />视频描述<span>{dirty ? "保存后更新" : ""}</span></summary>
        <div className="storyboard-prompt-actions"><ToolButton label="复制视频描述" disabled={dirty} onClick={onCopy}><Copy size={15} /></ToolButton></div>
        <pre>{shot.prompt}</pre>
      </details>
    </div>
  </article>;
}

function Field({ label, value, disabled, onChange }: {
  label: string; value: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  return <label className="storyboard-field"><span>{label}</span><textarea aria-label={label} rows={3} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /></label>;
}

function BriefField({ label, value }: { label: string; value?: string | null }) {
  return <div><span>{label}</span><p>{value || "正文未明确"}</p></div>;
}

function formatDuration(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  if (tenths < 600) return tenths / 10 + " 秒";
  return Math.floor(tenths / 600) + " 分 " + (tenths % 600) / 10 + " 秒";
}
