import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { generateEpisodePlanBatch, modifyEpisodePlanItem, prepareEpisodePlanItem } from '../lib/story-planning-client.ts';

test('saved future-review roadmaps keep local markers while every generation request sends only server fields', async t => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/future-source-review-roadmaps.json', import.meta.url), 'utf8'));
  const schema = JSON.parse(await readFile(new URL('../openapi/openapi.json', import.meta.url), 'utf8'))
    .components.schemas.EpisodePlanGenerationItem;
  const allowed = new Set(Object.keys(schema.properties));
  const [predecessor, first, second] = fixture.episodeRoadmaps;
  assert.deepEqual(first.source_revision_review, { previous_version: 3, current_version: 4 });
  const node = { node_id: first.source_node_id, version: first.source_node_version,
    story_bible_id: 'bible.projection-test', story_bible_version: first.story_bible_version,
    planned_start_episode: 54, planned_end_episode: 64, estimated_episode_count: 11,
    status: 'approved', expansion_status: 'episode_ready' };
  const project = { id: 'project.projection-test', generationStrategyId: 'strategy.test',
    planningRevisionEpoch: 1, episodeRoadmaps: [predecessor, first] };
  const before = structuredClone(fixture);
  const expected = row => Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key)));
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body);
    requests.push({ url: String(url), body });
    for (const item of [body.current_plan, body.predecessor_plan, ...(body.accepted_plans ?? [])].filter(Boolean)) {
      assert.deepEqual(Object.keys(item).filter(key => !allowed.has(key)), [],
        'strict EpisodePlanGenerationItem must not receive local approval/source metadata');
      for (const key of schema.required) assert.ok(key in item, `missing required field ${key}`);
    }
    if (String(url).endsWith('/chunk')) return Response.json({ data: Array.from({ length: 10 }, (_, index) => (
      { ...expected(second), episode_number: 55 + index }
    )) });
    return Response.json({ data: expected(body.episode_number === 54 ? first : second) });
  });
  await modifyEpisodePlanItem(project, node, first, [], '按最新批准本叶逐集事件修订本集完整规划。');
  await modifyEpisodePlanItem(project, node, second, [first], '按最新批准本叶逐集事件修订本集完整规划。');
  await prepareEpisodePlanItem(project, node, second, [first]);
  await generateEpisodePlanBatch(project, node);
  assert.equal(requests.length, 4);
  assert.deepEqual(requests[0].body.current_plan, expected(first));
  assert.deepEqual(requests[0].body.accepted_plans, []);
  for (const { body } of requests) {
    assert.equal(body.planning_revision_epoch, 1);
    assert.deepEqual(body.predecessor_plan, expected(predecessor));
  }
  for (const { body } of requests.slice(1)) assert.deepEqual(body.accepted_plans, [expected(first)]);
  for (const { body } of requests.slice(1, 3)) assert.deepEqual(body.current_plan, expected(second));
  assert.equal(requests[3].body.episode_number, 55, 'chunk resumes after the preserved first draft');
  assert.deepEqual(fixture, before, 'serialization must preserve source review markers and all saved budgets/scenes');
});
