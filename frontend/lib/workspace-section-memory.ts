import { projectStorageKey } from "@/lib/host-session";

export type WorkspaceSectionMemoryId = "story-bible" | "planning" | "script" | "synopsis-progress";

export type WorkspaceSectionChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  quote?: unknown;
};

const STORAGE_PREFIX = "ai-comic-content-os.workspace-memory.v1";
const memoryCache = new Map<string, WorkspaceSectionChatMessage[]>();
const memoryListeners = new Map<string, Set<() => void>>();

function storageKey(projectId: string, section: WorkspaceSectionMemoryId): string {
  return projectStorageKey(`${STORAGE_PREFIX}:${projectId}:${section}`);
}

export function loadWorkspaceChatMessages(
  projectId: string,
  section: WorkspaceSectionMemoryId,
): WorkspaceSectionChatMessage[] {
  if (typeof window === "undefined") return [];
  const key = storageKey(projectId, section);
  const cached = memoryCache.get(key);
  if (cached) return cached.map((message) => ({ ...message }));
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      memoryCache.set(key, []);
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      memoryCache.set(key, []);
      return [];
    }
    const messages = parsed
      .filter((item): item is WorkspaceSectionChatMessage => (
        Boolean(item)
        && typeof item === "object"
        && (item as WorkspaceSectionChatMessage).role !== undefined
        && ((item as WorkspaceSectionChatMessage).role === "assistant"
          || (item as WorkspaceSectionChatMessage).role === "user")
        && typeof (item as WorkspaceSectionChatMessage).text === "string"
      ))
      .slice(-100);
    memoryCache.set(key, messages);
    return messages.map((message) => ({ ...message }));
  } catch {
    memoryCache.set(key, []);
    return [];
  }
}

export function subscribeWorkspaceChatMessages(
  projectId: string,
  section: WorkspaceSectionMemoryId,
  listener: () => void,
): () => void {
  const key = storageKey(projectId, section);
  const listeners = memoryListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  memoryListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) memoryListeners.delete(key);
  };
}

export function saveWorkspaceChatMessages(
  projectId: string,
  section: WorkspaceSectionMemoryId,
  messages: readonly WorkspaceSectionChatMessage[],
): void {
  if (typeof window === "undefined") return;
  const key = storageKey(projectId, section);
  const nextMessages = messages.slice(-100).map((message) => ({ ...message }));
  memoryCache.set(key, nextMessages);
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify(nextMessages),
    );
  } catch {
    // Chat history is a convenience; a full local-storage error must not block editing.
  }
  memoryListeners.get(key)?.forEach((listener) => listener());
}
