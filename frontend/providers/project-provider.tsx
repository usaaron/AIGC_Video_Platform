"use client";

import { usePathname } from "next/navigation";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  assertHostSessionActive,
  ensureHostToken,
  hostProjectId,
  HostSessionUnavailableError,
  subscribeHostSessionFailure,
} from "@/lib/host-session";

import {
  deleteStoredProject,
  listStoredProjects,
  nextProjectUpdatedAt,
  saveStoredProject,
} from "@/lib/project-store";
import {
  deleteProjectPermanentlyOnServer,
  forceWorkspaceOverwrite,
  loadServerProjects,
  queueProjectServerSync,
} from "@/lib/project-sync";
import {
  DEFAULT_GENERATION_SETTINGS,
  enforceMarketDeliveryContract,
  marketProfileForReleaseRegion,
  type ProjectDraft,
  type ProjectServerSyncState,
  type ScriptProject,
} from "@/lib/types";

interface ProjectContextValue {
  projects: ScriptProject[];
  isReady: boolean;
  storageError: string | null;
  serverPersistenceAvailable: boolean | null;
  createProject: (draft: ProjectDraft) => Promise<ScriptProject>;
  updateProject: (
    projectId: string,
    patch: Partial<ScriptProject> | ((current: ScriptProject) => Partial<ScriptProject>),
  ) => Promise<boolean>;
  syncProjectSnapshot: (project: ScriptProject) => Promise<ProjectServerSyncState>;
  adoptServerProjectSnapshot: (project: ScriptProject, source: ScriptProject) => Promise<boolean>;
  retryProjectSync: (projectId: string) => Promise<ProjectServerSyncState | null>;
  resolveProjectSyncConflict: (
    projectId: string,
    resolution: "use_local" | "use_cloud",
  ) => Promise<ProjectServerSyncState | null>;
  deleteProject: (projectId: string) => Promise<boolean>;
  getProject: (projectId: string) => ScriptProject | undefined;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const DELIVERY_CONFIRMATION_SAFE_PATCH_KEYS = new Set<keyof ScriptProject>([
  "activeEpisodeNumber",
  "activeGenerationTask",
  "serverSync",
  "deliveryConfirmation",
]);

function sortProjects(projects: ScriptProject[]): ScriptProject[] {
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function projectContentSnapshot(project: ScriptProject): string {
  const content = { ...project };
  delete content.serverSync;
  return JSON.stringify(content);
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pathParts = pathname.split("/");
  const requestedProjectId = pathParts[1] === "projects" && pathParts[2] !== "new" ? pathParts[2] : undefined;
  const [projects, setProjects] = useState<ScriptProject[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRetryError, setAuthRetryError] = useState<string | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [serverPersistenceAvailable, setServerPersistenceAvailable] = useState<boolean | null>(null);
  const automaticConflictRetries = useRef(new Set<string>());
  const deletedProjectIds = useRef(new Set<string>());
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  useEffect(() => {
    let active = true;
    setAuthRetryError(null);
    const unsubscribe = subscribeHostSessionFailure((error) => {
      active = false;
      projectsRef.current = [];
      setProjects([]);
      setIsReady(false);
      setAuthReady(false);
      setAuthError(error.message);
    });
    const revalidateLogin = () => { void ensureHostToken(true).catch(() => {}); };
    window.addEventListener("focus", revalidateLogin);
    ensureHostToken()
      .then(() => {
        if (!active) return [];
        setAuthReady(true);
        return listStoredProjects();
      })
      .then(async (localProjects) => {
        if (!active) return;
        assertHostSessionActive();
        const scopedProjectId = hostProjectId();
        const scopedLocalProjects = scopedProjectId
          ? localProjects.filter((project) => project.id === scopedProjectId)
          : localProjects;
        projectsRef.current = scopedLocalProjects;
        setProjects(scopedLocalProjects);
        setIsReady(true);

        const hydratedSnapshots = new Map<string, ScriptProject>();
        const serverResult = await loadServerProjects({
          preferredProjectId: requestedProjectId,
          onProject: (remoteProject) => {
            if (!active || deletedProjectIds.current.has(remoteProject.id)) return;
            if (scopedProjectId && remoteProject.id !== scopedProjectId) return;
            assertHostSessionActive();
            // Always merge against the latest author edits, including edits
            // made while another project's workspace is still downloading.
            const merged = mergeHydratedProject(projectsRef.current, remoteProject, hydratedSnapshots.get(remoteProject.id));
            hydratedSnapshots.set(remoteProject.id, remoteProject);
            const nextProjects = sortProjects(merged);
            projectsRef.current = nextProjects;
            setProjects(nextProjects);
          },
        });
        if (!active) return;
        assertHostSessionActive();
        setServerPersistenceAvailable(serverResult.available);
        if (!serverResult.available) {
          const offlineProjects = projectsRef.current.map((project) => (
            project.serverSync?.status === "conflict"
              ? {
                  ...project,
                  serverSync: {
                    ...project.serverSync,
                    status: "unavailable" as const,
                    error: serverResult.error,
                  },
                }
              : project
          ));
          const nextProjects = sortProjects(offlineProjects);
          projectsRef.current = nextProjects;
          setProjects(nextProjects);
          await Promise.all(offlineProjects.map((project) => saveStoredProject(project)));
          return;
        }

        // The editor is usable while the server request is pending. Merge
        // against current state so that response cannot erase intervening edits.
        const scopedServerProjects = serverResult.projects.filter((project) =>
          (!scopedProjectId || project.id === scopedProjectId)
          && !deletedProjectIds.current.has(project.id));
        const merged = mergeProjects(projectsRef.current, scopedServerProjects);
        const nextProjects = sortProjects(merged.projects);
        projectsRef.current = nextProjects;
        setProjects(nextProjects);
        await Promise.all(merged.projects.map((project) => saveStoredProject(project)));
        merged.localNewer.forEach((project) => requestServerSync(project));
      })
      .catch((error: unknown) => {
        if (active) {
          if (error instanceof HostSessionUnavailableError) {
            setAuthRetryError(error.message);
            return;
          }
          setStorageError(
            error instanceof Error ? error.message : "Unable to load local projects.",
          );
        }
      })
      .finally(() => {
        if (active) setIsReady(true);
      });
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", revalidateLogin);
    };
  }, [authAttempt]);

  async function createProject(draft: ProjectDraft): Promise<ScriptProject> {
    await ensureHostToken();
    const scopedProjectId = hostProjectId();
    const existing = scopedProjectId ? projectsRef.current.find((project) => project.id === scopedProjectId) : undefined;
    if (existing) return existing;
    const now = new Date().toISOString();
    const generationSettings = draft.generationSettings ?? DEFAULT_GENERATION_SETTINGS;
    const marketProfile = marketProfileForReleaseRegion(generationSettings.releaseRegion);
    const project: ScriptProject = {
      ...draft,
      id: scopedProjectId ?? draft.id ?? crypto.randomUUID(),
      referenceMaterials: draft.referenceMaterials ?? [],
      marketProfile,
      generationSettings: enforceMarketDeliveryContract(
        generationSettings,
        marketProfile,
      ),
      episodes: [],
      generationBatches: [],
      episodeRoadmaps: [],
      continuationHooks: [],
      setupPayoffs: [],
      continuityStates: [],
      activeEpisodeNumber: 1,
      deliveryContentRevision: 0,
      storyLines: [],
      characterRelationships: [],
      serverSync: {
        status: "syncing",
        projectRevision: 0,
        workspaceRevision: 0,
      },
      status: "idea",
      createdAt: now,
      updatedAt: now,
    };
    await saveStoredProject(project);
    setStorageError(null);
    setProjects((current) => {
      const nextProjects = sortProjects([project, ...current]);
      projectsRef.current = nextProjects;
      return nextProjects;
    });
    requestServerSync(project);
    return project;
  }

  async function adoptServerProjectSnapshot(saved: ScriptProject, source: ScriptProject): Promise<boolean> {
    if (saved.serverSync?.status !== "synced" || saved.id !== source.id) return false;
    const sourceContent = projectContentSnapshot(source);
    const canAdopt = (candidate: ScriptProject | undefined) => candidate
      && projectContentSnapshot(candidate) === sourceContent
      && (candidate.planningRevisionEpoch ?? 0) <= (saved.planningRevisionEpoch ?? 0)
      && (candidate.serverSync?.workspaceRevision ?? 0) <= (saved.serverSync?.workspaceRevision ?? 0);
    const current = projectsRef.current.find((project) => project.id === saved.id);
    // The source predates the server PUT. Checking only the state captured here
    // would miss author edits made while that request was waiting.
    if (!canAdopt(current)) return false;
    try { await saveStoredProject(saved); }
    catch (error) {
      setStorageError(error instanceof Error ? error.message : "Unable to store the accepted revision.");
      return false;
    }
    const latest = projectsRef.current.find((project) => project.id === saved.id);
    if (!canAdopt(latest)) {
      if (latest) await saveStoredProject(latest);
      else await deleteStoredProject(saved.id);
      return false;
    }
    const next = sortProjects([...projectsRef.current.filter((project) => project.id !== saved.id), saved]);
    projectsRef.current = next;
    setProjects(next);
    return true;
  }

  function updateProject(
    projectId: string,
    patch: Partial<ScriptProject> | ((current: ScriptProject) => Partial<ScriptProject>),
  ): Promise<boolean> {
    assertHostSessionActive();
    return new Promise((resolve) => {
      setProjects((current) => {
        const existing = current.find((project) => project.id === projectId);
        if (!existing) {
          resolve(true);
          return current;
        }
        const resolvedPatch = typeof patch === "function" ? patch(existing) : patch;
        if (!Object.keys(resolvedPatch).length) {
          resolve(true);
          return current;
        }

        // A delivery confirmation is a snapshot, not a durable status bit.
        // Any edit to the project or its episode set invalidates that snapshot
        // unless the caller is explicitly writing a new confirmation now.
        const hasExplicitDeliveryConfirmation = Object.prototype.hasOwnProperty.call(
          resolvedPatch,
          "deliveryConfirmation",
        );
        const deliveryContentChanged = Object.keys(resolvedPatch).some(
          (key) => !DELIVERY_CONFIRMATION_SAFE_PATCH_KEYS.has(key as keyof ScriptProject),
        );
        const currentDeliveryContentRevision = Number.isSafeInteger(existing.deliveryContentRevision)
          && (existing.deliveryContentRevision ?? 0) >= 0
          ? existing.deliveryContentRevision ?? 0
          : 0;
        const deliveryContentRevision = deliveryContentChanged
          ? currentDeliveryContentRevision + 1
          : currentDeliveryContentRevision;
        // Never accept a stale confirmation bundled with a content mutation.
        // A fresh confirmation is written in its own update after the author
        // has reviewed the complete saved episode set.
        const deliveryConfirmation = deliveryContentChanged
          ? undefined
          : hasExplicitDeliveryConfirmation
            ? resolvedPatch.deliveryConfirmation
            : existing.deliveryConfirmation;

        const nextMarketProfile = resolvedPatch.generationSettings
          ? marketProfileForReleaseRegion(resolvedPatch.generationSettings.releaseRegion)
          : existing.marketProfile;
        const updated: ScriptProject = {
          ...existing,
          ...resolvedPatch,
          deliveryConfirmation,
          deliveryContentRevision,
          marketProfile: nextMarketProfile,
          generationSettings: resolvedPatch.generationSettings
            ? enforceMarketDeliveryContract(
                resolvedPatch.generationSettings,
                nextMarketProfile,
              )
            : existing.generationSettings,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: nextProjectUpdatedAt(existing.updatedAt),
          serverSync: {
            status: "syncing",
            projectRevision: existing.serverSync?.projectRevision ?? 0,
            workspaceRevision: existing.serverSync?.workspaceRevision ?? 0,
            lastSyncedAt: existing.serverSync?.lastSyncedAt,
          },
        };
        void saveStoredProject(updated)
          .then(() => { setStorageError(null); resolve(true); })
          .catch((error: unknown) => {
            setStorageError(
              error instanceof Error ? error.message : "Unable to save the project.",
            );
            resolve(false);
          });
        requestServerSync(updated);
        const nextProjects = sortProjects(
          current.map((project) => (project.id === projectId ? updated : project)),
        );
        // Keep imperative readers (for example, the export confirmation
        // handshake) on the same optimistic snapshot before React renders.
        projectsRef.current = nextProjects;
        return nextProjects;
      });
    });
  }

  async function deleteProject(projectId: string): Promise<boolean> {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return true;
    const result = await deleteProjectPermanentlyOnServer(project);
    if (!result.deleted) {
      setProjects((current) => {
        const nextProjects = current.map((item) => (
          item.id === projectId ? { ...item, serverSync: result.serverSync } : item
        ));
        projectsRef.current = nextProjects;
        return nextProjects;
      });
      setServerPersistenceAvailable(result.serverSync.status !== "unavailable");
      setStorageError(
        result.serverSync.error ?? "Unable to delete the project safely.",
      );
      return false;
    }
    deletedProjectIds.current.add(projectId);
    setProjects((current) => {
      const nextProjects = current.filter((project) => project.id !== projectId);
      projectsRef.current = nextProjects;
      return nextProjects;
    });
    try {
      await deleteStoredProject(projectId);
    } catch (error: unknown) {
      setStorageError(
        error instanceof Error ? error.message : "Unable to delete the project.",
      );
      return false;
    }
    setStorageError(null);
    return true;
  }

  function getProject(projectId: string): ScriptProject | undefined {
    return projectsRef.current.find((project) => project.id === projectId);
  }

  async function syncProjectSnapshot(
    project: ScriptProject,
    options: { forceWorkspaceOverwrite?: boolean; bypassCooldown?: boolean } = {},
  ): Promise<ProjectServerSyncState> {
    await ensureHostToken();
    setProjects((current) => {
      const nextProjects = current.map((item) => (
        item.id === project.id && item.serverSync?.status === "conflict"
          ? {
              ...item,
              serverSync: {
                ...item.serverSync,
                status: "syncing" as const,
                error: undefined,
              },
            }
          : item
      ));
      projectsRef.current = nextProjects;
      return nextProjects;
    });
    const serverSync = options.forceWorkspaceOverwrite
      ? await forceWorkspaceOverwrite(project)
      : await queueProjectServerSync(project, { bypassCooldown: options.bypassCooldown });
    setServerPersistenceAvailable(serverSync.status !== "unavailable");
    if (serverSync.status !== "conflict") clearAutomaticConflictRetries(project.id);

    const existing = projectsRef.current.find((item) => item.id === project.id);
    if (!existing) return serverSync;
    const syncState = syncStateForSnapshot(existing, project, serverSync);
    const persisted = { ...existing, serverSync: syncState };
    try {
      await saveStoredProject(persisted);
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : "Unable to save sync state.",
      );
      throw error;
    }
    setProjects((current) => {
      const nextProjects = sortProjects(current.map((item) => {
        if (item.id !== project.id) return item;
        return {
          ...item,
          serverSync: syncStateForSnapshot(item, project, serverSync),
        };
      }));
      projectsRef.current = nextProjects;
      return nextProjects;
    });
    return serverSync;
  }

  async function retryProjectSync(
    projectId: string,
  ): Promise<ProjectServerSyncState | null> {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return null;
    return syncProjectSnapshot(project, { bypassCooldown: true });
  }

  async function resolveProjectSyncConflict(
    projectId: string,
    resolution: "use_local" | "use_cloud",
  ): Promise<ProjectServerSyncState | null> {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return null;
    if (resolution === "use_local") {
      return syncProjectSnapshot(project, { forceWorkspaceOverwrite: true });
    }

    const serverResult = await loadServerProjects();
    setServerPersistenceAvailable(serverResult.available);
    if (!serverResult.available) {
      throw new Error(serverResult.error ?? "Server persistence is unavailable.");
    }
    const remoteProject = serverResult.projects.find((item) => item.id === projectId);
    if (!remoteProject) {
      throw new Error("The cloud project no longer exists.");
    }
    await saveStoredProject(remoteProject);
    clearAutomaticConflictRetries(projectId);
    setProjects((current) => {
      const nextProjects = sortProjects(current.map((item) => (
        item.id === projectId ? remoteProject : item
      )));
      projectsRef.current = nextProjects;
      return nextProjects;
    });
    return remoteProject.serverSync ?? null;
  }

  function clearAutomaticConflictRetries(projectId: string): void {
    for (const retryKey of automaticConflictRetries.current) {
      if (retryKey.startsWith(`${projectId}:`)) {
        automaticConflictRetries.current.delete(retryKey);
      }
    }
  }

  function requestServerSync(project: ScriptProject): void {
    void syncProjectSnapshot(project).catch(() => undefined);
  }

  const conflictRetrySignature = projects
    .filter((project) => project.serverSync?.status === "conflict")
    .map((project) => `${project.id}:${project.updatedAt}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!isReady || serverPersistenceAvailable !== true || !conflictRetrySignature) return;
    for (const project of projects) {
      if (project.serverSync?.status !== "conflict") continue;
      const retryKey = `${project.id}:${project.updatedAt}`;
      if (automaticConflictRetries.current.has(retryKey)) continue;
      automaticConflictRetries.current.add(retryKey);
      void syncProjectSnapshot(project).catch(() => undefined);
    }
  }, [conflictRetrySignature, isReady, serverPersistenceAvailable]);

  return (
    <ProjectContext.Provider
      value={{
        projects,
        isReady: isReady && (!requestedProjectId || projects.some(project => project.id === requestedProjectId)
          || serverPersistenceAvailable !== null || Boolean(storageError)),
        storageError,
        serverPersistenceAvailable,
        createProject,
        updateProject,
        syncProjectSnapshot,
        adoptServerProjectSnapshot,
        retryProjectSync,
        resolveProjectSyncConflict,
        deleteProject,
        getProject,
      }}
    >
      {authError ? (
        <main className="centered-state" role="alert"><h1>请重新进入剧本大师</h1><p>{authError}</p></main>
      ) : !authReady ? (
        <main className="centered-state" role="status">
          {authRetryError ? <>
            <p>{authRetryError}</p>
            <button className="primary-action" onClick={() => setAuthAttempt((attempt) => attempt + 1)}>重试登录验证</button>
          </> : "正在验证主站登录状态…"}
        </main>
      ) : children}
    </ProjectContext.Provider>
  );
}

function syncStateForSnapshot(
  current: ScriptProject,
  synchronizedSnapshot: ScriptProject,
  serverSync: ProjectServerSyncState,
): ProjectServerSyncState {
  if ((current.planningRevisionEpoch ?? 0) !== (synchronizedSnapshot.planningRevisionEpoch ?? 0)
    || (current.serverSync?.workspaceRevision ?? 0) > serverSync.workspaceRevision) {
    return current.serverSync ?? serverSync;
  }
  if (current.updatedAt <= synchronizedSnapshot.updatedAt) return serverSync;
  return {
    ...serverSync,
    status: "syncing",
    error: undefined,
  };
}


function mergeHydratedProject(
  projects: ScriptProject[],
  remote: ScriptProject,
  previous?: ScriptProject,
): ScriptProject[] {
  const current = projects.find(project => project.id === remote.id);
  if (!previous) return mergeProjects(projects, [remote]).projects;
  // A deleted or edited project cannot be resurrected or replaced by a late
  // ancillary response, including edits whose timestamp has not changed.
  if (!current || projectContentSnapshot(current) !== projectContentSnapshot(previous)
    || (current.planningRevisionEpoch ?? 0) > (remote.planningRevisionEpoch ?? 0)
    || (current.serverSync?.workspaceRevision ?? 0) > (remote.serverSync?.workspaceRevision ?? 0)) return projects;
  return projects.map(project => project.id === remote.id ? remote : project);
}

function mergeProjects(
  localProjects: ScriptProject[],
  serverProjects: ScriptProject[],
): { projects: ScriptProject[]; localNewer: ScriptProject[] } {
  const merged = new Map(localProjects.map((project) => [project.id, project]));
  const localNewer: ScriptProject[] = [];
  for (const remote of serverProjects) {
    const local = merged.get(remote.id);
    if (!local || (remote.planningRevisionEpoch ?? 0) > (local.planningRevisionEpoch ?? 0)) {
      merged.set(remote.id, remote);
      continue;
    }
    // A delayed hydration response or clock skew must never roll back an
    // acknowledged planning epoch, even when its timestamp appears newer.
    if ((remote.planningRevisionEpoch ?? 0) < (local.planningRevisionEpoch ?? 0)
      || (remote.serverSync?.workspaceRevision ?? 0) < (local.serverSync?.workspaceRevision ?? 0)) continue;
    if (remote.updatedAt > local.updatedAt) {
      merged.set(remote.id, remote);
      continue;
    }
    if (local.updatedAt > remote.updatedAt) {
      localNewer.push(local);
      continue;
    }
    merged.set(remote.id, {
      ...local,
      serverSync: remote.serverSync,
    });
  }
  for (const local of localProjects) {
    if (!serverProjects.some((remote) => remote.id === local.id)) {
      localNewer.push(local);
    }
  }
  return { projects: [...merged.values()], localNewer };
}

export function useProjects(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProjects must be used within ProjectProvider.");
  return value;
}
