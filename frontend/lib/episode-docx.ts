import type { BilingualScriptView, GeneratedDraft } from "./types.ts";
import { draftMetadataCoercedNumber } from "./draft-metadata.ts";
import {
  applyChineseCharacterNames,
  mergeOverseasCharacterNames,
  overseasDialoguePresentation,
  overseasDialogueSpeaker,
  overseasDialogueTextPair,
  overseasNarrativeText,
} from "./bilingual-dialogue.ts";
import {
  clientEpisodeTitle,
  clientSceneHeading,
} from "./client-screenplay-format.ts";
import { orderedScreenplayBody } from "./screenplay-body-order.ts";

export interface ScreenplayDocxEpisode {
  episodeNumber: number;
  draft: GeneratedDraft;
  bilingualView?: BilingualScriptView;
}

const COLORS = {
  navy: "17365D",
  burgundy: "8B1E3F",
  bronze: "8A6A2F",
  charcoal: "202124",
  muted: "666666",
};

export async function createScreenplayDocxBlob(
  projectTitle: string,
  episodes: ScreenplayDocxEpisode[],
  options: { includeCover?: boolean } = {},
): Promise<Blob> {
  if (!episodes.length) throw new Error("At least one episode is required.");
  const docx = await import("docx");
  const children: InstanceType<typeof docx.Paragraph>[] = [];

  if (options.includeCover) {
    children.push(...coverParagraphs(docx, projectTitle, episodes));
    children.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
  }

  episodes.forEach((episode, index) => {
    if (index > 0) {
      children.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
    }
    children.push(...episodeParagraphs(docx, episode));
  });

  const document = new docx.Document({
    creator: "剧本大师",
    title: projectTitle,
    subject: "竖屏短剧正式执行稿",
    description: "合作方统一格式拍摄剧本",
    styles: {
      default: {
        document: {
          run: {
            font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "Microsoft YaHei" },
            size: 21,
            color: COLORS.charcoal,
          },
          paragraph: {
            spacing: { after: 100, line: 276 },
          },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: {
            top: docx.convertInchesToTwip(0.7),
            right: docx.convertInchesToTwip(0.8),
            bottom: docx.convertInchesToTwip(0.7),
            left: docx.convertInchesToTwip(0.8),
          },
        },
      },
      children,
    }],
  });
  return docx.Packer.toBlob(document);
}

function coverParagraphs(
  docx: typeof import("docx"),
  projectTitle: string,
  episodes: ScreenplayDocxEpisode[],
): InstanceType<typeof docx.Paragraph>[] {
  const totalSeconds = episodes.reduce(
    (total, episode) => total + episodeDurationSeconds(episode.draft),
    0,
  );
  const totalMinutes = Math.round(totalSeconds / 60);
  const firstEpisode = Math.min(...episodes.map((episode) => episode.episodeNumber));
  const lastEpisode = Math.max(...episodes.map((episode) => episode.episodeNumber));
  return [
    centeredParagraph(docx, [new docx.TextRun({
      text: projectTitle,
      bold: true,
      color: COLORS.navy,
      size: 54,
      font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "Microsoft YaHei" },
    })], 260),
    centeredParagraph(docx, [new docx.TextRun({
      text: `第${String(firstEpisode).padStart(2, "0")}–${String(lastEpisode).padStart(2, "0")}集 · 全维度执行稿`,
      bold: true,
      color: COLORS.burgundy,
      size: 29,
    })], 90),
    centeredParagraph(docx, [new docx.TextRun({
      text: "竖屏短剧正式执行稿",
      color: COLORS.muted,
      size: 24,
    })], 230),
    centeredParagraph(docx, [new docx.TextRun({
      text: `${episodes.length}集｜单集75–115秒动态规划｜预计总时长约${totalMinutes}分钟`,
      color: COLORS.bronze,
      size: 21,
    })], 120),
    centeredParagraph(docx, [new docx.TextRun({
      text: "△ 标注人物对白之外的可见动作、环境声音与场面调度",
      color: COLORS.charcoal,
      size: 20,
    })], 100),
  ];
}

function episodeParagraphs(
  docx: typeof import("docx"),
  episode: ScreenplayDocxEpisode,
): InstanceType<typeof docx.Paragraph>[] {
  const { draft, episodeNumber } = episode;
  const dialoguePresentation = overseasDialoguePresentation(episode.bilingualView);
  const characterNames = mergeOverseasCharacterNames(new Map(), episode.bilingualView);
  const paragraphs: InstanceType<typeof docx.Paragraph>[] = [];
  const chineseEpisodeTitle = applyChineseCharacterNames(
    clientEpisodeTitle(
      overseasNarrativeText(dialoguePresentation, "title", draft.title),
    ),
    characterNames,
  );
  paragraphs.push(new docx.Paragraph({
    keepNext: true,
    spacing: { after: 70 },
    children: [new docx.TextRun({
      text: `第${episodeNumber}集${chineseEpisodeTitle ? `《${chineseEpisodeTitle}》` : ""}`,
      bold: true,
      color: COLORS.burgundy,
      size: 29,
      font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "Microsoft YaHei" },
    })],
  }));
  paragraphs.push(new docx.Paragraph({
    keepNext: true,
    spacing: { after: 180 },
    children: [new docx.TextRun({
      text: `预计时长：${episodeDurationSeconds(draft)}秒`,
      color: COLORS.bronze,
      size: 19,
    })],
  }));
  paragraphs.push(screenplayMarker(docx, "本集信息"));
  const cast = [...new Set(
    (draft.episode_cast?.length
      ? draft.episode_cast
      : draft.scenes.flatMap((scene) => scene.character_refs ?? scene.dialogues.map((line) => line.chinese_character_name || line.character_name)))
      .map((value) => value.trim())
      .filter(Boolean),
  )];
  const locations = [...new Set(
    (draft.locations?.length
      ? draft.locations
      : draft.scenes.map((scene) => scene.content_manifest?.location ?? scene.scene_heading ?? scene.setting_hint ?? scene.setting ?? scene.slug))
      .map((value) => value.trim())
      .filter(Boolean),
  )];
  const infoRows = [
    `剧情梗概：${overseasNarrativeText(dialoguePresentation, "synopsis", draft.synopsis)}`,
    `本集目标：${overseasNarrativeText(dialoguePresentation, "episode_goal", draft.episode_goal ?? "")}`,
    `本集出场人物：${cast.join("、") || "待补充"}`,
    `使用场地：${locations.join("、") || "待补充"}`,
    ...draft.scenes.map((scene, index) => {
      const manifest = scene.content_manifest;
      const refs = (manifest?.character_refs ?? scene.character_refs ?? scene.dialogues.map((line) => line.chinese_character_name || line.character_name)).join("、");
      return `场景${index + 1}｜出场：${refs || "待补充"}｜任务：${manifest?.objective ?? scene.purpose}｜结果：${manifest?.outcome ?? scene.turning_point ?? scene.beat_summary}｜道具：${manifest?.props?.join("、") || "无特别道具"}`;
    }),
  ];
  for (const row of infoRows) {
    paragraphs.push(new docx.Paragraph({
      keepNext: true,
      spacing: { after: 70, line: 250 },
      children: [new docx.TextRun({ text: row, color: COLORS.charcoal, size: 18 })],
    }));
  }
  paragraphs.push(screenplayMarker(docx, "正式正文"));
  paragraphs.push(screenplayMarker(docx, "FADE IN / 淡入："));

  draft.scenes.forEach((scene, sceneIndex) => {
    const setting = applyChineseCharacterNames(
      clientSceneHeading(overseasNarrativeText(
        dialoguePresentation,
        scene.scene_heading
          ? `scenes.${sceneIndex}.scene_heading`
          : scene.setting_hint
            ? `scenes.${sceneIndex}.setting_hint`
            : `scenes.${sceneIndex}.slug`,
        scene.scene_heading ?? scene.setting_hint ?? scene.setting ?? scene.slug,
      )),
      characterNames,
    );
    paragraphs.push(new docx.Paragraph({
      keepNext: true,
      spacing: { before: sceneIndex === 0 ? 80 : 210, after: 100 },
      children: [new docx.TextRun({
        text: setting,
        bold: true,
        color: COLORS.navy,
        size: 23,
      })],
    }));

    for (const item of orderedScreenplayBody(scene)) {
      if (item.kind === "action") {
        paragraphs.push(new docx.Paragraph({
          spacing: { after: 95, line: 270 },
          children: [new docx.TextRun({
            text: `△ ${applyChineseCharacterNames(
              overseasNarrativeText(
                dialoguePresentation,
                `scenes.${sceneIndex}.character_actions.${item.index}`,
                item.action,
              ),
              characterNames,
            )}`,
            color: COLORS.charcoal,
            size: 20,
          })],
        }));
        continue;
      }
      const line = item.dialogue;
      const dialogueIndex = item.index;
      const prefix = `scenes.${sceneIndex}.dialogues.${dialogueIndex}`;
      const text = overseasDialogueTextPair(
        dialoguePresentation,
        `${prefix}.text`,
        line.text,
      );
      const { speaker, marker } = overseasDialogueSpeaker(
        dialoguePresentation,
        `${prefix}.character_name`,
        line.character_name,
        characterNames,
      );
      paragraphs.push(new docx.Paragraph({
        keepNext: true,
        indent: {
          left: docx.convertInchesToTwip(0.9),
          right: docx.convertInchesToTwip(0.35),
        },
        spacing: { before: 70, after: 25 },
        children: [new docx.TextRun({
          text: `${latinUppercase(speaker)}${marker ? ` (${marker})` : ""}`,
          bold: true,
          color: COLORS.burgundy,
          size: 21,
          font: "Arial",
        })],
      }));
      if (line.intent.trim()) {
        paragraphs.push(new docx.Paragraph({
          keepNext: true,
          indent: {
            left: docx.convertInchesToTwip(1.05),
            right: docx.convertInchesToTwip(0.35),
          },
          spacing: { after: 25 },
          children: [new docx.TextRun({
            text: `（${applyChineseCharacterNames(
              overseasNarrativeText(
                dialoguePresentation,
                `${prefix}.intent`,
                line.intent.trim(),
              ),
              characterNames,
            )}）`,
            italics: true,
            color: COLORS.muted,
            size: 18,
          })],
        }));
      }
      paragraphs.push(new docx.Paragraph({
        indent: {
          left: docx.convertInchesToTwip(0.9),
          right: docx.convertInchesToTwip(0.35),
        },
        spacing: { after: 105, line: 260 },
        children: [new docx.TextRun({
          text: text.english,
          color: COLORS.charcoal,
          size: 21,
          font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "Microsoft YaHei" },
        })],
      }));
      if (text.chinese) {
        paragraphs.push(new docx.Paragraph({
          indent: {
            left: docx.convertInchesToTwip(0.9),
            right: docx.convertInchesToTwip(0.35),
          },
          spacing: { after: 105, line: 250 },
          children: [new docx.TextRun({
            text: `中文：${text.chinese}`,
            color: COLORS.muted,
            size: 18,
            font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "Microsoft YaHei" },
          })],
        }));
      }
    }
  });

  paragraphs.push(screenplayMarker(docx, "FADE OUT / 淡出。"));
  return paragraphs;
}

function centeredParagraph(
  docx: typeof import("docx"),
  children: InstanceType<typeof docx.TextRun>[],
  after: number,
): InstanceType<typeof docx.Paragraph> {
  return new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER,
    keepNext: true,
    spacing: { after },
    children,
  });
}

function screenplayMarker(
  docx: typeof import("docx"),
  text: string,
): InstanceType<typeof docx.Paragraph> {
  return new docx.Paragraph({
    keepNext: true,
    spacing: { before: 120, after: 120 },
    children: [new docx.TextRun({
      text,
      bold: true,
      color: COLORS.burgundy,
      size: 20,
      font: "Arial",
    })],
  });
}

function latinUppercase(value: string): string {
  return /[A-Za-z]/.test(value) ? value.toLocaleUpperCase("en-US") : value;
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
