"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { ScriptProjectEditor } from "@/components/script-project-editor";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const { getProject, isReady } = useProjects();
  const { t } = useLocale();
  const project = getProject(params.projectId);

  if (!isReady) {
    return <main className="centered-state"><div className="loading-mark" /><p>{t("project.opening")}</p></main>;
  }

  if (!project) {
    return (
      <main className="centered-state">
        <span className="state-code">404 / LOCAL</span>
        <h1>{t("project.missingTitle")}</h1>
        <p>{t("project.missingText")}</p>
        <Link className="primary-action" href="/">{t("project.return")}</Link>
      </main>
    );
  }

  return <ScriptProjectEditor mode="edit" project={project} />;
}
