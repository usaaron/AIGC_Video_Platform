"use client";

import { type ReactNode, useState } from "react";

import { MenuIcon } from "@/components/icons";
import { LanguageToggle } from "@/components/language-toggle";
import { ProjectSidebar } from "@/components/project-sidebar";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { projects, storageError } = useProjects();
  const { t } = useLocale();

  return (
    <div className="app-shell">
      <ProjectSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-main">
        <header className="mobile-header">
          <button
            aria-label={t("nav.open")}
            className="icon-button"
            onClick={() => setSidebarOpen(true)}
            type="button"
          >
            <MenuIcon />
          </button>
          <span>AI Comic Content OS</span>
          <LanguageToggle compact />
        </header>
        {storageError ? <div className="storage-alert">{storageError}</div> : null}
        {projects.some((project) => project.serverSync?.status === "conflict") ? (
          <div className="storage-alert">{t("nav.syncConflict")}</div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
