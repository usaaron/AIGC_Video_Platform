"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { PlusIcon, ScriptIcon, SearchIcon, TrashIcon } from "@/components/icons";
import { LanguageToggle } from "@/components/language-toggle";
import { formatRelativeTime } from "@/lib/format";
import { getLocalizedTagLabel, getTag } from "@/lib/tag-catalog";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

interface ProjectSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectSidebar({ isOpen, onClose }: ProjectSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { projects, isReady, deleteProject } = useProjects();
  const { locale, t } = useLocale();
  const [search, setSearch] = useState("");
  const visibleProjects = projects.filter((project) => project.title.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <>
      <button
        aria-label={t("nav.close")}
        className={`sidebar-scrim ${isOpen ? "is-visible" : ""}`}
        onClick={onClose}
        type="button"
      />
      <aside className={`project-sidebar ${isOpen ? "is-open" : ""}`}>
        <Link className="brand-mark" href="/" onClick={onClose}>
          <span className="brand-glyph">A</span>
          <span>
            <strong>AI Comic</strong>
            <small>Content OS</small>
          </span>
        </Link>

        <Link className="new-script-button" href="/projects/new" onClick={onClose}>
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
              const primaryTag = getTag(project.selectedTagIds[0] ?? "");
              const active = pathname.includes(project.id);
              const projectHref = project.episodes.length
                ? `/projects/${project.id}/workspace`
                : `/projects/${project.id}`;
              return (
                <div className={`project-history-row ${active ? "is-active" : ""}`} key={project.id}>
                  <Link className="project-history-item" href={projectHref} onClick={onClose}>
                    <span className="project-history-icon"><ScriptIcon /></span>
                    <span className="project-history-copy">
                      <strong>{project.title}</strong>
                      <small>{primaryTag ? getLocalizedTagLabel(primaryTag, locale) : t("nav.storyIdea")} · {project.episodes.length} {t("workspace.episodes")} · {formatRelativeTime(project.updatedAt, locale)}</small>
                    </span>
                    <span className={`status-dot status-${project.status}`} />
                  </Link>
                  <button aria-label={`${t("nav.delete")} ${project.title}`} className="project-delete-button" onClick={() => {
                    if (!window.confirm(t("nav.deleteConfirm"))) return;
                    deleteProject(project.id);
                    if (active) router.push("/");
                  }} type="button"><TrashIcon /></button>
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
              <strong>{t("nav.localWorkspace")}</strong>
              <small>{t("nav.savedBrowser")}</small>
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
