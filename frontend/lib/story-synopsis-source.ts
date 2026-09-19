import type { ScriptProject } from "./types.ts";

/** Scope initial synopsis facts without changing reference indexes or author decisions. */
export function synopsisSourceProject<
  T extends Pick<ScriptProject, "creativePrompt" | "referenceMaterials" | "inputReadiness">,
>(project: T): T {
  if (!project.inputReadiness) return project;
  return {
    ...project,
    inputReadiness: {
      ...project.inputReadiness,
      knownFacts: project.inputReadiness.knownFacts?.filter((fact) => {
        if (fact.sourceId === "creative_prompt") return true;
        const reference = /^reference_(\d+)$/.exec(fact.sourceId);
        return reference !== null
          && project.referenceMaterials[Number(reference[1]) - 1]?.purpose === "story_reference";
      }),
    },
  };
}

const SYNOPSIS_TITLE = /^(?:故事梗概|剧情梗概|内容梗概|story\s+synopsis)(?:\s*[：:]\s*([\s\S]*))?$/i;
const NEXT_STAGE_TITLE = /^(?:故事总纲|故事大纲|总纲|剧情规划|分集规划|分集大纲|分集梗概|分集剧情|分场大纲|人物设定|角色设定|人物小传|人物介绍|主要人物|角色介绍|人物关系|世界观|世界设定|故事背景|创作说明|主题|主旨|正文|剧本正文|分镜|分镜脚本|story\s+bible|outline|characters?|character\s+(?:profiles?|descriptions?)|episode\s+(?:outline|breakdown)|screenplay|storyboard)(?:\s*[：:][\s\S]*)?$/i;
const EPISODE_TITLE = /^(?:第\s*[0-9零〇一二两三四五六七八九十百千万]+\s*集|(?:episode|ep\.?)\s*\d+)(?:\s|[：:、.\-]|$)/i;
const NUMBER_PREFIX = /^(?:[一二三四五六七八九十百]+[、.．]\s*|\d+[、.．](?!\d)\s*|[（(][一二三四五六七八九十百\d]+[）)]\s*)/;

interface SourceLine {
  text: string;
  start: number;
  end: number;
}

function sourceLines(document: string): SourceLine[] {
  return [...document.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)]
    .filter((match) => match[0].length > 0)
    .map((match) => ({
      text: match[0].replace(/[\r\n]+$/, ""),
      start: match.index!,
      end: match.index! + match[0].length,
    }));
}

function heading(line: string): { title: string; level: number | null } {
  const markdown = /^\s{0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line);
  let title = (markdown ? markdown[2] : line).trim().replace(NUMBER_PREFIX, "");
  // Source documents commonly wrap plain section labels in bold or brackets.
  title = title.replace(/^\*\*([\s\S]*?)\*\*(?=\s*[：:]|$)/, "$1")
    .replace(/^__([\s\S]*?)__(?=\s*[：:]|$)/, "$1")
    .replace(/^【([^】]+)】(?=\s*[：:]|$)/, "$1");
  return { title: title.trim(), level: markdown ? markdown[1].length : null };
}

function extractDocumentSynopsis(document: string): string | null {
  const lines = sourceLines(document);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const currentHeading = heading(line.text);
    const matched = SYNOPSIS_TITLE.exec(currentHeading.title);
    if (!matched) continue;
    const inlineText = matched[1]?.trim();
    const start = inlineText ? line.start + line.text.lastIndexOf(inlineText) : line.end;
    let end = document.length;
    for (const following of lines.slice(index + 1)) {
      const candidate = heading(following.text);
      const siblingHeading = candidate.level !== null
        && (currentHeading.level === null || candidate.level <= currentHeading.level);
      if (siblingHeading || SYNOPSIS_TITLE.test(candidate.title)
        || NEXT_STAGE_TITLE.test(candidate.title) || EPISODE_TITLE.test(candidate.title)) {
        end = following.start;
        break;
      }
    }
    const synopsis = document.slice(start, end).trim();
    if (synopsis) return synopsis;
  }
  return null;
}

/** Extract one explicitly labelled source section without summarizing or truncating it. */
export function extractSourceSynopsis(
  project: Pick<ScriptProject, "creativePrompt" | "referenceMaterials">,
): string | null {
  // A clearly labelled current author input can revise an older uploaded story.
  // Templates and style/world/character references do not establish its plot.
  for (const document of [
    project.creativePrompt,
    ...project.referenceMaterials
      .filter((material) => material.purpose === "story_reference")
      .map((material) => material.extractedText),
  ]) {
    const synopsis = extractDocumentSynopsis(document);
    if (synopsis) return synopsis;
  }
  return null;
}
