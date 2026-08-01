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
import { DEFAULT_GENERATION_SETTINGS, type ProjectDraft, type ScriptProject } from "@/lib/types";

interface ProjectContextValue {
  projects: ScriptProject[];
  isReady: boolean;
  storageError: string | null;
  createProject: (draft: ProjectDraft) => Promise<ScriptProject>;
  updateProject: (projectId: string, patch: Partial<ScriptProject>) => void;
  deleteProject: (projectId: string) => void;
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

  useEffect(() => {
    let active = true;
    listStoredProjects()
      .then((items) => {
        if (active) setProjects(items);
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
    const project: ScriptProject = {
      id: crypto.randomUUID(),
      ...draft,
      generationSettings: draft.generationSettings ?? DEFAULT_GENERATION_SETTINGS,
      episodes: [],
      generationBatches: [],
      activeEpisodeNumber: 1,
      storyLines: [],
      characterRelationships: [],
      status: "idea",
      createdAt: now,
      updatedAt: now,
    };
    await saveStoredProject(project);
    setProjects((current) => sortProjects([project, ...current]));
    return project;
  }

  function updateProject(projectId: string, patch: Partial<ScriptProject>): void {
    setProjects((current) => {
      const existing = current.find((project) => project.id === projectId);
      if (!existing) return current;

      const updated: ScriptProject = {
        ...existing,
        ...patch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      void saveStoredProject(updated).catch((error: unknown) => {
        setStorageError(
          error instanceof Error ? error.message : "Unable to save the project.",
        );
      });
      return sortProjects(
        current.map((project) => (project.id === projectId ? updated : project)),
      );
    });
  }

  function deleteProject(projectId: string): void {
    setProjects((current) => current.filter((project) => project.id !== projectId));
    void deleteStoredProject(projectId).catch((error: unknown) => {
      setStorageError(
        error instanceof Error ? error.message : "Unable to delete the project.",
      );
    });
  }

  function getProject(projectId: string): ScriptProject | undefined {
    return projects.find((project) => project.id === projectId);
  }

  return (
    <ProjectContext.Provider
      value={{
        projects,
        isReady,
        storageError,
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

export function useProjects(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProjects must be used within ProjectProvider.");
  return value;
}
