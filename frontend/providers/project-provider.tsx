"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

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
  retryProjectSync: (projectId: string) => Promise<ProjectServerSyncState | null>;
  resolveProjectSyncConflict: (
    projectId: string,
    resolution: "use_local" | "use_cloud",
  ) => Promise<ProjectServerSyncState | null>;
  deleteProject: (projectId: string) => Promise<boolean>;
  getProject: (projectId: string) => ScriptProject | undefined;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

function sortProjects(projects: ScriptProject[]): ScriptProject[] {
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ScriptProject[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [serverPersistenceAvailable, setServerPersistenceAvailable] = useState<boolean | null>(null);
  const automaticConflictRetries = useRef(new Set<string>());
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  useEffect(() => {
    let active = true;
    listStoredProjects()
      .then(async (localProjects) => {
        if (!active) return;
        setProjects(localProjects);
        setIsReady(true);

        const serverResult = await loadServerProjects();
        if (!active) return;
        setServerPersistenceAvailable(serverResult.available);
        if (!serverResult.available) {
          const offlineProjects = localProjects.map((project) => (
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
          setProjects(sortProjects(offlineProjects));
          await Promise.all(offlineProjects.map((project) => saveStoredProject(project)));
          return;
        }

        const merged = mergeProjects(localProjects, serverResult.projects);
        setProjects(sortProjects(merged.projects));
        await Promise.all(merged.projects.map((project) => saveStoredProject(project)));
        merged.localNewer.forEach((project) => requestServerSync(project));
      })
      .catch((error: unknown) => {
        if (active) {
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
    };
  }, []);

  async function createProject(draft: ProjectDraft): Promise<ScriptProject> {
    const now = new Date().toISOString();
    const generationSettings = draft.generationSettings ?? DEFAULT_GENERATION_SETTINGS;
    const marketProfile = marketProfileForReleaseRegion(generationSettings.releaseRegion);
    const project: ScriptProject = {
      id: crypto.randomUUID(),
      ...draft,
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
    setProjects((current) => sortProjects([project, ...current]));
    requestServerSync(project);
    return project;
  }

  function updateProject(
    projectId: string,
    patch: Partial<ScriptProject> | ((current: ScriptProject) => Partial<ScriptProject>),
  ): Promise<boolean> {
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

        const nextMarketProfile = resolvedPatch.generationSettings
          ? marketProfileForReleaseRegion(resolvedPatch.generationSettings.releaseRegion)
          : existing.marketProfile;
        const updated: ScriptProject = {
          ...existing,
          ...resolvedPatch,
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
          .then(() => resolve(true))
          .catch((error: unknown) => {
            setStorageError(
              error instanceof Error ? error.message : "Unable to save the project.",
            );
            resolve(false);
          });
        requestServerSync(updated);
        return sortProjects(
          current.map((project) => (project.id === projectId ? updated : project)),
        );
      });
    });
  }

  async function deleteProject(projectId: string): Promise<boolean> {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return true;
    const result = await deleteProjectPermanentlyOnServer(project);
    if (!result.deleted) {
      setProjects((current) => current.map((item) => (
        item.id === projectId ? { ...item, serverSync: result.serverSync } : item
      )));
      setServerPersistenceAvailable(result.serverSync.status !== "unavailable");
      setStorageError(
        result.serverSync.error ?? "Unable to delete the project safely.",
      );
      return false;
    }
    setProjects((current) => current.filter((project) => project.id !== projectId));
    try {
      await deleteStoredProject(projectId);
    } catch (error: unknown) {
      setStorageError(
        error instanceof Error ? error.message : "Unable to delete the project.",
      );
      return false;
    }
    return true;
  }

  function getProject(projectId: string): ScriptProject | undefined {
    return projects.find((project) => project.id === projectId);
  }

  async function syncProjectSnapshot(
    project: ScriptProject,
    options: { forceWorkspaceOverwrite?: boolean } = {},
  ): Promise<ProjectServerSyncState> {
    setProjects((current) => current.map((item) => (
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
    )));
    const serverSync = options.forceWorkspaceOverwrite
      ? await forceWorkspaceOverwrite(project)
      : await queueProjectServerSync(project);
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
    setProjects((current) => sortProjects(current.map((item) => {
      if (item.id !== project.id) return item;
      return {
        ...item,
        serverSync: syncStateForSnapshot(item, project, serverSync),
      };
    })));
    return serverSync;
  }

  async function retryProjectSync(
    projectId: string,
  ): Promise<ProjectServerSyncState | null> {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return null;
    return syncProjectSnapshot(project);
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
    setProjects((current) => sortProjects(current.map((item) => (
      item.id === projectId ? remoteProject : item
    ))));
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
        isReady,
        storageError,
        serverPersistenceAvailable,
        createProject,
        updateProject,
        syncProjectSnapshot,
        retryProjectSync,
        resolveProjectSyncConflict,
        deleteProject,
        getProject,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

function syncStateForSnapshot(
  current: ScriptProject,
  synchronizedSnapshot: ScriptProject,
  serverSync: ProjectServerSyncState,
): ProjectServerSyncState {
  if (current.updatedAt <= synchronizedSnapshot.updatedAt) return serverSync;
  return {
    ...serverSync,
    status: "syncing",
    error: undefined,
  };
}


function mergeProjects(
  localProjects: ScriptProject[],
  serverProjects: ScriptProject[],
): { projects: ScriptProject[]; localNewer: ScriptProject[] } {
  const merged = new Map(localProjects.map((project) => [project.id, project]));
  const localNewer: ScriptProject[] = [];
  for (const remote of serverProjects) {
    const local = merged.get(remote.id);
    if (!local || remote.updatedAt > local.updatedAt) {
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
