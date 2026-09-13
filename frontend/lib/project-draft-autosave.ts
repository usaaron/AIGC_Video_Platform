import type { ProjectDraft } from "./types.ts";

export type ProjectDraftSaveState = "idle" | "saving" | "saved" | "error";

export function createProjectDraftAutosave(
  persist: (projectId: string, draft: ProjectDraft) => Promise<boolean>,
  onStateChange: (state: ProjectDraftSaveState) => void,
) {
  let latestRequest = 0;
  let state: ProjectDraftSaveState = "idle";

  function publish(next: ProjectDraftSaveState) {
    state = next;
    onStateChange(next);
  }

  return {
    get state(): ProjectDraftSaveState {
      return state;
    },
    async save(projectId: string, draft: ProjectDraft): Promise<boolean> {
      const request = ++latestRequest;
      publish("saving");
      let saved = false;
      try {
        saved = await persist(projectId, draft);
      } catch {
        saved = false;
      }
      if (request === latestRequest) publish(saved ? "saved" : "error");
      return saved;
    },
    invalidate() {
      // Navigation detaches the editor's status updates; the queued save continues.
      latestRequest += 1;
    },
  };
}
