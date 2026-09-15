"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PlusIcon, ScriptIcon, SearchIcon, TrashIcon } from "@/components/icons";
import { LanguageToggle } from "@/components/language-toggle";
import { formatRelativeTime } from "@/lib/format";
import { projectTagLabel } from "@/lib/tag-catalog";
import { currentWorkspaceHref } from "@/lib/workspace-stage";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

interface ProjectSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: () => void;
}

export function ProjectSidebar({ isOpen, onClose, onNavigate }: ProjectSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { projects, isReady, deleteProject, serverPersistenceAvailable } = useProjects();
  const { locale, t } = useLocale();
  const [search, setSearch] = useState("");
  const visibleProjects = projects.filter((project) => project.title.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onClose]);

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
      <aside id="project-navigation" aria-label={t("nav.projects")} aria-hidden={!isOpen} inert={!isOpen} className={`project-sidebar ${isOpen ? "is-open" : ""}`}>
        <div className="sidebar-module-head">
          <span className="sidebar-module-icon"><ScriptIcon /></span>
          <span>
            <strong>{t("nav.scriptMaster")}</strong>
            <small>{t("nav.scriptWorkspace")}</small>
          </span>
          <button aria-label={t("nav.close")} className="sidebar-close-button" onClick={onClose} type="button"><X aria-hidden="true" size={16} /></button>
        </div>

        <Link className="new-script-button" href="/projects/new" onClick={onNavigate}>
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
          {!isReady ? (
            <div className="project-list-skeleton" aria-label={t("nav.loading")} />
          ) : projects.length === 0 ? (
            <div className="sidebar-empty">
              {t("nav.empty")}
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="sidebar-empty">{t("nav.noMatches")}</div>
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
                      <small>{primaryTag ?? t("nav.storyIdea")} · {project.episodes.length} {t("workspace.episodes")} · {formatRelativeTime(project.updatedAt, locale)}</small>
                    </span>
                    <span className={`status-dot status-${project.status}`} />
                  </Link>
                  <button aria-label={`${t("nav.delete")} ${project.title}`} className="project-delete-button" onClick={async () => {
                    if (!window.confirm(t("nav.deleteConfirm"))) return;
                    const deleted = await deleteProject(project.id);
                    if (deleted && active) router.push("/");
                  }} type="button"><TrashIcon /></button>
                </div>
              );
            })
          )}
        </nav>

        <div className="sidebar-footer">
          <Link className="sidebar-library-link" href="/" onClick={onNavigate}>{t("nav.projectLibrary")}</Link>
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
