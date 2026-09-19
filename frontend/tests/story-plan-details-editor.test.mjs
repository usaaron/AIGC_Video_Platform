import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';
import {userFacingError} from '../lib/api-error.ts';
import {editStoryPlanNodeBoundary} from '../lib/story-plan-boundary-editing.ts';
import {assertStoryPlanEventEditPreservesSources} from '../lib/story-plan-event-editing.ts';
const source = await readFile(new URL('../components/story-plan-details-editor.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React}}).outputText;
const texts = ['synopsis','narrative_purpose','central_conflict','emotional_direction','entry_state','exit_state','unit_resolution','handoff_pressure','decomposition_reason'];
const lists = ['turning_points','unit_story_beats','setup_refs','payoff_refs'];
const refs = ['character_refs','story_line_refs'];
function fixture() {
  return {
    node_id:'node.five',story_project_id:'project.saved',story_bible_id:'bible.saved',story_bible_version:3,
    version:7,parent_node_id:'root',parent_node_version:1,predecessor_node_id:'node.four',predecessor_node_version:8,
    sequence_order:5,title:'皇城解围与终极反攻',status:'draft',expansion_status:'unexpanded',
    planned_start_episode:91,planned_end_episode:130,estimated_episode_count:40,estimated_script_body_characters:25002,
    created_at:'2026-09-19T00:00:00Z',approved_at:null,
    synopsis:'Lane带伤救出Eileen，随后统领联军反攻。',narrative_purpose:'完成救援与既定反攻结局。',
    central_conflict:'皇城被围，Lane需要带伤救援。',emotional_direction:'由艰难坚持转为共同希望。',
    entry_state:'Lane已经重伤，Eileen尚未获救。',exit_state:'Lane完成联军反攻，系统之谜尚未揭晓。',
    unit_resolution:'皇城解围与反攻完成。',handoff_pressure:'系统之谜保留为后续暗线。',decomposition_reason:'本段承担带伤解围、联军反攻与既定收束。',
    turning_points:['Lane带伤救出Eileen。','联军完成反攻。'],
    unit_story_beats:['Lane集结军队。','皇城成功解围。','人类联军集结。','残余魔域肃清。'],
    setup_refs:['系统之谜仍未解。'],payoff_refs:['皇城救援完成。'],
    character_refs:['character.lane','character.legacy'],story_line_refs:['line.main'],episode_developments:[],
  };
}
const bible = {character_registry:[{character_ref:'character.lane',name:'Lane Claude'},{character_ref:'character.eileen',name:'Eileen'}],
  story_lines:[{story_line_id:'line.main',title:'人类反攻主线'},{story_line_id:'line.eileen',title:'公主责任与情感'}]};
function formFor(node, updates={}) {
  const value={...node,...updates}, data=new FormData();
  for(const key of texts)data.set(key,value[key]??'');
  for(const key of lists)data.set(key,value[key].join('\n'));
  for(const key of refs)for(const ref of value[key])data.append(key,ref);
  return data;
}
function load({save=async()=>true,initial=fixture()}={}) {
  const state=[];let cursor=0;
  const useState=seed=>{const i=cursor++;if(!(i in state))state[i]=seed;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];};
  const module={exports:{}};
  const require=name=>{
    if(name==='react')return{useState};
    if(name==='@/lib/api-error')return{userFacingError};
    if(name==='@/lib/story-plan-boundary-editing')return{editStoryPlanNodeBoundary};
    if(name==='@/lib/story-plan-event-editing')return{assertStoryPlanEventEditPreservesSources};
    throw new Error(`Unexpected dependency ${name}`);
  };
  class ExistingFormData extends FormData{constructor(form){super();for(const[k,v]of form.formData)this.append(k,v);}}
  new Function('require','module','exports','React','FormData',compiled)(require,module,module.exports,React,ExistingFormData);
  let locked=false;const calls=[];
  return {helper:module.exports.storyPlanDetailsFromForm,state,calls,setLocked(v){locked=v;},render(){cursor=0;
    return module.exports.StoryPlanDetailsEditor({node:initial,storyBible:bible,locked,onSave:async candidate=>{calls.push(candidate);return save(candidate);}});}};
}
function all(e){return !e||typeof e!=='object'?[]:[e,...React.Children.toArray(e.props?.children).flatMap(all)];}
function open(v){const button=v.render();assert.equal(button.type,'button');button.props.onClick();return v.render();}
function eventFor(data){return{currentTarget:{formData:data},preventDefault(){this.prevented=true;}};}
function mappedNode(){const node=fixture();node.planned_end_episode=93;node.episode_developments=[91,92,93].map(episode_number=>({episode_number,synopsis:`事件${episode_number}`,entry_state:`进入${episode_number}`,exit_state:`退出${episode_number}`,source_turning_points:[node.turning_points[0]],source_unit_story_beats:[node.unit_story_beats[0]]}));return node;}

// Execute the actual parser and rendered handlers with in-memory React hooks.
// The synthetic form remains owned by the caller, as an uncontrolled DOM form is.
test('one complete form preserves allocation, IDs, versions and history while updating story and refs',()=>{
  const node=fixture(),before=structuredClone(node),view=load();
  const updates={synopsis:'Lane只在带伤驰援之后救出Eileen，随后开始联军反攻。',turning_points:['先解围救人。','再统领联军反攻。'],unit_story_beats:['带伤集结。','解围救人。','联军反攻。','既定结局。'],setup_refs:['系统仍未解释。'],payoff_refs:['Eileen已经获救。'],character_refs:['character.lane','character.legacy','character.eileen'],story_line_refs:['line.main','line.eileen']};
  const data=formFor(node,updates);data.set('node_id','foreign');data.set('version','99');data.set('estimated_script_body_characters','999999');
  const result=view.helper(node,data);
  for(const[k,v]of Object.entries(updates))assert.deepEqual(result[k],v,k);
  for(const key of ['node_id','story_project_id','story_bible_id','story_bible_version','version','parent_node_id','parent_node_version','predecessor_node_id','predecessor_node_version','sequence_order','title','status','expansion_status','planned_start_episode','planned_end_episode','estimated_episode_count','estimated_script_body_characters','created_at','approved_at'])assert.deepEqual(result[key],node[key],key);
  assert.deepEqual(result.episode_developments,[]);assert.deepEqual(node,before);
});
test('checkbox document order cannot reorder existing references; unchecks remove and new checks append',()=>{
  const node=fixture();node.character_refs=['character.legacy','character.eileen','character.lane'];node.story_line_refs=['line.eileen','line.main'];
  const before=structuredClone(node);
  const data=formFor(node,{character_refs:['character.lane','character.new','character.legacy'],story_line_refs:['line.main','line.eileen','line.new']});
  const result=load().helper(node,data);
  assert.deepEqual(result.character_refs,['character.legacy','character.lane','character.new']);
  assert.deepEqual(result.story_line_refs,['line.eileen','line.main','line.new']);
  assert.deepEqual(node,before);
});
test('entry and exit synchronise existing first/last episodes without changing sources or intermediate episodes',()=>{
  const node=mappedNode(),before=structuredClone(node);
  const result=load().helper(node,formFor(node,{entry_state:'修订后的首集进入状态。',exit_state:'修订后的末集退出状态。'}));
  assert.equal(result.episode_developments[0].entry_state,result.entry_state);assert.equal(result.episode_developments[2].exit_state,result.exit_state);
  assert.deepEqual(result.episode_developments[1],before.episode_developments[1]);
  for(let i=0;i<3;i++)for(const key of ['synopsis','source_turning_points','source_unit_story_beats'])assert.deepEqual(result.episode_developments[i][key],before.episode_developments[i][key]);
  assert.equal(result.episode_developments[0].exit_state,before.episode_developments[0].exit_state);assert.equal(result.episode_developments[2].entry_state,before.episode_developments[2].entry_state);assert.deepEqual(node,before);
});
for(const field of ['turning_points','unit_story_beats'])test(`changing ${field} with existing source mappings is blocked instead of guessing`,async()=>{
  const node=mappedNode(),before=structuredClone(node),view=load({initial:node});const form=open(view);
  await form.props.onSubmit(eventFor(formFor(node,{[field]:['新的首项事件。',...node[field].slice(1)]})));
  assert.equal(view.calls.length,0);const result=view.render();assert.equal(result.type,'form');
  assert.match(all(result).find(e=>e.props.role==='alert').props.children,/已有逐集事件安排/);assert.deepEqual(node,before);
});
for (const change of ['replace', 'insert', 'remove', 'reorder']) test(`parent-bound event ${change} stays in the form and never saves shifted references`, async () => {
  const node = fixture();
  node.parent_event_bindings = [{parent_event_index: 2, child_event_indices: [1, 2]}, {parent_event_index: 3, child_event_indices: [3, 4]}];
  const before = structuredClone(node), view = load({initial: node}), form = open(view);
  const beats = [...node.unit_story_beats];
  if (change === 'replace') beats[0] = '改写后的既定剧情事件。';
  if (change === 'insert') beats.unshift('新插入的剧情事件。');
  if (change === 'remove') beats.splice(0, 1);
  if (change === 'reorder') [beats[0], beats[1]] = [beats[1], beats[0]];
  const data = formFor(node, {unit_story_beats: beats}), entered = [...data], event = eventFor(data);
  await form.props.onSubmit(event);
  assert.equal(view.calls.length, 0);
  const result = view.render(); assert.equal(result.type, 'form');
  const message = all(result).find(e => e.props.role === 'alert').props.children;
  assert.match(message, /剧情事件已承接上层安排/);
  assert.doesNotMatch(message, /parent_event|indices|binding/);
  assert.deepEqual([...event.currentTarget.formData], entered);
  assert.deepEqual(node, before);
});
test('a parent-bound node can update story and boundaries while preserving its exact source binding', async () => {
  const node = fixture();
  node.parent_event_bindings = [{parent_event_index: 2, child_event_indices: [1, 2, 3, 4]}];
  const before = structuredClone(node), view = load({initial: node}), form = open(view);
  await form.props.onSubmit(eventFor(formFor(node, {synopsis: '本次仅调整故事说明并保留所有既定剧情事件。', exit_state: '修订后这一部分的累计状态。'})));
  assert.equal(view.calls.length, 1);
  assert.equal(view.render().type, 'button');
  assert.deepEqual(view.calls[0].parent_event_bindings, before.parent_event_bindings);
  assert.deepEqual(view.calls[0].unit_story_beats, before.unit_story_beats);
  assert.equal(view.calls[0].exit_state, '修订后这一部分的累计状态。');
  assert.deepEqual(node, before);
});
test('an explicit empty parent binding remains compatible with older editable nodes', () => {
  const node = {...fixture(), parent_event_bindings: []};
  const beats = ['修订后的第一事件。', ...node.unit_story_beats.slice(1)];
  const result = load().helper(node, formFor(node, {unit_story_beats: beats}));
  assert.deepEqual(result.unit_story_beats, beats);
  assert.deepEqual(result.parent_event_bindings, []);
});
test('readable reference controls preserve existing unmatched refs and cannot edit numeric allocation',()=>{
  const elements=all(open(load())),checks=elements.filter(e=>e.type==='input'&&e.props.type==='checkbox');
  assert.deepEqual(checks.map(e=>e.props.value),['character.lane','character.eileen','line.main','line.eileen']);
  assert.deepEqual(checks.map(e=>e.props.defaultChecked),[true,false,true,false]);
  assert.ok(elements.some(e=>e.type==='input'&&e.props.type==='hidden'&&e.props.value==='character.legacy'));
  assert.ok(elements.some(e=>e.type==='label'&&React.Children.toArray(e.props.children).includes('Lane Claude')));
  assert.ok(elements.some(e=>e.type==='label'&&React.Children.toArray(e.props.children).includes('公主责任与情感')));
  assert.ok(!elements.some(e=>e.type==='textarea'&&['planned_start_episode','estimated_script_body_characters','version'].includes(e.props.name)));
});
test('one submit saves once and closes only when the save finishes successfully',async()=>{
  let resolve;const pending=new Promise(done=>{resolve=done;}),view=load({save:()=>pending}),form=open(view);
  const data=formFor(fixture(),{synopsis:'本次手动修正后保留的完整故事梗概。'}),event=eventFor(data),work=form.props.onSubmit(event);
  assert.equal(event.prevented,true);assert.equal(view.calls.length,1);assert.equal(view.calls[0].synopsis,data.get('synopsis'));
  const saving=view.render();assert.equal(saving.type,'form');assert.equal(all(saving).find(e=>e.type==='fieldset').props.disabled,true);
  await saving.props.onSubmit(eventFor(data));assert.equal(view.calls.length,1);resolve(true);await work;assert.equal(view.render().type,'button');
});
for(const failure of ['throw','decline'])test(`${failure} save preserves open form/input and does not claim success`,async()=>{
  const view=load({save:async()=>{if(failure==='throw')throw new Error('internal failure');return false;}}),form=open(view);
  const data=formFor(fixture(),{synopsis:'尚未保存的手动修正应完整留在这个表单。'}),before=[...data],event=eventFor(data);
  await form.props.onSubmit(event);const result=view.render();assert.equal(result.type,'form');assert.equal(view.calls.length,1);assert.deepEqual([...event.currentTarget.formData],before);assert.equal(all(result).find(e=>e.type==='fieldset').props.disabled,false);
  if(failure==='throw'){const alert=all(result).find(e=>e.props.role==='alert');assert.match(alert.props.children,/尚未保存.*内容仍保留/);assert.doesNotMatch(alert.props.children,/internal failure/);}
});
test('both locked initial and already-open forms reject submission',async()=>{
  const view=load();view.setLocked(true);assert.equal(view.render().props.disabled,true);view.setLocked(false);open(view);view.setLocked(true);
  const form=view.render();assert.equal(all(form).find(e=>e.type==='fieldset').props.disabled,true);await form.props.onSubmit(eventFor(formFor(fixture())));assert.equal(view.calls.length,0);
});
test('invalid lists and text lengths stay local while entered values remain available',async()=>{
  const view=load();open(view);
  for(const[key,value,expected]of [
    ['turning_points',[],/至少填写一个关键转折/],['unit_story_beats',['同一事件。','同一事件。'],/重复内容/],
    ['unit_story_beats',Array.from({length:13},(_,i)=>`事件${i}`),/最多填写12项/],
    ['synopsis','短',/这一部分的故事请填写10至3000字/],['synopsis','长'.repeat(3001),/10至3000字/],
    ['handoff_pressure','短',/下一部分的压力请填写5至1500字/],
  ]){await view.render().props.onSubmit(eventFor(formFor(fixture(),{[key]:value})));const form=view.render();assert.equal(form.type,'form');assert.match(all(form).find(e=>e.props.role==='alert').props.children,expected);}
  assert.equal(view.calls.length,0);
  const optional=load().helper(fixture(),formFor(fixture(),{unit_resolution:'',handoff_pressure:'',decomposition_reason:''}));
  for(const key of ['unit_resolution','handoff_pressure','decomposition_reason'])assert.equal(optional[key],null);
});
test('cancel leaves the saved node and save callback untouched',()=>{
  const node=fixture(),before=structuredClone(node),view=load({initial:node}),form=open(view);
  all(form).find(e=>e.type==='button'&&e.props.children==='取消').props.onClick();assert.equal(view.render().type,'button');assert.equal(view.calls.length,0);assert.deepEqual(node,before);
});
