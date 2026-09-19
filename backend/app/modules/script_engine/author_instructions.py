"""Lossless author intent for existing screenplay revision calls, never story canon."""

import json


SCRIPT_PRIOR_AUTHOR_INSTRUCTION_MAX_COUNT = 32
SCRIPT_AUTHOR_INSTRUCTION_CONTEXT_MAX_CHARACTERS = 32_000

AUTHOR_INSTRUCTION_HISTORY_CONTRACT = (
    "以下是同一项目同一集仍有效的作者修改要求，按旧到新排列。它们是修改意图，不是已发生的剧情、"
    "批准事实或已采用候选。当前明确修改与旧要求冲突的部分以当前要求为准；其余未撤回要求继续有效，"
    "不能只处理最新补充而退回前轮已要求修正的表达。放弃候选只表示不采用该文本，不表示撤回作者要求。"
    "历史selection_context仅说明当时引用的文字和范围，其路径不保证仍指向当前稿同一内容；"
    "应对照当前正文确认，不按旧索引误改其他内容。若所有有效要求不能在当前选区内完成，"
    "使用已有完整修改交接，不静默忽略选区外仍未落实的要求。保持既有批准规划和前文事实约束，"
    "不能把历史要求或未采用候选引用为既有事实。"
)


def prior_author_instruction_payload(payload) -> list[dict]:
    return [
        item.model_dump(mode="json")
        for item in getattr(payload, "prior_author_instructions", [])
    ]


def effective_modification_instruction(payload) -> str:
    """Render the same ordered intent at review and every existing writer entry."""
    prior = prior_author_instruction_payload(payload)
    if not prior:
        return payload.instruction
    return (
        AUTHOR_INSTRUCTION_HISTORY_CONTRACT
        + "\nPriorAuthorInstructions (author intent only):\n"
        + json.dumps(prior, ensure_ascii=False, separators=(",", ":"))
        + "\nCurrentAuthorInstruction (latest explicit changes take precedence):\n"
        + payload.instruction
    )
