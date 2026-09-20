// Plain anchors leave the independent Next base path and return to the host.
export function hostWorkspaceHref(projectId?: string | null, view: "script" | "assets" | "storyboard" = "script"): string {
  const root = process.env.NEXT_PUBLIC_HOST_HOME_URL?.trim()
    || (process.env.NEXT_PUBLIC_BASE_PATH ? "/" : "http://localhost:5173/");
  if (!projectId) return root;
  return `${root}${root.includes("?") ? "&" : "?"}${new URLSearchParams({ projectId, view })}`;
}

export function isHostEmbedded(): boolean {
  return typeof window !== "undefined" && window.parent !== window && Boolean(process.env.NEXT_PUBLIC_HOST_LAUNCH_URL);
}

// The host names each iframe so its presentation survives client navigation and
// reloads. This selects UI behavior only; host-session still controls access.
export function isHostScriptWorkflow(): boolean {
  return isHostEmbedded() && window.name !== "seqora-script-master-standalone";
}

// Navigation/status only. Authentication and imports still use the existing API.
export function notifyHost(type: "ready" | "synced" | "navigate", projectId: string | null, view?: "script" | "assets" | "storyboard"): boolean {
  if (!isHostEmbedded()) return false;
  window.parent.postMessage({ type: `seqora:script-master:${type}`, projectId, ...(view ? { view } : {}) }, window.location.origin);
  return true;
}
