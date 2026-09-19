import type { StorySynopsis } from "./types.ts";

/** Keep author reservations even after a manual edit invalidates model advice. */
export function synopsisAuthorNotes(synopsis: StorySynopsis): string[] {
  const brief = synopsis.conversation?.brief;
  return [...new Set([
    ...(brief?.unresolved ?? []).map((value) => `待作者决定：${value}`),
    ...(brief?.must_keep ?? []).map((value) => `作者要求保留：${value}`),
    ...(brief?.must_avoid ?? []).map((value) => `作者要求避免：${value}`),
    ...(synopsis.review?.issues ?? []).map((issue) => issue.message),
  ].map((value) => value.trim()).filter(Boolean))];
}

export function synopsisNotesForRequest(synopsis: StorySynopsis): string[] {
  const notes = synopsisAuthorNotes(synopsis);
  if (notes.length > 160 || notes.some((note) => note.length > 3000)) {
    throw new Error("梗概的创作要求过长，请先整理重复的要求；原稿和讨论会保留。");
  }
  return notes;
}
