import pytest
from pydantic import ValidationError

from app.modules.master_script.models import (
    CharacterProfile,
    DialogueLine,
    DraftSceneCard,
    DraftMasterScript,
    LLMGeneratedDraftMasterScript,
    MasterScriptCreate,
    MasterScriptFinalizeRequest,
    RelationshipStateUpdate,
    SceneCausality,
    SetupPayoffStateUpdate,
    StoryLineStateUpdate,
    ContinuationHookState,
    normalize_generated_episode_title,
)
from tests.test_master_script_service import build_finalize_request


def test_relationship_state_update_requires_a_concrete_two_sided_relationship() -> None:
    update = RelationshipStateUpdate(
        source_character_name="林夏",
        target_character_name="周野",
        relationship_type="临时救援同盟",
        source_to_target="认可对方的医疗判断，但仍保留戒心。",
        target_to_source="愿意保护对方，但要求共享污染数据。",
        current_state="两人因共同关闭污染源建立有条件同盟。",
        change_summary="共同冒险后建立临时合作。",
        change_cause="两人必须协作关闭污染阀门。",
        evidence_scene_numbers=[1],
    )

    assert update.relationship_type == "临时救援同盟"
    with pytest.raises(ValidationError):
        RelationshipStateUpdate(
            **{
                **update.model_dump(),
                "target_character_name": "林夏",
            }
        )


def test_story_line_and_hook_receipts_keep_plan_lineage() -> None:
    update = StoryLineStateUpdate(
        story_line_id="storyline.truth",
        status="active",
        progress_summary="林夏取得第一份原始账页。",
        contribution_type="turning_point",
        planned_beat_ref="storyline.truth",
        planned_alignment="expanded",
        alignment_note="额外确认了伪造时间。",
        next_required_step="查明谁替换了账页。",
        change_cause="林夏进入仓库封存原件。",
        evidence_scene_numbers=[1],
    )
    hook = ContinuationHookState(
        responds_to_episode=2,
        previous_hook_response="旧信证明签名是临摹的。",
        response_evidence_scene_numbers=[1],
        ending_hook_type="证物危机",
        ending_hook_summary="原始账页即将被销毁。",
        next_episode_obligation="抢救原始账页。",
        target_payoff_episode=4,
    )

    assert update.planned_alignment == "expanded"
    assert hook.responds_to_episode == 2
    setup = SetupPayoffStateUpdate(
        setup_payoff_ref="setup.old_letter",
        action="partial_payoff",
        status="active",
        progress_summary="墨水年份已确认，但涂改者仍未知。",
        next_required_step="确认谁取得过原信。",
        target_payoff_episode=8,
        change_cause="林夏取得墨水检测结果。",
        evidence_scene_numbers=[1],
    )
    assert setup.action == "partial_payoff"
    with pytest.raises(ValidationError):
        ContinuationHookState(
            **{
                **hook.model_dump(),
                "previous_hook_response": None,
            }
        )


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("第六集：床旁来客", "床旁来客"),
        ("第 6 集 - 床旁来客", "床旁来客"),
        ("Episode 6: Bedside Visitor", "Bedside Visitor"),
        ("床旁来客", "床旁来客"),
    ],
)
def test_generated_episode_title_excludes_the_episode_number(
    source: str,
    expected: str,
) -> None:
    assert normalize_generated_episode_title(source) == expected


def test_dialogue_translation_is_required_for_new_llm_output_but_legacy_data_loads() -> None:
    legacy = DialogueLine(
        character_name="林夏",
        intent="压低声音",
        text="找到了。",
    )

    assert legacy.chinese_translation is None
    assert legacy.chinese_character_name is None
    assert "chinese_translation" in DialogueLine.model_json_schema()["required"]
    assert "chinese_character_name" in DialogueLine.model_json_schema()["required"]
    paired = DialogueLine(
        character_name="LENA HART",
        chinese_character_name="林夏",
        intent="压低声音",
        text="I found it.",
        chinese_translation="我找到了。",
    )
    assert paired.chinese_translation == "我找到了。"


def _screenplay_scene(**updates: object) -> DraftSceneCard:
    payload: dict[str, object] = {
        "scene_number": 1,
        "slug": "INT. 仓库 夜",
        "purpose": "林夏取得账本并逼问周野。",
        "setting_hint": "INT. 仓库 夜",
        "beat_summary": "林夏取得账本，周野随后指出账本已经被调包。",
        "emotional_shift": "警惕转为震惊",
        "character_actions": ["林夏打开铁柜。", "周野按住账本。"],
        "dialogues": [
            DialogueLine(character_name="林夏", intent="压低声音", text="找到了。"),
            DialogueLine(character_name="周野", intent="直接打断", text="那是假的。"),
        ],
    }
    payload.update(updates)
    return DraftSceneCard.model_validate(payload)


def test_screenplay_body_order_preserves_authored_interleaving() -> None:
    scene = _screenplay_scene(
        body_order=["action:0", "dialogue:0", "action:1", "dialogue:1"]
    )

    assert scene.body_order == [
        "action:0",
        "dialogue:0",
        "action:1",
        "dialogue:1",
    ]


def test_screenplay_body_order_recovers_invalid_legacy_order_locally() -> None:
    scene = _screenplay_scene(body_order=["action:0", "dialogue:99"])

    assert scene.body_order == [
        "action:0",
        "dialogue:0",
        "action:1",
        "dialogue:1",
    ]


def test_screenplay_body_order_repairs_grouped_actions_and_dialogue() -> None:
    scene = _screenplay_scene(
        body_order=["action:0", "action:1", "dialogue:0", "dialogue:1"]
    )

    assert scene.body_order == [
        "action:0",
        "dialogue:0",
        "action:1",
        "dialogue:1",
    ]


def build_payload() -> dict:
    return {
        "content_spec_id": "content_spec_001",
        "title": "Fake marriage cliffhanger episode",
        "language": "en",
        "tone": "intense",
        "hook": "She said yes before she recognized the groom.",
        "synopsis": "A strategic fake marriage spirals into a public betrayal reveal.",
        "episode_goal": "Deliver a marriage twist and end on a social-status cliffhanger.",
        "target_duration_seconds": 45,
        "scenes": [
            {
                "scene_number": 1,
                "slug": "INT. CEREMONY HALL - DAY",
                "purpose": "Establish the public fake marriage setup.",
                "setting": "Ceremony Hall",
                "beat_summary": "The heroine agrees to a rushed public marriage.",
                "emotional_shift": "confusion_to_commitment",
                "cliffhanger": False,
                "dialogues": [
                    {
                        "character_name": "Nina",
                        "intent": "accept the arrangement",
                        "text": "Fine. I will marry you, but only for one month.",
                    }
                ],
            },
            {
                "scene_number": 2,
                "slug": "INT. CEREMONY STAGE - DAY",
                "purpose": "Reveal the twist and lock the cliffhanger.",
                "setting": "Ceremony Stage",
                "beat_summary": "The groom exposes the true reason for the marriage.",
                "emotional_shift": "relief_to_shock",
                "cliffhanger": True,
                "dialogues": [
                    {
                        "character_name": "Adrian",
                        "intent": "reveal hidden leverage",
                        "text": "You are not my wife, Nina. You are my witness.",
                    }
                ],
            },
        ],
        "qa_notes": ["Hook lands in the first scene."],
    }


def test_master_script_accepts_valid_payload() -> None:
    model = MasterScriptCreate.model_validate(build_payload())
    assert model.content_spec_id == "content_spec_001"
    assert model.scenes[-1].cliffhanger is True


def test_master_script_rejects_duplicate_scene_numbers() -> None:
    payload = build_payload()
    payload["scenes"][1]["scene_number"] = 1

    with pytest.raises(ValidationError, match="Scene numbers must be unique"):
        MasterScriptCreate.model_validate(payload)


def test_master_script_requires_final_cliffhanger() -> None:
    payload = build_payload()
    payload["scenes"][-1]["cliffhanger"] = False

    with pytest.raises(ValidationError, match="final scene must end with a cliffhanger"):
        MasterScriptCreate.model_validate(payload)


def build_draft_payload() -> dict:
    return {
        "content_spec_id": "content_spec_001",
        "generation_strategy_id": "strategy.tiktok.master_script.v1",
        "title": "Fake marriage draft",
        "language": "en",
        "tone": "intense",
        "hook": "The bride recognized the groom one second too late.",
        "synopsis": "A revenge marriage setup accelerates toward a public social cliffhanger.",
        "episode_goal": "Land a strong reveal and preserve sequel momentum.",
        "target_duration_seconds": 45,
        "scenes": [
            {
                "scene_number": 1,
                "slug": "SCENE 1 - HOOK",
                "purpose": "Open with the fake wedding promise.",
                "setting_hint": "Ceremony Hall",
                "beat_summary": "The heroine enters the ceremony under pressure.",
                "emotional_shift": "fear_to_control",
                "cliffhanger": False,
                "dialogue_prompts": [
                    "Advance the wedding setup clearly.",
                    "Express the target emotion: revenge.",
                ],
                "supporting_asset_ids": ["scene.wedding_set", "character.lead_pair"],
            },
            {
                "scene_number": 2,
                "slug": "SCENE 2 - CLIFFHANGER",
                "purpose": "Expose the revenge motive at the altar.",
                "setting_hint": "Ceremony Stage",
                "beat_summary": "The groom reframes the marriage as a public trap.",
                "emotional_shift": "control_to_suspense",
                "cliffhanger": True,
                "dialogue_prompts": [
                    "Advance the reveal beat clearly.",
                    "Express the target emotion: shock.",
                ],
                "supporting_asset_ids": ["scene.wedding_set", "character.lead_pair"],
            },
        ],
        "qa_notes": ["Review dialogue prompts before final script expansion."],
        "llm_metadata": {"provider": "mock"},
    }


def test_draft_master_script_accepts_valid_payload() -> None:
    model = DraftMasterScript.model_validate(build_draft_payload())
    assert model.generation_strategy_id == "strategy.tiktok.master_script.v1"
    assert model.scenes[-1].cliffhanger is True


def test_llm_generated_characters_reject_alias_duplicate_identity() -> None:
    characters = [
        CharacterProfile(
            name="砝码（Weight）",
            role="证人",
            description="掌握重建账本并隐藏真实身份的关键证人。",
            motivation="公开重建契约背后的真相。",
        ),
        CharacterProfile(
            name="Weight",
            role="证人假身份",
            description="以英文代号活动的同一个关键证人。",
            motivation="公开重建契约背后的真相。",
        ),
    ]

    with pytest.raises(ValueError, match="one record per identity"):
        LLMGeneratedDraftMasterScript.ensure_unique_character_identities(characters)


def test_llm_generated_characters_keep_distinct_same_name_people() -> None:
    characters = [
        CharacterProfile(
            name="李伟（医生）",
            role="急诊医生",
            description="负责抢救关键证人的急诊医生。",
            motivation="查清病历被替换的原因。",
        ),
        CharacterProfile(
            name="李伟（记者）",
            role="调查记者",
            description="追查同一案件资金来源的调查记者。",
            motivation="公开资金链背后的操控者。",
        ),
    ]

    assert LLMGeneratedDraftMasterScript.ensure_unique_character_identities(characters) == characters


def test_scene_causality_rejects_outcome_that_restates_goal() -> None:
    with pytest.raises(ValidationError, match="outcome must meaningfully differ"):
        SceneCausality.model_validate(
            {
                "goal": "The lead obtains access to the sealed archive.",
                "conflict": "A guard blocks the only entrance.",
                "outcome": "The lead obtains access to the sealed archive.",
            }
        )


def test_draft_master_script_accepts_complete_causal_chain() -> None:
    payload = build_draft_payload()
    payload["scenes"][0]["scene_causality"] = {
        "goal": "The lead must enter the restricted hearing.",
        "conflict": "Security rejects the lead's credentials.",
        "outcome": "The lead exposes a procedural error and gains conditional entry.",
    }
    payload["scenes"][1]["scene_causality"] = {
        "goal": "The lead must present evidence before access is revoked.",
        "conflict": "The chair challenges the evidence and starts removing the lead.",
        "outcome": "A witness confirms the evidence but names an unexpected sponsor.",
        "caused_by_scene_number": 1,
        "causal_link": "Conditional entry gives the lead one chance to present the evidence.",
    }

    model = DraftMasterScript.model_validate(payload)

    assert model.scenes[0].scene_causality.goal.startswith("The lead must enter")
    assert model.scenes[1].scene_causality.caused_by_scene_number == 1


def test_llm_generated_script_requires_later_scene_to_reference_earlier_outcome() -> None:
    payload = {
        "title": "The Sealed Hearing",
        "logline": "An investigator risks her career to expose a hidden sponsor.",
        "synopsis": "A denied investigator forces her way into a hearing and uncovers a larger scheme.",
        "hook": "They erased her name from the witness list while she was standing outside.",
        "target_audience": "Short-form mystery viewers",
        "target_platform": "short_video_test",
        "language": "en",
        "tone": "suspenseful",
        "episode_goal": "Expose the first layer of the scheme and create a consequential question.",
        "target_duration_seconds": 45,
        "characters": [
            {
                "name": "Iris Vale",
                "role": "investigator",
                "description": "A methodical investigator whose career is already under review.",
                "motivation": "Prove that evidence was removed before the public hearing.",
            }
        ],
        "character_state_updates": [
            {
                "character_name": "Iris Vale",
                "current_goal": "Learn why her mentor ordered the evidence removed.",
                "emotional_state": "Shocked but committed to continuing publicly.",
                "belief_or_attitude": "Her mentor can no longer be treated as a trusted ally.",
                "knowledge_changes": ["Her mentor sponsored the evidence deletion."],
                "active_constraints": ["Security is removing her from the hearing."],
                "personality_change": None,
                "change_summary": "Iris redirects the investigation toward her mentor.",
                "change_cause": "The witness names her mentor during the public hearing.",
                "evidence_scene_numbers": [2],
            }
        ],
        "scenes": [
            {
                "scene_number": 1,
                "slug": "SCENE 1 - LOCKED DOOR",
                "purpose": "Get inside the hearing before evidence is sealed.",
                "setting": "Administrative corridor",
                "beat_summary": "Security rejects Iris until she identifies a filing violation.",
                "emotional_shift": "pressure_to_resolve",
                "emotional_objective": "Turn exclusion into a narrow opportunity.",
                "character_actions": ["Iris records the rejection and cites the public-access rule."],
                "turning_point": "The clerk grants Iris one minute inside the hearing.",
                "scene_causality": {
                    "goal": "Iris must enter the hearing before the evidence is sealed.",
                    "conflict": "Security rejects her credentials and begins closing the doors.",
                    "outcome": "Iris wins one minute to present the evidence in public.",
                },
                "cliffhanger": False,
                "dialogues": [
                    {
                        "character_name": "Iris Vale",
                        "intent": "force procedural access",
                        "text": "Record that refusal. The hearing is still public for one more minute.",
                    }
                ],
            },
            {
                "scene_number": 2,
                "slug": "SCENE 2 - THE SPONSOR",
                "purpose": "Present the evidence before the minute expires.",
                "setting": "Public hearing room",
                "beat_summary": "A witness confirms the deletion but identifies Iris's mentor as sponsor.",
                "emotional_shift": "resolve_to_shock",
                "emotional_objective": "Make the victory reveal a more personal threat.",
                "character_actions": ["Iris places the timestamped record on the public display."],
                "turning_point": "The witness names Iris's mentor as the person who ordered the deletion.",
                "scene_causality": {
                    "goal": "Iris must authenticate the evidence before her minute ends.",
                    "conflict": "The chair disputes the timestamp and orders security forward.",
                    "outcome": "The evidence is confirmed, but it implicates Iris's trusted mentor.",
                },
                "cliffhanger": True,
                "dialogues": [
                    {
                        "character_name": "Witness",
                        "intent": "name the hidden sponsor",
                        "text": "The deletion order came from the person who trained you.",
                    }
                ],
            },
        ],
        "next_episode_question": "Why did Iris's mentor erase the evidence before the hearing?",
    }

    with pytest.raises(ValidationError, match="must reference an earlier scene outcome"):
        LLMGeneratedDraftMasterScript.model_validate(payload)


def test_draft_master_script_requires_final_cliffhanger() -> None:
    payload = build_draft_payload()
    payload["scenes"][-1]["cliffhanger"] = False

    with pytest.raises(
        ValidationError, match="final draft scene must end with a cliffhanger"
    ):
        DraftMasterScript.model_validate(payload)


def test_llm_state_ledger_requires_death_to_match_character_life_status() -> None:
    payload = {
        "title": "The Broken Vow",
        "logline": "A witness survives a public confrontation that the ledger marks as fatal.",
        "synopsis": "Nina protects the evidence during a confrontation and remains alive.",
        "hook": "The attacker reaches Nina before security can intervene.",
        "target_audience": "Serialized drama viewers",
        "target_platform": "mainland_comic_drama",
        "language": "en",
        "tone": "intense",
        "episode_goal": "Resolve the confrontation and preserve its physical consequences.",
        "target_duration_seconds": 60,
        "characters": [{
            "name": "Nina",
            "role": "lead witness",
            "description": "A careful witness who protects the original evidence.",
            "motivation": "Keep the evidence alive long enough to publish it.",
        }],
        "character_state_updates": [{
            "character_name": "Nina",
            "current_goal": "Publish the protected evidence.",
            "emotional_state": "Shaken but resolved.",
            "life_status": "alive",
            "knowledge_changes": [],
            "active_constraints": [],
            "change_summary": "Nina survives the confrontation.",
            "change_cause": "Security stops the attacker before the final blow.",
            "evidence_scene_numbers": [1],
        }],
        "continuity_state_updates": [{
            "entity_key": "character.nina",
            "entity_type": "character",
            "entity_name": "Nina",
            "state_domain": "life",
            "transition": "died",
            "current_state": "Nina is dead.",
            "persistence": "permanent",
            "future_constraint": "Nina cannot perform new chronological actions.",
            "change_cause": "The confrontation kills Nina.",
            "evidence_scene_numbers": [1],
        }],
        "scenes": [{
            "scene_number": 1,
            "slug": "INT. HEARING ROOM - DAY",
            "purpose": "Protect Nina and the evidence from the attacker.",
            "setting": "A crowded public hearing room during lockdown.",
            "beat_summary": "Security stops the attacker while Nina seals the evidence.",
            "emotional_shift": "terror to resolve",
            "emotional_objective": "Turn physical danger into public resolve.",
            "character_actions": ["Nina shields the evidence as security restrains the attacker."],
            "turning_point": "Nina survives and raises the sealed evidence for the cameras.",
            "scene_causality": {
                "goal": "Nina must protect the evidence until security reaches her.",
                "conflict": "The attacker blocks the exit and closes in on Nina.",
                "outcome": "Security restrains the attacker and Nina keeps the evidence.",
            },
            "cliffhanger": True,
            "dialogues": [{
                "character_name": "Nina",
                "intent": "make the evidence public",
                "text": "You cannot bury what everyone has already seen.",
            }],
        }],
        "next_episode_question": "Can Nina publish the evidence before the hearing is sealed?",
    }
    with pytest.raises(ValidationError, match="matching dead life_status"):
        LLMGeneratedDraftMasterScript.model_validate(payload)


def test_master_script_finalize_request_accepts_valid_payload() -> None:
    request, _ = build_finalize_request()
    model = MasterScriptFinalizeRequest.model_validate(request.model_dump())
    assert model.script_generation_draft_run.generation_strategy_version == "v1"
    assert model.speaker_name_cycle == ["Heroine", "Counterpart"]


def test_master_script_finalize_request_rejects_duplicate_speaker_names() -> None:
    request, _ = build_finalize_request()
    payload = request.model_dump()
    payload["speaker_name_cycle"] = ["Heroine", "Heroine"]

    with pytest.raises(ValidationError, match="Speaker names must be unique"):
        MasterScriptFinalizeRequest.model_validate(payload)
