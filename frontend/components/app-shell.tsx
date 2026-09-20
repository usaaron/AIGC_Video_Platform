"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
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
import { HostWorkspaceFrame } from "@/components/host-workspace-frame";
import { HostReturnLink } from "@/components/host-return-link";
import { StudioGuide } from "@/components/studio-guide";
import { HostImportPanel } from "@/components/host-import-panel";
import { hostDeliveryConfigured } from "@/lib/host-delivery";
import { currentWorkspaceHref } from "@/lib/workspace-stage";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/types";
import { hostProjectId as currentHostProjectId, hostProjectContext } from "@/lib/host-session";
import { hostWorkspaceHref, isHostEmbedded, isHostScriptWorkflow, notifyHost } from "@/lib/host-navigation";
import { quickSettingsForHost, hostScriptEntryHref, hostQuickRedirectHref } from "@/lib/quick-script-project";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [hostImportOpen, setHostImportOpen] = useState(false);
  const [hostBootstrapError, setHostBootstrapError] = useState("");
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
    updateProject,
  } = useProjects();
  const { t } = useLocale();
  const currentProject = projects.find(project => pathname.split("/")[2] === project.id);
  const hostHref = hostWorkspaceHref(currentProject?.hostDeliveryTargetProjectId ?? currentHostProjectId());
  const showHostReturn = Boolean(process.env.NEXT_PUBLIC_HOST_LAUNCH_URL);
  const BrandHome = showHostReturn ? "a" : Link;
  const brandHomeProps = {
    href: showHostReturn ? hostHref : "/",
    "aria-label": showHostReturn ? "序幕主站" : t("nav.projectLibrary"),
    title: showHostReturn ? "在新标签页打开序幕主站，保留当前剧本" : t("nav.projectLibrary"),
    ...(showHostReturn ? { target: "_blank", rel: "noopener noreferrer" } : {}),
  };
  const conflictedProjects = projects.filter((project) => (
    project.serverSync?.status === "conflict"
  ));

  useEffect(() => {
    setEmbedded(isHostEmbedded());
    const projectId = currentHostProjectId();
    if (isReady) notifyHost("ready", projectId);
  }, [isReady]);

  useEffect(() => {
    if (!isReady) return;
    const hostProjectId = currentHostProjectId();
    if (!hostProjectId || hostBootstrapRef.current === hostProjectId) return;
    const existing = projects.find((project) => project.id === hostProjectId);
    if (existing) {
      hostBootstrapRef.current = hostProjectId;
      if (pathname.split("/")[2] !== hostProjectId) router.replace(hostScriptEntryHref(existing, currentWorkspaceHref(existing), isHostScriptWorkflow()));
      return;
    }
    if (serverPersistenceAvailable !== true) return;
    hostBootstrapRef.current = hostProjectId;
    const context = hostProjectContext();
    const quickSettings = isHostScriptWorkflow() ? quickSettingsForHost(context?.episodeDurationSeconds) : null;
    const quick = Boolean(quickSettings);
    void createProject({
      id: hostProjectId,
      title: context?.name || "主项目长剧本",
      titleSource: "derived",
      creativePrompt: "",
      referenceMaterials: [],
      selectedTagIds: [],
      customTags: [],
      characters: [],
      hostDeliveryTargetProjectId: hostProjectId,
      ...(quick ? { creationMode: "quick" as const } : {}),
      generationSettings: quickSettings ?? { ...DEFAULT_GENERATION_SETTINGS,
        preferredEpisodeDurationMinutes: context?.episodeDurationSeconds
          ? context.episodeDurationSeconds / 60 : DEFAULT_GENERATION_SETTINGS.preferredEpisodeDurationMinutes },
    }).then((created) => {
      router.replace(hostScriptEntryHref(created, currentWorkspaceHref(created), quick));
    }).catch(() => {
      hostBootstrapRef.current = null;
      setHostBootstrapError("暂时无法准备网剧创作，已保存内容保留，请重试。");
    });
  }, [createProject, isReady, pathname, projects, router, serverPersistenceAvailable]);

  useEffect(() => {
    if (!isReady || !currentProject) return;
    const target = hostQuickRedirectHref(currentProject, pathname, isHostScriptWorkflow());
    if (target) router.replace(target);
  }, [currentProject, isReady, pathname, router]);

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
    <div className={`app-shell${embedded ? " is-host-embedded" : sidebarOpen ? " is-sidebar-open" : ""}`}>
      {!embedded && <><header className="desktop-topbar">
        <BrandHome className="topbar-brand-link" {...brandHomeProps}>
          <BrandLogo spin />
        </BrandHome>
        <span className="topbar-divider" aria-hidden="true" />
        <StudioGuide />
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
          {showHostReturn && <HostReturnLink href={hostHref} />}
          <BackgroundGenerationStatus />
          <LanguageToggle compact />
        </div>
      </header>
      <ProjectSidebar hostHref={showHostReturn ? hostHref : undefined} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onNavigate={onSidebarNavigate} /></>}
      <div className="app-main">
        {!embedded && <header className="mobile-header">
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
          <BrandHome className="topbar-brand-link" {...brandHomeProps}><BrandLogo compact spin /></BrandHome>
          {showHostReturn && <HostReturnLink href={hostHref} />}
          <StudioGuide />
          <BackgroundGenerationStatus />
          <LanguageToggle compact />
        </header>}
        {!embedded && showHostReturn && currentProject && <section className="series-production-bar" aria-label="网剧制作流程">
          <div><strong>网剧创作 · {currentProject.title}</strong><span>梗概 → 总纲 → 全剧规划 → 正文与分镜 → 资产与视频制作</span></div>
          {hostDeliveryConfigured() && <button className="primary-action" type="button" onClick={() => setHostImportOpen(true)}>同步到制作</button>}
        </section>}
        {hostImportOpen && currentProject && <HostImportPanel project={currentProject}
          onTarget={id => void updateProject(currentProject.id, { hostDeliveryTargetProjectId: id })}
          onClose={() => setHostImportOpen(false)} />}
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
        {currentHostProjectId() && !projects.some(project => project.id === currentHostProjectId()) ? (
          <section className="series-production-bar" role="status">
            <p>{hostBootstrapError || (serverPersistenceAvailable === false ? "暂时无法连接创作服务，请重试。" : "正在恢复当前项目的网剧创作…")}</p>
            {(hostBootstrapError || serverPersistenceAvailable === false) && <button className="outline-action" type="button" onClick={() => window.location.reload()}>重新连接</button>}
          </section>
        ) : embedded && currentProject && !pathname.endsWith("/quick") ? <HostWorkspaceFrame project={currentProject} onImport={() => setHostImportOpen(true)}>{children}</HostWorkspaceFrame> : children}
      </div>
    </div>
  );
}
