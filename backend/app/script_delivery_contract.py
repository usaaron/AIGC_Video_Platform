from __future__ import annotations

import re
import unicodedata
from enum import Enum
from typing import Any


SCRIPT_MODIFICATION_INSTRUCTION_MAX_LENGTH = 4_000


_ENDING_MODE_ALIASES: dict[str, str] = {
    # Continuing/serial episodes.
    "serial": "serial_hook",
    "serialhook": "serial_hook",
    "continuing": "serial_hook",
    "continuingepisode": "serial_hook",
    "ongoing": "serial_hook",
    "regular": "serial_hook",
    "regularepisode": "serial_hook",
    "连载": "serial_hook",
    "连载集": "serial_hook",
    "连载钩子": "serial_hook",
    "普通集": "serial_hook",
    "常规集": "serial_hook",
    "非最终集": "serial_hook",
    "非终局集": "serial_hook",
    # Season finales.
    "seasonfinale": "season_finale",
    "seasonfinal": "season_finale",
    "seasonfinaleclosing": "season_finale",
    "seasonfinaleend": "season_finale",
    "seasonend": "season_finale",
    "seasonending": "season_finale",
    "seasonclosing": "season_finale",
    "季终": "season_finale",
    "季终集": "season_finale",
    "季终收束": "season_finale",
    "本季终": "season_finale",
    "本季收束": "season_finale",
    "季末": "season_finale",
    "季末集": "season_finale",
    # Series finales.
    "seriesfinale": "series_finale",
    "seriesfinal": "series_finale",
    "seriesfinaleclosing": "series_finale",
    "seriesfinaleend": "series_finale",
    "seriesend": "series_finale",
    "seriesending": "series_finale",
    "seriesclosing": "series_finale",
    "剧终": "series_finale",
    "剧终集": "series_finale",
    "全剧终": "series_finale",
    "全剧收束": "series_finale",
    "全剧最终集": "series_finale",
    "大结局": "series_finale",
    "全剧大结局": "series_finale",
    "最终集": "series_finale",
    "完结篇": "series_finale",
    "收官": "series_finale",
}


def _ending_mode_token(value: str) -> str:
    """Normalize presentation-only spelling around a closing-mode label."""

    token = unicodedata.normalize("NFKC", value).strip().casefold()
    # Providers sometimes append a bilingual explanation in parentheses. It
    # is metadata, not part of the mode; remove it before alias lookup.
    token = re.sub(r"[\[(\u3010\uff08].*?[\])\u3011\uff09]", "", token)
    return re.sub(r"[\s_\-—–/\\|:：，,。;；]+", "", token)


class EndingMode(str, Enum):
    """How an episode is allowed to close.

    ``serial_hook`` is the legacy/default behaviour.  The two finale modes are
    deliberately additive so old payloads keep the existing cliffhanger
    contract while a series can opt into an honest resolution.
    """

    serial_hook = "serial_hook"
    season_finale = "season_finale"
    series_finale = "series_finale"

    @classmethod
    def _missing_(cls, value: object) -> "EndingMode | None":
        """Accept common bilingual labels emitted by unconstrained LLMs.

        The persisted/API representation remains one of the three canonical
        enum values. Unknown prose still returns ``None`` so callers retain
        the legacy serial-hook fallback instead of guessing a finale.
        """

        if not isinstance(value, str):
            return None
        alias = _ENDING_MODE_ALIASES.get(_ending_mode_token(value))
        return cls(alias) if alias is not None else None


DEFAULT_ENDING_MODE = EndingMode.serial_hook


def ending_mode_requires_hook(mode: EndingMode | str | None) -> bool:
    """Return whether the final scene must carry a serial continuation hook.

    Missing/unknown values intentionally preserve the legacy contract.  This
    helper is shared by validation and prompt/export layers so they cannot
    silently disagree about finale behaviour.
    """

    try:
        normalized = EndingMode(mode or DEFAULT_ENDING_MODE)
    except (TypeError, ValueError):
        normalized = DEFAULT_ENDING_MODE
    return normalized == EndingMode.serial_hook


def ending_mode_requires_next_question(mode: EndingMode | str | None) -> bool:
    """Return whether ``next_episode_question`` is required for this ending."""

    return ending_mode_requires_hook(mode)


def normalize_finale_legacy_fields(
    value: Any,
    *,
    require_legacy_obligation: bool = False,
    include_legacy_hook_type: bool = True,
) -> Any:
    """Keep legacy roadmap fields usable when a finale omits hook prose.

    The first versions of the roadmap contract made ``cliffhanger`` mandatory
    even for a closing episode.  A model is now allowed to omit that obsolete
    field, but downstream v1 consumers still expect a string slot.  Populate
    it from the approved resolution/exit evidence before Pydantic validates
    the old shape.  This is a transport compatibility shim, not a new story
    decision: the three-layer contract still checks the real resolution fields.
    """

    if not isinstance(value, dict):
        return value
    normalized = dict(value)
    raw_mode = normalized.get("ending_mode")
    try:
        mode = EndingMode(raw_mode or DEFAULT_ENDING_MODE)
    except (TypeError, ValueError):
        mode = DEFAULT_ENDING_MODE
    # Normalize aliases and explicit null/unknown legacy values before the
    # strict Pydantic enum field sees them. Unknown values deliberately keep
    # the safe historical serial contract rather than guessing a finale.
    if raw_mode is None or not isinstance(raw_mode, EndingMode) or raw_mode != mode.value:
        normalized["ending_mode"] = mode.value
    if ending_mode_requires_hook(mode):
        return normalized

    def _text(candidate: Any) -> str:
        return candidate.strip() if isinstance(candidate, str) else ""

    if not _text(normalized.get("cliffhanger")):
        closure = next(
            (
                _text(normalized.get(field_name))
                for field_name in (
                    "episode_payoff",
                    "exit_state",
                    "turning_point",
                    "resolution",
                    "unit_resolution",
                )
                if len(_text(normalized.get(field_name))) >= 5
            ),
            "本集完成正式收束。",
        )
        normalized["cliffhanger"] = closure

    if include_legacy_hook_type and not _text(normalized.get("ending_hook_type")):
        normalized["ending_hook_type"] = "正式收束"

    if require_legacy_obligation and not _text(
        normalized.get("next_episode_obligation")
    ):
        normalized["next_episode_obligation"] = (
            "本集完成正式收束；后续内容仅按已批准方向承接。"
        )
    return normalized


EPISODE_RUNTIME_MIN_SECONDS = 75
EPISODE_RUNTIME_MAX_SECONDS = 115
EPISODE_RUNTIME_PREFERRED_MIN_SECONDS = 90
EPISODE_RUNTIME_PREFERRED_MAX_SECONDS = 105
EPISODE_SCENE_MIN = 1
EPISODE_SCENE_MAX = 5
EPISODE_DIALOGUE_LINE_MIN = 25
EPISODE_DIALOGUE_LINE_MAX = 35
EPISODE_SHOT_UNIT_MIN = 15
EPISODE_SHOT_UNIT_MAX = 20
SERIES_RUNTIME_MIN_MINUTES = 100
PARTNER_SCREENPLAY_FORMAT_VERSION = "partner_screenplay.v1"
PARTNER_SCREENPLAY_CONTENT_TEMPLATE_VERSION = "partner_screenplay.content_complete.v1"
OVERSEAS_DIALOGUE_VOICE_CONTRACT = (
    "【英文对白首稿口语合同】\n"
    "Write the English as an original scene performed by these specific people. Then translate each finished line into Chinese. "
    "Use the approved voice, relationship and immediate want to choose what each person says; let the other person's last move cause the reply. "
    "The plan describes what must happen, not the words to say. Its labels, evidence requirements and agreement checks belong backstage. "
    "Show their outcome through ordinary conversation and action.\n"
    "Spoken register: prefer familiar verbs, contractions and context-dependent references when the object is already visible. "
    "A person can ask 'What have we got?' without saying 'Let us verify the current available resources.' "
    "A reluctant agreement can be 'All right. But I'm staying.' without a declaration that a procedure is accepted. "
    "These are register examples, not dialogue to copy or new facts to import. Formal characters may be precise and restrained; "
    "they still speak idiomatically, and everyone must not sound like the same procedural narrator. "
    "Do not stack administrative modifiers onto an everyday object or use an unfamiliar collocation to sound distinctive. "
    "If unsure, use the simplest ordinary phrase that keeps the meaning.\n"
    "Subtext example for technique only: 'You said you'd wait.' / 'I am waiting.' / 'With your coat on?' / 'It's cold.' "
    "The replies respond, evade and press without explaining their intentions. Build the present scene's own exchange from its actual facts; "
    "do not copy this exchange, add its history or force jokes, slang, insults or cleverness onto a character. "
    "A character's established pressure response must be audible in their choices and rhythm, not merely written in intent.\n"
    "Before returning this single response, read the exchange silently as spoken English. Replace literal Chinese syntax, "
    "bureaucratic phrasing, repeated explanations, incorrect articles and unnatural verb-noun pairings. "
    "Then compare every Chinese line to its English source: the same time, quantity, negation, condition, certainty and intention. "
    "Translate idioms by their meaning; do not translate an English metaphor word for word or add an explanation or story fact. "
    "No accidental English fragments in Chinese; names use the approved mapping. Count only English toward spoken runtime. "
    "Return the finished scene in the required JSON, with no commentary or extra review pass."
)


SHORT_DRAMA_PACING_CONTRACT = (
    "【快节奏短剧统一标准】本项目是短剧，几乎每集都应迅速进入眼前目标和阻力，"
    "用紧凑的行动与有效交锋持续推进；强情绪、激烈冲突、直接表达、短促反击和密集攻防均可成立。"
    "不能套用长剧的慢铺垫标准，仅因表达激烈、对白密集或留白少就降强度、减台词或判低质。"
    f"每集对白总数保持{EPISODE_DIALOGUE_LINE_MIN}–{EPISODE_DIALOGUE_LINE_MAX}句，"
    "首段、中段、后段和终局采用同一范围；不得因集号靠后、累计篇幅较多或接近收束而逐步减量。"
    "在范围内按本集真实戏剧负荷安排，不把下限当作统一目标，也不要求后集机械多于前集。"
    "规划阶段就要安排足够的动机、阻力、回应、选择和后果来承载对白，"
    "不能把多集排成同一人的重复核验，再让正文靠工作录音、复述操作、拆句或新增秘密凑数。"
    "交锋中的追问、否认、打断、回避、反击和让步应承接对方刚说或刚做的事，"
    "使压力、认知、关系或行动发生有依据的变化；不要求每句揭示新事实或每场强行反转。"
    "必要的无对白动作或短暂停顿可以服务于冲击、选择和下一步行动，整集仍须满足对白范围与推进要求。"
    "中后段和终局必须完整演出已批准的关键交锋、人物反应、代价和兑现，不用结果摘要代替。"
    "时长修复优先收紧冗余措辞、重复说明和动作描述，保留有效攻防；"
    "若规划承载不足，定位受影响的上游事件或执行蓝图修订，不降低对白范围，也不擅自改写批准事实。"
)


SCREENPLAY_FIRST_PASS_CONTRACT = SHORT_DRAMA_PACING_CONTRACT + "\n" + (
    "【本次响应直接交付合格首稿】先锁定每场获准新增的事实、必须完成的动作、人物当时已知信息和退出结果，"
    "再写人物为达成眼前目的如何行动、对方如何回应、局面因此如何变化。规划字段说明场面的作用，"
    "不提供人物必须照念的措辞。不要将信息核验、同意条件和人物成长写成轮流宣读流程或总结感悟。"
    "集号、规划字段名和生成要求属于制作信息，不得写成人物台词、故事内文书标题或可见事实。"
    "已知行动与成果直接承接；尚未确定的事实维持未定。必须具体展示但未指定类别、数量、日期或条款时，"
    "用指认、并置、可见差异和当事人的有限表述完成，不擅自填出会影响后文的答案。"
    "把具体性放在人物动作、空间阻力、反应与选择代价上。表演提示只写可演出的语气或行为。"
    "中后段与终局同样完整展开本集已批准的必要交锋、选择、反应与兑现过程；不得因集号靠后、"
    "已写篇幅较多或接近收束而改成简短结果摘要。短暂停顿须有当下作用，不能靠拆句、报账或重复填量。"
    "在这一次输出定稿前核对：每个结果有先行动作，场景边界没有越过，人物声音不混同，台词有回应关系，"
    "口播留足停顿且不超目标时长，账本与真实正文一致。发现问题就在本次响应内改好，只返回最终JSON。"
    "\nFact priority for this first draft: approved episode/scene facts and established prior memory outrank "
    "generic drama templates, realism suggestions and invented specificity. Formatting quantities, runtime and "
    "character ages are not order quantities, transaction dates or other story-world facts. Do not supply "
    "unstated product identities, amounts, deadlines, payment dates or technical diagnoses. When the approved "
    "event establishes only a visible mismatch, enact that mismatch without guessing its exact contents. "
    "Write playable actions and genuinely responsive lines inside these factual limits. "
    "Before finalizing this response, check every claim about what happened off screen, why a resource is missing, "
    "who caused a problem, an exact time, a weekday, a fraction, a quantity or a transaction condition. "
    "It must be supported by the approved scene or prior memory, not merely plausible in this setting. "
    "If the source leaves it unspecified, leave it unsaid; the character can still press, refuse, evade or agree "
    "using the established situation. Do not convert a character's fear into a new established cause or measured shortage."
)

DRAFT_MODIFICATION_CONTRACT = SHORT_DRAMA_PACING_CONTRACT + "\n" + (
    "Create one complete replacement candidate. The author's latest explicit goal takes precedence "
    "over templates and the editable source draft. Preserve approved story/scene plans, character "
    "identity and facts established BEFORE this episode unless the reviewed instruction authorizes a change. "
    "SourceDraftMasterScript is the text being edited, NOT an independent canon or prior-memory source. "
    "Its current-episode invented details, translations, synopsis, hook and exit ledgers are equally editable; "
    "their repetition in source fields does not make them established facts. Rebuild affected ledgers from "
    "the revised actual body. Follow the requested scope: a whole-body rewrite requires newly executed "
    "scenes and dialogue from the approved blueprint, not a copied source with isolated word changes; "
    "a local edit preserves unrelated text. Correct model-invented contradictions with approved plans "
    "without treating those errors as locked history. Do not add new plot obligations or silently change "
    "approved upstream facts. Preserve valid causal consequences and the approved ending mode. "
    "Return the complete JSON candidate only, never a patch, commentary or alternatives."
)

SCREENPLAY_EXECUTION_ORDER_CONTRACT = (
    "body_order使用零基action:0、dialogue:0引用，每条动作与对白恰好一次。按真实发生的顺序安排，"
    "人物入场或已建立可听通道之后才能回应；先实际展示、读取、写出、递交或接过，才说依赖该动作完成的话。"
    "不要按数量等距插排；连续多句对白或多个动作都可以。引用编码只出现在body_order，"
    "character_actions和dialogues.text中不抄action:0、dialogue:0等引用前缀。"
    "intent仅写演员可表演的语气或动作提示，不写编导目的、程序要求或心理解释。"
    "对同一次技术动作核对实际操作者、身体动作与工具、开始和完成时点；同一数值、差值、单位和完成程度"
    "在character_actions、intent、对白、中文译文、梗概与状态账本中保持一致。"
    "局部尝试、准备就绪与完整完成不能互换；核对已有事实与已写动作，不借此补造来源未确定的精确量值。"
    "已批准场景中的information_shift、visible_action和exit_state同时限定本集新增的信息与结果。"
    "在这些边界内展开动作、阻力、人物反应和语言，不自行补出会改变后续因果的材料品类、精确数量、"
    "付款或交付日期、证据条款、权利归属及责任结论；当前只发现异常时，就保留异常，不能替后续核验先给答案。"
    "尚未完成的任务不能借新编台词写成已完成；前集已完成的补救和已知信息直接承接，不重做、不重新发现。"
    "账本、梗概和钩子只登记本集真正演出的事实，不为增强尾钩另造新缺货、失窃、秘密或额外义务。"
    "【人物出场与状态边界】scene_execution_plan 的 character_refs 只表示本场当前可见或可闻的现场人物；"
    "被调查、提及、材料引用、失踪或下落未明的对象，不能因 episode-level character_refs、Story Bible、"
    "旧 memory capsule、旧 location、alive 状态或职业标签自动进入现场名单。回忆、录音、远程、照片、档案"
    "等媒介出场必须由批准路线明确标识；没有该标识时，把对象保留在 evidence_requirements、"
    "continuity_requirements 或对白的调查对象中。每个 scene ref 都要能在本场 approved visible_action 或"
    "evidence_requirements 中找到当前可见/可闻依据；状态账本只能记录 body_order 实际演出的动作和结果。"
    "来源集号、priority 和 mandatory 只说明记忆来源与审校优先级，不把旧人物状态升级为本集在场事实；"
    "若旧状态与本集批准边界冲突，保留旧历史并以本集批准 scene refs、禁令和下落状态为准，先报告"
    "scene_presence_conflict，再交付正文，不自动删改历史或捏造新的现场人物。"
)
OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT = (
    "海外路径每一集都必须遵守同一语言与人物身份合同。OutputLanguage=en表示"
    "dialogues.text使用自然、简洁、可表演的英文。所有正式人物名只使用已确认的稳定英文名："
    "characters.name、dialogues.character_name、character_state_updates.character_name、"
    "出场人物和人物关系中的姓名，以及中文动作、表演intent、叙事与中文译文里提到的人名，"
    "都逐字沿用同一英文名，不音译、不加中文名或中英双名。其余创作者可见叙事文字，"
    "包括title、logline、synopsis、hook、episode_goal、next_episode_question、人物资料说明、"
    "人物与关系状态说明、场景标题、动作、画面描述、因果字段与表演intent，首次输出"
    "直接使用简体中文，不得先生成英文再整集翻译。每条dialogues.chinese_translation"
    "必须在同一次输出中写该句准确、自然的简体中文对照，语义、语气、称谓和信息量一致，"
    "提到已命名人物时保留其稳定英文名。dialogues.chinese_character_name是旧数据兼容字段，"
    "新输出填写null，不生成中文人名；旧中文别名只用于识别同一人物，不能成为新增人物或改名依据。"
    "不得在同一个text字段中混写中英台词。同一真实人物在一集内只能出现一条人物记录。"
    "职位、亲属称谓、昵称、代号、假名、曾用名、公开身份、秘密身份或身份变化只作为同一人物的"
    "称呼或身份事实记录，不据此新建人物。跨集沿用Story Bible、人物卡、连续性账本和"
    "canonical_character_names已经确认的同一身份；保留稳定character_ref，不改写已批准历史。"
    "同名不同人物保持独立身份，沿用已经确认的英文消歧名，不用中文名区分。"
    + OVERSEAS_DIALOGUE_VOICE_CONTRACT
)

PARTNER_SCREENPLAY_SAMPLE_SHA256 = (
    "05ae1a5df1bde3c885ad009c863d5a2bf1b13ae49084f6ccfc7c7678efbee876",
    "e72af663ae1c9fa9de059ef55e1bf591bd982a3bcb47a62804a6906ed595e92a",
)


def clamp_legacy_numeric(
    value: Any,
    *,
    minimum: int,
    maximum: int,
) -> Any:
    """Preserve legacy non-numeric values while normalizing numeric budgets."""

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    return min(maximum, max(minimum, round(value)))


def normalize_episode_dialogue_plan_payload(value: Any) -> Any:
    """Upgrade legacy episode dialogue budgets without changing story content."""

    if not isinstance(value, dict):
        return value
    normalized = dict(value)
    raw_scenes = normalized.get("scene_execution_plan")
    scenes = [dict(scene) for scene in raw_scenes] if (
        isinstance(raw_scenes, list)
        and raw_scenes
        and all(isinstance(scene, dict) for scene in raw_scenes)
    ) else []
    raw_total = normalized.get("planned_dialogue_line_count")
    if isinstance(raw_total, bool) or not isinstance(raw_total, (int, float)):
        raw_total = sum(
            max(0, round(scene.get("dialogue_line_target", 0)))
            for scene in scenes
            if isinstance(scene.get("dialogue_line_target", 0), (int, float))
            and not isinstance(scene.get("dialogue_line_target", 0), bool)
        ) or 30
    target = min(
        EPISODE_DIALOGUE_LINE_MAX,
        max(EPISODE_DIALOGUE_LINE_MIN, round(raw_total)),
    )
    normalized["planned_dialogue_line_count"] = target
    if not scenes:
        return normalized

    counts = [
        max(0, round(scene.get("dialogue_line_target", 0)))
        if isinstance(scene.get("dialogue_line_target", 0), (int, float))
        and not isinstance(scene.get("dialogue_line_target", 0), bool)
        else 0
        for scene in scenes
    ]
    # An explicit zero is an authored silent scene, not spare dialogue capacity.
    # Prefer established speaking scenes when upgrading an old episode budget;
    # only legacy scenes with no declared target may receive speech otherwise.
    speaking_indices = [index for index, count in enumerate(counts) if count > 0]
    if not speaking_indices:
        speaking_indices = [
            index for index, scene in enumerate(scenes)
            if scene.get("dialogue_line_target") is None
        ]
    total = sum(counts)
    cursor = 0
    while total < target and speaking_indices:
        counts[speaking_indices[cursor % len(speaking_indices)]] += 1
        total += 1
        cursor += 1
    while total > target:
        index = max(range(len(counts)), key=counts.__getitem__)
        if counts[index] == 0:
            break
        counts[index] -= 1
        total -= 1
    for scene, count in zip(scenes, counts, strict=True):
        scene["dialogue_line_target"] = count
    normalized["scene_execution_plan"] = scenes
    return normalized
