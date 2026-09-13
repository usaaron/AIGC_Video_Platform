# 正文篇幅指导的辅助计算

编号：`shared-body-length`。状态：`conditional`。

来源：[backend/app/modules/script_engine/script_body_length.py:20](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/script_body_length.py:20)。符号：`script_body_length_guidance`。

这是将项目正文参考字数转换为范围的辅助函数，不是自然语言提示词；正文提示会使用计算结果，不能脱离输入理解为所有项目相同字数。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
def script_body_length_guidance(reference_characters: int) -> ScriptBodyLengthGuidance:
    """Turn a series-average reference into broad, plot-first episode guardrails."""
    reference = max(1, round(reference_characters))
    return ScriptBodyLengthGuidance(
        reference_characters=reference,
        preferred_min_characters=max(1, round(reference * PREFERRED_MIN_RATIO)),
        preferred_max_characters=max(1, round(reference * PREFERRED_MAX_RATIO)),
        truncation_floor_characters=max(1, round(reference * TRUNCATION_FLOOR_RATIO)),
    )
````

片段 SHA-256：`1e9ed4d8f068d448bdaf4bb9472aa413cecf94dd25b99d7e296377c586ba6b12`
