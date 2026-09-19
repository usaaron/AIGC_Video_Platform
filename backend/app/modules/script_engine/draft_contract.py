"""Pure draft response contracts used by the generation service.

Envelope selection, schema projection and patch bookkeeping are deterministic.
Model selection, bounded repair calls and checkpoints belong to the service.
"""

from __future__ import annotations

from collections import deque
from copy import deepcopy
import json

from pydantic import ValidationError

from app.modules.master_script.models import (
    DraftMasterScript,
    LLMGeneratedDraftMasterScript,
    normalize_screenplay_body_order,
)


class InvalidDraftMasterScriptOutputError(ValueError):
    """Raised when a real LLM response cannot be validated as a draft script."""


DRAFT_RESPONSE_ENVELOPE_KEYS = (
    "draft_master_script",
    "master_script",
    "script",
    "screenplay",
    "episode_script",
    "data",
    "result",
    "output",
)


def without_metadata(output: dict[str, object]) -> dict[str, object]:
    """Project provider output onto the payload checked by its Pydantic schema."""

    return {key: value for key, value in output.items() if key != "_meta"}


def unwrap_response_envelope(
    output: dict[str, object],
) -> dict[str, object]:
    """Unwrap provider envelopes only when the nested object is more script-like."""

    inherited_metadata = output.get("_meta")
    root_fields = set(LLMGeneratedDraftMasterScript.model_fields)
    output_keys = {key for key in output if key != "_meta"}
    best_value = output
    best_coverage = len(output_keys & root_fields)
    frontier = deque([(output, 0)])
    while frontier:
        current, depth = frontier.popleft()
        if depth >= 3:
            continue
        for envelope_key in DRAFT_RESPONSE_ENVELOPE_KEYS:
            nested = current.get(envelope_key)
            if not isinstance(nested, dict):
                continue
            nested_keys = {key for key in nested if key != "_meta"}
            nested_coverage = len(nested_keys & root_fields)
            if nested_coverage > best_coverage:
                best_value = nested
                best_coverage = nested_coverage
            frontier.append((nested, depth + 1))

    unwrapped = best_value is not output
    current = deepcopy(best_value)
    if isinstance(inherited_metadata, dict) or unwrapped:
        metadata = current.setdefault("_meta", {})
        if isinstance(metadata, dict):
            if isinstance(inherited_metadata, dict):
                for key, value in inherited_metadata.items():
                    metadata.setdefault(key, value)
            if unwrapped:
                metadata["draft_response_envelope_unwrapped"] = True
    return current


def should_attempt_contract_patch(
    payload: dict[str, object],
) -> bool:
    root_fields = set(LLMGeneratedDraftMasterScript.model_fields)
    payload_fields = set(payload) & root_fields
    required_coverage = max(8, round(len(root_fields) * 0.6))
    return (
        len(payload_fields) >= required_coverage
        and isinstance(payload.get("scenes"), (list, dict))
        and isinstance(payload.get("characters"), (list, dict))
    )


def payload_diagnostic(payload: dict[str, object]) -> str:
    root_fields = set(LLMGeneratedDraftMasterScript.model_fields)
    keys = sorted(key for key in payload if key != "_meta")
    root_coverage = len(set(keys) & root_fields)
    key_set = set(keys)
    if not keys:
        shape = "empty_object"
    elif {
        "scene_number",
        "slug",
        "purpose",
    }.issubset(key_set):
        shape = "scene_fragment"
    elif {"name", "role", "description"}.issubset(key_set):
        shape = "character_fragment"
    elif {"character_name", "current_goal"}.issubset(key_set):
        shape = "character_state_fragment"
    elif root_coverage == len(root_fields):
        shape = "complete_root"
    elif root_coverage:
        shape = "partial_root"
    elif len(keys) == 1 and keys[0] in DRAFT_RESPONSE_ENVELOPE_KEYS:
        shape = "unresolved_envelope"
    else:
        shape = "unknown_object"
    visible_keys = keys[:16]
    suffix = ",..." if len(keys) > len(visible_keys) else ""
    return (
        f"shape={shape}; root_fields={root_coverage}/{len(root_fields)}; "
        f"top_level_keys=[{','.join(visible_keys)}{suffix}]"
    )


def validation_error_paths(error: ValidationError) -> list[str]:
    paths: list[str] = []
    for item in error.errors(include_url=False, include_context=False):
        location = item.get("loc")
        if isinstance(location, tuple) and location:
            path = ".".join(str(part) for part in location)
        else:
            path = "<root>"
        if path not in paths:
            paths.append(path)
    return paths[:24]


def contract_repair_fields(error: ValidationError) -> list[str]:
    root_fields = set(LLMGeneratedDraftMasterScript.model_fields)
    requested: set[str] = set()
    root_messages: list[str] = []
    for item in error.errors(include_url=False, include_context=False):
        location = item.get("loc")
        if isinstance(location, tuple) and location:
            root = location[0]
            if isinstance(root, str) and root in root_fields:
                requested.add(root)
                continue
        root_messages.append(str(item.get("msg") or "").casefold())

    joined_messages = " ".join(root_messages)
    root_error_targets = (
        ("scene", "scenes"),
        ("character state", "character_state_updates"),
        ("character state evidence", "character_state_updates"),
        ("character evidence", "character_state_updates"),
        ("character", "characters"),
        ("relationship", "relationship_state_updates"),
        ("continuity", "continuity_state_updates"),
        ("story line", "story_line_updates"),
        ("setup", "setup_payoff_updates"),
        ("payoff", "setup_payoff_updates"),
        ("hook", "continuation_hook"),
        ("causal", "scenes"),
        ("cliffhanger", "scenes"),
    )
    for marker, field_name in root_error_targets:
        if marker in joined_messages:
            requested.add(field_name)
    if not requested:
        # Model-level validators in this contract are scene/ending validators.
        requested.add("scenes")
    return [
        field_name
        for field_name in LLMGeneratedDraftMasterScript.model_fields
        if field_name in requested
    ]


def build_contract_repair_schema(
    repair_fields: list[str],
) -> dict[str, object]:
    """Build a compact schema so the model cannot guess the patch envelope."""

    full_schema = LLMGeneratedDraftMasterScript.model_json_schema()
    properties = full_schema.get("properties")
    if not isinstance(properties, dict):
        return full_schema
    selected_properties: dict[str, object] = {}
    for field_name in repair_fields:
        field_schema = properties.get(field_name)
        if not isinstance(field_schema, dict):
            continue
        selected_schema = deepcopy(field_schema)
        # A field is required in this patch even when it is optional in the
        # complete output. Do not teach the provider to answer with its default.
        selected_schema.pop("default", None)
        selected_properties[field_name] = selected_schema
    if not selected_properties:
        return full_schema
    schema: dict[str, object] = {
        "title": "DraftMasterScriptContractRepairPatch",
        "type": "object",
        "properties": selected_properties,
        "required": list(selected_properties),
        "additionalProperties": False,
    }
    definitions = full_schema.get("$defs")
    if isinstance(definitions, dict):
        schema["$defs"] = definitions
    return schema


def missing_body_order_repair_context(
    output: dict[str, object],
    error: ValidationError,
) -> list[dict[str, object]] | None:
    """Isolate missing references without guessing where the author put them."""

    scenes = output.get("scenes")
    if not isinstance(scenes, list):
        return None
    scene_numbers = [scene.get("scene_number") for scene in scenes if isinstance(scene, dict)]
    if (
        len(scene_numbers) != len(scenes)
        or not all(type(number) is int for number in scene_numbers)
        or len(set(scene_numbers)) != len(scene_numbers)
    ):
        return None
    indices: set[int] = set()
    for item in error.errors(include_input=False, include_url=False, include_context=False):
        location = item["loc"]
        if (
            len(location) != 2 or location[0] != "scenes"
            or type(location[1]) is not int
            or "body_order must reference every action and dialogue exactly once" not in item["msg"]
        ):
            return None
        indices.add(location[1])
    if not indices:
        return None

    context: list[dict[str, object]] = []
    validation_probe = deepcopy(without_metadata(output))
    for index in sorted(indices):
        if not 0 <= index < len(scenes) or not isinstance(scenes[index], dict):
            return None
        scene = scenes[index]
        actions, dialogues, order = (
            scene.get("character_actions"), scene.get("dialogues"), scene.get("body_order")
        )
        if not all(isinstance(value, list) for value in (actions, dialogues, order)):
            return None
        expected = [*(f"action:{i}" for i in range(len(actions))),
                    *(f"dialogue:{i}" for i in range(len(dialogues)))]
        if (
            not order or not all(isinstance(ref, str) for ref in order)
            or len(order) != len(set(order))
            or not set(order) < set(expected)
        ):
            return None
        missing = [ref for ref in expected if ref not in order]
        context.append({
            "scene_number": scene.get("scene_number"),
            "scene_heading": scene.get("scene_heading"),
            "character_actions": deepcopy(actions),
            "dialogues": deepcopy(dialogues),
            "body_order": list(order),
            "missing_references": missing,
        })
        # This arbitrary completion is only a validation probe. Never return it:
        # the missing item's position relative to dialogue needs an author decision.
        validation_probe["scenes"][index]["body_order"] = [*order, *missing]
    try:
        # Scene before-validators can hide other field/root errors. A compact
        # order patch is appropriate only when all other contracts already hold.
        LLMGeneratedDraftMasterScript.model_validate(validation_probe)
    except ValidationError:
        return None
    return context


def build_body_order_repair_schema(context: list[dict[str, object]]) -> dict[str, object]:
    return {
        "title": "DraftBodyOrderRepairPatch",
        "type": "object",
        "additionalProperties": False,
        "required": ["scenes"],
        "properties": {"scenes": {
            "type": "array", "minItems": len(context), "maxItems": len(context),
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["scene_number", "body_order"],
                "properties": {
                    "scene_number": {"type": "integer", "enum": [scene["scene_number"] for scene in context]},
                    "body_order": {
                        "type": "array", "minItems": 1, "maxItems": 59,
                        "items": {"type": "string", "pattern": r"^(?:action|dialogue):(?:0|[1-9]\d*)$"},
                    },
                },
            },
        }},
    }


def build_body_order_repair_prompt(context: list[dict[str, object]]) -> str:
    return f"""Repair only missing body_order references in the supplied scenes.
The actions, dialogue, and existing relative performance order are fixed. Read the body to
decide where each missing reference belongs. Insert every missing reference exactly once;
retain all existing references in their original relative order. Do not rewrite any content.
References are zero-based action:0 / dialogue:0 indices into the supplied arrays.

Return exactly the requested scenes as {{"scenes":[{{"scene_number":1,"body_order":[...]}}]}}.
Each scene may contain only scene_number and body_order. Do not return body text, other
scene fields, unchanged scenes, explanations, or Markdown.

Scenes requiring missing-reference insertion:
{json.dumps(context, ensure_ascii=False, separators=(',', ':'))}"""


def merge_body_order_repair_fragment(
    original: dict[str, object],
    fragment: dict[str, object],
    context: list[dict[str, object]],
) -> dict[str, object] | None:
    """Allow only insertions into the requested orders; keep every other byte."""

    payload = without_metadata(fragment)
    patches = payload.get("scenes")
    if set(payload) != {"scenes"} or not isinstance(patches, list) or len(patches) != len(context):
        return None
    requested = {scene["scene_number"]: scene for scene in context}
    orders: dict[int, list[str]] = {}
    for patch in patches:
        if not isinstance(patch, dict) or set(patch) != {"scene_number", "body_order"}:
            return None
        number = patch["scene_number"]
        if type(number) is not int or number not in requested or number in orders:
            return None
        scene = requested[number]
        if not isinstance(patch["body_order"], list) or not all(
            isinstance(reference, str) for reference in patch["body_order"]
        ):
            return None
        try:
            order = normalize_screenplay_body_order(
                patch["body_order"], action_count=len(scene["character_actions"]),
                dialogue_count=len(scene["dialogues"]), allow_legacy_fallback=False,
            )
        except ValueError:
            return None
        original_refs = set(scene["body_order"])
        if [ref for ref in order if ref in original_refs] != scene["body_order"]:
            return None
        orders[number] = order
    merged = deepcopy(original)
    for scene in merged["scenes"]:
        if scene["scene_number"] in orders:
            scene["body_order"] = orders[scene["scene_number"]]
    return merged


def merge_contract_repair_fragment(
    original: dict[str, object],
    fragment: dict[str, object],
) -> dict[str, object] | None:
    """Recover providers that return only the corrected nested object."""

    payload = without_metadata(fragment)
    if not payload:
        return None
    root_fields = set(LLMGeneratedDraftMasterScript.model_fields)
    if set(payload).issubset(root_fields):
        merged = deepcopy(original)
        def apply_fields(target: dict[str, object], patch: dict[str, object]) -> None:
            # A nested repair may contain just the invalid field. Omission is
            # not deletion; explicit nulls and lists still replace the value.
            for key, value in patch.items():
                current = target.get(key)
                if isinstance(current, dict) and isinstance(value, dict):
                    apply_fields(current, value)
                else:
                    target[key] = deepcopy(value)

        apply_fields(merged, payload)
        return merged

    fragment_targets: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("characters", ("name",)),
        ("character_state_updates", ("character_name",)),
        (
            "relationship_state_updates",
            ("source_character_name", "target_character_name"),
        ),
        ("continuity_state_updates", ("entity_key", "state_domain")),
        ("story_line_updates", ("story_line_id",)),
        ("setup_payoff_updates", ("setup_payoff_ref",)),
        ("scenes", ("scene_number",)),
    )
    for field_name, identity_fields in fragment_targets:
        if not all(field in payload for field in identity_fields):
            continue
        current_values = original.get(field_name)
        if not isinstance(current_values, list):
            return None
        merged = deepcopy(original)
        merged_values = merged.get(field_name)
        if not isinstance(merged_values, list):
            return None
        identity = tuple(
            str(payload[field]).strip().casefold() for field in identity_fields
        )
        replaced = False
        for index, current in enumerate(merged_values):
            if not isinstance(current, dict):
                continue
            current_identity = tuple(
                str(current.get(field, "")).strip().casefold()
                for field in identity_fields
            )
            if current_identity == identity:
                if field_name == "scenes" and (
                    "character_actions" in payload or "dialogues" in payload
                ) and not {
                    "slug",
                    "purpose",
                    "setting",
                    "beat_summary",
                    "emotional_shift",
                    "emotional_objective",
                    "turning_point",
                    "scene_causality",
                }.issubset(payload):
                    current.update(payload)
                else:
                    merged_values[index] = payload
                replaced = True
                break
        if not replaced:
            merged_values.append(payload)
        return merged

    continuation_hook_fields = {
        "ending_hook_type",
        "ending_hook_summary",
        "next_episode_obligation",
    }
    if continuation_hook_fields.issubset(payload):
        merged = deepcopy(original)
        merged["continuation_hook"] = payload
        return merged
    return None


def merge_output_metadata(
    *,
    source: dict[str, object],
    target: dict[str, object],
) -> None:
    source_metadata = source.get("_meta")
    target_metadata = target.get("_meta")
    merged = dict(source_metadata) if isinstance(source_metadata, dict) else {}
    if isinstance(target_metadata, dict):
        merged.update(target_metadata)
    target["_meta"] = merged


def body_lock_signature(
    script: LLMGeneratedDraftMasterScript | DraftMasterScript,
    *,
    allow_dialogue_changes: bool = True,
) -> dict[str, object]:
    """Keep every field a body/style repair is not allowed to change."""

    editable_fields = ("character_actions", "body_order")
    if allow_dialogue_changes:
        editable_fields += ("dialogues",)
    payload = script.model_dump(mode="json")
    scenes = payload.get("scenes", [])
    if isinstance(scenes, list):
        for scene in scenes:
            if isinstance(scene, dict):
                for field in editable_fields:
                    scene.pop(field, None)
    return payload
