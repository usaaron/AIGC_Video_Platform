export function deriveProjectTitle(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (!normalized) return "Untitled script";

  const firstThought = normalized.split(/[.!?]/)[0]?.trim() || normalized;
  const words = firstThought.split(" ").slice(0, 6);
  const title = words.join(" ");
  return title.length > 44 ? `${title.slice(0, 41).trim()}...` : title;
}

export function formatRelativeTime(isoDate: string, locale: "en" | "zh" = "en"): string {
  const elapsed = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return locale === "zh" ? `${minutes} 分钟前` : `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "zh" ? `${hours} 小时前` : `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return locale === "zh" ? `${days} 天前` : `${days}d ago`;

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
  }).format(new Date(isoDate));
}
