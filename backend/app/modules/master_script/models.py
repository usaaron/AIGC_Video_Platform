from __future__ import annotations

from datetime import datetime, timezone
from difflib import SequenceMatcher
from enum import Enum
import re
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

if TYPE_CHECKING:
    from app.modules.script_engine.models import ScriptGenerationDraftRun, ScriptRevisionRun


_EPISODE_TITLE_PREFIX = re.compile(
    r"^\s*(?:第\s*(?:\d+|[零〇一二三四五六七八九十百千万两]+)\s*集|(?:episode|ep\.?)\s*\d+)"
    r"\s*(?:[:：\-—–、.．]\s*)?",
    re.IGNORECASE,
)


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
    intent: str = Field(min_length=3, max_length=120)
    text: str = Field(min_length=3, max_length=280)


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


class SceneCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=50)
    slug: str = Field(min_length=3, max_length=120)
    purpose: str = Field(min_length=5, max_length=240)
    setting: str = Field(min_length=3, max_length=120)
    beat_summary: str = Field(min_length=5, max_length=300)
    emotional_shift: str = Field(min_length=3, max_length=120)
    emotional_objective: str | None = Field(default=None, min_length=3, max_length=160)
    character_actions: list[str] = Field(default_factory=list, max_length=24)
    turning_point: str | None = Field(default=None, min_length=3, max_length=240)
    scene_causality: SceneCausality | None = None
    cliffhanger: bool = False
    dialogues: list[DialogueLine] = Field(min_length=1, max_length=20)


class DraftSceneCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=50)
    slug: str = Field(min_length=3, max_length=120)
    purpose: str = Field(min_length=5, max_length=240)
    setting_hint: str = Field(min_length=3, max_length=120)
    beat_summary: str = Field(min_length=5, max_length=300)
    emotional_shift: str = Field(min_length=3, max_length=120)
    emotional_objective: str | None = Field(default=None, min_length=3, max_length=160)
    character_actions: list[str] = Field(default_factory=list, max_length=24)
    turning_point: str | None = Field(default=None, min_length=3, max_length=240)
    scene_causality: SceneCausality | None = None
    cliffhanger: bool = False
    dialogue_prompts: list[str] = Field(default_factory=list, max_length=10)
    dialogues: list[DialogueLine] = Field(default_factory=list, max_length=20)
    supporting_asset_ids: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("dialogue_prompts", "supporting_asset_ids", "character_actions")
    @classmethod
    def ensure_unique_string_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


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
    episode_goal: str = Field(min_length=5, max_length=240)
    target_duration_seconds: int = Field(ge=5, le=600)
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
    def ensure_final_scene_has_cliffhanger(self) -> "MasterScriptBase":
        if not self.scenes[-1].cliffhanger:
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
    episode_goal: str = Field(min_length=5, max_length=240)
    target_duration_seconds: int = Field(ge=5, le=600)
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
    def ensure_final_draft_scene_has_cliffhanger(self) -> "DraftMasterScriptBase":
        if not self.scenes[-1].cliffhanger:
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
    purpose: str = Field(min_length=5, max_length=240)
    setting: str = Field(min_length=3, max_length=120)
    beat_summary: str = Field(min_length=5, max_length=300)
    emotional_shift: str = Field(min_length=3, max_length=120)
    emotional_objective: str = Field(min_length=3, max_length=160)
    character_actions: list[str] = Field(min_length=1, max_length=24)
    turning_point: str = Field(min_length=3, max_length=240)
    scene_causality: SceneCausality
    cliffhanger: bool = False
    dialogues: list[DialogueLine] = Field(min_length=1, max_length=20)


class LLMGeneratedSceneBodyPatch(BaseModel):
    """Focused body replacement used without regenerating episode metadata."""

    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=50)
    character_actions: list[str] = Field(min_length=1, max_length=24)
    dialogues: list[DialogueLine] = Field(min_length=1, max_length=20)


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
    target_audience: str = Field(min_length=3, max_length=200)
    target_platform: str = Field(min_length=2, max_length=80)
    language: str = Field(min_length=2, max_length=20)
    tone: ScriptTone
    episode_goal: str = Field(min_length=5, max_length=240)
    target_duration_seconds: int = Field(ge=5, le=600)
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
    next_episode_question: str = Field(min_length=5, max_length=240)

    @field_validator("title", mode="before")
    @classmethod
    def remove_episode_number_from_title(cls, value: Any) -> Any:
        return normalize_generated_episode_title(value) if isinstance(value, str) else value

    @model_validator(mode="after")
    def ensure_scene_causal_chain(self) -> "LLMGeneratedDraftMasterScript":
        _validate_scene_causal_chain(self.scenes, require_contract=True)
        if not self.scenes[-1].cliffhanger:
            raise ValueError("The final generated scene must deliver the cliffhanger or payoff.")
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
    dialogue_line_count_per_scene: int = Field(ge=1, le=6)
    speaker_name_cycle: list[str] = Field(min_length=1, max_length=6)
    minimum_re_qc_score_override: float | None = Field(default=None, ge=0.0, le=1.0)

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


from app.modules.script_engine.models import ScriptGenerationDraftRun, ScriptRevisionRun

MasterScriptFinalizeRequest.model_rebuild(
    _types_namespace={
        "ScriptGenerationDraftRun": ScriptGenerationDraftRun,
        "ScriptRevisionRun": ScriptRevisionRun,
    }
)
MasterScript.model_rebuild()
