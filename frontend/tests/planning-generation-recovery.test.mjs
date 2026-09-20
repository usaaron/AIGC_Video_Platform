import assert from 'node:assert/strict';
import test from 'node:test';
import { generateEpisodePlanBatch } from '../lib/story-planning-client.ts';

test('9/10 saved episodes survive a failed final request; retry streams progress and only saves the missing episode', async t => {
  const node = { node_id: 'node.recovery', version: 1, story_bible_id: 'bible.recovery', story_bible_version: 1,
    planned_start_episode: 1, planned_end_episode: 10, estimated_episode_count: 10, status: 'approved', expansion_status: 'episode_ready' };
  const saved = Array.from({ length: 9 }, (_, index) => ({ episode_number: index + 1,
    source_node_id: node.node_id, source_node_version: 1, story_bible_version: 1, status: 'draft', synopsis: `已保存第${index + 1}集` }));
  const project = { id: 'project.recovery', generationStrategyId: 'strategy.recovery', episodeRoadmaps: saved };
  const requests = []; const checkpoints = []; const events = [];
  const before = structuredClone(project);
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body); requests.push(body);
    assert.equal(body.episode_number, 10);
    assert.equal(body.accepted_plans.length, 9);
    assert.ok(new Headers(request.headers).get('Accept').includes('text/event-stream'));
    if (requests.length === 1) return Response.json({ detail: '第10集需重试' }, { status: 422 });
    const stream = [
      { type: 'progress', stage: 'thinking', message: '正在处理第10集', request_id: 'request-final-episode' },
      { type: 'model_thinking', delta: '正在核对本集与已保存内容的衔接。', request_id: 'request-final-episode' },
      { type: 'result', data: { data: [{ episode_number: 10, synopsis: '补齐最后一集' }] } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const run = () => generateEpisodePlanBatch(project, node, item => checkpoints.push(item), undefined, { onProgress: event => events.push(event) });
  await assert.rejects(run(), error => error.status === 422);
  assert.deepEqual(project, before);
  assert.deepEqual(checkpoints, []);
  const result = await run();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].agent_request_id, requests[1].agent_request_id, 'retry keeps the idempotency identity');
  assert.deepEqual(checkpoints.map(item => item.episode_number), [10]);
  assert.equal(result.length, 10);
  assert.deepEqual(result.slice(0, 9), saved);
  assert.ok(events.some(event => event.type === 'model_thinking' && event.delta.includes('衔接')));
  assert.equal(events[0].request_id, 'request-final-episode');
});
