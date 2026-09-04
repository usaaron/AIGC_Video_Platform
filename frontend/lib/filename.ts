/** Convert a user-facing title into a stable, filesystem-safe download name. */
export function safeFilename(value: string, fallback = "script-project"): string {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-") || fallback;
}
