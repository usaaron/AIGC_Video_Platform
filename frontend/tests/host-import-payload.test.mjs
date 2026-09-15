import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImportMaterial } from '../lib/host-import-payload.ts';
import { inspirationRequestProject } from '../lib/creation-setting-flow.ts';
import { EMPTY_INSPIRATION_BRIEF } from '../lib/story-inspiration-session.ts';
import { userFacingError } from '../lib/api-error.ts';

const draft = { id: 'draft-1', title: '第一集', language: 'zh-CN', synopsis: '测试正文', hook: '', characters: [{ name: '林岚', description: '黑发青年' }], locations: ['院子'], scenes: [{ scene_number: 1, slug: '院子', setting: '院子', purpose: '见面', beat_summary: '见面', character_actions: ['林岚走入院子'], dialogues: [], content_manifest: { props: ['信封'] } }] };
const shot = { shot_id: 'shot-1', duration_seconds: 5, framing: '中景', prompt: '', purpose: '见面', camera: '固定', action_sequence: ['林岚走入院子'], dialogue: ['你好'], sound: '脚步声', continuity_in: '门外', continuity_out: '院内' };
const project = { id: 'project-1', creativePrompt: '', referenceMaterials: [], characters: [], generationSettings: { episodeCount: 2 }, episodes: [{ id: 'episode-1', episodeNumber: 1, status: 'saved', generationRun: { draft_master_script: draft } }, { id: 'episode-2', episodeNumber: 2, status: 'editing', hasLocalDraftEdits: true, generationRun: { draft_master_script: draft } }] };
const board = { status: 'review', source_draft: draft, stale_scene_numbers: [], candidate: null, scenes: [{ scene_number: 1, shots: [shot] }] };

test('empty host project uses the submitted idea for preparation without changing existing input', () => {
  const result = inspirationRequestProject(project, ' 两个人在院子重逢 ', EMPTY_INSPIRATION_BRIEF);
  assert.equal(result.creativePrompt, '两个人在院子重逢');
  assert.equal(project.creativePrompt, '');
  const existing = { ...project, creativePrompt: '原作' };
  assert.equal(inspirationRequestProject(existing, '新增意见', EMPTY_INSPIRATION_BRIEF), existing);
  const references = { ...project, referenceMaterials: [{ content: '原作' }] };
  assert.equal(inspirationRequestProject(references, '新增意见', EMPTY_INSPIRATION_BRIEF), references);
  assert.equal(inspirationRequestProject(project, '', { ...EMPTY_INSPIRATION_BRIEF, additional_notes: ['已保存想法'] }).creativePrompt, '已保存想法');
});
test('planning prerequisite and session errors no longer collapse into generic inspiration failure', () => {
  const specific = '仅使用“我的标签”时，需要补充创作描述或选择至少一个系统标签。';
  assert.equal(userFacingError(new Error(specific), 'generic'), specific);
  assert.match(userFacingError(Object.assign(new Error('technical'), { name: 'HostSessionError' }), 'generic'), /主站.*重新打开/);
  assert.equal(userFacingError(new Error('secret technical detail'), 'generic'), 'generic');
});
test('reads only saved episodes and deduplicates named assets without creating media', () => {
  const result = buildImportMaterial(project, new Map([[1, board]]));
  assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].shots.length, 1);
  assert.equal(result.assets.length, 3);
  assert.deepEqual(result.assets.map(a => a.kind), ['character', 'scene', 'prop']);
  assert.equal(result.assets[0].subjectType, 'human');
  assert.match(result.episodes[0].shots[0].prompt, /你好/);
  assert.match(result.episodes[0].shots[0].prompt, /脚步声/);
  assert.equal(result.warnings.length, 0);
});
test('changed-source or missing storyboards leave scripts and assets available', () => {
  for (const changed of [null, { ...board, source_draft: { ...draft, synopsis: 'changed' } }, { ...board, stale_scene_numbers: [1] }]) {
    const result = buildImportMaterial(project, new Map([[1, changed]]));
    assert.equal(result.episodes[0].shots, undefined);
    assert.equal(result.assets.length, 3);
    assert.equal(result.warnings.length, 1);
  }
});
test('overlong shots are visibly excluded instead of truncated or silently split', () => {
  const result = buildImportMaterial(project, new Map([[1, { ...board, scenes: [{ scene_number: 1, shots: [{ ...shot, duration_seconds: 60 }] }] }]]));
  assert.equal(result.episodes[0].shots, undefined);
  assert.match(result.warnings[0], /60.*3–15/);
});
test('candidate is not imported and fractional duration is disclosed', () => {
  const result = buildImportMaterial(project, new Map([[1, { ...board, candidate: { shots: [] }, scenes: [{ scene_number: 1, shots: [{ ...shot, duration_seconds: 5.4 }] }] }]]));
  assert.equal(result.episodes[0].shots[0].duration, 5);
  assert.equal(result.warnings.length, 2);
});
test('oversized continuity notes exclude the episode storyboard with a readable warning', () => {
  const result = buildImportMaterial(project, new Map([[1, { ...board, scenes: [{ scene_number: 1, shots: [{ ...shot, continuity_in: '起'.repeat(1000), continuity_out: '终'.repeat(1000) }] }] }]]));
  assert.equal(result.episodes[0].shots, undefined);
  assert.match(result.warnings[0], /长度限制/);
  assert.equal(result.assets.length, 3);
});
