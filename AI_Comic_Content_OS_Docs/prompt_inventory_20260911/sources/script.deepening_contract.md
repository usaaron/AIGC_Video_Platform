# 创意深化的保护合同

编号：`script.deepening_contract`。状态：`默认关闭的可选模块`。

来源：[backend/app/modules/script_engine/prompt_builder.py:812](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:812)。符号：`TemplatePromptBuilder._build_deepening_contract`。

仅表达增强，保护剧情和场景因果，配合deepening_prompt_ids；源码默认不启用，部署配置未核实。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 814 行

````text
Enhance only dialogue quality, emotional expression, visible character actions, scene intensity, and character expression. Preserve title, premise, hook, synopsis, episode goal, ending mode and approved ending purpose, character names and roles, scene count and order, scene purpose, setting, turning point, all scene_causality fields exactly. For serial_hook preserve the cliffhanger and next question; for season_finale or series_finale preserve the approved payoff and do not invent a continuation hook. Do not add a major conflict, replace the ending, remove causal links, or alter locked character facts. Return the complete enhanced Draft schema, not a patch.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _build_deepening_contract(self) -> str:
        return (
            "Enhance only dialogue quality, emotional expression, visible character "
            "actions, scene intensity, and character expression. Preserve title, "
            "premise, hook, synopsis, episode goal, ending mode and approved ending purpose, "
            "character names and roles, scene count and order, scene purpose, setting, turning "
            "point, all scene_causality fields exactly. For serial_hook preserve the cliffhanger "
            "and next question; for season_finale or series_finale preserve the approved payoff "
            "and do not invent a continuation hook. Do not add a major conflict, replace the "
            "ending, remove causal links, or alter locked character facts. Return the complete "
            "enhanced Draft schema, not a patch."
        )
````

片段 SHA-256：`f413794505bdf2358e3414abfdae33181e6242e2f40969efef7de7b3bd366486`
