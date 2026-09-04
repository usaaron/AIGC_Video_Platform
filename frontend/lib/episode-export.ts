import { createScreenplayDocxBlob } from "./episode-docx.ts";
import {
  applyChineseCharacterNames,
  mergeOverseasCharacterNames,
  overseasNarrativeText,
  overseasDialoguePresentation,
  overseasDialogueSpeaker,
  overseasDialogueTextPair,
} from "./bilingual-dialogue.ts";
import {
  clientEpisodeTitle,
  clientSceneHeading,
} from "./client-screenplay-format.ts";
import { orderedScreenplayBody } from "./screenplay-body-order.ts";
import { safeFilename } from "./filename.ts";
import { draftMetadataCoercedNumber } from "./draft-metadata.ts";
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
  const dialoguePresentation = overseasDialoguePresentation(bilingualView);
  const characterNames = mergeOverseasCharacterNames(new Map(), bilingualView);
  const chineseEpisodeTitle = applyChineseCharacterNames(
    clientEpisodeTitle(
      overseasNarrativeText(dialoguePresentation, "title", draft.title),
    ),
    characterNames,
  );
  const scenes = draft.scenes.map((scene, sceneIndex) => {
    const body = orderedScreenplayBody(scene).map((item) => {
      if (item.kind === "action") {
        return `△ ${applyChineseCharacterNames(
          overseasNarrativeText(
            dialoguePresentation,
            `scenes.${sceneIndex}.character_actions.${item.index}`,
            item.action,
          ),
          characterNames,
        )}`;
      }
      const line = item.dialogue;
      const dialogueIndex = item.index;
      const prefix = `scenes.${sceneIndex}.dialogues.${dialogueIndex}`;
      const { speaker, marker } = overseasDialogueSpeaker(
        dialoguePresentation,
        `${prefix}.character_name`,
        line.character_name,
        characterNames,
      );
      const cue = line.intent.trim()
        ? `\n（${applyChineseCharacterNames(
          overseasNarrativeText(dialoguePresentation, `${prefix}.intent`, line.intent.trim()),
          characterNames,
        )}）`
        : "";
      const text = overseasDialogueTextPair(
        dialoguePresentation,
        `${prefix}.text`,
        line.text,
      );
      return `**${speaker}${marker ? ` (${marker})` : ""}**${cue}\n${text.english}${text.chinese
        ? `\n\n> 中文：${text.chinese}`
        : ""}`;
    }).join("\n\n");
    const heading = applyChineseCharacterNames(
      clientSceneHeading(overseasNarrativeText(
        dialoguePresentation,
        scene.setting_hint
          ? `scenes.${sceneIndex}.setting_hint`
          : `scenes.${sceneIndex}.slug`,
        scene.setting_hint ?? scene.setting ?? scene.slug,
      )),
      characterNames,
    );
    return `## ${heading}\n\n${body}`;
  }).join("\n\n");
  return [
    `# 第${episodeNumber}集${chineseEpisodeTitle ? `《${chineseEpisodeTitle}》` : ""}`,
    `预计时长：${episodeDurationSeconds(draft)}秒`,
    "FADE IN / 淡入：",
    scenes,
    "FADE OUT / 淡出。",
    `（尾钩：${applyChineseCharacterNames(episodeEndingHook(draft), characterNames)}）`,
    "",
  ].filter(Boolean).join("\n\n");
}

export function toEpisodePlainText(
  draft: GeneratedDraft,
  episodeNumber: number,
  bilingualView?: BilingualScriptView,
): string {
  const dialoguePresentation = overseasDialoguePresentation(bilingualView);
  const characterNames = mergeOverseasCharacterNames(new Map(), bilingualView);
  const chineseEpisodeTitle = applyChineseCharacterNames(
    clientEpisodeTitle(
      overseasNarrativeText(dialoguePresentation, "title", draft.title),
    ),
    characterNames,
  );
  const scenes = draft.scenes.map((scene, sceneIndex) => [
    applyChineseCharacterNames(
      clientSceneHeading(overseasNarrativeText(
        dialoguePresentation,
        scene.setting_hint
          ? `scenes.${sceneIndex}.setting_hint`
          : `scenes.${sceneIndex}.slug`,
        scene.setting_hint ?? scene.setting ?? scene.slug,
      )),
      characterNames,
    ),
    ...orderedScreenplayBody(scene).flatMap((item) => {
      if (item.kind === "action") {
        return [`△ ${applyChineseCharacterNames(
          overseasNarrativeText(
            dialoguePresentation,
            `scenes.${sceneIndex}.character_actions.${item.index}`,
            item.action,
          ),
          characterNames,
        )}`];
      }
      const line = item.dialogue;
      const dialogueIndex = item.index;
      const prefix = `scenes.${sceneIndex}.dialogues.${dialogueIndex}`;
      const { speaker, marker } = overseasDialogueSpeaker(
        dialoguePresentation,
        `${prefix}.character_name`,
        line.character_name,
        characterNames,
      );
      const text = overseasDialogueTextPair(
        dialoguePresentation,
        `${prefix}.text`,
        line.text,
      );
      return [
        `${speaker}${marker ? ` (${marker})` : ""}`,
        line.intent.trim()
          ? `（${applyChineseCharacterNames(
            overseasNarrativeText(dialoguePresentation, `${prefix}.intent`, line.intent.trim()),
            characterNames,
          )}）`
          : "",
        text.english,
        text.chinese ? `中文：${text.chinese}` : "",
      ];
    }),
  ].filter(Boolean).join("\n\n")).join("\n\n");
  return [
    `第${episodeNumber}集${chineseEpisodeTitle ? `《${chineseEpisodeTitle}》` : ""}`,
    `预计时长：${episodeDurationSeconds(draft)}秒`,
    "FADE IN / 淡入：",
    scenes,
    "FADE OUT / 淡出。",
    `（尾钩：${applyChineseCharacterNames(episodeEndingHook(draft), characterNames)}）`,
    "",
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

function episodeDurationSeconds(draft: GeneratedDraft): number {
  const estimated = draftMetadataCoercedNumber(draft, "estimated_duration_seconds") ?? Number.NaN;
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
