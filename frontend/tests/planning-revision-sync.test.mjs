import assert from 'node:assert/strict';
import test from 'node:test';
import { savePlanningRevisionSnapshot, queueProjectServerSync, forceWorkspaceOverwrite, saveGenerationTaskOnServer } from '../lib/project-sync.ts';
import { createGenerationRecoveryTask } from '../lib/generation-recovery.ts';

const storage=new Map();
globalThis.window={localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}};
const time='2026-09-17T00:00:00.000Z';
function project(id) {return {id,title:id,characters:[],episodes:[],referenceMaterials:[],generationSettings:{outputLanguage:'zh',targetTotalCharacters:100000,episodeCount:72,batchSize:10},status:'draft',updatedAt:time,createdAt:time,serverSync:{status:'synced',projectRevision:2,workspaceRevision:5}};}
function response(payload,revision=5){return Response.json({data:{workspace_payload:payload,revision,updated_at:payload.updatedAt,client_instance_id:'test'}});}

test('revision transition returns the actual server acknowledgement and saves once',async t=>{
 const source=project('revision.ack'),candidate={...source,planningRevisionEpoch:1,planningRevision:{status:'active'}};
 const methods=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  methods.push(init?.method??'GET');
  if(!init?.method)return response(source);
  const request=JSON.parse(init.body);assert.equal(request.revision,6);assert.equal(request.workspace_payload.planningRevisionEpoch,1);
  return response({...candidate,title:'Server accepted'},6);
 });
 const saved=await savePlanningRevisionSnapshot(source,candidate);
 assert.deepEqual(methods,['GET','PUT']);assert.equal(saved.title,'Server accepted');assert.equal(saved.serverSync.workspaceRevision,6);
 assert.equal(source.planningRevisionEpoch,undefined);
});

for(const kind of ['stale workspace','changed epoch','concurrent PUT'])test(`revision transition cannot automatically rebase ${kind}`,async t=>{
 const source=project('revision.'+kind),candidate={...source,planningRevisionEpoch:1};let puts=0,gets=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  if(init?.method==='PUT'){puts++;return Response.json({detail:'Planning changed'},{status:409});}
  gets++;return response(kind==='changed epoch'?{...source,planningRevisionEpoch:2}:source,kind==='stale workspace'?6:5);
 });
 await assert.rejects(savePlanningRevisionSnapshot(source,candidate),{status:409});
 assert.equal(gets,1);assert.equal(puts,kind==='concurrent PUT'?1:0);
});

for(const force of [false,true])test(`ordinary ${force?'forced':'queued'} sync cannot overwrite another planning epoch`,async t=>{
 const source=project(`revision.stale.${force}`);source.updatedAt='2026-09-18T00:00:00.000Z';let puts=0;
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  if(String(input).endsWith('/workspace')) {
   if(init?.method==='PUT'){puts++;return Response.json({detail:'Planning epoch changed'},{status:409});}
   return response({...source,planningRevisionEpoch:1,updatedAt:time},6);
  }
  return Response.json({data:{project_id:source.id,title:source.title,revision:2,output_language:'zh',target_total_characters:100000,planned_episode_count:72,default_batch_size:10,status:'draft'}});
 });
 const state=await(force?forceWorkspaceOverwrite(source):queueProjectServerSync(source));
 assert.equal(state.status,'conflict');assert.equal(puts,1);
});

for (const state of ['same old epoch', 'missing task', 'reload unavailable', 'new epoch', 'retry unavailable']) {
 test(`a rejected checkpoint stays rejected when reconciliation finds ${state}`, async t => {
  const task=createGenerationRecoveryTask({planningRevisionEpoch:1,batchNumber:1,startEpisode:11,endEpisode:20,episodePlanIds:[]});
  let puts=0,payload;
  t.mock.method(globalThis,'fetch',async (_url,init) => {
   if(init?.method==='PUT') {
    puts++;payload=JSON.parse(init.body);
    if(state==='retry unavailable' && puts>1)return Response.json({detail:'Unavailable'},{status:503});
    return Response.json({detail:'Planning epoch changed'},{status:409});
   }
   if(state==='missing task')return Response.json({detail:'Missing'},{status:404});
   if(state==='reload unavailable')throw new TypeError('fetch failed');
   if(state==='new epoch')payload.batch.planning_revision_epoch=2;
   return Response.json({data:payload});
  });
  await assert.rejects(saveGenerationTaskOnServer('revision.checkpoint.'+state,task),{status:409});
  assert.equal(puts,state==='same old epoch'?4:state==='retry unavailable'?2:1);
 });
}

test('a genuine checkpoint revision conflict can reconcile and receive server acknowledgement',async t=>{
 const task=createGenerationRecoveryTask({planningRevisionEpoch:1,batchNumber:1,startEpisode:11,endEpisode:20,episodePlanIds:[]});
 let puts=0,payload;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  if(init?.method==='PUT'){
   puts++;payload=JSON.parse(init.body);
   if(puts===1)return Response.json({detail:'Revision changed'},{status:409});
  }else{payload.batch.revision=3;payload.checkpoint.revision=3;}
  return Response.json({data:payload});
 });
 const saved=await saveGenerationTaskOnServer('revision.checkpoint.reconciled',task);
 assert.equal(puts,2);assert.equal(saved.serverBacked,true);assert.equal(saved.planningRevisionEpoch,1);
});
