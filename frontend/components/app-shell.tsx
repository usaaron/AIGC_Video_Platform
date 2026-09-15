"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CloudDownload,
  CloudUpload,
  FolderKanban,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { MenuIcon } from "@/components/icons";
import { BackgroundGenerationStatus } from "@/components/background-generation-status";
import { LanguageToggle } from "@/components/language-toggle";
import { ProjectSidebar } from "@/components/project-sidebar";
import { currentWorkspaceHref } from "@/lib/workspace-stage";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/types";
import { hostProjectId as currentHostProjectId } from "@/lib/host-session";
import { hostWorkspaceHref } from "@/lib/host-navigation";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [syncResolutionOpen, setSyncResolutionOpen] = useState(false);
  const [resolvingSync, setResolvingSync] = useState<{
    projectId: string;
    resolution: "use_local" | "use_cloud";
  } | null>(null);
  const [syncResolutionError, setSyncResolutionError] = useState<string | null>(null);
  const hostBootstrapRef = useRef<string | null>(null);
  const {
    projects,
    isReady,
    storageError,
    serverPersistenceAvailable,
    resolveProjectSyncConflict,
    createProject,
  } = useProjects();
  const { t } = useLocale();
  const currentProject = projects.find(project => pathname.split("/")[2] === project.id);
  const hostHref = hostWorkspaceHref(currentProject?.hostDeliveryTargetProjectId ?? currentHostProjectId());
  const showHostReturn = Boolean(process.env.NEXT_PUBLIC_HOST_LAUNCH_URL);
  const conflictedProjects = projects.filter((project) => (
    project.serverSync?.status === "conflict"
  ));

  useEffect(() => {
    if (!isReady) return;
    const hostProjectId = currentHostProjectId();
    if (!hostProjectId || hostBootstrapRef.current === hostProjectId) return;
    if (projects.some((project) => project.id === hostProjectId)) {
      hostBootstrapRef.current = hostProjectId;
      if (!pathname.includes(hostProjectId)) router.replace(`/projects/${hostProjectId}/planning`);
      return;
    }
    if (serverPersistenceAvailable !== true) return;
    hostBootstrapRef.current = hostProjectId;
    void createProject({
      id: hostProjectId,
      title: "主项目长剧本",
      titleSource: "derived",
      creativePrompt: "",
      referenceMaterials: [],
      selectedTagIds: [],
      customTags: [],
      characters: [],
      generationSettings: DEFAULT_GENERATION_SETTINGS,
    }).then((created) => {
      router.replace(`/projects/${created.id}/planning`);
    }).catch(() => {
      hostBootstrapRef.current = null;
    });
  }, [createProject, isReady, pathname, projects, router, serverPersistenceAvailable]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 901px)");
    const updateNavigation = () => setSidebarOpen(desktop.matches);
    updateNavigation();
    desktop.addEventListener("change", updateNavigation);
    return () => desktop.removeEventListener("change", updateNavigation);
  }, []);

  function onSidebarNavigate() {
    if (window.matchMedia("(max-width: 900px)").matches) setSidebarOpen(false);
  }

  useEffect(() => {
    if (conflictedProjects.length) return;
    setSyncResolutionOpen(false);
    setSyncResolutionError(null);
  }, [conflictedProjects.length]);

  async function resolveSyncConflict(
    projectId: string,
    resolution: "use_local" | "use_cloud",
  ): Promise<void> {
    setResolvingSync({ projectId, resolution });
    setSyncResolutionError(null);
    try {
      const result = await resolveProjectSyncConflict(projectId, resolution);
      if (!result || result.status !== "synced") {
        throw new Error("Project synchronization did not complete.");
      }
    } catch {
      setSyncResolutionError(t("nav.syncResolutionFailed"));
    } finally {
      setResolvingSync(null);
    }
  }

  return (
    <div className={`app-shell${sidebarOpen ? " is-sidebar-open" : ""}`}>
      <header className="desktop-topbar">
        <Link className="topbar-brand-link" href="/">
          <BrandLogo spin />
        </Link>
        <span className="topbar-divider" aria-hidden="true" />
        <button
          aria-controls="project-navigation"
          aria-expanded={sidebarOpen}
          aria-label={t(sidebarOpen ? "nav.close" : "nav.open")}
          className="icon-button"
          onClick={() => setSidebarOpen((open) => !open)}
          title={t(sidebarOpen ? "nav.close" : "nav.open")}
          type="button"
        >
          <MenuIcon />
        </button>
        <Link className="topbar-project-link" href={currentProject ? currentWorkspaceHref(currentProject) : "/"}>
          <FolderKanban aria-hidden="true" size={16} />
          <span>{currentProject?.title ?? t("nav.projectLibrary")}</span>
        </Link>
        <div className="topbar-actions">
          {showHostReturn && <a className="host-return-link" href={hostHref} target="_blank" rel="noopener noreferrer" title="在新标签页返回主站，保留当前创作进度"><ArrowLeft aria-hidden="true" size={15} />返回主站</a>}
          <BackgroundGenerationStatus />
          <LanguageToggle compact />
        </div>
      </header>
      <ProjectSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onNavigate={onSidebarNavigate} />
      <div className="app-main">
        <header className="mobile-header">
          <button
            aria-controls="project-navigation"
            aria-expanded={sidebarOpen}
            aria-label={t("nav.open")}
            className="icon-button"
            onClick={() => setSidebarOpen(true)}
            type="button"
          >
            <MenuIcon />
          </button>
          <BrandLogo compact spin />
          {showHostReturn && <a className="host-return-link" href={hostHref} target="_blank" rel="noopener noreferrer" aria-label="返回主站" title="在新标签页返回主站，保留当前创作进度"><ArrowLeft aria-hidden="true" size={16} /><span>主站</span></a>}
          <BackgroundGenerationStatus />
          <LanguageToggle compact />
        </header>
        {storageError ? <div className="storage-alert">{t("nav.storageUnavailable")}</div> : null}
        {conflictedProjects.length ? (
          <div className="storage-alert sync-conflict-alert">
            <span>
              <strong>{conflictedProjects.slice(0, 2).map((project) => project.title).join("、")}</strong>
              {conflictedProjects.length > 2 ? ` +${conflictedProjects.length - 2}` : ""}
              <small>{t("nav.syncConflict")}</small>
            </span>
            <button
              aria-label={t("nav.resolveSync")}
              onClick={() => {
                setSyncResolutionError(null);
                setSyncResolutionOpen(true);
              }}
              title={t("nav.resolveSync")}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} />
            </button>
          </div>
        ) : null}
        {syncResolutionOpen && conflictedProjects.length ? (
          <div
            className="tag-dialog-backdrop"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target && !resolvingSync) {
                setSyncResolutionOpen(false);
              }
            }}
            role="presentation"
          >
            <section
              aria-labelledby="sync-resolution-title"
              aria-modal="true"
              className="tag-dialog sync-resolution-dialog"
              role="dialog"
            >
              <button
                aria-label={t("nav.closeSyncResolution")}
                className="tag-dialog-close"
                disabled={Boolean(resolvingSync)}
                onClick={() => setSyncResolutionOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
              <span className="section-kicker">{t("nav.cloudWorkspace")}</span>
              <h3 id="sync-resolution-title">{t("nav.syncResolutionTitle")}</h3>
              <p>{t("nav.syncResolutionDescription")}</p>
              {syncResolutionError ? (
                <div className="inline-notice is-error" role="alert">
                  {syncResolutionError}
                </div>
              ) : null}
              <div className="sync-resolution-projects">
                {conflictedProjects.map((project) => {
                  const cloudBusy = resolvingSync?.projectId === project.id
                    && resolvingSync.resolution === "use_cloud";
                  const localBusy = resolvingSync?.projectId === project.id
                    && resolvingSync.resolution === "use_local";
                  return (
                    <article className="sync-resolution-project" key={project.id}>
                      <header>
                        <strong>{project.title}</strong>
                        <small>{t("nav.syncConflict")}</small>
                      </header>
                      <div className="sync-resolution-actions">
                        <button
                          className="outline-action"
                          disabled={Boolean(resolvingSync)}
                          onClick={() => void resolveSyncConflict(project.id, "use_cloud")}
                          type="button"
                        >
                          {cloudBusy ? (
                            <LoaderCircle aria-hidden="true" className="sync-resolution-spinner" size={16} />
                          ) : (
                            <CloudDownload aria-hidden="true" size={16} />
                          )}
                          <span>
                            <strong>{t("nav.useCloudVersion")}</strong>
                            <small>{t("nav.useCloudVersionHint")}</small>
                          </span>
                        </button>
                        <button
                          className="outline-action"
                          disabled={Boolean(resolvingSync)}
                          onClick={() => void resolveSyncConflict(project.id, "use_local")}
                          type="button"
                        >
                          {localBusy ? (
                            <LoaderCircle aria-hidden="true" className="sync-resolution-spinner" size={16} />
                          ) : (
                            <CloudUpload aria-hidden="true" size={16} />
                          )}
                          <span>
                            <strong>{t("nav.keepLocalVersion")}</strong>
                            <small>{t("nav.keepLocalVersionHint")}</small>
                          </span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
