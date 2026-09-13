# 数量修复补丁未通过后的重试

编号：`script.production_count_retry`。状态：`数量补丁校验失败时触发`。

来源：[backend/app/modules/script_engine/generation_service.py:8099](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8099)。符号：`ScriptGenerationService._build_episode_production_count_repair_retry_prompt`。

精确数量并保留人物证据，不允许修改状态账本。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8106 行

````text
{original_prompt}

上一份局部补丁未通过下方校验。请根据实际错误修正数量、字段或人物状态证据，
重新返回一份完整替代补丁，继续满足同样的台词、镜头、场景和时长要求，并确保每场
required_visible_characters中的人物在对应场景正文里被明确点名、可见参与。不要修改或返回
任何人物状态、关系、剧情线、伏笔或连续性账本字段。

上一份补丁的校验结果：
{str(validation_error)[:1200]}

上一份无效补丁：
{json.dumps(invalid_patch, ensure_ascii=False, separators=(',', ':'))}

只返回修正后的完整场景局部补丁JSON。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_episode_production_count_repair_retry_prompt(
        *,
        original_prompt: str,
        invalid_patch: dict[str, object],
        validation_error: ValidationError | ValueError,
    ) -> str:
        return f"""{original_prompt}

上一份局部补丁未通过下方校验。请根据实际错误修正数量、字段或人物状态证据，
重新返回一份完整替代补丁，继续满足同样的台词、镜头、场景和时长要求，并确保每场
required_visible_characters中的人物在对应场景正文里被明确点名、可见参与。不要修改或返回
任何人物状态、关系、剧情线、伏笔或连续性账本字段。

上一份补丁的校验结果：
{str(validation_error)[:1200]}

上一份无效补丁：
{json.dumps(invalid_patch, ensure_ascii=False, separators=(',', ':'))}

只返回修正后的完整场景局部补丁JSON。"""
````

片段 SHA-256：`c0b63226c94a720ef65289fe46fe0ba9960503e516b28ce4967884387afeaf01`
