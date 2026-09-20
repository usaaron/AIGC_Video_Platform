import assert from 'node:assert/strict';
import test from 'node:test';
import { recoveredStoryBibleProgressPatch } from '../lib/story-bible-recovery.ts';
import { storyPlanningInputSignature } from '../lib/story-planning-signature.ts';
import { DEFAULT_GENERATION_SETTINGS } from '../lib/types.ts';

function fixture() {
  const source = {
    id: 'project.recover-bible', creativePrompt: '记者保护证人并公开旧案证据', selectedTagIds: [], customTags: [],
    referenceMaterials: [], characters: [], episodes: [], generationBatches: [],
    generationSettings: { ...DEFAULT_GENERATION_SETTINGS },
    storySynopsis: { text: '记者保留证据原件，保护证人，最后公开完整真相。', status: 'confirmed', pendingChanges: false },
    storyBibleSynopsisOutdated: true, storyBibleVersion: 1, storyBibleStatus: 'draft',
    contentSpecId: 'spec.current', serverSync: { status: 'synced', workspaceRevision: 4, projectRevision: 2 },
  };
  const saved = { ...structuredClone(source), storyBibleVersion: 2,
    storyBibleInputSignature: storyPlanningInputSignature(source),
    serverSync: { status: 'synced', workspaceRevision: 5, projectRevision: 2 } };
  const bible = { story_project_id: source.id, content_spec_id: saved.contentSpecId, status: 'draft', version: 2 };
  return { source, saved, bible };
}

test('recovering a newly saved bible clears only its obsolete synopsis flag, without regenerating or discarding content', () => {
  const { source, saved, bible } = fixture();
  const before = structuredClone({ source, saved, bible });
  const patch = recoveredStoryBibleProgressPatch(source, saved, bible);
  assert.deepEqual(patch, { storyBibleSynopsisOutdated: false });
  assert.deepEqual({ source, saved, bible }, before);
  const restored = { ...saved, ...patch };
  assert.equal(restored.storyBibleSynopsisOutdated, false);
  assert.equal(restored.storyBibleInputSignature, storyPlanningInputSignature(restored));
  assert.equal(restored.storySynopsis.text, source.storySynopsis.text);
  assert.equal(recoveredStoryBibleProgressPatch(source, saved, bible, restored), null, 'a repeat receipt is a no-op');
});

test('an old draft, mismatched project/spec, or uncommitted version cannot clear the obsolete flag', () => {
  const { source, saved, bible } = fixture();
  for (const changed of [null, { ...bible, version: 1 }, { ...bible, version: 3 },
    { ...bible, story_project_id: 'another-project' }, { ...bible, content_spec_id: 'spec.old' },
    { ...bible, status: 'approved' }]) {
    assert.equal(recoveredStoryBibleProgressPatch(source, saved, changed), null);
  }
  assert.equal(recoveredStoryBibleProgressPatch({ ...source, storyBibleVersion: 2 }, saved, bible), null);
  assert.equal(recoveredStoryBibleProgressPatch(source, { ...saved, planningRevisionEpoch: 1 }, bible), null);
  assert.equal(recoveredStoryBibleProgressPatch(source, { ...saved, storyBibleInputSignature: 'old signature' }, bible), null);
});

test('synopsis changes are rejected even though the ordinary planning signature does not include them', () => {
  const { source, saved, bible } = fixture();
  for (const synopsis of [
    { ...source.storySynopsis, text: '另一版结局：销毁证据' },
    { ...source.storySynopsis, pendingChanges: true },
    { ...source.storySynopsis, status: 'draft' },
    { ...source.storySynopsis, authorNotes: ['这条建议尚未采用'] },
  ]) {
    const changedSource = { ...source, storySynopsis: synopsis };
    assert.equal(storyPlanningInputSignature(changedSource), storyPlanningInputSignature(source));
    assert.equal(recoveredStoryBibleProgressPatch(changedSource, saved, bible), null);
  }
  const unconfirmed = { ...source, storySynopsis: { ...source.storySynopsis, status: 'draft' } };
  assert.equal(recoveredStoryBibleProgressPatch(unconfirmed, { ...saved, storySynopsis: unconfirmed.storySynopsis }, bible), null);
});

test('database JSON object ordering does not prevent recovery of the same confirmed synopsis', () => {
  const { source, saved, bible } = fixture();
  saved.storySynopsis = Object.fromEntries(Object.entries(source.storySynopsis).reverse());
  assert.deepEqual(recoveredStoryBibleProgressPatch(source, saved, bible), { storyBibleSynopsisOutdated: false });
});

test('the provider callback preserves edits, newer revisions and production made while recovery was reading', () => {
  const { source, saved, bible } = fixture();
  for (const current of [
    { ...saved, creativePrompt: '刚输入的新故事' },
    { ...saved, storySynopsis: { ...saved.storySynopsis, text: '刚编辑的新结局' } },
    { ...saved, storyBibleVersion: 3 },
    { ...saved, planningRevisionEpoch: 1 },
    { ...saved, serverSync: { ...saved.serverSync, workspaceRevision: 6 } },
    { ...saved, episodes: [{ episodeNumber: 1 }] },
  ]) {
    const before = structuredClone(current);
    assert.equal(recoveredStoryBibleProgressPatch(source, saved, bible, current), null);
    assert.deepEqual(current, before);
  }
});
