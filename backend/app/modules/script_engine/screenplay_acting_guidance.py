"""Migrate the exact historical generated scaffold at the screenplay boundary.

Persisted generation requests retain old application guidance. Updating the
frontend alone must not leave whole-episode edits running obsolete stage rules.
Author text outside this known scaffold is never rewritten.
"""

_LEGACY_RULES = (
    "先说明本场要改变什么，再写人物如何行动；细节必须服务于戏剧变化。",
    "每个节拍都要有目标、阻力、策略变化和结果，至少让信息、关系或主动权发生一项变化。",
    "把抽象情绪翻译成观众能看到或听到的行为：视线、停顿、呼吸、重心、动作中断、声音力度或说话速度。",
    "对白要出于人物此刻想从对方得到什么；不要让双方轮流讲解已经知道的证据、程序和主题。职业能力通过具体追问、取舍和操作体现。",
    "动作必须改变接触机会、物证控制、彼此距离或决策压力。连续推拉物件、移开视线、攥手和停顿若没有新结果，就合并或删去。",
    "重要台词要给出说话意图、重音、停顿与节奏；台词原文和语义不得被改写。",
    "说话者之外的人保持可见的倾听和反应，但反应要服从自己的目标和当前记忆状态。",
    "镜头时长按真实对白、动作、停顿和反应估计，不强行套用固定秒数。",
    "场景没有明确的信息不能凭空补成事实；不确定内容进入待确认事项。",
    "人物长期表演特征来自表演档案，伤势、知识、位置、关系和当下压力来自记忆系统。",
)
_GENERATED_SUFFIX = " 表演指导：人物通过目标驱动的可见行动推进场面，抽象情绪要转成动作、停顿、视线、呼吸、重心或身体任务。"
_LEGACY_BLOCK = "制作细化规则：" + "".join(f"\n- {rule}" for rule in _LEGACY_RULES) + _GENERATED_SUFFIX
_CURRENT_BLOCK = _LEGACY_BLOCK.replace(
    _LEGACY_RULES[1],
    "场面的节拍服从批准的事件与人物目标；允许倾听、迟疑和安静反应，不为每个节拍强加新事实或转折。",
).replace(
    _LEGACY_RULES[5],
    "根据批准的对白任务创作人物此刻会说的话，保持事实与人物声音；表演提示只补充可演的语气、重音或停顿。规划措辞不是必须保留的台词原文。",
)


def current_screenplay_acting_guidance(instruction: str) -> str:
    return instruction.replace(_LEGACY_BLOCK, _CURRENT_BLOCK)
