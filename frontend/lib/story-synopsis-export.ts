import type { StorySynopsis } from "./types.ts";
import { safeFilename } from "./filename.ts";
import { synopsisAuthorNotes } from "./story-synopsis-notes.ts";
import { synopsisHasPendingChanges } from "./story-synopsis-context.ts";

export function storySynopsisMarkdown(projectTitle: string, synopsis: StorySynopsis): string {
  const notes = synopsisAuthorNotes(synopsis);
  const status = synopsis.status === "confirmed"
    ? "已确认"
    : synopsis.status === "refining"
      ? "完善中"
      : "草稿";
  return [
    `# ${projectTitle} - 故事梗概`,
    "",
    `> ${status}版本 v${synopsis.version}`,
    "",
    synopsis.text.trim(),
    ...(synopsisHasPendingChanges(synopsis) ? ["", "> 讨论中的修改尚未写入以上梗概。"] : []),
    ...(notes.length ? ["", "## 创作要求与待完善事项", "", ...notes.map((note) => `- ${note}`)] : []),
    "",
    `> 更新时间：${synopsis.updatedAt}`,
  ].join("\n").trim() + "\n";
}

export function storySynopsisMarkdownFilename(projectTitle: string, version: number): string {
  return `${safeFilename(projectTitle, "story-synopsis")}-故事梗概-v${version}.md`;
}
