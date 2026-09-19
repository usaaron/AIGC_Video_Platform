import assert from 'node:assert/strict';
import test from 'node:test';
import { auditStoryPlanQuality, canFinishUnreviewedRoadmapLeaf, storyPlanQualityAuditMatchesNodes,
  storyPlanQualityEpisodes } from '../lib/story-planning-client.ts';
import { storyQualityRejectionForEpisode } from '../lib/story-quality-gate.ts';

const project = {id:'project.source',generationStrategyId:'strategy.source',storyBibleVersion:3,
  storySynopsis:{version:2,status:'confirmed',text:'Lane先遇袭。\n再带伤救出“Eileen”。'}};
const nodes = [{node_id:'leaf.source',version:1,story_bible_id:'bible.source',story_bible_version:3,
  planned_start_episode:1,planned_end_episode:8,status:'approved',expansion_status:'episode_ready'}];
const sourceSignature = JSON.stringify(['project.source','bible.source',3,
  [2,'confirmed','Lane先遇袭。\n再带伤救出“Eileen”。']]);
const passed = {review_contract_version:13,reviewed_episode_plans:'[]',story_project_id:project.id,
  story_bible_id:'bible.source',story_bible_version:3,status:'pass',findings:[],
  node_refs:[{node_id:'leaf.source',node_version:1}],
  reviewed_source_fingerprint:'ab'.repeat(32),reviewed_source_signature:sourceSignature};
const matches = (audit, source = project) => storyPlanQualityAuditMatchesNodes(audit,nodes,[],{project:source});

test('a saved PASS is reusable only for its unchanged confirmed source', () => {
  const loaded = JSON.parse(JSON.stringify(passed));
  assert.equal(matches(loaded),true);
  assert.equal(matches(loaded,{...project,title:'仅改项目显示名'}),true);
  assert.equal(matches(loaded,{...project,storyBibleSynopsisOutdated:'false'}),true);
  for (const [label, source] of [
    ['different project',{...project,id:'project.other'}],
    ['different text',{...project,storySynopsis:{...project.storySynopsis,text:'Eileen先被救出，Lane随后遇袭。'}}],
    ['different synopsis version',{...project,storySynopsis:{...project.storySynopsis,version:3}}],
    ['draft synopsis',{...project,storySynopsis:{...project.storySynopsis,status:'draft'}}],
    ['pending changes',{...project,storySynopsis:{...project.storySynopsis,pendingChanges:true}}],
    ['outdated synopsis',{...project,storyBibleSynopsisOutdated:true}],
    ['different bible version',{...project,storyBibleVersion:4}],
    ['missing bible version',{...project,storyBibleVersion:undefined}],
    ['missing synopsis',{...project,storySynopsis:undefined}],
    ['missing text',{...project,storySynopsis:{...project.storySynopsis,text:undefined}}],
    ['blank synopsis',{...project,storySynopsis:{...project.storySynopsis,text:' \n '}}],
  ]) assert.equal(matches(loaded,source),false,label);
  assert.deepEqual(loaded,passed);
});

test('missing or malformed server source evidence cannot certify a cached PASS', () => {
  assert.equal(storyPlanQualityAuditMatchesNodes(passed,nodes),false);
  for (const update of [
    {reviewed_source_fingerprint:undefined}, {reviewed_source_fingerprint:null},
    {reviewed_source_fingerprint:'a'.repeat(63)}, {reviewed_source_fingerprint:'g'.repeat(64)},
    {reviewed_source_signature:undefined}, {reviewed_source_signature:null},
    {reviewed_source_signature:JSON.stringify(['project.source','bible.source',3,null])},
  ]) assert.equal(matches({...passed,...update}),false);
});

test('an unconfirmed source uses the server null signature and cannot later certify a confirmed source', () => {
  const draft = {...project,storySynopsis:{...project.storySynopsis,status:'draft'}};
  const audit = {...passed,reviewed_source_signature:JSON.stringify(['project.source','bible.source',3,null])};
  assert.equal(matches(audit,draft),true);
  assert.equal(matches(audit,project),false);
  const unversioned = {...project,storySynopsis:{...project.storySynopsis,version:undefined}};
  assert.equal(matches({...passed,reviewed_source_signature:JSON.stringify(['project.source','bible.source',3,
    [null,'confirmed',project.storySynopsis.text]])},unversioned),true);
});

test('source changes preserve historical failures without changing their content validity', () => {
  const roadmap = {episode_number:1,source_node_id:'leaf.source',source_node_version:1,story_bible_version:3,
    synopsis:'Lane遇袭受伤。'};
  for (const version of [12,13]) {
    const audit = {...passed,review_contract_version:version,status:'needs_revision',
      reviewed_source_fingerprint:undefined,reviewed_source_signature:undefined,
      reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(nodes,[roadmap])),
      findings:[{node_id:'leaf.source',node_version:1,title:'遇袭',summary:'受伤原因尚未交代。'}]};
    const changed = {...project,storySynopsis:{...project.storySynopsis,text:'补充了遇袭者的身份。'},
      episodeRoadmaps:[roadmap],storyTreeQualityAudit:audit};
    const loaded = JSON.parse(JSON.stringify(changed));
    assert.equal(storyPlanQualityAuditMatchesNodes(loaded.storyTreeQualityAudit,nodes,[roadmap],
      {allowLegacyFailure:true,project:loaded}),true);
    assert.match(storyQualityRejectionForEpisode(loaded,nodes,1),/受伤原因/);
    assert.equal(storyQualityRejectionForEpisode({...loaded,episodeRoadmaps:[{...roadmap,synopsis:'袭击者刺伤Lane。'}]},nodes,1),null);
  }
});

test('an incomplete leaf cannot use a reviewed prefix from a changed source', () => {
  const rows = Array.from({length:6},(_,i)=>({episode_number:i+1,source_node_id:'leaf.source',
    source_node_version:1,story_bible_version:3,synopsis:`行动${i+1}`}));
  const audit = {...passed,reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(nodes,rows.slice(0,4)))};
  assert.equal(canFinishUnreviewedRoadmapLeaf(audit,nodes,rows,{project}),true);
  assert.equal(canFinishUnreviewedRoadmapLeaf(audit,nodes,rows),false);
  assert.equal(canFinishUnreviewedRoadmapLeaf(audit,nodes,rows,{project:{...project,
    storySynopsis:{...project.storySynopsis,version:3}}}),false);
});

test('review requests retain only server-issued source evidence without stamping the local source', async t => {
  const responses = [passed,{...passed,reviewed_source_fingerprint:undefined,reviewed_source_signature:undefined}];
  t.mock.method(globalThis,'fetch',async()=>Response.json({data:responses.shift()}));
  const reviewed = await auditStoryPlanQuality(project,{story_bible_id:'bible.source',version:3},nodes);
  assert.equal(reviewed.reviewed_source_fingerprint,passed.reviewed_source_fingerprint);
  assert.equal(reviewed.reviewed_source_signature,sourceSignature);
  assert.equal(matches(reviewed),true);
  const unsigned = await auditStoryPlanQuality(project,{story_bible_id:'bible.source',version:3},nodes);
  assert.equal(unsigned.reviewed_source_fingerprint,undefined);
  assert.equal(unsigned.reviewed_source_signature,undefined);
  assert.equal(matches(unsigned),false);
});
