import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildImportMaterial } from '../lib/host-import-payload.ts';

process.env.NEXT_PUBLIC_HOST_DELIVERY_URL = 'https://host.invalid/api/v1/script-master/deliveries';
delete process.env.NEXT_PUBLIC_HOST_LAUNCH_URL;
delete process.env.NEXT_PUBLIC_BASE_PATH;
const { importMaterial, HostImportError } = await import('../lib/host-import.ts');
const hash = text => createHash('sha256').update(text).digest('hex');
const project = { id: 'p', generationSettings: { episodeCount: 1 }, characters: [], episodes: [{
  id: 'episode-1', episodeNumber: 1, status: 'saved', generationRun: { draft_master_script: {
    id: 'draft-1', title: '第一集', language: 'zh-CN', synopsis: '查看信封', characters: [], scenes: [{
      scene_number: 1, slug: 'INT. 旧宅 - 日', purpose: '查看信封', beat_summary: '找到线索', character_actions: ['信封放在桌上'], dialogues: [],
      content_manifest: { location: '旧宅', character_refs: [], props: ['信封'] },
    }],
  } },
}] };
const selection = { episodeIds: ['episode-1'], assets: false, shots: false };
function transport(t) {
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://host.invalid/api/v1/script-master/imports');
    assert.equal(options.method, 'POST');
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ status: 'completed', targetProjectId: 'host-p', importedEpisodes: 1, updatedEpisodes: 0,
      importedAssets: 0, updatedAssets: 0, preservedAssets: 0, importedShots: 0, updatedShots: 0 }), { status: 200 });
  });
  return bodies;
}

test('storyboard conflict remains distinguishable from a retryable transport failure', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json({ error: { code: 'IMPORT_STORYBOARD_REQUIRED', message: '已有分镜，不能覆盖正文' } }, { status: 409 });
  });
  const material = buildImportMaterial(project, new Map(), { scriptsOnly: true });
  await assert.rejects(importMaterial(project, 'host-p', material, selection), error =>
    error instanceof HostImportError && error.code === 'IMPORT_STORYBOARD_REQUIRED');
  assert.equal(requests, 1);
});

test('scripts-only transport hashes exact delivered content and the complete wire body for stable retries', async t => {
  const bodies = transport(t);
  const material = buildImportMaterial(project, new Map(), { scriptsOnly: true });
  material.episodes[0].assetEvidence.contentHash = 'tampered';
  const before = structuredClone(material);
  await importMaterial(project, 'host-p', material, selection);
  await importMaterial(project, 'host-p', material, selection);
  assert.deepEqual(material, before);
  assert.deepEqual(bodies[0], bodies[1]);
  const delivered = bodies[0].episodes[0];
  assert.equal(delivered.assetEvidence.contentHash, hash(delivered.content.trim()));
  assert.equal(delivered.assetEvidence.sourceContent, undefined);
  assert.equal(delivered.shots, undefined);
  assert.deepEqual(bodies[0].assets, []);
  const { idempotencyKey, ...body } = bodies[0];
  assert.equal(idempotencyKey, `sm2:${hash(JSON.stringify(body))}`);
});

test('explicit revision consent is included in delivery idempotency and remains stable on retry', async t => {
  const bodies = transport(t);
  const material = buildImportMaterial(project, new Map(), { scriptsOnly: true });
  await importMaterial(project, 'host-p', material, selection);
  await importMaterial(project, 'host-p', material, { ...selection, storyboardRevision: 'preserve-history' });
  await importMaterial(project, 'host-p', material, { ...selection, storyboardRevision: 'preserve-history' });
  assert.equal(bodies[0].storyboardRevision, undefined);
  assert.equal(bodies[1].storyboardRevision, 'preserve-history');
  assert.notEqual(bodies[0].idempotencyKey, bodies[1].idempotencyKey);
  assert.deepEqual(bodies[1], bodies[2]);
  const { idempotencyKey, ...body } = bodies[1];
  assert.equal(idempotencyKey, `sm2:${hash(JSON.stringify(body))}`);
  assert.equal(body.targetProjectId, 'host-p');
  assert.equal(body.episodes[0].shots, undefined);
  assert.deepEqual(body.assets, []);
});

test('changed prepared text drops stale evidence, returns readable warning and preserves input', async t => {
  const bodies = transport(t);
  const material = buildImportMaterial(project, new Map(), { scriptsOnly: true });
  material.episodes[0].content += '\n当前作者修改。';
  const before = structuredClone(material);
  const receipt = await importMaterial(project, 'host-p', material, selection);
  assert.deepEqual(material, before);
  assert.equal(bodies[0].episodes[0].assetEvidence, undefined);
  assert.match(bodies[0].episodes[0].content, /当前作者修改/);
  assert.match(receipt.warnings[0], /按当前正文交付.*重新分析/);
});

test('a new saved projection changes content hash and idempotency, while only selected episodes are sent', async t => {
  const bodies = transport(t);
  const first = buildImportMaterial(project, new Map(), { scriptsOnly: true });
  await importMaterial(project, 'host-p', first, selection);
  const changed = structuredClone(project);
  changed.episodes[0].generationRun.draft_master_script.scenes[0].character_actions.push('打开信封。');
  const next = buildImportMaterial(changed, new Map(), { scriptsOnly: true });
  next.episodes.push({ sourceEpisodeId: 'unselected', episodeNumber: 2, title: '未选择', content: '不交付' });
  await importMaterial(changed, 'host-p', next, selection);
  assert.equal(bodies[1].episodes.length, 1);
  assert.notEqual(bodies[0].idempotencyKey, bodies[1].idempotencyKey);
  assert.notEqual(bodies[0].episodes[0].assetEvidence.contentHash, bodies[1].episodes[0].assetEvidence.contentHash);
});

test('an appearance-only evidence change keeps the body hash but changes delivery idempotency', async t => {
  const bodies = transport(t);
  const input = structuredClone(project);
  input.characters = [{ id: 'character.lin', name: '林岚', appearance: '灰衣' }];
  input.episodes[0].generationRun.draft_master_script.scenes[0].content_manifest.character_refs = ['林岚'];
  await importMaterial(input, 'host-p', buildImportMaterial(input, new Map(), { scriptsOnly: true }), selection);
  input.characters[0].appearance = '蓝衣';
  await importMaterial(input, 'host-p', buildImportMaterial(input, new Map(), { scriptsOnly: true }), selection);
  assert.equal(bodies[0].episodes[0].content, bodies[1].episodes[0].content);
  assert.equal(bodies[0].episodes[0].assetEvidence.contentHash, bodies[1].episodes[0].assetEvidence.contentHash);
  assert.notEqual(bodies[0].idempotencyKey, bodies[1].idempotencyKey);
});
