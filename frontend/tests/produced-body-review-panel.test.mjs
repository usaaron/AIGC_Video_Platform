import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { authorConflictSourceSnapshot } from '../lib/author-conflict.ts';
import { buildProducedBodyResolution, producedBodyEvidence } from '../lib/produced-body-resolution.ts';
import { producedDraftHash } from '../lib/produced-plan-content.ts';
import { resolveWorkingDraft } from '../lib/script-draft-state.ts';

const compiled=ts.transpileModule(readFileSync(new URL('../components/produced-body-review-panel.tsx',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},
}).outputText;

async function harness(){
 const draft={id:'saved',title:'已纠正正文',language:'zh',characters:[],scenes:[{scene_number:1,character_actions:['她将样本推给窗口人员。'],dialogues:[{character_name:'沈知微',text:'下落未明，只核时间对应。'}],body_order:['action:0','dialogue:0']}]};
 const episode={id:'episode.59',episodeNumber:59,status:'saved',hasLocalDraftEdits:false,workingDraftJson:JSON.stringify(draft),generationRun:{draft_master_script:draft,episode_context:{episode_number:59}},sourceAmendment:{amendmentId:'amend.59',status:'revision_required',sourcePlanHash:'approved.current',sourceBodyHash:await producedDraftHash(draft)}};
 let project={id:'project.review',planningRevisionEpoch:2,episodes:[episode],characters:[],storyLines:[],characterRelationships:[],continuityStates:[]};
 const calls=[],state=[];let cursor=0;
 const behavior={failReview:false};
 const providers={getProject:()=>project,syncProjectSnapshot:async()=>{calls.push('sync');return {status:'synced'};},adoptServerProjectSnapshot:async value=>{calls.push('adopt');project=value;return true;},updateProject:async(_id,update)=>{project={...project,...update(project)};return true;}};
 const deps={
  react:{useState:initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];}},
  'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'},
  '@/lib/author-conflict':{authorConflictSourceSnapshot},
  '@/lib/continuity':{synchronizeContinuity:()=>{calls.push('continuity');return {};}},
  '@/lib/produced-body-resolution':{buildProducedBodyResolution,producedBodyEvidence},
  '@/lib/script-draft-state':{resolveWorkingDraft},
  '@/lib/generation-client':{
   refreshEpisodeSourceForModification:async run=>{calls.push('refresh');return {...run,episode_context:{episode_number:59,approved_episode_plan:{source:'current'}}};},
   reviewEpisodeDraft:async(run,body,epoch)=>{calls.push('review');assert.equal(epoch,2);assert.equal(run.episode_context.approved_episode_plan.source,'current');if(behavior.failReview)throw new Error('当前正文存在连续性阻断。');return {...run,draft_master_script:body};},
  },
  '@/lib/project-sync':{
   savePlanningRevisionSnapshot:async(_source,next)=>{calls.push({save:next});const result=structuredClone(next);delete result.producedPlanAmendmentResolutionRequest;delete result.episodes[0].sourceAmendment;return result;},
   saveEpisodeArtifactOnServer:async()=>{calls.push('artifact');return undefined;},
  },
  '@/providers/project-provider':{useProjects:()=>providers},
 };
 const context={exports:{},Error,require:name=>{if(!(name in deps))throw new Error(`Unexpected dependency ${name}`);return deps[name];}};
 vm.runInNewContext(compiled,context);
 return {calls,behavior,original:structuredClone(project),get project(){return project;},render(){cursor=0;return context.exports.ProducedBodyReviewPanel({project,episode:project.episodes[0]});}};
}

function elements(node){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(elements);return [node,...elements(node.props?.children)];}
function field(view,label){return elements(view.render()).find(node=>node.props?.['aria-label']===label);}
function saveButton(view){return elements(view.render()).find(node=>node.type==='button'&&String(node.props.children).includes('保存来源复核'));}
function selectEvidenceAndSummary(view){
 field(view,'来源修订复核结论').props.onChange({target:{value:'已逐项核对改后规划，正文只有窗口执行人员在场，老人仍下落不明。'}});
 field(view,'复核依据第1场dialogue:0').props.onChange({target:{checked:true}});
}

test('existing-body review is opt-in and refreshes, reviews, saves exact evidence before clearing its marker',async()=>{
 const view=await harness();
 selectEvidenceAndSummary(view);
 assert.equal(saveButton(view).props.disabled,true);
 assert.equal(field(view,'现有正文已符合修订规划').props.checked,false);
 assert.deepEqual(view.calls,[]);
 field(view,'现有正文已符合修订规划').props.onChange({target:{checked:true}});
 assert.equal(saveButton(view).props.disabled,false);
 saveButton(view).props.onClick();
 for(let n=0;n<20&&!view.calls.includes('artifact');n++)await setImmediate();
 assert.deepEqual(view.calls.slice(0,3),['refresh','review','sync']);
 const sent=view.calls.find(item=>item.save).save;
 assert.equal(sent.producedPlanAmendmentResolutionRequest.resolution,'reviewed');
 assert.equal(sent.producedPlanAmendmentResolutionRequest.evidence[0].quote,'下落未明，只核时间对应。');
 assert.equal(sent.episodes[0].sourceAmendment.status,'revision_required');
 assert.equal(sent.episodes[0].workingDraftJson,view.original.episodes[0].workingDraftJson);
 assert.equal(view.project.episodes[0].sourceAmendment,undefined);
 assert.deepEqual(view.calls.slice(-3),['adopt','continuity','artifact']);
});

test('a failed deterministic review keeps the required marker and never submits a resolution',async()=>{
 const view=await harness();view.behavior.failReview=true;selectEvidenceAndSummary(view);
 field(view,'现有正文已符合修订规划').props.onChange({target:{checked:true}});
 saveButton(view).props.onClick();await setImmediate();
 assert.deepEqual(view.calls,['refresh','review']);
 assert.deepEqual(view.project,view.original);
 assert.ok(elements(view.render()).some(node=>node.props?.role==='status'&&node.props.children==='当前正文存在连续性阻断。'));
});

test('an earlier keep-body confirmation cannot silently apply to a changed amendment source',async()=>{
 const view=await harness();selectEvidenceAndSummary(view);
 field(view,'现有正文已符合修订规划').props.onChange({target:{checked:true}});
 assert.equal(saveButton(view).props.disabled,false);
 view.project.episodes[0].sourceAmendment.sourcePlanHash='another-approved-source';
 assert.equal(field(view,'现有正文已符合修订规划').props.checked,false);
 assert.equal(saveButton(view).props.disabled,true);
 assert.deepEqual(view.calls,[]);
});
