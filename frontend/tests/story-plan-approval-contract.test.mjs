import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmStoryPlanNode } from '../lib/story-planning-client.ts';
import { userFacingError } from '../lib/api-error.ts';

function movement(start, end) {
  return {
    node_id: 'node', story_project_id: 'project', version: 1, status: 'draft',
    title: '完成交付', narrative_purpose: '履行承诺并结清旧账', synopsis: '双方完成订单后约定新的合作边界。',
    entry_state: '订单尚待交付', central_conflict: '两人对责任的理解不同',
    turning_points: ['核对旧账后各自认责'], emotional_direction: '克制地重新建立信任',
    exit_state: '订单已经交付，新的合作边界明确。',
    unit_story_beats: ['发现缺货', '核对责任', '补齐原料', '实际交付'],
    unit_resolution: '订单交付完成，双方接受各自责任。', handoff_pressure: null,
    planned_start_episode: start, planned_end_episode: end,
  };
}

for (const [start, end] of [[1, 8], [1, 10], [61, 72]]) {
  test(`a complete final movement ${start}-${end} is approved without inventing a next conflict`, async t => {
    const original = movement(start, end); const before = structuredClone(original); const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, request) => {
      const body = JSON.parse(request.body); calls.push({ url, request, body });
      return Response.json({ data: body });
    });
    const result = await confirmStoryPlanNode(original, 'invalidate', end);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].request.method, 'PUT');
    assert.equal(result.status, 'approved');
    assert.equal(result.version, 2);
    assert.equal(result.handoff_pressure, null);
    assert.deepEqual(result.unit_story_beats, before.unit_story_beats);
    assert.deepEqual(original, before);
  });
}

test('missing intermediate handoff and incomplete endings never reach approval persistence', async t => {
  const calls=[];t.mock.method(globalThis, 'fetch', async()=>{calls.push('unexpected');throw new Error('unexpected persistence')});
  for (const [candidate, count] of [
    [movement(1, 10), 20],
    [movement(1, 10), undefined],
    [{...movement(1, 10),unit_story_beats:['发现缺货','实际交付']},10],
    [{...movement(1, 10),unit_resolution:''},10],
  ]) {
    await assert.rejects(confirmStoryPlanNode(candidate,'invalidate',count), error => {
      assert.match(error.message,/最小剧情单元尚未讲完整/);
      assert.equal(userFacingError(error,'请重试'),error.message);
      assert.equal(userFacingError(new Error(error.message+' INTERNAL_SECRET'),'请重试'),'请重试');
      return true;
    });
  }
  assert.deepEqual(calls,[]);
});
