import assert from 'node:assert/strict';
import test from 'node:test';
import { requireStoryPlanQuality, storyQualityRejectionForEpisode } from '../lib/story-quality-gate.ts';
import { auditStoryPlanQuality, canFinishUnreviewedRoadmapLeaf, storyPlanQualityAuditMatchesNodes, storyPlanQualityEpisodes } from '../lib/story-planning-client.ts';

const nodes = [{node_id:'node.1',version:2,story_bible_id:'bible.1',story_bible_version:3}];
const reviewProject = {id:'project.test',storyBibleVersion:3,storySynopsis:{version:2,status:'confirmed',text:'先取回原件，再当面核验。'}};
const sourceEvidence = {reviewed_source_fingerprint:'a'.repeat(64),
  reviewed_source_signature:JSON.stringify([reviewProject.id,'bible.1',3,[2,'confirmed',reviewProject.storySynopsis.text]])};
const passed = {
  ...sourceEvidence,
  review_contract_version:13, reviewed_episode_plans:'[]', story_bible_id:'bible.1',story_bible_version:3,
  status:'pass',findings:[],node_refs:[{node_id:'node.1',node_version:2}],
};

test('only an appended incomplete leaf may finish before its mandatory content review', () => {
  const leaves = [0, 1, 2].map(index => ({...nodes[0],node_id:`leaf.${index}`,status:'approved',
    expansion_status:'episode_ready',planned_start_episode:index*8+1,planned_end_episode:(index+1)*8}));
  const items = Array.from({length:16},(_,index)=>({
    episode_number:index+1,source_node_id:leaves[Math.floor(index/8)].node_id,
    source_node_version:2,story_bible_version:3,synopsis:`第${index+1}集实际行动。`,
    scene_execution_plan:[{scene_number:1,visible_action:'保管人当面出示原件。',evidence_requirements:['原件'],exit_state:'原件未转手。'}],
  }));
  const prefix=items.slice(0,8), partial=items.slice(0,14);
  const audit={...passed,node_refs:leaves.map(n=>({node_id:n.node_id,node_version:n.version})),
    reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(leaves,prefix))};
  assert.equal(canFinishUnreviewedRoadmapLeaf(audit,leaves,partial, { project: reviewProject }),true);
  assert.equal(canFinishUnreviewedRoadmapLeaf({...audit,
    reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(leaves,items.slice(0,12)))},leaves,partial, { project: reviewProject }),true);
  assert.equal(storyPlanQualityAuditMatchesNodes(audit,leaves,partial, { project: reviewProject }),false);
  for (const [label,checkAudit,checkNodes,checkPlans] of [
    ['already complete',audit,leaves,items],
    ['missing checkpoint',audit,leaves,partial.filter(p=>p.episode_number!==11)],
    ['changed reviewed scene',audit,leaves,partial.map(p=>p.episode_number===1?{...p,scene_execution_plan:[{...p.scene_execution_plan[0],visible_action:'保管人交出原件。'}]}:p)],
    ['changed node',audit,leaves.map((n,i)=>i===2?{...n,version:3}:n),partial],
    ['changed bible',{...audit,story_bible_version:2},leaves,partial],
    ['legacy pass',{...audit,review_contract_version:6},leaves,partial],
    ['prior short-drama policy',{...audit,review_contract_version:8},leaves,partial],
    ['failed audit',{...audit,status:'needs_revision'},leaves,partial],
    ['retained finding',{...audit,findings:[{summary:'未完成交接'}]},leaves,partial],
    ['corrupt checkpoint',{...audit,reviewed_episode_plans:'invalid'},leaves,partial],
    ['unapproved leaf',audit,leaves.map((n,i)=>i===1?{...n,status:'draft'}:n),partial],
  ]) assert.equal(canFinishUnreviewedRoadmapLeaf(checkAudit,checkNodes,checkPlans, { project: reviewProject }),false,label);
});

test('downstream work waits for a completed review and its durable checkpoint', async () => {
  const events=[];
  let complete;
  const review=new Promise(resolve=>{complete=resolve;});
  const generation=requireStoryPlanQuality({runAudit:()=>review,onCheckpoint:async()=>{events.push('saved');}})
    .then(()=>events.push('generate'));
  await Promise.resolve();
  assert.deepEqual(events,[]);
  complete(passed);
  await generation;
  assert.deepEqual(events,['saved','generate']);
});

test('actionable review findings persist and stop downstream generation', async () => {
  const audit={...passed,status:'needs_revision',findings:[{
    node_id:'node.1',node_version:2,start_episode:1,end_episode:10,title:'海港调查',
    summary:'重复核验同一航海日志，没有产生新的后果。',repair_instruction:'调整本段行动与代价。',
  }]};
  let stored;
  let generated=false;
  await assert.rejects(requireStoryPlanQuality({runAudit:async()=>audit,onCheckpoint:value=>{stored=value;}})
    .then(()=>{generated=true;}),/海港调查/);
  assert.equal(stored,audit);
  assert.equal(generated,false);
  await assert.rejects(requireStoryPlanQuality({cachedAudit:audit,runAudit:()=>assert.fail('cached findings must remain actionable')}),/先修订/);
});

test('review failures and failed saves cannot silently become success', async () => {
  await assert.rejects(requireStoryPlanQuality({runAudit:async()=>{throw new Error('review timeout');}}),/review timeout/);
  await assert.rejects(requireStoryPlanQuality({runAudit:async()=>passed,onCheckpoint:async()=>{throw new Error('save failed');}}),/save failed/);
});

test('a current passing review is reused while old policies or lineages require another review', async () => {
  assert.equal(await requireStoryPlanQuality({cachedAudit:passed,runAudit:()=>assert.fail('no duplicate model call')}),passed);
  assert.equal(storyPlanQualityAuditMatchesNodes(passed,nodes, [], { project: reviewProject }),true);
  assert.equal(storyPlanQualityAuditMatchesNodes({...passed,review_contract_version:undefined},nodes, [], { project: reviewProject }),false);
  assert.equal(storyPlanQualityAuditMatchesNodes({...passed,story_bible_version:2},nodes, [], { project: reviewProject }),false);
  assert.equal(storyPlanQualityAuditMatchesNodes(passed,[{...nodes[0],version:3}], [], { project: reviewProject }),false);
});

test('a tree-only pass cannot approve generated or revised episode content', () => {
  const roadmap={
    source_node_id:'node.1',source_node_version:2,story_bible_version:3,episode_number:1,
    synopsis:'审计仍未启动。',protagonist_decision:'等待回执。',episode_payoff:'取得回执。',exit_state:'审计仍被推迟。',
  };
  assert.equal(storyPlanQualityAuditMatchesNodes(passed,nodes,[roadmap], { project: reviewProject }),false);
  const reviewed={...passed,reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(nodes,[roadmap]))};
  assert.equal(storyPlanQualityAuditMatchesNodes(reviewed,nodes,[roadmap], { project: reviewProject }),true);
  assert.equal(storyPlanQualityAuditMatchesNodes(reviewed,nodes,[{...roadmap,exit_state:'公开审计启动。'}], { project: reviewProject }),false);
  assert.equal(storyPlanQualityAuditMatchesNodes(reviewed,nodes,[{...roadmap,approval_status:'approved'}], { project: reviewProject }),true);
  assert.deepEqual(storyPlanQualityEpisodes(nodes,[{...roadmap,source_node_version:1}]),[]);
  const failure={...reviewed,status:'needs_revision',findings:[{node_id:'node.1',node_version:2,title:'末段',summary:'只提交申请，没有启动审计。'}]};
  const project={episodeRoadmaps:[roadmap],storyTreeQualityAudit:failure};
  assert.match(storyQualityRejectionForEpisode(project,nodes,1),/只提交申请/);
  assert.equal(storyQualityRejectionForEpisode(project,nodes,2),null);
  assert.equal(storyQualityRejectionForEpisode({...project,storyTreeQualityAudit:reviewed},nodes,1),null);
  assert.equal(storyQualityRejectionForEpisode({...project,episodeRoadmaps:[{...roadmap,exit_state:'公开审计启动。'}]},nodes,1),null);
});


test('granularity review invalidates old cached verdicts without bypassing production failures', () => {
  for (const version of [3, 4, 5, 6, 7, 8, 9]) {
    assert.equal(storyPlanQualityAuditMatchesNodes({...passed, review_contract_version:version}, nodes, [], { project: reviewProject }), false);
    const roadmap={source_node_id:'node.1',source_node_version:2,story_bible_version:3,episode_number:1};
    const failed={...passed,review_contract_version:version,status:'needs_revision',
      reviewed_episode_plans:JSON.stringify(legacyReviewEpisodes([roadmap],version)),
      findings:[{node_id:'node.1',node_version:2,title:'调查',summary:'未完成实际取证。'}]};
    assert.equal(storyPlanQualityAuditMatchesNodes(failed, nodes, [roadmap], { project: reviewProject }), false);
    assert.match(storyQualityRejectionForEpisode({episodeRoadmaps:[roadmap],storyTreeQualityAudit:failed},nodes,1),/未完成实际取证/);
  }
});

test('review carries actual scene evidence and a scene-only change invalidates its verdict', () => {
  const scene={scene_number:1,visible_action:'管理员只答应接收，原件仍在主角手中。',
    evidence_requirements:['未签收的预约单。'],exit_state:'材料已经保全。',shot_target:8};
  const roadmap={source_node_id:'node.1',source_node_version:2,story_bible_version:3,episode_number:1,
    synopsis:'材料保全完成。',exit_state:'材料已经保全。',scene_execution_plan:[scene]};
  const rows=storyPlanQualityEpisodes(nodes,[roadmap]);
  assert.deepEqual(rows[0].scene_execution_plan,[{
    scene_number:1,visible_action:scene.visible_action,evidence_requirements:scene.evidence_requirements,exit_state:scene.exit_state,
    character_refs:[],dialogue_objective:null,dialogue_line_target:null,forbidden_changes:[],
  }]);
  const reviewed={...passed,reviewed_episode_plans:JSON.stringify(rows)};
  assert.equal(storyPlanQualityAuditMatchesNodes(reviewed,nodes,[roadmap], { project: reviewProject }),true);
  assert.equal(storyPlanQualityAuditMatchesNodes(reviewed,nodes,[{...roadmap,
    scene_execution_plan:[{...scene,visible_action:'管理员接过原件，当场签收并入柜。'}],
  }], { project: reviewProject }),false);
});

test('reviews without parent duties are refreshed, while their actual-scene failures still block production', () => {
  const roadmap={source_node_id:'node.1',source_node_version:2,story_bible_version:3,episode_number:1,
    synopsis:'只取得预约许可。',scene_execution_plan:[{scene_number:1,visible_action:'签下预约单。',evidence_requirements:['预约单'],exit_state:'仅获准办理。'}]};
  const audit={...passed,review_contract_version:6,reviewed_episode_plans:JSON.stringify(legacyReviewEpisodes([roadmap],6))};
  assert.equal(storyPlanQualityAuditMatchesNodes(audit,nodes,[roadmap], { project: reviewProject }),false);
  const failed={...audit,status:'needs_revision',findings:[{node_id:'node.1',node_version:2,title:'履行',summary:'父级要求的实际交接尚未发生。'}]};
  assert.match(storyQualityRejectionForEpisode({episodeRoadmaps:[roadmap],storyTreeQualityAudit:failed},nodes,1),/实际交接尚未发生/);
});

function legacyReviewEpisodes(roadmaps, version) {
  const rows = storyPlanQualityEpisodes(nodes, roadmaps).map(({continuity_requirements,dramatic_units,scene_execution_plan,...episode})=>({
    ...episode,scene_execution_plan:scene_execution_plan.map(({forbidden_changes,...scene})=>scene),
  }));
  if (version >= 8) return rows;
  return rows.map(({planned_dialogue_line_count,scene_execution_plan,...episode})=>
    [6,7].includes(version)?{...episode,scene_execution_plan:scene_execution_plan.map(
      ({character_refs,dialogue_objective,dialogue_line_target,...scene})=>scene)}:episode);
}

test('v8 failures retain complete speech evidence while its passes require the new review', () => {
  const roadmap={source_node_id:'node.1',source_node_version:2,story_bible_version:3,episode_number:1,
    planned_dialogue_line_count:25,scene_execution_plan:[{scene_number:1,
      visible_action:'独自整理材料。',exit_state:'记录完成。',character_refs:['character.lead'],
      dialogue_objective:'25句均为逐条操作录音报账。',dialogue_line_target:25}]};
  const legacy={...passed,review_contract_version:8,
    reviewed_episode_plans:JSON.stringify(legacyReviewEpisodes([roadmap],8))};
  assert.equal(storyPlanQualityAuditMatchesNodes(legacy,nodes,[roadmap],{project: reviewProject, allowLegacyFailure:true}),false);
  const failed={...legacy,status:'needs_revision',findings:[{node_id:'node.1',node_version:2,
    title:'材料核验',summary:'25句工作录音缺乏当前戏剧作用。'}]};
  const stored=JSON.parse(JSON.stringify({episodeRoadmaps:[roadmap],storyTreeQualityAudit:failed}));
  assert.match(storyQualityRejectionForEpisode(stored,nodes,1),/工作录音/);
  assert.equal(storyPlanQualityAuditMatchesNodes(failed,nodes,[roadmap], { project: reviewProject }),false);
  for (const update of [
    {planned_dialogue_line_count:30},
    {scene_execution_plan:[{...roadmap.scene_execution_plan[0],dialogue_objective:'围绕拒收理由争执并迫使对方签字。'}]},
    {scene_execution_plan:[{...roadmap.scene_execution_plan[0],dialogue_line_target:30}]},
    {scene_execution_plan:[{...roadmap.scene_execution_plan[0],character_refs:['character.lead','character.clerk']}]},
  ]) assert.equal(storyQualityRejectionForEpisode({...stored,episodeRoadmaps:[{...roadmap,...update}]},nodes,1),null);
  assert.deepEqual(stored.storyTreeQualityAudit,failed);
});

test('actual review requests use a fresh stable v13 cache key and persist the complete evidence', async t => {
  const roadmap={source_node_id:'node.1',source_node_version:2,story_bible_version:3,episode_number:1,
    planned_dialogue_line_count:25,scene_execution_plan:[{scene_number:1,visible_action:'当面退回申请。',
      exit_state:'申请被拒绝。',character_refs:['character.lead','character.clerk'],
      dialogue_objective:'追问拒绝理由，迫使对方作出书面决定。',dialogue_line_target:25}]};
  const project={...reviewProject,generationStrategyId:'strategy.test',episodeRoadmaps:[roadmap]};
  const requests=[];
  t.mock.method(globalThis,'fetch',async (_url,request)=>{
    requests.push(JSON.parse(request.body));
    return Response.json({data:{...passed,review_contract_version:8}});
  });
  const first=await auditStoryPlanQuality(project,{story_bible_id:'bible.1',version:3},nodes);
  const replay=await auditStoryPlanQuality(project,{story_bible_id:'bible.1',version:3},nodes);
  assert.match(requests[0].agent_request_id,/^agent-request\.story-quality-v13\./);
  assert.equal(requests[0].agent_request_id,requests[1].agent_request_id);
  assert.deepEqual(requests[0].episode_plans,storyPlanQualityEpisodes(nodes,[roadmap]));
  assert.equal(first.review_contract_version,13);
  const loaded=JSON.parse(JSON.stringify(first));
  assert.equal(storyPlanQualityAuditMatchesNodes(loaded,nodes,[roadmap], { project: reviewProject }),true);
  assert.deepEqual(replay,first);
});

test('speech objectives and budgets reach the review and invalidate only changed evidence', () => {
  const scene={scene_number:1,visible_action:'调查者独自登记屏幕内容。',evidence_requirements:['屏幕记录'],
    exit_state:'完成归档。',character_refs:['character.investigator'],
    dialogue_objective:'全场25行均为录音报账，逐条复述登记事项。',dialogue_line_target:25};
  const roadmap={source_node_id:'node.1',source_node_version:2,story_bible_version:3,episode_number:1,
    planned_dialogue_line_count:25,synopsis:'独自核验记录。',scene_execution_plan:[scene]};
  const rows=storyPlanQualityEpisodes(nodes,[roadmap]);
  assert.equal(rows[0].planned_dialogue_line_count,25);
  assert.equal(rows[0].scene_execution_plan[0].dialogue_objective,scene.dialogue_objective);
  assert.equal(rows[0].scene_execution_plan[0].dialogue_line_target,25);
  assert.deepEqual(rows[0].scene_execution_plan[0].character_refs,scene.character_refs);
  const reviewed={...passed,reviewed_episode_plans:JSON.stringify(rows)};
  assert.equal(storyPlanQualityAuditMatchesNodes(reviewed,nodes,[roadmap], { project: reviewProject }),true);
  for(const update of [
    {planned_dialogue_line_count:30},
    {scene_execution_plan:[{...scene,dialogue_objective:'双方交涉，迫使对方说明拒收原因。'}]},
    {scene_execution_plan:[{...scene,dialogue_line_target:30}]},
    {scene_execution_plan:[{...scene,character_refs:[...scene.character_refs,'character.clerk']}]},
  ]) assert.equal(storyPlanQualityAuditMatchesNodes(reviewed,nodes,[{...roadmap,...update}], { project: reviewProject }),false);

  const old={...passed,review_contract_version:7,reviewed_episode_plans:JSON.stringify(legacyReviewEpisodes([roadmap],7))};
  assert.equal(storyPlanQualityAuditMatchesNodes(old,nodes,[roadmap], { project: reviewProject }),false);
  const failed={...old,status:'needs_revision',findings:[{node_id:'node.1',node_version:2,title:'记录核验',summary:'缺少实际核验依据。'}]};
  assert.match(storyQualityRejectionForEpisode({episodeRoadmaps:[roadmap],storyTreeQualityAudit:failed},nodes,1),/缺少实际核验依据/);
});

test('cross-layer constraints reach requests, survive reload and invalidate changed verdicts', async t => {
  const scene={scene_number:1,visible_action:'两人在场听完裁定。',exit_state:'裁定已经公开。',
    character_refs:['character.lead','character.rival'],dialogue_objective:'当面对裁定提出异议。',dialogue_line_target:30,
    forbidden_changes:['不得让现场人物遗忘公开听到的结果。']};
  const unit={trigger:'裁定宣布。',choice:'当场提出异议。',visible_consequence:'异议被记录。',change_type:'character_choice',evidence_hint:'双方都有明确回应。'};
  const roadmap={source_node_id:'node.1',source_node_version:2,story_bible_version:3,episode_number:1,
    planned_dialogue_line_count:30,continuity_requirements:['旧审查已终止，独立专项复核仍持续。'],
    dramatic_units:[unit],scene_execution_plan:[scene]};
  const project={...reviewProject,generationStrategyId:'strategy.test',episodeRoadmaps:[roadmap]};
  const before=structuredClone(project),requests=[];
  t.mock.method(globalThis,'fetch',async (_url,request)=>{
    requests.push(JSON.parse(request.body));return Response.json({data:passed});
  });
  const audit=await auditStoryPlanQuality(project,{story_bible_id:'bible.1',version:3},nodes);
  const sent=requests[0].episode_plans[0];
  assert.deepEqual(sent.continuity_requirements,roadmap.continuity_requirements);
  assert.deepEqual(sent.dramatic_units,[unit]);
  assert.deepEqual(sent.scene_execution_plan[0].forbidden_changes,scene.forbidden_changes);
  const loaded=JSON.parse(JSON.stringify(audit));
  assert.equal(storyPlanQualityAuditMatchesNodes(loaded,nodes,[roadmap], { project: reviewProject }),true);
  assert.equal(storyPlanQualityAuditMatchesNodes(loaded,nodes,[{...roadmap,status:'approved'}], { project: reviewProject }),true);
  for(const update of [
    {continuity_requirements:['旧审查仍持续。']},
    {dramatic_units:[{...unit,evidence_hint:'两人全程没有开口。'}]},
    {scene_execution_plan:[{...scene,forbidden_changes:['不得开口回应。']}]},
  ]) {
    assert.equal(storyPlanQualityAuditMatchesNodes(loaded,nodes,[{...roadmap,...update}], { project: reviewProject }),false);
    await auditStoryPlanQuality({...project,episodeRoadmaps:[{...roadmap,...update}]},{story_bible_id:'bible.1',version:3},nodes);
    assert.notEqual(requests.at(-1).agent_request_id,requests[0].agent_request_id);
  }
  const legacy={...loaded,review_contract_version:9,reviewed_episode_plans:JSON.stringify(legacyReviewEpisodes([roadmap],9))};
  assert.equal(storyPlanQualityAuditMatchesNodes(legacy,nodes,[roadmap], { project: reviewProject }),false);
  const failed={...legacy,status:'needs_revision',findings:[{node_id:'node.1',node_version:2,title:'质证',summary:'已有执行冲突。'}]};
  assert.match(storyQualityRejectionForEpisode({...project,storyTreeQualityAudit:failed},nodes,1),/已有执行冲突/);
  assert.deepEqual(project,before);
});

test('a v10 PASS requires the issue-preserving review while its failures remain blocking',()=>{
 const roadmap={source_node_id:'node.1',source_node_version:2,story_bible_version:3,episode_number:1,
  continuity_requirements:['本集仍受限制。'],dramatic_units:[],scene_execution_plan:[]};
 const old={...passed,review_contract_version:10,reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(nodes,[roadmap]))};
 assert.equal(storyPlanQualityAuditMatchesNodes(old,nodes,[roadmap], { project: reviewProject }),false);
 const failed={...old,status:'needs_revision',findings:[{node_id:'node.1',node_version:2,title:'限制',summary:'既有矛盾未解决。'}]};
 assert.match(storyQualityRejectionForEpisode({episodeRoadmaps:[roadmap],storyTreeQualityAudit:failed},nodes,1),/既有矛盾/);
});

for (const version of [11, 12]) test(`v${version} passes expire while unchanged failures remain blocking after reload`, () => {
  const roadmap = {source_node_id:'node.1',source_node_version:2,story_bible_version:3,episode_number:1,
    synopsis:'本段尚未完成城防建设。',continuity_requirements:['城门仍待修复。'],
    dramatic_units:[{trigger:'城门倒塌。',choice:'组织修复。',visible_consequence:'修复尚未完成。',change_type:'character_choice'}],
    scene_execution_plan:[{scene_number:1,visible_action:'工人围住损坏的城门。',exit_state:'城门仍待修复。',
      forbidden_changes:['不得提前完成修复。']}]};
  const previous = {...passed,review_contract_version:version,
    reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(nodes,[roadmap]))};
  assert.equal(storyPlanQualityAuditMatchesNodes(previous,nodes,[roadmap], { project: reviewProject }),false);
  assert.equal(storyPlanQualityAuditMatchesNodes(previous,nodes,[roadmap],{project: reviewProject, allowLegacyFailure:true}),false);
  const failed = {...previous,status:'needs_revision',findings:[{node_id:'node.1',node_version:2,
    title:'城防建设',summary:'场次已经写成修复完成，与本集结局冲突。'}]};
  const loaded = JSON.parse(JSON.stringify({episodeRoadmaps:[roadmap],storyTreeQualityAudit:failed}));
  const before = structuredClone(loaded);
  assert.equal(storyPlanQualityAuditMatchesNodes(loaded.storyTreeQualityAudit,nodes,loaded.episodeRoadmaps, { project: reviewProject }),false);
  assert.equal(storyPlanQualityAuditMatchesNodes(loaded.storyTreeQualityAudit,nodes,loaded.episodeRoadmaps,{project: reviewProject, allowLegacyFailure:true}),true);
  assert.match(storyQualityRejectionForEpisode(loaded,nodes,1),/修复完成/);
  for (const update of [
    {synopsis:'组织人手恢复城防，尚未完成修复。'},
    {continuity_requirements:['修复工作已经开始。']},
    {dramatic_units:[{...roadmap.dramatic_units[0],visible_consequence:'工人已经开始修复。'}]},
    {scene_execution_plan:[{...roadmap.scene_execution_plan[0],visible_action:'工人开始修复损坏的城门。'}]},
    {scene_execution_plan:[{...roadmap.scene_execution_plan[0],forbidden_changes:['不得将组织修复写成修复完成。']}]},
  ]) assert.equal(storyQualityRejectionForEpisode({...loaded,episodeRoadmaps:[{...roadmap,...update}]},nodes,1),null);
  assert.equal(storyQualityRejectionForEpisode(loaded,[{...nodes[0],version:3}],1),null);
  assert.deepEqual(loaded,before);
});

test('a persisted v12 tree failure remains visible until the reviewed node version changes', () => {
  const failed = {...passed,review_contract_version:12,status:'needs_revision',findings:[{
    node_id:'node.1',node_version:2,title:'皇城救援',summary:'救援早于离城被偷袭，事件顺序与总纲冲突。',
    repair_instruction:'先保留离城被偷袭重伤，再承接带伤救援。',
  }]};
  const loaded = JSON.parse(JSON.stringify(failed));
  assert.equal(storyPlanQualityAuditMatchesNodes(loaded,nodes,[],{project: reviewProject, allowLegacyFailure:true}),true);
  assert.equal(storyPlanQualityAuditMatchesNodes(loaded,nodes, [], { project: reviewProject }),false);
  assert.equal(storyPlanQualityAuditMatchesNodes(loaded,[{...nodes[0],version:3}],[],{project: reviewProject, allowLegacyFailure:true}),false);
  assert.deepEqual(loaded,failed);
});


test('completed future review releases only its suffix of a shared leaf and preserves the historical gate', () => {
  const rows = [1, 2].map(episode_number => ({episode_number,source_node_id:'node.1',source_node_version:2,story_bible_version:3}));
  const audit = {...passed,status:'needs_revision',reviewed_episode_plans:JSON.stringify(storyPlanQualityEpisodes(nodes,rows)),
    findings:[{node_id:'node.1',node_version:2,start_episode:1,end_episode:1,title:'历史段落',summary:'第1集仍有历史重复。'}],
    future_revision_review:{revision_id:'revision.test',planning_revision_epoch:1,start_episode:2,end_episode:2,status:'pass',boundary_status:'pass'}};
  const project={episodeRoadmaps:rows,storyTreeQualityAudit:audit,planningRevisionEpoch:1,
    planningRevision:{revisionId:'revision.test',startEpisode:2,status:'completed'}};
  assert.match(storyQualityRejectionForEpisode(project,nodes,1),/历史重复/);
  assert.equal(storyQualityRejectionForEpisode(project,nodes,2),null);
  assert.match(storyQualityRejectionForEpisode({...project, storyTreeQualityAudit:{...audit, findings:[{...audit.findings[0],end_episode:2}]}},nodes,2),/历史重复/);
  assert.match(storyQualityRejectionForEpisode({...project,planningRevisionEpoch:2},nodes,2),/历史重复/);
  assert.match(storyQualityRejectionForEpisode({...project,planningRevision:{...project.planningRevision,status:'active'}},nodes,2),/历史重复/);
});
