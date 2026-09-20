import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingQuickSourceInputs } from '../lib/quick-source-recovery.ts';
import { DEFAULT_QUICK_GENERATION_SETTINGS } from '../lib/quick-script-project.ts';
import { generationDiagnostics } from '../lib/generation-diagnostics.ts';

const project = { id: 'demo-project', creationMode: 'quick', creativePrompt: '旧想法',
  quickSourceInputsRevision: 2,
  referenceMaterials: [{ extractedText: '人物资料' }], generationSettings: { ...DEFAULT_QUICK_GENERATION_SETTINGS } };
const state = { revision: 2, idea: '旧想法', source_material: '人物资料', synopsis_confirmed: false, plan_confirmed: false,
  episodes: [], active_operation: null, settings: { storyline_count: 1, target_duration_seconds: 90,
    target_total_characters: 8000, language: 'zh', episode_count: 8 } };

test('reopening an unchanged quick project ignores JSON property order', () => {
  assert.equal(pendingQuickSourceInputs(project, state), null);
});
test('source-page edits are retained for an explicit synopsis refresh', () => {
  const changed = { ...project, creativePrompt: '新版想法', generationSettings: { ...project.generationSettings, episodeCount: 5 } };
  const result = pendingQuickSourceInputs(changed, state);
  assert.equal(result.idea, '新版想法');
  assert.equal(result.settings.episode_count, 5);
  assert.equal(result.settings.target_total_characters, 8000);
  assert.equal(state.idea, '旧想法');
});
test('confirmed, busy and already written projects cannot be silently reset by source changes', () => {
  for (const patch of [{ synopsis_confirmed: true }, { plan_confirmed: true }, { active_operation: { operation_id: 'busy' } }, { episodes: [{}] }]) {
    assert.equal(pendingQuickSourceInputs({ ...project, creativePrompt: '新版' }, { ...state, ...patch }), null);
  }
});
test('material entered within quick mode is not overwritten by older source-page references', () => {
  assert.equal(pendingQuickSourceInputs({ ...project, quickSourceInputsRevision: undefined }, { ...state, source_material: '快速页补充的新资料' }), null);
  assert.equal(pendingQuickSourceInputs(project, { ...state, revision: 3, source_material: '已使用的新资料' }), null);
});
test('diagnostics identify a failed request without exposing prompts, content or auth', () => {
  const error = { status: 503, requestId: 'request-123', failureClass: 'stream_incomplete',
    message: 'PRIVATE', prompt: 'PRIVATE', authorization: 'PRIVATE', response: 'PRIVATE' };
  const report = generationDiagnostics({ projectId: 'demo-project', stage: 'plan', error, revision: 3, savedEpisodes: 9 });
  assert.equal(report.requestId, 'request-123');
  assert.equal(report.savedEpisodes, 9);
  assert.equal(report.status, 503);
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  assert.equal(generationDiagnostics({ projectId: 'demo-project', stage: 'plan', error: { requestId: 'https://secret/?token=private' } }).requestId, undefined);
});
