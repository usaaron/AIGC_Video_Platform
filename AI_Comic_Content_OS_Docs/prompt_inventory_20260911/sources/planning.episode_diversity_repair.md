# 单集局部回报与钩子去重修复

编号：`planning.episode_diversity_repair`。状态：`active_alternative_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:11869](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11869)。符号：`StoryPlanningService._build_episode_plan_item_diversity_repair_prompt`。

由单集接口的重复检查触发；分块主路径只记重复警告。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 11916 行

````text
{market_contract}

DIVERSITY-ONLY EPISODE ROADMAP REPAIR
Episode {item.episode_number} is already structurally complete and has passed all hard
continuity, reference and approved-event contracts. Rewrite only its local payoff and
ending pressure so they do not copy an earlier episode. Do not change its event chain,
outcome, character state, reference IDs or assigned source events.

Detected duplicate fields: {json.dumps(issues, ensure_ascii=False)}

Protected episode context:
{json.dumps(protected_context, ensure_ascii=False, separators=(',', ':'))}

Earlier accepted payoff and hook contracts; do not copy them:
{json.dumps(previous_contracts, ensure_ascii=False, separators=(',', ':'))}

Current editable fields:
{json.dumps(editable_fields, ensure_ascii=False, separators=(',', ':'))}

Rules:
1. Preserve the exact causal result and handoff pressure already established by the
   protected context. Do not invent a new reveal, character, location or plot branch.
1a. Rewrite episode_title only as needed to satisfy this naming contract:
{EPISODE_TITLE_NAMING_CONTRACT}
2. Make episode_payoff a distinct visible action result, not preparation or a promise.
3. For serial_hook, make cliffhanger and next_episode_obligation arise directly from this
   episode's exit state and use a story-native hook function not copied from an earlier
   episode. For season_finale or series_finale, preserve the approved formal resolution;
   do not add a false continuation hook, and use the legacy fields only to record closure
   or an explicitly approved future handoff.
4. All values must follow the market contract above. ending_hook_type must be only a short
   2-20 character classification label with no explanation.
5. Keep the repaired narrative fields within the 250-450 Chinese-character roadmap target;
   shorten repeated context instead of introducing new plot material.
6. Return only one native JSON object with exactly these six string fields:
episode_title, episode_payoff, pressure_escalation, cliffhanger, ending_hook_type,
next_episode_obligation. Do not return any other field, wrapper, Markdown or explanation.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_episode_plan_item_diversity_repair_prompt(
        *,
        node: StoryPlanNode,
        story_bible: StoryBible,
        item: EpisodePlanGenerationItem,
        accepted_plans: list[EpisodePlanGenerationItem],
        issues: list[str],
    ) -> str:
        previous_contracts = [
            {
                "episode_number": accepted.episode_number,
                "ending_mode": accepted.ending_mode.value,
                "episode_title": accepted.episode_title,
                "episode_payoff": accepted.episode_payoff,
                "pressure_escalation": accepted.pressure_escalation,
                "cliffhanger": accepted.cliffhanger,
                "ending_hook_type": accepted.ending_hook_type,
                "next_episode_obligation": accepted.next_episode_obligation,
            }
            for accepted in accepted_plans
        ]
        editable_fields = {
            "ending_mode": item.ending_mode.value,
            "episode_title": item.episode_title,
            "episode_payoff": item.episode_payoff,
            "pressure_escalation": item.pressure_escalation,
            "cliffhanger": item.cliffhanger,
            "ending_hook_type": item.ending_hook_type,
            "next_episode_obligation": item.next_episode_obligation,
        }
        protected_context = {
            "episode_number": item.episode_number,
            "ending_mode": item.ending_mode.value,
            "episode_goal": item.episode_goal,
            "central_conflict": item.central_conflict,
            "protagonist_decision": item.protagonist_decision,
            "dramatic_units": [unit.model_dump(mode="json") for unit in item.dramatic_units],
            "protagonist_cost": item.protagonist_cost,
            "reveal": item.reveal,
            "exit_state": item.exit_state,
            "source_turning_points": item.source_turning_points,
            "source_unit_story_beats": item.source_unit_story_beats,
            "required_local_resolution": node.unit_resolution or node.exit_state,
            "required_handoff_pressure": node.handoff_pressure or node.exit_state,
        }
        market_contract = StoryPlanningService._story_bible_market_contract_text(story_bible)
        return f"""{market_contract}

DIVERSITY-ONLY EPISODE ROADMAP REPAIR
Episode {item.episode_number} is already structurally complete and has passed all hard
continuity, reference and approved-event contracts. Rewrite only its local payoff and
ending pressure so they do not copy an earlier episode. Do not change its event chain,
outcome, character state, reference IDs or assigned source events.

Detected duplicate fields: {json.dumps(issues, ensure_ascii=False)}

Protected episode context:
{json.dumps(protected_context, ensure_ascii=False, separators=(',', ':'))}

Earlier accepted payoff and hook contracts; do not copy them:
{json.dumps(previous_contracts, ensure_ascii=False, separators=(',', ':'))}

Current editable fields:
{json.dumps(editable_fields, ensure_ascii=False, separators=(',', ':'))}

Rules:
1. Preserve the exact causal result and handoff pressure already established by the
   protected context. Do not invent a new reveal, character, location or plot branch.
1a. Rewrite episode_title only as needed to satisfy this naming contract:
{EPISODE_TITLE_NAMING_CONTRACT}
2. Make episode_payoff a distinct visible action result, not preparation or a promise.
3. For serial_hook, make cliffhanger and next_episode_obligation arise directly from this
   episode's exit state and use a story-native hook function not copied from an earlier
   episode. For season_finale or series_finale, preserve the approved formal resolution;
   do not add a false continuation hook, and use the legacy fields only to record closure
   or an explicitly approved future handoff.
4. All values must follow the market contract above. ending_hook_type must be only a short
   2-20 character classification label with no explanation.
5. Keep the repaired narrative fields within the 250-450 Chinese-character roadmap target;
   shorten repeated context instead of introducing new plot material.
6. Return only one native JSON object with exactly these six string fields:
episode_title, episode_payoff, pressure_escalation, cliffhanger, ending_hook_type,
next_episode_obligation. Do not return any other field, wrapper, Markdown or explanation."""
````

片段 SHA-256：`97cef0880351a540f412c365c6e5af87b303839ffba91a03348f72ffa90f2259`
