"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PlusIcon, ScriptIcon, SearchIcon, TrashIcon } from "@/components/icons";
import { ProjectDeleteButton } from "@/components/project-delete-button";
import { ProjectMenuLoadState } from "@/components/project-menu-load-state";
import { LanguageToggle } from "@/components/language-toggle";
import { formatRelativeTime } from "@/lib/format";
import { projectTagLabel } from "@/lib/tag-catalog";
import { currentWorkspaceHref } from "@/lib/workspace-stage";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

interface ProjectSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectSidebar({ isOpen, onClose }: ProjectSidebarProps) {
  const pathname = usePathname();
  const { projects, isReady, serverPersistenceAvailable, storageError } = useProjects();
  const { locale, t } = useLocale();
  const sidebar = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [search, setSearch] = useState("");
  const visibleProjects = projects.filter((project) => project.title.toLowerCase().includes(search.trim().toLowerCase()));
  const projectListLoaded = isReady && serverPersistenceAvailable === true && !storageError;

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sidebar.current?.querySelector<HTMLInputElement>("input")?.focus();
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
      <aside ref={sidebar} aria-hidden={!isOpen} inert={!isOpen} className={`project-sidebar ${isOpen ? "is-open" : ""}`}>
        <div className="sidebar-module-head">
          <span className="sidebar-module-icon"><ScriptIcon /></span>
          <span>
            <strong>{t("nav.scriptMaster")}</strong>
            <small>{t("nav.scriptWorkspace")}</small>
          </span>
        </div>

        <Link className="new-script-button" href="/projects/new" onClick={onClose}>
          <PlusIcon />
          <span>{t("nav.create")}</span>
        </Link>

        <Link className="topbar-all-projects" href="/" onClick={onClose}>{t("nav.projectLibrary")}</Link>

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
                  <Link className="project-history-item" href={projectHref} onClick={onClose}>
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
        </nav>

        <div className="sidebar-footer">
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
