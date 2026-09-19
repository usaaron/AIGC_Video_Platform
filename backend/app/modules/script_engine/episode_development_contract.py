"""Keep model-authored episode ownership intact through transport chunking."""

from __future__ import annotations

import json

from app.modules.script_engine.long_story_models import StoryPlanNode, StoryPlanNodeGenerationOutput
from app.modules.script_engine.planning_errors import StoryPlanningInputError

EPISODE_CONSTRAINT_SCOPE_CONTRACT = (
    "历史分集执行约束保留来源集，不是自动生效的当前集禁令。‘本集’指来源集；"
    "局部出场、暂缓揭示、暂不完成只限定那一集，当前集以批准事件分配为准。"
    "持续事实、永久代价和仍未解决的条件继续有效，不能借局部约束到期抹去它们。"
    "旧客户端未标来源的附加要求须对照已发生状态核实作用范围，不能升级为永久禁令。"
)

CAUSAL_PRECONDITION_CONTRACT = (
    "【资源交接因果合同】同一时段的人物、关键物件和持续责任不能被重复占用。"
    "人物离开原有看管、陪同、工作或履约职责去做另一件事前，必须安排确实成立的交接、替代或时间错开；"
    "不能用‘临时安顿’‘一切安排好’隐去仍然存在的缺口。答应代为工作不等于答应承担其私人责任；"
    "许可、承诺与实际履行是不同状态：批准离开只改变许可，不自动解除持续责任；"
    "须在离开前明确由有能力且有时间的承担者实际接手，或事先调整任务使该责任不再产生。"
    "补记录、签确认或获准办理不能替代被记录的实际动作；退出状态只能写事件中已经成立的结果。"
    "已经完成的行为不能再靠事后请求获得其事前条件。场景时段按因果先后排列，"
    "未履行的付款、交接、签署和证明取得须在首次使用其结果前有实际动作及可见凭据。"
)

ESTABLISHED_STATE_EXECUTION_CONTRACT = (
    "【既成事实与本次增量】每一集及每一场都先把前文已经实际发生的行动及其仍有效后果作为起点，"
    "再判断批准事件中还有哪一部分尚未发生。逐集进入/退出摘要未重述某事实，不等于撤销该事实。"
    "来源事件和退出状态可能同时包含继承的背景与本次新增后果：前者继续成立，只有后者需要本集演出；"
    "逐字保留来源不要求把其中已发生的动作重新当成首次完成。"
    "同一对象、同一作用范围的持有、知情、许可、履行或失去，未有明确改变原因前不能复位再演。"
    "后续通知、确认或正式追责可以造成新后果，但不能把此前已经产生的同一限制重新写成刚刚发生。"
    "如声称作用范围扩大，必须从已有记录指出此前仍开放的具体部分，不能临时虚构剩余通路制造升级。"
    "只读、离线、私下等信息边界继续有效；外部人物只能凭其已经取得的信息行动，"
    "时间相邻不能让对方自动获知私下行为。先在本次构思中区分继承状态和新增行动，再写场景。"
    "不能把同一核对或选择用‘初步’‘最终’拆成两场重复完成；"
    "后一场若没有不同的行动、后果或具体人物理解，就在本次规划中合并，场数服从实际戏剧工作。"
)

KEY_OBJECT_CUSTODY_CONTRACT = (
    "【关键物件保管链】对会影响后续取证、交易、权限或人物选择的实物与数字材料，"
    "先判断信息实际以口头陈述、个人自记记录还是已存在的文件或数字材料呈现；‘说明’‘确认’等动作名称不自动代表一份文件。"
    "口头陈述不能直接变成陈述者持有的原件，他人听后自记的笔记也不是陈述者签发的证明。"
    "若批准事件需要一份此前尚不存在的材料，必须在首次使用前或同场实际写出制作、确认或签发的动作及责任人，不能在证据要求中仅称它已经摆在桌上。"
    "再区分具体载体的原件、复制件、拍照件、哈希记录和访问凭证，按事件顺序维护当前保管人和控制权。"
    "发现、查看、复制、收存、携带、移交、拒交、封存、遗失或销毁时，必须写清是哪一种形态以及动作后由谁控制；"
    "‘收存’‘保留’‘带去’等词不能隐含原件已经转手。若原件仍由甲控制，乙随后不能携带、拒交或处分该原件，"
    "除非中间明确发生有效移交；多人同时使用时必须说明使用的是副本、共同在场查验，或其他不冲突的成立方式。"
    "物件形态和保管人发生变化时，同步反映到逐集梗概、退出状态和后续动作；没有变化原因时不得静默切换。"
    "证据链重组、目录列明或引用来源不等于把所引用的全部实物搬到现场。"
    "逐件区分当前可操作的载体与仅可引用的封存或异地材料：后者通过已有编号、核验记录和保管信息关联，"
    "不能因上层把它列入证据链，就在下层凭空摊开、携带或交付该载体，也不额外制造一份未制作的副本。"
)

CHARACTER_CONDITION_RESPONSE_CONTRACT = (
    "【人物条件闭环】先明确条件由谁提出、约束谁、依据什么已发生事实、谁有能力履行或解除，以及实际限制哪一步行动。"
    "风险提醒、单方要求与已经生效的规则是不同状态，不能自动互换；被要求者不因受到指控就拥有撤回他人指控的能力。"
    "首次依赖某项申请、争议、承诺或限制前，先建立其发起者、对象及有效状态，不能把未经发生的前提写成既有事实。"
    "多个程序按发起者、处理对象、目的、权限与实际进度区分，不能只因名称相近就合并状态；针对既有决定提出的新异议或复核申请，不等于此前审查尚未启动。"
    "反过来，也不能用换一个程序名称或凭空编造编号撤销旧限制；旧事项未解决时继续保留，新事项写清与它的关系。"
    "人物提出会约束后续行动的要求、承诺条件、威胁或交换时，必须安排接受、拒绝、修改、暂缓中的明确回应，"
    "并写出可观察后果。若本段有意保留未决，须在当集退出状态中明确谁尚未回应、这如何限制下一步；"
    "后续事件不得把单方面要求直接当成双方已经同意的关系状态，也不得让该条件无结果消失。"
    "同一行动有多项前置时，逐项落实；满足其中一项不代表其他条件解除。改走另一条路径也须有已成立的权限或可行依据，"
    "并保留尚未解决的后果。既定边界只要求保留一般风险时，不要临时增设无法在本段兑现的硬性前置来制造阻力。"
)

CHARACTER_KNOWLEDGE_ACCESS_CONTRACT = (
    "【人物获知依据】作者和观众已知不等于每个角色已知。人物据某信息追问、记录、指认或作决定前，"
    "先核对其通过当时实际可见、可听、已收到的材料或明确转述获知了什么。"
    "在场不自动等于听见私语，看到交谈不等于知道内容，听到反问不等于听到此前的要求。"
    "跨场景知情转移须在实际行动或对白任务中落实有效传递；若只获得片段，记录和判断也止于片段，"
    "人物前往此前未知的私下会面地点、点名索取未向其公开的材料，同样需要成立的到访与获知依据；在已授权事件内安排必要通知或邀请，不以职业身份替代信息传递。"
    "推测须保留为推测。梗概、证据要求或退出状态写了‘已知’‘记录’不能替代获知过程；"
    "后续已经公开的内容也不能倒推人物此前已知。普通转述可以在批准事件内完成，"
    "不得为补知情链提前揭示保留的秘密或改写既定人物选择。"
)

STORY_RESOLUTION_OBLIGATION_CONTRACT = (
    "【收束职责逐项落位】ending_direction 只是全剧结局摘要，不是其余已确认职责的白名单。"
    "编排与修订时同时核对 story_lines.planned_resolution、character_arc_targets 的 internal_need、"
    "target_state 和 protected_traits，以及 relationships.target_direction；不能因结局摘要未重述某个人物或支线，就省略其已确认结果。"
    "先按已批准阶段划分这些职责：当前段到期的结果必须落在具体事件及其实际后果上，"
    "尚属后段的保留明确承接，已经完成的保留事实而不重演。覆盖全剧或最终阶段时，须逐项核对前段实际已完成的结果，"
    "将其余到期职责安排在本段已有因果链的适当事件中；不能用‘责任链闭合’‘关系回暖’等集体结论替代每个必需结果。"
    "同时核对进入状态中仍限制结局行动的有效审查、禁令、承诺及证据控制：已有事件解除或并转的写清处理结果，"
    "继续有效的保留承接，不能因新程序开始或摘要省略就默认旧限制失效；不强迫无关细节逐一结算。"
    "人物说明自身动机、作出选择、承担后果是不同职责；若总纲同时要求，不能以其中一个代替其余。"
    "在同一次生成内先完成职责分配再交付事件表，不另写覆盖报告，不新增模型轮次；"
    "本集下层只执行已分配职责，不擅自挪入后段结局。作者明确保留的开放结局或暂缓决策继续有效，不强迫所有关系圆满。"
)


EPISODE_DEVELOPMENT_CONTRACT = """【叶节点逐集事件分配：在同一次上层规划中完成】
覆盖8—12集的叶节点必须返回 episode_developments，按真实集号逐集列出完整范围；更大的待拆节点返回空数组。
先从整段进入状态编排到结算的完整因果过程，再展开每集；不能在第一批请求用完整段剧情。
进入状态中的成果就是本段已经具备的前提，包含其实际持有、知情、公开、获准或履行状态。后续事件从这一状态继续发生，不把已获得、已公开或已完成的成果退回待取得、待揭示或待完成，再重演取得过程。新增损害只改变其实际影响的部分；若要撤销已有成果，必须有本段真实发生且足以造成该改变的原因，未受影响的成果继续有效。这条状态继承约束同时适用于相邻节点和相邻集。
退出状态是累计到此刻的有效事实和未解决条件，不只是本集最新动作的摘要。先承接仍会影响后续的阻力、资源缺口、未履行承诺和永久变化，再写本集真正造成的改变；只有本段事件实际解决了某项条件，后续状态才可将其解除。若后续行动依赖资源到位、许可取得、人物同意或义务履行，必须在事件表中安排使其成立的行动与结果，不能让此前明确的缺口从状态中淡出，再用“全部就绪”“已同意”跳过成立过程。
作者确认的世界真相与人物当前知情分开。首次使用某项关键线索时，事件本身写清谁通过什么已存在的接触、记录或亲历得知；证人的职业、亲属身份和“知情人”标签不能代替具体获知依据。调查者尚不知材料存在时，先演出线索出现与追索，再取得材料；已经知道来源但尚未持有时，只补取得过程，不重复发现。把必要的获知动作写在使用线索之前或同一事件内，不能新增一个无来由的知情者替主角直接给答案。
模型传输只写一份事件文本：unit_story_beats 按因果顺序列出本节点事件，最多12项；turning_point_indices 用从1开始、且不超过本节点事件总数的整数索引选择重要转折，不再输出 turning_points 文本数组。拆分子节点的事件表为4—12项；同集紧密相连的动作及其直接后果作为同一事件描述，不能把多集事件合成一项来满足数量限制。
每项逐集安排只含 episode_number、synopsis、exit_state、source_event_indices。source_event_indices 只引用同一个输出节点 unit_story_beats 的从1开始的索引，不引用父节点、技术根、总纲或兄弟节点。运行时按索引恢复原文来源，并从上集退出状态承接本集进入状态；这些重复文本不要再次生成。
synopsis 用约40—100个中文字说明本集具体行动及结果；平静的关系发展、尝试、铺垫和情绪体验均可，不强迫反转。
不得把同一动作拆成多集重复确认、等待或提醒。后集必须接住前集已发生的后果。不能支撑容量时，应在本层发展真实的中间因果，不能留下空集让下层临时补故事。
首集实际从节点 entry_state 出发，后集实际从上集 exit_state 继续；末集 exit_state 逐字等于节点 exit_state。不要在逐集项内输出 entry_state 或两个旧 source 文本数组。
先写本节点唯一的事件表，再选择重要事件索引，最后将每个事件索引分配一次到实际发生它的集数。转折和逐集来源共享同一事件，避免同一选择出现不同发起人、动机或结果。
unit_story_beats 每条是可以在同一集实际完成的具体动作及后果；若一句概括包含分属多集的事件，应先在本节点拆清事件，再分配，不能将整句引用挂到末集而提前演完其中一部分。新增的重要选择、线索取得、不可逆代价或通路变化也要进入本节点事件表，不能只藏在某集梗概里。
source_event_indices 由事件的实际发生位置决定，不按集号或索引机械均分；中间发展可以返回空索引数组。所有事件索引在本节点逐集数组中合计恰好出现一次；同一选择或结果不能演出两遍。
最后一个 unit_story_beat 只在末集实际发生。前集梗概与退出状态不得提前完成它，不能只把引用留到末集。
每项退出状态必须由本集真实行动或已建立事实支持。结算里任何新增的许可、安排、资源或关系结果，都要在逐集因果过程中获得成立依据；不能仅为匹配结算承诺就称其“已有”“保留”“完成”。没有产生过程的结果，应在本层安排合理行动，或删除未经作者要求的多余承诺，不让下游假定其已成立。
把已批准世界规则的触发条件与规定后果绑定在事件表的同一事件中：每触发一次，就写明该次新增的具体后果及其对退出状态的影响。已付过的代价不能抵扣下一次触发的后果，永久变化必须由后续状态继续承接。仅在已批准规则确有要求时落实这项义务，不为普通生活事件强加损失或反转；规则允许延后发生的后果应明确其条件和归属。
输出前在同一次创作中核对事件表、逐集梗概与状态三者：事件实际发生集号必须等于引用归属，条件先于结果，后集承接已经发生的变化而不重复完成；发现冲突时先修正本层方案再交付。正确索引本身不能代替因果成立。
后续节点的事件不能在本段提前执行。每集展开时其事件归属和进入/退出状态不可变。
这份逐集分配单独计量，不压进节点概述的350—650字参考；不写分场、对白或镜头。
""" + "\n" + CAUSAL_PRECONDITION_CONTRACT + "\n" + ESTABLISHED_STATE_EXECUTION_CONTRACT + "\n" + KEY_OBJECT_CUSTODY_CONTRACT + "\n" + CHARACTER_CONDITION_RESPONSE_CONTRACT + "\n" + CHARACTER_KNOWLEDGE_ACCESS_CONTRACT + "\n" + STORY_RESOLUTION_OBLIGATION_CONTRACT


def validate_episode_developments(
    node: StoryPlanNode | StoryPlanNodeGenerationOutput, *, required: bool = False,
    require_canonical_events: bool = False,
) -> None:
    if require_canonical_events and any(value not in node.unit_story_beats for value in node.turning_points):
        raise StoryPlanningInputError(
            "剧情转折必须逐字选自本节点事件表，不能另写同一事件的不同版本；请在首次规划中统一事件后再交付。"
        )
    entries = getattr(node, "episode_developments", [])
    start, end = node.planned_start_episode, node.planned_end_episode
    is_leaf = start is not None and end is not None and 8 <= end - start + 1 <= 12
    if not entries:
        if required and is_leaf:
            raise StoryPlanningInputError("剧情叶节点缺少逐集事件分配，请先在剧情规划中补全 episode_developments；不能让分批生成临时决定整段事件归属。")
        return
    if not is_leaf or [entry.episode_number for entry in entries] != list(range(start, end + 1)):
        raise StoryPlanningInputError("episode_developments must cover the 8-12 episode leaf exactly in order.")
    previous = node.entry_state
    for entry in entries:
        if entry.entry_state != previous:
            raise StoryPlanningInputError(f"Episode {entry.episode_number} development must inherit the preceding exit_state verbatim.")
        previous = entry.exit_state
    if previous != node.exit_state:
        raise StoryPlanningInputError("Final episode development must deliver the node exit_state verbatim.")
    if len({entry.synopsis.strip() for entry in entries}) != len(entries):
        raise StoryPlanningInputError("Episode developments cannot repeat the same synopsis.")
    # Local import keeps model types independent of the runtime validators.
    from app.modules.script_engine.episode_plan_contracts import _validate_approved_event_distribution
    for field, approved in (("source_turning_points", node.turning_points), ("source_unit_story_beats", node.unit_story_beats)):
        _validate_approved_event_distribution(approved, [value for entry in entries for value in getattr(entry, field)], require_complete=True, label=field)
    beat_owners = {value: entry.episode_number for entry in entries for value in entry.source_unit_story_beats}
    if any(
        value in beat_owners and beat_owners[value] != entry.episode_number
        for entry in entries for value in entry.source_turning_points
    ):
        raise StoryPlanningInputError("同一事件的转折与节拍引用必须属于同一集，不能在不同集重复完成。")
    if node.unit_story_beats and node.unit_story_beats[-1] not in entries[-1].source_unit_story_beats:
        raise StoryPlanningInputError("The terminal unit-story beat belongs to the final episode development.")


def episode_development_prompt(node: StoryPlanNode, numbers: list[int] | None = None) -> str:
    if not getattr(node, "episode_developments", []):
        return ""
    entries = [entry.model_dump(mode="json") for entry in node.episode_developments if numbers is None or entry.episode_number in numbers]
    return (
        "\nApproved episode event ownership for this response:\n<episode_developments>"
        + json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
        + "</episode_developments>\n"
        "These are the executable episode boundaries. Expand ONLY the events assigned to each episode into scenes. "
        "Copy its entry_state, exit_state and both source arrays exactly. Its synopsis may gain presentation detail, "
        "but cannot perform later events, merge episodes or reallocate the story. The full node synopsis is context, "
        "not a list to execute in this response. Each scene must stay inside its episode's approved entry/exit states.\n"
        + ESTABLISHED_STATE_EXECUTION_CONTRACT + "\n"
    )
