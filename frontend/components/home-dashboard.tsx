"use client";

import Link from "next/link";
import { ArrowUpRight, BookOpenText, CircleAlert, FolderOpen, ListFilter, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmationDialog, ToolButton } from "@/components/workspace-controls";
import { formatRelativeTime } from "@/lib/format";
import { projectTagLabel } from "@/lib/tag-catalog";
import { currentWorkspaceHref } from "@/lib/workspace-stage";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function HomeDashboard() {
  const { projects, isReady, deleteProject, serverPersistenceAvailable, storageError } = useProjects();
  const { locale, t } = useLocale();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const pendingProject = projects.find(project => project.id === pendingDeleteId);
  const loading = !isReady || (!projects.length && serverPersistenceAvailable === null && !storageError);
  const visibleProjects = useMemo(() => {
    const search = query.trim().toLocaleLowerCase(locale);
    return projects.filter(project => {
      const tag = projectTagLabel(project, project.selectedTagIds[0] ?? "", locale);
      const text = [project.title, tag ?? ""].join(" ").toLocaleLowerCase(locale);
      const active = project.status === "generating" || project.status === "finalizing";
      return (!search || text.includes(search)) && (filter === "all"
        || (filter === "active" && active) || (filter === "final" && project.status === "final")
        || (filter === "draft" && !active && project.status !== "final"));
    }).sort((left, right) => sort === "title"
      ? left.title.localeCompare(right.title, locale, { numeric: true })
      : right.updatedAt.localeCompare(left.updatedAt));
  }, [projects, query, filter, sort, locale]);

  async function handleDelete() {
    if (!pendingProject || deleting) return;
    setDeleting(true); setDeleteError("");
    try {
      if (await deleteProject(pendingProject.id)) setPendingDeleteId(null);
      else setDeleteError(t("library.deleteFailed"));
    } catch { setDeleteError(t("library.deleteFailed")); }
    finally { setDeleting(false); }
  }

  return <main className="home-page library-workspace">
    <header className="library-page-header">
      <div><span className="library-kicker">{t("nav.scriptMaster")}</span>
        <h1>{t("nav.projectLibrary")}</h1>
        <p>{loading ? "..." : projects.length} {t("library.projects")}</p>
      </div>
      <Link className="primary-action" href="/projects/new"><Plus size={17} />{t("nav.create")}</Link>
    </header>

    <section aria-label={t("nav.projects")}>
      <div className="library-toolbar">
        <label className="library-search"><Search aria-hidden="true" size={17} />
          <input aria-label={t("nav.search")} placeholder={t("nav.search")} value={query}
            onChange={event => setQuery(event.target.value)} />
          {query && <ToolButton label={t("library.clearSearch")} onClick={() => setQuery("")}><X size={15} /></ToolButton>}
        </label>
        <div className="library-toolbar-options">
          <label className="library-select"><ListFilter aria-hidden="true" size={16} />
            <select aria-label={t("library.filter")} value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="all">{t("library.all")}</option><option value="draft">{t("library.drafts")}</option>
              <option value="active">{t("library.active")}</option><option value="final">{t("library.final")}</option>
            </select>
          </label>
          <label className="library-select"><select aria-label={t("library.sort")} value={sort} onChange={event => setSort(event.target.value)}>
            <option value="recent">{t("library.recent")}</option><option value="title">{t("library.titleOrder")}</option>
          </select></label>
        </div>
      </div>

      {!loading && (serverPersistenceAvailable === false || storageError) && <div className="inline-notice is-error" role="alert">
        <p>{locale === "zh" ? "项目列表可能不完整，请检查网络或浏览器存储后重试。" : "The project list may be incomplete. Check your connection or browser storage and retry."}</p>
        <button className="outline-action" type="button" onClick={() => window.location.reload()}>{locale === "zh" ? "重新加载" : "Reload"}</button>
      </div>}
      {loading ? <div className="library-loading" aria-label={t("nav.loading")} role="status">
        {[0, 1, 2].map(index => <div key={index}><span /><span /><span /></div>)}
      </div> : !projects.length && (serverPersistenceAvailable === false || storageError) ? null : !projects.length ? <div className="library-empty">
        <FolderOpen aria-hidden="true" size={32} /><h2>{t("home.emptyTitle")}</h2>
        <Link className="primary-action" href="/projects/new"><Plus size={17} />{t("nav.create")}</Link>
      </div> : !visibleProjects.length ? <div className="library-empty">
        <Search aria-hidden="true" size={28} /><h2>{t("nav.noMatches")}</h2>
        <button className="outline-action" onClick={() => { setQuery(""); setFilter("all"); }}>{t("library.resetFilters")}</button>
      </div> : <div className="library-projects">
        <div className="library-column-head" aria-hidden="true">
          <span>{t("library.name")}</span><span>{t("library.progress")}</span><span>{t("library.updated")}</span><span />
        </div>
        {visibleProjects.map((project, index) => {
          const tag = projectTagLabel(project, project.selectedTagIds[0] ?? "", locale);
          const episodeCount = project.episodes.filter(episode => ["saved", "confirmed", "final"].includes(episode.status)).length;
          const target = project.generationSettings.episodeCount;
          return <article className="library-project-row" key={project.id}>
            <Link className="library-project-link" href={currentWorkspaceHref(project)}>
              <div className="library-project-identity">
                <span className={"library-project-symbol tone-" + index % 3}><BookOpenText aria-hidden="true" size={21} /></span>
                <div><h2>{project.title}</h2>
                  <p><span>{tag ?? t("home.unclassified")}</span>
                    <span className={"library-status status-" + project.status}><i />{t("status." + project.status)}</span>
                  </p>
                </div>
              </div>
              <div className="library-progress">
                <span><strong>{episodeCount}</strong> / {target} {t("workspace.episodes")}</span>
                <progress aria-label={t("library.progress")} value={Math.min(episodeCount, target)} max={Math.max(1, target)} />
              </div>
              <time className="library-project-time" dateTime={project.updatedAt}>{formatRelativeTime(project.updatedAt, locale)}</time>
              <ArrowUpRight className="library-open-arrow" aria-hidden="true" size={18} />
            </Link>
            <ToolButton label={t("nav.delete") + " " + project.title} className="library-delete"
              onClick={() => { setPendingDeleteId(project.id); setDeleteError(""); }}><Trash2 size={16} /></ToolButton>
          </article>;
        })}
        <div className="library-result-count" role="status">{visibleProjects.length} / {projects.length} {t("library.projects")}</div>
      </div>}
    </section>

    <ConfirmationDialog open={!!pendingProject} title={t("library.deleteTitle")} confirmLabel={t("nav.delete")}
      cancelLabel={t("library.cancel")} busy={deleting} onConfirm={() => void handleDelete()} onClose={() => setPendingDeleteId(null)}>
      <p className="workspace-confirm-project">{pendingProject?.title}</p>
      <p>{t("nav.deleteConfirm")}</p>
      {deleteError && <div role="alert" className="workspace-feedback is-error"><CircleAlert size={16} />{deleteError}</div>}
    </ConfirmationDialog>
  </main>;
}
