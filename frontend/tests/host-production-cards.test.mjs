import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { productionProject } from './fixtures/host-production-project.mjs';
import { buildImportMaterial } from '../lib/host-import-payload.ts';
import { bindHostAssetEvidence } from '../lib/host-asset-evidence.ts';

test('handoff carries only appearing cards with precise scene order, silent cast and bilingual body', async () => {
  const project = productionProject(), before = structuredClone(project);
  const material = buildImportMaterial(project, new Map(), { scriptsOnly: true });
  assert.equal(material.episodes.length, 2);
  for (const episode of material.episodes) {
    const evidence = await bindHostAssetEvidence(episode.assetEvidence, episode.content);
    assert.equal(evidence.contentHash, createHash('sha256').update(episode.content.trim()).digest('hex'));
    assert.deepEqual(evidence.scenes, [
      { sourceSceneId: `${episode.sourceEpisodeId}:2`, heading: 'INT. 档案室 - 日' },
      { sourceSceneId: `${episode.sourceEpisodeId}:7`, heading: 'INT. 档案室 - 夜' },
    ]);
    assert.deepEqual(evidence.assets.find(a => a.name === 'Maya').sourceSceneIds, [`${episode.sourceEpisodeId}:2`]);
    assert.equal(evidence.assets.find(a => a.name === 'Maya').facts.外观, '棕色卷发，灰色制服');
    assert.equal(evidence.assets.find(a => a.name === 'Ethan').facts.年龄, '32');
    assert.equal(evidence.assets.find(a => a.name === '档案室').facts.固定细节1, '门在左侧，长桌在中央');
    assert.equal(evidence.assets.find(a => a.name === '档案室').facts.空间, '室内');
    assert.equal(evidence.assets.find(a => a.name === '铜钥匙').facts.外观, '黄铜材质，三角形钥匙头');
    assert.equal(evidence.assets.some(a => a.name === '旧怀表'), false);
    assert.equal((episode.content.match(/Check document /g) || []).length, 2);
    assert.equal((episode.content.match(/中文：/g) || []).length, 2);
  }
  assert.deepEqual(project, before);
});

test('synthetic default manifests never become complete or reintroduce unused plan cards', () => {
  const project = productionProject('zh');
  project.episodes[0].generationRun.draft_master_script.llm_metadata = { quick_asset_manifest_undeclared_scenes: [2] };
  const evidence = buildImportMaterial(project, new Map(), { scriptsOnly: true }).episodes[0].assetEvidence;
  assert.deepEqual(evidence.complete, { character: false, scene: false, prop: false });
  assert.equal(evidence.assets.some(a => a.name === 'Maya' || a.name === '铜钥匙'), false);
  assert.deepEqual(evidence.assets.find(a => a.name === 'Ethan').sourceSceneIds, ['source-episode-1:7']);
});

test('revised scene mappings cannot be rebound to different text or unknown asset scene IDs', async () => {
  const material = buildImportMaterial(productionProject(), new Map(), { scriptsOnly: true });
  const episode = material.episodes[0];
  assert.equal(await bindHostAssetEvidence(episode.assetEvidence, episode.content + '修订'), undefined);
  episode.assetEvidence.scenes[0].sourceSceneId = 'wrong-source';
  assert.equal(await bindHostAssetEvidence(episode.assetEvidence, episode.content), undefined);
});

test('unconfirmed cards and ambiguous location cards never enrich visual facts', () => {
  const project = productionProject();
  project.quickWorkflow.plan_confirmed = false;
  let evidence = buildImportMaterial(project, new Map(), { scriptsOnly: true }).episodes[0].assetEvidence;
  assert.deepEqual(evidence.assets.find(a => a.name === '铜钥匙').facts, {});
  project.quickWorkflow.plan_confirmed = true;
  project.quickWorkflow.plan.production_assets.push({ asset_ref: 'scene.duplicate', kind: 'scene', name: 'INT. 档案室 - 夜', appearance: '互相矛盾的背景', fixed_details: [] });
  evidence = buildImportMaterial(project, new Map(), { scriptsOnly: true }).episodes[0].assetEvidence;
  assert.deepEqual(evidence.assets.find(a => a.kind === 'scene').facts, { 空间: '室内' });
});

test('mixed interior and exterior appearances never invent a single location space', () => {
  const project = productionProject();
  const scene = project.episodes[0].generationRun.draft_master_script.scenes[1];
  scene.scene_heading = scene.slug = 'EXT. 档案室 - 夜';
  const evidence = buildImportMaterial(project, new Map(), { scriptsOnly: true }).episodes[0].assetEvidence;
  assert.equal(evidence.assets.find(a => a.kind === 'scene').facts.空间, undefined);
});
