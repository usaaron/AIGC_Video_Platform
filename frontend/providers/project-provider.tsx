"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  deleteStoredProject,
  listStoredProjects,
  saveStoredProject,
} from "@/lib/project-store";
import {
  archiveProjectOnServer,
  loadServerProjects,
  queueProjectServerSync,
} from "@/lib/project-sync";
import {
  CURRENT_MARKET_PROFILE,
  DEFAULT_GENERATION_SETTINGS,
  type ProjectDraft,
  type ScriptProject,
} from "@/lib/types";

interface ProjectContextValue {
  projects: ScriptProject[];
  isReady: boolean;
  storageError: string | null;
  serverPersistenceAvailable: boolean | null;
  createProject: (draft: ProjectDraft) => Promise<ScriptProject>;
  updateProject: (projectId: string, patch: Partial<ScriptProject>) => void;
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
        if (!serverResult.available) return;

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
    const project: ScriptProject = {
      id: crypto.randomUUID(),
      ...draft,
      marketProfile: CURRENT_MARKET_PROFILE,
      generationSettings: {
        ...generationSettings,
        outputLanguage: CURRENT_MARKET_PROFILE === "cn_mainland"
          ? "zh"
          : generationSettings.outputLanguage,
      },
      episodes: [],
      generationBatches: [],
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

  function updateProject(projectId: string, patch: Partial<ScriptProject>): void {
    setProjects((current) => {
      const existing = current.find((project) => project.id === projectId);
      if (!existing) return current;

      const updated: ScriptProject = {
        ...existing,
        ...patch,
        generationSettings: patch.generationSettings
          ? {
              ...patch.generationSettings,
              outputLanguage: existing.marketProfile === "cn_mainland"
                ? "zh"
                : patch.generationSettings.outputLanguage,
            }
          : existing.generationSettings,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        serverSync: {
          status: "syncing",
          projectRevision: existing.serverSync?.projectRevision ?? 0,
          workspaceRevision: existing.serverSync?.workspaceRevision ?? 0,
          lastSyncedAt: existing.serverSync?.lastSyncedAt,
        },
      };
      void saveStoredProject(updated).catch((error: unknown) => {
        setStorageError(
          error instanceof Error ? error.message : "Unable to save the project.",
        );
      });
      requestServerSync(updated);
      return sortProjects(
        current.map((project) => (project.id === projectId ? updated : project)),
      );
    });
  }

  async function deleteProject(projectId: string): Promise<boolean> {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return true;
    const result = await archiveProjectOnServer(project);
    if (!result.archived) {
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
    return projects.find((project) => (
      project.id === projectId && project.marketProfile === CURRENT_MARKET_PROFILE
    ));
  }

  function requestServerSync(project: ScriptProject): void {
    void queueProjectServerSync(project).then((serverSync) => {
      setServerPersistenceAvailable(serverSync.status !== "unavailable");
      setProjects((current) => {
        const existing = current.find((item) => item.id === project.id);
        if (!existing) return current;
        const syncState = existing.updatedAt === project.updatedAt
          ? serverSync
          : {
              ...serverSync,
              status: "syncing" as const,
              error: undefined,
            };
        const updated = { ...existing, serverSync: syncState };
        void saveStoredProject(updated).catch((error: unknown) => {
          setStorageError(
            error instanceof Error ? error.message : "Unable to save sync state.",
          );
        });
        return sortProjects(
          current.map((item) => (item.id === project.id ? updated : item)),
        );
      });
    });
  }

  return (
    <ProjectContext.Provider
      value={{
        projects: projects.filter((project) => (
          project.marketProfile === CURRENT_MARKET_PROFILE
        )),
        isReady,
        storageError,
        serverPersistenceAvailable,
        createProject,
        updateProject,
        deleteProject,
        getProject,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
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
    if (local.updatedAt > remote.updatedAt) localNewer.push(local);
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
