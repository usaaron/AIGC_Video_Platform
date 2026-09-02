from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.models import (
    ContinuityQCIssue,
    ContinuityQCIssueSeverity,
    ContinuityQCIssueType,
    ContinuityQCReport,
    ContinuityQCStatus,
    EpisodeGenerationContext,
)


_NON_CURRENT_TIMELINE_MARKERS = (
    "回忆",
    "闪回",
    "往事",
    "梦境",
    "幻觉",
    "录像",
    "录音",
    "影像",
    "照片",
    "遗像",
    "flashback",
    "memory",
    "dream",
    "recording",
    "video",
)
_CAPABILITY_RESTRICTION_MARKERS = (
    "不能",
    "无法",
    "不可",
    "失去",
    "瘫痪",
    "昏迷",
    "cannot",
    "unable",
    "incapable",
    "immobile",
    "unconscious",
)


class BlockingContinuityConflictError(ValueError):
    def __init__(self, report: ContinuityQCReport) -> None:
        self.report = report
        blocking_issues = [
            issue
            for issue in report.issues
            if issue.severity == ContinuityQCIssueSeverity.blocking
        ]
        details = "；".join(issue.summary for issue in blocking_issues[:3])
        super().__init__(
            f"本集连续性检查发现 {report.blocking_issue_count} 个硬冲突：{details}"
        )


def evaluate_episode_continuity(
    draft: DraftMasterScript,
    context: EpisodeGenerationContext | None,
) -> ContinuityQCReport:
    if context is None:
        return ContinuityQCReport(
            status=ContinuityQCStatus.not_applicable,
            current_episode_number=context.episode_number if context else None,
        )
    checkpoint: dict[str, Any] = {}
    checkpoint_payload = (
        context.provisional_continuity_checkpoint
        or context.confirmed_continuity_checkpoint
    )
    if checkpoint_payload:
        try:
            decoded_checkpoint = json.loads(checkpoint_payload)
        except (TypeError, ValueError):
            decoded_checkpoint = None
        if isinstance(decoded_checkpoint, dict):
            checkpoint = decoded_checkpoint
        elif not context.storyline_duties:
            return ContinuityQCReport(
                status=ContinuityQCStatus.not_applicable,
                current_episode_number=context.episode_number,
            )
    elif not context.storyline_duties:
        return ContinuityQCReport(
            status=ContinuityQCStatus.not_applicable,
            current_episode_number=context.episode_number,
        )

    issues: list[ContinuityQCIssue] = []
    aliases_by_entity = _aliases_by_entity(checkpoint)
    issues.extend(_character_issues(draft, checkpoint, aliases_by_entity))
    issues.extend(_world_state_issues(draft, checkpoint, aliases_by_entity))
    issues.extend(_story_line_issues(draft, checkpoint, context))
    issues.extend(_storyline_duty_issues(draft, checkpoint, context))
    issues.extend(_setup_payoff_issues(draft, checkpoint, context))
    issues.extend(_hook_issues(draft, checkpoint, context))
    issues = _deduplicate_issues(issues)[:50]
    blocking_count = sum(
        issue.severity == ContinuityQCIssueSeverity.blocking for issue in issues
    )
    warning_count = sum(
        issue.severity == ContinuityQCIssueSeverity.warning for issue in issues
    )
    return ContinuityQCReport(
        status=(
            ContinuityQCStatus.blocked
            if blocking_count
            else ContinuityQCStatus.warnings
            if warning_count
            else ContinuityQCStatus.passed
        ),
        checked_through_episode_number=_optional_int(
            checkpoint.get("through_episode_number")
        ),
        current_episode_number=context.episode_number,
        issues=issues,
        blocking_issue_count=blocking_count,
        warning_count=warning_count,
    )


def _character_issues(
    draft: DraftMasterScript,
    checkpoint: dict[str, Any],
    aliases_by_entity: dict[str, list[str]],
) -> list[ContinuityQCIssue]:
    issues: list[ContinuityQCIssue] = []
    updates_by_name = {
        _normalize(update.character_name): update
        for update in draft.character_state_updates
    }
    for state in _records(checkpoint.get("character_states")):
        entity_key = str(state.get("character_ref", "")).strip()
        if not entity_key:
            continue
        aliases = _entity_aliases(entity_key, state, aliases_by_entity)
        entity_name = aliases[0] if aliases else entity_key
        active_scenes = _active_character_scenes(draft, aliases)
        update = next(
            (
                updates_by_name[name]
                for name in (_normalize(alias) for alias in aliases)
                if name in updates_by_name
            ),
            None,
        )
        if state.get("life_status") == "dead":
            if active_scenes:
                issues.append(_issue(
                    issue_type=ContinuityQCIssueType.dead_character_action,
                    severity=ContinuityQCIssueSeverity.blocking,
                    entity_key=entity_key,
                    entity_name=entity_name,
                    summary=f"{entity_name}已经死亡，却在本集当前时间线继续行动或说话。",
                    prior_state="life_status=dead",
                    current_evidence="；".join(text for _, text in active_scenes)[:500],
                    prior_episode_number=_optional_int(state.get("last_updated_episode")),
                    scene_numbers=[number for number, _ in active_scenes],
                    suggested_action="删除当前时间线行动，或明确改成回忆、录像、录音等非当前时间线内容。",
                ))
            if update is not None and update.life_status not in {None, "dead"}:
                issues.append(_issue(
                    issue_type=ContinuityQCIssueType.dead_character_revived,
                    severity=ContinuityQCIssueSeverity.blocking,
                    entity_key=entity_key,
                    entity_name=entity_name,
                    summary=f"{entity_name}的死亡状态被改成了{update.life_status}。",
                    prior_state="life_status=dead",
                    current_evidence=f"本集人物状态 life_status={update.life_status}",
                    prior_episode_number=_optional_int(state.get("last_updated_episode")),
                    scene_numbers=list(update.evidence_scene_numbers),
                    suggested_action="保持死亡状态；若故事规则允许复活，应先在总纲和世界规则中建立明确机制。",
                ))

        restrictions = [
            value
            for value in _string_list(state.get("action_capabilities"))
            + _string_list(state.get("active_constraints"))
            if any(marker in value.casefold() for marker in _CAPABILITY_RESTRICTION_MARKERS)
        ]
        if restrictions and active_scenes and state.get("life_status") != "dead":
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.capability_conflict,
                severity=ContinuityQCIssueSeverity.warning,
                entity_key=entity_key,
                entity_name=entity_name,
                summary=f"{entity_name}本集有行动，请核对是否超出既有行动能力。",
                prior_state="；".join(restrictions)[:500],
                current_evidence="；".join(text for _, text in active_scenes)[:500],
                prior_episode_number=_optional_int(state.get("last_updated_episode")),
                scene_numbers=[number for number, _ in active_scenes],
                suggested_action="确认动作符合伤病、残疾、束缚或昏迷状态；如已恢复，应在本集给出可见原因和状态更新。",
            ))

        if update is not None:
            prior_knowledge = {
                str(item.get("knowledge_key")): item
                for item in _records(state.get("knowledge_states"))
            }
            for current in update.knowledge_states or []:
                prior = prior_knowledge.get(current.knowledge_key)
                if (
                    prior
                    and prior.get("status") in {"disproved", "forgotten"}
                    and current.status in {"known", "believed"}
                    and current.statement not in update.knowledge_changes
                ):
                    issues.append(_issue(
                        issue_type=ContinuityQCIssueType.knowledge_conflict,
                        severity=ContinuityQCIssueSeverity.blocking,
                        entity_key=entity_key,
                        entity_name=entity_name,
                        summary=f"{entity_name}对信息 {current.knowledge_key} 的认知状态发生跳变。",
                        prior_state=(
                            f"{prior.get('statement', '')}[{prior.get('status', '')}]"
                        ),
                        current_evidence=f"{current.statement}[{current.status}]",
                        prior_episode_number=_optional_int(state.get("last_updated_episode")),
                        scene_numbers=list(update.evidence_scene_numbers),
                        suggested_action="补充重新得知或恢复记忆的可见剧情证据，或保持原认知状态。",
                    ))
    return issues


def _story_line_issues(
    draft: DraftMasterScript,
    checkpoint: dict[str, Any],
    context: EpisodeGenerationContext,
) -> list[ContinuityQCIssue]:
    issues: list[ContinuityQCIssue] = []
    known_states = {
        str(item.get("story_line_id", "")).strip(): item
        for item in _records(checkpoint.get("story_line_states"))
        if str(item.get("story_line_id", "")).strip()
    }
    planned_refs = {
        value.strip() for value in context.planned_story_line_refs if value.strip()
    }
    scheduled_refs = {duty.story_line_id for duty in context.storyline_duties}
    updates = {update.story_line_id: update for update in draft.story_line_updates}

    if known_states:
        for story_line_id, update in updates.items():
            if story_line_id in known_states or story_line_id in scheduled_refs:
                continue
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.unknown_story_line,
                severity=ContinuityQCIssueSeverity.warning,
                entity_key=story_line_id,
                entity_name=story_line_id,
                summary=f"本集推进了未在已批准总纲中登记的故事线 {story_line_id}。",
                prior_state="已批准故事线账本中不存在该标识。",
                current_evidence=update.progress_summary,
                prior_episode_number=None,
                scene_numbers=list(update.evidence_scene_numbers),
                suggested_action="改用本集规划中的故事线 ID，或先回到总纲正式新增该故事线。",
            ))

    if not context.storyline_duties:
        for story_line_id in sorted(planned_refs - updates.keys()):
            state = known_states.get(story_line_id, {})
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.missing_planned_story_line_progress,
                severity=ContinuityQCIssueSeverity.warning,
                entity_key=story_line_id,
                entity_name=story_line_id,
                summary=f"本集规划要求推进 {story_line_id}，但正文没有提供可验证的推进记录。",
                prior_state=str(state.get("current_state") or "本集规划明确要求推进该故事线。")[:500],
                current_evidence="story_line_updates 中缺少该故事线及其场景证据。",
                prior_episode_number=_optional_int(state.get("last_progressed_episode")),
                scene_numbers=[],
                suggested_action="让正文通过可见事件推进该线，并补充 progress_summary、原因和证据场次。",
            ))

    for story_line_id, update in updates.items():
        if update.planned_alignment == "deviated":
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.story_line_plan_deviation,
                severity=ContinuityQCIssueSeverity.warning,
                entity_key=story_line_id,
                entity_name=story_line_id,
                summary=f"{story_line_id} 的本集实际剧情偏离了批准规划。",
                prior_state=context.planned_story_beat or "本集批准的剧情职责。",
                current_evidence=(
                    update.alignment_note or update.progress_summary
                )[:500],
                prior_episode_number=_optional_int(
                    known_states.get(story_line_id, {}).get("last_progressed_episode")
                ),
                scene_numbers=list(update.evidence_scene_numbers),
                suggested_action="核对偏离是否必要；若保留，应更新剧情规划，不能让偏离长期处于未批准状态。",
            ))
        if update.status == "resolved" and planned_refs and story_line_id not in planned_refs:
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.premature_story_line_resolution,
                severity=ContinuityQCIssueSeverity.warning,
                entity_key=story_line_id,
                entity_name=story_line_id,
                summary=f"{story_line_id} 在本集未被规划推进，却被标记为已经解决。",
                prior_state=str(
                    known_states.get(story_line_id, {}).get("current_state")
                    or "此前尚未完成批准收束。"
                )[:500],
                current_evidence=update.progress_summary,
                prior_episode_number=_optional_int(
                    known_states.get(story_line_id, {}).get("last_progressed_episode")
                ),
                scene_numbers=list(update.evidence_scene_numbers),
                suggested_action="恢复原状态，或把该收束正式加入本集规划并写出完整可见因果。",
            ))
    return issues


def _storyline_duty_issues(
    draft: DraftMasterScript,
    checkpoint: dict[str, Any],
    context: EpisodeGenerationContext,
) -> list[ContinuityQCIssue]:
    """Verify scene-level evidence for the optional storyline duty schedule.

    The legacy planned-ref checks remain above for old payloads. This stricter
    path only runs when a new schedule is present, so persisted episodes and
    requests created before the scheduler remain valid.
    """
    duties = context.storyline_duties
    if not duties:
        return []
    scenes_by_number = {scene.scene_number: scene for scene in draft.scenes}
    updates_by_id = {update.story_line_id: update for update in draft.story_line_updates}
    known_states = {
        str(item.get("story_line_id", "")).strip(): item
        for item in _records(checkpoint.get("story_line_states"))
        if str(item.get("story_line_id", "")).strip()
    }
    issues: list[ContinuityQCIssue] = []
    for duty in duties:
        duty_id = duty.story_line_id
        update = updates_by_id.get(duty_id)
        assigned = set(duty.assigned_scene_numbers)
        valid_assigned = assigned.intersection(scenes_by_number)
        if duty.must_progress:
            if not valid_assigned:
                issues.append(_issue(
                    issue_type=ContinuityQCIssueType.storyline_duty_scene_mismatch,
                    severity=ContinuityQCIssueSeverity.blocking,
                    entity_key=duty_id,
                    entity_name=duty_id,
                    summary=f"故事线职责 {duty_id} 没有对应的有效场景分配。",
                    prior_state=duty.required_progress,
                    current_evidence="assigned_scene_numbers 不存在于本集正文场景。",
                    prior_episode_number=duty.last_progressed_episode,
                    scene_numbers=sorted(assigned),
                    suggested_action="为该职责分配本集真实场景，并在场景中完成可见推进。",
                ))
            if update is None:
                issues.append(_issue(
                    issue_type=ContinuityQCIssueType.missing_storyline_duty_progress,
                    severity=ContinuityQCIssueSeverity.blocking,
                    entity_key=duty_id,
                    entity_name=duty_id,
                    summary=f"本集强制故事线职责 {duty_id} 没有状态推进记录。",
                    prior_state=duty.required_progress,
                    current_evidence="story_line_updates 中没有对应记录。",
                    prior_episode_number=duty.last_progressed_episode,
                    scene_numbers=sorted(valid_assigned),
                    suggested_action="通过可见动作和结果推进该线，并写入对应场景证据。",
                ))
                continue
            evidence = set(update.evidence_scene_numbers)
            if not evidence or not evidence.issubset(valid_assigned):
                issues.append(_issue(
                    issue_type=ContinuityQCIssueType.storyline_duty_scene_mismatch,
                    severity=ContinuityQCIssueSeverity.blocking,
                    entity_key=duty_id,
                    entity_name=duty_id,
                    summary=f"故事线职责 {duty_id} 的状态记录没有落在指定场景内。",
                    prior_state=duty.required_progress,
                    current_evidence=(update.progress_summary or "未提供推进摘要")[:500],
                    prior_episode_number=duty.last_progressed_episode,
                    scene_numbers=sorted(evidence),
                    suggested_action="让 evidence_scene_numbers 与 assigned_scene_numbers 一致，并在这些场景完成推进。",
                ))
            unsupported = [
                scene_number
                for scene_number in sorted(evidence.intersection(valid_assigned))
                if not _storyline_scene_has_evidence(scenes_by_number[scene_number], update)
            ]
            if unsupported:
                issues.append(_issue(
                    issue_type=ContinuityQCIssueType.storyline_duty_unsupported_evidence,
                    severity=ContinuityQCIssueSeverity.blocking,
                    entity_key=duty_id,
                    entity_name=duty_id,
                    summary=f"故事线职责 {duty_id} 只有账本记录，没有匹配的场景动作或状态变化。",
                    prior_state=duty.required_progress,
                    current_evidence=update.progress_summary[:500],
                    prior_episode_number=duty.last_progressed_episode,
                    scene_numbers=unsupported,
                    suggested_action="在指定场景加入改变人物处境、信息或关系的可见动作，并让场景结果与推进摘要一致。",
                ))
            prior_state = str(known_states.get(duty_id, {}).get("current_state") or "").strip()
            if prior_state and _normalize_storyline_text(prior_state) == _normalize_storyline_text(
                update.progress_summary
            ):
                issues.append(_issue(
                    issue_type=ContinuityQCIssueType.missing_storyline_duty_progress,
                    severity=ContinuityQCIssueSeverity.blocking,
                    entity_key=duty_id,
                    entity_name=duty_id,
                    summary=f"故事线职责 {duty_id} 的记录没有产生新的状态变化。",
                    prior_state=prior_state[:500],
                    current_evidence=update.progress_summary[:500],
                    prior_episode_number=duty.last_progressed_episode,
                    scene_numbers=sorted(evidence),
                    suggested_action="让本集改变该故事线的目标、信息、关系或处境，并更新 current_state 摘要。",
                ))
        elif not duty.can_defer or duty.defer_until_episode is None or not duty.defer_reason:
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.missing_storyline_duty_progress,
                severity=ContinuityQCIssueSeverity.warning,
                entity_key=duty_id,
                entity_name=duty_id,
                summary=f"故事线 {duty_id} 被延期但没有完整的延期说明。",
                prior_state=duty.required_progress,
                current_evidence=duty.defer_reason or "缺少 defer_until_episode/defer_reason。",
                prior_episode_number=duty.last_progressed_episode,
                scene_numbers=[],
                suggested_action="明确延期到哪一集以及为什么本集暂不推进，避免支线无声遗忘。",
            ))
    return issues


def _storyline_scene_has_evidence(scene: Any, update: Any) -> bool:
    """Require more than an update row: scene text must carry a causal trace."""
    action_values = [value for value in scene.character_actions if value]
    if not action_values:
        return False
    values = [
        scene.purpose,
        scene.beat_summary,
        scene.turning_point or "",
        scene.scene_causality.outcome if scene.scene_causality else "",
        *action_values,
    ]
    normalized_values = " ".join(value.casefold() for value in values if value)
    summary_tokens = _storyline_evidence_tokens(update.progress_summary)
    cause_tokens = _storyline_evidence_tokens(update.change_cause)
    # A matching phrase in the scene's visible/cause text is required. Merely
    # returning a well-formed scene_causality object must not satisfy a duty.
    if update.progress_summary.casefold() in normalized_values:
        return True
    summary_matches = sum(
        token in normalized_values for token in summary_tokens[:8]
    )
    cause_matches = sum(
        token in normalized_values for token in cause_tokens[:8]
    )
    return summary_matches >= (1 if len(summary_tokens) <= 2 else 2) or cause_matches >= 2


def _storyline_evidence_tokens(value: str) -> list[str]:
    tokens: list[str] = []
    for chunk in re.findall(r"[A-Za-z0-9_]{3,}|[\u4e00-\u9fff]{2,}", value.casefold()):
        if re.fullmatch(r"[\u4e00-\u9fff]+", chunk):
            tokens.extend(chunk[index:index + 2] for index in range(len(chunk) - 1))
        else:
            tokens.append(chunk)
    return list(dict.fromkeys(tokens))


def _normalize_storyline_text(value: str) -> str:
    return re.sub(r"\s+", "", value.casefold()).strip("，。；;,.、:：")


def _hook_issues(
    draft: DraftMasterScript,
    checkpoint: dict[str, Any],
    context: EpisodeGenerationContext,
) -> list[ContinuityQCIssue]:
    issues: list[ContinuityQCIssue] = []
    hook_state = draft.continuation_hook
    open_hooks = _records(
        checkpoint.get("open_setup_payoffs") or checkpoint.get("setup_payoffs")
    )
    open_by_episode = {
        episode: item
        for item in open_hooks
        if str(item.get("setup_payoff_id", "")).startswith("hook.")
        if (episode := _optional_int(item.get("setup_episode"))) is not None
        and str(item.get("status", "setup")) not in {"paid_off", "dropped"}
    }
    has_response = bool(
        hook_state is not None and hook_state.previous_hook_response
    )
    response_episode = hook_state.responds_to_episode if hook_state else None
    if has_response and response_episode is None and open_by_episode:
        response_episode = max(open_by_episode)

    if context.previous_episode_question and not has_response:
        issues.append(_issue(
            issue_type=ContinuityQCIssueType.missing_hook_response,
            severity=ContinuityQCIssueSeverity.warning,
            entity_key=f"hook.episode_{max(1, context.episode_number - 1):04d}",
            entity_name="上一集追看点",
            summary="本集没有记录对上一集结尾承诺的可见回应。",
            prior_state=context.previous_episode_question,
            current_evidence="continuation_hook.previous_hook_response 为空。",
            prior_episode_number=max(1, context.episode_number - 1),
            scene_numbers=[],
            suggested_action="在前两个场景中用行动回应上一集问题，并记录回应摘要和证据场次。",
        ))

    if response_episode is not None and open_by_episode and response_episode not in open_by_episode:
        issues.append(_issue(
            issue_type=ContinuityQCIssueType.unknown_hook_response,
            severity=ContinuityQCIssueSeverity.warning,
            entity_key=f"hook.episode_{response_episode:04d}",
            entity_name=f"第{response_episode}集追看点",
            summary=f"本集声称兑现第{response_episode}集追看点，但账本中没有对应待兑现记录。",
            prior_state="追看点账本中不存在该来源集数。",
            current_evidence=(hook_state.previous_hook_response if hook_state else "未提供回应")[:500],
            prior_episode_number=response_episode,
            scene_numbers=(
                list(hook_state.response_evidence_scene_numbers) if hook_state else []
            ),
            suggested_action="修正 responds_to_episode，确保回应绑定到真实存在的追看点。",
        ))

    for setup_episode, item in open_by_episode.items():
        target_episode = _optional_int(item.get("target_payoff_episode"))
        if (
            target_episode is None
            or target_episode > context.episode_number
            or response_episode == setup_episode
        ):
            continue
        issues.append(_issue(
            issue_type=ContinuityQCIssueType.overdue_hook,
            severity=ContinuityQCIssueSeverity.warning,
            entity_key=f"hook.episode_{setup_episode:04d}",
            entity_name=f"第{setup_episode}集追看点",
            summary=f"第{setup_episode}集追看点已超过计划兑现集数 {target_episode}，本集仍未回应。",
            prior_state=str(item.get("description") or "待兑现追看点")[:500],
            current_evidence=f"当前已生成至第{context.episode_number}集。",
            prior_episode_number=setup_episode,
            scene_numbers=[],
            suggested_action="尽快安排可见回收；若剧情计划已经改变，应显式调整目标集数。",
        ))
    return issues


def _setup_payoff_issues(
    draft: DraftMasterScript,
    checkpoint: dict[str, Any],
    context: EpisodeGenerationContext,
) -> list[ContinuityQCIssue]:
    issues: list[ContinuityQCIssue] = []
    ledger_records = {
        str(item.get("setup_payoff_id", "")).strip(): item
        for item in _records(
            checkpoint.get("open_setup_payoffs") or checkpoint.get("setup_payoffs")
        )
        if str(item.get("setup_payoff_id", "")).strip()
        and not str(item.get("setup_payoff_id", "")).startswith("hook.")
    }
    updates = {
        update.setup_payoff_ref: update for update in draft.setup_payoff_updates
    }
    planned_setups = {value.strip() for value in context.planned_setup_refs if value.strip()}
    planned_payoffs = {value.strip() for value in context.planned_payoff_refs if value.strip()}

    for setup_ref in sorted(planned_setups):
        update = updates.get(setup_ref)
        if update is not None and update.action in {"setup", "reinforce"}:
            continue
        issues.append(_issue(
            issue_type=ContinuityQCIssueType.missing_planned_setup,
            severity=ContinuityQCIssueSeverity.warning,
            entity_key=setup_ref,
            entity_name=setup_ref,
            summary=f"本集规划要求铺设或强化伏笔 {setup_ref}，但正文没有可验证记录。",
            prior_state="本集规划包含该 setup_ref。",
            current_evidence=(
                update.progress_summary if update else "setup_payoff_updates 中缺少该引用。"
            ),
            prior_episode_number=None,
            scene_numbers=list(update.evidence_scene_numbers) if update else [],
            suggested_action="在场景中实际植入或强化该信息，并记录具体原因与证据场次。",
        ))

    for payoff_ref in sorted(planned_payoffs):
        update = updates.get(payoff_ref)
        if update is not None and update.action in {"partial_payoff", "payoff"}:
            continue
        issues.append(_issue(
            issue_type=ContinuityQCIssueType.missing_planned_payoff,
            severity=ContinuityQCIssueSeverity.warning,
            entity_key=payoff_ref,
            entity_name=payoff_ref,
            summary=f"本集规划要求回收伏笔 {payoff_ref}，但正文没有完成对应回收。",
            prior_state=str(
                ledger_records.get(payoff_ref, {}).get("description")
                or "本集规划包含该 payoff_ref。"
            )[:500],
            current_evidence=(
                update.progress_summary if update else "setup_payoff_updates 中缺少该引用。"
            ),
            prior_episode_number=_optional_int(
                ledger_records.get(payoff_ref, {}).get("setup_episode")
            ),
            scene_numbers=list(update.evidence_scene_numbers) if update else [],
            suggested_action="用可见事件完成部分或全部答案，并明确剩余义务，不能只在对白中口头宣布。",
        ))

    planned_refs = planned_setups | planned_payoffs
    for setup_ref, update in updates.items():
        if setup_ref not in planned_refs and setup_ref not in ledger_records:
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.unknown_setup_payoff,
                severity=ContinuityQCIssueSeverity.warning,
                entity_key=setup_ref,
                entity_name=setup_ref,
                summary=f"本集新增了未在规划或既有账本中登记的伏笔引用 {setup_ref}。",
                prior_state="规划和伏笔账本中均不存在该引用。",
                current_evidence=update.progress_summary,
                prior_episode_number=None,
                scene_numbers=list(update.evidence_scene_numbers),
                suggested_action="改用批准的 setup/payoff ref，或先在剧情规划中登记新伏笔。",
            ))
        if update.action == "payoff" and setup_ref not in ledger_records:
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.setup_payoff_plan_deviation,
                severity=ContinuityQCIssueSeverity.warning,
                entity_key=setup_ref,
                entity_name=setup_ref,
                summary=f"{setup_ref} 被标记为完整回收，但此前账本没有记录其铺设过程。",
                prior_state="没有可追溯的既有 setup 记录。",
                current_evidence=update.progress_summary,
                prior_episode_number=None,
                scene_numbers=list(update.evidence_scene_numbers),
                suggested_action="确认此前确实已经铺设；若没有，应改为 setup 或 partial_payoff，并补齐规划。",
            ))
        if update.action == "defer":
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.setup_payoff_plan_deviation,
                severity=ContinuityQCIssueSeverity.warning,
                entity_key=setup_ref,
                entity_name=setup_ref,
                summary=f"{setup_ref} 的计划动作被推迟。",
                prior_state="本集规划要求处理该伏笔。",
                current_evidence=update.progress_summary,
                prior_episode_number=_optional_int(
                    ledger_records.get(setup_ref, {}).get("setup_episode")
                ),
                scene_numbers=list(update.evidence_scene_numbers),
                suggested_action="确认推迟不会破坏后续因果，并同步调整目标回收集数。",
            ))
    return issues


def _world_state_issues(
    draft: DraftMasterScript,
    checkpoint: dict[str, Any],
    aliases_by_entity: dict[str, list[str]],
) -> list[ContinuityQCIssue]:
    issues: list[ContinuityQCIssue] = []
    canonical_by_alias = {
        (str(item.get("entity_type", "")), _normalize(str(item.get("alias", "")))):
            str(item.get("canonical_entity_key", ""))
        for item in _records(checkpoint.get("entity_aliases"))
    }
    updates: dict[tuple[str, str], Any] = {}
    for update in draft.continuity_state_updates:
        canonical = canonical_by_alias.get(
            (update.entity_type, _normalize(update.entity_name)),
            update.entity_key,
        )
        updates[(canonical, update.state_domain)] = update

    for state in _records(checkpoint.get("world_states")):
        entity_key = str(state.get("entity_key", "")).strip()
        state_domain = str(state.get("state_domain", "")).strip()
        if not entity_key or not state_domain:
            continue
        entity_name = str(state.get("entity_name") or entity_key)
        transition = str(state.get("last_transition", ""))
        current_state = str(state.get("current_state", ""))
        update = updates.get((entity_key, state_domain))
        if (
            update is not None
            and state.get("persistence") == "permanent"
            and update.current_state != current_state
            and not _allowed_lifecycle_transition(transition, update.transition)
        ):
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.irreversible_state_conflict,
                severity=ContinuityQCIssueSeverity.blocking,
                entity_key=entity_key,
                entity_name=entity_name,
                summary=f"{entity_name}的永久状态被无解释覆盖。",
                prior_state=f"{transition}: {current_state}",
                current_evidence=f"{update.transition}: {update.current_state}",
                prior_episode_number=_optional_int(state.get("evidence_episode_number")),
                scene_numbers=list(update.evidence_scene_numbers),
                suggested_action="保持原状态，或使用恢复、修复、重新获得等明确转换并在场景中提供证据。",
            ))

        if transition not in {"destroyed", "lost", "transferred"}:
            continue
        if update is not None and _allowed_lifecycle_transition(
            transition, update.transition
        ):
            continue
        if update is not None and state.get("persistence") != "permanent":
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.unavailable_entity_usage,
                severity=ContinuityQCIssueSeverity.blocking,
                entity_key=entity_key,
                entity_name=entity_name,
                summary=f"{entity_name}此前已{_transition_label(transition)}，本集状态更新却没有交代恢复过程。",
                prior_state=f"{transition}: {current_state}",
                current_evidence=f"{update.transition}: {update.current_state}",
                prior_episode_number=_optional_int(state.get("evidence_episode_number")),
                scene_numbers=list(update.evidence_scene_numbers),
                suggested_action="先用找回、修复、替换或重新取得等明确转换恢复可用状态，并在场景中提供证据。",
            ))
            continue
        aliases = _entity_aliases(entity_key, state, aliases_by_entity)
        usage_scenes = _entity_usage_scenes(draft, aliases)
        if usage_scenes:
            issues.append(_issue(
                issue_type=ContinuityQCIssueType.unavailable_entity_usage,
                severity=ContinuityQCIssueSeverity.warning,
                entity_key=entity_key,
                entity_name=entity_name,
                summary=f"{entity_name}此前已{_transition_label(transition)}，本集动作中再次出现。",
                prior_state=f"{transition}: {current_state}",
                current_evidence="；".join(text for _, text in usage_scenes)[:500],
                prior_episode_number=_optional_int(state.get("evidence_episode_number")),
                scene_numbers=[number for number, _ in usage_scenes],
                suggested_action="确认只是提及旧状态；如实际再次使用，应先写出找回、修复、替换或重新取得的过程。",
            ))
    return issues


def _active_character_scenes(
    draft: DraftMasterScript,
    aliases: list[str],
) -> list[tuple[int, str]]:
    normalized_aliases = {_normalize(alias) for alias in aliases if alias}
    evidence: list[tuple[int, str]] = []
    for scene in draft.scenes:
        if _is_non_current_timeline_scene(scene):
            continue
        scene_evidence = [
            action for action in scene.character_actions
            if any(_normalize(alias) in _normalize(action) for alias in aliases if alias)
        ]
        scene_evidence.extend(
            f"{line.character_name}：{line.text}"
            for line in scene.dialogues
            if _normalize(line.character_name) in normalized_aliases
        )
        if scene_evidence:
            evidence.append((scene.scene_number, " / ".join(scene_evidence)[:300]))
    return evidence


def _entity_usage_scenes(
    draft: DraftMasterScript,
    aliases: list[str],
) -> list[tuple[int, str]]:
    evidence: list[tuple[int, str]] = []
    for scene in draft.scenes:
        matching = [
            action for action in scene.character_actions
            if any(_normalize(alias) in _normalize(action) for alias in aliases if alias)
        ]
        if matching:
            evidence.append((scene.scene_number, " / ".join(matching)[:300]))
    return evidence


def _is_non_current_timeline_scene(scene: Any) -> bool:
    context = " ".join(
        str(value)
        for value in (
            scene.slug,
            scene.purpose,
            scene.setting_hint,
            scene.beat_summary,
        )
        if value
    ).casefold()
    return any(marker in context for marker in _NON_CURRENT_TIMELINE_MARKERS)


def _aliases_by_entity(checkpoint: dict[str, Any]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for item in _records(checkpoint.get("entity_aliases")):
        canonical = str(item.get("canonical_entity_key", "")).strip()
        alias = str(item.get("alias", "")).strip()
        if canonical and alias:
            result.setdefault(canonical, []).append(alias)
    return result


def _entity_aliases(
    entity_key: str,
    state: dict[str, Any],
    aliases_by_entity: dict[str, list[str]],
) -> list[str]:
    values = [
        *aliases_by_entity.get(entity_key, []),
        *_string_list(state.get("aliases")),
        str(state.get("entity_name", "")).strip(),
    ]
    return list(dict.fromkeys(value for value in values if value))


def _allowed_lifecycle_transition(previous: str, current: str) -> bool:
    allowed = {
        "destroyed": {"repaired", "recovered"},
        "lost": {"acquired", "recovered"},
        "transferred": {"acquired", "transferred", "recovered"},
        "died": set(),
    }
    return current in allowed.get(previous, {current})


def _transition_label(value: str) -> str:
    return {
        "destroyed": "毁坏",
        "lost": "丢失",
        "transferred": "转移",
    }.get(value, value)


def _issue(
    *,
    issue_type: ContinuityQCIssueType,
    severity: ContinuityQCIssueSeverity,
    entity_key: str,
    entity_name: str,
    summary: str,
    prior_state: str,
    current_evidence: str,
    prior_episode_number: int | None,
    scene_numbers: list[int],
    suggested_action: str,
) -> ContinuityQCIssue:
    signature = "\0".join((issue_type.value, entity_key, ",".join(map(str, scene_numbers))))
    return ContinuityQCIssue(
        issue_id=f"continuity_issue.{hashlib.sha256(signature.encode()).hexdigest()[:20]}",
        issue_type=issue_type,
        severity=severity,
        entity_key=entity_key,
        entity_name=entity_name,
        summary=summary,
        prior_state=prior_state,
        current_evidence=current_evidence,
        prior_episode_number=prior_episode_number,
        scene_numbers=list(dict.fromkeys(scene_numbers)),
        suggested_action=suggested_action,
    )


def _deduplicate_issues(issues: list[ContinuityQCIssue]) -> list[ContinuityQCIssue]:
    return list({issue.issue_id: issue for issue in issues}.values())


def _records(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _optional_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _normalize(value: str) -> str:
    return "".join(value.split()).casefold()
