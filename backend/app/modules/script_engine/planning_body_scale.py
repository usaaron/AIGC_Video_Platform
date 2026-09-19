from __future__ import annotations

from app.modules.script_engine.long_story_models import StoryPlanNode


def planning_body_scale_contract(node: StoryPlanNode) -> str:
    """Carry the parent's body allocation into planning without changing events."""
    target = node.estimated_script_body_characters
    start, end = node.planned_start_episode, node.planned_end_episode
    if not target or start is None or end is None or end < start:
        return ""
    episodes = end - start + 1
    average = (target + episodes - 1) // episodes
    return f"""正文规模承载约束：本段第{start}–{end}集，共{episodes}集，承接{target}有效字符正文目标，平均约{average}字符/集。
这统计最终character_actions与dialogues.text里的有效文字和数字，不含标点、空白、标题、梗概、规划、表演说明或记忆账本；规划本身写长不能抵扣正文目标。
按真实戏剧负荷分配篇幅，不要求每集、每场等长。规划应为正文提供足够可演的过程：人物针对当下对象采取什么行动、遭遇什么具体回应、如何调整策略、产生什么可见后果；不要把这一过程缩成“完成核验”“双方交谈”等结果摘要。
时长、25–35句真实对白与正文展开程度须同时满足。对白仍受口播时间约束，动作描写把必要的空间关系、物件变化、阻碍与反应写清，可与对白同时发生；不能把字数目标全部塞进台词，也不能堆无关手势、流程播报、心理解释或重复确认。
尚未批准的规划若容量不足，应明确缺少的行动或因果环节供作者调整；已批准逐集事件、退出状态、出场人物和未决事实不得为了规模自行变更，不提前借用后集事件，不增加集数，不把整个历史缺口压给最后几集。缩短规划传输文本时仍须保留正文需要演出的过程。"""
