import assert from 'node:assert/strict';
import test from 'node:test';
import { generateEpisodePlanBatch, auditStoryPlanQuality, prepareEpisodePlanItem, modifyEpisodePlanItem } from '../lib/story-planning-client.ts';

test('actual request payloads carry event requirements through drafting, editing and subsequent review', async t => {
  const node={node_id:'node.test',version:1,story_bible_id:'bible.test',story_bible_version:1,
    planned_start_episode:1,planned_end_episode:8,estimated_episode_count:8,status:'approved',expansion_status:'episode_ready'};
  const note={node_id:node.node_id,node_version:1,episode_number:1,source_event_index:1,instruction:'在使用原件前，从已知存放处取回原件。'};
  const audit={story_project_id:'project.test',story_bible_id:node.story_bible_id,story_bible_version:1,
    node_refs:[{node_id:node.node_id,node_version:1}],status:'pass',findings:[],execution_requirements:[note]};
  const project={id:'project.test',generationStrategyId:'strategy.test',storyTreeQualityAudit:audit,episodeRoadmaps:[]};
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    const body=JSON.parse(request.body);calls.push({url,body});
    if(String(url).includes('quality-audit'))return Response.json({data:audit});
    if(String(url).endsWith('/chunk'))return Response.json({data:Array.from({length:8},(_,i)=>({episode_number:i+1}))});
    return Response.json({data:{episode_number:1}});
  });
  const rows=await generateEpisodePlanBatch(project,node);
  await prepareEpisodePlanItem(project,node,rows[0],[]);
  await modifyEpisodePlanItem(project,node,rows[0],[],'完整落实取件再核验的顺序。');
  await auditStoryPlanQuality(project,{story_bible_id:node.story_bible_id,version:1},[node]);
  const localNote={episode_number:1,source_event_index:1,instruction:note.instruction};
  assert.equal(calls.length,4);
  for(const call of calls.slice(0,3))assert.deepEqual(call.body.execution_requirements,[localNote]);
  assert.deepEqual(calls[3].body.execution_requirements,[note]);
  assert.ok(calls[0].body.agent_request_id);
});
