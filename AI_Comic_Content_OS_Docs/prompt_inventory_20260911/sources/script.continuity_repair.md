# 连续性硬冲突修复及第二轮紧凑重试

编号：`script.continuity_repair`。状态：`默认主链发现blocking后自动触发`。

来源：[backend/app/modules/script_engine/generation_service.py:8445](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8445)。符号：`ScriptGenerationService._build_continuity_repair_prompt`。

最多2轮，未解决则阻断；不是现有用户选择弹窗流程。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8463 行

````text
上一版剧本已完成生成，但连续性检查发现硬冲突；你正在执行第{repair_attempt}轮局部连续性修复。
只处理下面最新 QC 报告中的 blocking
硬冲突；不要重写整集，不要改动未列出的场景、人物选择、剧情职责或结尾悬念。

这是一个紧凑修复包，只提供受影响场景和状态账本。对于永久毁坏、永久丢失或不可用实体，必须从
受影响场景的当前时间线动作和对白中删除其实际使用；除非补丁同时写出明确的找回、修复、替换或
重新取得过程，否则不得保留该实体被操作、启动、读取或再次出现的证据。同步删除/改写对应的
continuity_state_updates，不能只改摘要。对于人物能力冲突，动作必须符合既有能力；对于计划推进，
必须在场景动作、对白或状态更新中留下可验证证据。

必须修正的 blocking 冲突：
{json.dumps(blocking_issues, ensure_ascii=False, separators=(',', ':'))}

受影响上下文：
{context}

只返回一个符合补丁结构的 JSON 对象，不要使用 Markdown 代码块或解释文字。
````

### 片段 2 · 源码第 8480 行

````text
{original_prompt}

上一版剧本已完成生成，但连续性检查发现硬冲突。这是第{repair_attempt}轮局部连续性修复；请只修正
下面最新报告列出的硬冲突，不要重写整集。
既有连续性状态优先于本集草稿。删除不可能发生的当前时间线行动，或在既有剧情允许时明确改成
回忆、录像、录音等非当前行动；不得通过无铺垫复活、痊愈、修复、找回物品或修改历史来绕过冲突。
保持本集剧情职责、其他人物选择、无关场景、因果链、正文深度和结尾悬念不变。同步修正受影响的
人物状态、关系状态、连续性状态及其场景证据，确保修正后的结构字段与正文一致。

只返回局部补丁：scenes 仅包含实际需要修改的完整场景；只有确实需要修改的状态类型才返回
该类型修正后的完整数组，未涉及的状态数组返回空数组，continuation_hook 无需修改时返回 null。
不得为了填充结构而清空原有状态。不得返回标题、梗概等无关顶层字段。后端会按
scene_number 合并场景，并保留空数组或 null 所代表的未修改原稿字段。

必须修正的硬冲突：
{json.dumps(blocking_issues, ensure_ascii=False, separators=(',', ':'))}

上一版 JSON：
{json.dumps(output, ensure_ascii=False, separators=(',', ':'))}

只返回一个符合补丁结构的 JSON 对象，不要使用 Markdown 代码块或解释文字。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_continuity_repair_prompt(
        *,
        original_prompt: str,
        output: dict[str, object],
        report: ContinuityQCReport,
        repair_attempt: int = 1,
    ) -> str:
        blocking_issues = [
            issue.model_dump(mode="json")
            for issue in report.issues
            if issue.severity.value == "blocking"
        ]
        context = ScriptGenerationService._build_continuity_repair_context(
            output=output,
            report=report,
        )
        if repair_attempt > 1:
            return f"""上一版剧本已完成生成，但连续性检查发现硬冲突；你正在执行第{repair_attempt}轮局部连续性修复。
只处理下面最新 QC 报告中的 blocking
硬冲突；不要重写整集，不要改动未列出的场景、人物选择、剧情职责或结尾悬念。

这是一个紧凑修复包，只提供受影响场景和状态账本。对于永久毁坏、永久丢失或不可用实体，必须从
受影响场景的当前时间线动作和对白中删除其实际使用；除非补丁同时写出明确的找回、修复、替换或
重新取得过程，否则不得保留该实体被操作、启动、读取或再次出现的证据。同步删除/改写对应的
continuity_state_updates，不能只改摘要。对于人物能力冲突，动作必须符合既有能力；对于计划推进，
必须在场景动作、对白或状态更新中留下可验证证据。

必须修正的 blocking 冲突：
{json.dumps(blocking_issues, ensure_ascii=False, separators=(',', ':'))}

受影响上下文：
{context}

只返回一个符合补丁结构的 JSON 对象，不要使用 Markdown 代码块或解释文字。"""
        return f"""{original_prompt}

上一版剧本已完成生成，但连续性检查发现硬冲突。这是第{repair_attempt}轮局部连续性修复；请只修正
下面最新报告列出的硬冲突，不要重写整集。
既有连续性状态优先于本集草稿。删除不可能发生的当前时间线行动，或在既有剧情允许时明确改成
回忆、录像、录音等非当前行动；不得通过无铺垫复活、痊愈、修复、找回物品或修改历史来绕过冲突。
保持本集剧情职责、其他人物选择、无关场景、因果链、正文深度和结尾悬念不变。同步修正受影响的
人物状态、关系状态、连续性状态及其场景证据，确保修正后的结构字段与正文一致。

只返回局部补丁：scenes 仅包含实际需要修改的完整场景；只有确实需要修改的状态类型才返回
该类型修正后的完整数组，未涉及的状态数组返回空数组，continuation_hook 无需修改时返回 null。
不得为了填充结构而清空原有状态。不得返回标题、梗概等无关顶层字段。后端会按
scene_number 合并场景，并保留空数组或 null 所代表的未修改原稿字段。

必须修正的硬冲突：
{json.dumps(blocking_issues, ensure_ascii=False, separators=(',', ':'))}

上一版 JSON：
{json.dumps(output, ensure_ascii=False, separators=(',', ':'))}

只返回一个符合补丁结构的 JSON 对象，不要使用 Markdown 代码块或解释文字。"""
````

片段 SHA-256：`51409765f3365e02fabd494316e5d73feaafc1ae73066e1c70baea20ac1fa582`
