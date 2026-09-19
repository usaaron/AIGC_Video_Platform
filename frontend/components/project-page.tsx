"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { ScriptProjectEditor } from "@/components/script-project-editor";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const { getProject, isReady, serverPersistenceAvailable, storageError } = useProjects();
  const { locale, t } = useLocale();
  const project = getProject(params.projectId);

  if (!isReady || (!project && serverPersistenceAvailable === null && !storageError)) {
    return <main className="centered-state"><div className="loading-mark" /><p>{t("project.opening")}</p></main>;
  }

  if (!project) {
    const unavailable = serverPersistenceAvailable === false || Boolean(storageError);
    return (
      <main className="centered-state">
        <h1>{unavailable
          ? (locale === "zh" ? "暂时无法读取项目" : "The project could not be loaded")
          : (locale === "zh" ? "未找到这个项目" : "Project not found")}</h1>
        <p>{unavailable
          ? (locale === "zh" ? "请检查网络后重试，已保存的项目不会因此删除。" : "Check your connection and retry. Your saved project has not been deleted.")
          : (locale === "zh" ? "请返回项目库查看已有剧本，或检查链接是否正确。" : "Return to the library or check the project link.")}</p>
        {unavailable && <button className="outline-action" type="button" onClick={() => window.location.reload()}>
          {locale === "zh" ? "重新加载" : "Reload"}
        </button>}
        <Link className="primary-action" href="/">{t("project.return")}</Link>
      </main>
    );
  }

  return <ScriptProjectEditor mode="edit" project={project} />;
}
