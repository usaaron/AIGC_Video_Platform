from copy import deepcopy
from datetime import datetime, timezone
import json

import pytest
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.script_engine.long_story_models import (
    EpisodeDevelopment, EpisodePlanGenerationItem, PlanningApprovalStatus, StoryProjectWorkspaceSave,
)
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.produced_plan_amendment import body_hash, plan_hash
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_long_story_api import build_project, build_story_bible, build_story_plan_node, NOW
from tests.test_story_planning_service import build_active_lineage_episode_item
from tests.test_planning_revision import opened_payload, reviewed_completion


def save(service, workspace, revision):
    return service.save_workspace_snapshot(StoryProjectWorkspaceSave(
        project_id=workspace['id'], client_instance_id='client.amendment', revision=revision,
        workspace_payload=workspace,
    )).workspace_payload


@pytest.fixture
def source_workspace():
    runtime = create_database_runtime('sqlite://')
    SQLModel.metadata.create_all(runtime.engine)
    service = LongStoryService(runtime)
    project = build_project().model_copy(update={'planned_episode_count': 8})
    service.save_project(project)
    bible = build_story_bible().model_copy(update={'status': PlanningApprovalStatus.approved, 'approved_at': NOW})
    service.save_story_bible(bible)
    node = build_story_plan_node(node_id='node.amendment', planned_start_episode=1, planned_end_episode=8,
                                 expansion_status='episode_ready').model_copy(update={
        'status': PlanningApprovalStatus.approved, 'approved_at': NOW, 'character_refs': ['character.mara'],
        'unit_story_beats': ['找到确切的证据。','对手试图否认证据。','证人明确核实事实。','主角公开证据获胜。'], 'turning_points': ['主角找到可核对的凭证并公开质问对方。'],
        'unit_resolution':'本段事件已经形成确定结局。',
        'episode_developments': [EpisodeDevelopment(episode_number=n, synopsis=f'第{n}集角色核查眼前的凭证并承担明确后果。',
            entry_state=f'第{n}集进入时持有原始凭证。', exit_state=f'第{n}集退出时确认具体线索。',
            source_turning_points=[], source_unit_story_beats=[]) for n in range(1,9)],
    })
    service.save_story_plan_node(node)
    source = {'id':project.project_id, 'storyBibleVersion':1,
              'planningSession':{'phase':'script','status':'approved'}, 'episodes':[], 'episodeRoadmaps':[],
              'storyTreeQualityAudit':{'status':'needs_revision'}}
    for event in node.episode_developments:
        item = StoryPlanningService._ensure_episode_item_short_drama_fields(EpisodePlanGenerationItem.model_validate({
            **build_active_lineage_episode_item(event.episode_number), **event.model_dump(mode='json'),
        })).model_dump(mode='json')
        item['scene_execution_plan'][-1]['exit_state'] = item['exit_state']
        source['episodeRoadmaps'].append({**item, 'status':'approved', 'source_node_id':node.node_id,
            'source_node_version':1, 'story_bible_version':1})
    for n in range(1,4):
        draft = {'title':f'第{n}集', 'synopsis':'原稿已保存。', 'scenes':[{'scene_number':1,
            'character_actions':['主角核对眼前的凭证。'], 'dialogues':[{'character_name':'Mara','text':'Who changed this?'}],
            'body_order':['action:0','dialogue:0']}]}
        source['episodes'].append({'id':f'episode.{n}', 'episodeNumber':n, 'status':'confirmed',
            'workingDraftJson':json.dumps(draft,ensure_ascii=False), 'lockedAt':NOW.isoformat(),
            'generationRun':{'draft_master_script':deepcopy(draft), 'episode_context':{'approved_episode_plan':deepcopy(source['episodeRoadmaps'][n-1])}}})
    save(service,source,1)
    active=opened_payload(source,start=4)
    active=save(service,active,2)
    yield service,runtime,active,node
    runtime.engine.dispose()


def amended_candidate(active, *, selected=(1,2), source_revision=2):
    candidate=deepcopy(active)
    candidate['planningRevisionEpoch']=active['planningRevisionEpoch']+1
    candidate['producedPlanAmendmentRequest']={
        'amendmentId':'amendment.first','sourceWorkspaceRevision':source_revision,
        'sourcePlanningRevisionEpoch':active['planningRevisionEpoch'],'episodeNumbers':list(selected),
        'reason':'修正纯录音口述限制，保留本集已批准事件。',
    }
    for row in candidate['episodeRoadmaps']:
        if row['episode_number'] in selected:
            row['status']='draft'
            row['scene_execution_plan'][0]['dialogue_objective']='主角针对眼前凭证追问，对方拒绝交出原件并提出条件。'
    return candidate


def test_amendment_keeps_future_revision_and_authoritative_originals(source_workspace):
    service,_,active,_=source_workspace
    requested=amended_candidate(active)
    saved=save(service,requested,3)
    assert saved['planningRevision']==active['planningRevision']
    assert saved['planningRevisionHistory']==active['planningRevisionHistory']
    assert saved['planningSession']==active['planningSession']
    assert saved['planningRevisionEpoch']==2
    assert 'producedPlanAmendmentRequest' not in saved
    receipt=saved['producedPlanAmendments'][0]
    assert receipt['originalEpisodes']==active['episodes'][:2]
    assert receipt['originalRoadmaps']==active['episodeRoadmaps'][:2]
    assert receipt['episodeNumbers']==[1,2] and receipt['affectedEpisodeNumbers']==[1,2,3]
    assert [e['sourceAmendment']['status'] for e in saved['episodes']]==['revision_required','revision_required','review_required']
    assert all({k:v for k,v in e.items() if k!='sourceAmendment'}==active['episodes'][i] for i,e in enumerate(saved['episodes']))
    assert saved['episodeRoadmaps'][2:]==active['episodeRoadmaps'][2:]
    assert save(service,requested,3)==saved


@pytest.mark.parametrize('bad', ['entry','exit','lineage','events','other_plan','body','old_epoch','old_revision','sparse','no_body','unknown_cast','bad_budget','history'])
def test_amendment_rejects_out_of_scope_or_stale_mutation_atomically(source_workspace,bad):
    service,_,active,_=source_workspace
    candidate=amended_candidate(active)
    row=candidate['episodeRoadmaps'][0]
    if bad=='entry':row['entry_state']='一个未经批准的新进入状态。'
    elif bad=='exit':row['exit_state']='一个未经批准的新退出状态。'
    elif bad=='lineage':row['source_node_version']=99
    elif bad=='events':row['source_unit_story_beats']=['新事件。']
    elif bad=='other_plan':candidate['episodeRoadmaps'][2]['synopsis']='篡改未选中分集。'
    elif bad=='body':candidate['episodes'][0]['workingDraftJson']='覆盖旧稿'
    elif bad=='old_epoch':candidate['producedPlanAmendmentRequest']['sourcePlanningRevisionEpoch']=0
    elif bad=='old_revision':candidate['producedPlanAmendmentRequest']['sourceWorkspaceRevision']=1
    elif bad=='sparse':candidate['producedPlanAmendmentRequest']['episodeNumbers']=[1,3]
    elif bad=='no_body':candidate['producedPlanAmendmentRequest']['episodeNumbers']=[1,2,3,4]
    elif bad=='unknown_cast':row['character_refs'].append('character.unapproved')
    elif bad=='bad_budget':row['planned_dialogue_line_count']=24
    elif bad=='history':candidate['planningRevision']['originalRoadmaps']=[]
    with pytest.raises(LongStoryPersistenceConflictError):save(service,candidate,3)
    assert service.get_workspace_snapshot(active['id']).workspace_payload==active


@pytest.mark.parametrize('bad',['receipt','marker_removed','marker_pass','ordinary_body','ordinary_plan','overlap'])
def test_ordinary_save_cannot_erase_amendment_history_or_claim_resolution(source_workspace,bad):
    service,_,active,_=source_workspace
    saved=save(service,amended_candidate(active),3)
    candidate=deepcopy(saved)
    if bad=='receipt':candidate['producedPlanAmendments'][0]['originalEpisodes']=[]
    elif bad=='marker_removed':candidate['episodes'][0].pop('sourceAmendment')
    elif bad=='marker_pass':candidate['episodes'][0]['sourceAmendment']['status']='pass'
    elif bad=='ordinary_body':candidate['episodes'][0]['workingDraftJson']='new body without receipt'
    elif bad=='ordinary_plan':candidate['episodeRoadmaps'][0]['synopsis']='普通保存不能再改新源。'
    else:candidate=amended_candidate(saved,source_revision=3)
    with pytest.raises(LongStoryPersistenceConflictError):save(service,candidate,4)
    assert service.get_workspace_snapshot(active['id']).workspace_payload==saved


def test_only_approval_and_fresh_full_review_can_close_future_revision(source_workspace):
    service,_,active,_=source_workspace
    saved=save(service,amended_candidate(active),3)
    approved=deepcopy(saved)
    approved['episodeRoadmaps'][0]['status']='approved'
    save(service,approved,4)
    completed=save(service,reviewed_completion(approved,service),5)
    assert completed['planningRevision']['status']=='completed'
    assert completed['episodes'][0]['sourceAmendment']['status']=='revision_required'
    assert completed['producedPlanAmendments']==saved['producedPlanAmendments']


def resolution_candidate(workspace, number, *, revised=True):
    from app.modules.script_engine.produced_plan_amendment import draft_hash
    candidate=deepcopy(workspace)
    old=workspace['episodes'][number-1]
    episode=candidate['episodes'][number-1]
    draft=json.loads(episode['workingDraftJson'])
    if revised:
        draft['scenes'][0]['dialogues'][0]['text']='Show me the original.'
    episode['workingDraftJson']=json.dumps(draft,ensure_ascii=False)
    episode['generationRun']['draft_master_script']=deepcopy(draft)
    plan=candidate['episodeRoadmaps'][number-1]
    from app.modules.script_engine.models import ApprovedEpisodePlanContext
    episode['generationRun']['episode_context']['approved_episode_plan']={
        key:deepcopy(value) for key,value in plan.items() if key in ApprovedEpisodePlanContext.model_fields
    }
    episode['generationRun']['episode_context']['approved_story_node']={'node_id':plan['source_node_id'],'node_version':plan['source_node_version']}
    candidate['producedPlanAmendmentResolutionRequest']={
        'amendmentId':old['sourceAmendment']['amendmentId'], 'episodeNumber':number,
        'resolution':'revised' if revised else 'reviewed', 'sourcePlanHash':old['sourceAmendment']['sourcePlanHash'],
        'sourceBodyHash':body_hash(old),'acceptedBodyHash':draft_hash(draft),
        'predecessorBodyHash':body_hash(workspace['episodes'][number-2]) if number>1 else None,
        'summary':'逐字核对行动和对白，保留上层事件以及前后衔接。',
        'evidence':[{'sceneNumber':1,'bodyOrderRef':'dialogue:0','quote':draft['scenes'][0]['dialogues'][0]['text']}],
    }
    return candidate


def closed_amendment(service, active):
    amended=save(service,amended_candidate(active),3)
    return save(service,reviewed_completion(amended,service),4)


def test_sequential_resolution_preserves_originals_and_requires_exact_evidence(source_workspace):
    service,_,active,_=source_workspace
    current=closed_amendment(service,active)
    first_request=resolution_candidate(current,1)
    first=save(service,first_request,5)
    assert 'sourceAmendment' not in first['episodes'][0]
    assert first['episodes'][1]['sourceAmendment']['status']=='revision_required'
    assert first['producedPlanAmendmentResolutions'][0]['previousEpisodeSnapshot']==current['episodes'][0]
    assert save(service,first_request,5)==first
    second=save(service,resolution_candidate(first,2),6)
    third_request=resolution_candidate(second,3,revised=False)
    third=save(service,third_request,7)
    assert not any(e.get('sourceAmendment') for e in third['episodes'])
    assert third['episodes'][2]['workingDraftJson']==second['episodes'][2]['workingDraftJson']
    assert len(third['producedPlanAmendmentResolutions'])==3
    assert third['producedPlanAmendments'][0]['originalEpisodes']==active['episodes'][:2]


@pytest.mark.parametrize('bad',['quote','plan','body','predecessor','skip','mislabeled_unchanged'])
def test_resolution_rejects_stale_or_unfounded_adoption(source_workspace,bad):
    service,_,active,_=source_workspace
    current=closed_amendment(service,active)
    candidate=resolution_candidate(current,2 if bad=='skip' else 1, revised=bad!='mislabeled_unchanged')
    request=candidate['producedPlanAmendmentResolutionRequest']
    if bad=='quote':request['evidence'][0]['quote']='Absent quote'
    elif bad=='plan':request['sourcePlanHash']='old'
    elif bad=='body':request['acceptedBodyHash']='old'
    elif bad=='predecessor':request['predecessorBodyHash']='wrong'
    elif bad=='mislabeled_unchanged':request['resolution']='revised'
    with pytest.raises(LongStoryPersistenceConflictError):save(service,candidate,5)
    assert service.get_workspace_snapshot(current['id']).workspace_payload==current


def test_required_source_can_be_explicitly_reviewed_when_body_already_conforms(source_workspace):
    service,_,active,_=source_workspace
    current=closed_amendment(service,active)
    assert current['episodes'][0]['sourceAmendment']['status']=='revision_required'
    request=resolution_candidate(current,1,revised=False)
    before=deepcopy(current)
    saved=save(service,request,5)
    old,new=current['episodes'][0],saved['episodes'][0]
    assert body_hash(old)==body_hash(new)
    assert new['workingDraftJson']==old['workingDraftJson']
    assert new['lockedAt']==old['lockedAt']
    assert 'sourceAmendment' not in new
    assert saved['episodes'][1:]==current['episodes'][1:]
    receipt=saved['producedPlanAmendmentResolutions'][-1]
    assert receipt['resolution']=='reviewed'
    assert receipt['sourceBodyHash']==receipt['acceptedBodyHash']
    assert receipt['previousEpisodeSnapshot']==old
    assert saved['producedPlanAmendments']==current['producedPlanAmendments']
    assert current==before
    assert save(service,request,5)==saved


@pytest.mark.parametrize('bad', ['source_context','run_body','changed_body','empty_evidence','summary','epoch','active'])
def test_already_conforming_body_review_retains_source_and_evidence_gates(source_workspace,bad):
    service,_,active,_=source_workspace
    current=closed_amendment(service,active)
    candidate=resolution_candidate(current,1,revised=bad=='changed_body')
    request=candidate['producedPlanAmendmentResolutionRequest']
    request['resolution']='reviewed'
    if bad=='source_context':
        candidate['episodes'][0]['generationRun']['episode_context']['approved_episode_plan']=active['episodeRoadmaps'][0]
    elif bad=='run_body':candidate['episodes'][0]['generationRun']['draft_master_script']['synopsis']='未同步的新正文。'
    elif bad=='empty_evidence':request['evidence']=[]
    elif bad=='summary':request['summary']='通过'
    elif bad=='epoch':candidate['planningRevisionEpoch']+=1
    elif bad=='active':
        current['planningRevision']['status']='active'
        # Pure transition check avoids manufacturing a product planning state.
        from app.modules.script_engine.produced_plan_amendment import prepare_workspace_transition
        with pytest.raises(LongStoryPersistenceConflictError):
            prepare_workspace_transition(current,candidate,source_revision=4,has_running_work=False,validate_plan_source=lambda *_:None)
        return
    with pytest.raises(LongStoryPersistenceConflictError):save(service,candidate,5)
    assert service.get_workspace_snapshot(current['id']).workspace_payload==current


def test_body_operation_rejects_old_plan_before_any_model_or_current_memory(source_workspace):
    from app.modules.script_engine.produced_plan_amendment import require_amendment_body_operation
    service,_,active,_=source_workspace
    current=closed_amendment(service,active)
    context=resolution_candidate(current,1)['episodes'][0]['generationRun']['episode_context']
    require_amendment_body_operation(current,1,2,context)
    for number,epoch,ctx in [(2,2,context),(1,1,context),(1,2,{'approved_episode_plan':active['episodeRoadmaps'][0]})]:
        with pytest.raises(LongStoryPersistenceConflictError):require_amendment_body_operation(current,number,epoch,ctx)


@pytest.mark.parametrize('bad', ['body', 'plan', 'deleted'])
def test_resolved_source_cannot_change_without_new_explicit_amendment(source_workspace,bad):
    service,_,active,_=source_workspace
    current=closed_amendment(service,active)
    resolved=save(service,resolution_candidate(current,1),5)
    candidate=deepcopy(resolved)
    if bad=='body':
        draft=json.loads(candidate['episodes'][0]['workingDraftJson'])
        draft['scenes'][0]['dialogues'][0]['text']='Different new fact.'
        candidate['episodes'][0]['workingDraftJson']=json.dumps(draft)
    elif bad=='plan':candidate['episodeRoadmaps'][0]['synopsis']='未重新复核的另一个版本。'
    else:candidate['episodes']=candidate['episodes'][1:]
    with pytest.raises(LongStoryPersistenceConflictError):save(service,candidate,6)
    assert service.get_workspace_snapshot(current['id']).workspace_payload==resolved


def test_body_hash_follows_visible_confirmed_and_final_draft():
    from app.modules.script_engine.produced_plan_amendment import draft_hash
    original={'title':'原稿','scenes':[]};other={'title':'候选','scenes':[]}
    episode={'lockedAt':'2026-09-17','workingDraftJson':json.dumps(other),'confirmedDraftJson':json.dumps(original)}
    assert body_hash(episode)==draft_hash(original)
    episode['finalizationResult']={'master_script':other}
    assert body_hash(episode)==draft_hash(other)


@pytest.mark.parametrize('derived', ['omitted', 'false'])
def test_amendment_derives_readiness_from_blueprint_instead_of_client_flag(source_workspace, derived):
    service,_,active,_=source_workspace
    candidate=amended_candidate(active)
    for row in candidate['episodeRoadmaps'][:2]:
        row.pop('layer_contracts',None)
        if derived=='omitted':row.pop('execution_ready',None)
        else:row['execution_ready']=False
    saved=save(service,candidate,3)
    assert all(row['execution_ready'] for row in saved['episodeRoadmaps'][:2])
    assert all(row['layer_contracts'] for row in saved['episodeRoadmaps'][:2])
