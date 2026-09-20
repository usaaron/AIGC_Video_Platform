"""Resolve draft-only display labels at the author's outline approval boundary."""

from __future__ import annotations

import re

from app.modules.script_engine.long_story_models import StoryBible


_PROPOSAL_LABEL = re.compile(r"(^|[。；，：:\n])([ \t]*)AI草案[（(]待确认[）)][ \t]*[:：]?[ \t]*")
# The generator also places proposal annotations inside a sentence, e.g.
# "真相来源为AI草案（待确认）：档案未同步". Approval settles this same
# visible proposal regardless of its position; quoted source text is untouched.
_INLINE_PROPOSAL_LABEL = re.compile(r"(?:为|是)?AI草案[（(]待确认[）)][ \t]*[:：][ \t]*")
_QUOTED_TEXT = re.compile(r'''("[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』)''')
_NARRATIVE_FIELDS = {
    "core_premise", "series_goal", "theme", "central_conflict", "ending_direction",
    "world_rules", "character_arc_targets", "relationships", "story_lines",
    "escalation_stages", "major_setup_payoff_refs", "locked_facts", "avoid_patterns",
}


def approved_story_bible_context(bible: StoryBible) -> StoryBible:
    """An approved visible proposal is settled; an explicit deferred decision isn't.

    This does not invent any missing content or erase bare 待定. The original
    imported document and decision provenance remain exact. Old stored versions
    can use this read-only projection without rewriting their history.
    """
    if not isinstance(bible, StoryBible) or bible.status.value != "approved":
        return bible
    if any(
        getattr(item.status, "value", item.status)
        in {"unresolved", "proposed", "delegated", "conflicted"}
        and getattr(item.ai_permission, "value", item.ai_permission) != "decide"
        for item in getattr(bible, "creative_decisions", [])
    ):
        return bible

    def clean(value: object, *, inline: bool = True) -> object:
        if isinstance(value, str):
            parts = _QUOTED_TEXT.split(value)
            for index in range(0, len(parts), 2):
                parts[index] = _PROPOSAL_LABEL.sub(r"\1\2", parts[index])
                if inline:
                    parts[index] = _INLINE_PROPOSAL_LABEL.sub("：", parts[index])
            return "".join(parts)
        if isinstance(value, list):
            result = [clean(item, inline=inline) for item in value]
            # Removing a display label can make two textual references identical.
            return list(dict.fromkeys(result)) if all(isinstance(item, str) for item in result) else result
        if isinstance(value, dict):
            return {
                key: item if key.endswith(("_id", "_ref", "_refs")) else clean(item, inline=inline)
                for key, item in value.items()
            }
        return value

    values = bible.model_dump(mode="json")
    updates = {key: clean(values[key], inline=key != "avoid_patterns") for key in _NARRATIVE_FIELDS}
    if all(updates[key] == values[key] for key in updates):
        return bible
    approved = StoryBible.model_validate({**values, **updates, "market_profile": bible.market_profile})
    approved._overseas_story_profile = bible._overseas_story_profile
    return approved
