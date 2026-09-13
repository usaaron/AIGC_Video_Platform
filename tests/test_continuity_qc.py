import json

import pytest

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.continuity_qc import (
    BlockingContinuityConflictError,
    evaluate_episode_continuity,
)
from app.modules.script_engine.models import (
    ContinuityQCIssue,
    ContinuityQCIssueSeverity,
    ContinuityQCIssueType,
    ContinuityQCStatus,
    EpisodeGenerationContext,
    EpisodeGenerationMode,
)
from tests.test_master_script_models import build_draft_payload


def build_draft(
    *,
    actions: list[str],
    speaker: str = "Nina",
    slug: str = "SCENE 1 - CURRENT DAY",
    character_updates: list[dict] | None = None,
    continuity_updates: list[dict] | None = None,
    story_line_updates: list[dict] | None = None,
    continuation_hook: dict | None = None,
) -> DraftMasterScript:
    payload = build_draft_payload()
    payload["scenes"][0]["slug"] = slug
    payload["scenes"][0]["character_actions"] = actions
    payload["scenes"][0]["dialogues"] = [{
        "character_name": speaker,
        "intent": "advance the current action",
        "text": "I will finish what we started tonight.",
    }]
    payload["character_state_updates"] = character_updates or []
    payload["continuity_state_updates"] = continuity_updates or []
    payload["story_line_updates"] = story_line_updates or []
    payload["continuation_hook"] = continuation_hook
    return DraftMasterScript.model_validate(payload)


def context(checkpoint: dict) -> EpisodeGenerationContext:
    return EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=3,
        total_episodes=20,
        confirmed_continuity_checkpoint=json.dumps(checkpoint, ensure_ascii=False),
    )


def test_dead_character_current_timeline_action_is_blocking() -> None:
    draft = build_draft(actions=["Mara opens the archive door."], speaker="Mara")
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.mara",
                "aliases": ["Mara"],
                "life_status": "dead",
                "last_updated_episode": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.blocked
    assert report.blocking_issue_count == 1
    assert report.issues[0].issue_type.value == "dead_character_action"
    with pytest.raises(BlockingContinuityConflictError, match="硬冲突"):
        raise BlockingContinuityConflictError(report)


def test_blocking_error_message_excludes_non_blocking_warnings() -> None:
    report = evaluate_episode_continuity(
        build_draft(actions=["Mara opens the archive door."], speaker="Mara"),
        context({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.mara",
                "aliases": ["Mara"],
                "life_status": "dead",
                "last_updated_episode": 2,
            }],
        }),
    )
    report = report.model_copy(update={
        "issues": [
            *report.issues,
            ContinuityQCIssue(
                issue_id="warning.extra",
                issue_type=ContinuityQCIssueType.capability_conflict,
                severity=ContinuityQCIssueSeverity.warning,
                entity_key="character.mara",
                entity_name="Mara",
                summary="能力警告不应出现在硬冲突摘要中。",
                prior_state="受限",
                current_evidence="动作",
                scene_numbers=[1],
                suggested_action="核对动作。",
            ),
        ],
        "warning_count": 1,
    })

    with pytest.raises(BlockingContinuityConflictError) as raised:
        raise BlockingContinuityConflictError(report)

    assert "已经死亡" in str(raised.value)
    assert "能力警告不应" not in str(raised.value)


def test_dead_character_flashback_does_not_trigger_current_timeline_conflict() -> None:
    draft = build_draft(
        actions=["Mara opens the archive door."],
        speaker="Mara",
        slug="FLASHBACK - ARCHIVE",
    )
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.mara",
                "aliases": ["Mara"],
                "life_status": "dead",
                "last_updated_episode": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.passed
    assert report.issues == []


def test_dead_character_cannot_silently_change_back_to_alive() -> None:
    draft = build_draft(
        actions=[],
        character_updates=[{
            "character_name": "Mara",
            "current_goal": "Return to the investigation.",
            "emotional_state": "Determined",
            "life_status": "alive",
            "change_summary": "Mara returns.",
            "change_cause": "She appears at the archive.",
            "evidence_scene_numbers": [1],
        }],
    )
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.mara",
                "aliases": ["Mara"],
                "life_status": "dead",
                "last_updated_episode": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.blocked
    assert report.issues[0].issue_type.value == "dead_character_revived"


def test_permanent_destroyed_state_requires_explicit_repair_transition() -> None:
    draft = build_draft(
        actions=[],
        continuity_updates=[{
            "entity_key": "item.phone",
            "entity_type": "item",
            "entity_name": "Evidence phone",
            "state_domain": "condition",
            "transition": "changed",
            "current_state": "The phone works normally.",
            "persistence": "ongoing",
            "change_cause": "It appears on the desk.",
            "evidence_scene_numbers": [1],
        }],
    )
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "world_states": [{
                "entity_key": "item.phone",
                "entity_type": "item",
                "entity_name": "Evidence phone",
                "state_domain": "condition",
                "current_state": "Burned beyond use.",
                "persistence": "permanent",
                "last_transition": "destroyed",
                "evidence_episode_number": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.blocked
    assert report.issues[0].issue_type.value == "irreversible_state_conflict"


def test_destroyed_item_usage_and_restricted_capability_are_warnings() -> None:
    draft = build_draft(actions=[
        "Nina uses the Evidence phone to call for help.",
        "Nina runs up the stairs before the guard arrives.",
    ])
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.nina",
                "aliases": ["Nina"],
                "life_status": "alive",
                "action_capabilities": ["Cannot walk or run without assistance."],
                "active_constraints": [],
                "last_updated_episode": 2,
            }],
            "world_states": [{
                "entity_key": "item.phone",
                "entity_type": "item",
                "entity_name": "Evidence phone",
                "state_domain": "condition",
                "current_state": "Burned beyond use.",
                "persistence": "permanent",
                "last_transition": "destroyed",
                "evidence_episode_number": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.warnings
    assert report.blocking_issue_count == 0
    assert {issue.issue_type.value for issue in report.issues} == {
        "capability_conflict",
        "unavailable_entity_usage",
    }


@pytest.mark.parametrize("field", ["action_capabilities", "active_constraints"])
@pytest.mark.parametrize("restriction", [
    "不能暴露无辜证人身份",
    "不能替伊芙决定公开时间",
    "不能突然获得她的完全信任",
    "不可失去证人的信任",
    "不能公开昏迷证人的身份",
    "不能跑业务，只能留在办公室核验记录",
    "Cannot expose an innocent witness's identity.",
    "Unable to decide when Eve publishes the evidence.",
    "Cannot disclose the unconscious witness's identity.",
    "Cannot run the investigation without Eve's consent.",
    "Cannot move the evidence without authorization.",
    "Cannot reveal the witness; can walk and run normally.",
])
def test_nonphysical_constraints_do_not_trigger_capability_warnings(
    field: str, restriction: str,
) -> None:
    report = evaluate_episode_continuity(
        build_draft(actions=["Nina walks to the door and takes the key."]),
        context({"character_states": [{
            "character_ref": "character.nina",
            "aliases": ["Nina"],
            "life_status": "alive",
            field: [restriction],
        }]}),
    )

    assert report.status == ContinuityQCStatus.passed
    assert report.issues == []


@pytest.mark.parametrize("field", ["action_capabilities", "active_constraints"])
@pytest.mark.parametrize("restriction", [
    "腿伤导致无法独立行走",
    "不能奔跑",
    "无法抬起手臂",
    "双腿瘫痪",
    "仍处于昏迷",
    "失去意识",
    "双手被绑住",
    "Cannot walk or run without assistance.",
    "Unable to stand unaided.",
    "Incapable of walking.",
    "Cannot move her arms.",
    "Still unconscious.",
    "Immobile.",
    "Currently paralyzed.",
    "In a coma.",
    "Her hands are tied.",
])
def test_explicit_physical_restrictions_remain_advisory(
    field: str, restriction: str,
) -> None:
    report = evaluate_episode_continuity(
        build_draft(actions=["Nina walks to the door and takes the key."]),
        context({"character_states": [{
            "character_ref": "character.nina",
            "aliases": ["Nina"],
            "life_status": "alive",
            field: [restriction],
        }]}),
    )

    assert report.status == ContinuityQCStatus.warnings
    assert report.blocking_issue_count == 0
    assert report.warning_count == 1
    issue = report.issues[0]
    assert issue.issue_type == ContinuityQCIssueType.capability_conflict
    assert issue.prior_state == restriction
    assert issue.scene_numbers == [1]


@pytest.mark.parametrize("restrictions", [
    ["不能暴露证人身份", "无法独立行走"],
    ["Cannot expose the witness", "Unable to walk"],
    ["不能暴露证人身份；无法独立行走"],
    ["Cannot expose the witness; unable to walk"],
])
def test_mixed_constraints_preserve_the_physical_warning(restrictions: list[str]) -> None:
    report = evaluate_episode_continuity(
        build_draft(actions=["Nina walks to the door."]),
        context({"character_states": [{
            "character_ref": "character.nina",
            "aliases": ["Nina"],
            "active_constraints": restrictions,
        }]}),
    )

    assert report.warning_count == 1
    assert report.issues[0].prior_state == restrictions[-1]


@pytest.mark.parametrize(("speaker", "slug"), [
    ("Mara", "SCENE 1 - CURRENT DAY"),
    ("Nina", "FLASHBACK - ARCHIVE"),
])
def test_physical_restrictions_require_current_character_activity(speaker, slug) -> None:
    report = evaluate_episode_continuity(
        build_draft(actions=[], speaker=speaker, slug=slug),
        context({"character_states": [{
            "character_ref": "character.nina",
            "aliases": ["Nina"],
            "active_constraints": ["Unconscious"],
        }]}),
    )

    assert report.issues == []


def test_structured_lost_item_reappearance_without_recovery_is_blocking() -> None:
    draft = build_draft(
        actions=[],
        continuity_updates=[{
            "entity_key": "item.phone",
            "entity_type": "item",
            "entity_name": "Evidence phone",
            "state_domain": "possession",
            "transition": "changed",
            "current_state": "Nina is using the phone again.",
            "persistence": "ongoing",
            "change_cause": "It appears in her pocket.",
            "evidence_scene_numbers": [1],
        }],
    )
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "world_states": [{
                "entity_key": "item.phone",
                "entity_type": "item",
                "entity_name": "Evidence phone",
                "state_domain": "possession",
                "current_state": "The phone is missing.",
                "persistence": "ongoing",
                "last_transition": "lost",
                "evidence_episode_number": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.blocked
    assert report.issues[0].issue_type.value == "unavailable_entity_usage"


def test_knowledge_jump_without_visible_relearning_is_blocking() -> None:
    draft = build_draft(
        actions=[],
        character_updates=[{
            "character_name": "Nina",
            "current_goal": "Find the missing witness.",
            "emotional_state": "Focused",
            "knowledge_changes": [],
            "knowledge_states": [{
                "knowledge_key": "fact.hidden_witness",
                "statement": "The witness is in the archive.",
                "status": "known",
            }],
            "change_summary": "Nina continues the search.",
            "change_cause": "She checks the archive map.",
            "evidence_scene_numbers": [1],
        }],
    )
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.nina",
                "aliases": ["Nina"],
                "life_status": "alive",
                "knowledge_states": [{
                    "knowledge_key": "fact.hidden_witness",
                    "statement": "The witness location was erased from memory.",
                    "status": "forgotten",
                }],
                "last_updated_episode": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.blocked
    assert report.issues[0].issue_type.value == "knowledge_conflict"


def test_missing_checkpoint_is_not_applicable() -> None:
    draft = build_draft(actions=[])

    report = evaluate_episode_continuity(draft, None)

    assert report.status == ContinuityQCStatus.not_applicable


def _knowledge_conflict_draft(
    statement: str, change: str, *, status: str = "disproved",
    summary: str = "Nina checks the recorded times.",
) -> DraftMasterScript:
    return build_draft(actions=[], character_updates=[{
        "character_name": "Nina",
        "current_goal": "Check the original records.",
        "emotional_state": "Focused",
        "knowledge_changes": [change],
        "knowledge_states": [{
            "knowledge_key": "records.time_gap", "statement": statement, "status": status,
        }],
        "change_summary": summary,
        "change_cause": "She compares both dated records.",
        "evidence_scene_numbers": [1],
    }])


@pytest.mark.parametrize(("statement", "change"), [
    ("付款18:00早于通报所载事故20:00，两者为同一时区。", "确认付款18:00早于通报所载事故20:00"),
    ("付款18:00早于通报所载事故20:00，两者为同一时区。", "已核实了：付款18:00早于通报所载事故20:00，两者为同一时区。"),
    ("The payment precedes the reported accident.", "Confirmed that the payment precedes the reported accident."),
    ("The witness has not published the original records.", "Verified: The witness has not published the original records."),
])
def test_confirmed_proposition_marked_disproved_warns_without_overwriting(
    statement: str, change: str,
) -> None:
    draft = _knowledge_conflict_draft(statement, change)
    before = draft.model_dump(mode="json")

    report = evaluate_episode_continuity(draft, context({}))

    assert report.status == ContinuityQCStatus.warnings
    assert report.warning_count == 1
    assert report.blocking_issue_count == 0
    assert report.issues[0].issue_type == ContinuityQCIssueType.knowledge_conflict
    assert "明确确认同一陈述" in report.issues[0].summary
    assert report.issues[0].scene_numbers == [1]
    assert draft.model_dump(mode="json") == before


@pytest.mark.parametrize("change", [
    "尚未确认付款18:00早于通报所载事故20:00",
    "计划确认付款18:00早于通报所载事故20:00",
    "如果确认付款18:00早于通报所载事故20:00，就继续调查",
    "听说有人确认付款18:00早于通报所载事故20:00",
    "她说：确认付款18:00早于通报所载事故20:00",
    "确认付款18:00晚于通报所载事故20:00",
    "确认付款18:00早于通报所载事故21:00",
    "确认付款18:00早于通报所载事故20:00的说法不成立",
    "确认付款18:00早于通报所载事故20:00，随后该判断被证伪",
    "确认付款18:00早于通报所载事故20:00吗？",
    "确认\"付款18:00早于通报所载事故20:00\"",
    "不知道真实事故发生时间",
])
def test_knowledge_warning_does_not_infer_confirmation(change: str) -> None:
    draft = _knowledge_conflict_draft(
        "付款18:00早于通报所载事故20:00，两者为同一时区。", change,
    )
    assert evaluate_episode_continuity(draft, context({})).warning_count == 0


@pytest.mark.parametrize("status", ["known", "believed", "suspected", "forgotten"])
def test_knowledge_warning_only_addresses_disproved_status(status: str) -> None:
    draft = _knowledge_conflict_draft(
        "The payment precedes the reported accident.",
        "Confirmed that the payment precedes the reported accident.", status=status,
    )
    assert evaluate_episode_continuity(draft, context({})).warning_count == 0


@pytest.mark.parametrize("summary", [
    "先确认时差，随后发现错误并更正。",
    "The earlier confirmation was retracted after checking the original.",
])
def test_knowledge_warning_preserves_explicit_later_retraction(summary: str) -> None:
    draft = _knowledge_conflict_draft(
        "The payment precedes the reported accident.",
        "Confirmed that the payment precedes the reported accident.", summary=summary,
    )
    assert evaluate_episode_continuity(draft, context({})).warning_count == 0


def test_same_fact_conflicts_are_reported_for_each_character() -> None:
    draft = _knowledge_conflict_draft(
        "The payment precedes the reported accident.",
        "Confirmed that the payment precedes the reported accident.",
    )
    second = draft.character_state_updates[0].model_copy(update={"character_name": "Mara"})
    draft = draft.model_copy(update={"character_state_updates": [*draft.character_state_updates, second]})

    report = evaluate_episode_continuity(draft, context({}))

    assert report.warning_count == 2
    assert {issue.entity_name for issue in report.issues} == {"Nina", "Mara"}
    assert len({issue.issue_id for issue in report.issues}) == 2


@pytest.mark.parametrize(("statement", "change"), [
    ("The payment precedes the reported accident, and the witness approved it.",
     "Confirmed that the payment precedes the reported accident."),
    ("付款18:00早于通报所载事故20:00，如果截图真实。",
     "确认付款18:00早于通报所载事故20:00"),
    ("The payment amount is 16.5 dollars.", "Confirmed that the payment amount is 165 dollars."),
    ("The payment precedes the reported accident?", "Confirmed that the payment precedes the reported accident."),
])
def test_knowledge_warning_preserves_qualifications_and_numeric_punctuation(
    statement: str, change: str,
) -> None:
    draft = _knowledge_conflict_draft(statement, change)
    assert evaluate_episode_continuity(draft, context({})).warning_count == 0


def test_newer_provisional_checkpoint_takes_precedence_within_active_batch() -> None:
    draft = build_draft(actions=["Mara opens the archive door."], speaker="Mara")
    generation_context = context({
        "through_episode_number": 1,
        "character_states": [{
            "character_ref": "character.mara",
            "aliases": ["Mara"],
            "life_status": "alive",
            "last_updated_episode": 1,
        }],
    }).model_copy(update={
        "provisional_continuity_checkpoint": json.dumps({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.mara",
                "aliases": ["Mara"],
                "life_status": "dead",
                "last_updated_episode": 2,
            }],
        })
    })

    report = evaluate_episode_continuity(draft, generation_context)

    assert report.status == ContinuityQCStatus.blocked
    assert report.checked_through_episode_number == 2


def item_state_update(**overrides: object) -> dict:
    return {
        "entity_key": "item.archive_key",
        "entity_type": "item",
        "entity_name": "Archive key",
        "state_domain": "possession",
        "transition": "transferred",
        "current_state": "The Archive key is held by Nina.",
        "persistence": "ongoing",
        "change_cause": "Omar handed the key over to Nina.",
        "evidence_scene_numbers": [1],
        **overrides,
    }


def character_state_update(name: str, capabilities: list[str]) -> dict:
    return {
        "character_name": name,
        "current_goal": "Find the missing records.",
        "emotional_state": "Focused",
        "action_capabilities": capabilities,
        "change_summary": "The partners prepare to enter the archive.",
        "change_cause": "They compare their evidence.",
        "evidence_scene_numbers": [1],
    }


@pytest.mark.parametrize(("name", "action", "state"), [
    ("矿难付款截图", "宴会厅大屏显示付款截图，文件侧栏的证人名单被选中。", "由伊芙持有，未公开，仍可用于后续核验。"),
    ("签字合同", "会场屏幕正在展示签字合同。", "仍未曝光"),
    ("Payment receipt", "The public screen shows the payment receipt.", "Still private."),
])
def test_public_display_conflicts_with_unqualified_private_state(name, action, state):
    draft = build_draft(actions=[action], continuity_updates=[item_state_update(
        entity_name=name, entity_type="environment", current_state=state,
        transition="established", change_cause="屏幕随后被关闭。",
    )])
    report = evaluate_episode_continuity(draft, context({"through_episode_number": 0}))
    assert report.blocking_issue_count == 0
    assert report.warning_count == 1
    issue = report.issues[0]
    assert issue.issue_type == ContinuityQCIssueType.knowledge_conflict
    assert issue.scene_numbers == [1]
    assert action in issue.current_evidence


@pytest.mark.parametrize(("action", "state", "name", "slug"), [
    ("伊芙计划让宴会厅大屏显示付款截图。", "未公开", "矿难付款截图", "当前"),
    ("如果宴会厅大屏显示付款截图，证人就有危险。", "未公开", "矿难付款截图", "当前"),
    ("宴会厅大屏没有显示付款截图。", "未公开", "矿难付款截图", "当前"),
    ("伊芙阻止宴会厅大屏显示付款截图。", "未公开", "矿难付款截图", "当前"),
    ("伊芙说：‘宴会厅大屏显示付款截图。’", "未公开", "矿难付款截图", "当前"),
    ("宴会厅大屏显示付款截图。", "未公开", "矿难付款截图", "闪回"),
    ("私人手机屏幕显示付款截图。", "未公开", "矿难付款截图", "当前"),
    ("宴会厅大屏显示付款截图。", "未公开", "证人名单", "当前"),
    ("宴会厅大屏显示截图。", "未公开", "矿难付款截图", "当前"),
    ("宴会厅大屏显示付款截图。", "已在宴会短暂展示；尚未在网络公开。", "矿难付款截图", "当前"),
    ("The public screen will show the payment receipt.", "Still private.", "Payment receipt", "CURRENT"),
    ("The public screen shows the payment receipt.", "Not published online.", "Payment receipt", "CURRENT"),
    ("空无一人的宴会厅大屏显示付款截图。", "未公开", "矿难付款截图", "当前"),
    ("宴会厅大屏显示付款截图，但屏幕被幕布遮住。", "未公开", "矿难付款截图", "当前"),
    ("彩排时宴会厅大屏显示付款截图。", "未公开", "矿难付款截图", "当前"),
    ("伊芙说：宴会厅大屏显示付款截图。", "未公开", "矿难付款截图", "当前"),
    ("伊芙说：\"昨天出事了。宴会厅大屏显示付款截图。\"", "未公开", "矿难付款截图", "当前"),
])
def test_disclosure_warning_does_not_infer_publication_or_erase_channel_scope(action, state, name, slug):
    draft = build_draft(actions=[action], slug=f"场景：{slug}", continuity_updates=[item_state_update(
        entity_name=name, current_state=state, transition="established",
        change_cause="状态来自本集记录。",
    )])
    report = evaluate_episode_continuity(draft, context({"through_episode_number": 0}))
    assert report.issues == []


def test_disclosure_warning_does_not_assign_an_ambiguous_short_name_to_multiple_records():
    draft = build_draft(actions=["宴会厅大屏显示付款截图。"], continuity_updates=[
        item_state_update(entity_key=f"evidence.receipt_{index}", entity_name=name,
                          current_state="未公开", transition="established")
        for index, name in enumerate(("旧版付款截图", "新版付款截图"))
    ])
    assert evaluate_episode_continuity(draft, context({"through_episode_number": 0})).issues == []


@pytest.mark.parametrize(
    ("holder", "previous_holder", "item_name", "state", "capability"),
    [
        ("Nina", "Omar", "Archive key", "The Archive key is held by Nina.", "Holds the Archive key."),
        ("林岚", "陈舟", "档案室钥匙", "档案室钥匙由林岚持有", "持有档案室钥匙"),
    ],
)
def test_same_episode_possession_conflict_is_a_warning_without_prior_checkpoint(
    holder: str, previous_holder: str, item_name: str, state: str, capability: str,
) -> None:
    draft = build_draft(
        actions=[],
        character_updates=[
            character_state_update(holder, []),
            character_state_update(previous_holder, [capability]),
        ],
        continuity_updates=[item_state_update(entity_name=item_name, current_state=state)],
    )
    generation_context = context({}).model_copy(update={
        "episode_number": 1,
        "confirmed_continuity_checkpoint": None,
    })

    report = evaluate_episode_continuity(draft, generation_context)

    assert report.status == ContinuityQCStatus.warnings
    assert report.blocking_issue_count == 0
    assert len(report.issues) == 1
    issue = report.issues[0]
    assert issue.issue_type == ContinuityQCIssueType.capability_conflict
    assert issue.entity_key == "item.archive_key"
    assert holder in issue.summary and previous_holder in issue.summary
    assert capability in issue.current_evidence
    assert issue.scene_numbers == [1]


@pytest.mark.parametrize(
    ("state", "capability"),
    [
        ("The Archive key is held by Nina.", "Will hold the Archive key."),
        ("The Archive key is held by Nina.", "No longer holds the Archive key."),
        ("The Archive key is held by Nina.", "Holds a copy of the Archive key."),
        ("The Archive key is held jointly by Nina and Omar.", "Holds the Archive key."),
        ("Archive key由Nina与Omar共同持有", "持有Archive key"),
        ("Archive key由Nina持有", "不再持有Archive key"),
        ("Archive key由Nina持有", "计划持有Archive key"),
        ("Archive key由Nina持有", "持有Archive key副本"),
    ],
)
def test_possession_diagnostic_does_not_infer_exclusive_current_custody(
    state: str, capability: str,
) -> None:
    draft = build_draft(
        actions=[],
        character_updates=[
            character_state_update("Nina", []),
            character_state_update("Omar", [capability]),
        ],
        continuity_updates=[item_state_update(current_state=state)],
    )

    assert evaluate_episode_continuity(draft, context({})).issues == []


def test_matching_character_and_item_holder_passes() -> None:
    draft = build_draft(
        actions=[],
        character_updates=[character_state_update("Nina", ["Holds the Archive key."])],
        continuity_updates=[item_state_update()],
    )

    assert evaluate_episode_continuity(draft, context({})).issues == []


def test_warning_limit_cannot_hide_a_blocking_conflict() -> None:
    visitors = [f"Visitor{index:02d}" for index in range(11)]
    draft = build_draft(
        actions=["Mara and " + ", ".join(visitors) + " enter the archive."],
        continuity_updates=[item_state_update(
            entity_key=f"item.pending_{index}",
            entity_name=f"Parcel {index}",
            current_state="The parcel will be transferred tomorrow.",
            change_cause="The clerk announced a deadline.",
        ) for index in range(40)],
    )
    checkpoint = {
        "character_states": [
            {"character_ref": f"character.visitor_{index}", "aliases": [name],
             "action_capabilities": ["Unable to walk."]}
            for index, name in enumerate(visitors)
        ] + [{"character_ref": "character.mara", "aliases": ["Mara"], "life_status": "dead"}],
    }

    report = evaluate_episode_continuity(draft, context(checkpoint))

    assert len(report.issues) == 50
    assert report.status == ContinuityQCStatus.blocked
    assert report.blocking_issue_count == 1
    assert report.warning_count == 49
    assert report.issues[0].issue_type == ContinuityQCIssueType.dead_character_action


@pytest.mark.parametrize("state", [
    "档案室原始记录面临今晚转运时限",
    "档案室原始记录尚未转运",
    "档案室原始记录即将转交给调查员",
    "The records are scheduled to be transferred tonight.",
    "The records have not yet been transferred.",
])
def test_future_transfer_cannot_silently_describe_a_completed_transition(state: str) -> None:
    draft = build_draft(
        actions=[],
        continuity_updates=[item_state_update(
            entity_key="item.records",
            entity_name="Records",
            current_state=state,
            change_cause="The clerk announced the deadline.",
        )],
    )

    report = evaluate_episode_continuity(draft, context({}))

    assert report.status == ContinuityQCStatus.warnings
    assert report.blocking_issue_count == 0
    assert report.warning_count == 1
    assert report.issues[0].issue_type == ContinuityQCIssueType.unavailable_entity_usage
    assert "待发生" in report.issues[0].summary
    assert state in report.issues[0].current_evidence


@pytest.mark.parametrize(("state", "cause", "transition"), [
    ("档案室记录即将转运", "调查员已转交记录给保管员", "transferred"),
    ("档案室记录已转交保管员，明天即将转运", "调查员交出记录", "transferred"),
    ("The records will be shipped tomorrow.", "The records were transferred to Nina.", "transferred"),
    ("The records will be shipped tomorrow.", "Omar handed the records over to Nina.", "transferred"),
    ("档案室记录尚未转运", "保管员说明明晚的转运时限", "established"),
    ("The Archive key is held by Nina.", "Omar handed the key over to Nina.", "transferred"),
])
def test_completed_handover_or_future_plan_with_correct_transition_passes(
    state: str, cause: str, transition: str,
) -> None:
    draft = build_draft(
        actions=[],
        continuity_updates=[item_state_update(
            current_state=state,
            change_cause=cause,
            transition=transition,
            future_constraint="The item must be transferred again tomorrow.",
        )],
    )

    assert evaluate_episode_continuity(draft, context({})).issues == []


@pytest.mark.parametrize("persistence", ["ongoing", "permanent"])
@pytest.mark.parametrize("with_update", [False, True])
def test_transferred_item_remains_available_to_its_new_holder(
    persistence: str, with_update: bool,
) -> None:
    draft = build_draft(
        actions=["Nina uses the Archive key to open the door."],
        continuity_updates=[item_state_update(
            transition="changed",
            current_state="Nina keeps the Archive key in her pocket after opening the door.",
            change_cause="Nina enters the archive.",
        )] if with_update else [],
    )
    report = evaluate_episode_continuity(draft, context({
        "through_episode_number": 2,
        "world_states": [{
            "entity_key": "item.archive_key",
            "entity_type": "item",
            "entity_name": "Archive key",
            "state_domain": "possession",
            "current_state": "The Archive key is held by Nina.",
            "persistence": persistence,
            "last_transition": "transferred",
            "evidence_episode_number": 2,
        }],
    }))

    assert report.status == ContinuityQCStatus.passed
    assert report.issues == []


def test_story_line_omission_and_overdue_hook_are_reported() -> None:
    draft = build_draft(actions=["Nina finds a new ledger page."])
    generation_context = context({
        "through_episode_number": 2,
        "story_line_states": [{
            "story_line_id": "storyline.truth",
            "status": "active",
            "current_state": "The first source has been found.",
            "last_progressed_episode": 2,
        }],
        "open_setup_payoffs": [{
            "setup_payoff_id": "hook.episode_0001",
            "description": "The witness named Nina's father.",
            "status": "setup",
            "setup_episode": 1,
            "target_payoff_episode": 3,
        }],
    }).model_copy(update={
        "previous_episode_question": "Why did the witness name Nina's father?",
        "planned_story_line_refs": ["storyline.truth"],
        "planned_story_beat": "Verify the witness's accusation.",
    })

    report = evaluate_episode_continuity(draft, generation_context)

    assert report.status == ContinuityQCStatus.warnings
    assert {issue.issue_type.value for issue in report.issues} == {
        "missing_planned_story_line_progress",
        "missing_hook_response",
        "overdue_hook",
    }


def test_aligned_story_line_progress_and_exact_hook_response_pass() -> None:
    draft = build_draft(
        actions=["Nina compares the witness statement with the original ledger."],
        story_line_updates=[{
            "story_line_id": "storyline.truth",
            "status": "active",
            "progress_summary": "The original ledger disproves part of the accusation.",
            "contribution_type": "turning_point",
            "planned_beat_ref": "storyline.truth",
            "planned_alignment": "aligned",
            "next_required_step": "Find who altered the copied ledger.",
            "change_cause": "Nina compares the original and copied ledgers.",
            "evidence_scene_numbers": [1],
        }],
        continuation_hook={
            "responds_to_episode": 2,
            "previous_hook_response": "The original ledger proves the signature was copied.",
            "response_evidence_scene_numbers": [1],
            "ending_hook_type": "Evidence threat",
            "ending_hook_summary": "The copied ledger is scheduled for destruction.",
            "next_episode_obligation": "Secure the copied ledger before destruction.",
            "target_payoff_episode": 4,
        },
    )
    generation_context = context({
        "through_episode_number": 2,
        "story_line_states": [{
            "story_line_id": "storyline.truth",
            "status": "active",
            "current_state": "The witness accused Nina's father.",
            "last_progressed_episode": 2,
        }],
        "open_setup_payoffs": [{
            "setup_payoff_id": "hook.episode_0002",
            "description": "The witness accused Nina's father.",
            "status": "setup",
            "setup_episode": 2,
            "target_payoff_episode": 3,
        }],
    }).model_copy(update={
        "previous_episode_question": "Did Nina's father sign the ledger?",
        "planned_story_line_refs": ["storyline.truth"],
        "planned_story_beat": "Verify the signature.",
    })

    report = evaluate_episode_continuity(draft, generation_context)

    assert report.status == ContinuityQCStatus.passed
    assert report.issues == []


def test_planned_setup_and_payoff_require_evidence_backed_updates() -> None:
    draft = build_draft(actions=["Nina finds an altered letter."])
    generation_context = context({
        "through_episode_number": 2,
        "open_setup_payoffs": [{
            "setup_payoff_id": "setup.old_letter",
            "description": "The letter date was altered.",
            "status": "setup",
            "setup_episode": 1,
            "target_payoff_episode": 3,
        }],
    }).model_copy(update={
        "planned_setup_refs": ["setup.new_witness"],
        "planned_payoff_refs": ["setup.old_letter"],
    })

    report = evaluate_episode_continuity(draft, generation_context)

    assert report.status == ContinuityQCStatus.warnings
    assert {issue.issue_type.value for issue in report.issues} == {
        "missing_planned_setup",
        "missing_planned_payoff",
    }


def test_planned_setup_and_payoff_updates_pass_when_actions_match() -> None:
    payload = build_draft_payload()
    payload["setup_payoff_updates"] = [{
        "setup_payoff_ref": "setup.old_letter",
        "action": "payoff",
        "status": "paid_off",
        "progress_summary": "The ink test identifies the alteration year.",
        "change_cause": "Nina compares the laboratory report with the archive date.",
        "evidence_scene_numbers": [1],
    }, {
        "setup_payoff_ref": "setup.new_witness",
        "action": "setup",
        "status": "setup",
        "progress_summary": "A witness receipt appears in the archive.",
        "next_required_step": "Locate the witness.",
        "target_payoff_episode": 6,
        "change_cause": "Nina opens the sealed archive box.",
        "evidence_scene_numbers": [1],
    }]
    draft = DraftMasterScript.model_validate(payload)
    generation_context = context({
        "through_episode_number": 2,
        "open_setup_payoffs": [{
            "setup_payoff_id": "setup.old_letter",
            "description": "The letter date was altered.",
            "status": "setup",
            "setup_episode": 1,
            "target_payoff_episode": 3,
        }],
    }).model_copy(update={
        "planned_setup_refs": ["setup.new_witness"],
        "planned_payoff_refs": ["setup.old_letter"],
    })

    report = evaluate_episode_continuity(draft, generation_context)

    assert report.status == ContinuityQCStatus.passed
