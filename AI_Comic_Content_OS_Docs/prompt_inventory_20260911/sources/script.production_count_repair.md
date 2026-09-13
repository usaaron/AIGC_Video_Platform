# 台词与动作数量修复

编号：`script.production_count_repair`。状态：`生产数量不合约时条件触发`。

来源：[backend/app/modules/script_engine/generation_service.py:7990](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:7990)。符号：`ScriptGenerationService._build_episode_production_count_repair_prompt`。

局部场景正文补丁，保持实际人物参与证据、事实和时长。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8053 行

````text
中文对白不要全部压成2至5字口号；在25至35句台词内，整体通常需要约300至450个可说中文字符，并配合每个镜头内可见的动作、反应、停顿和后果。
````

### 片段 2 · 源码第 8057 行

````text
英文对白不要全部压成单词式短句；在25至35句台词内，整体通常需要约210至300个自然口语词，并配合每个镜头内可见的动作、反应、停顿和后果。
````

### 片段 3 · 源码第 8062 行

````text
Market path: overseas (current profile: overseas_tiktok).
````

### 片段 4 · 源码第 8066 行

````text
{market_contract_marker}
本集正文已经通过剧情结构和连续性校验，但台词或镜头执行单元数量不符合交付规则。
本次响应的max_tokens是模型token预算，不是本集或全剧正文总字数配额；优先返回完整可用的JSON补丁，最终正文总字数由程序统计。

当前程序估算成片约{current_duration_seconds}秒。数量修订后必须仍处于
{EPISODE_RUNTIME_MIN_SECONDS}至{EPISODE_RUNTIME_MAX_SECONDS}秒，并尽量接近{duration_target}秒。
不得为了减少条目而删除有效冲突、反应、动作过程或潜台词。{pacing_rule}

当前全集台词共{dialogue_count}条，修订后必须恰好为{target_dialogue_count}条，并始终位于
{EPISODE_DIALOGUE_LINE_MIN}至{EPISODE_DIALOGUE_LINE_MAX}条范围内。所有场景的dialogues数组
合计计数，每个条目必须是演员真正说出的一句台词。不得拆句、重复、复述或添加解释性台词凑数。

当前全集镜头执行单元共{shot_count}个，修订后必须恰好为{target_shot_count}个，并始终位于
{EPISODE_SHOT_UNIT_MIN}至{EPISODE_SHOT_UNIT_MAX}个范围内。所有场景的character_actions数组
合计计数，每个条目视为一个可独立拍摄的动作单元。不得拆分同一动作、堆空镜或写景别、角度、
运镜等镜头语言凑数。

本集场景总数必须保持在{EPISODE_SCENE_MIN}至{EPISODE_SCENE_MAX}个。必须完整返回全部原场景，
每场只返回scene_number、character_actions、body_order、dialogues。保持原场景数量、
编号、顺序、人物身份、剧情事实、冲突、信息揭示、因果、状态变化、伏笔、结尾悬念和语言路径不变。
每场required_visible_characters中的每个人物必须继续在该场的character_actions或dialogues中
被明确点名并可见参与，不得因合并条目而删除其证据；补丁中不要返回required_visible_characters字段。
只通过合并无效重复、补足必要反应、强化原有交锋或压缩解释性内容来达到数量。不得新增场景、人物、
剧情事件、支线或设定。不要返回其他顶层字段、分析、Markdown或说明。

body_order必须用action:0、dialogue:0这类零基引用保存动作与对白的真实交错顺序；
每个character_actions和dialogues条目各引用且只引用一次，不得先列完动作再集中列对白。

已校验场景正文（只包含本次需要修改的局部）：
{json.dumps(scene_context, ensure_ascii=False, separators=(',', ':'))}

只返回包含全部原场景的局部补丁JSON。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_episode_production_count_repair_prompt(
        *,
        output: LLMGeneratedDraftMasterScript,
        dialogue_count: int,
        shot_count: int,
        target_dialogue_count: int,
        target_shot_count: int,
        current_duration_seconds: int,
        target_duration_seconds: int | None,
        market_path: str = "cn_mainland",
    ) -> str:
        # The count repair only edits two per-scene arrays. Sending the full
        # episode ledgers and continuity graph here needlessly increases both
        # context pressure and hidden-reasoning time, while providing no
        # information needed to choose a playable line or action. Keep the
        # scene beat and current body as the authoritative compact context.
        required_visible_characters: dict[int, set[str]] = {}
        for update in output.character_state_updates:
            for scene_number in update.evidence_scene_numbers:
                required_visible_characters.setdefault(scene_number, set()).add(
                    update.character_name
                )
        for update in output.relationship_state_updates:
            for scene_number in update.evidence_scene_numbers:
                required_visible_characters.setdefault(scene_number, set()).update(
                    (update.source_character_name, update.target_character_name)
                )
        scene_context = [
            {
                "scene_number": scene.scene_number,
                "purpose": scene.purpose,
                "beat_summary": scene.beat_summary,
                "turning_point": scene.turning_point,
                "required_visible_characters": sorted(
                    required_visible_characters.get(scene.scene_number, set())
                ),
                "character_actions": scene.character_actions,
                "body_order": scene.body_order,
                "dialogues": [
                    dialogue.model_dump(mode="json") for dialogue in scene.dialogues
                ],
            }
            for scene in output.scenes
        ]
        requested_duration_target = min(
            EPISODE_RUNTIME_MAX_SECONDS,
            max(
                EPISODE_RUNTIME_MIN_SECONDS,
                target_duration_seconds or output.target_duration_seconds,
            ),
        )
        duration_target = min(
            EPISODE_RUNTIME_PREFERRED_MAX_SECONDS,
            max(
                EPISODE_RUNTIME_PREFERRED_MIN_SECONDS,
                requested_duration_target,
            ),
        )
        language_is_chinese = ScriptGenerationService._is_chinese_language(
            output.language
        )
        pacing_rule = (
            "中文对白不要全部压成2至5字口号；在25至35句台词内，整体通常需要约"
            "300至450个可说中文字符，并配合每个镜头内可见的动作、反应、停顿和后果。"
            if language_is_chinese
            else (
                "英文对白不要全部压成单词式短句；在25至35句台词内，整体通常需要约"
                "210至300个自然口语词，并配合每个镜头内可见的动作、反应、停顿和后果。"
            )
        )
        market_contract_marker = (
            "Market path: overseas (current profile: overseas_tiktok)."
            if market_path == "overseas_tiktok"
            else "Market path: cn_mainland."
        )
        return f"""{market_contract_marker}
本集正文已经通过剧情结构和连续性校验，但台词或镜头执行单元数量不符合交付规则。
本次响应的max_tokens是模型token预算，不是本集或全剧正文总字数配额；优先返回完整可用的JSON补丁，最终正文总字数由程序统计。

当前程序估算成片约{current_duration_seconds}秒。数量修订后必须仍处于
{EPISODE_RUNTIME_MIN_SECONDS}至{EPISODE_RUNTIME_MAX_SECONDS}秒，并尽量接近{duration_target}秒。
不得为了减少条目而删除有效冲突、反应、动作过程或潜台词。{pacing_rule}

当前全集台词共{dialogue_count}条，修订后必须恰好为{target_dialogue_count}条，并始终位于
{EPISODE_DIALOGUE_LINE_MIN}至{EPISODE_DIALOGUE_LINE_MAX}条范围内。所有场景的dialogues数组
合计计数，每个条目必须是演员真正说出的一句台词。不得拆句、重复、复述或添加解释性台词凑数。

当前全集镜头执行单元共{shot_count}个，修订后必须恰好为{target_shot_count}个，并始终位于
{EPISODE_SHOT_UNIT_MIN}至{EPISODE_SHOT_UNIT_MAX}个范围内。所有场景的character_actions数组
合计计数，每个条目视为一个可独立拍摄的动作单元。不得拆分同一动作、堆空镜或写景别、角度、
运镜等镜头语言凑数。

本集场景总数必须保持在{EPISODE_SCENE_MIN}至{EPISODE_SCENE_MAX}个。必须完整返回全部原场景，
每场只返回scene_number、character_actions、body_order、dialogues。保持原场景数量、
编号、顺序、人物身份、剧情事实、冲突、信息揭示、因果、状态变化、伏笔、结尾悬念和语言路径不变。
每场required_visible_characters中的每个人物必须继续在该场的character_actions或dialogues中
被明确点名并可见参与，不得因合并条目而删除其证据；补丁中不要返回required_visible_characters字段。
只通过合并无效重复、补足必要反应、强化原有交锋或压缩解释性内容来达到数量。不得新增场景、人物、
剧情事件、支线或设定。不要返回其他顶层字段、分析、Markdown或说明。

body_order必须用action:0、dialogue:0这类零基引用保存动作与对白的真实交错顺序；
每个character_actions和dialogues条目各引用且只引用一次，不得先列完动作再集中列对白。

已校验场景正文（只包含本次需要修改的局部）：
{json.dumps(scene_context, ensure_ascii=False, separators=(',', ':'))}

只返回包含全部原场景的局部补丁JSON。"""
````

片段 SHA-256：`e8974f2ac724f324a27cccbc3942cb55fe8eff108dfa2cf3552078d8373455c7`
