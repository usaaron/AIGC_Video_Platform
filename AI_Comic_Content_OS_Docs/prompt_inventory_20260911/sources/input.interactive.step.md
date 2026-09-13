# 保留的逐节四候选总纲提示词

编号：`input.interactive.step`。状态：`legacy`。

来源：[backend/app/modules/script_engine/story_planning_service.py:12482](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12482)。符号：`StoryPlanningService._build_interactive_story_bible_step_prompt`。

后端 API 和客户端函数仍存在；当前主界面未调用。按十种步骤生成当前字段的四个候选。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 12495 行

````text
character_refs, character_registry
````

### 片段 2 · 源码第 12496 行

````text
character_arc_targets, relationships
````

### 片段 3 · 源码第 12499 行

````text
major_setup_payoff_refs, locked_facts, avoid_patterns
````

### 片段 4 · 源码第 12502 行

````text
这部剧的核心承诺是什么？请用一句话说清主角、处境和必须追下去的悬念。
````

### 片段 5 · 源码第 12503 行

````text
你希望观众持续追看的主要回报是什么？故事最终要完成什么系列目标？
````

### 片段 6 · 源码第 12504 行

````text
主角必须面对的核心冲突是什么？你希望作品留下怎样的主题命题？
````

### 片段 7 · 源码第 12507 行

````text
哪些角色必须存在？他们各自的身份、功能和不可随意改变的特征是什么？
````

### 片段 8 · 源码第 12508 行

````text
主要人物之间的关系和人物弧光准备怎样开始、转折并走向目标状态？
````

### 片段 9 · 源码第 12510 行

````text
冲突要经过哪些层级逐步升级？每层要给观众什么局部回报并引出什么更大压力？
````

### 片段 10 · 源码第 12511 行

````text
哪些伏笔必须保留、哪些事实必须锁定、哪些套路和内容必须避免？
````

### 片段 11 · 源码第 12516 行

````text
{direction.title}；{direction.style_description}；{direction.content_description}
````

### 片段 12 · 源码第 12520 行

````text
{StoryPlanningService._market_contract_text(content_spec)}

You are running one interactive Story Bible planning turn for the selected market path's serialized comic.
The author must review this turn before the next section is generated. Generate exactly 4 concise,
meaningfully different candidates for only the current section. Do not generate a complete Story Bible,
episode outline, scenes, dialogue, or prose. All human-readable values must be written in {market_contract.language_name}.

Current step: {payload.step.value}
Question this step must resolve: {step_questions[payload.step]}
Fields allowed in candidate.fields: {step_fields[payload.step]}
Project title: {project_title}
Creative prompt: {payload.creative_prompt.strip() or '未提供'}
Selected tags: {'、'.join(payload.selected_tag_labels) or '未提供'}
ContentSpec goal: {content_spec.story_goal}
Reference materials:
{StoryPlanningService._reference_material_context(payload.reference_materials, max_characters=12000)}
Selected creative direction: {direction_text}
Already confirmed sections (do not contradict them): {previous or '尚无'}
Author instruction for this turn: {payload.author_instruction.strip() or '请提出最稳妥的可选方案。'}

Each candidate must contain a stable candidate_id, a short title, a decision-ready summary, and a fields
object containing only the allowed fields for this step. Keep summaries and fields compact, concrete, and
internally consistent; do not repeat the already confirmed sections. Ask a focused question in question
that the author can answer before moving on.
Return only JSON matching the provided schema.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_interactive_story_bible_step_prompt(
        *,
        payload: StoryBibleInteractiveStepRequest,
        project_title: str,
        content_spec,
    ) -> str:
        step_fields: dict[StoryBibleInteractiveStep, str] = {
            StoryBibleInteractiveStep.premise: "project_title, core_premise",
            StoryBibleInteractiveStep.goal: "series_goal",
            StoryBibleInteractiveStep.conflict: "theme, central_conflict",
            StoryBibleInteractiveStep.ending: "ending_direction",
            StoryBibleInteractiveStep.world: "world_rules",
            StoryBibleInteractiveStep.characters: "character_refs, character_registry",
            StoryBibleInteractiveStep.arcs: "character_arc_targets, relationships",
            StoryBibleInteractiveStep.story_lines: "story_lines",
            StoryBibleInteractiveStep.escalation: "escalation_stages",
            StoryBibleInteractiveStep.safeguards: "major_setup_payoff_refs, locked_facts, avoid_patterns",
        }
        step_questions: dict[StoryBibleInteractiveStep, str] = {
            StoryBibleInteractiveStep.premise: "这部剧的核心承诺是什么？请用一句话说清主角、处境和必须追下去的悬念。",
            StoryBibleInteractiveStep.goal: "你希望观众持续追看的主要回报是什么？故事最终要完成什么系列目标？",
            StoryBibleInteractiveStep.conflict: "主角必须面对的核心冲突是什么？你希望作品留下怎样的主题命题？",
            StoryBibleInteractiveStep.ending: "你希望故事最终走向哪一种结局方向？主角要为此付出什么代价？",
            StoryBibleInteractiveStep.world: "这个故事有哪些不可违反的世界规则、行业规则或身份边界？",
            StoryBibleInteractiveStep.characters: "哪些角色必须存在？他们各自的身份、功能和不可随意改变的特征是什么？",
            StoryBibleInteractiveStep.arcs: "主要人物之间的关系和人物弧光准备怎样开始、转折并走向目标状态？",
            StoryBibleInteractiveStep.story_lines: "主线、支线和人物线分别承担什么任务，最后准备如何收束？",
            StoryBibleInteractiveStep.escalation: "冲突要经过哪些层级逐步升级？每层要给观众什么局部回报并引出什么更大压力？",
            StoryBibleInteractiveStep.safeguards: "哪些伏笔必须保留、哪些事实必须锁定、哪些套路和内容必须避免？",
        }
        previous = json.dumps(payload.previous_sections, ensure_ascii=False)[:20_000]
        direction = payload.selected_creative_direction
        direction_text = (
            f"{direction.title}；{direction.style_description}；{direction.content_description}"
            if direction else "未选择自动方向"
        )
        market_contract = content_spec_market_contract(content_spec)
        return f"""{StoryPlanningService._market_contract_text(content_spec)}

You are running one interactive Story Bible planning turn for the selected market path's serialized comic.
The author must review this turn before the next section is generated. Generate exactly 4 concise,
meaningfully different candidates for only the current section. Do not generate a complete Story Bible,
episode outline, scenes, dialogue, or prose. All human-readable values must be written in {market_contract.language_name}.

Current step: {payload.step.value}
Question this step must resolve: {step_questions[payload.step]}
Fields allowed in candidate.fields: {step_fields[payload.step]}
Project title: {project_title}
Creative prompt: {payload.creative_prompt.strip() or '未提供'}
Selected tags: {'、'.join(payload.selected_tag_labels) or '未提供'}
ContentSpec goal: {content_spec.story_goal}
Reference materials:
{StoryPlanningService._reference_material_context(payload.reference_materials, max_characters=12_000)}
Selected creative direction: {direction_text}
Already confirmed sections (do not contradict them): {previous or '尚无'}
Author instruction for this turn: {payload.author_instruction.strip() or '请提出最稳妥的可选方案。'}

Each candidate must contain a stable candidate_id, a short title, a decision-ready summary, and a fields
object containing only the allowed fields for this step. Keep summaries and fields compact, concrete, and
internally consistent; do not repeat the already confirmed sections. Ask a focused question in question
that the author can answer before moving on.
Return only JSON matching the provided schema."""
````

片段 SHA-256：`311a2d3ddc5a0e7495c97f33160cd5f2f05979812ece0d713e4c2a0c9fc84596`
