import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAmendedEpisodeSource } from '../lib/amended-episode-context.ts';
import { producedPlanHash, producedDraftHash, producedPlanContentHash } from '../lib/produced-plan-content.ts';
import { modifyEpisodeDraft } from '../lib/generation-client.ts';

async function fixture() {
 const node={node_id:'node.current',version:2,story_bible_id:'bible.current',story_bible_version:2,status:'approved',planned_start_episode:1,planned_end_episode:10,title:'调查入口',narrative_purpose:'固定来源',entry_state:'既有手机',central_conflict:'查证',turning_points:[],unit_story_beats:[],unit_resolution:'结果',handoff_pressure:'承接',emotional_direction:'质疑',exit_state:'保留线索'};
 const plan={episode_number:1,status:'approved',source_node_id:node.node_id,source_node_version:2,story_bible_version:2,target_duration_seconds:90,planned_scene_count:2,planned_dialogue_line_count:30,planned_shot_count:16,episode_goal:'当面质疑并立刻断网',entry_state:'既有手机',central_conflict:'继续观察还是断开',protagonist_decision:'拔卡',reveal:null,emotional_movement:'警觉升级',dramatic_units:[],setup_refs:['setup.new'],payoff_refs:[],exit_state:'保留线索',cliffhanger:'发送给谁',character_refs:['character.lead','character.partner'],story_line_refs:[],continuity_requirements:['保持离线'],source_turning_points:[],source_unit_story_beats:[],scene_execution_plan:[{scene_number:1,scene_heading:'INT. 工作台 - 夜',character_refs:['character.lead','character.partner'],scene_objective:'截断通信',dialogue_objective:'相互质疑并决定拔卡',visible_action:'立刻拔卡',dialogue_line_target:30,shot_target:12,exit_state:'保留线索'},{scene_number:2,scene_heading:'INT. 门边 - 夜',character_refs:['character.lead'],scene_objective:'保管',dialogue_objective:'静默反应',visible_action:'收好手机',dialogue_line_target:0,shot_target:4,exit_state:'保留线索'}]};
 const draft={id:'draft.old',title:'旧稿',language:'zh',characters:[],scenes:[]};
 const source={story_project_id:'project.current',episode_context:{episode_number:1,total_episodes:10,ending_mode:'serial_hook',approved_episode_plan:{dialogue_objective:'旧录音25句'},episode_instruction:'旧录音操作要求',relevant_character_refs:['character.lead'],planned_setup_refs:['old.ref'],planned_payoff_refs:[],planned_story_line_refs:[]},draft_master_script:draft};
 const episode={id:'episode.1',episodeNumber:1,status:'saved',generationRun:source,workingDraftJson:JSON.stringify(draft),sourceAmendment:{amendmentId:'amendment.1',status:'revision_required',planningRevisionEpoch:2,sourcePlanHash:await producedPlanHash(plan),sourceBodyHash:await producedDraftHash(draft)}};
 const project={id:'project.current',planningRevisionEpoch:2,storyBibleVersion:2,episodes:[episode],episodeRoadmaps:[plan],characters:[],storyLines:[],characterRelationships:[],creativePrompt:'调查入口',referenceMaterials:[],generationSettings:{},producedPlanAmendments:[]};
 const bible={story_bible_id:'bible.current',version:2,status:'approved',core_premise:'调查',series_goal:'查证',theme:'承担',central_conflict:'查证',ending_direction:'公开',locked_facts:[],world_rules:[],avoid_patterns:[],character_registry:[],character_arc_targets:[],relationships:[],story_lines:[],major_setup_payoff_refs:[]};
 return{project,source,episode,plan,bible,node};
}

test('adopted execution plan replaces old recording contract with exact scene budgets and current refs',async()=>{
 const f=await fixture();const before=structuredClone(f);
 const run=await compileAmendedEpisodeSource(f.project,f.source,f.bible,[f.node]);
 assert.equal(run.episode_context.approved_episode_plan.scene_execution_plan[0].dialogue_objective,'相互质疑并决定拔卡');
 assert.deepEqual(run.episode_context.approved_episode_plan.scene_execution_plan.map(s=>s.dialogue_line_target),[30,0]);
 assert.equal(run.episode_context.approved_episode_plan.planned_dialogue_line_count,30);
 assert.deepEqual(run.episode_context.relevant_character_refs,['character.lead','character.partner']);
 assert.deepEqual(run.episode_context.planned_setup_refs,['setup.new']);
 assert.equal(run.episode_context.approved_story_node.node_version,2);
 assert.doesNotMatch(JSON.stringify(run.episode_context),/旧录音|old.ref/);
 assert.deepEqual(f,before);
});

test('amendment body compilation rejects unapproved, stale, out-of-order or open planning sources',async()=>{
 for(const change of ['draft','hash','node','prior','active']){
  const f=await fixture();
  if(change==='draft')f.plan.status='draft';
  if(change==='hash')f.plan.central_conflict='later changed';
  if(change==='node')f.node.version=3;
  if(change==='prior'){f.episode.episodeNumber=2;f.source.episode_context.episode_number=2;f.project.episodes.push({...f.episode,episodeNumber:1});}
  if(change==='active')f.project.planningRevision={status:'active'};
  await assert.rejects(compileAmendedEpisodeSource(f.project,f.source,f.bible,[f.node]));
 }
});

test('receipt hashes ignore only derivative metadata and preserve dialogue wording',async()=>{
 const {plan,source}=await fixture();
 assert.equal(await producedPlanHash(plan),await producedPlanHash({...plan,status:'draft',execution_ready:true,layer_contracts:{old:true}}));
 assert.notEqual(await producedPlanHash(plan),await producedPlanHash({...plan,episode_goal:'changed'}));
 const draft=source.draft_master_script;
 assert.equal(await producedDraftHash(draft),await producedDraftHash({...draft,id:'later',llm_metadata:{later:true}}));
 assert.notEqual(await producedDraftHash(draft),await producedDraftHash({...draft,title:'changed'}));
 assert.equal(await producedPlanContentHash({'10':'十','2':'二','𝄞':'谱','中':'文'}),'5909f88687749ddbb8e723e9f185456b90d8af8c32f422eef15328eb0aaa3d80');
});


test('actual modification request uses adopted plan, epoch and no old or future memory',async(t)=>{
 const f=await fixture(); f.node.parent_node_id=null;
 f.source.episode_context.project_continuity_summary='旧稿错误：未来已经定罪';
 f.source.episode_context.previous_episode_handoff='旧稿录音';
 f.source.episode_context.memory_recall={schema_version:'memory_recall.v1',memory_layer:'provisional',task:'episode_generation',through_episode_number:9,status:'sufficient',required_refs:[],missing_requirements:[],omitted_records:[],capsules:[{capsule_id:'future',memory_type:'hard_fact',summary:'未来已经定罪',source_episode:9,source_scene_numbers:[1],entity_refs:['old.ref'],evidence_refs:[],authority:'provisional',priority:95,mandatory:true}]};
 const before=structuredClone(f);let sent;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).includes('/plan-nodes?'))return Response.json({data:[f.node]});
  if(!init?.body)return Response.json({data:f.bible});
  sent=JSON.parse(init.body);return Response.json({data:{candidate_generation_run:null}});
 });
 await modifyEpisodeDraft(f.source,f.source.draft_master_script,'按照批准场景修改正文',undefined,null,f.project);
 assert.equal(sent.planning_revision_epoch,2);
 assert.equal(sent.source_generation_run.episode_context.approved_episode_plan.scene_execution_plan[0].dialogue_objective,'相互质疑并决定拔卡');
 assert.deepEqual(sent.source_generation_run.episode_context.approved_episode_plan.scene_execution_plan.map(s=>s.dialogue_line_target),[30,0]);
 assert.equal(sent.source_generation_run.episode_context.approved_story_node.node_version,2);
 assert.doesNotMatch(JSON.stringify(sent.source_generation_run.episode_context),/旧稿|未来已经定罪|旧录音|old.ref/);
 assert.deepEqual(f,before);
});
