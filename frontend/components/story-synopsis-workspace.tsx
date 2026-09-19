"use client";

import { WorkspaceMissingProject } from "@/components/workspace-missing-project";

import { useParams } from "next/navigation";

import { StorySynopsisPanel } from "@/components/story-synopsis-panel";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function StorySynopsisWorkspace() {
  const params = useParams<{ projectId: string }>();
  const { getProject, isReady } = useProjects();
  const { t } = useLocale();
  const project = getProject(params.projectId);
  if (!isReady) return <main className="centered-state"><div className="loading-mark" /><p>{t("project.opening")}</p></main>;
  if (!project) return <WorkspaceMissingProject />;
  return <main className="planning-workspace"><StorySynopsisPanel key={project.id} project={project} /></main>;
}
