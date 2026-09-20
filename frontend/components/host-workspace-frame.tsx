"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Check, Cloud, CloudOff, List, LoaderCircle, PanelLeftClose, RefreshCw, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BackgroundGenerationStatus } from "@/components/background-generation-status";
import { HostWorkspaceContext } from "@/components/host-workspace-context";
import { HostScriptStages } from "@/components/host-script-stages";
import { WorkspaceSectionDirectory } from "@/components/workspace-section-directory";
import { hostDeliveryConfigured } from "@/lib/host-delivery";
import { useHostScriptWorkflow } from "@/lib/use-host-script-workflow";
import { resolveSavedDraft } from "@/lib/script-draft-state";
import type { ScriptProject } from "@/lib/types";
import type { WorkspaceSectionId } from "@/lib/workspace-stage";
import { useProjects } from "@/providers/project-provider";
import { canStartQuickScript, isQuickScriptProject, quickScriptHref } from "@/lib/quick-script-project";

export function HostWorkspaceFrame({ children, project, onImport }: {
  children: ReactNode;
  project: ScriptProject;
  onImport: () => void;
}) {
  const pathname = usePathname();
  const scriptWorkflow = useHostScriptWorkflow();
  const [directoryTarget, setDirectoryTarget] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const sidebar = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const { retryProjectSync } = useProjects();
  const section: WorkspaceSectionId = pathname.endsWith("/synopsis") ? "story-synopsis"
    : pathname.endsWith("/planning/structure") ? "planning"
    : pathname.endsWith("/workspace") ? "script"
    : pathname.endsWith("/storyboard") ? "storyboard" : "story-bible";
  const inputPage = pathname === `/projects/${project.id}`;
  const integrated = scriptWorkflow === true;
  const quick = integrated && isQuickScriptProject(project);
  const directoryLabel = section === "script" || section === "planning" ? "剧集目录" : "内容目录";
  const drawer = integrated || narrow;
  const savedEpisodeCount = project.episodes.filter(episode => episode.episodeNumber <= project.generationSettings.episodeCount
    && Boolean(resolveSavedDraft(episode))).length;
  const canDeliver = integrated && section === "script" && savedEpisodeCount > 0;
  const stageLabel = inputPage ? "故事输入" : ({ "story-synopsis": "故事梗概", "story-bible": "故事总纲", planning: "全剧规划", script: "分集正文", storyboard: "分镜" })[section];
  const sync = project.serverSync?.status;
  const saving = retrying || sync === "syncing";
  const syncLabel = saving ? "正在保存" : sync === "synced" ? "草稿已保存"
    : sync === "conflict" ? "版本冲突，请先处理" : "已保存版本仅在本机";

  useEffect(() => { if (sync === "synced") setRetryError(""); }, [sync]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const change = () => { setNarrow(media.matches); setOpen(scriptWorkflow === false && !media.matches); };
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [scriptWorkflow]);

  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
    if (integrated || window.matchMedia("(max-width: 760px)").matches) setOpen(false);
  }, [pathname, integrated]);

  useEffect(() => {
    if (!open || !drawer) return;
    const panel = sidebar.current;
    panel?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); toggle.current?.focus(); }
      if (event.key !== "Tab") return;
      const items = Array.from(panel?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? []).filter(el => el.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [open, drawer]);

  async function retry() {
    setRetrying(true); setRetryError("");
    try {
      const result = await retryProjectSync(project.id);
      if (result?.status !== "synced") setRetryError("暂未同步成功，已保存的本地稿仍保留。请稍后重试。");
    } catch { setRetryError("暂未同步成功，已保存的本地稿仍保留。请稍后重试。"); }
    finally { setRetrying(false); }
  }

  return <HostWorkspaceContext.Provider value={directoryTarget}>
    <section className={`host-workspace-frame${open ? " is-directory-open" : ""}${integrated ? " is-three-stage" : ""}`} aria-label="剧本创作工作区">
      {integrated && <HostScriptStages project={project} section={section} inputPage={inputPage} />}
      <header className="host-workspace-toolbar">
        {!quick && <button className="host-directory-toggle" ref={toggle} type="button" aria-controls="host-workflow-directory" aria-expanded={open}
          aria-label={`${open ? "收起" : "展开"}${integrated ? directoryLabel : "流程目录"}`} title={integrated ? directoryLabel : "流程目录"} onClick={() => setOpen(value => !value)}>
          {open ? <PanelLeftClose size={17} /> : <List size={17} />}<span>{integrated ? directoryLabel : "流程目录"}</span>
        </button>}
        {!integrated && <span className="host-current-stage">{stageLabel}</span>}
        <div className="host-workspace-status" role="status" title="这里显示草稿保存到项目的状态，仅代表最近保存的版本。手动编辑后请先保存；同步到制作需另行确认。">
          {saving ? <LoaderCircle className="host-save-spinner" size={14} /> : sync === "synced" ? <Check size={14} /> : sync === "conflict" ? <CloudOff size={14} /> : <Cloud size={14} />}
          <span>{syncLabel}</span>
          {!saving && (sync === "unavailable" || sync === "local_only") && <button type="button" onClick={() => void retry()} aria-label="重试保存到服务端" title="重试保存到服务端"><RefreshCw size={14} /></button>}
        </div>
        <BackgroundGenerationStatus />
        {integrated && !quick && canStartQuickScript(project)
          && <Link className="outline-action" href={quickScriptHref(project.id)}>快速创作</Link>}
        {hostDeliveryConfigured() && (canDeliver || scriptWorkflow === false) && <button className={`${canDeliver ? "primary-action" : "outline-action"} host-sync-action`} type="button" onClick={onImport} title={canDeliver ? `选择 ${savedEpisodeCount} 集已保存正文的制作版本，然后进入资产设计` : "选择已完成的内容，同步到当前项目的制作稿、资产和分镜"}>{canDeliver ? "下一步：资产设计" : "同步到制作"}</button>}
      </header>
      {retryError && <p className="host-save-error" role="alert">{retryError}</p>}
      <div className="host-workspace-body" onClick={event => {
        // Portals bubble through the page's React tree, not the slot's DOM ancestors.
        const target = event.target instanceof Element ? event.target : null;
        if (drawer && !event.defaultPrevented && target && sidebar.current?.contains(target)
          && target.closest('a[href], .workspace-section-directory-children button')) {
          setOpen(false); toggle.current?.focus();
        }
      }}>
        {open && drawer && <button className="host-directory-scrim" tabIndex={-1} aria-label={`关闭${integrated ? directoryLabel : "流程目录"}`} onClick={() => { setOpen(false); toggle.current?.focus(); }} />}
        <aside ref={sidebar} id="host-workflow-directory" className="host-workflow-rail" aria-label={integrated ? directoryLabel : "剧本流程目录"} hidden={!open}
          role={drawer ? "dialog" : undefined} aria-modal={drawer && open ? true : undefined}>
          <div className="host-directory-heading"><strong>{integrated ? directoryLabel : "创作流程"}</strong><button type="button" aria-label={`收起${integrated ? directoryLabel : "流程目录"}`} onClick={() => { setOpen(false); toggle.current?.focus(); }}><X size={15} /></button></div>
          <div className="host-workflow-slot" ref={setDirectoryTarget}>
            <div className="host-workflow-fallback"><WorkspaceSectionDirectory activeSection={section} currentEntries={[]} onSelect={() => undefined} projectId={project.id} inline /></div>
          </div>
          {!integrated && <p className="host-directory-note">按步骤确认，完成后同步到制作。<br />已完成的内容可随时回看。</p>}
        </aside>
        <div className="host-workspace-content" ref={content} inert={drawer && open}>{children}</div>
      </div>
    </section>
  </HostWorkspaceContext.Provider>;
}
