"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PlusIcon, ScriptIcon, SearchIcon, TrashIcon } from "@/components/icons";
import { ProjectDeleteButton } from "@/components/project-delete-button";
import { ProjectMenuLoadState } from "@/components/project-menu-load-state";
import { LanguageToggle } from "@/components/language-toggle";
import { HostReturnLink } from "@/components/host-return-link";
import { formatRelativeTime } from "@/lib/format";
import { projectTagLabel } from "@/lib/tag-catalog";
import { currentWorkspaceHref, workspaceSectionAccess, workspaceSectionHref, type WorkspaceSectionId } from "@/lib/workspace-stage";
import type { ScriptProject } from "@/lib/types";
import { hostProjectId } from "@/lib/host-session";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

interface ProjectSidebarProps {
  hostHref?: string;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: () => void;
}

export function ProjectSidebar({ hostHref, isOpen, onClose, onNavigate }: ProjectSidebarProps) {
  const pathname = usePathname();
  const { projects, isReady, serverPersistenceAvailable, storageError } = useProjects();
  const { locale, t } = useLocale();
  const sidebar = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [search, setSearch] = useState("");
  const scopedId = hostProjectId();
  const scopedProject = projects.find(project => project.id === scopedId);
  const visibleProjects = projects.filter((project) => project.title.toLowerCase().includes(search.trim().toLowerCase()));
  const projectListLoaded = isReady && serverPersistenceAvailable === true && !storageError;

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (window.matchMedia("(max-width: 900px)").matches) {
      sidebar.current?.querySelector<HTMLInputElement>("input")?.focus();
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) onCloseRef.current();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <button
        aria-label={t("nav.close")}
        aria-hidden={!isOpen}
        inert={!isOpen}
        className={`sidebar-scrim ${isOpen ? "is-visible" : ""}`}
        onClick={onClose}
        type="button"
      />
      <aside ref={sidebar} id="project-navigation" aria-label={t("nav.projects")} aria-hidden={!isOpen} inert={!isOpen} className={`project-sidebar ${isOpen ? "is-open" : ""}`}>
        {hostHref && <div className="sidebar-host-return"><HostReturnLink href={hostHref} detail /><p>新标签页打开，当前创作继续保留</p></div>}
        <div className="sidebar-module-head">
          <span className="sidebar-module-icon"><ScriptIcon /></span>
          <span>
            <strong>{scopedId ? "网剧创作" : t("nav.scriptMaster")}</strong>
            <small>{scopedId ? "当前项目 · 完整创作流程" : t("nav.scriptWorkspace")}</small>
          </span>
          <button aria-label={t("nav.close")} className="sidebar-close-button" onClick={onClose} type="button"><X aria-hidden="true" size={16} /></button>
        </div>

        {scopedId ? <ProjectSteps project={scopedProject} onNavigate={onNavigate} /> : <><Link className="new-script-button" href="/projects/new" onClick={onNavigate}>
          <PlusIcon />
          <span>{t("nav.create")}</span>
        </Link>

        <div className="sidebar-section-heading">
          <span>{t("nav.myScripts")}</span>
          <span>{projects.length.toString().padStart(2, "0")}</span>
        </div>

        <label className="sidebar-search">
          <SearchIcon />
          <input aria-label={t("nav.search")} onChange={(event) => setSearch(event.target.value)} placeholder={t("nav.search")} value={search} />
        </label>

        <nav aria-label={t("nav.projects")} className="project-history">
          <ProjectMenuLoadState />
          {visibleProjects.length === 0 ? (
            projectListLoaded ? <div className="sidebar-empty">{projects.length ? t("nav.noMatches") : t("nav.empty")}</div> : null
          ) : (
            visibleProjects.map((project) => {
              const primaryTag = projectTagLabel(project, project.selectedTagIds[0] ?? "", locale);
              const active = pathname.includes(project.id);
              const projectHref = currentWorkspaceHref(project);
              return (
                <div className={`project-history-row ${active ? "is-active" : ""}`} key={project.id}>
                  <Link aria-current={active ? "page" : undefined} className="project-history-item" href={projectHref} onClick={onNavigate}>
                    <span className="project-history-icon"><ScriptIcon /></span>
                    <span className="project-history-copy">
                      <strong>{project.title}</strong>
                      <small>{primaryTag ?? t("nav.storyIdea")} · {t("library.progress")} {project.episodes.filter(episode => ["saved", "confirmed", "final"].includes(episode.status)).length} {t("workspace.episodes")} · {formatRelativeTime(project.updatedAt, locale)}</small>
                    </span>
                    <span className={`status-dot status-${project.status}`} />
                  </Link>
                  <ProjectDeleteButton projectId={project.id} title={project.title}
                    className="project-delete-button" onDeleted={onClose}><TrashIcon /></ProjectDeleteButton>
                </div>
              );
            })
          )}
        </nav></>}

        <div className="sidebar-footer">
          {!scopedId && <Link className="sidebar-library-link" href="/" onClick={onNavigate}>{t("nav.projectLibrary")}</Link>}
          <LanguageToggle />
          <div className="local-mode-badge">
            <span className="local-mode-dot" />
            <span>
              <strong>{serverPersistenceAvailable ? t("nav.cloudWorkspace") : t("nav.localWorkspace")}</strong>
              <small>{serverPersistenceAvailable === true
                ? t("nav.syncedServer")
                : serverPersistenceAvailable === false
                  ? t("nav.syncUnavailable")
                  : t("nav.savedBrowser")}</small>
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}

export function ProjectSteps({ project, onNavigate }: { project?: ScriptProject; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <nav className="project-history" aria-label="当前网剧创作步骤">
          {project && ([
            ["story-synopsis", "故事梗概", workspaceSectionAccess(project).storySynopsis],
            ["story-bible", "故事总纲", workspaceSectionAccess(project).storyBible],
            ["planning", "全剧规划", workspaceSectionAccess(project).planning],
            ["script", "分集正文", workspaceSectionAccess(project).script],
            ["storyboard", "分镜", workspaceSectionAccess(project).storyboard],
          ] as [WorkspaceSectionId, string, boolean][]).map(([section, label, available], index) => {
            const href = workspaceSectionHref(project, section);
            return available ? <Link key={section} className="project-history-item" href={href} onClick={onNavigate} aria-current={pathname === href ? "page" : undefined}>
              <span className="project-history-icon">0{index + 1}</span><strong>{label}</strong>
            </Link> : <div key={section} className="project-history-item" aria-disabled="true" title="完成前一步并确认后开放">
              <span className="project-history-icon">0{index + 1}</span><span>{label} · 待解锁</span>
            </div>;
          })}
        </nav>;
}
