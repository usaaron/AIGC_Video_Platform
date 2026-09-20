import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as queue from '../lib/adaptive-dependency-queue.ts';
import * as progress from '../lib/story-plan-tree-progress.ts';
import * as planning from '../lib/episode-generation-planning.ts';
import * as gates from '../lib/story-quality-gate.ts';
import { hasCompleteStoryPlanChildCoverage } from '../lib/story-plan-coverage.ts';
import { canFinishUnreviewedRoadmapLeaf, storyPlanQualityAuditMatchesNodes, storyPlanQualityEpisodes, currentStoryPlanExecutionRequirements } from '../lib/story-planning-client.ts';

function loadPipeline(file, client) {
  const module = { exports: {} };
  const imports = {
    '@/lib/story-planning-client': client,
    '@/lib/adaptive-dependency-queue': queue,
    '@/lib/story-plan-tree-progress': progress,
    '@/lib/episode-generation-planning': planning,
    '@/lib/story-quality-gate': gates,
  };
  const code = ts.transpileModule(fs.readFileSync(new URL(`../lib/${file}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    assert.ok(imports[name], `unexpected dependency ${name}`); return imports[name];
  } });
  return module.exports;
}

const bible = { story_bible_id: 'bible', version: 1 };

test('roadmap coordinator forwards actual model progress while retaining each durable checkpoint', async () => {
  const leaf = { ...node('streamed-leaf', 1, 8), status: 'approved' };
  const events = []; const saved = [];
  const client = {
    loadActiveStoryPlanNodes: async () => [leaf], storyPlanQualityAuditMatchesNodes, canFinishUnreviewedRoadmapLeaf,
    auditStoryPlanQuality: async () => report([leaf], false),
    generateEpisodePlanBatch: async (_project, current, checkpoint, _beforeStep, options) => {
      options.onProgress({ type: 'model_thinking', delta: '核对连续性', request_id: 'planning-stream-1' });
      const rows = Array.from({ length: 8 }, (_, index) => ({ episode_number: index + 1,
        source_node_id: current.node_id, source_node_version: 1, story_bible_version: 1, status: 'draft' }));
      for (const row of rows) await checkpoint(row);
      return rows;
    },
  };
  const { runFullEpisodeRoadmapGeneration } = loadPipeline('episode-roadmap-generation', client);
  await runFullEpisodeRoadmapGeneration({
    project: { id: 'project', generationSettings: { episodeCount: 8 } }, storyBible: bible,
    onModelProgress: event => events.push(event), onCheckpoint: item => saved.push(item.episode_number),
  });
  assert.deepEqual(events, [{ type: 'model_thinking', delta: '核对连续性', request_id: 'planning-stream-1' }]);
  assert.deepEqual(saved, [1, 2, 3, 4, 5, 6, 7, 8]);
});

function node(id, start, end, parent = null) {
  return { node_id: id, version: 1, title: id, story_bible_id: 'bible', story_bible_version: 1,
    parent_node_id: parent?.node_id ?? null, parent_node_version: parent?.version ?? null,
    predecessor_node_id: null, predecessor_node_version: null,
    planned_start_episode: start, planned_end_episode: end, estimated_episode_count: end - start + 1,
    sequence_order: 1 + Math.floor((start - (parent?.planned_start_episode ?? 1)) / (end - start + 1)),
    status: 'draft', expansion_status: end - start + 1 <= 12 ? 'episode_ready' : 'unexpanded' };
}
function report(nodes, fail) {
  return { reviewed_source_fingerprint:'a'.repeat(64), reviewed_source_signature:JSON.stringify(['project','bible',1,null]),
    status: fail ? 'needs_revision' : 'pass', findings: fail ? [{
    node_id: nodes[0].node_id, node_version: nodes[0].version, title: nodes[0].title,
    start_episode: nodes[0].planned_start_episode, end_episode: nodes[0].planned_end_episode,
    summary: '本段行动还未落实。', repair_instruction: '补充人物实际完成行动后的结果。',
  }] : [], node_refs: nodes.map(n => ({ node_id: n.node_id, node_version: n.version })) };
}

test('fresh execution requirements reach the first batch and survive intermediate reviews', async () => {
  const leaves = [node('A', 1, 8), node('B', 9, 16)].map(n => ({...n, status:'approved'}));
  const note = {node_id:'B',node_version:1,episode_number:9,source_event_index:1,instruction:'先取回已存放的原件，再现场核验。'};
  const events=[];
  const client={loadActiveStoryPlanNodes:async()=>leaves,storyPlanQualityAuditMatchesNodes:()=>false,canFinishUnreviewedRoadmapLeaf:()=>false,
    auditStoryPlanQuality:async(project,_b,nodes)=>{
      const count=project.episodeRoadmaps?.length??0;events.push(`review:${count}`);
      if(count)assert.deepEqual(project.storyTreeQualityAudit.execution_requirements,[note]);
      return {...report(nodes,false),execution_requirements:count===16?[]:[note]};
    },
    generateEpisodePlanBatch:async(project,n,checkpoint)=>{
      assert.deepEqual(project.storyTreeQualityAudit.execution_requirements,[note]);events.push(`draft:${n.node_id}`);
      const rows=Array.from({length:8},(_,i)=>({episode_number:n.planned_start_episode+i,
        source_node_id:n.node_id,source_node_version:1,story_bible_version:1,status:'draft'}));
      for(const row of rows)await checkpoint(row);return rows;
    }};
  const {runFullEpisodeRoadmapGeneration}=loadPipeline('episode-roadmap-generation',client);
  await runFullEpisodeRoadmapGeneration({project:{id:'project',generationSettings:{episodeCount:16}},storyBible:bible});
  assert.deepEqual(events,['review:0','draft:A','review:8','draft:B','review:16']);
});

test('execution requirements cannot leak across project, canon or node versions',()=>{
  const leaf=node('A',1,8);
  const note={node_id:'A',node_version:1,episode_number:1,source_event_index:1,instruction:'先取得原件再完成核验。'};
  const audit={...report([leaf],false),story_project_id:'project',story_bible_id:'bible',story_bible_version:1,execution_requirements:[note]};
  const project={id:'project',storyTreeQualityAudit:audit};
  assert.deepEqual(currentStoryPlanExecutionRequirements(project,[leaf]),[note]);
  for(const changed of [{...leaf,version:2},{...leaf,node_id:'other'},{...leaf,story_bible_version:2},{...leaf,story_bible_id:'other'}])
    assert.deepEqual(currentStoryPlanExecutionRequirements(project,[changed]),[]);
  assert.deepEqual(currentStoryPlanExecutionRequirements({...project,id:'other'},[leaf]),[]);
  assert.deepEqual(currentStoryPlanExecutionRequirements({...project,storyTreeQualityAudit:{...audit,node_refs:[]}},[leaf]),[]);
});

for (const failureLayer of [1, 2, null]) test(`automatic tree reviews before approval at layer ${failureLayer ?? 'all pass'}`, async () => {
  const root = { ...node('root', 1, 32), status: 'approved', expansion_status: 'expanded' };
  const top = [node('A', 1, 16, root), node('B', 17, 32, root)];
  Object.assign(top[1], { predecessor_node_id: top[0].node_id, predecessor_node_version: 1 });
  const nodes = [root, ...top];
  const events = [];
  let reviews = 0;
  const beforeStep = async () => {};
  const client = {
    hasCompleteStoryPlanChildCoverage,
    loadRootStoryPlanNode: async () => root,
    loadTopLevelStoryPlanNodes: async () => top,
    loadActiveStoryPlanNodes: async () => nodes,
    loadChildStoryPlanNodes: async (_p, id, _b, _bv, version) => nodes.filter(n => n.parent_node_id === id && n.parent_node_version === version),
    storyPlanQualityAuditMatchesNodes: () => false,
    canFinishUnreviewedRoadmapLeaf: () => false,
    auditStoryPlanQuality: async (_p, _b, frontier) => {
      reviews++; events.push(`review:${reviews}`);
      return report(frontier, reviews === failureLayer);
    },
    confirmStoryPlanNode: async (n, _policy, targetEpisodeCount) => { assert.equal(targetEpisodeCount, 32); events.push(`approve:${n.node_id}`); n.status = 'approved'; return n; },
    decomposeStoryPlanNode: async (_p, n, _count, options) => {
      assert.equal(options.beforeRequest, beforeStep, 'every decomposition attempt uses the coordinator pause gate');
      events.push(`expand:${n.node_id}`); n.expansion_status = 'expanded';
      const children = [node(`${n.node_id}.1`, n.planned_start_episode, n.planned_start_episode + 7, n),
        node(`${n.node_id}.2`, n.planned_start_episode + 8, n.planned_end_episode, n)];
      Object.assign(children[1], { predecessor_node_id: children[0].node_id, predecessor_node_version: 1 });
      nodes.push(...children); return children;
    },
  };
  const { runFullStoryTreeExpansion } = loadPipeline('story-tree-expansion', client);
  const run = runFullStoryTreeExpansion({ project: { id: 'project', generationSettings: { episodeCount: 32 } }, storyBible: bible,
    beforeStep,
    onQualityCheckpoint: async () => { events.push(`saved-review:${reviews}`); } });
  if (failureLayer) await assert.rejects(run, /先修订/); else await run;
  assert.ok(events.indexOf('saved-review:1') >= 0);
  if (failureLayer === 1) assert.equal(events.some(e => e.startsWith('approve:') || e.startsWith('expand:')), false);
  else {
    assert.ok(events.indexOf('saved-review:1') < events.indexOf('approve:A'));
    assert.ok(events.indexOf('expand:A') < events.indexOf('review:2'));
    assert.ok(events.indexOf('expand:B') < events.indexOf('review:2'));
    assert.equal(events.some(e => e.startsWith('approve:A.')), failureLayer === null);
    assert.equal(events.some(e => e.startsWith('approve:B.')), failureLayer === null);
  }
});

test('actual roadmap failure stops the next movement despite a passing tree', async () => {
  const leaves = [node('A', 1, 8), node('B', 9, 16)].map(n => ({ ...n, status: 'approved' }));
  const events = [];
  const saved = [];
  const audits = [];
  const client = {
    loadActiveStoryPlanNodes: async () => leaves,
    storyPlanQualityAuditMatchesNodes: () => false,
    canFinishUnreviewedRoadmapLeaf: () => false,
    auditStoryPlanQuality: async (project, _b, nodes) => {
      const actual = project.episodeRoadmaps ?? [];
      audits.push(actual.length); return report(nodes, actual.length > 0);
    },
    generateEpisodePlanBatch: async (_p, n, checkpoint) => {
      events.push(n.node_id);
      const items = Array.from({ length: 8 }, (_, i) => ({ episode_number: n.planned_start_episode + i,
        source_node_id: n.node_id, source_node_version: 1, story_bible_version: 1, status: 'draft' }));
      for (const item of items) await checkpoint(item);
      return items;
    },
  };
  const { runFullEpisodeRoadmapGeneration } = loadPipeline('episode-roadmap-generation', client);
  await assert.rejects(runFullEpisodeRoadmapGeneration({
    project: { id: 'project', generationSettings: { episodeCount: 16 } }, storyBible: bible,
    onCheckpoint: item => { saved.push(item); },
    onQualityCheckpoint: audit => { events.push(audit.status); },
  }), /先修订/);
  assert.deepEqual(audits, [0, 8]);
  assert.deepEqual(events, ['pass', 'A', 'needs_revision']);
  assert.equal(saved.length, 8);
  assert.equal(saved.every(item => item.status === 'draft'), true);
});

for(const scenario of ['pass','leaf failure','changed prefix']) test(`resume reviews a completed leaf before advancing: ${scenario}`, async()=>{
  const leaves=[node('A',1,8),node('B',9,16),node('C',17,24)].map(n=>({...n,status:'approved'}));
  const items=Array.from({length:24},(_,i)=>({episode_number:i+1,source_node_id:leaves[Math.floor(i/8)].node_id,
    source_node_version:1,story_bible_version:1,status:'draft',synopsis:`第${i+1}项具体行动。`}));
  const audit={...report(leaves,false),review_contract_version:13,story_bible_id:'bible',story_bible_version:1,
    reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(leaves,items.slice(0,8)))};
  const initial=items.slice(0,14).map(p=>scenario==='changed prefix'&&p.episode_number===1?{...p,synopsis:'改过已经审过的行动。'}:p);
  const events=[];
  const client={loadActiveStoryPlanNodes:async()=>leaves,storyPlanQualityAuditMatchesNodes,canFinishUnreviewedRoadmapLeaf,
    auditStoryPlanQuality:async(project,_b,nodes)=>{events.push(`review:${project.episodeRoadmaps.length}`);return report(nodes,scenario!=='pass');},
    generateEpisodePlanBatch:async(project,n,checkpoint)=>{
      events.push(n.node_id);
      const batch=items.filter(p=>p.source_node_id===n.node_id);
      for(const item of batch) if(!project.episodeRoadmaps.some(p=>p.episode_number===item.episode_number))await checkpoint(item);
      return batch;
    },
  };
  const {runFullEpisodeRoadmapGeneration}=loadPipeline('episode-roadmap-generation',client);
  const run=runFullEpisodeRoadmapGeneration({project:{id:'project',generationSettings:{episodeCount:24},episodeRoadmaps:initial,storyTreeQualityAudit:audit},storyBible:bible});
  if(scenario==='pass')await run;else await assert.rejects(run,/先修订/);
  assert.deepEqual(events,scenario==='pass'?['A','B','review:16','C','review:24']:
    scenario==='leaf failure'?['A','B','review:16']:['review:14']);
});

test('retained dependent drafts require a fresh full review and cannot reuse the old pass', async()=>{
  const leaves=[node('A',1,8),node('B',9,16)].map(n=>({...n,status:'approved'}));
  const before=Array.from({length:16},(_,i)=>({episode_number:i+1,source_node_id:leaves[Math.floor(i/8)].node_id,
    source_node_version:1,story_bible_version:1,status:'approved',entry_state:'原件由证人持有。',exit_state:'原件仍由证人控制。',
    source_turning_points:[],source_unit_story_beats:['当面核验原件。'],
    synopsis:`第${i+1}集的已写剧情。`,scene_execution_plan:[{scene_number:1,visible_action:'调查者直接询问地址。',exit_state:'原件未交接。'}]}));
  const audit={...report(leaves,false),review_contract_version:13,story_bible_id:'bible',story_bible_version:1,
    reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(leaves,before))};
  const revised=planning.replaceEpisodeRoadmapItem(before,{...before[1],scene_execution_plan:[{
    ...before[1].scene_execution_plan[0],visible_action:'证人先当面告知地址，调查者再询问。'}]}, {retainDependentDrafts:true});
  assert.equal(revised.length,16);
  assert.equal(revised.slice(1).every(p=>p.status==='draft'),true);
  assert.equal(storyPlanQualityAuditMatchesNodes(audit,leaves,revised),false);
  assert.equal(canFinishUnreviewedRoadmapLeaf(audit,leaves,revised),false);
  const events=[];
  const client={loadActiveStoryPlanNodes:async()=>leaves,storyPlanQualityAuditMatchesNodes,canFinishUnreviewedRoadmapLeaf,
    auditStoryPlanQuality:async(project,_b,nodes)=>{events.push(`review:${project.episodeRoadmaps.length}`);return report(nodes,true);},
    generateEpisodePlanBatch:async()=>{throw new Error('Failed review must block further generation');}};
  const {runFullEpisodeRoadmapGeneration}=loadPipeline('episode-roadmap-generation',client);
  await assert.rejects(runFullEpisodeRoadmapGeneration({project:{id:'project',generationSettings:{episodeCount:16},
    episodeRoadmaps:revised,storyTreeQualityAudit:audit},storyBible:bible}),/先修订/);
  assert.deepEqual(events,['review:16']);
});

for (const version of [8,12]) for (const newFailure of [false,true]) test(`v${version} cached pass cannot bypass the current review: ${newFailure?'fails':'passes'}`, async()=>{
  const leaves=[{...node('A',1,8),status:'approved'}];
  const items=Array.from({length:8},(_,i)=>({episode_number:i+1,source_node_id:'A',
    source_node_version:1,story_bible_version:1,status:'approved',planned_dialogue_line_count:25,
    synopsis:`第${i+1}集具体行动。`,scene_execution_plan:[{scene_number:1,
      visible_action:'双方争执后退回申请。',exit_state:'申请被退回。',character_refs:['character.lead','character.clerk'],
      dialogue_objective:'迫使对方解释拒收并作出书面决定。',dialogue_line_target:25}]}));
  const audit={...report(leaves,false),review_contract_version:version,story_bible_id:'bible',story_bible_version:1,
    reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(leaves,items))};
  const project=JSON.parse(JSON.stringify({id:'project',generationSettings:{episodeCount:8},
    episodeRoadmaps:items,storyTreeQualityAudit:audit}));
  const events=[];
  const client={loadActiveStoryPlanNodes:async()=>leaves,storyPlanQualityAuditMatchesNodes,canFinishUnreviewedRoadmapLeaf,
    auditStoryPlanQuality:async()=>{events.push('review-v13');return {...audit,...report(leaves,newFailure),review_contract_version:13};},
    generateEpisodePlanBatch:async()=>{events.push('continue');return items;}};
  const {runFullEpisodeRoadmapGeneration}=loadPipeline('episode-roadmap-generation',client);
  const run=runFullEpisodeRoadmapGeneration({project,storyBible:bible,
    onQualityCheckpoint:async audit=>{events.push('persist-v13');assert.equal(audit.review_contract_version,13);}});
  if(newFailure)await assert.rejects(run,/先修订/);else await run;
  assert.deepEqual(events,newFailure?['review-v13','persist-v13']:['review-v13','persist-v13','continue']);
  assert.equal(project.storyTreeQualityAudit.review_contract_version,version);
});

for (const workflow of ['tree','roadmap']) for (const changed of [false,true]) {
  test(`${workflow} only reuses a PASS for the same confirmed source: ${changed?'changed':'unchanged'}`, async()=>{
    const root = {...node('root',1,8),status:'approved',expansion_status:'expanded'};
    const leaves = [{...node('A',1,8,root),status:'approved'}];
    const items = workflow === 'tree' ? [] : Array.from({length:8},(_,i)=>({episode_number:i+1,
      source_node_id:'A',source_node_version:1,story_bible_version:1,status:'approved',synopsis:`剧情${i+1}`}));
    const source = {version:1,status:'confirmed',text:'先遇袭受伤，再救出公主。'};
    const audit = {...report(leaves,false),review_contract_version:13,story_bible_id:'bible',story_bible_version:1,
      reviewed_source_signature:JSON.stringify(['project','bible',1,[1,'confirmed',source.text]]),
      reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(leaves,items))};
    const project = {id:'project',storyBibleVersion:1,generationSettings:{episodeCount:8},episodeRoadmaps:items,
      storySynopsis:{...source,text:changed?'先揭示偷袭者，再承接带伤救援。':source.text},storyTreeQualityAudit:audit};
    const events=[];
    const client={hasCompleteStoryPlanChildCoverage,storyPlanQualityAuditMatchesNodes,canFinishUnreviewedRoadmapLeaf,
      loadRootStoryPlanNode:async()=>root,loadTopLevelStoryPlanNodes:async()=>leaves,
      loadActiveStoryPlanNodes:async()=>[root,...leaves],loadChildStoryPlanNodes:async()=>[],
      auditStoryPlanQuality:async()=>{events.push('review');return {...audit,...report(leaves,true)};},
      generateEpisodePlanBatch:async()=>{events.push('continue');return items;},
      confirmStoryPlanNode:async()=>assert.fail('already approved'),decomposeStoryPlanNode:async()=>assert.fail('already episode-ready')};
    const runWorkflow = workflow === 'tree'
      ? loadPipeline('story-tree-expansion',client).runFullStoryTreeExpansion
      : loadPipeline('episode-roadmap-generation',client).runFullEpisodeRoadmapGeneration;
    const run = runWorkflow({project,storyBible:bible,onQualityCheckpoint:async()=>events.push('persist')});
    if(changed)await assert.rejects(run,/先修订/);else await run;
    assert.deepEqual(events,changed?['review','persist']:workflow==='tree'?[]:['continue']);
  });
}

function scopedTreeFixture({ existingChildren = false, failure = false, invalid } = {}) {
  const root = { ...node('root', 1, 160), status: 'approved', expansion_status: 'expanded' };
  const top = Array.from({ length: 5 }, (_, i) => node(`part${i + 1}`, i * 32 + 1, (i + 1) * 32, root));
  top.forEach((n, i) => Object.assign(n, { sequence_order: i + 1,
    predecessor_node_id: top[i - 1]?.node_id ?? null, predecessor_node_version: i ? 1 : null }));
  const selected = top[1];
  const nodes = [root, ...top];
  const childrenOf = n => {
    const children = [node(`${n.node_id}.1`, n.planned_start_episode, n.planned_start_episode + 15, n),
      node(`${n.node_id}.2`, n.planned_start_episode + 16, n.planned_end_episode, n)];
    Object.assign(children[1], { predecessor_node_id: children[0].node_id, predecessor_node_version: 1 });
    return children;
  };
  if (existingChildren) { selected.status = 'approved'; selected.expansion_status = 'expanded'; nodes.push(...childrenOf(selected)); }
  const events = [], reviews = [], checkpoints = [];
  const client = {
    hasCompleteStoryPlanChildCoverage,
    loadRootStoryPlanNode: async () => invalid === 'missing root' ? null : root,
    loadTopLevelStoryPlanNodes: async () => invalid === 'missing top' ? [] : invalid === 'gap' ? top.slice(0, 4) : top,
    loadActiveStoryPlanNodes: async () => nodes,
    loadChildStoryPlanNodes: async (_p, id, _b, _bv, version) => nodes.filter(n => n.parent_node_id === id && n.parent_node_version === version),
    generateTopLevelStoryPlanNodes: async () => { events.push('generate-top'); throw new Error('must not generate top'); },
    storyPlanQualityAuditMatchesNodes: () => false,
    auditStoryPlanQuality: async (_p, _b, frontier) => { events.push('review'); reviews.push(frontier.map(n => n.node_id)); return report(frontier, failure); },
    confirmStoryPlanNode: async n => { events.push(`approve:${n.node_id}`); n.status = 'approved'; return n; },
    decomposeStoryPlanNode: async (_p, n) => { events.push(`expand:${n.node_id}`); n.expansion_status = 'expanded';
      const children = childrenOf(n); nodes.push(...children); return children; },
  };
  const { runFullStoryTreeExpansion } = loadPipeline('story-tree-expansion', client);
  return { events, reviews, top, checkpoints, run: () => runFullStoryTreeExpansion({
    project: { id: 'project', generationSettings: { episodeCount: 160 } }, storyBible: bible,
    onlyTopLevelNodeId: invalid === 'unknown' ? 'missing-part' : selected.node_id, stopAfterLayer: true,
    onTreeCheckpoint: c => checkpoints.push(c),
  }) };
}

for (const failure of [false, true]) test(`single selected part keeps full-frontier review and touches no other part: failure=${failure}`, async () => {
  const f = scopedTreeFixture({ failure });
  if (failure) {
    await assert.rejects(f.run(), /先修订/);
    assert.deepEqual(f.events, ['review']);
  } else {
    const result = await f.run();
    assert.deepEqual(f.events, ['review', 'approve:part2', 'expand:part2']);
    assert.deepEqual(Array.from(result.topLevelNodes, n => n.node_id), f.top.map(n => n.node_id));
    assert.equal(f.top.filter(n => n.node_id !== 'part2').every(n => n.status === 'draft'), true);
    assert.equal(f.checkpoints.every(c => c.topLevelNodes.length === 5), true);
  }
  assert.deepEqual(Array.from(f.reviews[0]), f.top.map(n => n.node_id));
});

test('selected subtree next depth ignores other four unexpanded top-level parts', async () => {
  const f = scopedTreeFixture({ existingChildren: true });
  const result = await f.run();
  assert.deepEqual(f.events.filter(e => e.startsWith('expand:')), ['expand:part2.1', 'expand:part2.2']);
  assert.deepEqual(f.events.filter(e => e.startsWith('approve:')), ['approve:part2.1', 'approve:part2.2']);
  assert.equal(f.reviews.length, 2);
  assert.equal(f.reviews.every(ids => ['part1', 'part3', 'part4', 'part5', 'part2.1', 'part2.2'].every(id => ids.includes(id))), true);
  assert.equal(result.topLevelNodes.length, 5);
});

for (const invalid of ['unknown', 'missing root', 'missing top', 'gap']) test(`single-part scope refuses ${invalid} without regenerating or broadening scope`, async () => {
  const f = scopedTreeFixture({ invalid });
  await assert.rejects(f.run(), /无法仅继续|已不存在/);
  assert.deepEqual(f.events, []);
});
