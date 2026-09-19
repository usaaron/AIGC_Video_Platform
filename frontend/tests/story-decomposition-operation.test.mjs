import assert from 'node:assert/strict';
import test from 'node:test';
import { decomposeStoryPlanNode } from '../lib/story-planning-client.ts';
import { ApiError } from '../lib/api-client.ts';
import { PLANNING_CALL_BUDGET_EXHAUSTED_MESSAGE, userFacingError, visibleApiError } from '../lib/api-error.ts';

const project = {id:'project.operation',generationStrategyId:'strategy.operation',planningRevisionEpoch:2};
const parent = {node_id:'parent.operation',version:3,story_bible_id:'bible.operation',story_bible_version:1,
  planned_start_episode:1,planned_end_episode:16};
function children(node = parent) {
  return [0,1].map(index=>({node_id:`child.${index}`,version:1,parent_node_id:node.node_id,parent_node_version:node.version,
    predecessor_node_id:index===0?null:'child.0',predecessor_node_version:index===0?null:1,
    sequence_order:index+1,planned_start_episode:index*8+1,planned_end_episode:(index+1)*8}));
}
const success = data => Response.json({data});
function skipRetryTimers(t) {
  t.mock.method(globalThis,'setTimeout',callback=>{queueMicrotask(callback);return 0;});
}

test('three transient POST attempts and later continuation after reload share one operation', async t => {
  skipRetryTimers(t);
  const posts=[],reads=[];
  t.mock.method(globalThis,'fetch',async (url,request)=>{
    if(request?.method!=='POST') {reads.push(url);return success([]);}
    posts.push(JSON.parse(request.body));
    if(posts.length<=2)return Response.json({detail:'temporary failure'},{status:503});
    return success(children());
  });
  await decomposeStoryPlanNode(project,parent,2,{authorInstruction:'保留原事件顺序。'});
  assert.equal(posts.length,3);
  assert.equal(reads.length,2);
  await decomposeStoryPlanNode({...project},{...parent},2,{authorInstruction:'保留原事件顺序。'});
  const reloaded = await import('../lib/story-planning-client.ts?decomposition-operation-reload');
  await reloaded.decomposeStoryPlanNode({...project},{...parent},2,{authorInstruction:'保留原事件顺序。'});
  assert.equal(posts.length,5);
  assert.match(posts[0].operation_id,/^[A-Za-z0-9_.:-]+$/);
  assert.ok(posts[0].operation_id.length<=120);
  for(const request of posts)assert.deepEqual(request,posts[0]);
});

test('operation identity changes with meaningful input and honors an explicit operation', async t => {
  const posts=[];
  t.mock.method(globalThis,'fetch',async (_url,request)=>{
    const body=JSON.parse(request.body);posts.push(body);
    return success(children({...parent,node_id:body.parent_node_id,version:body.parent_node_version}));
  });
  const cases=[
    [project,parent,2,{authorInstruction:'保持顺序。'}],
    [project,{...parent,version:4},2,{authorInstruction:'保持顺序。'}],
    [{...project,planningRevisionEpoch:3},parent,2,{authorInstruction:'保持顺序。'}],
    [{...project,generationStrategyId:'strategy.other'},parent,2,{authorInstruction:'保持顺序。'}],
    [project,parent,3,{authorInstruction:'保持顺序。'}],
    [project,parent,2,{authorInstruction:'补充受伤后果。'}],
  ];
  for(const args of cases)await decomposeStoryPlanNode(...args);
  assert.equal(new Set(posts.map(p=>p.operation_id)).size,cases.length);
  await decomposeStoryPlanNode(project,parent,2,{operationId:'operation.explicit.1'});
  assert.equal(posts.at(-1).operation_id,'operation.explicit.1');
});

for(const status of [422,503]) test(`budget exhaustion ${status} stops before another POST and keeps actionable guidance`, async t => {
  let posts=0;
  t.mock.method(globalThis,'setTimeout',()=>assert.fail('terminal budget error must not schedule a retry'));
  t.mock.method(globalThis,'fetch',async (_url,request)=>{
    assert.equal(request?.method,'POST');posts++;
    return Response.json({detail:'internal budget details',error_code:'planning_call_budget_exhausted',retryable:false},{status,
      headers:{'x-generation-retryable':'false','x-generation-failure-class':'planning_call_budget_exhausted',
        'x-generation-error-type':'planning_call_budget_exhausted'}});
  });
  await assert.rejects(decomposeStoryPlanNode(project,parent),error=>{
    assert.ok(error instanceof ApiError);
    assert.equal(error.retryable,false);
    assert.equal(error.errorType,'planning_call_budget_exhausted');
    assert.equal(error.message,PLANNING_CALL_BUDGET_EXHAUSTED_MESSAGE);
    assert.equal(userFacingError(new Error(error.message),'fallback'),error.message);
    return true;
  });
  assert.equal(posts,1);
  for(const market of ['cn_mainland','overseas_tiktok']) {
    assert.equal(visibleApiError('internal',503,market,'planning_call_budget_exhausted'),PLANNING_CALL_BUDGET_EXHAUSTED_MESSAGE);
  }
});

test('a lost successful response recovers saved children without restarting the operation', async t => {
  let posts=0,reads=0;
  t.mock.method(globalThis,'setTimeout',()=>assert.fail('complete saved children must avoid retry'));
  t.mock.method(globalThis,'fetch',async (_url,request)=>{
    if(request?.method==='POST') {posts++;throw new TypeError('Failed to fetch');}
    reads++;return success(children());
  });
  const result=await decomposeStoryPlanNode(project,parent);
  assert.deepEqual(result,children());
  assert.equal(posts,1);
  assert.equal(reads,1);
});
