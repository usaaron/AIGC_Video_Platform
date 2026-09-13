# 剧情树质量审阅提示

编号：`planning.tree_quality`。状态：`active_review`。

来源：[backend/app/modules/script_engine/story_planning_service.py:7157](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:7157)。符号：`StoryPlanningService._build_story_plan_quality_prompt`。

全体叶节点索引加代表节点详审；只审不改。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 7167 行

````text
- {node.node_id} v{node.version} [{node.planned_start_episode}-{node.planned_end_episode}] {bounded(node.title, 80)}；冲突={bounded(node.central_conflict, 160)}；结算={bounded(node.unit_resolution, 140)}；后续压力={bounded(node.handoff_pressure, 120)}
````

### 片段 2 · 源码第 7177 行

````text
NODE {node.node_id} v{node.version} [{node.planned_start_episode}-{node.planned_end_episode}] {bounded(node.title, 80)}
作用：{bounded(node.narrative_purpose, 220)}
梗概：{bounded(node.synopsis, 320)}
进入：{bounded(node.entry_state, 180)}
冲突：{bounded(node.central_conflict, 220)}
转折：{bounded('；'.join(node.turning_points), 300)}
因果节拍：{bounded('；'.join(node.unit_story_beats), 360)}
结算：{bounded(node.unit_resolution, 220)}
退出：{bounded(node.exit_state, 180)}
后续压力：{bounded(node.handoff_pressure, 180)}
````

### 片段 3 · 源码第 7192 行

````text
{node.node_id} v{node.version}
````

### 片段 4 · 源码第 7198 行

````text
{market_contract}
你是当前市场路径漫剧的剧情总编审。只做审校，不改写剧情，不生成分集路线图。
所有可读文本必须遵循上述市场契约。

总纲核心：{story_bible.core_premise}
全剧目标：{story_bible.series_goal}
主题：{story_bible.theme}
中心冲突：{story_bible.central_conflict}
结局方向：{story_bible.ending_direction}

{decision_contract}

全体叶节点索引（用于判断重复、升级和整体节奏）：
{leaf_index}

需要详细审校的代表节点：{sample_ids}
{sample_details}

逐个返回上述代表节点且不得遗漏。重点检查：
1. 是否只是复述上一段，核心冲突、行动和阶段兑现是否真正不同。
2. 主角目标、选择和人物关系变化是否有因果依据。
3. 冲突、对手门槛与爽点是否持续升级，而非换词重复。
4. 伏笔、剧情线和结局方向是否得到推进或回收。
5. 进入状态、退出状态和下一段压力是否连续。
6. 已确认作者决定是否被保留；待定项是否仍保持待定，未被规划静默补成事实。
只有会实质影响单集路线图和正文的明确问题才标记 needs_revision；轻微措辞问题必须判定 pass。
issue_codes 使用简短英文标识。needs_revision 必须给出可直接用于局部 AI 修改的中文 repair_instruction，且必须保持节点集数范围和前后边界不变。
只返回符合 schema 的 JSON。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_story_plan_quality_prompt(
        *,
        story_bible: StoryBible,
        leaves: list[StoryPlanNode],
        sampled_leaves: list[StoryPlanNode],
    ) -> str:
        bounded = StoryPlanningService._bounded_planning_text
        leaf_index = "\n".join(
            (
                f"- {node.node_id} v{node.version} [{node.planned_start_episode}-"
                f"{node.planned_end_episode}] {bounded(node.title, 80)}；"
                f"冲突={bounded(node.central_conflict, 160)}；"
                f"结算={bounded(node.unit_resolution, 140)}；"
                f"后续压力={bounded(node.handoff_pressure, 120)}"
            )
            for node in leaves
        )
        sample_details = "\n\n".join(
            (
                f"NODE {node.node_id} v{node.version} [{node.planned_start_episode}-"
                f"{node.planned_end_episode}] {bounded(node.title, 80)}\n"
                f"作用：{bounded(node.narrative_purpose, 220)}\n"
                f"梗概：{bounded(node.synopsis, 320)}\n"
                f"进入：{bounded(node.entry_state, 180)}\n"
                f"冲突：{bounded(node.central_conflict, 220)}\n"
                f"转折：{bounded('；'.join(node.turning_points), 300)}\n"
                f"因果节拍：{bounded('；'.join(node.unit_story_beats), 360)}\n"
                f"结算：{bounded(node.unit_resolution, 220)}\n"
                f"退出：{bounded(node.exit_state, 180)}\n"
                f"后续压力：{bounded(node.handoff_pressure, 180)}"
            )
            for node in sampled_leaves
        )
        sample_ids = "、".join(
            f"{node.node_id} v{node.version}" for node in sampled_leaves
        )
        market_contract = StoryPlanningService._story_bible_market_contract_text(story_bible)
        decision_contract = _creative_decision_prompt_contract(
            list(getattr(story_bible, "creative_decisions", []) or [])
        )
        return f"""{market_contract}
你是当前市场路径漫剧的剧情总编审。只做审校，不改写剧情，不生成分集路线图。
所有可读文本必须遵循上述市场契约。

总纲核心：{story_bible.core_premise}
全剧目标：{story_bible.series_goal}
主题：{story_bible.theme}
中心冲突：{story_bible.central_conflict}
结局方向：{story_bible.ending_direction}

{decision_contract}

全体叶节点索引（用于判断重复、升级和整体节奏）：
{leaf_index}

需要详细审校的代表节点：{sample_ids}
{sample_details}

逐个返回上述代表节点且不得遗漏。重点检查：
1. 是否只是复述上一段，核心冲突、行动和阶段兑现是否真正不同。
2. 主角目标、选择和人物关系变化是否有因果依据。
3. 冲突、对手门槛与爽点是否持续升级，而非换词重复。
4. 伏笔、剧情线和结局方向是否得到推进或回收。
5. 进入状态、退出状态和下一段压力是否连续。
6. 已确认作者决定是否被保留；待定项是否仍保持待定，未被规划静默补成事实。
只有会实质影响单集路线图和正文的明确问题才标记 needs_revision；轻微措辞问题必须判定 pass。
issue_codes 使用简短英文标识。needs_revision 必须给出可直接用于局部 AI 修改的中文 repair_instruction，且必须保持节点集数范围和前后边界不变。
只返回符合 schema 的 JSON。"""
````

片段 SHA-256：`29a6ea34a4c2f3260691f3448a332bab3ef7b9f5db1289cd34d468d957d1d58a`
