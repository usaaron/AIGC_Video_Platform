import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { buildEmbeddedOverseasDialogueView } from '../lib/generation-client.ts';
import { toEpisodeMarkdown, toEpisodePlainText } from '../lib/episode-export.ts';
import { createScreenplayDocxBlob } from '../lib/episode-docx.ts';
import { buildProductionIndex } from '../lib/production-index.ts';
import { createProductionWorkbookAttachments } from '../lib/production-workbooks.ts';

function draft(legacy = false) {
  const name = legacy ? '莉娜' : 'Lena';
  return {
    id: 'draft.names', language: 'en', title: '最后的排练', logline: `${name}留下录音。`,
    synopsis: `${name}核对录音。`, hook: '门外传来脚步。', episode_goal: `${name}留下录音。`,
    characters: [{ name: 'Lena', role: '主唱', description: `${name}谨慎。`, motivation: '完成排练' }],
    episode_cast: ['Lena'], locations: ['排练室'], scenes: [{
      scene_number: 1, slug: 'INT. 排练室 夜', scene_heading: 'INT. 排练室 夜',
      purpose: `${name}留下录音。`, beat_summary: '排练告一段落', character_refs: ['Lena'],
      content_manifest: { location: '排练室', character_refs: ['Lena'], objective: `${name}核对录音`, conflict: `${name}不愿继续`, outcome: `${name}留下录音`, props: ['录音笔'] },
      character_actions: [`${name}收起录音笔。`], dialogues: [{ character_name: 'Lena (V.O.)',
        chinese_character_name: legacy ? '莉娜' : null, intent: `提醒${name}自己`, text: 'Lena, listen to this.', chinese_translation: `${name}，听听这个。` }],
      body_order: ['action:0', 'dialogue:0'], cliffhanger: true,
    }], next_episode_question: '谁来了？',
  };
}

test('English identities need no Chinese name to retain the embedded translation', () => {
  const source = draft(); const before = JSON.stringify(source);
  const view = buildEmbeddedOverseasDialogueView(source);
  assert.ok(view);
  const md = toEpisodeMarkdown(source, 1, view);
  assert.match(md, /Lena \(V\.O\.\)/);
  assert.match(md, /Lena, listen to this\./);
  assert.match(md, /中文：Lena，听听这个。/);
  assert.doesNotMatch(md, /莉娜|Lena（/);
  assert.equal(JSON.stringify(source), before);
});

test('legacy aliases use English throughout screenplay metadata, Chinese translations and five workbooks', async () => {
  const source = draft(true); const before = JSON.stringify(source);
  const view = buildEmbeddedOverseasDialogueView(source);
  const word = await createScreenplayDocxBlob('最后的排练', [{episodeNumber: 1, draft: source, bilingualView: view}]);
  const zip = await JSZip.loadAsync(await word.arrayBuffer());
  const xml = await zip.file('word/document.xml').async('string');
  for (const content of [toEpisodeMarkdown(source, 1, view), toEpisodePlainText(source, 1, view), xml]) {
    assert.match(content, /Lena/); assert.doesNotMatch(content, /莉娜/);
  }
  const index = buildProductionIndex({characters: [], episodes: [{episodeNumber: 1, draft: source, bilingualView: view}]});
  assert.equal(index.characters.length, 1);
  const files = await createProductionWorkbookAttachments('最后的排练', index);
  assert.equal(files.length, 5);
  for (const file of files) {
    const workbook = await JSZip.loadAsync(await file.content.arrayBuffer());
    const strings = await workbook.file('xl/sharedStrings.xml').async('string');
    assert.doesNotMatch(strings, /莉娜/);
    if (file.filename === '人设表.xlsx') { assert.match(strings, /Lena/); assert.doesNotMatch(strings, /中文名/); }
  }
  assert.equal(JSON.stringify(source), before);
});
