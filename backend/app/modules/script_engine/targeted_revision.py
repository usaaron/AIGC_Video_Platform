"""Field-scoped screenplay revisions, with model invocation owned by the service."""

from __future__ import annotations

import json
import logging
import re

from pydantic import ValidationError

from app.modules.content_spec.models import ContentSpec
from app.modules.script_engine.author_instructions import effective_modification_instruction
from app.modules.master_script.models import DraftMasterScript, LLMTargetedScriptTextPatch
from app.modules.script_engine.models import (
    ScriptDraftModificationRequest,
    ScriptGenerationDraftRun,
    StaticKnowledgeItem,
)


logger = logging.getLogger(__name__)

TARGETED_MODIFICATION_ROOT_FIELDS = {
    "hook",
    "synopsis",
    "next_episode_question",
}
TARGETED_MODIFICATION_SCENE_FIELDS = {
    "slug",
    "purpose",
    "setting_hint",
    "beat_summary",
}
TARGETED_MODIFICATION_CAUSALITY_FIELDS = {
    "goal",
    "conflict",
    "outcome",
    "causal_link",
}


def build_targeted_candidate(
    payload: ScriptDraftModificationRequest,
    *,
    candidate_payload: dict[str, object],
    target_path: str,
    patch: LLMTargetedScriptTextPatch,
    raw_metadata: object,
    requires_translation: bool,
) -> DraftMasterScript | None:
    """Apply a patch to this call's detached payload, leaving the source model intact."""
    selection = payload.selection_context
    if selection is None:
        return None
    source_value = targeted_text_value(candidate_payload, target_path)
    if source_value is None:
        return None
    source_draft = payload.source_draft_master_script
    if patch.requires_full_episode_rewrite:
        logger.info(
            "Targeted modification requested full episode fallback: %s",
            patch.reason,
        )
        return None
    if patch.replacement_text is None:
        return None
    if requires_translation and patch.updated_chinese_translation is None:
        logger.info(
            "Targeted overseas dialogue patch omitted its Chinese counterpart; using full episode fallback."
        )
        return None

    replacement_text = patch.replacement_text.strip()
    if not replacement_text:
        return None
    updated_value = replace_selected_text(
        source_value,
        selected_text=selection.selected_text,
        before_text=selection.before_text,
        after_text=selection.after_text,
        replacement_text=replacement_text,
    )
    if updated_value is None or updated_value == source_value:
        return None

    for identity_field in ("id", "created_at", "updated_at"):
        candidate_payload.pop(identity_field, None)
    if not set_targeted_text_value(
        candidate_payload,
        target_path,
        updated_value,
    ):
        return None
    if requires_translation and patch.updated_chinese_translation is not None:
        translation_path = target_path.rsplit(".", 1)[0] + ".chinese_translation"
        if not set_targeted_text_value(
            candidate_payload,
            translation_path,
            patch.updated_chinese_translation.strip(),
        ):
            return None

    candidate_payload["llm_metadata"] = {
        **source_draft.llm_metadata,
        "targeted_modification": True,
        "targeted_modification_path": target_path,
        "targeted_modification_source_draft_id": source_draft.id,
        "targeted_modification_model": (
            dict(raw_metadata) if isinstance(raw_metadata, dict) else {}
        ),
    }
    try:
        candidate = DraftMasterScript.model_validate(candidate_payload)
    except ValidationError:
        logger.info(
            "Targeted modification did not satisfy the exact field contract; using full episode fallback."
        )
        return None
    return candidate


def build_targeted_modification_prompt(
    *,
    payload: ScriptDraftModificationRequest,
    source_run: ScriptGenerationDraftRun,
    source_draft: DraftMasterScript,
    content_spec: ContentSpec,
    target_path: str,
    source_value: str,
    requires_translation: bool,
    knowledge_items: list[StaticKnowledgeItem],
    episode_context: dict[str, object],
) -> str:
    creative_contract = {
        "title": content_spec.title,
        "audience_goal": content_spec.audience_goal.model_dump(mode="json"),
        "commercial_goal": content_spec.commercial_goal.model_dump(mode="json"),
        "platform_goal": content_spec.platform_goal.model_dump(mode="json"),
        "creative_brief": content_spec.creative_brief.model_dump(mode="json"),
        "resolved_creative_context": (
            source_run.resolved_creative_context.model_dump(
                mode="json",
                exclude_none=True,
            )
            if source_run.resolved_creative_context is not None
            else None
        ),
    }
    selection = payload.selection_context
    assert selection is not None
    translation_rule = (
        "The target is an overseas English dialogue line. Return "
        "updated_chinese_translation as the complete Chinese translation of the "
        "updated full dialogue line, generated in this same response."
        if requires_translation
        else "Set updated_chinese_translation to null."
    )
    return (
        "TARGETED SCREENPLAY TEXT REVISION\n"
        f"Market path: {source_run.release_region.value}.\n"
        "Revise exactly one selected text fragment without regenerating the episode. "
        "The server deterministically inserts replacement_text at target_path and "
        "rejects every other mutation.\n\n"
        "Decision rule:\n"
        "- Use requires_full_episode_rewrite=false only when the instruction can be "
        "satisfied by replacing the selected fragment alone.\n"
        "- Set requires_full_episode_rewrite=true with a concise reason if satisfying "
        "the request requires another field, another scene, a character/state update, "
        "a new story fact, or a changed causal/continuity contract.\n"
        "- replacement_text is only the replacement for selected_text, not the full "
        "field and not an explanation. Preserve language, names, established facts, "
        "tone, causality, and handoff obligations. Do not weaken production clarity.\n"
        "- The author's latest explicit goal takes precedence over system suggestions. This targeted "
        "request has passed author-impact review. Preserve approved facts outside its scope; never "
        "silently discard the user's requested change to preserve an old expression. If a coherent "
        "change exceeds this fragment, request the full-episode handoff.\n"
        f"- {translation_rule}\n\n"
        f"Release region: {source_run.release_region.value}\n"
        f"Target path: {target_path}\n"
        "UserDirectedModificationContract:\n"
        f"User instruction: {effective_modification_instruction(payload)}\n"
        "DocumentSelectionContext:\n"
        + json.dumps(selection.model_dump(mode="json"), ensure_ascii=False)
        + "\nCurrent complete target field:\n"
        + source_value
        + "\n\nCreative contract:\n"
        + json.dumps(creative_contract, ensure_ascii=False)
        + "\n\nGoverned generation guidance:\n"
        + json.dumps(
            [item.model_dump(mode="json") for item in knowledge_items],
            ensure_ascii=False,
        )
        + "\n\nCanonical episode and continuity packet:\n"
        + json.dumps(episode_context, ensure_ascii=False)
        + "\n\nImmutable episode context and relevant scene evidence:\n"
        + json.dumps(
            targeted_modification_context(source_draft, target_path),
            ensure_ascii=False,
        )
    )


def targeted_modification_path(source_field: str) -> str | None:
    match = re.search(r"[（(]([^()（）]+)[）)]\s*$", source_field.strip())
    if match is None:
        return None
    path = match.group(1).strip()
    parts = path.split(".")
    if len(parts) == 1:
        return path if path in TARGETED_MODIFICATION_ROOT_FIELDS else None
    if len(parts) < 3 or parts[0] != "scenes" or _list_index(parts[1]) is None:
        return None
    if len(parts) == 3 and parts[2] in TARGETED_MODIFICATION_SCENE_FIELDS:
        return path
    if (
        len(parts) == 4
        and parts[2] == "scene_causality"
        and parts[3] in TARGETED_MODIFICATION_CAUSALITY_FIELDS
    ):
        return path
    if (
        len(parts) == 4
        and parts[2] == "character_actions"
        and _list_index(parts[3]) is not None
    ):
        return path
    if (
        len(parts) == 5
        and parts[2] == "dialogues"
        and _list_index(parts[3]) is not None
        and parts[4] in {"intent", "text"}
    ):
        return path
    return None


def unwrap_targeted_patch_response(
    output: dict[str, object],
) -> dict[str, object]:
    """Accept a shallow provider envelope without accepting arbitrary nested mutations."""

    patch_fields = set(LLMTargetedScriptTextPatch.model_fields)
    inherited_metadata = output.get("_meta")
    current = output
    for _ in range(3):
        if set(current).intersection(patch_fields):
            break
        nested = next(
            (
                current[key]
                for key in ("data", "result", "output", "patch")
                if isinstance(current.get(key), dict)
            ),
            None,
        )
        if not isinstance(nested, dict):
            break
        current = nested
    if current is output:
        return output
    unwrapped = dict(current)
    if isinstance(inherited_metadata, dict):
        metadata = unwrapped.setdefault("_meta", {})
        if isinstance(metadata, dict):
            for key, value in inherited_metadata.items():
                metadata.setdefault(key, value)
    return unwrapped


def _list_index(part: str) -> int | None:
    if not part.isdecimal():
        return None
    try:
        return int(part)
    except ValueError:
        return None


def _resolve_text_slot(
    payload: dict[str, object], target_path: str,
) -> tuple[dict[str, object] | list[object], str | int] | None:
    parts = target_path.split(".")
    current: object = payload
    for offset, part in enumerate(parts):
        if isinstance(current, dict):
            key: str | int = part
            if key not in current:
                return None
        elif isinstance(current, list):
            index = _list_index(part)
            if index is None or index >= len(current):
                return None
            key = index
        else:
            return None
        if offset == len(parts) - 1:
            return current, key
        current = current[key]
    return None


def targeted_text_value(
    draft: DraftMasterScript | dict[str, object], target_path: str,
) -> str | None:
    payload = draft.model_dump(mode="python") if isinstance(draft, DraftMasterScript) else draft
    slot = _resolve_text_slot(payload, target_path)
    if slot is None:
        return None
    parent, key = slot
    value = parent[key]
    return value if isinstance(value, str) else None


def set_targeted_text_value(
    payload: dict[str, object], target_path: str, value: str,
) -> bool:
    slot = _resolve_text_slot(payload, target_path)
    if slot is None:
        return False
    parent, key = slot
    parent[key] = value
    return True


def replace_selected_text(
    source_value: str,
    *,
    selected_text: str,
    before_text: str,
    after_text: str,
    replacement_text: str,
) -> str | None:
    positions: list[int] = []
    cursor = 0
    while True:
        position = source_value.find(selected_text, cursor)
        if position < 0:
            break
        positions.append(position)
        cursor = position + max(1, len(selected_text))
    if not positions:
        return None
    if len(positions) == 1:
        selected_position = positions[0]
    else:
        ranked: list[tuple[int, int]] = []
        for position in positions:
            prefix = source_value[:position]
            suffix = source_value[position + len(selected_text) :]
            score = 0
            if before_text and prefix.endswith(before_text):
                score += len(before_text)
            if after_text and suffix.startswith(after_text):
                score += len(after_text)
            ranked.append((score, position))
        ranked.sort(reverse=True)
        if len(ranked) > 1 and ranked[0][0] == ranked[1][0]:
            return None
        selected_position = ranked[0][1]
    return (
        source_value[:selected_position]
        + replacement_text
        + source_value[selected_position + len(selected_text) :]
    )


def targeted_modification_context(
    draft: DraftMasterScript,
    target_path: str,
) -> dict[str, object]:
    payload = draft.model_dump(
        mode="json",
        exclude={"id", "created_at", "updated_at", "llm_metadata"},
    )
    scenes = payload.pop("scenes", [])
    scene_outline: list[dict[str, object]] = []
    if isinstance(scenes, list):
        for scene in scenes:
            if not isinstance(scene, dict):
                continue
            scene_outline.append(
                {
                    key: scene.get(key)
                    for key in (
                        "scene_number",
                        "slug",
                        "purpose",
                        "setting_hint",
                        "beat_summary",
                        "emotional_shift",
                        "emotional_objective",
                        "turning_point",
                        "scene_causality",
                        "cliffhanger",
                    )
                }
            )
    context: dict[str, object] = {
        "episode_invariants": payload,
        "scene_outline": scene_outline,
    }
    parts = target_path.split(".")
    scene_index = _list_index(parts[1]) if len(parts) > 2 else None
    if (
        parts[0] == "scenes"
        and scene_index is not None
        and isinstance(scenes, list)
        and scene_index < len(scenes)
    ):
        context["target_scene"] = scenes[scene_index]
    return context


def script_editor_issue_category(issue: str) -> str:
    prefix = issue.split("：", 1)[0]
    return re.sub(r"\d+(?:\.\d+)?", "#", prefix)
