// Plain anchors leave the independent Next base path and return to the host.
export function hostWorkspaceHref(projectId?: string | null): string {
  const root = process.env.NEXT_PUBLIC_HOST_HOME_URL?.trim()
    || (process.env.NEXT_PUBLIC_BASE_PATH ? "/" : "http://localhost:5173/");
  if (!projectId) return root;
  return `${root}${root.includes("?") ? "&" : "?"}${new URLSearchParams({ projectId, view: "script" })}`;
}
