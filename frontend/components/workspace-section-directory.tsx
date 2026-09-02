"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  List,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";

import type { DocumentOutlineEntry } from "@/components/document-outline";
import { episodeRoadmapCoverageThrough } from "@/lib/planning-coverage";
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
}> = [
  { id: "story-bible", labelKey: "workspaceDirectory.storyBible" },
  { id: "planning", labelKey: "workspaceDirectory.planning" },
  { id: "script", labelKey: "workspaceDirectory.script" },
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
  const project = getProject(projectId);
  const access = project ? workspaceSectionAccess(project) : {
    storyBible: true,
    planning: false,
    script: false,
  };
  const visibleSections = SECTION_DEFINITIONS.filter((section) => (
    section.id === "story-bible"
      ? access.storyBible
      : access[section.id]
  ));
  const [expandedSection, setExpandedSection] = useState<WorkspaceSectionId | null>(
    activeSection === "story-bible" ? null : activeSection,
  );

  useEffect(() => {
    setExpandedSection(activeSection === "story-bible" ? null : activeSection);
  }, [activeSection]);

  const planningCoverage = project?.episodeRoadmapRequired === true
    ? episodeRoadmapCoverageThrough(project.episodeRoadmaps ?? [])
    : project?.episodePlansReadyThrough ?? 0;

  return (
    <aside className="document-outline workspace-section-directory">
      <div className="document-outline-heading workspace-section-directory-heading">
        <span><List aria-hidden="true" size={14} />{t("workspaceDirectory.label")}</span>
        {project && access.planning ? (
          <small className="workspace-section-directory-progress">
            <span>{t("workspaceDirectory.planningMetric")} {planningCoverage}/{project.generationSettings.episodeCount}</span>
            {access.script ? <span>{t("workspaceDirectory.scriptMetric")} {project.episodes.length}/{project.generationSettings.episodeCount}</span> : null}
          </small>
        ) : null}
      </div>
      <nav aria-label={t("workspaceDirectory.label")} className="document-outline-scroll workspace-section-directory-scroll">
        {visibleSections.map((section) => {
          const isActive = section.id === activeSection;
          const isExpandable = section.id !== "story-bible";
          const isExpanded = isExpandable && isActive && expandedSection === section.id;
          const sectionHref = project
            ? workspaceSectionHref(project, section.id)
            : `/projects/${projectId}/planning`;
          return (
            <div
              className={`workspace-section-directory-group${isActive ? " is-active" : ""}${isExpanded ? " is-expanded" : ""}`}
              key={section.id}
            >
              {isActive && isExpandable ? (
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
                  <ChevronRight aria-hidden="true" size={13} />
                  <span>{t(section.labelKey)}</span>
                </button>
              ) : (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className="workspace-section-directory-section"
                  href={sectionHref}
                >
                  {isExpandable ? <ChevronRight aria-hidden="true" size={13} /> : null}
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
                      aria-current={activeEntryId === entry.id ? "location" : undefined}
                      aria-label={entry.statusLabel
                        ? `${entry.label}，${entry.statusLabel}`
                        : entry.label}
                      className={`${activeEntryId === entry.id ? "is-active" : ""}${entry.status ? ` has-status is-${entry.status}` : ""}`}
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
    </aside>
  );
}
