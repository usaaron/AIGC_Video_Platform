from __future__ import annotations

from datetime import datetime, timezone
from difflib import SequenceMatcher
from enum import Enum
import math
import re
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.script_delivery_contract import (
    DEFAULT_ENDING_MODE,
    EndingMode,
    ending_mode_requires_hook,
    ending_mode_requires_next_question,
)

if TYPE_CHECKING:
    from app.modules.script_engine.models import ScriptGenerationDraftRun, ScriptRevisionRun


_EPISODE_TITLE_PREFIX = re.compile(
    r"^\s*(?:第\s*(?:\d+|[零〇一二三四五六七八九十百千万两]+)\s*集|(?:episode|ep\.?)\s*\d+)"
    r"\s*(?:[:：\-—–、.．]\s*)?",
    re.IGNORECASE,
)

_SCREENPLAY_BODY_REFERENCE = re.compile(r"^(?:action|dialogue):(?:0|[1-9]\d*)$")
_SCREENPLAY_BODY_ORDER_MAX_ITEMS = 59
_CHARACTER_PARENTHETICAL_ALIAS = re.compile(r"[（(]([^）)]+)[）)]")


def _character_identity_keys(value: str) -> set[str]:
    normalized = "".join(
        character.casefold()
        for character in value.strip()
        if character.isalnum() or "\u3400" <= character <= "\u9fff"
    )
    keys = {normalized} if normalized else set()
    aliases = _CHARACTER_PARENTHETICAL_ALIAS.findall(value)
    base = _CHARACTER_PARENTHETICAL_ALIAS.sub("", value)
    base_has_chinese = bool(re.search(r"[\u3400-\u9fff]", base))
    base_has_latin = bool(re.search(r"[A-Za-z]", base))
    for alias in aliases:
        alias_has_chinese = bool(re.search(r"[\u3400-\u9fff]", alias))
        alias_has_latin = bool(re.search(r"[A-Za-z]", alias))
        is_bilingual_alias = (
            (base_has_chinese and alias_has_latin and not alias_has_chinese)
            or (base_has_latin and alias_has_chinese and not base_has_chinese)
        )
        if not is_bilingual_alias:
            continue
        alias_key = "".join(
            character.casefold()
            for character in alias.strip()
            if character.isalnum() or "\u3400" <= character <= "\u9fff"
        )
        if alias_key:
            keys.add(alias_key)
        base_key = "".join(
            character.casefold()
            for character in base.strip()
            if character.isalnum() or "\u3400" <= character <= "\u9fff"
        )
        if base_key:
            keys.add(base_key)
    return keys


def build_screenplay_body_order(
    action_count: int,
    dialogue_count: int,
) -> list[str]:
    """Build a stable legacy fallback while keeping both source arrays ordered."""

    if action_count <= 0:
        return [f"dialogue:{index}" for index in range(max(0, dialogue_count))]
    if dialogue_count <= 0:
        return [f"action:{index}" for index in range(max(0, action_count))]

    order: list[str] = []
    next_action = 0
    for dialogue_index in range(dialogue_count):
        target_action_count = max(
            1,
            math.ceil((dialogue_index + 1) * action_count / (dialogue_count + 1)),
        )
        while next_action < min(action_count, target_action_count):
            order.append(f"action:{next_action}")
            next_action += 1
        order.append(f"dialogue:{dialogue_index}")
    while next_action < action_count:
        order.append(f"action:{next_action}")
        next_action += 1
    return order


def normalize_screenplay_body_order(
    value: Any,
    *,
    action_count: int,
    dialogue_count: int,
) -> list[str]:
    """Accept a complete authored order or recover locally without another LLM call."""

    expected = {
        *(f"action:{index}" for index in range(max(0, action_count))),
        *(f"dialogue:{index}" for index in range(max(0, dialogue_count))),
    }
    if isinstance(value, list):
        normalized = [item.strip() for item in value if isinstance(item, str)]
        kinds = [item.partition(":")[0] for item in normalized]
        grouped_by_kind = kinds in (
            ["action"] * action_count + ["dialogue"] * dialogue_count,
            ["dialogue"] * dialogue_count + ["action"] * action_count,
        )
        if (
            len(normalized) == len(expected)
            and len(set(normalized)) == len(normalized)
            and all(_SCREENPLAY_BODY_REFERENCE.fullmatch(item) for item in normalized)
            and set(normalized) == expected
            and not (action_count > 1 and dialogue_count > 1 and grouped_by_kind)
        ):
            return normalized
    return build_screenplay_body_order(action_count, dialogue_count)


def _supply_missing_screenplay_body_order(value: Any) -> Any:
    if not isinstance(value, dict) or value.get("body_order"):
        return value
    normalized = dict(value)
    actions = normalized.get("character_actions")
    dialogues = normalized.get("dialogues")
    normalized["body_order"] = build_screenplay_body_order(
        len(actions) if isinstance(actions, list) else 0,
        len(dialogues) if isinstance(dialogues, list) else 0,
    )
    return normalized


def normalize_generated_episode_title(value: str) -> str:
    """Keep the episode title separate from the independently stored episode number."""
    normalized = value.strip()
    without_prefix = _EPISODE_TITLE_PREFIX.sub("", normalized, count=1).strip()
    return without_prefix or normalized


def _validate_scene_causal_chain(
    scenes: list[Any],
    *,
    require_contract: bool,
) -> None:
    causalities = [scene.scene_causality for scene in scenes]
    if not require_contract and all(causality is None for causality in causalities):
        return
    if any(causality is None for causality in causalities):
        raise ValueError("Scene causality must be present for every scene or omitted for legacy payloads.")

    seen_scene_numbers: set[int] = set()
    for index, scene in enumerate(scenes):
        causality = scene.scene_causality
        if causality is None:
            continue
        predecessor = causality.caused_by_scene_number
        if index == 0:
            if predecessor is not None or causality.causal_link is not None:
                raise ValueError("The first scene cannot depend on a scene in the same draft.")
        elif predecessor is None or predecessor not in seen_scene_numbers:
            raise ValueError("Each scene after the first must reference an earlier scene outcome.")
        seen_scene_numbers.add(scene.scene_number)


class ScriptTone(str, Enum):
    intense = "intense"
    melodramatic = "melodramatic"
    suspenseful = "suspenseful"
    emotional = "emotional"


class DialogueLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_name: str = Field(min_length=2, max_length=80)
    chinese_character_name: str | None = Field(min_length=1, max_length=40)
    intent: str = Field(min_length=3, max_length=120)
    # Two-character Chinese lines (for example "住手") and the standard
    # screenplay silence beat "……" are complete performable units. Counting
    # Unicode code points as if they were English letters previously sent
    # otherwise valid episodes through a multi-minute model repair.
    text: str = Field(min_length=2, max_length=280)
    # Overseas scripts keep the performable English line in ``text`` and its
    # display-only Chinese counterpart beside it. The field is required by the
    # LLM JSON schema, while the pre-validator keeps persisted legacy drafts
    # readable so they can use the bounded dialogue-only fallback.
    chinese_translation: str | None = Field(min_length=2, max_length=280)

    @model_validator(mode="before")
    @classmethod
    def supply_legacy_chinese_translation(cls, value: Any) -> Any:
        if isinstance(value, dict):
            missing = {
                field_name: None
                for field_name in (
                    "chinese_character_name",
                    "chinese_translation",
                )
                if field_name not in value
            }
            if missing:
                return {**value, **missing}
        return value


class CharacterProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=80)
    role: str = Field(min_length=2, max_length=80)
    description: str = Field(min_length=10, max_length=300)
    motivation: str = Field(min_length=5, max_length=200)


class CharacterKnowledgeState(BaseModel):
    """One character's current epistemic relationship to a specific fact."""

    model_config = ConfigDict(extra="forbid")

    knowledge_key: str = Field(min_length=3, max_length=120, pattern=r"^[a-z0-9_.:-]+$")
    statement: str = Field(min_length=2, max_length=300)
    status: str = Field(pattern=r"^(known|believed|suspected|disproved|forgotten)$")


class CharacterStateUpdate(BaseModel):
    """Evidence-backed character exit state for one generated episode."""

    model_config = ConfigDict(extra="forbid")

    character_name: str = Field(min_length=2, max_length=80)
    current_goal: str = Field(min_length=3, max_length=240)
    emotional_state: str = Field(min_length=2, max_length=160)
    belief_or_attitude: str | None = Field(default=None, min_length=3, max_length=240)
    life_status: str | None = Field(
        default=None,
        pattern=r"^(alive|dead|missing|unknown)$",
    )
    physical_state: str | None = Field(default=None, min_length=2, max_length=160)
    location: str | None = Field(default=None, min_length=2, max_length=160)
    knowledge_changes: list[str] = Field(default_factory=list, max_length=12)
    knowledge_states: list[CharacterKnowledgeState] | None = Field(default=None, max_length=20)
    health_conditions: list[str] | None = Field(default=None, max_length=12)
    action_capabilities: list[str] | None = Field(default=None, max_length=12)
    lasting_marks: list[str] | None = Field(default=None, max_length=12)
    active_constraints: list[str] = Field(default_factory=list, max_length=12)
    personality_change: str | None = Field(default=None, min_length=3, max_length=240)
    change_summary: str = Field(min_length=3, max_length=300)
    change_cause: str = Field(min_length=3, max_length=300)
    evidence_scene_numbers: list[int] = Field(min_length=1, max_length=12)

    @field_validator(
        "knowledge_changes",
        "health_conditions",
        "action_capabilities",
        "lasting_marks",
        "active_constraints",
        "evidence_scene_numbers",
    )
    @classmethod
    def ensure_unique_state_values(cls, values: list[Any] | None) -> list[Any] | None:
        if values is None:
            return values
        normalized = [str(value).strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Character state update values must be unique.")
        return values

    @field_validator("knowledge_states")
    @classmethod
    def ensure_unique_knowledge_keys(
        cls,
        values: list[CharacterKnowledgeState] | None,
    ) -> list[CharacterKnowledgeState] | None:
        if values is None:
            return values
        keys = [value.knowledge_key for value in values]
        if len(set(keys)) != len(keys):
            raise ValueError("Character knowledge keys must be unique within an update.")
        return values


class RelationshipStateUpdate(BaseModel):
    """Evidence-backed exit state for one concrete character relationship."""

    model_config = ConfigDict(extra="forbid")

    source_character_name: str = Field(min_length=2, max_length=80)
    target_character_name: str = Field(min_length=2, max_length=80)
    relationship_type: str = Field(min_length=2, max_length=120)
    source_to_target: str = Field(min_length=2, max_length=240)
    target_to_source: str = Field(min_length=2, max_length=240)
    current_state: str = Field(min_length=3, max_length=400)
    change_summary: str = Field(min_length=3, max_length=300)
    change_cause: str = Field(min_length=3, max_length=300)
    evidence_scene_numbers: list[int] = Field(min_length=1, max_length=12)

    @field_validator("evidence_scene_numbers")
    @classmethod
    def ensure_unique_relationship_evidence(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("Relationship evidence scene numbers must be unique.")
        return values

    @model_validator(mode="after")
    def prevent_self_relationship(self) -> "RelationshipStateUpdate":
        if self.source_character_name.strip().casefold() == self.target_character_name.strip().casefold():
            raise ValueError("A relationship update requires two different characters.")
        return self


class ContinuityStateUpdate(BaseModel):
    """Evidence-backed transition for a persistent person, object, place, or world fact."""

    model_config = ConfigDict(extra="forbid")

    entity_key: str = Field(min_length=3, max_length=120, pattern=r"^[a-z0-9_.:-]+$")
    entity_type: str = Field(
        pattern=r"^(character|item|location|organization|environment|society|time)$",
    )
    entity_name: str = Field(min_length=1, max_length=160)
    state_domain: str = Field(
        pattern=(
            r"^(existence|life|health|ability|condition|ownership|possession|location|"
            r"access|affiliation|authority|identity|resource|rule|schedule|weather|"
            r"reputation|legal_status|technology|knowledge|obligation|environment)$"
        ),
    )
    transition: str = Field(
        pattern=(
            r"^(established|changed|resolved|acquired|lost|moved|transferred|destroyed|"
            r"died|recovered|repaired)$"
        ),
    )
    current_state: str = Field(min_length=2, max_length=300)
    persistence: str = Field(pattern=r"^(temporary|ongoing|permanent)$")
    future_constraint: str | None = Field(default=None, min_length=2, max_length=300)
    change_cause: str = Field(min_length=2, max_length=300)
    evidence_scene_numbers: list[int] = Field(min_length=1, max_length=12)

    @field_validator("evidence_scene_numbers")
    @classmethod
    def ensure_unique_continuity_evidence(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("Continuity evidence scene numbers must be unique.")
        return values


class StoryLineStateUpdate(BaseModel):
    """Evidence-backed progress for one approved Story Bible line."""

    model_config = ConfigDict(extra="forbid")

    story_line_id: str = Field(min_length=3, max_length=120, pattern=r"^[a-z0-9_.:-]+$")
    status: str = Field(pattern=r"^(setup|active|resolved)$")
    progress_summary: str = Field(min_length=3, max_length=500)
    contribution_type: str = Field(
        default="progress",
        pattern=r"^(setup|progress|turning_point|payoff|resolution)$",
    )
    planned_beat_ref: str | None = Field(default=None, min_length=2, max_length=240)
    planned_alignment: str = Field(
        default="aligned",
        pattern=r"^(aligned|expanded|deviated)$",
    )
    alignment_note: str | None = Field(default=None, min_length=3, max_length=300)
    next_required_step: str | None = Field(default=None, min_length=3, max_length=300)
    change_cause: str = Field(min_length=3, max_length=300)
    evidence_scene_numbers: list[int] = Field(min_length=1, max_length=12)

    @field_validator("evidence_scene_numbers")
    @classmethod
    def ensure_unique_story_line_evidence(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("Story-line evidence scene numbers must be unique.")
        return values

    @model_validator(mode="after")
    def validate_plan_alignment_note(self) -> "StoryLineStateUpdate":
        if self.planned_alignment != "aligned" and self.alignment_note is None:
            raise ValueError("Expanded or deviated story-line progress requires alignment_note.")
        return self


class SetupPayoffStateUpdate(BaseModel):
    """Evidence-backed progress for a planned long-range setup or payoff."""

    model_config = ConfigDict(extra="forbid")

    setup_payoff_ref: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-zA-Z0-9_.:-]+$",
    )
    action: str = Field(
        pattern=r"^(setup|reinforce|partial_payoff|payoff|defer)$",
    )
    status: str = Field(pattern=r"^(setup|active|paid_off)$")
    progress_summary: str = Field(min_length=3, max_length=500)
    next_required_step: str | None = Field(default=None, min_length=3, max_length=300)
    target_payoff_episode: int | None = Field(default=None, ge=1, le=2_000)
    change_cause: str = Field(min_length=3, max_length=300)
    evidence_scene_numbers: list[int] = Field(min_length=1, max_length=12)

    @field_validator("evidence_scene_numbers")
    @classmethod
    def ensure_unique_setup_payoff_evidence(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("Setup/payoff evidence scene numbers must be unique.")
        return values

    @model_validator(mode="after")
    def validate_setup_payoff_lifecycle(self) -> "SetupPayoffStateUpdate":
        if self.action == "payoff" and self.status != "paid_off":
            raise ValueError("A full payoff action must use paid_off status.")
        if self.status == "paid_off" and self.action != "payoff":
            raise ValueError("paid_off status requires a full payoff action.")
        return self


class ContinuationHookState(BaseModel):
    """Tracks how this episode pays the prior hook and creates the next one."""

    model_config = ConfigDict(extra="forbid")

    responds_to_episode: int | None = Field(default=None, ge=1, le=2_000)
    previous_hook_response: str | None = Field(default=None, min_length=3, max_length=300)
    response_evidence_scene_numbers: list[int] = Field(default_factory=list, max_length=12)
    ending_hook_type: str = Field(min_length=2, max_length=80)
    ending_hook_summary: str = Field(min_length=3, max_length=300)
    next_episode_obligation: str = Field(min_length=3, max_length=300)
    target_payoff_episode: int | None = Field(default=None, ge=1, le=2_000)

    @field_validator("response_evidence_scene_numbers")
    @classmethod
    def ensure_unique_hook_evidence(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("Hook response evidence scene numbers must be unique.")
        return values

    @model_validator(mode="after")
    def validate_hook_response_reference(self) -> "ContinuationHookState":
        if self.responds_to_episode is not None and self.previous_hook_response is None:
            raise ValueError("A hook response reference requires previous_hook_response.")
        if self.response_evidence_scene_numbers and self.previous_hook_response is None:
            raise ValueError("Hook response evidence requires previous_hook_response.")
        return self


class SceneCausality(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal: str = Field(min_length=5, max_length=240)
    conflict: str = Field(min_length=5, max_length=300)
    outcome: str = Field(min_length=5, max_length=240)
    caused_by_scene_number: int | None = Field(default=None, ge=1, le=50)
    causal_link: str | None = Field(default=None, min_length=5, max_length=240)

    @model_validator(mode="after")
    def ensure_outcome_changes_the_scene_state(self) -> "SceneCausality":
        normalized_goal = " ".join(self.goal.casefold().split())
        normalized_outcome = " ".join(self.outcome.casefold().split())
        similarity = SequenceMatcher(None, normalized_goal, normalized_outcome).ratio()
        if normalized_goal == normalized_outcome or similarity >= 0.92:
            raise ValueError("Scene outcome must meaningfully differ from scene goal.")
        if self.caused_by_scene_number is not None and self.causal_link is None:
            raise ValueError("A causal_link is required when caused_by_scene_number is set.")
        return self


_SCENE_TIME_PATTERN = re.compile(
    r"(黎明|清晨|早晨|上午|中午|下午|傍晚|黄昏|夜晚|深夜|白天|日间|夜|日)",
)
_SCENE_SPEAKER_MARKER_PATTERN = re.compile(
    r"\s*[（(](?:O\.S\.|V\.O\.|CONTINUED|PRE[-‑ ]?LAP)[）)]\s*$",
    re.IGNORECASE,
)


class SceneContentManifest(BaseModel):
    """Creator-facing content required to make one scene producible.

    The manifest is separate from planning and QC fields. It is rendered as a
    compact episode information sheet while the formal screenplay body remains
    action/dialogue only.
    """

    model_config = ConfigDict(extra="forbid")

    location: str = Field(min_length=3, max_length=120)
    time_of_day: str = Field(min_length=1, max_length=40)
    character_refs: list[str] = Field(default_factory=list, max_length=20)
    objective: str = Field(min_length=5, max_length=240)
    conflict: str = Field(min_length=5, max_length=300)
    turning_point: str = Field(min_length=3, max_length=240)
    outcome: str = Field(min_length=5, max_length=240)
    props: list[str] = Field(default_factory=list, max_length=12)
    entry_state: str = Field(min_length=3, max_length=240)
    exit_state: str = Field(min_length=3, max_length=240)

    @field_validator("character_refs", "props")
    @classmethod
    def ensure_unique_manifest_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Scene content manifest values must be unique.")
        return values


def _infer_scene_character_refs(dialogues: list[Any]) -> list[str]:
    refs: list[str] = []
    for dialogue in dialogues:
        if isinstance(dialogue, dict):
            name = dialogue.get("chinese_character_name") or dialogue.get("character_name", "")
        else:
            name = getattr(dialogue, "chinese_character_name", None) or getattr(
                dialogue, "character_name", ""
            )
        if not isinstance(name, str):
            continue
        normalized = _SCENE_SPEAKER_MARKER_PATTERN.sub("", name).strip()
        if normalized and normalized.casefold() not in {value.casefold() for value in refs}:
            refs.append(normalized)
    return refs


def _default_scene_content_manifest(
    *,
    location: str,
    purpose: str,
    beat_summary: str,
    turning_point: str | None,
    scene_causality: SceneCausality | None,
    dialogues: list[Any],
    character_refs: list[str],
) -> SceneContentManifest:
    causal = scene_causality
    scene_location = location.strip() or "未指定地点"
    time_match = _SCENE_TIME_PATTERN.search(scene_location)
    return SceneContentManifest(
        location=scene_location,
        time_of_day=time_match.group(1) if time_match else "未指定时间",
        character_refs=list(character_refs) or _infer_scene_character_refs(dialogues),
        objective=purpose,
        conflict=causal.conflict if causal else "场景中的阻力阻止人物直接完成目标。",
        turning_point=turning_point or (causal.outcome if causal else beat_summary),
        outcome=causal.outcome if causal else beat_summary,
        props=[],
        entry_state=(
            causal.causal_link
            if causal and causal.causal_link
            else "人物带着既有目标进入场景。"
        ),
        exit_state=causal.outcome if causal else beat_summary,
    )


class SceneCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=50)
    slug: str = Field(min_length=3, max_length=120)
    scene_heading: str | None = Field(default=None, min_length=5, max_length=200)
    purpose: str = Field(min_length=5, max_length=240)
    setting: str = Field(min_length=3, max_length=120)
    beat_summary: str = Field(min_length=5, max_length=300)
    emotional_shift: str = Field(min_length=3, max_length=120)
    emotional_objective: str | None = Field(default=None, min_length=3, max_length=160)
    character_refs: list[str] = Field(default_factory=list, max_length=20)
    character_actions: list[str] = Field(default_factory=list, max_length=24)
    body_order: list[str] = Field(default_factory=list, max_length=_SCREENPLAY_BODY_ORDER_MAX_ITEMS)
    turning_point: str | None = Field(default=None, min_length=3, max_length=240)
    scene_causality: SceneCausality | None = None
    cliffhanger: bool = False
    dialogues: list[DialogueLine] = Field(min_length=1, max_length=35)
    content_manifest: SceneContentManifest | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_scene_heading_aliases(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        if not normalized.get("setting") and normalized.get("scene_heading"):
            normalized["setting"] = normalized["scene_heading"]
        if not normalized.get("scene_heading") and normalized.get("setting"):
            normalized["scene_heading"] = normalized["setting"]
        return normalized

    @model_validator(mode="after")
    def ensure_complete_body_order(self) -> "SceneCard":
        self.body_order = normalize_screenplay_body_order(
            self.body_order,
            action_count=len(self.character_actions),
            dialogue_count=len(self.dialogues),
        )
        if self.content_manifest is None:
            self.content_manifest = _default_scene_content_manifest(
                location=self.scene_heading or self.setting or self.slug,
                purpose=self.purpose,
                beat_summary=self.beat_summary,
                turning_point=self.turning_point,
                scene_causality=self.scene_causality,
                dialogues=self.dialogues,
                character_refs=self.character_refs,
            )
        if not self.character_refs:
            self.character_refs = list(self.content_manifest.character_refs)
        return self


class DraftSceneCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=50)
    slug: str = Field(min_length=3, max_length=120)
    scene_heading: str | None = Field(default=None, min_length=5, max_length=200)
    purpose: str = Field(min_length=5, max_length=240)
    setting_hint: str = Field(min_length=3, max_length=120)
    beat_summary: str = Field(min_length=5, max_length=300)
    emotional_shift: str = Field(min_length=3, max_length=120)
    emotional_objective: str | None = Field(default=None, min_length=3, max_length=160)
    character_refs: list[str] = Field(default_factory=list, max_length=20)
    character_actions: list[str] = Field(default_factory=list, max_length=24)
    body_order: list[str] = Field(default_factory=list, max_length=_SCREENPLAY_BODY_ORDER_MAX_ITEMS)
    turning_point: str | None = Field(default=None, min_length=3, max_length=240)
    scene_causality: SceneCausality | None = None
    cliffhanger: bool = False
    dialogue_prompts: list[str] = Field(default_factory=list, max_length=10)
    dialogues: list[DialogueLine] = Field(default_factory=list, max_length=35)
    supporting_asset_ids: list[str] = Field(default_factory=list, max_length=10)
    content_manifest: SceneContentManifest | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_scene_heading_aliases(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        if not normalized.get("setting_hint") and normalized.get("scene_heading"):
            normalized["setting_hint"] = normalized["scene_heading"]
        if not normalized.get("scene_heading") and normalized.get("setting_hint"):
            normalized["scene_heading"] = normalized["setting_hint"]
        return normalized

    @field_validator("dialogue_prompts", "supporting_asset_ids", "character_actions")
    @classmethod
    def ensure_unique_string_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values

    @model_validator(mode="after")
    def ensure_complete_body_order(self) -> "DraftSceneCard":
        self.body_order = normalize_screenplay_body_order(
            self.body_order,
            action_count=len(self.character_actions),
            dialogue_count=len(self.dialogues),
        )
        if self.content_manifest is None:
            self.content_manifest = _default_scene_content_manifest(
                location=self.scene_heading or self.setting_hint or self.slug,
                purpose=self.purpose,
                beat_summary=self.beat_summary,
                turning_point=self.turning_point,
                scene_causality=self.scene_causality,
                dialogues=self.dialogues,
                character_refs=self.character_refs,
            )
        if not self.character_refs:
            self.character_refs = list(self.content_manifest.character_refs)
        return self


class MasterScriptBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_spec_id: str = Field(min_length=3, max_length=80)
    title: str = Field(min_length=2, max_length=120)
    logline: str | None = Field(default=None, min_length=10, max_length=240)
    language: str = Field(min_length=2, max_length=20)
    target_audience: str | None = Field(default=None, min_length=3, max_length=200)
    target_platform: str | None = Field(default=None, min_length=2, max_length=80)
    tone: ScriptTone
    hook: str = Field(min_length=5, max_length=240)
    synopsis: str = Field(min_length=10, max_length=500)
    episode_cast: list[str] = Field(default_factory=list, max_length=20)
    locations: list[str] = Field(default_factory=list, max_length=20)
    episode_goal: str = Field(min_length=5, max_length=240)
    target_duration_seconds: int = Field(ge=5, le=600)
    ending_mode: EndingMode = DEFAULT_ENDING_MODE
    characters: list[CharacterProfile] = Field(default_factory=list, max_length=20)
    character_state_updates: list[CharacterStateUpdate] = Field(
        default_factory=list,
        max_length=20,
    )
    relationship_state_updates: list[RelationshipStateUpdate] = Field(
        default_factory=list,
        max_length=40,
    )
    continuity_state_updates: list[ContinuityStateUpdate] = Field(
        default_factory=list,
        max_length=40,
    )
    story_line_updates: list[StoryLineStateUpdate] = Field(default_factory=list, max_length=20)
    setup_payoff_updates: list[SetupPayoffStateUpdate] = Field(default_factory=list, max_length=30)
    continuation_hook: ContinuationHookState | None = None
    scenes: list[SceneCard] = Field(min_length=1, max_length=20)
    next_episode_question: str | None = Field(default=None, min_length=5, max_length=240)
    qa_notes: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("qa_notes")
    @classmethod
    def ensure_unique_qa_notes(cls, notes: list[str]) -> list[str]:
        normalized = [note.strip().lower() for note in notes]
        if len(set(normalized)) != len(normalized):
            raise ValueError("QA notes must be unique.")
        return notes

    @field_validator("scenes")
    @classmethod
    def ensure_unique_scene_numbers(cls, scenes: list[SceneCard]) -> list[SceneCard]:
        numbers = [scene.scene_number for scene in scenes]
        if len(set(numbers)) != len(numbers):
            raise ValueError("Scene numbers must be unique.")
        return scenes

    @model_validator(mode="after")
    def ensure_episode_content_index(self) -> "MasterScriptBase":
        if not self.episode_cast:
            self.episode_cast = list(
                dict.fromkeys(
                    reference
                    for scene in self.scenes
                    for reference in scene.character_refs
                )
            ) or [character.name for character in self.characters]
        if not self.locations:
            self.locations = list(
                dict.fromkeys(
                    (scene.scene_heading or scene.setting or scene.slug).strip()
                    for scene in self.scenes
                )
            )
        return self

    @model_validator(mode="after")
    def ensure_final_scene_has_cliffhanger(self) -> "MasterScriptBase":
        if ending_mode_requires_hook(self.ending_mode) and not self.scenes[-1].cliffhanger:
            raise ValueError("The final scene must end with a cliffhanger in MVP mode.")
        _validate_scene_causal_chain(self.scenes, require_contract=False)
        return self


class DraftMasterScriptBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_spec_id: str = Field(min_length=3, max_length=80)
    generation_strategy_id: str = Field(min_length=3, max_length=120)
    title: str = Field(min_length=2, max_length=120)
    logline: str | None = Field(default=None, min_length=10, max_length=240)
    language: str = Field(min_length=2, max_length=20)
    target_audience: str | None = Field(default=None, min_length=3, max_length=200)
    target_platform: str | None = Field(default=None, min_length=2, max_length=80)
    tone: ScriptTone
    hook: str = Field(min_length=5, max_length=240)
    synopsis: str = Field(min_length=10, max_length=500)
    episode_cast: list[str] = Field(default_factory=list, max_length=20)
    locations: list[str] = Field(default_factory=list, max_length=20)
    episode_goal: str = Field(min_length=5, max_length=240)
    target_duration_seconds: int = Field(ge=5, le=600)
    ending_mode: EndingMode = DEFAULT_ENDING_MODE
    characters: list[CharacterProfile] = Field(default_factory=list, max_length=20)
    character_state_updates: list[CharacterStateUpdate] = Field(
        default_factory=list,
        max_length=20,
    )
    relationship_state_updates: list[RelationshipStateUpdate] = Field(
        default_factory=list,
        max_length=40,
    )
    continuity_state_updates: list[ContinuityStateUpdate] = Field(
        default_factory=list,
        max_length=40,
    )
    story_line_updates: list[StoryLineStateUpdate] = Field(default_factory=list, max_length=20)
    setup_payoff_updates: list[SetupPayoffStateUpdate] = Field(default_factory=list, max_length=30)
    continuation_hook: ContinuationHookState | None = None
    scenes: list[DraftSceneCard] = Field(min_length=1, max_length=20)
    next_episode_question: str | None = Field(default=None, min_length=5, max_length=240)
    qa_notes: list[str] = Field(default_factory=list, max_length=10)
    llm_metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("qa_notes")
    @classmethod
    def ensure_unique_draft_qa_notes(cls, notes: list[str]) -> list[str]:
        normalized = [note.strip().lower() for note in notes]
        if len(set(normalized)) != len(normalized):
            raise ValueError("QA notes must be unique.")
        return notes

    @field_validator("scenes")
    @classmethod
    def ensure_unique_draft_scene_numbers(
        cls, scenes: list[DraftSceneCard]
    ) -> list[DraftSceneCard]:
        numbers = [scene.scene_number for scene in scenes]
        if len(set(numbers)) != len(numbers):
            raise ValueError("Scene numbers must be unique.")
        return scenes

    @model_validator(mode="after")
    def ensure_draft_episode_content_index(self) -> "DraftMasterScriptBase":
        if not self.episode_cast:
            self.episode_cast = list(
                dict.fromkeys(
                    reference
                    for scene in self.scenes
                    for reference in scene.character_refs
                )
            ) or [character.name for character in self.characters]
        if not self.locations:
            self.locations = list(
                dict.fromkeys(
                    (scene.scene_heading or scene.setting_hint or scene.slug).strip()
                    for scene in self.scenes
                )
            )
        return self

    @model_validator(mode="after")
    def ensure_final_draft_scene_has_cliffhanger(self) -> "DraftMasterScriptBase":
        if ending_mode_requires_hook(self.ending_mode) and not self.scenes[-1].cliffhanger:
            raise ValueError("The final draft scene must end with a cliffhanger in MVP mode.")
        _validate_scene_causal_chain(self.scenes, require_contract=False)
        return self


class DraftMasterScript(DraftMasterScriptBase):
    id: str = Field(default_factory=lambda: str(uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DraftMasterScriptCreate(DraftMasterScriptBase):
    pass


class MasterScriptCreate(MasterScriptBase):
    pass


class MasterScript(MasterScriptBase):
    id: str = Field(default_factory=lambda: str(uuid4()))
    version: str = Field(min_length=1, max_length=80)
    lineage: "FinalMasterScriptLineage"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MasterScriptResponse(BaseModel):
    data: MasterScript


class MasterScriptListResponse(BaseModel):
    data: list[MasterScript]


class FinalMasterScriptLineage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_spec_id: str = Field(min_length=3, max_length=120)
    platform_profile_id: str = Field(min_length=3, max_length=120)
    generation_strategy_id: str = Field(min_length=3, max_length=120)
    generation_strategy_version: str = Field(min_length=1, max_length=80)
    selected_prompt_ids: list[str] = Field(min_length=1, max_length=20)
    selected_prompt_versions: list[str] = Field(default_factory=list, max_length=20)
    prompt_builder_version: str = Field(min_length=1, max_length=80)
    llm_provider: str = Field(min_length=2, max_length=80)
    llm_model_name: str = Field(min_length=2, max_length=120)
    original_draft_master_script_id: str = Field(min_length=3, max_length=120)
    ending_mode: EndingMode = DEFAULT_ENDING_MODE
    original_story_qc_score: float = Field(ge=0.0, le=1.0)
    original_story_qc_status: str = Field(min_length=3, max_length=80)
    revision_plan_created_at: datetime
    revision_action_ids: list[str] = Field(default_factory=list, max_length=20)
    revised_draft_master_script_id: str = Field(min_length=3, max_length=120)
    re_qc_score: float = Field(ge=0.0, le=1.0)
    re_qc_status: str = Field(min_length=3, max_length=80)
    minimum_re_qc_score_required: float = Field(ge=0.0, le=1.0)
    dialogue_line_count_per_scene: int = Field(ge=1, le=6)
    speaker_name_cycle: list[str] = Field(min_length=1, max_length=6)
    finalization_policy_id: str = Field(min_length=3, max_length=120)
    finalization_version: str = Field(min_length=3, max_length=120)
    draft_generated_at: datetime
    revision_generated_at: datetime
    finalized_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator(
        "selected_prompt_ids",
        "selected_prompt_versions",
        "revision_action_ids",
        "speaker_name_cycle",
    )
    @classmethod
    def ensure_unique_lineage_lists(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


class LLMGeneratedSceneCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=50)
    slug: str = Field(min_length=3, max_length=120)
    scene_heading: str = Field(min_length=5, max_length=200)
    purpose: str = Field(min_length=5, max_length=240)
    setting: str = Field(min_length=3, max_length=120)
    beat_summary: str = Field(min_length=5, max_length=300)
    emotional_shift: str = Field(min_length=3, max_length=120)
    emotional_objective: str = Field(min_length=3, max_length=160)
    character_refs: list[str] = Field(min_length=1, max_length=20)
    character_actions: list[str] = Field(min_length=1, max_length=24)
    body_order: list[str] = Field(min_length=1, max_length=_SCREENPLAY_BODY_ORDER_MAX_ITEMS)
    turning_point: str = Field(min_length=3, max_length=240)
    scene_causality: SceneCausality
    cliffhanger: bool = False
    dialogues: list[DialogueLine] = Field(min_length=1, max_length=35)
    content_manifest: SceneContentManifest

    @model_validator(mode="before")
    @classmethod
    def normalize_scene_heading_aliases(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        if not normalized.get("setting") and normalized.get("scene_heading"):
            normalized["setting"] = normalized["scene_heading"]
        if not normalized.get("scene_heading") and normalized.get("setting"):
            normalized["scene_heading"] = normalized["setting"]
        if not normalized.get("character_refs"):
            normalized["character_refs"] = _infer_scene_character_refs(
                normalized.get("dialogues") if isinstance(normalized.get("dialogues"), list) else []
            )
        if not normalized.get("content_manifest"):
            causal_value = normalized.get("scene_causality")
            causal = None
            if isinstance(causal_value, dict):
                try:
                    causal = SceneCausality.model_validate(causal_value)
                except Exception:
                    causal = None
            normalized["content_manifest"] = _default_scene_content_manifest(
                location=str(normalized.get("scene_heading") or normalized.get("setting") or normalized.get("slug") or "未指定地点"),
                purpose=str(normalized.get("purpose") or "完成本场目标"),
                beat_summary=str(normalized.get("beat_summary") or "本场产生可见变化"),
                turning_point=normalized.get("turning_point"),
                scene_causality=causal,
                dialogues=normalized.get("dialogues") if isinstance(normalized.get("dialogues"), list) else [],
                character_refs=normalized.get("character_refs") if isinstance(normalized.get("character_refs"), list) else [],
            ).model_dump()
        return normalized

    @model_validator(mode="before")
    @classmethod
    def supply_legacy_body_order(cls, value: Any) -> Any:
        return _supply_missing_screenplay_body_order(value)

    @model_validator(mode="after")
    def ensure_complete_body_order(self) -> "LLMGeneratedSceneCard":
        self.body_order = normalize_screenplay_body_order(
            self.body_order,
            action_count=len(self.character_actions),
            dialogue_count=len(self.dialogues),
        )
        return self


class LLMGeneratedSceneBodyPatch(BaseModel):
    """Focused body replacement used without regenerating episode metadata."""

    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=50)
    character_actions: list[str] = Field(min_length=1, max_length=24)
    body_order: list[str] = Field(min_length=1, max_length=_SCREENPLAY_BODY_ORDER_MAX_ITEMS)
    dialogues: list[DialogueLine] = Field(min_length=1, max_length=35)

    @model_validator(mode="before")
    @classmethod
    def supply_legacy_body_order(cls, value: Any) -> Any:
        return _supply_missing_screenplay_body_order(value)

    @model_validator(mode="after")
    def ensure_complete_body_order(self) -> "LLMGeneratedSceneBodyPatch":
        self.body_order = normalize_screenplay_body_order(
            self.body_order,
            action_count=len(self.character_actions),
            dialogue_count=len(self.dialogues),
        )
        return self


class LLMTargetedScriptTextPatch(BaseModel):
    """One exact text-selection replacement, or an explicit full-rewrite handoff."""

    model_config = ConfigDict(extra="forbid")

    replacement_text: str | None = Field(default=None, min_length=1, max_length=4_000)
    updated_chinese_translation: str | None = Field(
        default=None,
        min_length=2,
        max_length=280,
    )
    requires_full_episode_rewrite: bool = False
    reason: str | None = Field(default=None, min_length=2, max_length=500)

    @model_validator(mode="after")
    def ensure_patch_or_handoff(self) -> "LLMTargetedScriptTextPatch":
        if self.requires_full_episode_rewrite:
            if self.reason is None:
                raise ValueError("A full-episode rewrite handoff requires a reason.")
            return self
        if self.replacement_text is None:
            raise ValueError("A targeted text patch requires replacement_text.")
        return self


class LLMMainlandBodyRepairPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenes: list[LLMGeneratedSceneBodyPatch] = Field(min_length=1, max_length=20)

    @field_validator("scenes")
    @classmethod
    def ensure_unique_scene_numbers(
        cls,
        values: list[LLMGeneratedSceneBodyPatch],
    ) -> list[LLMGeneratedSceneBodyPatch]:
        scene_numbers = [scene.scene_number for scene in values]
        if len(set(scene_numbers)) != len(scene_numbers):
            raise ValueError("Body repair scenes must use unique scene numbers.")
        return values


class LLMScriptEditorialPatch(BaseModel):
    """Complete scene-body edit returned by the mandatory screenplay editor.

    The editor may improve only performable action and dialogue. Story facts,
    scene headings, causal structure, continuity updates, and hook obligations
    remain authoritative in the already validated DeepSeek draft.
    """

    model_config = ConfigDict(extra="forbid")

    scenes: list[LLMGeneratedSceneBodyPatch] = Field(min_length=1, max_length=20)

    @field_validator("scenes")
    @classmethod
    def ensure_unique_editor_scene_numbers(
        cls,
        values: list[LLMGeneratedSceneBodyPatch],
    ) -> list[LLMGeneratedSceneBodyPatch]:
        scene_numbers = [scene.scene_number for scene in values]
        if len(set(scene_numbers)) != len(scene_numbers):
            raise ValueError("Editorial scenes must use unique scene numbers.")
        return values


class LLMContinuityRepairPatch(BaseModel):
    """Small structured patch for one episode's blocking continuity conflicts."""

    model_config = ConfigDict(extra="forbid")

    scenes: list[LLMGeneratedSceneCard] = Field(default_factory=list, max_length=20)
    character_state_updates: list[CharacterStateUpdate] = Field(default_factory=list, max_length=20)
    relationship_state_updates: list[RelationshipStateUpdate] = Field(
        default_factory=list,
        max_length=40,
    )
    continuity_state_updates: list[ContinuityStateUpdate] = Field(
        default_factory=list,
        max_length=40,
    )
    story_line_updates: list[StoryLineStateUpdate] = Field(default_factory=list, max_length=20)
    setup_payoff_updates: list[SetupPayoffStateUpdate] = Field(default_factory=list, max_length=30)
    continuation_hook: ContinuationHookState | None = None

    @field_validator("scenes")
    @classmethod
    def ensure_unique_repaired_scenes(
        cls,
        values: list[LLMGeneratedSceneCard],
    ) -> list[LLMGeneratedSceneCard]:
        scene_numbers = [scene.scene_number for scene in values]
        if len(set(scene_numbers)) != len(scene_numbers):
            raise ValueError("Continuity repair scenes must use unique scene numbers.")
        return values


class LLMGeneratedDraftMasterScript(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=2, max_length=120)
    logline: str = Field(min_length=10, max_length=240)
    synopsis: str = Field(min_length=10, max_length=500)
    hook: str = Field(min_length=5, max_length=240)
    episode_cast: list[str] = Field(min_length=1, max_length=20)
    locations: list[str] = Field(min_length=1, max_length=20)
    target_audience: str = Field(min_length=3, max_length=200)
    target_platform: str = Field(min_length=2, max_length=80)
    language: str = Field(min_length=2, max_length=20)
    tone: ScriptTone
    episode_goal: str = Field(min_length=5, max_length=240)
    target_duration_seconds: int = Field(ge=5, le=600)
    ending_mode: EndingMode = DEFAULT_ENDING_MODE
    characters: list[CharacterProfile] = Field(min_length=1, max_length=20)
    character_state_updates: list[CharacterStateUpdate] = Field(min_length=1, max_length=20)
    relationship_state_updates: list[RelationshipStateUpdate] = Field(
        default_factory=list,
        max_length=40,
    )
    continuity_state_updates: list[ContinuityStateUpdate] = Field(default_factory=list, max_length=40)
    story_line_updates: list[StoryLineStateUpdate] = Field(default_factory=list, max_length=20)
    setup_payoff_updates: list[SetupPayoffStateUpdate] = Field(default_factory=list, max_length=30)
    continuation_hook: ContinuationHookState | None = None
    scenes: list[LLMGeneratedSceneCard] = Field(min_length=1, max_length=20)
    next_episode_question: str | None = Field(default=None, min_length=5, max_length=240)

    @model_validator(mode="before")
    @classmethod
    def supply_episode_content_index(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        raw_scenes = normalized.get("scenes") if isinstance(normalized.get("scenes"), list) else []
        if not normalized.get("episode_cast"):
            refs = [
                reference
                for scene in raw_scenes
                if isinstance(scene, dict)
                for reference in (
                    scene.get("character_refs")
                    or _infer_scene_character_refs(scene.get("dialogues", []))
                )
                if isinstance(reference, str) and reference.strip()
            ]
            if not refs and isinstance(normalized.get("characters"), list):
                refs = [
                    character.get("name", "")
                    for character in normalized["characters"]
                    if isinstance(character, dict) and character.get("name")
                ]
            normalized["episode_cast"] = list(dict.fromkeys(refs))
        if not normalized.get("locations"):
            locations = [
                scene.get("scene_heading") or scene.get("setting") or scene.get("slug", "")
                for scene in raw_scenes
                if isinstance(scene, dict)
            ]
            normalized["locations"] = list(dict.fromkeys(value.strip() for value in locations if isinstance(value, str) and value.strip()))
        return normalized

    @field_validator("title", mode="before")
    @classmethod
    def remove_episode_number_from_title(cls, value: Any) -> Any:
        return normalize_generated_episode_title(value) if isinstance(value, str) else value

    @field_validator("characters")
    @classmethod
    def ensure_unique_character_identities(
        cls,
        characters: list[CharacterProfile],
    ) -> list[CharacterProfile]:
        seen: set[str] = set()
        for character in characters:
            keys = _character_identity_keys(character.name)
            if seen.intersection(keys):
                raise ValueError(
                    "Generated characters must contain one record per identity; aliases, "
                    "titles, and alternate identities cannot create duplicate characters."
                )
            seen.update(keys)
        return characters

    @model_validator(mode="after")
    def ensure_scene_causal_chain(self) -> "LLMGeneratedDraftMasterScript":
        _validate_scene_causal_chain(self.scenes, require_contract=True)
        if ending_mode_requires_hook(self.ending_mode) and not self.scenes[-1].cliffhanger:
            raise ValueError("The final generated scene must deliver the cliffhanger or payoff.")
        if ending_mode_requires_next_question(self.ending_mode) and not self.next_episode_question:
            raise ValueError(
                "Serial episodes must provide a concrete next_episode_question."
            )
        if not self.episode_cast:
            self.episode_cast = list(
                dict.fromkeys(
                    reference
                    for scene in self.scenes
                    for reference in scene.character_refs
                )
            ) or [character.name for character in self.characters]
        if not self.locations:
            self.locations = list(
                dict.fromkeys(
                    (scene.scene_heading or scene.setting or scene.slug).strip()
                    for scene in self.scenes
                )
            )
        character_names = {
            character.name.strip().casefold() for character in self.characters
        }
        update_names = [
            update.character_name.strip().casefold()
            for update in self.character_state_updates
        ]
        if len(set(update_names)) != len(update_names):
            raise ValueError("Character state updates must reference unique characters.")
        if any(name not in character_names for name in update_names):
            raise ValueError("Character state updates must reference generated characters.")
        relationship_pairs: list[tuple[str, str]] = []
        for update in self.relationship_state_updates:
            source_name = update.source_character_name.strip().casefold()
            target_name = update.target_character_name.strip().casefold()
            if source_name not in character_names or target_name not in character_names:
                raise ValueError("Relationship updates must reference generated characters.")
            relationship_pairs.append(tuple(sorted((source_name, target_name))))
        if len(set(relationship_pairs)) != len(relationship_pairs):
            raise ValueError("Relationship updates must reference unique character pairs.")
        scene_numbers = {scene.scene_number for scene in self.scenes}
        if any(
            scene_number not in scene_numbers
            for update in self.character_state_updates
            for scene_number in update.evidence_scene_numbers
        ):
            raise ValueError("Character state evidence must reference this episode's scenes.")
        if any(
            scene_number not in scene_numbers
            for update in self.story_line_updates
            for scene_number in update.evidence_scene_numbers
        ):
            raise ValueError("Story-line evidence must reference this episode's scenes.")
        if any(
            scene_number not in scene_numbers
            for update in self.setup_payoff_updates
            for scene_number in update.evidence_scene_numbers
        ):
            raise ValueError("Setup/payoff evidence must reference this episode's scenes.")
        if any(
            scene_number not in scene_numbers
            for update in self.continuity_state_updates
            for scene_number in update.evidence_scene_numbers
        ):
            raise ValueError("Continuity-state evidence must reference this episode's scenes.")
        if any(
            scene_number not in scene_numbers
            for update in self.relationship_state_updates
            for scene_number in update.evidence_scene_numbers
        ):
            raise ValueError("Relationship evidence must reference this episode's scenes.")
        continuity_keys = [
            (update.entity_key, update.state_domain)
            for update in self.continuity_state_updates
        ]
        if len(set(continuity_keys)) != len(continuity_keys):
            raise ValueError(
                "Continuity-state updates must use unique entity/domain pairs per episode."
            )
        setup_payoff_refs = [
            update.setup_payoff_ref.casefold() for update in self.setup_payoff_updates
        ]
        if len(set(setup_payoff_refs)) != len(setup_payoff_refs):
            raise ValueError("Setup/payoff updates must reference unique planned refs.")
        if self.continuation_hook is not None and any(
            scene_number not in scene_numbers
            for scene_number in self.continuation_hook.response_evidence_scene_numbers
        ):
            raise ValueError("Hook response evidence must reference this episode's scenes.")
        scenes_by_number = {scene.scene_number: scene for scene in self.scenes}
        for update in self.character_state_updates:
            normalized_name = update.character_name.strip().casefold()
            for scene_number in update.evidence_scene_numbers:
                scene = scenes_by_number[scene_number]
                evidence_text = " ".join(
                    [
                        *scene.character_actions,
                        *(
                            value
                            for dialogue in scene.dialogues
                            for value in (dialogue.character_name, dialogue.text)
                        ),
                    ]
                ).casefold()
                if normalized_name not in evidence_text:
                    raise ValueError(
                        "Character state evidence scenes must visibly involve the character."
                    )
        for update in self.relationship_state_updates:
            source_name = update.source_character_name.strip().casefold()
            target_name = update.target_character_name.strip().casefold()
            for scene_number in update.evidence_scene_numbers:
                scene = scenes_by_number[scene_number]
                evidence_text = " ".join(
                    [
                        *scene.character_actions,
                        *(
                            value
                            for dialogue in scene.dialogues
                            for value in (dialogue.character_name, dialogue.text)
                        ),
                    ]
                ).casefold()
                if source_name not in evidence_text or target_name not in evidence_text:
                    raise ValueError(
                        "Relationship evidence scenes must visibly involve both characters."
                    )
        state_updates_by_name = {
            update.character_name.strip().casefold(): update
            for update in self.character_state_updates
        }
        for update in self.continuity_state_updates:
            if update.entity_type == "character" and update.transition == "died":
                character_state = state_updates_by_name.get(update.entity_name.strip().casefold())
                if character_state is None or character_state.life_status != "dead":
                    raise ValueError(
                        "A character death transition requires a matching dead life_status."
                    )
        return self


class MasterScriptFinalizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    script_generation_draft_run: "ScriptGenerationDraftRun"
    script_revision_run: "ScriptRevisionRun"
    # None means "inherit from the revised draft" for legacy clients. New
    # clients may send it explicitly and are checked for consistency below.
    ending_mode: EndingMode | None = None
    dialogue_line_count_per_scene: int = Field(ge=1, le=6)
    speaker_name_cycle: list[str] = Field(min_length=1, max_length=6)
    minimum_re_qc_score_override: float | None = Field(default=None, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def inherit_and_validate_ending_mode(self) -> "MasterScriptFinalizeRequest":
        revised_mode = self.script_revision_run.revised_draft_master_script.ending_mode
        if self.ending_mode is None:
            self.ending_mode = revised_mode
        elif self.ending_mode != revised_mode:
            raise ValueError("Finalize ending_mode must match the revised draft.")
        return self

    @field_validator("speaker_name_cycle")
    @classmethod
    def ensure_unique_speaker_names(cls, speaker_names: list[str]) -> list[str]:
        normalized = [speaker_name.strip().lower() for speaker_name in speaker_names]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Speaker names must be unique.")
        return speaker_names


class MasterScriptFinalizationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    master_script: MasterScript
    source_draft_id: str = Field(min_length=3, max_length=120)
    mapping_notes: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("mapping_notes")
    @classmethod
    def ensure_unique_mapping_notes(cls, notes: list[str]) -> list[str]:
        normalized = [note.strip().lower() for note in notes]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Mapping notes must be unique.")
        return notes


class MasterScriptFinalizationResponse(BaseModel):
    data: MasterScriptFinalizationResult


class ErrorResponse(BaseModel):
    detail: str


from app.modules.script_engine.models import (
    ScriptGenerationDraftRun as _ScriptGenerationDraftRun,
    ScriptRevisionRun as _ScriptRevisionRun,
)

MasterScriptFinalizeRequest.model_rebuild(
    _types_namespace={
        "ScriptGenerationDraftRun": _ScriptGenerationDraftRun,
        "ScriptRevisionRun": _ScriptRevisionRun,
    }
)
MasterScript.model_rebuild()
