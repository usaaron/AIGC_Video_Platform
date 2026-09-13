# 大陆 Prompt Library 的两个内置模板

编号：`library-mainland`。状态：`bootstrap`。

来源：[scripts/bootstrap_frontend_mvp_runtime.py:343](/Users/simonriley/Downloads/docs/scripts/bootstrap_frontend_mvp_runtime.py:343)。符号：`_build_mainland_prompt_library_payload`。

启动脚本注册的内置定义；正文策略实际取用数据库或仓库中的对应 prompt_ids，未读取运行库来确认是否有人另行改写。模板名 story_planning 不代表这是生成总纲的主提示词。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 346 行

````text
prompt.story_planning.{suffix}
````

### 片段 2 · 源码第 347 行

````text
China Mainland Story Foundation Prompt
````

### 片段 3 · 源码第 352 行

````text
Mainland China serialized comic-drama audience
````

### 片段 4 · 源码第 355 行

````text
根据结构化创作意图和已批准单集线路图，生成中文连载漫剧的单集正式可拍摄剧本正文。线路图负责约束本集目标、冲突、转折和退出状态，不要重新规划剧情。优先保持人物动机、关系、世界规则和前后状态一致；每个场景必须包含明确目标、有效阻力和改变故事状态的结果，后续场景应由此前结果推动。不得套用 TikTok、海外短视频或固定付费卡点规则，不得擅自改变用户锁定的人物设定。
````

### 片段 5 · 源码第 374 行

````text
Generate one bounded production-readable episode body from the approved route.
````

### 片段 6 · 源码第 375 行

````text
Prefer continuity and consequential character choices over disconnected short-form shocks.
````

### 片段 7 · 源码第 376 行

````text
Hongguo is a market reference, not a hard platform contract.
````

### 片段 8 · 源码第 380 行

````text
prompt.mainland_serialization.{suffix}
````

### 片段 9 · 源码第 381 行

````text
Mainland China Serialization Prompt
````

### 片段 10 · 源码第 386 行

````text
Mainland China serialized comic-drama audience
````

### 片段 11 · 源码第 389 行

````text
检查本集是否推进主线或人物关系、是否留下可追踪的后续责任，并避免重复冲突、空转场景和无依据反转。只使用当前输入提供的题材、人物和约束，不把特定平台爆款公式当作强制结构。
````

### 片段 12 · 源码第 401 行

````text
This is a bounded generation instruction, not professional mainland-market validation.
````

### 片段 13 · 源码第 402 行

````text
Recursive planning must preserve short-episode payoff, hook, and continuity contracts.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
def _build_mainland_prompt_library_payload(suffix: str) -> list[dict[str, Any]]:
    return [
        {
            "id": f"prompt.story_planning.{suffix}",
            "name": "China Mainland Story Foundation Prompt",
            "prompt_type": "story_planning",
            "target_module": "script_engine",
            "applicable_tags": [],
            "target_platform": "mainland_china",
            "target_audience": "Mainland China serialized comic-drama audience",
            "version": "v1",
            "prompt_template": (
                "根据结构化创作意图和已批准单集线路图，生成中文连载漫剧的单集正式可拍摄剧本正文。"
                "线路图负责约束本集目标、冲突、转折和退出状态，不要重新规划剧情。优先保持人物动机、关系、世界规则和前后状态一致；"
                "每个场景必须包含明确目标、有效阻力和改变故事状态的结果，后续场景应由此前结果推动。"
                "不得套用 TikTok、海外短视频或固定付费卡点规则，不得擅自改变用户锁定的人物设定。"
            ),
            "input_variables": [
                "content_spec_json",
                "creative_brief_json",
                "platform_profile_json",
                "retrieved_assets_json",
                "generation_strategy_json",
                "output_language",
                "desired_scene_count",
                "target_duration_seconds",
                "target_script_body_characters",
                "output_json_schema",
            ],
            "output_schema": {"type": "object"},
            "evaluation_notes": [
                "Generate one bounded production-readable episode body from the approved route.",
                "Prefer continuity and consequential character choices over disconnected short-form shocks.",
                "Hongguo is a market reference, not a hard platform contract.",
            ],
        },
        {
            "id": f"prompt.mainland_serialization.{suffix}",
            "name": "Mainland China Serialization Prompt",
            "prompt_type": "commercial_evaluation",
            "target_module": "script_engine",
            "applicable_tags": [],
            "target_platform": "mainland_china",
            "target_audience": "Mainland China serialized comic-drama audience",
            "version": "v1",
            "prompt_template": (
                "检查本集是否推进主线或人物关系、是否留下可追踪的后续责任，并避免重复冲突、空转场景和无依据反转。"
                "只使用当前输入提供的题材、人物和约束，不把特定平台爆款公式当作强制结构。"
            ),
            "input_variables": [
                "content_spec_json",
                "platform_constraints",
                "hook_requirement",
                "cliffhanger_requirement",
                "cultural_fit_requirement",
            ],
            "output_schema": {"type": "object"},
            "evaluation_notes": [
                "This is a bounded generation instruction, not professional mainland-market validation.",
                "Recursive planning must preserve short-episode payoff, hook, and continuity contracts.",
            ],
        },
    ]
````

片段 SHA-256：`86cfcce2839a286f96df491cb3b0efb5cd1b4cf4c88efff4f750f64c368ca6cd`
