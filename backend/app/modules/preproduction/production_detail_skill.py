"""Internal production-detail skill used by screenplay and storyboard generation.

The reference production documents are translated into stable rules here.  The
module is intentionally small: it supplies shared language to the existing
generation pipeline instead of creating a second agent with its own memory.
"""

from __future__ import annotations

PRODUCTION_DETAIL_SKILL_ID = "production-detail-director.v1"

PRODUCTION_DETAIL_RULES: tuple[str, ...] = (
    "先说明本场要改变什么，再写人物如何行动；细节必须服务于戏剧变化。",
    "每个节拍都要有目标、阻力、策略变化和结果，至少让信息、关系或主动权发生一项变化。",
    "把抽象情绪翻译成观众能看到或听到的行为：视线、停顿、呼吸、重心、动作中断、声音力度或说话速度。",
    "对白要出于人物此刻想从对方得到什么；不要让双方轮流讲解已经知道的证据、程序和主题。职业能力通过具体追问、取舍和操作体现。",
    "动作必须改变接触机会、物证控制、彼此距离或决策压力。连续推拉物件、移开视线、攥手和停顿若没有新结果，就合并或删去。",
    "重要台词要给出说话意图、重音、停顿与节奏；台词原文和语义不得被改写。",
    "说话者之外的人依照自己的目标和当前记忆状态倾听、反应；分镜只描述构图能覆盖的可见行为，画外反应不得同时当作特写中可见的动作。",
    "镜头时长按真实对白、动作、停顿和反应估计，不强行套用固定秒数。",
    "场景没有明确的信息不能凭空补成事实；不确定内容进入待确认事项。",
    "人物长期表演特征来自表演档案，伤势、知识、位置、关系和当下压力来自记忆系统。",
)


def production_detail_instruction(*, storyboard_translation: bool = False) -> str:
    """Return the shared instruction inserted into existing structured prompts."""

    rules = PRODUCTION_DETAIL_RULES
    if storyboard_translation:
        rules = (
            "本任务只把已写好的本场正文转译为摄影与表演，不重新创作或修订剧情；场景目标、人物意图和状态变化以原文为准。",
            "节拍用于呈现原文已有的目标、阻力、策略与结果，不要求每一拍新增信息、关系或主动权变化，不为补齐表演字段新增人物、事件、目标或台词。",
            rules[2],
            "对白的词句、语义和先后保持原文；通过已有意图安排具体语气、重音、停顿、倾听和反应，不把分镜任务变成重写或重新评判台词。",
            "动作与反应必须保持正文事实、物件控制、位置和先后。相邻动作可合在同镜呈现，但每条正文引用仍须恰好覆盖一次且保持原顺序，不能为了制造变化删改正文。",
            *rules[5:],
        )
    return "制作细化规则：\n" + "\n".join(f"- {rule}" for rule in rules)
