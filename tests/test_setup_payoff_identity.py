from copy import deepcopy
from app.modules.script_engine.setup_payoff_identity import restore_legacy_setup_payoff_sources
from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.models import EpisodeGenerationContext
from app.modules.script_engine.continuity_qc import _setup_payoff_issues
from tests.test_setup_payoff_provenance import payoff_draft

REFERENCE='莉娜与诺亚各自修改的尾段在首次完整合奏中暴露为具体技术问题'
IDENTITY='generated.setup_payoff.c78e452ccbff'

def legacy_draft():
    draft=payoff_draft([IDENTITY])
    draft.setup_payoff_updates[0].action='reinforce'
    draft.setup_payoff_updates[0].status='active'
    return draft

def test_current_review_recovers_provable_legacy_identity_without_changing_scene_or_history():
    draft=legacy_draft(); original=deepcopy(draft)
    context=EpisodeGenerationContext(episode_number=2,total_episodes=10,generation_mode="sequential",planned_setup_refs=[REFERENCE])
    reviewed=ScriptGenerationService._attach_episode_quality_review(draft,context)
    assert reviewed.setup_payoff_updates[0].source_ref==REFERENCE
    assert reviewed.setup_payoff_updates[0].setup_payoff_ref==IDENTITY
    assert reviewed.scenes==draft.scenes
    assert draft==original
    assert not _setup_payoff_issues(reviewed,{},context)

def test_unknown_id_or_different_approved_text_never_invents_a_source_match():
    draft=legacy_draft()
    assert restore_legacy_setup_payoff_sources(draft,[REFERENCE+'。']) is draft
    assert restore_legacy_setup_payoff_sources(draft,[]) is draft
    draft.setup_payoff_updates[0].source_ref='already authored source'
    assert restore_legacy_setup_payoff_sources(draft,[REFERENCE]) is draft
