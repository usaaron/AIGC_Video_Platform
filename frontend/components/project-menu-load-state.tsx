"use client";

import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";
import styles from "./project-menu-load-state.module.css";

export function ProjectMenuLoadState() {
  const { projects, isReady, serverPersistenceAvailable, storageError } = useProjects();
  const { locale, t } = useLocale();
  if (serverPersistenceAvailable === false || storageError) {
    return <div className={styles.notice} role="alert">
      <p>{projects.length
        ? (locale === "zh" ? "项目列表可能不完整，已读取的项目仍可打开。" : "The project list may be incomplete. Loaded projects can still be opened.")
        : (locale === "zh" ? "暂时无法读取项目列表，请检查网络或浏览器存储后重试。" : "The project list could not be loaded. Check your connection or browser storage and retry.")}</p>
      <button className={styles.retry} type="button" onClick={() => window.location.reload()}>
        {locale === "zh" ? "重新加载项目" : "Reload projects"}
      </button>
    </div>;
  }
  if (!isReady || serverPersistenceAvailable === null) {
    return <p className={styles.loading} role="status">{t("nav.loading")}</p>;
  }
  return null;
}
