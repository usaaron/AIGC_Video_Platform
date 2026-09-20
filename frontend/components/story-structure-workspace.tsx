"use client";

import { WorkspaceMissingProject } from "@/components/workspace-missing-project";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SectionHelp } from "@/components/section-help";
import { StoryPlanNodePanel } from "@/components/story-plan-node-panel";
import { loadStoryBible, type StoryBible } from "@/lib/story-planning-client";
import { workspaceSectionAccess } from "@/lib/workspace-stage";
import { useHostScriptWorkflow } from "@/lib/use-host-script-workflow";
import type { ScriptProject } from "@/lib/types";
import { userFacingError } from "@/lib/api-error";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function StoryStructureWorkspace() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const { getProject, isReady, updateProject } = useProjects();
  const { t } = useLocale();
  const scriptWorkflow = useHostScriptWorkflow();
  const project = getProject(params.projectId);
  const [storyBible, setStoryBible] = useState<StoryBible | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadedBibleKey, setLoadedBibleKey] = useState<string | null>(null);
  const bibleKey = project ? `${project.id}:${project.storyBibleVersion ?? "latest"}` : null;
  const planningAccessible = project
    ? workspaceSectionAccess(project).planning
    : false;

  useEffect(() => {
    if (!isReady || !project || planningAccessible) return;
    router.replace(`/projects/${project.id}/planning`);
  }, [isReady, planningAccessible, project?.id, router]);

  useEffect(() => {
    if (!project || project.storyBibleStatus !== "approved") {
      setLoading(false);
      setStoryBible(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setStoryBible(null);
    loadStoryBible(project.id, project.storyBibleVersion)
      .then((value) => {
        if (!active) return;
        setStoryBible(value);
        if (!value) setError(t("storyStructure.missingBible"));
      })
      .catch((reason) => {
        if (active) setError(userFacingError(reason, t("storyStructure.loadFailed")));
      })
      .finally(() => {
        if (active) {
          setLoadedBibleKey(bibleKey);
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [project?.id, project?.storyBibleStatus, project?.storyBibleVersion, t, loadAttempt]);

  if (!isReady) {
    return <main className="centered-state"><div className="loading-mark" /><p>{t("project.opening")}</p></main>;
  }
  if (!project) {
    return <WorkspaceMissingProject />;
  }
  if (!planningAccessible) {
    return <main className="centered-state"><div className="loading-mark" /></main>;
  }

  const update = (patch: Partial<ScriptProject> | ((current: ScriptProject) => Partial<ScriptProject>)) => {
    return updateProject(project.id, patch);
  };

  return (
    <main className="planning-workspace story-structure-workspace page-reveal">
      {scriptWorkflow === true ? <header className="host-planning-help">
        <span>按集查看和调整，完成后统一确认大纲</span>
        <SectionHelp content={t("guide.storyTree")} label="查看分集大纲操作说明" />
      </header> : <header className="planning-workspace-header story-structure-header">
        <div>
          <span className="section-kicker">{t("storyStructure.kicker")}</span>
          <div className="section-title-with-help">
            <h1>{project.title}</h1>
            <SectionHelp content={t("guide.storyTree")} label={t("guide.openHelp")} />
          </div>
          <p>{t("storyStructure.description")}</p>
        </div>
        <Link className="outline-action" href={`/projects/${project.id}/planning`}>
          {t("storyStructure.backToBible")}
        </Link>
      </header>}

      {project.storyBibleStatus !== "approved" ? (
        <section className="story-structure-gate">
          <span className="section-kicker">{t("storyStructure.lockedKicker")}</span>
          <h2>{t("storyStructure.lockedTitle")}</h2>
          <p>{t("storyStructure.lockedText")}</p>
          <Link className="primary-action" href={`/projects/${project.id}/planning`}>{t("storyStructure.openBible")}</Link>
        </section>
      ) : loading || loadedBibleKey !== bibleKey ? (
        <section className="story-structure-gate"><div className="loading-mark" /><p>{t("storyStructure.loading")}</p></section>
      ) : error || !storyBible ? (
        <section className="story-structure-gate is-error" role="alert">
          <h2>{t("storyStructure.loadFailed")}</h2>
          <p>{error ?? t("storyStructure.missingBible")}</p>
          <button className="primary-action" onClick={() => setLoadAttempt(attempt => attempt + 1)} type="button">重新读取规划</button>
          <Link className="outline-action" href={`/projects/${project.id}/planning`}>{t("storyStructure.backToBible")}</Link>
        </section>
      ) : (
        <StoryPlanNodePanel key={project.id} onProjectUpdate={update} project={project} storyBible={storyBible} />
      )}
    </main>
  );
}
