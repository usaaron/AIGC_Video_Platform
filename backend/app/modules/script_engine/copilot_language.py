"""Language gate for display-only provider progress, never generated documents."""

from __future__ import annotations

import re
import unicodedata


_CHINESE = re.compile(r"[\u3400-\u9fff\uf900-\ufaff\U00020000-\U000323af]")
_LATIN = re.compile(r"[A-Za-z]")
# Keep explicit field references, abbreviations and names inside Chinese prose.
# These exceptions never make an English-only sentence displayable.
_FIELD_REFERENCE = re.compile(r"`[A-Za-z_][A-Za-z0-9_.\[\]-]*`")
_ABBREVIATION = re.compile(r"(?<![A-Za-z])[A-Z]{1,6}(?:[-.]?\d+)?(?![A-Za-z])")
_NAME = re.compile(r"(?<![A-Za-z])[A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)*(?![A-Za-z])")
_WORD = re.compile(r"[A-Za-z]+")
_WORD_RUN = re.compile(r"[A-Za-z]+(?:\s+[A-Za-z]+)+")
_PROCESS_WORDS = frozenset({
    "let", "we", "us", "me", "our", "the", "this", "that", "need", "needs",
    "should", "must", "think", "thinking", "analyze", "analyse", "analyzing", "analysing",
    "analysis", "check", "checking", "review", "reviewing", "first", "next", "then", "now", "step",
})
_STRUCTURED_MARKER = re.compile(r"^\s*[\"'“”‘’`\[\]{}]*(?:\d+|[一二三四五六七八九十百]+)\s*[.)、:：]?[\"'“”‘’`\[\]{}]*\s*$")
_SENTENCE_END = re.compile(r"[。！？!?；;\n]|\.(?=\s)")


def has_non_chinese_letters(value: str) -> bool:
    """Only Han text may flush early; other scripts need a complete phrase."""
    return any(character.isalpha() and not _CHINESE.fullmatch(character) for character in value)


def chinese_progress_text(value: str) -> bool:
    """Accept Chinese explanations with inline identities or technical labels.

    This is a conservative display gate, not a translator or a screenplay
    validator. An ambiguous mixed-language sentence is omitted as a whole.
    """
    value = unicodedata.normalize("NFKC", value)
    if any(character.isalpha() and not _CHINESE.fullmatch(character) and not _LATIN.fullmatch(character)
           for character in value):
        return False
    if not _LATIN.search(value):
        return True
    if not _CHINESE.search(value):
        return False
    # Protect actual field-shaped references, but not an English process word
    # merely wrapped in backticks. Validate a normalized copy, never rewrite
    # the provider text. Markdown and Unicode spaces do not hide word tokens.
    prose = _FIELD_REFERENCE.sub(
        lambda match: match.group() if match.group()[1:-1].casefold() in _PROCESS_WORDS else "",
        value,
    )
    prose = " ".join(re.sub(r"[*_~`]", " ", prose).split())
    if any(word.casefold() in _PROCESS_WORDS for word in _WORD.findall(prose)):
        return False
    # Will, May and other real personal names are not process-word exclusions.
    for match in _WORD_RUN.finditer(prose):
        if len(match.group().split()) >= 4:
            return False
    prose = _ABBREVIATION.sub("", prose)
    prose = _NAME.sub("", prose)
    return not _LATIN.search(prose)


def is_structured_progress_fragment(value: str) -> bool:
    """Recognize isolated list markers and punctuation after sentence buffering.

    Never apply this to transport chunks: ``2)`` may be the prefix of a normal
    Chinese list item. Scene headings and short Chinese descriptions are model
    text too, and must not be discarded merely for looking like an outline.
    """
    lines = [line.strip() for line in value.splitlines() if line.strip()]
    if not lines:
        return False  # Paragraph spacing is handled separately by the observer.
    for line in lines:
        if _STRUCTURED_MARKER.fullmatch(line):
            continue
        if not any(character.isalpha() for character in line):
            continue
        return False
    return True


def split_progress_text(value: str, *, final: bool) -> tuple[list[tuple[str, bool]], str]:
    """Buffer complete sentences, independent of provider transport chunking.

    A currently Chinese or numeric prefix may acquire an English continuation.
    Publishing that prefix early leaves misleading fragments after the full
    sentence is rejected. The request character limit bounds the retained tail.
    """
    pieces: list[tuple[str, bool]] = []
    start = 0
    for match in _SENTENCE_END.finditer(value):
        # A numbered list prefix (``2. ``) is not a sentence. Keep it attached
        # to the explanation, including when provider chunks split the prefix.
        if match.group() == "." and _STRUCTURED_MARKER.fullmatch(value[start:match.end()]):
            continue
        pieces.append((value[start:match.end()], True))
        start = match.end()
    tail = value[start:]
    if tail and final:
        pieces.append((tail, False))
        tail = ""
    return pieces, tail
