"""Deterministic overseas name presentation for newly generated candidates only.

Historical Chinese aliases remain useful for identity matching. This module never
invents a translation or changes stable references, and never mutates its input.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from copy import deepcopy
from enum import Enum
import re

_CJK = re.compile(r"[\u3400-\u9fff]")
_MARKER = re.compile(r"\s*[（(](?:O\.S\.|V\.O\.|continued|pre[\s-]?lap)[）)]\s*$", re.I)
_IDENTITY_FIELDS = {"name", "character_name", "source_character", "target_character"}
_SKIP_FIELDS = {"_meta", "llm_metadata", "id", "language"}


def english_identity(value: str) -> str:
    name = _MARKER.sub("", value).strip()
    return name if re.search(r"[A-Za-z]", name) and not _CJK.search(name) else ""


def identity_aliases(payload: Mapping[str, object], explicit: Mapping[str, str] | None = None) -> dict[str, str]:
    aliases = {alias.strip(): english_identity(name) for alias, name in (explicit or {}).items()
               if alias.strip() and english_identity(name)}
    for scene in payload.get("scenes", []) or []:
        if not isinstance(scene, dict):
            continue
        for line in scene.get("dialogues", []) or []:
            if not isinstance(line, dict):
                continue
            english = english_identity(str(line.get("character_name") or ""))
            chinese = line.get("chinese_character_name")
            if english and isinstance(chinese, str) and chinese.strip():
                aliases.setdefault(chinese.strip(), english)
    for english in tuple(aliases.values()):
        aliases.setdefault(english, english)
    return aliases


def replace_identity_aliases(value: str, aliases: Mapping[str, str], *, exact: bool = False) -> str:
    for alias, english in sorted(aliases.items(), key=lambda item: len(item[0]), reverse=True):
        # English names such as Will/May/Grace can also be ordinary words. Their
        # spelling is canonicalized only in identity fields, never in prose.
        if not exact and alias.casefold() == english.casefold():
            continue
        if value.strip().casefold() == alias.casefold():
            return english
        # Collapse explicit bilingual labels, never role-match different people.
        value = re.sub(re.escape(alias) + r"\s*[（(]" + re.escape(english) + r"[）)]", english, value, flags=re.I)
        value = re.sub(re.escape(english) + r"\s*[（(]" + re.escape(alias) + r"[）)]", english, value, flags=re.I)
        if exact:
            base = _MARKER.sub("", value).strip()
            if base.casefold() == alias.casefold():
                return english + value[len(base):]
            continue
        if len(alias) == 1 and _CJK.search(alias):
            # A single Chinese character can be part of an unrelated word. Only
            # exact identity fields and explicit bilingual labels are unambiguous.
            continue
        value = re.sub(r"(?<![A-Za-z])" + re.escape(alias) + r"(?![A-Za-z])", lambda _: english, value, flags=re.I)
    return value


def normalize_new_overseas_payload(payload: dict[str, object], explicit: Mapping[str, str] | None = None) -> dict[str, object]:
    aliases = identity_aliases(payload, explicit)
    def visit(value: object, key: str = "") -> object:
        if key in _SKIP_FIELDS:
            return deepcopy(value)
        if key == "chinese_character_name":
            return None
        if isinstance(value, str):
            return replace_identity_aliases(value, aliases, exact=key in _IDENTITY_FIELDS or key.endswith("_ref") or key.endswith("_refs") or key == "episode_cast")
        if isinstance(value, list):
            return [visit(item, key) for item in value]
        if isinstance(value, dict):
            return {field: visit(item, field) for field, item in value.items()}
        return value
    return visit(payload)  # type: ignore[return-value]


def english_names_from_payload(payload: Mapping[str, object]) -> tuple[str, ...]:
    names = [str(item.get("name") or "") for item in payload.get("characters", []) or [] if isinstance(item, dict)]
    names += [str(item.get("name") or "") for item in payload.get("character_registry", []) or [] if isinstance(item, dict)]
    for scene in payload.get("scenes", []) or []:
        if isinstance(scene, dict):
            names += [str(line.get("character_name") or "") for line in scene.get("dialogues", []) or [] if isinstance(line, dict)]
    return tuple(dict.fromkeys(name for value in names if (name := english_identity(value))))


def without_known_english_names(value: str | None, names: Iterable[str]) -> str | None:
    if value is None:
        return None
    for name in sorted(set(names), key=len, reverse=True):
        if english_identity(name):
            value = re.sub(r"(?<![A-Za-z])" + re.escape(name) + r"(?![A-Za-z])", "", value, flags=re.I)
    return value


_PERSONAL_NAME_WORD = re.compile(r"[A-Z][a-zA-Z]*(?:['’-][A-Z]?[a-zA-Z]+)*")
_NAME_TITLES = {
    "mr", "mrs", "ms", "miss", "dr", "doctor", "professor", "sir", "lady",
    "lord", "king", "queen", "prince", "princess", "duke", "duchess",
    "marquis", "marquess", "count", "countess", "baron", "baroness",
    "captain", "commander", "general", "officer", "father", "mother",
}


def english_language_name_exceptions(names: Iterable[str]) -> tuple[str, ...]:
    """Allow unique given-name shorthand from the supplied identity ledger only.

    This is a language-check view, not an alias registration or text rewrite.
    Never mine capitalized words from prose, guess nicknames, permit surnames,
    or turn titles such as Marquis Claude / Abyss Lord into personal names.
    """
    registered = tuple(dict.fromkeys(name for value in names if (name := english_identity(value))))
    owners: dict[str, set[str]] = {}
    shorthand: dict[str, str] = {}
    for name in registered:
        parts = name.split()
        first = parts[0]
        owners.setdefault(first.casefold(), set()).add(name.casefold())
        if (2 <= len(parts) <= 4
                and all(_PERSONAL_NAME_WORD.fullmatch(part) for part in parts)
                and not any(part.casefold() in _NAME_TITLES for part in parts)):
            shorthand.setdefault(first.casefold(), first)
    return (*registered, *(value for key, value in shorthand.items() if len(owners[key]) == 1))


def explicit_bilingual_aliases(
    declarations: Iterable[str], registered_names: Iterable[str],
) -> dict[str, str]:
    """Read explicit bilingual declarations for existing registered identities.

    Match the actual registered Chinese name, never a role, list position or an
    arbitrary parenthesized term. Conflicting declarations remain unresolved.
    """
    declarations = tuple(declarations)
    candidates: dict[str, dict[str, str]] = {}
    for alias in registered_names:
        alias = alias.strip()
        if not alias or not _CJK.search(alias):
            continue
        chinese_first = re.compile(
            r"(?<![A-Za-z\u3400-\u9fff])" + re.escape(alias)
            + r"\s*[（(]\s*([A-Za-z][A-Za-z .'-]{0,79}?)\s*[）)]"
        )
        english_first = re.compile(
            r"(?:^|[\n。；;、:：])\s*([A-Za-z][A-Za-z .'-]{0,79}?)"
            + r"\s*[（(]\s*" + re.escape(alias) + r"\s*[）)]"
        )
        for text in declarations:
            for pattern in (chinese_first, english_first):
                for match in pattern.finditer(text):
                    english = " ".join(match[1].split())
                    if english_identity(english):
                        candidates.setdefault(alias, {})[english.casefold()] = english
    return {
        alias: next(iter(names.values()))
        for alias, names in candidates.items()
        if len(names) == 1
    }


def planning_identity_projection(value, aliases: Mapping[str, str]):
    """Project proven name spellings for display/review, without rewriting canon.

    Keep model types and every immutable reference. A copied view must not run
    persistence migrations, invent aliases, or normalize narrative facts. Single
    Chinese-character aliases keep the same conservative word-boundary policy as
    generated screenplay identity normalization.
    """
    from pydantic import BaseModel

    def visit(item, key: str = ""):
        if (key in _SKIP_FIELDS or key in {"creative_decisions", "imported_source_document"}
                or key.endswith(("_id", "_ids", "_ref", "_refs"))):
            return deepcopy(item)
        if isinstance(item, Enum):
            return deepcopy(item)
        if isinstance(item, str):
            return replace_identity_aliases(item, aliases, exact=key in _IDENTITY_FIELDS)
        if isinstance(item, BaseModel):
            return item.model_copy(update={
                field: visit(getattr(item, field), field) for field in type(item).model_fields
            }, deep=True)
        if isinstance(item, dict):
            return {field: visit(child, field) for field, child in item.items()}
        if isinstance(item, list):
            return [visit(child, key) for child in item]
        if isinstance(item, tuple):
            return tuple(visit(child, key) for child in item)
        return deepcopy(item)

    return visit(value)
