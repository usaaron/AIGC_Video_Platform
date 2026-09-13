from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence

from app.modules.input_readiness.models import InputSourceFact, SourceFactField
from app.modules.script_engine.long_story_models import CreativeReferenceMaterial


@dataclass(frozen=True)
class SourceDocument:
    id: str
    name: str
    text: str


EPISODE_HEADING = re.compile(
    r"(?im)^\s*(?:#{1,6}\s*)?(?:"
    r"第\s*(?P<chinese>\d{1,4}|[零〇○一二两三四五六七八九十百千万]+)\s*集|"
    r"(?:episode|ep\.?|e)\s*(?P<english>\d{1,4}|[零〇○一二两三四五六七八九十百千万]+)(?![A-Za-z0-9]))"
)


_EMPTY_VALUE = re.compile(
    r"^(?:(?:待补充|待定|待完善|未填写|暂无|略|无|todo|tbd|n/?a)|[\s:：。.!！?？…_\-（）()\[\]【】])+$",
    re.I,
)
_SECTION_FIELDS: dict[str, SourceFactField] = {
    "故事前提": "story_promise", "故事梗概": "story_promise", "故事概述": "story_promise",
    "故事简介": "story_promise", "大致剧情": "story_promise", "剧情简介": "story_promise",
    "主要人物": "protagonist_and_goal", "人物小传": "protagonist_and_goal",
    "角色设定": "protagonist_and_goal", "角色介绍": "protagonist_and_goal",
    "人物介绍": "protagonist_and_goal", "主角": "protagonist_and_goal",
    "主角与目标": "protagonist_and_goal", "故事背景": "world_setting", "世界观": "world_setting",
    "世界设定": "world_setting", "时代背景": "world_setting", "社会规则": "world_setting",
    "核心冲突": "core_obstacle", "主要矛盾": "core_obstacle", "中心冲突": "core_obstacle",
    "失败代价": "stakes", "关键反转": "reveal_or_twist", "秘密": "reveal_or_twist",
    "人物关系": "relationship_direction", "角色关系": "relationship_direction",
    "关系走向": "relationship_direction", "结局方向": "ending_direction",
    "最终结局": "ending_direction", "大结局": "ending_direction", "终局": "ending_direction",
    "情绪与节奏": "tone_and_pacing", "基调": "tone_and_pacing",
    "premise": "story_promise", "synopsis": "story_promise", "characters": "protagonist_and_goal",
    "protagonist": "protagonist_and_goal", "world setting": "world_setting",
    "central conflict": "core_obstacle", "ending": "ending_direction",
}
_SECTION_HEADING = re.compile(
    r"(?im)^\s*(?:#{1,6}\s*)?(?P<label>" + "|".join(map(re.escape, _SECTION_FIELDS))
    + r")\s*(?:[：:]\s*|\n|$)"
)
_OTHER_HEADING = re.compile(r"(?m)^\s*(?:#{1,6}\s*)?(?:主题|主旨|故事结构|人物弧光|主线|副线|故事线|第\s*\d+\s*集)\s*[：:]?")


def meaningful_text(value: str) -> bool:
    text = value.strip()
    text = re.sub(r"^(?:" + "|".join(map(re.escape, _SECTION_FIELDS)) + r")\s*[：:]\s*", "", text, flags=re.I)
    return len(re.sub(r"\W", "", text)) >= 3 and not _EMPTY_VALUE.fullmatch(text)


def source_documents(prompt: str, references: Sequence[CreativeReferenceMaterial]) -> list[SourceDocument]:
    documents = [SourceDocument("creative_prompt", "创作输入", prompt)] if prompt.strip() else []
    documents.extend(SourceDocument(f"reference_{i}", item.file_name, item.extracted_text)
                     for i, item in enumerate(references, 1) if item.extracted_text.strip())
    return documents


def fact_from_span(document: SourceDocument, field: SourceFactField, start: int, end: int) -> InputSourceFact | None:
    episode = EPISODE_HEADING.search(document.text)
    if episode and end > episode.start():
        return None
    while start < end and document.text[start].isspace():
        start += 1
    while end > start and document.text[end - 1].isspace():
        end -= 1
    end = min(end, start + 800)
    quote = document.text[start:end]
    if not meaningful_text(quote):
        return None
    return InputSourceFact(field=field, source_id=document.id, source_name=document.name,
                           quote=quote, start=start, end=end)


def extract_source_facts(documents: list[SourceDocument]) -> list[InputSourceFact]:
    """Extract source spans, never generated summaries or invented author choices."""
    facts: list[InputSourceFact] = []
    for document in documents:
        # A single episode's outcome is not the whole story's ending. Only the
        # document's global preamble can seed whole-story fields heuristically.
        episode = EPISODE_HEADING.search(document.text)
        text = document.text[:episode.start()] if episode else document.text
        headings = list(_SECTION_HEADING.finditer(text))
        other_starts = [match.start() for match in _OTHER_HEADING.finditer(text)]
        for index, heading in enumerate(headings):
            start = heading.end()
            end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
            end = min([end, *(position for position in other_starts if start <= position < end)])
            field = _SECTION_FIELDS[heading.group("label").casefold()]
            # Character sections may describe several protagonists. Keep separate
            # source paragraphs so a long first character cannot swallow the second.
            spans = list(re.finditer(r"\S[\s\S]*?(?=\n\s*\n|$)", text[start:end]))
            for span in spans[:4] if field == "protagonist_and_goal" else spans[:1]:
                fact = fact_from_span(document, field, start + span.start(), start + span.end())
                if fact:
                    facts.append(fact)
        narrative_patterns: dict[SourceFactField, str] = {
            "ending_direction": r"最终|终局|大结局|in the end",
            "core_obstacle": r"冲突|阻止|对抗|报复|对手|obstacle",
            "relationship_direction": r"两人|双方|彼此|互相|合作|关系",
        }
        for field, pattern in narrative_patterns.items():
            if any(fact.field == field and fact.source_id == document.id for fact in facts):
                continue
            sentences = list(re.finditer(r"[^。！？\n]+[。！？]?", text))
            narrative = [fact for fact in facts if fact.source_id == document.id and fact.field == "story_promise"]
            if narrative:
                sentences = [sentence for sentence in sentences if any(fact.start <= sentence.start() < fact.end for fact in narrative)]
            for sentence in reversed(sentences) if field == "ending_direction" else sentences:
                if re.search(pattern, sentence.group(), re.I):
                    # "Does not know the final culprit at the opening" is an
                    # initial knowledge boundary, not the story's resolution.
                    if field == "ending_direction" and re.search(
                        r"(?:开局|开场|起初|最初|故事开始时)[^。！？\n]{0,160}"
                        r"(?:不知|不知道|尚未得知|尚未查明)[^，,。！？\n]{0,80}"
                        r"最终(?:责任人|真相|答案)[^，,。！？\n]{0,30}[。！？]?$",
                        sentence.group(),
                    ):
                        continue
                    fact = fact_from_span(document, field, sentence.start(), sentence.end())
                    if fact:
                        facts.append(fact)
                        break
    return deduplicate_facts(facts)


def deduplicate_facts(facts: list[InputSourceFact]) -> list[InputSourceFact]:
    seen: set[tuple[str, str, str]] = set()
    result = []
    for fact in facts:
        key = (fact.field, fact.source_id, fact.quote)
        if key not in seen:
            seen.add(key)
            result.append(fact)
    return result[:24]


def source_fact_values(facts: list[InputSourceFact], *, limit: int = 500) -> dict[str, str]:
    grouped: dict[str, list[str]] = {}
    for fact in facts:
        quotes = grouped.setdefault(fact.field, [])
        if fact.quote not in quotes:
            quotes.append(fact.quote)
    return {field: "\n".join(quote[:max(1, (limit - len(quotes) + 1) // len(quotes))]
                              for quote in quotes)[:limit]
            for field, quotes in grouped.items()}
