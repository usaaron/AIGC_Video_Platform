# 大陆修复共用生产数量任务片段

编号：`script.mainland_count_task`。状态：`上两类修复引用的片段`。

来源：[backend/app/modules/script_engine/generation_service.py:8407](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8407)。符号：`ScriptGenerationService._build_mainland_production_count_task`。

不是独立模型调用。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8435 行

````text
同步校准生产数量：当前{scene_count}场、{dialogue_count}条台词、{shot_count}个动作单元；修订后保留全部{scene_count}场且场景总数必须位于{EPISODE_SCENE_MIN}至{EPISODE_SCENE_MAX}个，dialogues数组合计必须为{EPISODE_DIALOGUE_LINE_MIN}至{EPISODE_DIALOGUE_LINE_MAX}条（{dialogue_target}），character_actions数组合计必须为{EPISODE_SHOT_UNIT_MIN}至{EPISODE_SHOT_UNIT_MAX}个（{shot_target}）。每个dialogues条目必须是演员实际说出的一句台词，每个character_actions条目必须是一个可独立拍摄的动作单元；不得靠拆句、拆动作、重复、复述、空镜或解释性内容凑数。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_mainland_production_count_task(
        *,
        scene_count: int,
        dialogue_count: int,
        shot_count: int,
    ) -> str:
        target_dialogue_count = min(
            EPISODE_DIALOGUE_LINE_MAX,
            max(EPISODE_DIALOGUE_LINE_MIN, dialogue_count),
        )
        target_shot_count = min(
            EPISODE_SHOT_UNIT_MAX,
            max(EPISODE_SHOT_UNIT_MIN, shot_count),
        )
        dialogue_target = (
            f"优先收敛到{target_dialogue_count}条"
            if not EPISODE_DIALOGUE_LINE_MIN
            <= dialogue_count
            <= EPISODE_DIALOGUE_LINE_MAX
            else "保持在该范围内"
        )
        shot_target = (
            f"优先收敛到{target_shot_count}个"
            if not EPISODE_SHOT_UNIT_MIN <= shot_count <= EPISODE_SHOT_UNIT_MAX
            else "保持在该范围内"
        )
        return (
            f"同步校准生产数量：当前{scene_count}场、{dialogue_count}条台词、"
            f"{shot_count}个动作单元；修订后保留全部{scene_count}场且场景总数必须位于"
            f"{EPISODE_SCENE_MIN}至{EPISODE_SCENE_MAX}个，dialogues数组合计必须为"
            f"{EPISODE_DIALOGUE_LINE_MIN}至{EPISODE_DIALOGUE_LINE_MAX}条（{dialogue_target}），"
            f"character_actions数组合计必须为{EPISODE_SHOT_UNIT_MIN}至"
            f"{EPISODE_SHOT_UNIT_MAX}个（{shot_target}）。每个dialogues条目必须是演员实际"
            "说出的一句台词，每个character_actions条目必须是一个可独立拍摄的动作单元；"
            "不得靠拆句、拆动作、重复、复述、空镜或解释性内容凑数。"
        )
````

片段 SHA-256：`d5514da7a5c4fdb1691b907a8cc6d796b5658835e5ef1bb255b6f6eda3413ea5`
