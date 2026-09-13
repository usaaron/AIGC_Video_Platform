# 规则修订建议中的方法文本

编号：`script.revision_method_rules`。状态：`本地规则建议，非独立LLM提示`。

来源：[backend/app/modules/script_engine/revision_planner.py:300](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/revision_planner.py:300)。符号：`RubricRevisionPlanner._revision_method`。

含不可逆决定、升级冲突等偏好；供后续讨论，不混入默认正文模型提示。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 307 行

````text
Introduce concrete unresolved conflict in {scene_scope} while preserving the final twist.
````

### 片段 2 · 源码第 308 行

````text
Replace a reactive beat in {scene_scope} with an irreversible protagonist decision.
````

### 片段 3 · 源码第 309 行

````text
End {scene_scope} on a consequential threat, reversal, or withheld answer.
````

### 片段 4 · 源码第 310 行

````text
Increase opposition and consequences across {scene_scope} without changing unrelated scenes.
````

### 片段 5 · 源码第 311 行

````text
Strengthen the setup-to-payoff emotional turn in {scene_scope} without adding a new subplot.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _revision_method(
        self,
        dimension: StoryQCDimension,
        scene_refs: list[int],
    ) -> str:
        scene_scope = self._scene_scope(scene_refs)
        methods = {
            StoryQCDimension.hook_quality: f"Introduce concrete unresolved conflict in {scene_scope} while preserving the final twist.",
            StoryQCDimension.character_agency: f"Replace a reactive beat in {scene_scope} with an irreversible protagonist decision.",
            StoryQCDimension.cliffhanger_strength: f"End {scene_scope} on a consequential threat, reversal, or withheld answer.",
            StoryQCDimension.conflict_escalation: f"Increase opposition and consequences across {scene_scope} without changing unrelated scenes.",
            StoryQCDimension.emotional_payoff: f"Strengthen the setup-to-payoff emotional turn in {scene_scope} without adding a new subplot.",
        }
        return methods[dimension]
````

片段 SHA-256：`4aed22f3da07598c33bb0da0db6089c1d52624a2be1ae1f685351f1038e3e784`
