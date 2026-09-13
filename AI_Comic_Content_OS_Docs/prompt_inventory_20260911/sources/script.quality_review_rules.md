# 戏剧证据本地检查说明

编号：`script.quality_review_rules`。状态：`本地规则，非LLM提示词`。

来源：[backend/app/modules/script_engine/episode_quality_review.py:73](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/episode_quality_review.py:73)。符号：`review_episode_dramatic_evidence`。

纳入附录用于解释检查边界；审阅信号，不评分、不阻断，关键词不证明语义。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 149 行

````text
has_distinct_choice_and_consequence_evidence
````

### 片段 2 · 源码第 212 行

````text
dramatic_unit_evidence_missing
````

### 片段 3 · 源码第 214 行

````text
protagonist_cost_evidence_missing
````

### 片段 4 · 源码第 222 行

````text
segmented_change_evidence_missing
````

### 片段 5 · 源码第 226 行

````text
分段检查按正文顺序提供位置型信号，不能替代编导对段落功能的判断。
````

### 片段 6 · 源码第 230 行

````text
对白功能来自有限关键词，只用于定位重复风险，不能证明对白的真实功能。
````

### 片段 7 · 源码第 255 行

````text
evidence_match_limit_per_field
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
def review_episode_dramatic_evidence(
    draft: DraftMasterScript,
    approved_episode_plan: Any | None = None,
) -> dict[str, Any]:
    """Return bounded review signals for a generated episode.

    Planning summaries are never used as body evidence. A text match means only
    that an editor has a useful place to inspect; it is not semantic proof.
    """

    plan = approved_episode_plan
    units = list(_plan_value(plan, "dramatic_units") or [])
    protagonist_cost = str(_plan_value(plan, "protagonist_cost") or "").strip()
    has_optional_design = bool(units or protagonist_cost)

    scenes = list(draft.scenes)
    scene_body = {
        scene.scene_number: _scene_body_entries(scene)
        for scene in scenes
    }
    unit_reviews: list[dict[str, Any]] = []
    unit_candidate_refs: dict[int, set[_EvidenceRef]] = {}
    for index, unit in enumerate(units):
        trigger = str(_plan_value(unit, "trigger") or "").strip()
        choice = str(_plan_value(unit, "choice") or "").strip()
        consequence = str(_plan_value(unit, "visible_consequence") or "").strip()
        evidence_hint = str(_plan_value(unit, "evidence_hint") or "").strip()
        choice_evidence, choice_evidence_total, choice_refs = _find_body_evidence(
            scene_body,
            choice,
        )
        (
            consequence_evidence,
            consequence_evidence_total,
            consequence_refs,
        ) = _find_body_evidence(
            scene_body,
            consequence,
        )
        hint_evidence, hint_evidence_total, hint_refs = _find_body_evidence(
            scene_body,
            evidence_hint,
        )
        has_distinct_evidence = _has_distinct_evidence(
            choice_refs,
            consequence_refs,
        )
        unit_candidate_refs[index] = choice_refs | consequence_refs | hint_refs
        candidates = sorted({
            evidence["scene_number"]
            for evidence in (
                *choice_evidence,
                *consequence_evidence,
                *hint_evidence,
            )
        })
        unit_reviews.append({
            "unit_index": index,
            "trigger": trigger,
            "choice": choice,
            "visible_consequence": consequence,
            "evidence_hint": evidence_hint or None,
            "candidate_scene_numbers": candidates,
            "choice_evidence": choice_evidence,
            "choice_evidence_total": choice_evidence_total,
            "consequence_evidence": consequence_evidence,
            "consequence_evidence_total": consequence_evidence_total,
            "evidence_hint_matches": hint_evidence,
            "evidence_hint_match_total": hint_evidence_total,
            "evidence_matches_truncated": any(
                (
                    choice_evidence_total > len(choice_evidence),
                    consequence_evidence_total > len(consequence_evidence),
                    hint_evidence_total > len(hint_evidence),
                )
            ),
            "has_distinct_choice_and_consequence_evidence": has_distinct_evidence,
            "status": (
                "candidate_found" if has_distinct_evidence else "review_required"
            ),
            "matching_is_semantic_proof": False,
        })

    cost_evidence, cost_evidence_total, _ = _find_body_evidence(
        scene_body,
        protagonist_cost,
    )
    cost_review = {
        "planned_cost": protagonist_cost or None,
        "candidate_scene_numbers": sorted({
            evidence["scene_number"] for evidence in cost_evidence
        }),
        "evidence": cost_evidence,
        "evidence_total": cost_evidence_total,
        "evidence_truncated": cost_evidence_total > len(cost_evidence),
        "status": (
            "not_provided"
            if not protagonist_cost
            else "candidate_found"
            if cost_evidence
            else "review_required"
        ),
        "matching_is_semantic_proof": False,
    }

    scene_reviews = [
        {
            "scene_number": scene.scene_number,
            "observable_action_count": len(scene.character_actions),
            "has_scene_outcome": bool(
                scene.scene_causality and scene.scene_causality.outcome.strip()
            ),
            "has_body_evidence": bool(scene_body[scene.scene_number]),
            "has_visible_change_candidate": _has_visible_change_candidate(scene),
        }
        for scene in scenes
    ]
    production_review = _production_count_review(draft)
    dialogue_review = _dialogue_function_review(draft)
    segmented_review = _segmented_change_review(
        draft,
        unit_candidate_refs,
    )
    missing_units = sum(
        review["status"] == "review_required" for review in unit_reviews
    )
    visible_change_missing = not any(
        item["has_visible_change_candidate"] for item in scene_reviews
    )
    cost_missing = cost_review["status"] == "review_required"
    design_evidence_status = (
        "not_applicable"
        if not has_optional_design
        else "review_required"
        if missing_units or cost_missing
        else "review_signal_ready"
    )
    review_reasons: list[str] = []
    if missing_units:
        review_reasons.append("dramatic_unit_evidence_missing")
    if cost_missing:
        review_reasons.append("protagonist_cost_evidence_missing")
    if visible_change_missing:
        review_reasons.append("visible_scene_change_missing")
    if production_review["status"] == "warning":
        review_reasons.append("production_count_out_of_range")
    if dialogue_review["status"] == "warning":
        review_reasons.append("dialogue_function_warning")
    if segmented_review["status"] == "review_required":
        review_reasons.append("segmented_change_evidence_missing")
    limitations = [
        "文本候选匹配不能证明人物选择造成了可见后果。",
        (
            "分段检查按正文顺序提供位置型信号，"
            "不能替代编导对段落功能的判断。"
        ),
        (
            "对白功能来自有限关键词，只用于定位重复风险，"
            "不能证明对白的真实功能。"
        ),
        "本报告是编导审阅信号，不是质量评分，也不阻断正文保存。",
    ]
    if not has_optional_design:
        limitations.insert(
            0,
            "没有本集戏剧单位或人物代价设计，已跳过设计证据审阅。",
        )
    return {
        "schema_version": "episode_quality_review.v1",
        "status": "review_required" if review_reasons else "review_signal_ready",
        "review_reasons": review_reasons,
        "design_evidence_status": design_evidence_status,
        "dramatic_unit_count": len(units),
        "candidate_unit_count": len(units) - missing_units,
        "review_required_unit_count": missing_units,
        "protagonist_cost": protagonist_cost or None,
        "protagonist_cost_review": cost_review,
        "unit_reviews": unit_reviews,
        "scene_reviews": scene_reviews,
        "production_count_review": production_review,
        "dialogue_function_review": dialogue_review,
        "segmented_change_review": segmented_review,
        "evidence_match_limit_per_field": _MAX_EVIDENCE_MATCHES_PER_FIELD,
        "limitations": limitations,
    }
````

片段 SHA-256：`194f50eb64f406ee7091bd14776faafb4a2de6253cc31b6bd352552b24bed051`
