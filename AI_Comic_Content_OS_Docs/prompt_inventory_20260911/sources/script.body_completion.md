# 明显截断的正文补全

编号：`script.body_completion`。状态：`非大陆综合验收分支的条件修复`。

来源：[backend/app/modules/script_engine/generation_service.py:8121](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8121)。符号：`ScriptGenerationService._build_script_body_expansion_prompt`。

只有scenes补丁，无单场字数配额，不新增事件，不凑字。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8146 行

````text
BODY-ONLY COMPLETION CONTRACT
The previous episode script appears truncated; its truncation floor is
{guidance.truncation_floor_characters} effective characters.
正文结构和连续性已经通过校验，但当前正文过短：动作与台词合计只有{actual_characters}
个有效字母或数字，低于保守下限{guidance.truncation_floor_characters}。请只补足已经存在的
场景正文，不得改写剧情。当前各场景正文计数为{scene_characters}；没有单场字数配额。
There is no per-scene character quota; there is no per-scene character quota.
偏好范围为{guidance.preferred_min_characters}-{guidance.preferred_max_characters}，以剧情完成
和可拍摄性为准，不要为了凑字数灌水。

只返回一个场景正文补丁JSON，顶层只能有scenes。必须完整返回全部原场景，保持场景编号、数量、
顺序、人物身份、剧情事实、冲突、信息揭示、因果、状态变化、伏笔、结尾悬念和语言路径不变。
每场只返回scene_number、character_actions、body_order、dialogues。通过可拍摄的阻挡、反应、
环境互动、升级交锋、潜台词、打断和已有后果补足正文；不得新增场景、人物、事件、支线、设定、
解释、回顾或旁白。每个动作必须是一个简洁独立的可拍摄单元，不写镜头语言、文学描写或不可见心理。
body_order必须用action:0、dialogue:0这类零基引用保存真实交错顺序，每个动作和对白各引用一次。

已校验的场景正文局部：
{json.dumps(scene_context, ensure_ascii=False, separators=(',', ':'))}

只返回完整场景正文补丁JSON，不要Markdown、分析或说明。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_script_body_expansion_prompt(
        *,
        output: LLMGeneratedDraftMasterScript,
        actual_characters: int,
        guidance: ScriptBodyLengthGuidance,
        scene_characters: list[int],
    ) -> str:
        scene_context = [
            {
                "scene_number": scene.scene_number,
                "purpose": scene.purpose,
                "beat_summary": scene.beat_summary,
                "emotional_shift": scene.emotional_shift,
                "turning_point": scene.turning_point,
                "cliffhanger": scene.cliffhanger,
                "character_actions": scene.character_actions,
                "body_order": scene.body_order,
                "dialogues": [
                    dialogue.model_dump(mode="json")
                    for dialogue in scene.dialogues
                ],
            }
            for scene in output.scenes
        ]
        return f"""BODY-ONLY COMPLETION CONTRACT
The previous episode script appears truncated; its truncation floor is
{guidance.truncation_floor_characters} effective characters.
正文结构和连续性已经通过校验，但当前正文过短：动作与台词合计只有{actual_characters}
个有效字母或数字，低于保守下限{guidance.truncation_floor_characters}。请只补足已经存在的
场景正文，不得改写剧情。当前各场景正文计数为{scene_characters}；没有单场字数配额。
There is no per-scene character quota; there is no per-scene character quota.
偏好范围为{guidance.preferred_min_characters}-{guidance.preferred_max_characters}，以剧情完成
和可拍摄性为准，不要为了凑字数灌水。

只返回一个场景正文补丁JSON，顶层只能有scenes。必须完整返回全部原场景，保持场景编号、数量、
顺序、人物身份、剧情事实、冲突、信息揭示、因果、状态变化、伏笔、结尾悬念和语言路径不变。
每场只返回scene_number、character_actions、body_order、dialogues。通过可拍摄的阻挡、反应、
环境互动、升级交锋、潜台词、打断和已有后果补足正文；不得新增场景、人物、事件、支线、设定、
解释、回顾或旁白。每个动作必须是一个简洁独立的可拍摄单元，不写镜头语言、文学描写或不可见心理。
body_order必须用action:0、dialogue:0这类零基引用保存真实交错顺序，每个动作和对白各引用一次。

已校验的场景正文局部：
{json.dumps(scene_context, ensure_ascii=False, separators=(',', ':'))}

只返回完整场景正文补丁JSON，不要Markdown、分析或说明。"""
````

片段 SHA-256：`65304eb1cbfb88519c5a5179c7ebcf80c2ce898791845a8b7d7e31cfd105259b`
