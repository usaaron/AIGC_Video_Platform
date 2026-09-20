import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

process.env.NEXT_PUBLIC_HOST_DELIVERY_URL = 'https://host.invalid/api/v1/script-master/deliveries';
delete process.env.NEXT_PUBLIC_HOST_LAUNCH_URL;
delete process.env.NEXT_PUBLIC_BASE_PATH;
const { buildImportMaterial } = await import('../lib/host-import-payload.ts');
const { deliverSeriesToHost } = await import('../lib/host-delivery.ts');
const { importMaterial } = await import('../lib/host-import.ts');

function fixture() {
  return { id: 'overseas-two', creationMode: 'quick', characters: [], deliveryContentRevision: 2,
    generationSettings: { episodeCount: 2, releaseRegion: 'overseas', outputLanguage: 'en' },
    episodes: [1, 2].map(number => ({ id: `episode-${number}`, episodeNumber: number, status: 'saved',
      generationRun: { draft_master_script: { id: `draft-${number}`, title: `核验记录${number}`, language: 'en',
        synopsis: 'Evan核验档案原件。', target_duration_seconds: 90,
        characters: [{ name: 'Evan', role: '调查员', description: '谨慎的调查员', motivation: '核实档案' }],
        episode_cast: ['Evan'], locations: ['档案室'], scenes: [{ scene_number: 1, slug: 'INT. 档案室 - 夜',
          purpose: '核验原件', beat_summary: '调查员核验记录', character_actions: [`Evan打开第${number}册档案。`],
          dialogues: [{ character_name: 'Evan', intent: '低声核对', text: `Check file ${number} before we leave.`,
            chinese_translation: `离开前核对第${number}份档案。` }], body_order: ['action:0', 'dialogue:0'] }] } } })) };
}

test('both host delivery paths preserve two saved English/Chinese pairs and hash the bilingual text', async t => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return Response.json({ status: 'completed', targetProjectId: 'overseas-two', importedEpisodes: 2, updatedEpisodes: 0 });
  });
  const project = fixture(), before = structuredClone(project);
  const material = buildImportMaterial(project, new Map(), { scriptsOnly: true });
  assert.equal(sent.length, 0, 'paired exports require no model or translation request');
  await importMaterial(project, project.id, material, { episodeIds: ['episode-1', 'episode-2'], assets: false, shots: false });
  await deliverSeriesToHost(project);
  assert.equal(sent.length, 2);
  for (const body of sent) for (const episode of body.episodes) {
    const number = episode.episodeNumber;
    assert.match(episode.content, new RegExp(`Check file ${number} before we leave\\.`));
    assert.match(episode.content, new RegExp(`中文：离开前核对第${number}份档案。`));
    assert.equal(episode.content.split(`Check file ${number} before we leave.`).length - 1, 1);
    assert.equal(episode.content.split(`离开前核对第${number}份档案。`).length - 1, 1);
    if (episode.assetEvidence) assert.equal(episode.assetEvidence.contentHash, createHash('sha256').update(episode.content.trim()).digest('hex'));
  }
  assert.deepEqual(sent[0].episodes.map(e => e.content.trim()), sent[1].episodes.map(e => e.content.trim()));
  assert.deepEqual(project, before);
});

test('mainland handoff keeps Chinese dialogue without adding overseas translation labels', () => {
  const project = fixture();
  for (const episode of project.episodes) {
    const draft = episode.generationRun.draft_master_script;
    draft.language = 'zh';
    draft.scenes[0].dialogues[0].text = '离开前核对档案。';
    draft.scenes[0].dialogues[0].chinese_translation = null;
  }
  const material = buildImportMaterial(project, new Map(), { scriptsOnly: true });
  assert.equal(material.episodes.length, 2);
  for (const episode of material.episodes) {
    assert.match(episode.content, /离开前核对档案。/);
    assert.doesNotMatch(episode.content, /中文：/);
  }
});
