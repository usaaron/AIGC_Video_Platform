"use client";

import Link from "next/link";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function WorkspaceMissingProject() {
  const { serverPersistenceAvailable, storageError } = useProjects();
  const { t } = useLocale();
  const failed = serverPersistenceAvailable === false || Boolean(storageError);
  return <main className="centered-state">
    <h1>{failed ? "暂时无法读取这部作品" : t("project.missingTitle")}</h1>
    {failed ? <><p>暂时无法连接作品库，请重新加载后再试。</p><button className="primary-action" onClick={() => window.location.reload()} type="button">重新加载作品</button></> : null}
    <Link className="outline-action" href="/">{t("project.return")}</Link>
  </main>;
}
