import type { BilingualScriptView, GeneratedDraft } from "./types.ts";
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
    subject: "美式竖屏短剧中文执行稿",
    description: "简体中文单语拍摄剧本",
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
          size: { width: 12240, height: 15840 },
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
      text: "美式竖屏短剧中文执行稿",
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
  const translations = englishDialogueTranslations(episode.bilingualView);
  const characterNames = mergeOverseasCharacterNames(new Map(), episode.bilingualView);
  const paragraphs: InstanceType<typeof docx.Paragraph>[] = [];
  const chineseEpisodeTitle = clientEpisodeTitle(draft.title);
  paragraphs.push(centeredParagraph(docx, [new docx.TextRun({
    text: `第${episodeNumber}集${chineseEpisodeTitle ? `《${chineseEpisodeTitle}》` : ""}`,
    bold: true,
    color: COLORS.burgundy,
    size: 29,
    font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "Microsoft YaHei" },
  })], 70));
  paragraphs.push(centeredParagraph(docx, [new docx.TextRun({
    text: `预计时长：${episodeDurationSeconds(draft)}秒`,
    color: COLORS.bronze,
    size: 19,
  })], 180));
  paragraphs.push(screenplayMarker(docx, "FADE IN / 淡入："));

  draft.scenes.forEach((scene, sceneIndex) => {
    const setting = clientSceneHeading(scene.setting_hint ?? scene.setting ?? scene.slug);
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

    for (const action of scene.character_actions) {
      paragraphs.push(new docx.Paragraph({
        spacing: { after: 95, line: 270 },
        children: [new docx.TextRun({
          text: `△ ${applyOverseasCharacterNames(action, characterNames)}`,
          color: COLORS.charcoal,
          size: 20,
        })],
      }));
    }

    scene.dialogues.forEach((line, dialogueIndex) => {
      const prefix = `scenes.${sceneIndex}.dialogues.${dialogueIndex}`;
      const { speaker, marker } = clientDialogueSpeaker(
        translations?.get(`${prefix}.character_name`) ?? line.character_name,
        line.character_name,
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
            text: `（${line.intent.trim()}）`,
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
          text: translations?.get(`${prefix}.text`) ?? line.text,
          color: COLORS.charcoal,
          size: 21,
          font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "Microsoft YaHei" },
        })],
      }));
      if (translations?.has(`${prefix}.text`)) {
        paragraphs.push(new docx.Paragraph({
          indent: {
            left: docx.convertInchesToTwip(0.9),
            right: docx.convertInchesToTwip(0.35),
          },
          spacing: { after: 105, line: 250 },
          children: [new docx.TextRun({
            text: `中文：${line.text}`,
            color: COLORS.muted,
            size: 18,
            font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "Microsoft YaHei" },
          })],
        }));
      }
    });
  });

  paragraphs.push(screenplayMarker(docx, "FADE OUT / 淡出。"));
  paragraphs.push(new docx.Paragraph({
    spacing: { before: 100 },
    children: [new docx.TextRun({
      text: `（尾钩：${episodeEndingHook(draft)}）`,
      italics: true,
      color: COLORS.burgundy,
      size: 19,
    })],
  }));
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
