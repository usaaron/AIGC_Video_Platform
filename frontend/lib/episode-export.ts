import { createScreenplayDocxBlob } from "./episode-docx.ts";
import {
  applyOverseasCharacterNames,
  englishDialogueTranslations,
  mergeOverseasCharacterNames,
} from "./bilingual-dialogue.ts";
import {
  clientDialogueSpeaker,
  clientEpisodeTitle,
  clientSceneHeading,
} from "./client-screenplay-format.ts";
import type { BilingualScriptView, GeneratedDraft } from "./types.ts";
import type JSZip from "jszip";

export type EpisodeDocumentFormat = "markdown" | "text" | "word";

export interface EpisodeDocumentSource {
  episodeNumber: number;
  draft: GeneratedDraft;
  bilingualView?: BilingualScriptView;
}

export interface ArchiveAttachment {
  filename: string;
  content: string | Blob | ArrayBuffer;
}

export function toEpisodeMarkdown(
  draft: GeneratedDraft,
  episodeNumber: number,
  bilingualView?: BilingualScriptView,
): string {
  if (isChineseDraft(draft)) {
    const translations = englishDialogueTranslations(bilingualView);
    const characterNames = mergeOverseasCharacterNames(new Map(), bilingualView);
    const chineseEpisodeTitle = clientEpisodeTitle(draft.title);
    const scenes = draft.scenes.map((scene, sceneIndex) => {
      const actions = scene.character_actions.map((action) => (
        `△ ${applyOverseasCharacterNames(action, characterNames)}`
      )).join("\n\n");
      const dialogues = scene.dialogues.map((line, dialogueIndex) => {
        const prefix = `scenes.${sceneIndex}.dialogues.${dialogueIndex}`;
        const { speaker, marker } = clientDialogueSpeaker(
          translations?.get(`${prefix}.character_name`) ?? line.character_name,
          line.character_name,
        );
        const cue = line.intent.trim() ? `\n（${line.intent.trim()}）` : "";
        const translatedText = translations?.get(`${prefix}.text`);
        return `**${speaker}${marker ? ` (${marker})` : ""}**${cue}\n${translatedText
          ? `${translatedText}\n\n> 中文：${line.text}`
          : line.text}`;
      }).join("\n\n");
      const heading = clientSceneHeading(scene.setting_hint ?? scene.setting ?? scene.slug);
      return `## ${heading}\n\n${actions}\n\n${dialogues}`;
    }).join("\n\n");
    return [
      `# 第${episodeNumber}集${chineseEpisodeTitle ? `《${chineseEpisodeTitle}》` : ""}`,
      `预计时长：${episodeDurationSeconds(draft)}秒`,
      "FADE IN / 淡入：",
      scenes,
      "FADE OUT / 淡出。",
      `（尾钩：${episodeEndingHook(draft)}）`,
      "",
    ].filter(Boolean).join("\n\n");
  }

  const characters = draft.characters.map((character) => `- **${character.name}** (${character.role}): ${character.description}`).join("\n");
  const scenes = draft.scenes.map((scene) => {
    const causality = scene.scene_causality ? `**Goal:** ${scene.scene_causality.goal}\n\n**Conflict:** ${scene.scene_causality.conflict}\n\n**Outcome:** ${scene.scene_causality.outcome}\n\n` : "";
    const actions = scene.character_actions.map((action) => `- ${action}`).join("\n");
    const dialogues = scene.dialogues.map((line) => `**${line.character_name}** _(${line.intent})_: ${line.text}`).join("\n\n");
    return `## Scene ${scene.scene_number}: ${scene.slug}\n\n${scene.purpose}\n\n${scene.beat_summary}\n\n${causality}### Actions\n\n${actions}\n\n### Dialogue\n\n${dialogues}`;
  }).join("\n\n");
  return `# Episode ${episodeNumber}\n\n${draft.logline}\n\n**Hook:** ${draft.hook}\n\n## Characters\n\n${characters}\n\n${scenes}\n\n## Next Episode Question\n\n${draft.next_episode_question ?? "-"}\n`;
}

export function toEpisodePlainText(
  draft: GeneratedDraft,
  episodeNumber: number,
  bilingualView?: BilingualScriptView,
): string {
  if (isChineseDraft(draft)) {
    const translations = englishDialogueTranslations(bilingualView);
    const characterNames = mergeOverseasCharacterNames(new Map(), bilingualView);
    const chineseEpisodeTitle = clientEpisodeTitle(draft.title);
    const scenes = draft.scenes.map((scene, sceneIndex) => [
      clientSceneHeading(scene.setting_hint ?? scene.setting ?? scene.slug),
      ...scene.character_actions.map((action) => (
        `△ ${applyOverseasCharacterNames(action, characterNames)}`
      )),
      ...scene.dialogues.flatMap((line, dialogueIndex) => {
        const prefix = `scenes.${sceneIndex}.dialogues.${dialogueIndex}`;
        const { speaker, marker } = clientDialogueSpeaker(
          translations?.get(`${prefix}.character_name`) ?? line.character_name,
          line.character_name,
        );
        const translatedText = translations?.get(`${prefix}.text`);
        return [
          `${speaker}${marker ? ` (${marker})` : ""}`,
          line.intent.trim() ? `（${line.intent.trim()}）` : "",
          translatedText ?? line.text,
          translatedText ? `中文：${line.text}` : "",
        ];
      }),
    ].filter(Boolean).join("\n\n")).join("\n\n");
    return [
      `第${episodeNumber}集${chineseEpisodeTitle ? `《${chineseEpisodeTitle}》` : ""}`,
      `预计时长：${episodeDurationSeconds(draft)}秒`,
      "FADE IN / 淡入：",
      scenes,
      "FADE OUT / 淡出。",
      `（尾钩：${episodeEndingHook(draft)}）`,
      "",
    ].filter(Boolean).join("\n\n");
  }

  const characters = draft.characters.map((character) => (
    `${character.name} (${character.role}): ${character.description}`
  ));
  const scenes = draft.scenes.map((scene) => {
    const causality = scene.scene_causality
      ? [
          `Goal: ${scene.scene_causality.goal}`,
          `Conflict: ${scene.scene_causality.conflict}`,
          `Outcome: ${scene.scene_causality.outcome}`,
        ]
      : [];
    return [
      `Scene ${scene.scene_number}: ${scene.slug}`,
      scene.purpose,
      scene.beat_summary,
      ...causality,
      "Actions",
      ...scene.character_actions,
      "Dialogue",
      ...scene.dialogues.flatMap((line) => [
        `${line.character_name} (${line.intent})`,
        line.text,
      ]),
    ].filter(Boolean).join("\n\n");
  });
  return [
    `Episode ${episodeNumber}`,
    draft.logline,
    `Hook: ${draft.hook}`,
    "Characters",
    ...characters,
    ...scenes,
    "Next Episode Question",
    draft.next_episode_question ?? "-",
  ].filter(Boolean).join("\n\n") + "\n";
}

export function episodeDocumentFilename(
  projectTitle: string,
  episodeNumber: number,
  format: EpisodeDocumentFormat,
): string {
  const extension = format === "markdown" ? "md" : format === "text" ? "txt" : "docx";
  const paddedEpisodeNumber = String(episodeNumber).padStart(2, "0");
  return `${safeFilename(projectTitle)}-episode-${paddedEpisodeNumber}.${extension}`;
}

export function toSeriesDocument(
  projectTitle: string,
  episodes: EpisodeDocumentSource[],
  format: EpisodeDocumentFormat,
  preface = "",
): string {
  if (format === "word") {
    throw new Error("Word documents must be built with createScreenplayDocxBlob.");
  }
  const documents = episodes.map(({ draft, episodeNumber, bilingualView }) => (
    format === "markdown"
      ? toEpisodeMarkdown(draft, episodeNumber, bilingualView)
      : toEpisodePlainText(draft, episodeNumber, bilingualView)
  ));
  if (format === "markdown") {
    return [`# ${projectTitle}`, preface, documents.join("\n\n---\n\n")]
      .filter(Boolean)
      .join("\n\n");
  }
  return [projectTitle, preface, documents.join("\n\n========================================\n\n")]
    .filter(Boolean)
    .join("\n\n");
}

export async function createEpisodeArchive(
  projectTitle: string,
  episodes: EpisodeDocumentSource[],
  formats: EpisodeDocumentFormat[],
  attachments: ArchiveAttachment[] = [],
): Promise<Blob> {
  if (!formats.length && !attachments.length) {
    throw new Error("At least one document format or attachment is required.");
  }
  const { default: JSZip } = await import("jszip");
  const archive = new JSZip();
  for (const format of formats) {
    const directory = archive.folder(
      format === "markdown" ? "markdown" : format === "text" ? "text" : "word",
    );
    if (!directory) continue;
    for (const { draft, episodeNumber, bilingualView } of episodes) {
      const content = format === "word"
        ? await createScreenplayDocxBlob(projectTitle, [{ draft, episodeNumber, bilingualView }])
        : format === "markdown"
          ? toEpisodeMarkdown(draft, episodeNumber, bilingualView)
          : toEpisodePlainText(draft, episodeNumber, bilingualView);
      directory.file(
        episodeDocumentFilename(projectTitle, episodeNumber, format),
        content instanceof Blob ? await content.arrayBuffer() : content,
      );
    }
  }
  await addArchiveAttachments(archive, attachments);
  return archive.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function createCollectionArchive(
  projectTitle: string,
  documents: Array<{ format: EpisodeDocumentFormat; content: string | Blob }>,
  attachments: ArchiveAttachment[] = [],
): Promise<Blob> {
  if (!documents.length && !attachments.length) {
    throw new Error("At least one document or attachment is required.");
  }
  const { default: JSZip } = await import("jszip");
  const archive = new JSZip();
  for (const document of documents) {
    archive.file(
      collectionDocumentFilename(projectTitle, document.format),
      document.content instanceof Blob
        ? await document.content.arrayBuffer()
        : document.content,
    );
  }
  await addArchiveAttachments(archive, attachments);
  return archive.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export function collectionDocumentFilename(
  projectTitle: string,
  format: EpisodeDocumentFormat,
): string {
  const extension = format === "markdown" ? "md" : format === "text" ? "txt" : "docx";
  return `${safeFilename(projectTitle)}-full-script.${extension}`;
}

export function seriesArchiveFilename(
  projectTitle: string,
  mode: "episodes" | "collection",
): string {
  return `${safeFilename(projectTitle)}-${mode === "episodes" ? "episodes" : "full-script"}.zip`;
}

function isChineseDraft(draft: GeneratedDraft): boolean {
  return /^(zh|zh-cn|zh-hans|chinese|中文)/i.test(draft.language.trim());
}

function episodeDurationSeconds(draft: GeneratedDraft): number {
  const metadata = draft.llm_metadata;
  const estimated = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? Number((metadata as Record<string, unknown>).estimated_duration_seconds)
    : Number.NaN;
  if (Number.isFinite(estimated) && estimated >= 75 && estimated <= 115) {
    return Math.round(estimated);
  }
  const target = Number(draft.target_duration_seconds);
  return Number.isFinite(target) && target >= 75 && target <= 115
    ? Math.round(target)
    : 90;
}

function episodeEndingHook(draft: GeneratedDraft): string {
  return draft.continuation_hook?.ending_hook_summary
    ?? draft.next_episode_question
    ?? draft.hook;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-") || "script-project";
}

async function addArchiveAttachments(
  archive: JSZip,
  attachments: ArchiveAttachment[],
): Promise<void> {
  for (const attachment of attachments) {
    const content = attachment.content instanceof Blob
      ? await attachment.content.arrayBuffer()
      : attachment.content;
    archive.file(attachment.filename, content);
  }
}
