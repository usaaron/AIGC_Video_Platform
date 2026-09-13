# 连续性本地检查入口

编号：`script.continuity_qc_rules`。状态：`本地规则，非LLM提示词`。

来源：[backend/app/modules/script_engine/continuity_qc.py:73](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/continuity_qc.py:73)。符号：`evaluate_episode_continuity`。

warning/blocking分类；blocking由生成服务触发修复，不是模型审稿提示。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
def evaluate_episode_continuity(
    draft: DraftMasterScript,
    context: EpisodeGenerationContext | None,
) -> ContinuityQCReport:
    if context is None:
        return ContinuityQCReport(
            status=ContinuityQCStatus.not_applicable,
            current_episode_number=context.episode_number if context else None,
        )
    issues = _same_episode_state_issues(draft)
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
        elif not context.storyline_duties and not issues:
            return ContinuityQCReport(
                status=ContinuityQCStatus.not_applicable,
                current_episode_number=context.episode_number,
            )
    elif not context.storyline_duties and not issues:
        return ContinuityQCReport(
            status=ContinuityQCStatus.not_applicable,
            current_episode_number=context.episode_number,
        )

    aliases_by_entity = _aliases_by_entity(checkpoint)
    issues.extend(_character_issues(draft, checkpoint, aliases_by_entity))
    issues.extend(_world_state_issues(draft, checkpoint, aliases_by_entity))
    issues.extend(_story_line_issues(draft, checkpoint, context))
    issues.extend(_storyline_duty_issues(draft, checkpoint, context))
    issues.extend(_setup_payoff_issues(draft, checkpoint, context))
    issues.extend(_hook_issues(draft, checkpoint, context))
    # The report cap must never let advisory findings displace a blocking conflict.
    issues = sorted(
        _deduplicate_issues(issues),
        key=lambda issue: issue.severity != ContinuityQCIssueSeverity.blocking,
    )[:50]
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
````

片段 SHA-256：`8496e847bbed29c410d757257ef4cc4d6b495adc26ced8e84d0e40bb368d6291`
