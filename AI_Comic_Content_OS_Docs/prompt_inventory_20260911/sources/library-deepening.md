# Creative Deepening 的内置模板

编号：`library-deepening`。状态：`disabled_by_default`。

来源：[scripts/bootstrap_frontend_mvp_runtime.py:518](/Users/simonriley/Downloads/docs/scripts/bootstrap_frontend_mvp_runtime.py:518)。符号：`_build_deepening_prompt_payload`。

已有兼容模板；项目文档明确当前 Creative Deepening 默认关闭，不能当作默认正文流程。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 520 行

````text
prompt.creative_deepening.{suffix}
````

### 片段 2 · 源码第 521 行

````text
Creative Deepening Shadow Prompt
````

### 片段 3 · 源码第 529 行

````text
Deepen character expression, dialogue subtext, emotional progression, visual actions, and scene intensity. Preserve premise, character identity, major conflicts, scene causal links, ending direction, and cliffhanger purpose.
````

### 片段 4 · 源码第 536 行

````text
Shadow candidate only; never replace the selected draft automatically.
````

### 片段 5 · 源码第 537 行

````text
Reject premise, identity, causal-chain, or cliffhanger-purpose drift.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
def _build_deepening_prompt_payload(suffix: str) -> dict[str, Any]:
    return {
        "id": f"prompt.creative_deepening.{suffix}",
        "name": "Creative Deepening Shadow Prompt",
        "prompt_type": "creative_deepening",
        "target_module": "script_engine",
        "applicable_tags": ["genre.dark_romance"],
        "target_platform": "tiktok",
        "target_audience": "US short-form drama viewers",
        "version": "v1",
        "prompt_template": (
            "Deepen character expression, dialogue subtext, emotional progression, "
            "visual actions, and scene intensity. Preserve premise, character identity, "
            "major conflicts, scene causal links, ending direction, and cliffhanger purpose."
        ),
        "input_variables": [],
        "output_schema": {"type": "object"},
        "evaluation_notes": [
            "Shadow candidate only; never replace the selected draft automatically.",
            "Reject premise, identity, causal-chain, or cliffhanger-purpose drift.",
        ],
    }
````

片段 SHA-256：`01a9fd1630c3f918be69af6c9a0c99c96080547ad83377eaaafbb799b28c6723`
