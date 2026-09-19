type PendingProjectCopyKind = "bible" | "planning";

// The in-memory entry also masks a stale stored value if removal is denied.
const pendingCopies = new Map<string, string | null>();

function storageKey(sourceProjectId: string, kind: PendingProjectCopyKind): string {
  return `script-master:pending-project-copy:v1:${kind}:${encodeURIComponent(sourceProjectId)}`;
}

export function readPendingProjectCopy(sourceProjectId: string, kind: PendingProjectCopyKind): string | null {
  if (typeof window === "undefined") return null;
  const key = storageKey(sourceProjectId, kind);
  if (pendingCopies.has(key)) return pendingCopies.get(key) ?? null;
  try {
    const value = window.sessionStorage.getItem(key)?.trim();
    const copyId = value && value !== sourceProjectId ? value : null;
    pendingCopies.set(key, copyId);
    return copyId;
  } catch {
    return null;
  }
}

export function rememberPendingProjectCopy(sourceProjectId: string, kind: PendingProjectCopyKind, copyProjectId: string): void {
  if (typeof window === "undefined" || !copyProjectId.trim() || copyProjectId === sourceProjectId) return;
  const key = storageKey(sourceProjectId, kind);
  pendingCopies.set(key, copyProjectId);
  try { window.sessionStorage.setItem(key, copyProjectId); } catch { /* Same-page retry still reuses the copy. */ }
}

export function clearPendingProjectCopy(sourceProjectId: string, kind: PendingProjectCopyKind): void {
  if (typeof window === "undefined") return;
  const key = storageKey(sourceProjectId, kind);
  pendingCopies.set(key, null);
  try { window.sessionStorage.removeItem(key); } catch { /* The in-memory tombstone prevents stale reuse. */ }
}
