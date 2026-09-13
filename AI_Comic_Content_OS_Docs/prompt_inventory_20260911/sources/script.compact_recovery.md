# 推理预算耗尽后的紧凑正文恢复

编号：`script.compact_recovery`。状态：`失败时条件触发`。

来源：[backend/app/modules/script_engine/generation_service.py:2892](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:2892)。符号：`ScriptGenerationService._build_compact_episode_recovery_prompt`。

保留分集执行包；仍有严格固定冲突-决定-回报-升级顺序的文字，列为待讨论。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 2910 行

````text
完成批准的全剧结局、人物弧和主要因果收束；不要新增悬念或下一集义务。
````

### 片段 2 · 源码第 2913 行

````text
完成批准的本季结算，可保留明确批准的下一季入口；不要制造无关尾钩。
````

### 片段 3 · 源码第 2932 行

````text
动作、人物名、表演意图和对白全部使用简体中文，不生成英文对白或中英对照；dialogue.chinese_character_name和dialogue.chinese_translation填写null。
````

### 片段 4 · 源码第 2970 行

````text
你是序幕TV剧本大师的单集正文 Agent。上一轮 DeepSeek high 推理已耗尽输出预算，
但批准路线图和连续性检查点都没有变化。不要重新规划故事，只执行下面这一份紧凑写作包。

先在内部核对场景职责和因果顺序，然后立即输出最终 JSON。必须为最终 JSON 预留至少
8000 tokens，不得把输出预算全部用于推理。按供应方提供的 JSON schema 返回一个完整根对象，
必须闭合全部数组和对象；不要输出推理、Markdown、解释或包装字段。

执行要求：
1. approved_episode_plan、scene_execution_plan、layer_contracts和continuity_checkpoint是硬合同。
2. 严格执行冲突-决定-局部回报-压力升级-退出状态因果链；{ending_instruction}
3. 每场按body_order自然交错可拍动作与对白；不得写镜头语言、心理活动或小说叙述。
4. 全集场景1–5个、对白25–35条、镜头执行单元15–20个、成片75–115秒。
5. characters和所有状态更新必须来自写作包中的人物与已确认事实；状态更新保持简短并标注场次证据。
6. {language_contract}
7. 先保证完整、可解析、可拍，再在既定场景内提高语言和动作质量，不得增加支线。

紧凑写作包：
{json.dumps(recovery_packet, ensure_ascii=False, separators=(',', ':'))}
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _build_compact_episode_recovery_prompt(
        self,
        *,
        content_spec,
        payload: ScriptGenerationDraftRequest,
        target_duration_seconds: int,
    ) -> str:
        """Build a bounded screenplay packet after reasoning-only exhaustion.

        The normal prompt remains authoritative for the first attempt. This
        packet removes duplicated platform and knowledge prose while retaining
        the approved episode plan, scene blueprint, continuity checkpoint,
        character identities, hook duty, and three-layer contract.
        """

        assert payload.episode_context is not None
        ending_mode = payload.episode_context.ending_mode
        ending_instruction = (
            "完成批准的全剧结局、人物弧和主要因果收束；不要新增悬念或下一集义务。"
            if ending_mode == EndingMode.series_finale
            else (
                "完成批准的本季结算，可保留明确批准的下一季入口；不要制造无关尾钩。"
                if ending_mode == EndingMode.season_finale
                else "完成由本集因果产生的结尾钩子和下一集承接义务。"
            )
        )
        execution_context = self._episode_execution_context_payload(
            payload.episode_context,
            model_context_tokens=self._llm_adapter.get_model_info().max_context_tokens,
        )
        character_contexts: list[dict[str, object]] = []
        if payload.resolved_creative_context is not None:
            character_contexts = [
                character.model_dump(mode="json", exclude_none=True)
                for character in payload.resolved_creative_context.characters
            ]
        language_contract = (
            OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT
            if payload.release_region == ScriptReleaseRegion.overseas
            else (
                "动作、人物名、表演意图和对白全部使用简体中文，不生成英文对白或中英对照；"
                "dialogue.chinese_character_name和dialogue.chinese_translation填写null。"
            )
        )
        recovery_packet = {
            "project": {
                "title": content_spec.title,
                "story_goal": content_spec.story_goal,
                "hook": content_spec.creative_brief.hook,
                "tone": content_spec.creative_brief.tone,
                "pacing": content_spec.creative_brief.pacing,
                "target_emotion": content_spec.creative_brief.target_emotion,
            },
            "episode_execution": execution_context,
            "ending_mode": ending_mode.value,
            "characters": character_contexts,
            "delivery": {
                "language_contract": language_contract,
                "target_duration_seconds": target_duration_seconds,
                "scene_count": payload.desired_scene_count,
                "dialogue_line_range": [
                    EPISODE_DIALOGUE_LINE_MIN,
                    EPISODE_DIALOGUE_LINE_MAX,
                ],
                "shot_unit_range": [
                    EPISODE_SHOT_UNIT_MIN,
                    EPISODE_SHOT_UNIT_MAX,
                ],
                "body_character_reference": payload.target_script_body_characters,
                "screenplay_format": PARTNER_SCREENPLAY_FORMAT_VERSION,
                "content_template": PARTNER_SCREENPLAY_CONTENT_TEMPLATE_VERSION,
                "required_scene_content": [
                    "scene_heading",
                    "character_refs",
                    "content_manifest",
                ],
            },
        }
        return f"""你是序幕TV剧本大师的单集正文 Agent。上一轮 DeepSeek high 推理已耗尽输出预算，
但批准路线图和连续性检查点都没有变化。不要重新规划故事，只执行下面这一份紧凑写作包。

先在内部核对场景职责和因果顺序，然后立即输出最终 JSON。必须为最终 JSON 预留至少
8000 tokens，不得把输出预算全部用于推理。按供应方提供的 JSON schema 返回一个完整根对象，
必须闭合全部数组和对象；不要输出推理、Markdown、解释或包装字段。

执行要求：
1. approved_episode_plan、scene_execution_plan、layer_contracts和continuity_checkpoint是硬合同。
2. 严格执行冲突-决定-局部回报-压力升级-退出状态因果链；{ending_instruction}
3. 每场按body_order自然交错可拍动作与对白；不得写镜头语言、心理活动或小说叙述。
4. 全集场景1–5个、对白25–35条、镜头执行单元15–20个、成片75–115秒。
5. characters和所有状态更新必须来自写作包中的人物与已确认事实；状态更新保持简短并标注场次证据。
6. {language_contract}
7. 先保证完整、可解析、可拍，再在既定场景内提高语言和动作质量，不得增加支线。

紧凑写作包：
{json.dumps(recovery_packet, ensure_ascii=False, separators=(',', ':'))}
"""
````

片段 SHA-256：`b24c4f1b25b92215b79e1d5d0fd17d9081bd1a0ca6cd297b36aa804c4ec29001`
