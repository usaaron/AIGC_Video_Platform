"use client";

import { WorkspaceMissingProject } from "@/components/workspace-missing-project";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { SectionHelp } from "@/components/section-help";
import { StoryBiblePanel } from "@/components/story-bible-panel";
import { workspaceSectionAccess } from "@/lib/workspace-stage";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function StoryPlanningWorkspace() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const { getProject, isReady, updateProject } = useProjects();
  const { t } = useLocale();
  const project = getProject(params.projectId);
  const synopsisReady = Boolean(project && workspaceSectionAccess(project).storyBible);

  useEffect(() => {
    if (isReady && project && !synopsisReady) router.replace(`/projects/${project.id}/synopsis`);
  }, [isReady, project?.id, router, synopsisReady]);

  if (!isReady) {
    return <main className="centered-state"><div className="loading-mark" /><p>{t("project.opening")}</p></main>;
  }
  if (!project) {
    return <WorkspaceMissingProject />;
  }

  if (!synopsisReady) return <main className="centered-state"><div className="loading-mark" /><p>请先确认故事梗概。</p></main>;

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
        key={project.id}
        onProjectUpdate={(patch) => updateProject(project.id, patch)}
        project={project}
      />

    </main>
  );
}
