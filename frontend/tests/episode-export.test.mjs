import assert from "node:assert/strict";
import test from "node:test";

import {
  createCollectionArchive,
  createEpisodeArchive,
  episodeDocumentFilename,
  toSeriesDocument,
  toEpisodeMarkdown,
  toEpisodePlainText,
} from "../lib/episode-export.ts";
import { createScreenplayDocxBlob } from "../lib/episode-docx.ts";
import JSZip from "jszip";

function buildDraft(language = "zh-CN") {
  return {
    id: "draft.export.1",
    title: language.startsWith("zh") ? "第12集：门后的真相" : "Episode 12: Truth Behind the Door",
    logline: "她终于找到证据。",
    synopsis: "",
    hook: "门突然打开。",
    language,
    characters: [{ name: "林夏", role: "主角", description: "调查记者", motivation: "查明真相" }],
    scenes: [{
      scene_number: 1,
      slug: "旧仓库 内 夜",
      purpose: "找到证据",
      beat_summary: "林夏潜入仓库。",
      setting_hint: "INT. 旧仓库 夜",
      character_actions: ["林夏推开铁门。", "门后的影子向前一步。"],
      dialogues: [
        { character_name: "林夏", intent: "试探", text: "谁在那里？" },
        { character_name: "周野", intent: "压低声音", text: "别开灯。" },
      ],
      body_order: ["action:0", "dialogue:0", "action:1", "dialogue:1"],
      cliffhanger: true,
    }],
    next_episode_question: "门后的人是谁？",
  };
}

test("Markdown episode export keeps screenplay headings and readable scene structure", () => {
  const content = toEpisodeMarkdown(buildDraft(), 12);

  assert.match(content, /^# 第12集《门后的真相》$/m);
  assert.match(content, /预计时长：90秒/);
  assert.match(content, /## INT\. 旧仓库 夜/);
  assert.match(content, /△ 林夏推开铁门。/);
  assert.match(content, /\*\*林夏\*\*[\s\S]*（试探）[\s\S]*谁在那里？/);
  assert.ok(content.indexOf("谁在那里？") < content.indexOf("门后的影子向前一步。"));
  assert.ok(content.indexOf("门后的影子向前一步。") < content.indexOf("别开灯。"));
  assert.match(content, /FADE OUT \/ 淡出。/);
});

test("plain text episode export contains no Markdown formatting markers", () => {
  const content = toEpisodePlainText(buildDraft(), 12);

  assert.match(content, /^第12集《门后的真相》$/m);
  assert.match(content, /INT\. 旧仓库 夜/);
  assert.doesNotMatch(content, /(^|\n)#{1,6}\s/);
  assert.doesNotMatch(content, /\*\*|_\(/);
});

test("Chinese export ignores cached English presentation text", () => {
  const view = {
    items: [
      { path: "title", translated_text: "Truth Behind the Door" },
      { path: "scenes.0.dialogues.0.character_name", translated_text: "LIN XIA" },
      { path: "scenes.0.dialogues.0.text", translated_text: "Who's in there?" },
    ],
  };
  const content = toEpisodePlainText(buildDraft(), 12, view);

  assert.match(content, /^第12集《门后的真相》$/m);
  assert.match(content, /林夏[\s\S]*谁在那里？/);
  assert.doesNotMatch(content, /EPISODE|TRUTH BEHIND|LIN XIA|Who's in there|中文：/);
});

test("overseas export presents English dialogue first with Chinese below", () => {
  const draft = buildDraft("en");
  draft.title = "第12集：门后的真相";
  draft.scenes[0].dialogues[0] = {
    character_name: "LENA HART",
    intent: "试探",
    text: "Who's there?",
  };
  const view = {
    view_version: "bilingual_script_view.v3",
    target_language: "zh-CN-short-drama",
    items: [
      { path: "characters.0.name", source_text: "林夏", translated_text: "林夏" },
      { path: "scenes.0.dialogues.0.character_name", source_text: "LENA HART", translated_text: "林夏" },
      { path: "scenes.0.dialogues.0.text", source_text: "Who's there?", translated_text: "谁在那里？" },
    ],
  };
  const content = toEpisodePlainText(draft, 12, view);

  assert.match(content, /林夏（LENA HART）[\s\S]*Who's there\?[\s\S]*中文：谁在那里？/);
  assert.doesNotMatch(content, /Truth Behind the Door/);
  assert.match(content, /△ 林夏推开铁门。/);
});

test("overseas English draft export adds Chinese below without replacing English", () => {
  const draft = buildDraft("en");
  draft.title = "第12集：门后的真相";
  draft.characters[0].name = "LENA HART";
  draft.scenes[0].character_actions[0] = "LENA HART推开铁门。";
  draft.scenes[0].dialogues[0] = {
    character_name: "LENA HART",
    intent: "试探",
    text: "Who's there?",
  };
  const view = {
    view_version: "bilingual_script_view.v3",
    target_language: "zh-CN-short-drama",
    items: [
      {
        path: "characters.0.name",
        source_text: "LENA HART",
        translated_text: "林夏",
      },
      {
        path: "scenes.0.dialogues.0.character_name",
        source_text: "LENA HART",
        translated_text: "林夏",
      },
      {
        path: "scenes.0.dialogues.0.text",
        source_text: "Who's there?",
        translated_text: "谁在那里？",
      },
    ],
  };

  const content = toEpisodePlainText(draft, 12, view);

  assert.match(content, /林夏（LENA HART）[\s\S]*Who's there\?[\s\S]*中文：谁在那里？/);
  assert.match(content, /△ 林夏推开铁门。/);
  assert.doesNotMatch(content, /△ LENA HART推开铁门。/);
  assert.doesNotMatch(content, /中文：Who's there\?/);
});

test("episode export filenames include only project and episode number", () => {
  assert.equal(
    episodeDocumentFilename("逆光而行", 12, "markdown"),
    "逆光而行-episode-12.md",
  );
  assert.equal(
    episodeDocumentFilename("逆光而行", 12, "text"),
    "逆光而行-episode-12.txt",
  );
  assert.equal(
    episodeDocumentFilename("逆光而行", 12, "word"),
    "逆光而行-episode-12.docx",
  );
});

test("Word export preserves the client screenplay order in Chinese only", async () => {
  const documentBlob = await createScreenplayDocxBlob("逆光而行", [{
    episodeNumber: 12,
    draft: buildDraft(),
    bilingualView: {
      items: [
        { path: "title", translated_text: "Truth Behind the Door" },
        { path: "scenes.0.dialogues.0.character_name", translated_text: "LIN XIA" },
        { path: "scenes.0.dialogues.0.text", translated_text: "Who's in there?" },
      ],
    },
  }]);
  const documentArchive = await JSZip.loadAsync(await documentBlob.arrayBuffer());
  const documentXml = await documentArchive.file("word/document.xml").async("string");

  assert.match(documentXml, /FADE IN/);
  assert.match(documentXml, /INT\. 旧仓库 夜/);
  assert.match(documentXml, /林夏/);
  assert.match(documentXml, /谁在那里？/);
  assert.ok(documentXml.indexOf("谁在那里？") < documentXml.indexOf("门后的影子向前一步。"));
  assert.ok(documentXml.indexOf("门后的影子向前一步。") < documentXml.indexOf("别开灯。"));
  assert.doesNotMatch(documentXml, /EPISODE 12|TRUTH BEHIND|LIN XIA|Who&apos;s in there|中文：/);
  assert.match(documentXml, /FADE OUT/);
});

test("overseas Word export keeps Chinese action but uses bilingual dialogue", async () => {
  const draft = buildDraft("en");
  draft.title = "第12集：门后的真相";
  draft.scenes[0].dialogues[0] = {
    character_name: "LENA HART",
    intent: "试探",
    text: "Who's there?",
  };
  const documentBlob = await createScreenplayDocxBlob("逆光而行", [{
    episodeNumber: 12,
    draft,
    bilingualView: {
      view_version: "bilingual_script_view.v3",
      target_language: "zh-CN-short-drama",
      items: [
        { path: "characters.0.name", source_text: "林夏", translated_text: "林夏" },
        { path: "scenes.0.dialogues.0.character_name", source_text: "LENA HART", translated_text: "林夏" },
        { path: "scenes.0.dialogues.0.text", source_text: "Who's there?", translated_text: "谁在那里？" },
      ],
    },
  }]);
  const documentArchive = await JSZip.loadAsync(await documentBlob.arrayBuffer());
  const documentXml = await documentArchive.file("word/document.xml").async("string");

  assert.match(documentXml, /林夏推开铁门/);
  assert.match(documentXml, /林夏（LENA HART）/);
  assert.match(documentXml, /Who&apos;s there\?/);
  assert.match(documentXml, /中文：谁在那里？/);
});

test("client dialogue markers remain attached to the speaker cue", () => {
  const draft = buildDraft();
  draft.scenes[0].dialogues[0].character_name = "林夏（V.O.）";
  const content = toEpisodePlainText(draft, 12, {
    items: [
      { path: "title", translated_text: "Truth Behind the Door" },
      { path: "scenes.0.dialogues.0.character_name", translated_text: "LIN XIA" },
      { path: "scenes.0.dialogues.0.text", translated_text: "Who's in there?" },
    ],
  });

  assert.match(content, /林夏 \(V\.O\.\)[\s\S]*谁在那里？/);
  assert.doesNotMatch(content, /LIN XIA|Who's in there/);
});

test("legacy scene headings normalize to the client INT EXT time order", () => {
  const draft = buildDraft();
  draft.scenes[0].setting_hint = "旧仓库 内 夜 - 稍后";
  const content = toEpisodePlainText(draft, 12);

  assert.match(content, /^INT\. 旧仓库 夜 - LATER$/m);
});

test("full Word collection adds the client cover and honest runtime", async () => {
  const documentBlob = await createScreenplayDocxBlob(
    "逆光而行",
    [
      { episodeNumber: 1, draft: buildDraft() },
      { episodeNumber: 2, draft: buildDraft() },
    ],
    { includeCover: true },
  );
  const archive = await JSZip.loadAsync(await documentBlob.arrayBuffer());
  const documentXml = await archive.file("word/document.xml").async("string");

  assert.match(documentXml, /逆光而行/);
  assert.match(documentXml, /第01–02集/);
  assert.match(documentXml, /75–115秒/);
  assert.match(documentXml, /预计总时长约3分钟/);
  assert.match(documentXml, /△ 标注人物对白之外/);
});

test("episode ZIP stores Word files in a separate directory", async () => {
  const archiveBlob = await createEpisodeArchive(
    "逆光而行",
    [{ episodeNumber: 1, draft: { ...buildDraft(), title: "第1集：雨夜" } }],
    ["word"],
  );
  const archive = await JSZip.loadAsync(await archiveBlob.arrayBuffer());

  assert.ok(archive.file("word/逆光而行-episode-01.docx"));
});

test("episode ZIP separates Markdown and text files into format directories", async () => {
  const archiveBlob = await createEpisodeArchive(
    "逆光而行",
    [
      { episodeNumber: 1, draft: { ...buildDraft(), title: "第1集：雨夜" } },
      { episodeNumber: 2, draft: { ...buildDraft(), title: "第2集：证据" } },
    ],
    ["markdown", "text"],
  );
  const archive = await JSZip.loadAsync(await archiveBlob.arrayBuffer());
  const paths = Object.keys(archive.files).sort();

  assert.deepEqual(paths, [
    "markdown/",
    "markdown/逆光而行-episode-01.md",
    "markdown/逆光而行-episode-02.md",
    "text/",
    "text/逆光而行-episode-01.txt",
    "text/逆光而行-episode-02.txt",
  ]);
  assert.match(
    await archive.file("text/逆光而行-episode-01.txt").async("string"),
    /^第1集《雨夜》$/m,
  );
});

test("collection export keeps every episode in one document per format", async () => {
  const episodes = [
    { episodeNumber: 1, draft: { ...buildDraft(), title: "第1集：雨夜" } },
    { episodeNumber: 2, draft: { ...buildDraft(), title: "第2集：证据" } },
  ];
  const markdown = toSeriesDocument("逆光而行", episodes, "markdown");
  const text = toSeriesDocument("逆光而行", episodes, "text");

  assert.match(markdown, /# 第1集《雨夜》[\s\S]*# 第2集《证据》/);
  assert.match(text, /第1集[\s\S]*第2集/);

  const archiveBlob = await createCollectionArchive("逆光而行", [
    { format: "markdown", content: markdown },
    { format: "text", content: text },
  ]);
  const archive = await JSZip.loadAsync(await archiveBlob.arrayBuffer());
  assert.deepEqual(Object.keys(archive.files).sort(), [
    "逆光而行-full-script.md",
    "逆光而行-full-script.txt",
  ]);
});
