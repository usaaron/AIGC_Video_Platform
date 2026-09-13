# Grill Me 模型失败时的本地回退问题

编号：`input.grill.fallback`。状态：`conditional`。

来源：[backend/app/modules/script_engine/story_planning_service.py:5015](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:5015)。符号：`StoryPlanningService._fallback_story_inspiration_turn`。

超时或结构化输出无效时使用，亦用于过滤后无新题时；固定问句但受前置条件、去重和收束规则约束，不是日常固定问卷。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 5030 行

````text
按你现在的想法，观众持续看下去主要在等待什么变化；如果还不确定，也可以先保留？
````

### 片段 2 · 源码第 5035 行

````text
现阶段你最确定由谁推动故事，他眼下最想做到什么；哪些部分还不需要现在决定？
````

### 片段 3 · 源码第 5040 行

````text
你目前最想让观众获得怎样的观看感受；哪些节奏偏好可以留到规划阶段再调整？
````

### 片段 4 · 源码第 5045 行

````text
基于你已经确定的行动目标，现在最明确的阻力是什么；还有哪些阻力不适合提前写死？
````

### 片段 5 · 源码第 5050 行

````text
如果行动暂时失败，现阶段你已经确定会失去什么；哪些代价需要等人物发展后再决定？
````

### 片段 6 · 源码第 5055 行

````text
现阶段哪段关系最值得保留，它现在处于什么状态；未来变化是否需要先保持开放？
````

### 片段 7 · 源码第 5060 行

````text
故事是否需要某个信息在后段改变人物或观众对前文的理解；如果需要，什么内容必须保持开放？
````

### 片段 8 · 源码第 5065 行

````text
结局现在已经确定到什么程度；哪些结果可以先保持开放，等接近终局规划时再决定？
````

### 片段 9 · 源码第 5089 行

````text
creative_boundaries.author_control
````

### 片段 10 · 源码第 5091 行

````text
还有哪一项剧情决定现在不适合被系统补写，必须由你以后亲自决定？
````

### 片段 11 · 源码第 5120 行

````text
故事的核心承诺、人物行动和主要代价已经足够支撑一版完整总纲。当前决策前沿已经清空，可以进入总纲生成；仍可继续补充任何你不认可的假设。
````

### 片段 12 · 源码第 5126 行

````text
我把已经确定的内容保留下来，并只列出当前不依赖其他未决答案的决策。你可以直接回答，也可以选择还没想好或让我先给一个待确认的方案。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _fallback_story_inspiration_turn(
        payload: StoryInspirationChatRequest,
        *,
        excluded_questions: Iterable[str] = (),
        brief_override: StoryInspirationBrief | None = None,
    ) -> StoryInspirationChatOutput:
        excluded_questions = tuple(excluded_questions)
        brief = (brief_override or payload.current_brief).model_copy(deep=True)
        if payload.user_message.strip() and brief_override is None:
            _apply_story_inspiration_user_answer(payload, brief)
        question_fields = [
            (
                "story_promise",
                "观众持续观看的期待",
                "按你现在的想法，观众持续看下去主要在等待什么变化；如果还不确定，也可以先保留？",
            ),
            (
                "protagonist_and_goal",
                "当前行动中心",
                "现阶段你最确定由谁推动故事，他眼下最想做到什么；哪些部分还不需要现在决定？",
            ),
            (
                "tone_and_pacing",
                "观看感受与节奏",
                "你目前最想让观众获得怎样的观看感受；哪些节奏偏好可以留到规划阶段再调整？",
            ),
            (
                "core_obstacle",
                "当前核心阻力",
                "基于你已经确定的行动目标，现在最明确的阻力是什么；还有哪些阻力不适合提前写死？",
            ),
            (
                "stakes",
                "当前可确认的风险",
                "如果行动暂时失败，现阶段你已经确定会失去什么；哪些代价需要等人物发展后再决定？",
            ),
            (
                "relationship_direction",
                "当前核心关系",
                "现阶段哪段关系最值得保留，它现在处于什么状态；未来变化是否需要先保持开放？",
            ),
            (
                "reveal_or_twist",
                "信息与认知变化",
                "故事是否需要某个信息在后段改变人物或观众对前文的理解；如果需要，什么内容必须保持开放？",
            ),
            (
                "ending_direction",
                "结局方向",
                "结局现在已经确定到什么程度；哪些结果可以先保持开放，等接近终局规划时再决定？",
            ),
        ]
        candidates = [
            StoryInspirationFrontierQuestion(
                question_id="Q1",
                decision_key=f"{field}.foundation",
                title=title,
                question=question,
                # The deterministic path must remain a neutral prompt when the
                # model is unavailable. Do not steer the author with template
                # choices or a hidden default recommendation.
                choices=[],
                recommended_choice=None,
                recommended_answer=None,
            )
            for field, title, question in question_fields
            if not _story_inspiration_field_is_handled(brief, field)
            and all(getattr(brief, prerequisite).strip() for prerequisite in _INSPIRATION_FIELD_PREREQUISITES[field])
            and not _story_inspiration_question_is_repeated(question, excluded_questions)
        ][:3]
        if not candidates:
            boundary_question = StoryInspirationFrontierQuestion(
                question_id="Q1",
                decision_key="creative_boundaries.author_control",
                title="作者保留的创作空间",
                question="还有哪一项剧情决定现在不适合被系统补写，必须由你以后亲自决定？",
                choices=[],
                recommended_choice=None,
                recommended_answer=None,
            )
            candidates = [] if _story_inspiration_question_is_repeated(
                boundary_question.question,
                excluded_questions,
            ) else [boundary_question]
        candidates = [
            question.model_copy(update={"question_id": f"Q{index}"})
            for index, question in enumerate(candidates, start=1)
        ]
        user_answer_count = _story_inspiration_user_answer_count(payload)
        ready = user_answer_count >= STORY_INSPIRATION_MIN_COMPLETED_ROUNDS and (
            sum(bool(getattr(brief, name).strip()) for name in _INSPIRATION_CORE_FIELDS)
            >= STORY_INSPIRATION_MIN_CONFIRMED_FIELDS
            or sum(
                _story_inspiration_field_is_handled(brief, name)
                for name in _INSPIRATION_CORE_FIELDS
            ) >= 3
        )
        ready = (
            _story_inspiration_explicit_generation_requested(payload)
            or user_answer_count >= STORY_INSPIRATION_MAX_USER_ANSWERS
            or (ready and not _story_inspiration_deeper_round_requested(payload))
        )
        if ready:
            assistant_message = (
                "故事的核心承诺、人物行动和主要代价已经足够支撑一版完整总纲。"
                "当前决策前沿已经清空，可以进入总纲生成；仍可继续补充任何你不认可的假设。"
            )
            candidates = []
        else:
            assistant_message = (
                "我把已经确定的内容保留下来，并只列出当前不依赖其他未决答案的决策。"
                "你可以直接回答，也可以选择还没想好或让我先给一个待确认的方案。"
            )
        return StoryInspirationChatOutput(
            assistant_message=assistant_message,
            questions=candidates,
            brief=brief,
            ready_to_generate=ready,
        )
````

片段 SHA-256：`3650085f79585963ecceafce731647527f5d53438dc3313257b9fb24912917b6`
