import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { bindHostAssetEvidence, projectHostAssetEvidence } from '../lib/host-asset-evidence.ts';
import { buildImportMaterial } from '../lib/host-import-payload.ts';

const sha = text => createHash('sha256').update(text.trim()).digest('hex');
const cast = [
  { id: 'story-bible-character.lin', name: '林岚', appearance: '黑发，灰色外衣', background: '父亲失踪', motivation: '寻找父亲', description: '记忆中的父亲' },
  { id: 'character.father', name: '父亲', appearance: '蓝色帽子' },
];
const scene = (number, manifest = { location: '院子', character_refs: ['character.lin'], props: ['信封'] }) => ({
  scene_number: number, slug: 'INT. 院子 - 日', setting: '不应取此场地', purpose: '查找线索', beat_summary: '回忆父亲',
  character_refs: ['父亲'], character_actions: ['林岚回忆父亲提及的铁箱。'], dialogues: [{ character_name: '父亲', text: '记忆台词', intent: '' }],
  content_manifest: manifest,
});
const draft = (scenes = [scene(1)]) => ({
  id: 'draft-1', title: '第一集', language: 'zh-CN', synopsis: '回忆父亲', hook: '',
  characters: [{ name: '林岚', role: '主人公', description: '寻找父亲的年轻人', motivation: '寻找父亲' }], scenes,
});
const project = (body = draft()) => ({
  id: 'project-1', characters: cast, generationSettings: { episodeCount: 2 }, episodes: [
    { id: 'episode-1', episodeNumber: 1, status: 'saved', generationRun: { draft_master_script: body } },
    { id: 'episode-2', episodeNumber: 2, status: 'editing', hasLocalDraftEdits: true, generationRun: { draft_master_script: body } },
  ],
});

test('complete explicit manifests retain source scenes and only declared assets with visual facts', () => {
  const source = draft([scene(1), scene(2, { location: '院子', character_refs: ['林岚'], props: ['信封', '钥匙'] })]);
  const before = structuredClone(source);
  const { evidence, warning } = projectHostAssetEvidence(source, cast, 'episode-1', ' 剧本文字 ');
  assert.equal(warning, undefined);
  assert.deepEqual(evidence.complete, { character: true, scene: true, prop: true });
  assert.deepEqual(evidence.assets.map(a => [a.kind, a.name]), [['scene', '院子'], ['character', '林岚'], ['prop', '信封'], ['prop', '钥匙']]);
  assert.deepEqual(evidence.assets.find(a => a.kind === 'character').facts, { 外观: '黑发，灰色外衣' });
  assert.deepEqual(evidence.assets.find(a => a.name === '林岚').sourceSceneIds, ['episode-1:1', 'episode-1:2']);
  assert.equal(JSON.stringify(evidence.assets).includes('父亲'), false);
  assert.deepEqual(source, before);
});

test('explicit empty lists do not fall back to narrative, dialogue, scene refs or the global cast', () => {
  const { evidence } = projectHostAssetEvidence(draft([scene(1, { location: '空院', character_refs: [], props: [] })]), cast, 'e', '正文');
  assert.deepEqual(evidence.complete, { character: true, scene: true, prop: true });
  assert.deepEqual(evidence.assets.map(a => a.name), ['空院']);
});

test('author-edited scenes never rebind old asset manifests to the new saved body', async () => {
  const changed = scene(1, { location: '档案室', character_refs: ['林岚'], props: ['钥匙'] });
  changed.scene_heading = 'INT. 咖啡店 - 日';
  changed.dialogues = [{ character_name: '顾宁', text: '我带了雨伞。', intent: '' }];
  changed.character_actions = ['顾宁收起雨伞。'];
  const body = { ...draft([changed]), llm_metadata: { quick_asset_evidence_invalidated_scenes: [1] } };
  const material = buildImportMaterial(project(body), new Map(), { scriptsOnly: true });
  const pending = material.episodes[0].assetEvidence;
  const bound = await bindHostAssetEvidence(pending, material.episodes[0].content);
  assert.deepEqual(bound.complete, { character: false, scene: false, prop: false });
  assert.deepEqual(bound.assets, []);
  assert.equal(bound.contentHash, sha(material.episodes[0].content));
  assert.ok(material.episodes[0].content.includes('咖啡店'));
  assert.ok(material.episodes[0].content.includes('顾宁'));
  assert.equal(/档案室|林岚|钥匙/.test(material.episodes[0].content), false);
});

test('invalidating one scene preserves explicit evidence from unchanged scenes only', () => {
  const body = { ...draft([scene(1), scene(2, { location: '车站', character_refs: [], props: ['车票'] })]),
    llm_metadata: { quick_asset_evidence_invalidated_scenes: [1] } };
  const { evidence } = projectHostAssetEvidence(body, cast, 'e', '新正文');
  assert.deepEqual(evidence.complete, { character: false, scene: false, prop: false });
  assert.deepEqual(evidence.assets.map(a => a.name), ['车站', '车票']);
});

test('legacy partial fields lower only their category completeness and never use scene heading fallback', () => {
  const { evidence } = projectHostAssetEvidence(draft([scene(1), scene(2, { character_refs: [], props: [] })]), cast, 'e', '正文');
  assert.deepEqual(evidence.complete, { character: true, scene: false, prop: true });
  assert.equal(evidence.assets.some(a => a.name === '不应取此场地'), false);
  const absent = projectHostAssetEvidence(draft([scene(1), scene(2, null)]), cast, 'e', '正文').evidence;
  assert.deepEqual(absent.complete, { character: false, scene: false, prop: false });
  assert.equal(absent.assets.length, 3, 'valid scenes still provide useful partial evidence');
});

test('no scenes and malformed manifest fields cannot claim a complete empty scan', () => {
  assert.deepEqual(projectHostAssetEvidence(draft([]), cast, 'e', '正文').evidence.complete,
    { character: false, scene: false, prop: false });
  const malformed = projectHostAssetEvidence(draft([scene(1, { location: '', character_refs: [null, ' '], props: '钥匙' })]), cast, 'e', '正文').evidence;
  assert.deepEqual(malformed.complete, { character: false, scene: false, prop: false });
  assert.deepEqual(malformed.assets, []);
});

test('unknown machine IDs lower cast completeness without inventing named characters', () => {
  const { evidence } = projectHostAssetEvidence(draft([scene(1, { location: '院子', character_refs: ['character.missing', '林岚'], props: [] })]), cast, 'e', '正文');
  assert.equal(evidence.complete.character, false);
  assert.deepEqual(evidence.assets.filter(a => a.kind === 'character').map(a => a.name), ['林岚']);
});

test('unknown story-bible identities stay unresolved while known aliases retain their names', () => {
  const { evidence } = projectHostAssetEvidence(draft([scene(1, {
    location: '院子', character_refs: ['story-bible-missing', 'story-bible-character.unknown', 'story-bible-character.lin'], props: [],
  })]), cast, 'e', '正文');
  assert.equal(evidence.complete.character, false);
  assert.deepEqual(evidence.assets.filter(a => a.kind === 'character').map(a => a.name), ['林岚']);
});

test('explicit voice-only characters and generic narration keep a complete empty visual cast', () => {
  const { evidence } = projectHostAssetEvidence(draft([scene(1, {
    location: '空院', character_refs: [
      '旁白', '画外音', 'Narrator (V.O.)', 'narrator(OS)', 'Narrator (VO/OS)', 'voice-over',
      '林岚（仅声音）', '父亲（仅声）', 'Father (voice-only)', 'character.lin (audio only)',
    ], props: [],
  })]), cast, 'e', '正文');
  assert.equal(evidence.complete.character, true);
  assert.deepEqual(evidence.assets.filter(a => a.kind === 'character'), []);
});

test('VO/OS delivery annotations on named manifest characters resolve without creating duplicate identities', () => {
  const { evidence } = projectHostAssetEvidence(draft([scene(1, {
    location: '院子', character_refs: ['林岚（画外音）', 'character.lin (O.S.)', '林岚 [VO]', '林岚'], props: [],
  })]), cast, 'e', '正文');
  assert.equal(evidence.complete.character, true);
  assert.deepEqual(evidence.assets.filter(a => a.kind === 'character'), [
    { kind: 'character', name: '林岚', facts: { 外观: '黑发，灰色外衣' }, sourceSceneIds: ['e:1'] },
  ]);
});

test('a later visible appearance still contributes a character excluded as voice-only in another scene', () => {
  const { evidence } = projectHostAssetEvidence(draft([
    scene(1, { location: '院子', character_refs: ['林岚（只有声音）'], props: [] }),
    scene(2, { location: '院子', character_refs: ['林岚'], props: [] }),
  ]), cast, 'e', '正文');
  assert.equal(evidence.complete.character, true);
  assert.deepEqual(evidence.assets.find(a => a.kind === 'character').sourceSceneIds, ['e:2']);
});

test('ID and name references share one identity; conflicting library references never guess', () => {
  const { evidence } = projectHostAssetEvidence(draft([scene(1, { location: '院子', character_refs: ['林岚', 'character.lin', 'story-bible-character.lin'], props: [] })]), cast, 'e', '正文');
  assert.equal(evidence.assets.filter(a => a.kind === 'character').length, 1);
  const collision = [{ id: 'character.same', name: '甲' }, { id: 'character.same', name: '乙' }];
  const ambiguous = projectHostAssetEvidence(draft([scene(1, { location: '院子', character_refs: ['character.same'], props: [] })]), collision, 'e', '正文').evidence;
  assert.equal(ambiguous.complete.character, false);
  assert.equal(ambiguous.assets.some(a => a.kind === 'character'), false);
});

test('same-name appearance disagreements omit visual facts; narrative descriptions are never substituted', () => {
  const sameName = [...cast, { id: 'another.lin', name: '林岚', appearance: '红发' }];
  const evidence = projectHostAssetEvidence(draft(), sameName, 'e', '正文').evidence;
  assert.deepEqual(evidence.assets.find(a => a.kind === 'character').facts, {});
  const noAppearance = projectHostAssetEvidence(draft(), [{ ...cast[0], appearance: '' }], 'e', '正文').evidence;
  assert.deepEqual(noAppearance.assets.find(a => a.kind === 'character').facts, {});
});

test('out-of-range evidence is omitted with a readable warning without blocking saved scripts', () => {
  for (const body of [
    draft([scene(1, { location: '地'.repeat(121), character_refs: [], props: [] })]),
    draft([scene(1, { location: '院子', character_refs: [], props: Array.from({ length: 2000 }, (_, i) => `道具${i}`) })]),
    draft(Array.from({ length: 501 }, (_, i) => scene(i + 1))),
    draft([scene(1), scene(1)]),
  ]) {
    const result = buildImportMaterial(project(body), new Map(), { scriptsOnly: true });
    assert.equal(result.episodes.length, 1);
    assert.equal(result.episodes[0].assetEvidence, undefined);
    assert.equal(result.episodes[0].content.length > 0, true);
    assert.match(result.warnings[0], /仍交付正文/);
    assert.deepEqual(result.assets, []);
  }
  for (const [characters, id] of [[[{ ...cast[0], appearance: '衣'.repeat(2001) }], 'e'], [cast, 'e'.repeat(161)]]) {
    const result = projectHostAssetEvidence(draft(), characters, id, '正文');
    assert.equal(result.evidence, undefined);
    assert.match(result.warning, /交付限制/);
  }
});

test('total limit uses UTF-8 bytes and does not count internal source text', () => {
  const many = Array.from({ length: 90 }, (_, i) => ({ id: `character.${i}`, name: `人物${i}`, appearance: '衣'.repeat(2000) }));
  const result = projectHostAssetEvidence(draft([scene(1, { location: '院子', character_refs: many.map(c => c.id), props: [] })]), many, 'e', '正文');
  assert.equal(result.evidence, undefined, '180k Chinese fact characters exceed 500k UTF-8 bytes');
  assert.match(result.warning, /交付限制/);
  assert.ok(projectHostAssetEvidence(draft(), cast, 'e', '文'.repeat(200000)).evidence, 'internal sourceContent is never on the wire');
});

test('binding hashes final trimmed text, ignores supplied hash and strips preparation-only fields', async () => {
  const evidence = projectHostAssetEvidence(draft(), cast, 'e', ' 正文🌕\n').evidence;
  evidence.contentHash = 'f'.repeat(64);
  const before = structuredClone(evidence);
  const bound = await bindHostAssetEvidence(evidence, '\n正文🌕  ');
  assert.equal(bound.contentHash, sha('正文🌕'));
  assert.deepEqual(Object.keys(bound).sort(), ['assets', 'complete', 'contentHash', 'version']);
  assert.deepEqual(evidence, before);
  bound.assets[0].name = '改变返回值';
  assert.equal(evidence.assets[0].name, '院子');
  assert.equal(await bindHostAssetEvidence(evidence, '正文已被改动'), undefined);
});

test('final binding rejects metadata limits changed after preparation', async () => {
  const pending = projectHostAssetEvidence(draft(), cast, 'e', '正文').evidence;
  pending.assets[0].facts = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`字段${i}`, '值']));
  assert.equal(await bindHostAssetEvidence(pending, '正文'), undefined);
  pending.assets[0].facts = { ['字'.repeat(41)]: '值' };
  assert.equal(await bindHostAssetEvidence(pending, '正文'), undefined);
});

test('import preparation includes only resolved saved versions and leaves source inputs untouched', () => {
  const input = project();
  const before = structuredClone(input);
  const result = buildImportMaterial(input, new Map(), { scriptsOnly: true });
  assert.deepEqual(input, before);
  assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].sourceEpisodeId, 'episode-1');
  assert.ok(result.episodes[0].assetEvidence);
  assert.equal(result.episodes[0].shots, undefined);
  assert.deepEqual(result.assets, []);
});
