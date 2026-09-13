# 场景因果与事实确定性合同

编号：`script.scene_causality`。状态：`默认主链`。

来源：[backend/app/modules/script_engine/prompt_builder.py:789](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:789)。符号：`TemplatePromptBuilder._build_scene_causality_contract`。

目标/冲突/结果，前场因果，证据、时间、知情边界。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 791 行

````text
For every scene record scene_causality.goal, scene_causality.conflict and the concrete exit-state change in scene_causality.outcome. Scene 1 has null causal predecessor; every later scene references an earlier scene and states how its outcome forces or enables this one. Every later scene must reference an earlier scene number. The final outcome creates the assigned hook/payoff. Match factual certainty to visible verification: unverified causes, motives and announced events remain attributed claims or suspicions. Do not invent unsupported plot facts. Distinguish the time an event occurred, the time a record was published, and the time it was verified; a later publication alone is not proof of falsified event timing. Show the actual comparison and its limits before declaring a contradiction. A suspicious transaction needs an established purpose, parties and connection to the event; chronology alone cannot supply that connection. Preserve missing business facts as unknown and make their verification a question, rather than inventing a payment purpose or declaring wrongdoing. Unless approved world rules explicitly permit it, a document cannot be consulted before it existed. Keep its formation date, covered period and access date distinct; use separate identifiers or explicit descriptions for historical files and later incident-day records instead of merging them through 'these records'. Follow body_order for information access: show how a character learned a fact before recording it as their knowledge; a scene number or planned reveal alone is not evidence that they know it.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _build_scene_causality_contract(self) -> str:
        return (
            "For every scene record scene_causality.goal, scene_causality.conflict and the concrete "
            "exit-state change in scene_causality.outcome. "
            "Scene 1 has null causal predecessor; every later scene references an earlier scene and "
            "states how its outcome forces or enables this one. Every later scene must reference an "
            "earlier scene number. The final outcome creates the assigned "
            "hook/payoff. Match factual certainty to visible verification: unverified causes, motives "
            "and announced events remain attributed claims or suspicions. Do not invent unsupported plot facts. "
            "Distinguish the time an event occurred, the time a record was published, and the time it was "
            "verified; a later publication alone is not proof of falsified event timing. Show the actual "
            "comparison and its limits before declaring a contradiction. A suspicious transaction needs "
            "an established purpose, parties and connection to the event; chronology alone cannot supply "
            "that connection. Preserve missing business facts as unknown and make their verification a "
            "question, rather than inventing a payment purpose or declaring wrongdoing. Unless approved "
            "world rules explicitly permit it, a document cannot "
            "be consulted before it existed. Keep its formation date, covered period and access date distinct; "
            "use separate identifiers or explicit descriptions for historical files and later incident-day "
            "records instead of merging them through 'these records'. Follow body_order for information "
            "access: show how a character learned a fact before recording it as their knowledge; a scene "
            "number or planned reveal alone is not evidence that they know it."
        )
````

片段 SHA-256：`22b285c98c68f9a3cb5db145ddc40ee2496c6db82ac27289ffd860fca887202f`
