"use client";

import Link from "next/link";
import type { CSSProperties } from "react";

import { ArrowIcon, PlusIcon, ScriptIcon } from "@/components/icons";
import { formatRelativeTime } from "@/lib/format";
import { getLocalizedTagLabel, getTag } from "@/lib/tag-catalog";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function HomeDashboard() {
  const { projects, isReady } = useProjects();
  const { locale, t } = useLocale();

  return (
    <main className="home-page">
      <section className="home-hero page-reveal">
        <div className="eyebrow"><span /> {t("home.eyebrow")}</div>
        <p>{t("home.description")}</p>
        <Link className="primary-action" href="/projects/new">
          <PlusIcon />
          {t("home.start")}
        </Link>
        <div className="hero-proof">
          <span>01 {t("home.intent")}</span><i />
          <span>02 {t("home.characters")}</span><i />
          <span>03 {t("home.script")}</span>
        </div>
      </section>

      <section className="recent-section page-reveal delay-one">
        <div className="section-title-row">
          <div>
            <span className="section-kicker">{t("home.shelf")}</span>
            <h2>{t("home.recent")}</h2>
          </div>
          {projects.length > 0 ? <span>{projects.length} {t(projects.length === 1 ? "home.localProject" : "home.localProjects")}</span> : null}
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
          <div className="project-card-grid">
            {projects.slice(0, 6).map((project, index) => {
              const primaryTag = getTag(project.selectedTagIds[0] ?? "");
              const projectHref = project.episodes.length
                ? `/projects/${project.id}/workspace`
                : `/projects/${project.id}`;
              return (
                <Link
                  className="project-card"
                  href={projectHref}
                  key={project.id}
                  style={{ "--card-index": index } as CSSProperties}
                >
                  <div className="project-card-topline">
                    <span className={`project-status status-${project.status}`}>{t(`status.${project.status}`)}</span>
                    <span>{formatRelativeTime(project.updatedAt, locale)}</span>
                  </div>
                  <div className="project-card-glyph">{project.title.slice(0, 1).toUpperCase()}</div>
                  <h3>{project.title}</h3>
                  <p>{project.creativePrompt || t("home.waiting")}</p>
                  <div className="project-card-footer">
                    <span>{primaryTag ? getLocalizedTagLabel(primaryTag, locale) : t("home.unclassified")}</span>
                    <span>{project.episodes.length} {t("workspace.episodes")} · {project.characters.length} {t(project.characters.length === 1 ? "home.character" : "home.characterPlural")}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
