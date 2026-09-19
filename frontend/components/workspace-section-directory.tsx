"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  BookOpenText,
  Clapperboard,
  ChevronRight,
  Circle,
  FileText,
  FilePenLine,
  LockKeyhole,
  List,
  LoaderCircle,
  TriangleAlert,
  Workflow,
} from "lucide-react";

import type { DocumentOutlineEntry } from "@/components/document-outline";
import { episodeRoadmapCoverageThrough } from "@/lib/planning-coverage";
import { useDocumentScrollPosition } from "@/lib/use-document-scroll-position";
import {
  workspaceSectionAccess,
  workspaceSectionHref,
  type WorkspaceSectionId,
} from "@/lib/workspace-stage";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

const SECTION_DEFINITIONS: Array<{
  id: WorkspaceSectionId;
  labelKey: string;
  icon: typeof List;
}> = [
  { id: "story-synopsis", labelKey: "workspaceDirectory.storySynopsis", icon: FileText },
  { id: "story-bible", labelKey: "workspaceDirectory.storyBible", icon: BookOpenText },
  { id: "planning", labelKey: "workspaceDirectory.planning", icon: Workflow },
  { id: "script", labelKey: "workspaceDirectory.script", icon: FileText },
  { id: "storyboard", labelKey: "workspaceDirectory.storyboard", icon: Clapperboard },
];

export function WorkspaceSectionDirectory({
  activeEntryId,
  activeSection,
  currentEntries,
  onSelect,
  projectId,
}: {
  activeEntryId?: string | null;
  activeSection: WorkspaceSectionId;
  currentEntries: DocumentOutlineEntry[];
  onSelect: (entry: DocumentOutlineEntry) => void;
  projectId: string;
}) {
  const { t } = useLocale();
  const { getProject } = useProjects();
  const directoryRef = useRef<HTMLElement>(null);
  const visibleEntryId = useDocumentScrollPosition(currentEntries, activeEntryId);
  const project = getProject(projectId);
  const access = project ? workspaceSectionAccess(project) : {
    storyBible: true,
    storySynopsis: true,
    planning: false,
    script: false,
    storyboard: false,
  };
  const sectionAccessible = (section: typeof SECTION_DEFINITIONS[number]) => (
    section.id === "story-synopsis"
      ? access.storySynopsis
      : section.id === "story-bible"
        ? access.storyBible
      : access[section.id]
  );
  const [expandedSection, setExpandedSection] = useState<WorkspaceSectionId | null>(
    activeSection,
  );
  const [lockedHint, setLockedHint] = useState<string | null>(null);
  const unlockHint = (id: WorkspaceSectionId) => id === "storyboard" && project?.productionOutputMode === "script_only"
    ? "当前作品选择了仅生成正文，因此没有启用分镜。可以继续在正文工作区创作。"
    : t(`workspaceDirectory.unlock.${id}`);

  useEffect(() => {
    setExpandedSection(activeSection);
  }, [activeSection]);

  useEffect(() => {
    const directory = directoryRef.current;
    const active = directory?.querySelector('[aria-current="location"]');
    if (!directory || !active || !active.getClientRects().length) return;
    // Reveal the highlight inside the directory without scrolling the document or page.
    let container = active.parentElement;
    while (container && directory.contains(container)) {
      if (/(auto|scroll)/.test(getComputedStyle(container).overflowY)) {
        const item = active.getBoundingClientRect();
        const viewport = container.getBoundingClientRect();
        const top = Math.max(0, viewport.top);
        const bottom = Math.min(window.innerHeight, viewport.bottom);
        if (item.top < top + 8) container.scrollTop += item.top - top - 8;
        else if (item.bottom > bottom - 8) container.scrollTop += item.bottom - bottom + 8;
      }
      container = container.parentElement;
    }
  }, [visibleEntryId, expandedSection]);

  const planningCoverage = project?.episodeRoadmapRequired === true
    ? episodeRoadmapCoverageThrough(project.episodeRoadmaps ?? [])
    : project?.episodePlansReadyThrough ?? 0;

  return (
    <aside className="document-outline workspace-section-directory" ref={directoryRef}>
      <div className="workspace-mobile-navigation">
        <nav aria-label={t("workspaceDirectory.label")}>
          <Link href={`/projects/${projectId}`}><FilePenLine aria-hidden="true" size={16} /><span>{t("workspaceDirectory.input")}</span></Link>
          {SECTION_DEFINITIONS.map(section => sectionAccessible(section) ? <Link key={section.id} aria-current={section.id === activeSection ? "page" : undefined}
            href={project ? workspaceSectionHref(project, section.id) : `/projects/${projectId}/planning`}>
            <section.icon aria-hidden="true" size={16} /><span>{t(section.labelKey)}</span>
          </Link> : <button aria-disabled="true" key={section.id} onClick={() => setLockedHint(unlockHint(section.id))} title={unlockHint(section.id)} type="button">
            <LockKeyhole aria-hidden="true" size={14} /><span>{t(section.labelKey)}</span>
          </button>)}
        </nav>
        {!!currentEntries.length && <label>
          <span>{t(SECTION_DEFINITIONS.find(section => section.id === activeSection)!.labelKey)}</span>
          <select aria-label={t("workspaceDirectory.jumpTo")} value={visibleEntryId ?? ""}
            onChange={event => { const entry = currentEntries.find(item => item.id === event.target.value); if (entry) onSelect(entry); }}>
            <option value="" disabled>{t("workspaceDirectory.jumpTo")}</option>
            {currentEntries.map(entry => <option key={entry.id} value={entry.id} disabled={entry.disabled}>
              {entry.label}{entry.meta ? " · " + entry.meta : ""}
            </option>)}
          </select>
        </label>}
      </div>
      <div className="document-outline-heading workspace-section-directory-heading">
        <span><List aria-hidden="true" size={14} />{t("workspaceDirectory.label")}</span>
        {project && access.planning ? (
          <small className="workspace-section-directory-progress">
            <span>{t("workspaceDirectory.planningMetric")} {planningCoverage}/{project.generationSettings.episodeCount}</span>
            {access.script ? <span>{t("workspaceDirectory.scriptMetric")} {project.episodes.filter(episode => ["saved", "confirmed", "final"].includes(episode.status)).length}/{project.generationSettings.episodeCount}</span> : null}
          </small>
        ) : null}
      </div>
      <nav aria-label={t("workspaceDirectory.label")} className="document-outline-scroll workspace-section-directory-scroll">
        <Link className="workspace-section-directory-section workspace-story-input" href={`/projects/${projectId}`}><FilePenLine aria-hidden="true" size={16} /><span>{t("workspaceDirectory.input")}</span></Link>
        {SECTION_DEFINITIONS.map((section) => {
          const isActive = section.id === activeSection;
          const isExpandable = currentEntries.length > 0;
          const isExpanded = isExpandable && isActive && expandedSection === section.id;
          const sectionHref = project
            ? workspaceSectionHref(project, section.id)
            : `/projects/${projectId}/planning`;
          return (
            <div
              className={`workspace-section-directory-group${isActive ? " is-active" : ""}${isExpanded ? " is-expanded" : ""}`}
              key={section.id}
            >
              {!sectionAccessible(section) ? <button aria-disabled="true" className="workspace-section-directory-section" onClick={() => setLockedHint(unlockHint(section.id))} title={unlockHint(section.id)} type="button">
                <section.icon aria-hidden="true" size={16} /><span>{t(section.labelKey)}</span><LockKeyhole aria-hidden="true" size={13} />
              </button> : isActive && isExpandable ? (
                <button
                  aria-controls={`workspace-section-directory-children-${section.id}`}
                  aria-current="page"
                  aria-expanded={isExpanded}
                  className="workspace-section-directory-section"
                  onClick={() => setExpandedSection((current) => (
                    current === section.id ? null : section.id
                  ))}
                  type="button"
                >
                  <section.icon aria-hidden="true" size={16} />
                  <span>{t(section.labelKey)}</span>
                  <ChevronRight aria-hidden="true" className="workspace-section-chevron" size={14} />
                </button>
              ) : (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className="workspace-section-directory-section"
                  href={sectionHref}
                >
                  <section.icon aria-hidden="true" size={16} />
                  <span>{t(section.labelKey)}</span>
                </Link>
              )}
              {isExpanded ? (
                <div
                  className="workspace-section-directory-children"
                  id={`workspace-section-directory-children-${section.id}`}
                >
                  {currentEntries.length ? currentEntries.map((entry) => (
                    <button
                      aria-current={visibleEntryId === entry.id ? "location" : undefined}
                      aria-label={entry.statusLabel
                        ? `${entry.label}，${entry.statusLabel}`
                        : entry.label}
                      className={`${visibleEntryId === entry.id ? "is-active" : ""}${entry.isCurrent ? " is-current" : ""}${entry.depth ? " is-nested" : ""}${entry.status ? ` has-status is-${entry.status}` : ""}`}
                      disabled={entry.disabled}
                      key={entry.id}
                      onClick={() => onSelect(entry)}
                      style={{ paddingLeft: `${24 + Math.min(entry.depth ?? 0, 6) * 12}px` }}
                      type="button"
                    >
                      <span className="workspace-section-directory-entry-label">
                        {entry.status === "completed" ? <Check aria-hidden="true" size={11} /> : null}
                        {entry.status === "active" ? <LoaderCircle aria-hidden="true" className="workspace-section-directory-entry-spinner" size={11} /> : null}
                        {entry.status === "queued" ? <Circle aria-hidden="true" size={9} /> : null}
                        {entry.status === "failed" ? <TriangleAlert aria-hidden="true" size={11} /> : null}
                        <span>{entry.label}</span>
                      </span>
                      {entry.meta ? <small>{entry.meta}</small> : null}
                    </button>
                  )) : (
                    <p className="document-outline-empty">{t("workspaceDirectory.empty")}</p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
      {lockedHint ? <p className="workspace-directory-hint" role="status">{lockedHint}</p> : null}
    </aside>
  );
}
