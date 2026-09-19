import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildEpisodeMemoryRecall } from '../lib/memory-recall.ts';
import { synchronizeContinuity } from '../lib/continuity.ts';
import { sameEpisodeSetupPayoffSources } from '../lib/setup-payoff-provenance.ts';

const actual = JSON.parse(await readFile(new URL('./fixtures/overseas-episode-three-memory.json', import.meta.url), 'utf8'));
function fixture() { return structuredClone(actual); }
function focus(context) {
  return { episodeNumber: 3, storyBibleVersion: 2, relevantCharacterRefs: context.relevant_character_refs,
    plannedStoryLineRefs: context.planned_story_line_refs, plannedSetupRefs: context.planned_setup_refs,
    plannedPayoffRefs: context.planned_payoff_refs };
}

test('actual episode 3 recalls prior facts while its first approved introduction/payoff stays a current obligation', () => {
  const { project, context } = fixture(); const before = structuredClone(project);
  const recall = buildEpisodeMemoryRecall(project, focus(context));
  assert.equal(recall.status, 'sufficient');
  assert.deepEqual(recall.missing_requirements, []);
  assert.deepEqual(recall.same_episode_setup_payoffs.map(source => source.setup_payoff_ref), context.planned_payoff_refs);
  assert.equal(recall.through_episode_number, 2);
  for (const source of recall.same_episode_setup_payoffs) {
    assert.equal(source.episode_number, 3);
    assert.equal(source.source_node_version, project.episodeRoadmaps[2].source_node_version);
    assert.ok(!recall.required_refs.includes(source.setup_payoff_ref));
    assert.ok(!recall.capsules.some(capsule => capsule.entity_refs.includes(source.setup_payoff_ref)));
  }
  assert.deepEqual(project, before, 'approved refs and old bodies are not silently rewritten');
});

for (const mutation of ['missing current approval', 'missing prefix', 'draft prefix', 'newer draft lineage', 'earlier planned setup', 'actual ledger history', 'actual body without ledger']) {
  test(`past evidence remains mandatory without current first-introduction provenance: ${mutation}`, () => {
    const { project, context } = fixture(); const ref = context.planned_payoff_refs[0];
    if (mutation === 'missing current approval') project.episodeRoadmaps[2].status = 'draft';
    if (mutation === 'missing prefix') project.episodeRoadmaps.shift();
    if (mutation === 'draft prefix') project.episodeRoadmaps[0].status = 'draft';
    if (mutation === 'newer draft lineage') project.episodeRoadmaps.push({ ...project.episodeRoadmaps[2], source_node_version: 99, status: 'draft' });
    if (mutation === 'earlier planned setup') project.episodeRoadmaps[0].setup_refs.push(ref);
    if (mutation === 'actual ledger history') project.setupPayoffs.push({ ref, description: '此前铺设但过去状态缺失', status: 'open', setupEpisode: 1, lastUpdatedEpisode: 3, history: [], warnings: [] });
    if (mutation === 'actual body without ledger') project.episodes[0].generationRun.draft_master_script.setup_payoff_updates.push({ setup_payoff_ref: ref });
    const sources = sameEpisodeSetupPayoffSources(project, 3, 2);
    assert.ok(!sources.some(source => source.setup_payoff_ref === ref));
    const recall = buildEpisodeMemoryRecall(project, focus(context));
    assert.ok(recall.required_refs.includes(ref));
    // A previously approved route can itself supply a recalled ref. Cases
    // without that route evidence must retain the pre-existing hard stop.
    if (mutation !== 'earlier planned setup') {
      assert.equal(recall.status, 'insufficient');
      assert.ok(recall.missing_requirements.includes(ref));
    }
  });
}

test('setup/payoff overlap alone grants no exception without the complete approved prefix', () => {
  const { project, context } = fixture(); project.episodeRoadmaps = [];
  const recall = buildEpisodeMemoryRecall(project, focus(context));
  assert.equal(recall.status, 'insufficient');
  assert.deepEqual(recall.missing_requirements, context.memory_recall.missing_requirements);
  assert.equal(recall.same_episode_setup_payoffs, undefined);
});

test('a legacy split reference already established before this episode cannot masquerade as a first atomic ref', () => {
  const { project } = fixture(); const ref = '先留下的证据；本次解开原因，关系产生变化。';
  project.episodeRoadmaps[0].setup_refs = ['先留下的证据', '本次解开原因', '关系产生变化。'];
  project.episodeRoadmaps[2].setup_refs = [ref]; project.episodeRoadmaps[2].payoff_refs = [ref];
  assert.deepEqual(sameEpisodeSetupPayoffSources(project, 3, 2), []);
});

function payoffEpisode({ evidence = [1], proof = true, stale = false } = {}) {
  const { project, context } = fixture(); const ref = context.planned_payoff_refs[0];
  context.planned_setup_refs = [ref]; context.planned_payoff_refs = [ref];
  context.memory_recall = { ...context.memory_recall, same_episode_setup_payoffs: proof
    ? sameEpisodeSetupPayoffSources(project, 3, 2).filter(source => source.setup_payoff_ref === ref) : [] };
  if (stale) context.memory_recall.same_episode_setup_payoffs[0].source_node_version++;
  const draft = {
    id: 'draft.first-reveal', title: '承认原因', logline: 'Noah面对旧事', synopsis: 'Noah在追问后承认当年的怯场',
    hook: '如何重新合作', language: 'en-US', characters: [],
    scenes: [{ scene_number: 1, slug: 'INT. REHEARSAL ROOM - NIGHT', summary: '面对旧事',
      character_actions: ['Noah直面提问并说出原因。'], action_beats: [], dialogues: [] }],
    setup_payoff_updates: [{ setup_payoff_ref: 'generated.setup_payoff.stable', source_ref: ref, action: 'payoff', status: 'paid_off',
      progress_summary: 'Noah承认当年怯场。', change_cause: 'Sam提出当年缺席的问题。', evidence_scene_numbers: evidence }],
    next_episode_question: '如何重新合作？',
  };
  return { ref, episode: { episodeNumber: 3, generationRun: { episode_context: context, draft_master_script: draft }, workingDraftJson: JSON.stringify(draft) } };
}

test('approved current introduction and visible payoff replay as same-episode dates without phantom earlier setup or warnings', () => {
  const { ref, episode } = payoffEpisode();
  const record = synchronizeContinuity('最后一遍排练', [], [episode]).setupPayoffs.find(record => record.ref === ref);
  assert.equal(record.setupEpisode, 3);
  assert.equal(record.payoffEpisode, 3);
  assert.equal(record.status, 'paid_off');
  assert.deepEqual(record.warnings, []);
  assert.deepEqual(record.history.map(change => change.episodeNumber), [3]);
});

for (const options of [{ proof: false }, { evidence: [] }, { evidence: [99] }, { stale: true }]) {
  test(`ledger never invents setup timing from an unproven payoff: ${JSON.stringify(options)}`, () => {
    const { ref, episode } = payoffEpisode(options);
    const record = synchronizeContinuity('最后一遍排练', [], [episode]).setupPayoffs.find(record => record.ref === ref);
    assert.equal(record.setupEpisode, undefined);
    assert.ok(record.warnings.length > 0);
  });
}
