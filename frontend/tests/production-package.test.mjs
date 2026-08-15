import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import JSZip from "jszip";

import { createCollectionArchive } from "../lib/episode-export.ts";
import {
  buildProductionIndex,
  formatEpisodeRanges,
  frequencySummary,
} from "../lib/production-index.ts";
import {
  createProductionWorkbookAttachments,
  PRODUCTION_WORKBOOK_FILENAMES,
} from "../lib/production-workbooks.ts";

function buildInput() {
  const characters = [{
    id: "lin-xia",
    name: "林夏",
    age: "28",
    gender: "女",
    role: "女主",
    background: "调查记者",
    appearance: "黑色风衣，旧相机包",
    description: "敏锐、克制，执着于真相",
    motivation: "找到失踪证人",
  }, {
    id: "zhou-yan",
    name: "周岩",
    age: "32",
    gender: "男",
    role: "搭档",
    background: "刑警",
    appearance: "深色夹克",
    description: "谨慎、可靠",
    motivation: "保护林夏",
  }];
  const draft = {
    id: "draft.production.1",
    title: "第1集：仓库里的手机",
    logline: "林夏找到证据。",
    synopsis: "",
    hook: "手机突然响起。",
    language: "zh-CN",
    characters: characters.map((character) => ({
      name: character.name,
      role: character.role,
      description: character.description,
      motivation: character.motivation,
    })),
    continuity_state_updates: [{
      entity_key: "item.evidence_phone",
      entity_type: "item",
      entity_name: "证据手机",
      state_domain: "possession",
      transition: "acquired",
      current_state: "由林夏持有，屏幕已经破裂",
      persistence: "ongoing",
      future_constraint: "手机中的录音仍待解密",
      change_cause: "林夏在旧仓库找到证据手机",
      evidence_scene_numbers: [1],
    }],
    scenes: [{
      scene_number: 1,
      slug: "旧仓库 内 夜",
      setting_hint: "INT. 旧仓库 夜",
      purpose: "取得关键证据",
      beat_summary: "林夏与周岩进入昏暗的旧仓库。",
      character_actions: ["林夏戴上手套，拿起屏幕破裂的证据手机。", "周岩用手电筒照向铁门。"],
      dialogues: [
        { character_name: "林夏", intent: "确认", text: "录音还在。" },
        { character_name: "周岩", intent: "警戒", text: "有人来了。" },
      ],
      cliffhanger: true,
    }],
    next_episode_question: "来人是谁？",
  };
  return {
    characters,
    relationships: [{
      id: "lin-xia--zhou-yan",
      sourceCharacterId: "lin-xia",
      targetCharacterId: "zhou-yan",
      relationshipType: "调查搭档",
      currentState: "相互信任",
      episodeChanges: [],
      userEdited: false,
    }],
    continuityStates: [],
    episodes: [{ episodeNumber: 1, draft }],
  };
}

test("production index derives people, locations, props, and direct contact from final scripts", () => {
  const index = buildProductionIndex(buildInput());

  assert.equal(index.characters.find((item) => item.name === "林夏")?.appearanceCount, 1);
  assert.deepEqual(index.scenes[0].episodeNumbers, [1]);
  assert.equal(index.scenes[0].chineseName, "旧仓库");
  const phone = index.props.find((item) => item.name === "证据手机");
  assert.ok(phone);
  assert.ok(phone.directUsers.includes("林夏"));
  assert.ok(phone.owners.includes("林夏"));
  assert.match(phone.designNotes.join(" "), /屏幕已经破裂/);
  assert.equal(index.props.some((item) => item.name === "手机"), false);
});

test("episode ranges and frequency bands stay deterministic", () => {
  assert.equal(formatEpisodeRanges([7, 1, 3, 2, 7, 10]), "1-3、7、10");
  const index = buildProductionIndex(buildInput());
  const summary = frequencySummary(index);

  assert.deepEqual(summary.map((row) => row.type), ["人物", "场景", "道具"]);
  assert.match(summary[0].low, /林夏（1）/);
  assert.match(summary[1].low, /旧仓库（1）/);
});

test("five production workbooks preserve partner-facing headers", async () => {
  const index = buildProductionIndex(buildInput());
  const attachments = await createProductionWorkbookAttachments("逆光证词", index);

  assert.deepEqual(attachments.map((item) => item.filename), [...PRODUCTION_WORKBOOK_FILENAMES]);
  const characterWorkbook = await JSZip.loadAsync(await attachments[0].content.arrayBuffer());
  const sharedStrings = await characterWorkbook.file("xl/sharedStrings.xml").async("string");
  assert.match(sharedStrings, /角色/);
  assert.match(sharedStrings, /核心特征/);
  assert.match(sharedStrings, /人物特点/);
  assert.match(sharedStrings, /林夏/);

  const frequencyWorkbook = await JSZip.loadAsync(await attachments[3].content.arrayBuffer());
  const frequencyStrings = await frequencyWorkbook.file("xl/sharedStrings.xml").async("string");
  assert.match(frequencyStrings, /快速统计摘要（完整版）/);
  assert.match(frequencyStrings, /高频（出现≥10次）/);
});

test("production-only export creates a ZIP with the five exact workbook filenames", async () => {
  const index = buildProductionIndex(buildInput());
  const attachments = await createProductionWorkbookAttachments("逆光证词", index);
  const archiveBlob = await createCollectionArchive("逆光证词", [], attachments.map((item) => ({
    filename: `制作资料/${item.filename}`,
    content: item.content,
  })));
  const archive = await JSZip.loadAsync(await archiveBlob.arrayBuffer());

  for (const filename of PRODUCTION_WORKBOOK_FILENAMES) {
    assert.ok(archive.file(`制作资料/${filename}`), filename);
  }
});

test("final export keeps the five-sheet production package selected by default", async () => {
  const workspaceSource = await readFile(
    new URL("../components/script-workspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(workspaceSource, /seriesExportProductionPackage, setSeriesExportProductionPackage\] = useState\(true\)/);
  assert.match(workspaceSource, /exportProductionPackageOption/);
  assert.match(workspaceSource, /filename: `制作资料\/\$\{attachment\.filename\}`/);
});
