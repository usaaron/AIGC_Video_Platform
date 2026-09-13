# 海外 Prompt Library 的两个内置模板

编号：`library-overseas`。状态：`bootstrap`。

来源：[scripts/run_real_generation_validation.py:123](/Users/simonriley/Downloads/docs/scripts/run_real_generation_validation.py:123)。符号：`build_prompt_library_payload`。

虽然位于验证脚本，该函数被 bootstrap_frontend_mvp_runtime.py 导入并用于海外启动资源，不应误判为仅测试数据。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 126 行

````text
prompt.story_planning.{suffix}
````

### 片段 2 · 源码第 135 行

````text
Generate a high-retention short-form dramatic episode from the supplied structured context. The opening hook must stop the scroll immediately, the protagonist must show agency, and the ending must force the next episode. Build every scene around an immediate goal, a concrete conflict, and an outcome that changes the story state. Each later scene must be caused by an earlier outcome rather than merely following it.
````

### 片段 3 · 源码第 154 行

````text
Prefer natural dialogue over slogans.
````

### 片段 4 · 源码第 155 行

````text
Keep every scene causally connected.
````

### 片段 5 · 源码第 156 行

````text
Make every scene outcome different from its opening goal.
````

### 片段 6 · 源码第 160 行

````text
prompt.tiktok_optimization.{suffix}
````

### 片段 7 · 源码第 169 行

````text
Optimize for TikTok pacing, cultural clarity, and sequel curiosity. Keep lines short enough to perform and subtitle cleanly.
````

### 片段 8 · 源码第 181 行

````text
End with a comment-driving unanswered question.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
def build_prompt_library_payload(suffix: str) -> list[dict[str, Any]]:
    return [
        {
            "id": f"prompt.story_planning.{suffix}",
            "name": "Story Planning Prompt",
            "prompt_type": "story_planning",
            "target_module": "script_engine",
            "applicable_tags": ["genre.romance"],
            "target_platform": "tiktok",
            "target_audience": "US women 18-34",
            "version": "v3",
            "prompt_template": (
                "Generate a high-retention short-form dramatic episode from the supplied structured context. "
                "The opening hook must stop the scroll immediately, the protagonist must show agency, "
                "and the ending must force the next episode. Build every scene around an immediate goal, "
                "a concrete conflict, and an outcome that changes the story state. Each later scene must "
                "be caused by an earlier outcome rather than merely following it."
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
                "output_json_schema",
            ],
            "output_schema": {"type": "object"},
            "evaluation_notes": [
                "Prefer natural dialogue over slogans.",
                "Keep every scene causally connected.",
                "Make every scene outcome different from its opening goal.",
            ],
        },
        {
            "id": f"prompt.tiktok_optimization.{suffix}",
            "name": "TikTok Optimization Prompt",
            "prompt_type": "tiktok_optimization",
            "target_module": "script_engine",
            "applicable_tags": ["genre.romance"],
            "target_platform": "tiktok",
            "target_audience": "US women 18-34",
            "version": "v1",
            "prompt_template": (
                "Optimize for TikTok pacing, cultural clarity, and sequel curiosity. "
                "Keep lines short enough to perform and subtitle cleanly."
            ),
            "input_variables": [
                "platform_constraints",
                "hook_requirement",
                "cliffhanger_requirement",
                "cultural_fit_requirement",
            ],
            "output_schema": {"type": "object"},
            "evaluation_notes": [
                "Front-load tension.",
                "End with a comment-driving unanswered question.",
            ],
        },
    ]
````

片段 SHA-256：`5fb4d1bb598374decb8dd11cf75e70545c607d753ad09d9c5069c3822a9a4b24`
