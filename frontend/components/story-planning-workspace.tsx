"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { SectionHelp } from "@/components/section-help";
import { StoryBiblePanel } from "@/components/story-bible-panel";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function StoryPlanningWorkspace() {
  const params = useParams<{ projectId: string }>();
  const { getProject, isReady, updateProject } = useProjects();
  const { t } = useLocale();
  const project = getProject(params.projectId);

  if (!isReady) {
    return <main className="centered-state"><div className="loading-mark" /><p>{t("project.opening")}</p></main>;
  }
  if (!project) {
    return <main className="centered-state"><h1>{t("project.missingTitle")}</h1><Link className="primary-action" href="/">{t("project.return")}</Link></main>;
  }

  const creativeInputLocked = project.storyBibleStatus === "approved" || project.episodes.length > 0;

  return (
    <main className="planning-workspace page-reveal">
      <header className="planning-workspace-header">
        <div>
          <span className="section-kicker">{t("planningWorkspace.kicker")}</span>
          <div className="section-title-with-help">
            <h1>{project.title}</h1>
            <SectionHelp content={t("guide.planningWorkspace")} label={t("guide.openHelp")} />
          </div>
        </div>
        <div className="planning-workspace-header-actions">
          <Link className="outline-action" href={`/projects/${project.id}`}>
            {t(creativeInputLocked ? "planningWorkspace.viewInput" : "planningWorkspace.editInput")}
          </Link>
        </div>
      </header>

      <StoryBiblePanel
        onProjectUpdate={(patch) => updateProject(project.id, patch)}
        project={project}
      />

    </main>
  );
}
