import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProducedBodyResolution, producedBodyEvidence } from '../lib/produced-body-resolution.ts';
import { producedDraftHash, producedEpisodeBodyHash } from '../lib/produced-plan-content.ts';
import { normalizeEpisodeLifecycle, resolveWorkingDraft } from '../lib/script-draft-state.ts';

async function fixture(){
 const draft={id:'original',title:'原稿',language:'zh',characters:[],scenes:[{scene_number:1,character_actions:['把原件扣在桌上。'],dialogues:[{character_name:'知微',text:'原件留下。'}],body_order:['action:0','dialogue:0']}]};
 const episode={id:'episode.1',episodeNumber:1,status:'confirmed',lockedAt:'2026-09-17',workingDraftJson:JSON.stringify(draft),confirmedDraftJson:JSON.stringify(draft),generationRun:{draft_master_script:draft,episode_context:{episode_number:1}},sourceAmendment:{amendmentId:'amend.1',status:'revision_required',sourceBodyHash:await producedDraftHash(draft),sourcePlanHash:'plan.current'}};
 const project={id:'project',planningRevisionEpoch:2,episodes:[episode]};
 const run={...episode.generationRun,draft_master_script:{...draft,id:'new',scenes:[{...draft.scenes[0],dialogues:[{character_name:'知微',text:'你要拿走原件，先把签收单给我。'}]}]}};
 return {draft,episode,project,run};
}

test('adopting revised body preserves source marker until server acknowledgment and original snapshot',async()=>{
 const f=await fixture(); const before=structuredClone(f.project);
 const next=await buildProducedBodyResolution(f.project,1,f.run,producedBodyEvidence(f.run.draft_master_script),'核对新稿逐句推进，人物没有越过已批准事件。');
 assert.deepEqual(f.project,before);
 assert.equal(next.episodes[0].sourceAmendment.amendmentId,'amend.1');
 assert.equal(next.episodes[0].lockedAt,undefined);
 assert.equal(next.episodes[0].confirmedDraftJson,undefined);
 assert.equal(resolveWorkingDraft(next.episodes[0]).scenes[0].dialogues[0].text,'你要拿走原件，先把签收单给我。');
 assert.equal(next.producedPlanAmendmentResolutionRequest.resolution,'revised');
 assert.equal(next.producedPlanAmendmentResolutionRequest.sourceBodyHash,await producedDraftHash(f.draft));
});

test('unchanged dependent review retains the locked visible original and records refreshed source',async()=>{
 const f=await fixture();f.episode.sourceAmendment.status='review_required';
 const next=await buildProducedBodyResolution(f.project,1,f.episode.generationRun,producedBodyEvidence(f.draft),'确认原稿因果衔接仍然成立，没有新增知情。');
 assert.equal(next.producedPlanAmendmentResolutionRequest.resolution,'reviewed');
 assert.equal(next.episodes[0].lockedAt,f.episode.lockedAt);
 assert.equal(next.episodes[0].workingDraftJson,f.episode.workingDraftJson);
});

test('explicit confirmation can review a body already consistent with its amended plan without rewriting it',async()=>{
 const f=await fixture();const before=structuredClone(f.project);
 const refreshed={...f.episode.generationRun,episode_context:{episode_number:1,approved_episode_plan:{source:'current'}}};
 const next=await buildProducedBodyResolution(f.project,1,refreshed,producedBodyEvidence(f.draft),
  '原稿已经删除错误现场动作，仍保留下落未明的对白与取证结果。',{existingBodyConforms:true});
 assert.equal(next.producedPlanAmendmentResolutionRequest.resolution,'reviewed');
 assert.equal(next.producedPlanAmendmentResolutionRequest.sourceBodyHash,next.producedPlanAmendmentResolutionRequest.acceptedBodyHash);
 assert.equal(next.episodes[0].workingDraftJson,f.episode.workingDraftJson);
 assert.equal(next.episodes[0].confirmedDraftJson,f.episode.confirmedDraftJson);
 assert.equal(next.episodes[0].lockedAt,f.episode.lockedAt);
 assert.equal(next.episodes[0].sourceAmendment.status,'revision_required');
 assert.deepEqual(next.episodes[0].generationRun,refreshed);
 assert.deepEqual(f.project,before);
});

test('existing-body confirmation cannot adopt changed text or omit substantive evidence',async()=>{
 for(const bad of ['changed','empty','quote','summary']){
  const f=await fixture();const run=bad==='changed'?f.run:f.episode.generationRun;
  const evidence=bad==='empty'?[]:bad==='quote'?[{sceneNumber:1,bodyOrderRef:'action:0',quote:'不存在的动作'}]:producedBodyEvidence(f.draft);
  await assert.rejects(buildProducedBodyResolution(f.project,1,run,evidence,bad==='summary'?'通过':'已核对当前正文与新规划的具体行动。',{existingBodyConforms:true}));
 }
});

test('pending locked episode retains candidate across lifecycle normalization',async()=>{
 const f=await fixture();f.episode.modificationCandidate={candidate_generation_run:f.run};
 assert.deepEqual(normalizeEpisodeLifecycle(f.episode).modificationCandidate,f.episode.modificationCandidate);
 const prior=structuredClone(f.episode);delete prior.sourceAmendment;
 assert.equal(normalizeEpisodeLifecycle(prior).modificationCandidate,undefined);
});

test('body identity hashes the same confirmed or final draft that the reader sees',async()=>{
 const f=await fixture();f.episode.workingDraftJson=JSON.stringify(f.run.draft_master_script);
 assert.equal(await producedEpisodeBodyHash(f.episode),await producedDraftHash(f.draft));
 f.episode.finalizationResult={master_script:f.run.draft_master_script};
 assert.equal(await producedEpisodeBodyHash(f.episode),await producedDraftHash(f.run.draft_master_script));
});

test('resolution refuses unchanged required rewrite, missing evidence, out-of-order work and active planning',async()=>{
 for(const bad of ['unchanged','quote','skip','active']){
  const f=await fixture();let run=f.run;let evidence=producedBodyEvidence(run.draft_master_script);
  if(bad==='unchanged')run=f.episode.generationRun;
  if(bad==='quote')evidence=[{sceneNumber:1,bodyOrderRef:'dialogue:0',quote:'不存在的台词'}];
  if(bad==='skip'){f.episode.episodeNumber=2;f.project.episodes.push({...f.episode,episodeNumber:1});}
  if(bad==='active')f.project.planningRevision={status:'active'};
  await assert.rejects(buildProducedBodyResolution(f.project,f.episode.episodeNumber,run,evidence,'已经逐句核对相关依据。'));
 }
});
