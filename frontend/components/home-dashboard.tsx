"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ArrowIcon, PlusIcon, ScriptIcon } from "@/components/icons";
import { SectionHelp } from "@/components/section-help";
import { formatRelativeTime } from "@/lib/format";
import { getLocalizedTagLabel, getTag } from "@/lib/tag-catalog";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function HomeDashboard() {
  const { projects, isReady, deleteProject } = useProjects();
  const { locale, t } = useLocale();
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  async function handleDelete(projectId: string): Promise<void> {
    if (!window.confirm(t("nav.deleteConfirm"))) return;
    setDeletingProjectId(projectId);
    try {
      await deleteProject(projectId);
    } finally {
      setDeletingProjectId(null);
    }
  }

  return (
    <main className="home-page">
      <header className="library-page-header page-reveal">
        <div>
          <span className="eyebrow">{t("nav.scriptMaster")}</span>
          <div className="section-title-with-help">
            <h1>{t("home.libraryTitle")}</h1>
            <SectionHelp content={t("guide.projectLibrary")} label={t("guide.openHelp")} />
          </div>
          <p>{t("home.libraryDescription")}</p>
        </div>
        <Link className="primary-action" href="/projects/new">
          <PlusIcon />
          {t("home.start")}
        </Link>
      </header>

      <section className="recent-section page-reveal delay-one">
        <div className="section-title-row">
          <div>
            <div className="section-title-with-help">
              <h2>{t("home.recent")}</h2>
              <SectionHelp content={t("guide.recentProjects")} label={t("guide.openHelp")} />
            </div>
            <span>{projects.length} {t(projects.length === 1 ? "home.localProject" : "home.localProjects")}</span>
          </div>
        </div>

        {!isReady ? (
          <div className="home-loading-grid"><div /><div /></div>
        ) : projects.length === 0 ? (
          <Link className="empty-project-card" href="/projects/new">
            <span className="empty-project-icon"><ScriptIcon /></span>
            <span>
              <strong>{t("home.emptyTitle")}</strong>
              <small>{t("home.emptyText")}</small>
            </span>
            <ArrowIcon />
          </Link>
        ) : (
          <div className="project-library-grid">
            {projects.slice(0, 6).map((project, index) => {
              const primaryTag = getTag(project.selectedTagIds[0] ?? "");
              const projectHref = project.episodes.length
                ? `/projects/${project.id}/workspace`
                : `/projects/${project.id}/planning`;
              return (
                <article
                  className="project-folder-card"
                  key={project.id}
                >
                  <span className="project-folder-index">PROJECT / {String(index + 1).padStart(2, "0")}</span>
                  <button
                    aria-label={`${t("nav.delete")} ${project.title}`}
                    className="project-folder-delete"
                    disabled={deletingProjectId === project.id}
                    onClick={() => void handleDelete(project.id)}
                    title={t("nav.delete")}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                  <Link className="project-folder-open" href={projectHref}>
                    <span className="project-folder-body">
                      <span className="project-folder-mark">
                        <ScriptIcon />
                        <small>{String(index + 1).padStart(2, "0")}</small>
                      </span>
                      <span className="project-folder-copy">
                        <small>{primaryTag ? getLocalizedTagLabel(primaryTag, locale) : t("home.unclassified")} · {project.episodes.length} {t("workspace.episodes")}</small>
                        <strong>{project.title}</strong>
                        <span>{formatRelativeTime(project.updatedAt, locale)}</span>
                        <em className={`project-status status-${project.status}`}>{t(`status.${project.status}`)}</em>
                      </span>
                      <span className="project-folder-arrow"><ArrowIcon /></span>
                    </span>
                  </Link>
                </article>
              );
            })}
            <Link className="project-folder-create" href="/projects/new">
              <span><PlusIcon /></span>
              <strong>{t("home.start")}</strong>
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
