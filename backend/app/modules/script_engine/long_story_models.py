from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.script_delivery_contract import (
    EPISODE_DIALOGUE_LINE_MAX,
    EPISODE_DIALOGUE_LINE_MIN,
    EPISODE_RUNTIME_MAX_SECONDS,
    EPISODE_RUNTIME_MIN_SECONDS,
    EPISODE_SCENE_MAX,
    EPISODE_SCENE_MIN,
    EPISODE_SHOT_UNIT_MAX,
    EPISODE_SHOT_UNIT_MIN,
    normalize_episode_dialogue_plan_payload,
)
from app.modules.script_engine.episode_layer_contracts import EpisodeThreeLayerContract
from app.modules.content_spec.market_profile import canonical_market_profile


IDENTIFIER_PATTERN = r"^[a-zA-Z0-9_.:-]+$"
MAX_WORKSPACE_PAYLOAD_BYTES = 50_000_000
MIN_EPISODE_READY_SPAN = 8
MAX_EPISODE_READY_SPAN = 12


class StoryProjectStatus(str, Enum):
    planning = "planning"
    generating = "generating"
    review = "review"
    completed = "completed"
    archived = "archived"


class PlanningApprovalStatus(str, Enum):
    draft = "draft"
    approved = "approved"
    superseded = "superseded"


class PlanningRevisionMode(str, Enum):
    targeted = "targeted"
    rewrite = "rewrite"


class StoryPlanExpansionStatus(str, Enum):
    """Lifecycle of one recursively decomposable narrative segment."""

    unexpanded = "unexpanded"
    expanded = "expanded"
    episode_ready = "episode_ready"


class StoryPlanQualityStatus(str, Enum):
    pass_ = "pass"
    needs_revision = "needs_revision"


class StoryLineType(str, Enum):
    main = "main"
    subplot = "subplot"
    character_arc = "character_arc"


class StoryLineStatus(str, Enum):
    setup = "setup"
    active = "active"
    resolved = "resolved"
    abandoned = "abandoned"


class SetupPayoffStatus(str, Enum):
    planned = "planned"
    setup = "setup"
    paid_off = "paid_off"
    dropped = "dropped"


class ContinuityFactSource(str, Enum):
    user_provided = "user_provided"
    generated = "generated"
    system_derived = "system_derived"


class GenerationBatchStatus(str, Enum):
    planned = "planned"
    running = "running"
    paused = "paused"
    completed = "completed"
    partial = "partial"
    failed = "failed"


class GenerationJobStatus(str, Enum):
    queued = "queued"
    running = "running"
    paused = "paused"
    completed = "completed"
    partial = "partial"
    failed = "failed"


class EpisodeArtifactKind(str, Enum):
    draft = "draft"
    revised = "revised"
    final = "final"


class MemoryLayer(str, Enum):
    """Authority boundary for narrative data flowing through the system."""

    canonical = "canonical"
    derived = "derived"
    provisional = "provisional"


class CreativeDecisionStatus(str, Enum):
    """Author-facing lifecycle of one story-content decision."""

    current_direction = "current_direction"
    confirmed = "confirmed"
    proposed = "proposed"
    unresolved = "unresolved"
    delegated = "delegated"
    conflicted = "conflicted"


class CreativeDecisionSource(str, Enum):
    """Origin of a decision without changing its authority."""

    user_input = "user_input"
    uploaded_reference = "uploaded_reference"
    grill_answer = "grill_answer"
    ai_proposal = "ai_proposal"
    system_derived = "system_derived"
    legacy = "legacy"


class CreativeDecisionOwner(str, Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class CreativeAIPermission(str, Enum):
    """Maximum content authority explicitly granted to AI for one decision."""

    none = "none"
    suggest_only = "suggest_only"
    decide = "decide"


class CreativeDecisionRecord(BaseModel):
    """Invisible provenance for a story decision; UI may render a simpler summary."""

    model_config = ConfigDict(extra="forbid")

    decision_key: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    title: str = Field(min_length=2, max_length=80)
    value: str | None = Field(default=None, max_length=2_000)
    authority: MemoryLayer = MemoryLayer.provisional
    status: CreativeDecisionStatus = CreativeDecisionStatus.current_direction
    source: CreativeDecisionSource = CreativeDecisionSource.user_input
    owner: CreativeDecisionOwner = CreativeDecisionOwner.user
    ai_permission: CreativeAIPermission = CreativeAIPermission.suggest_only
    locked: bool = False
    required_before_stage: Literal[
        "story_bible",
        "story_tree",
        "episode_roadmap",
        "script",
        "final_arc",
    ] | None = None
    required_before_episode: int | None = Field(default=None, ge=1, le=2_000)


class StorylineDutyRole(str, Enum):
    """Narrative role used when allocating limited episode scene time."""

    main = "main"
    subplot = "subplot"
    character_arc = "character_arc"


class StorylineDuty(BaseModel):
    """A bounded, evidence-backed resource contract for one story line."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    story_line_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    role: StorylineDutyRole
    must_progress: bool = False
    objective: str = Field(min_length=3, max_length=800)
    required_progress: str = Field(min_length=3, max_length=800)
    assigned_scene_numbers: list[int] = Field(default_factory=list, max_length=20)
    can_defer: bool = True
    defer_until_episode: int | None = Field(default=None, ge=1, le=2_000)
    defer_reason: str | None = Field(default=None, min_length=3, max_length=500)
    last_progressed_episode: int = Field(default=0, ge=0, le=2_000)
    silence_episodes: int = Field(default=0, ge=0, le=2_000)
    next_required_step: str | None = Field(default=None, min_length=3, max_length=500)

    @field_validator("assigned_scene_numbers")
    @classmethod
    def ensure_unique_duty_scenes(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("Storyline duty scene numbers must be unique.")
        if any(value < 1 or value > 50 for value in values):
            raise ValueError("Storyline duty scene numbers must be within the episode.")
        return values

    @model_validator(mode="after")
    def validate_duty_deferral(self) -> "StorylineDuty":
        if self.must_progress and not self.assigned_scene_numbers:
            raise ValueError("A mandatory storyline duty requires assigned scenes.")
        if not self.must_progress:
            if not self.can_defer:
                raise ValueError("A deferred storyline duty must allow deferral.")
            if self.defer_until_episode is None or self.defer_reason is None:
                raise ValueError(
                    "A deferred storyline duty requires a target episode and reason."
                )
        if self.defer_until_episode is not None and self.defer_reason is None:
            raise ValueError("A deferral target requires a deferral reason.")
        return self


class NarrativeEventSetStatus(str, Enum):
    validated = "validated"
    rejected = "rejected"


class NarrativeEventType(str, Enum):
    episode_summary = "episode_summary"
    character_state_changed = "character_state_changed"
    relationship_state_changed = "relationship_state_changed"
    world_state_changed = "world_state_changed"
    story_line_progressed = "story_line_progressed"
    setup_payoff_updated = "setup_payoff_updated"
    hook_emitted = "hook_emitted"


class StoryProject(BaseModel):
    """Versioned aggregate contract for one serialized story project."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    revision: int = Field(default=1, ge=1)
    title: str = Field(min_length=2, max_length=160)
    content_spec_id: str | None = Field(default=None, min_length=3, max_length=120)
    output_language: str = Field(default="zh", min_length=2, max_length=20)
    target_total_characters: int = Field(
        default=450_000,
        ge=1_000,
        le=2_000_000,
        description=(
            "Target effective characters in generated episode action and dialogue "
            "only; planning artifacts never contribute to completion."
        ),
    )
    planned_episode_count: int = Field(ge=1, le=2_000)
    default_batch_size: int = Field(default=10, ge=1, le=20)
    status: StoryProjectStatus = StoryProjectStatus.planning
    active_story_bible_id: str | None = Field(
        default=None,
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    active_story_bible_version: int | None = Field(default=None, ge=1)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def validate_project_bounds(self) -> "StoryProject":
        if self.default_batch_size > self.planned_episode_count:
            raise ValueError("default_batch_size must not exceed planned_episode_count.")
        if self.updated_at < self.created_at:
            raise ValueError("updated_at must not be earlier than created_at.")
        if (self.active_story_bible_id is None) != (
            self.active_story_bible_version is None
        ):
            raise ValueError(
                "active_story_bible_id and active_story_bible_version must be set together."
            )
        return self


class CharacterArcTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_ref: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    external_goal: str = Field(min_length=3, max_length=500)
    internal_need: str | None = Field(default=None, min_length=3, max_length=500)
    starting_state: str = Field(min_length=3, max_length=500)
    target_state: str = Field(min_length=3, max_length=500)
    key_turning_points: list[str] = Field(default_factory=list, max_length=12)
    protected_traits: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("key_turning_points", "protected_traits")
    @classmethod
    def ensure_unique_arc_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Character arc values must be unique.")
        return values


class StoryBibleCharacterRegistryEntry(BaseModel):
    """Canonical identity used to keep narrative references stable."""

    model_config = ConfigDict(extra="forbid")

    character_ref: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    name: str = Field(min_length=2, max_length=80)
    role: str = Field(default="supporting", min_length=2, max_length=80)


class StoryBibleRelationship(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relationship_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    source_character_ref: str = Field(
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    target_character_ref: str = Field(
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    relationship_type: str = Field(min_length=2, max_length=120)
    initial_state: str = Field(min_length=3, max_length=500)
    target_direction: str = Field(min_length=3, max_length=500)
    locked: bool = False

    @model_validator(mode="after")
    def prevent_self_relationship(self) -> "StoryBibleRelationship":
        if self.source_character_ref.casefold() == self.target_character_ref.casefold():
            raise ValueError("A relationship must reference two different characters.")
        return self


class StoryLinePlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    story_line_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    title: str = Field(min_length=2, max_length=160)
    story_line_type: StoryLineType
    premise: str = Field(min_length=5, max_length=800)
    planned_resolution: str = Field(min_length=5, max_length=800)
    character_refs: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("character_refs")
    @classmethod
    def ensure_unique_story_line_characters(cls, values: list[str]) -> list[str]:
        normalized = [value.casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Story line character references must be unique.")
        return values


class ShortDramaEscalationStage(BaseModel):
    """One reviewable short-drama reward-and-escalation stage."""

    model_config = ConfigDict(extra="forbid")

    stage_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    title: str = Field(min_length=2, max_length=160)
    stage_goal: str = Field(min_length=5, max_length=800)
    stage_opposition: str = Field(min_length=5, max_length=800)
    stage_payoff: str = Field(min_length=5, max_length=800)
    escalation_to_next: str = Field(min_length=5, max_length=800)


class StoryBible(BaseModel):
    """Human-reviewable source of truth for long-story generation."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    story_bible_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    content_spec_id: str = Field(min_length=3, max_length=120)
    market_profile: str = Field(
        default="cn_mainland",
        min_length=3,
        max_length=40,
        exclude=True,
    )
    version: int = Field(default=1, ge=1)
    status: PlanningApprovalStatus = PlanningApprovalStatus.draft
    project_title: str | None = Field(default=None, min_length=2, max_length=40)
    core_premise: str = Field(min_length=10, max_length=1_200)
    series_goal: str = Field(min_length=10, max_length=1_200)
    theme: str = Field(min_length=2, max_length=300)
    central_conflict: str = Field(min_length=10, max_length=1_200)
    ending_direction: str = Field(min_length=10, max_length=1_200)
    world_rules: list[str] = Field(default_factory=list, max_length=30)
    character_refs: list[str] = Field(min_length=1, max_length=50)
    character_registry: list[StoryBibleCharacterRegistryEntry] = Field(
        default_factory=list,
        max_length=50,
    )
    character_arc_targets: list[CharacterArcTarget] = Field(default_factory=list, max_length=50)
    relationships: list[StoryBibleRelationship] = Field(default_factory=list, max_length=100)
    story_lines: list[StoryLinePlan] = Field(min_length=1, max_length=50)
    escalation_stages: list[ShortDramaEscalationStage] = Field(
        default_factory=list,
        max_length=20,
    )
    major_setup_payoff_refs: list[str] = Field(default_factory=list, max_length=100)
    locked_facts: list[str] = Field(default_factory=list, max_length=100)
    avoid_patterns: list[str] = Field(default_factory=list, max_length=50)
    creative_decisions: list[CreativeDecisionRecord] = Field(
        default_factory=list,
        max_length=80,
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    approved_at: datetime | None = None

    @field_validator(
        "world_rules",
        "character_refs",
        "major_setup_payoff_refs",
        "locked_facts",
        "avoid_patterns",
    )
    @classmethod
    def ensure_unique_story_bible_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Story Bible list values must be unique.")
        return values

    @model_validator(mode="after")
    def validate_story_bible_references(self) -> "StoryBible":
        self.market_profile = canonical_market_profile(self.market_profile)
        character_refs = {value.casefold() for value in self.character_refs}
        if self.character_registry:
            registry_refs = {
                item.character_ref.casefold() for item in self.character_registry
            }
            if registry_refs != character_refs:
                raise ValueError(
                    "Character registry must match Story Bible character references."
                )
        arc_refs = [item.character_ref.casefold() for item in self.character_arc_targets]
        if len(set(arc_refs)) != len(arc_refs):
            raise ValueError("Character arc targets must reference unique characters.")
        if not set(arc_refs).issubset(character_refs):
            raise ValueError("Character arc targets must reference Story Bible characters.")

        relationship_ids = [item.relationship_id.casefold() for item in self.relationships]
        if len(set(relationship_ids)) != len(relationship_ids):
            raise ValueError("Story Bible relationship IDs must be unique.")
        for relationship in self.relationships:
            refs = {
                relationship.source_character_ref.casefold(),
                relationship.target_character_ref.casefold(),
            }
            if not refs.issubset(character_refs):
                raise ValueError("Relationships must reference Story Bible characters.")

        story_line_ids = [item.story_line_id.casefold() for item in self.story_lines]
        if len(set(story_line_ids)) != len(story_line_ids):
            raise ValueError("Story line IDs must be unique.")
        for story_line in self.story_lines:
            if not {value.casefold() for value in story_line.character_refs}.issubset(
                character_refs
            ):
                raise ValueError("Story lines must reference Story Bible characters.")

        escalation_ids = [item.stage_id.casefold() for item in self.escalation_stages]
        if len(set(escalation_ids)) != len(escalation_ids):
            raise ValueError("Short-drama escalation stage IDs must be unique.")
        escalation_titles = [item.title.strip().casefold() for item in self.escalation_stages]
        if len(set(escalation_titles)) != len(escalation_titles):
            raise ValueError("Short-drama escalation stage titles must be unique.")

        if self.status == PlanningApprovalStatus.approved and self.approved_at is None:
            raise ValueError("Approved Story Bible requires approved_at.")
        if self.status != PlanningApprovalStatus.approved and self.approved_at is not None:
            raise ValueError("approved_at is only valid for an approved Story Bible.")
        return self


class StoryBibleCharacterInput(BaseModel):
    """Authoring context supplied when drafting a Story Bible."""

    model_config = ConfigDict(extra="forbid")

    character_ref: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    name: str = Field(min_length=2, max_length=80)
    role: str = Field(default="supporting", min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)


class CreativeDirectionCandidate(BaseModel):
    """A short selectable direction that refines, but cannot replace, user input."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=2, max_length=40)
    style_description: str = Field(min_length=4, max_length=120)
    content_description: str = Field(min_length=4, max_length=180)
    dramatic_goal: str = Field(default="", max_length=180)
    character_changes: list[str] = Field(default_factory=list, max_length=8)
    reveals_or_withholds: list[str] = Field(default_factory=list, max_length=8)
    story_line_effects: list[str] = Field(default_factory=list, max_length=8)
    tradeoffs: list[str] = Field(default_factory=list, max_length=8)
    next_pressure: str = Field(default="", max_length=180)


class ReferenceMaterialPurpose(str, Enum):
    format_template = "format_template"
    story_reference = "story_reference"
    world_setting = "world_setting"
    character_reference = "character_reference"
    style_reference = "style_reference"
    other = "other"


class CreativeReferenceMaterial(BaseModel):
    """User-supplied text extracted locally from one authoring reference file."""

    model_config = ConfigDict(extra="forbid")

    file_name: str = Field(min_length=1, max_length=240)
    purpose: ReferenceMaterialPurpose
    purpose_note: str = Field(default="", max_length=160)
    extracted_text: str = Field(min_length=1, max_length=30_000)


def _ensure_reference_material_budget(
    materials: list[CreativeReferenceMaterial],
) -> None:
    if sum(len(item.extracted_text) for item in materials) > 120_000:
        raise ValueError(
            "Combined reference material text must not exceed 120000 characters."
        )


class CreativeDirectionDraftRequest(BaseModel):
    """Generate several concise directions before Story Bible generation."""

    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    content_spec_id: str | None = Field(default=None, min_length=3, max_length=120)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    creative_prompt: str = Field(default="", max_length=2_000)
    reference_materials: list[CreativeReferenceMaterial] = Field(
        default_factory=list,
        max_length=8,
    )
    selected_tag_labels: list[str] = Field(default_factory=list, max_length=20)
    characters: list[StoryBibleCharacterInput] = Field(default_factory=list, max_length=20)
    option_count: int = Field(default=4, ge=3, le=5)

    @field_validator("selected_tag_labels")
    @classmethod
    def ensure_unique_direction_tag_labels(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("selected_tag_labels must be unique.")
        return [value.strip() for value in values if value.strip()]

    @model_validator(mode="after")
    def ensure_direction_reference_budget(self) -> "CreativeDirectionDraftRequest":
        _ensure_reference_material_budget(self.reference_materials)
        return self


class CreativeDirectionGenerationOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    directions: list[CreativeDirectionCandidate] = Field(min_length=3, max_length=5)


class CreativeDirectionDraftResponse(BaseModel):
    data: CreativeDirectionGenerationOutput


class StoryBibleDraftRequest(BaseModel):
    """Input for the first, human-reviewable long-story planning slice."""

    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    content_spec_id: str | None = Field(default=None, min_length=3, max_length=120)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    creative_prompt: str = Field(default="", max_length=2_000)
    reference_materials: list[CreativeReferenceMaterial] = Field(
        default_factory=list,
        max_length=8,
    )
    selected_tag_labels: list[str] = Field(default_factory=list, max_length=20)
    selected_creative_direction: CreativeDirectionCandidate | None = None
    author_instruction: str = Field(
        default="",
        max_length=7_500,
        description=(
            "Optional human control for this planning turn. It may select, combine, "
            "or override generated directions without replacing hard project constraints."
        ),
    )
    characters: list[StoryBibleCharacterInput] = Field(default_factory=list, max_length=20)
    target_episode_count: int = Field(default=300, ge=1, le=2_000)

    @field_validator("selected_tag_labels")
    @classmethod
    def ensure_unique_tag_labels(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("selected_tag_labels must be unique.")
        return [value.strip() for value in values if value.strip()]

    @model_validator(mode="after")
    def ensure_story_bible_reference_budget(self) -> "StoryBibleDraftRequest":
        _ensure_reference_material_budget(self.reference_materials)
        return self


class StoryBibleSelectionContext(BaseModel):
    """The document selection that anchors a targeted planning revision."""

    model_config = ConfigDict(extra="forbid")

    source_field: str = Field(min_length=1, max_length=160)
    selected_text: str = Field(min_length=1, max_length=4_000)
    before_text: str = Field(default="", max_length=1_000)
    after_text: str = Field(default="", max_length=1_000)


class StoryBibleModificationRequest(BaseModel):
    """Generate a reviewable AI revision candidate without persisting it."""

    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_version: int = Field(ge=1)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    revision_mode: PlanningRevisionMode = PlanningRevisionMode.targeted
    instruction: str = Field(default="", max_length=1_000)
    selection_context: StoryBibleSelectionContext | None = None

    @model_validator(mode="after")
    def require_targeted_revision_instruction(self) -> "StoryBibleModificationRequest":
        if (
            self.revision_mode == PlanningRevisionMode.targeted
            and len(self.instruction.strip()) < 2
        ):
            raise ValueError("A targeted Story Bible revision requires an instruction.")
        return self


class StoryBibleGenerationOutput(BaseModel):
    """LLM output without persistence identity or approval lifecycle fields."""

    model_config = ConfigDict(extra="forbid")

    project_title: str | None = Field(default=None, min_length=2, max_length=40)
    core_premise: str = Field(min_length=10, max_length=1_200)
    series_goal: str = Field(min_length=10, max_length=1_200)
    theme: str = Field(min_length=2, max_length=300)
    central_conflict: str = Field(min_length=10, max_length=1_200)
    ending_direction: str = Field(min_length=10, max_length=1_200)
    world_rules: list[str] = Field(default_factory=list, max_length=30)
    character_refs: list[str] = Field(min_length=1, max_length=50)
    character_registry: list[StoryBibleCharacterRegistryEntry] = Field(
        default_factory=list,
        max_length=50,
    )
    character_arc_targets: list[CharacterArcTarget] = Field(default_factory=list, max_length=50)
    relationships: list[StoryBibleRelationship] = Field(default_factory=list, max_length=100)
    story_lines: list[StoryLinePlan] = Field(min_length=1, max_length=50)
    escalation_stages: list[ShortDramaEscalationStage] = Field(
        default_factory=list,
        max_length=20,
    )
    major_setup_payoff_refs: list[str] = Field(default_factory=list, max_length=100)
    locked_facts: list[str] = Field(default_factory=list, max_length=100)
    avoid_patterns: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_story_bible_references(self) -> "StoryBibleGenerationOutput":
        """Reject cross-reference drift before the output reaches persistence."""
        character_refs = {value.casefold() for value in self.character_refs}
        if self.character_registry:
            registry_refs = {
                item.character_ref.casefold() for item in self.character_registry
            }
            if registry_refs != character_refs:
                raise ValueError(
                    "Character registry must match Story Bible character references."
                )
        arc_refs = {item.character_ref.casefold() for item in self.character_arc_targets}
        if not arc_refs.issubset(character_refs):
            raise ValueError("Character arc targets must reference Story Bible characters.")
        for relationship in self.relationships:
            relationship_refs = {
                relationship.source_character_ref.casefold(),
                relationship.target_character_ref.casefold(),
            }
            if not relationship_refs.issubset(character_refs):
                raise ValueError(
                    "Relationships must reference Story Bible characters."
                )
        for story_line in self.story_lines:
            if not {
                value.casefold() for value in story_line.character_refs
            }.issubset(character_refs):
                raise ValueError(
                    "Story lines must reference Story Bible characters."
                )
        return self


class StoryBibleInteractiveStep(str, Enum):
    premise = "premise"
    goal = "goal"
    conflict = "conflict"
    ending = "ending"
    world = "world"
    characters = "characters"
    arcs = "arcs"
    story_lines = "story_lines"
    escalation = "escalation"
    safeguards = "safeguards"


class StoryBibleInteractiveCandidate(BaseModel):
    """One small, reviewable proposal inside the Story Bible conversation."""

    model_config = ConfigDict(extra="forbid")

    candidate_id: str = Field(min_length=2, max_length=80, pattern=IDENTIFIER_PATTERN)
    title: str = Field(min_length=2, max_length=100)
    summary: str = Field(min_length=5, max_length=800)
    fields: dict[str, Any] = Field(default_factory=dict)


class StoryBibleInteractiveStepRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    content_spec_id: str | None = Field(default=None, min_length=3, max_length=120)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    creative_prompt: str = Field(default="", max_length=2_000)
    reference_materials: list[CreativeReferenceMaterial] = Field(default_factory=list, max_length=8)
    selected_tag_labels: list[str] = Field(default_factory=list, max_length=20)
    selected_creative_direction: CreativeDirectionCandidate | None = None
    step: StoryBibleInteractiveStep
    previous_sections: dict[str, Any] = Field(default_factory=dict)
    author_instruction: str = Field(default="", max_length=2_000)
    target_episode_count: int = Field(default=300, ge=1, le=2_000)


class StoryBibleInteractiveStepOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: StoryBibleInteractiveStep
    question: str = Field(min_length=5, max_length=300)
    candidates: list[StoryBibleInteractiveCandidate] = Field(min_length=4, max_length=4)


class StoryBibleInteractiveStepResponse(BaseModel):
    data: StoryBibleInteractiveStepOutput


class StoryInspirationBrief(BaseModel):
    """Compact author intent accumulated by the optional inspiration chat."""

    model_config = ConfigDict(extra="forbid")

    story_promise: str = Field(default="", max_length=500)
    protagonist_and_goal: str = Field(default="", max_length=500)
    core_obstacle: str = Field(default="", max_length=500)
    stakes: str = Field(default="", max_length=500)
    relationship_direction: str = Field(default="", max_length=500)
    reveal_or_twist: str = Field(default="", max_length=500)
    ending_direction: str = Field(default="", max_length=500)
    tone_and_pacing: str = Field(default="", max_length=500)
    must_keep: list[str] = Field(default_factory=list, max_length=12)
    must_avoid: list[str] = Field(default_factory=list, max_length=12)
    unresolved: list[str] = Field(default_factory=list, max_length=12)
    additional_notes: list[str] = Field(default_factory=list, max_length=20)
    creative_decisions: list[CreativeDecisionRecord] = Field(
        default_factory=list,
        max_length=80,
    )


class StoryInspirationBriefPatch(BaseModel):
    """Only the intent fields changed by one inspiration-chat turn."""

    model_config = ConfigDict(extra="forbid")

    story_promise: str | None = Field(default=None, max_length=500)
    protagonist_and_goal: str | None = Field(default=None, max_length=500)
    core_obstacle: str | None = Field(default=None, max_length=500)
    stakes: str | None = Field(default=None, max_length=500)
    relationship_direction: str | None = Field(default=None, max_length=500)
    reveal_or_twist: str | None = Field(default=None, max_length=500)
    ending_direction: str | None = Field(default=None, max_length=500)
    tone_and_pacing: str | None = Field(default=None, max_length=500)
    must_keep: list[str] | None = Field(default=None, max_length=12)
    must_avoid: list[str] | None = Field(default=None, max_length=12)
    unresolved: list[str] | None = Field(default=None, max_length=12)
    additional_notes: list[str] | None = Field(default=None, max_length=20)


class StoryInspirationFrontierQuestion(BaseModel):
    """One decision on the currently answerable frontier of the story tree."""

    model_config = ConfigDict(extra="forbid")

    question_id: str = Field(min_length=2, max_length=12, pattern=r"^Q[1-9][0-9]?$")
    decision_key: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    title: str = Field(min_length=2, max_length=80)
    question: str = Field(min_length=12, max_length=1_200)
    choices: list[Annotated[str, Field(min_length=2, max_length=300)]] = Field(
        default_factory=list,
        max_length=4,
    )
    recommended_choice: str | None = Field(default=None, min_length=2, max_length=300)
    recommended_answer: str | None = Field(default=None, min_length=8, max_length=400)

    @model_validator(mode="after")
    def ensure_actionable_question(self) -> "StoryInspirationFrontierQuestion":
        if not self.question.rstrip().endswith(("？", "?")):
            raise ValueError("frontier question must end with a question mark")
        normalized_choices = [choice.casefold().strip() for choice in self.choices]
        if len(normalized_choices) != len(set(normalized_choices)):
            raise ValueError("frontier choices must be distinct")
        if self.recommended_choice is not None and self.recommended_choice not in self.choices:
            raise ValueError("frontier recommended_choice must exactly match one choice")
        if self.recommended_answer is not None:
            recommendation = re.sub(r"[\s，。,.；;：:]", "", self.recommended_answer.casefold())
            if recommendation in {"由你决定", "都可以", "任选", "看你", "没有建议"}:
                raise ValueError("frontier recommendation must make a defensible choice")
        return self


class StoryInspirationTurnModelOutput(BaseModel):
    """Compact provider contract; the service expands it for the public API."""

    model_config = ConfigDict(extra="forbid")

    assistant_message: str = Field(min_length=2, max_length=1_600)
    questions: list[StoryInspirationFrontierQuestion] = Field(default_factory=list, max_length=4)
    brief_patch: StoryInspirationBriefPatch = Field(default_factory=StoryInspirationBriefPatch)
    ready_to_generate: bool = False


class StoryInspirationMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["assistant", "user"]
    content: str = Field(min_length=1, max_length=4_000)
    questions: list[StoryInspirationFrontierQuestion] = Field(default_factory=list, max_length=4)


class StoryInspirationChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    content_spec_id: str | None = Field(default=None, min_length=3, max_length=120)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    creative_prompt: str = Field(default="", max_length=2_000)
    reference_materials: list[CreativeReferenceMaterial] = Field(default_factory=list, max_length=8)
    selected_tag_labels: list[str] = Field(default_factory=list, max_length=20)
    messages: list[StoryInspirationMessage] = Field(default_factory=list, max_length=30)
    current_brief: StoryInspirationBrief = Field(default_factory=StoryInspirationBrief)
    user_message: str = Field(default="", max_length=2_000)
    target_episode_count: int = Field(default=300, ge=1, le=2_000)

    @model_validator(mode="after")
    def ensure_inspiration_reference_budget(self) -> "StoryInspirationChatRequest":
        _ensure_reference_material_budget(self.reference_materials)
        return self


class StoryInspirationChatOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assistant_message: str = Field(min_length=2, max_length=1_600)
    questions: list[StoryInspirationFrontierQuestion] = Field(default_factory=list, max_length=4)
    brief: StoryInspirationBrief
    ready_to_generate: bool = False

    @model_validator(mode="after")
    def ensure_actionable_next_step(self) -> "StoryInspirationChatOutput":
        if not self.ready_to_generate and not self.questions:
            raise ValueError(
                "an unfinished inspiration turn must include at least one question"
            )
        return self


class StoryInspirationChatResponse(BaseModel):
    data: StoryInspirationChatOutput


class StoryBibleInteractiveCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    content_spec_id: str = Field(min_length=3, max_length=120)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    creative_prompt: str = Field(default="", max_length=2_000)
    reference_materials: list[CreativeReferenceMaterial] = Field(default_factory=list, max_length=8)
    selected_tag_labels: list[str] = Field(default_factory=list, max_length=20)
    sections: dict[str, Any] = Field(min_length=1, max_length=20)


class StoryPlanNodeDraftRequest(BaseModel):
    """Input for generating one recursively expandable planning node."""

    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_version: int = Field(ge=1)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    parent_node_id: str | None = Field(default=None, min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    parent_node_version: int | None = Field(default=None, ge=1)
    predecessor_node_id: str | None = Field(default=None, min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    predecessor_node_version: int | None = Field(default=None, ge=1)
    sequence_order: int = Field(default=1, ge=1, le=10_000)
    target_episode_count: int = Field(default=300, ge=1, le=2_000)
    author_instruction: str = Field(
        default="",
        max_length=2_000,
        description="Optional human control for this story-tree generation turn.",
    )

    @model_validator(mode="after")
    def validate_node_context(self) -> "StoryPlanNodeDraftRequest":
        if (self.parent_node_id is None) != (self.parent_node_version is None):
            raise ValueError("parent_node_id and parent_node_version must be set together.")
        if (self.predecessor_node_id is None) != (self.predecessor_node_version is None):
            raise ValueError(
                "predecessor_node_id and predecessor_node_version must be set together."
            )
        if self.parent_node_id is None and self.predecessor_node_id is not None:
            raise ValueError("A root planning node cannot have a predecessor.")
        return self


class StoryPlanNodeGenerationOutput(BaseModel):
    """LLM output without node identity or approval lifecycle fields."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=2, max_length=160)
    narrative_purpose: str = Field(min_length=5, max_length=1_000)
    synopsis: str = Field(min_length=10, max_length=3_000)
    entry_state: str = Field(min_length=5, max_length=1_500)
    central_conflict: str = Field(min_length=5, max_length=1_500)
    turning_points: list[str] = Field(min_length=1, max_length=30)
    emotional_direction: str = Field(min_length=3, max_length=800)
    exit_state: str = Field(min_length=5, max_length=1_500)
    unit_story_beats: list[str] = Field(default_factory=list, max_length=12)
    unit_resolution: str | None = Field(default=None, min_length=5, max_length=1_500)
    handoff_pressure: str | None = Field(default=None, min_length=5, max_length=1_500)
    character_refs: list[str] = Field(default_factory=list, max_length=50)
    story_line_refs: list[str] = Field(default_factory=list, max_length=50)
    setup_refs: list[str] = Field(default_factory=list, max_length=100)
    payoff_refs: list[str] = Field(default_factory=list, max_length=100)
    estimated_episode_count: int | None = Field(default=None, ge=1, le=2_000)
    estimated_script_body_characters: int | None = Field(
        default=None,
        ge=300,
        le=2_000_000,
        description=(
            "Planning allocation for future episode body text; this node's own "
            "description is never counted as generated script body."
        ),
    )
    planned_start_episode: int | None = Field(default=None, ge=1, le=2_000)
    planned_end_episode: int | None = Field(default=None, ge=1, le=2_000)
    decomposition_reason: str | None = Field(default=None, min_length=5, max_length=1_000)

    @model_validator(mode="after")
    def validate_episode_range(self) -> "StoryPlanNodeGenerationOutput":
        if (self.planned_start_episode is None) != (self.planned_end_episode is None):
            raise ValueError(
                "planned_start_episode and planned_end_episode must be set together."
            )
        if (
            self.planned_start_episode is not None
            and self.planned_end_episode is not None
            and self.planned_end_episode < self.planned_start_episode
        ):
            raise ValueError("planned_end_episode must not be lower than planned_start_episode.")
        return self


class StoryPlanNodeDecompositionRequest(BaseModel):
    """Split one approved node until children can directly guide episode scripts."""

    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    parent_node_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    parent_node_version: int = Field(ge=1)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    requested_child_count: int | None = Field(
        default=None,
        ge=2,
        le=12,
        description=(
            "Optional creator override. When omitted, the model chooses 2-12 "
            "narratively distinct children according to the parent content."
        ),
    )
    max_episode_ready_span: int = Field(
        default=12,
        ge=1,
        le=20,
        description=(
            "Backward-compatible caller field. The planning service enforces the "
            "system episode-ready ceiling of 12 regardless of this value."
        ),
    )
    author_instruction: str = Field(
        default="",
        max_length=2_000,
        description="Optional human control for this branch decomposition turn.",
    )


class StoryPlanNodeChildOutput(StoryPlanNodeGenerationOutput):
    """One proposed child plus the model's bounded next-step recommendation."""

    unit_story_beats: list[str] = Field(
        min_length=4,
        max_length=12,
        examples=[["触发事件", "目标与行动", "升级与选择", "高潮、结算与状态变化"]],
    )
    unit_resolution: str = Field(
        min_length=5,
        max_length=1_500,
        examples=["本剧情单元完成可见的阶段结算。"],
    )
    handoff_pressure: str = Field(
        min_length=5,
        max_length=1_500,
        examples=["本单元结果引出下一单元必须承接的新压力。"],
    )
    estimated_episode_count: int | None = Field(default=None, ge=1, le=2_000, examples=[8])
    estimated_script_body_characters: int | None = Field(
        default=None,
        ge=300,
        le=2_000_000,
        examples=[500],
        description=(
            "Relative planning weight for future episode body text; the backend "
            "rescales sibling weights to the parent's final body-text budget."
        ),
    )
    planned_start_episode: int | None = Field(default=None, ge=1, le=2_000, examples=[1])
    planned_end_episode: int | None = Field(default=None, ge=1, le=2_000, examples=[8])
    decomposition_reason: str | None = Field(
        default=None,
        min_length=5,
        max_length=1_000,
        examples=["该单元拥有独立冲突、转折和阶段结算。"],
    )
    recommended_next_step: str = Field(
        pattern=r"^(expand|episode_ready)$",
        examples=["episode_ready"],
    )


class StoryPlanNodeDecompositionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    children: list[StoryPlanNodeChildOutput] = Field(min_length=2, max_length=12)


class StoryPlanNode(BaseModel):
    """One level-free node in a recursively decomposed long-story plan."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    node_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_version: int = Field(ge=1)
    version: int = Field(default=1, ge=1)
    parent_node_id: str | None = Field(
        default=None,
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    parent_node_version: int | None = Field(default=None, ge=1)
    predecessor_node_id: str | None = Field(
        default=None,
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    predecessor_node_version: int | None = Field(default=None, ge=1)
    sequence_order: int = Field(default=1, ge=1, le=10_000)
    title: str = Field(min_length=2, max_length=160)
    narrative_purpose: str = Field(min_length=5, max_length=1_000)
    synopsis: str = Field(min_length=10, max_length=3_000)
    entry_state: str = Field(min_length=5, max_length=1_500)
    central_conflict: str = Field(min_length=5, max_length=1_500)
    turning_points: list[str] = Field(min_length=1, max_length=30)
    emotional_direction: str = Field(min_length=3, max_length=800)
    exit_state: str = Field(min_length=5, max_length=1_500)
    unit_story_beats: list[str] = Field(default_factory=list, max_length=12)
    unit_resolution: str | None = Field(default=None, min_length=5, max_length=1_500)
    handoff_pressure: str | None = Field(default=None, min_length=5, max_length=1_500)
    character_refs: list[str] = Field(default_factory=list, max_length=50)
    story_line_refs: list[str] = Field(default_factory=list, max_length=50)
    setup_refs: list[str] = Field(default_factory=list, max_length=100)
    payoff_refs: list[str] = Field(default_factory=list, max_length=100)
    estimated_episode_count: int | None = Field(default=None, ge=1, le=2_000)
    estimated_script_body_characters: int | None = Field(
        default=None,
        ge=300,
        le=2_000_000,
        description=(
            "Planning allocation for future episode body text; this node's own "
            "description is never counted as generated script body."
        ),
    )
    planned_start_episode: int | None = Field(default=None, ge=1, le=2_000)
    planned_end_episode: int | None = Field(default=None, ge=1, le=2_000)
    expansion_status: StoryPlanExpansionStatus = StoryPlanExpansionStatus.unexpanded
    decomposition_reason: str | None = Field(default=None, min_length=5, max_length=1_000)
    status: PlanningApprovalStatus = PlanningApprovalStatus.draft
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    approved_at: datetime | None = None

    @field_validator(
        "turning_points",
        "unit_story_beats",
        "character_refs",
        "story_line_refs",
        "setup_refs",
        "payoff_refs",
    )
    @classmethod
    def ensure_unique_plan_node_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Story Plan Node list values must be unique.")
        return values

    @model_validator(mode="after")
    def validate_plan_node(self) -> "StoryPlanNode":
        if (self.parent_node_id is None) != (self.parent_node_version is None):
            raise ValueError("parent_node_id and parent_node_version must be set together.")
        if (self.predecessor_node_id is None) != (
            self.predecessor_node_version is None
        ):
            raise ValueError(
                "predecessor_node_id and predecessor_node_version must be set together."
            )
        if self.parent_node_id == self.node_id:
            raise ValueError("A Story Plan Node cannot be its own parent.")
        if self.predecessor_node_id == self.node_id:
            raise ValueError("A Story Plan Node cannot be its own predecessor.")
        if self.parent_node_id is None and self.predecessor_node_id is not None:
            raise ValueError("A root Story Plan Node cannot have a predecessor.")
        if (self.planned_start_episode is None) != (
            self.planned_end_episode is None
        ):
            raise ValueError(
                "planned_start_episode and planned_end_episode must be set together."
            )
        if (
            self.planned_start_episode is not None
            and self.planned_end_episode is not None
            and self.planned_end_episode < self.planned_start_episode
        ):
            raise ValueError(
                "planned_end_episode must not be lower than planned_start_episode."
            )
        if self.status == PlanningApprovalStatus.approved and self.approved_at is None:
            raise ValueError("Approved Story Plan Node requires approved_at.")
        if self.status != PlanningApprovalStatus.approved and self.approved_at is not None:
            raise ValueError("approved_at is only valid for an approved Story Plan Node.")
        return self


class StoryPlanNodeModificationRequest(BaseModel):
    """Generate a reviewable node revision while preserving its tree boundary."""

    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    node_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    node_version: int = Field(ge=1)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    revision_mode: PlanningRevisionMode = PlanningRevisionMode.targeted
    instruction: str = Field(default="", max_length=1_000)
    selection_context: StoryBibleSelectionContext | None = None

    @model_validator(mode="after")
    def require_targeted_revision_instruction(self) -> "StoryPlanNodeModificationRequest":
        if (
            self.revision_mode == PlanningRevisionMode.targeted
            and len(self.instruction.strip()) < 2
        ):
            raise ValueError("A targeted Story Plan Node revision requires an instruction.")
        return self


class StoryPlanQualityNodeRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    node_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    node_version: int = Field(ge=1)


class StoryPlanQualityAuditRequest(BaseModel):
    """Audit the active episode-ready leaf lineage without mutating the tree."""

    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_version: int = Field(ge=1)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    node_refs: list[StoryPlanQualityNodeRef] = Field(min_length=1, max_length=300)
    agent_request_id: str = Field(min_length=3, max_length=240, pattern=IDENTIFIER_PATTERN)

    @field_validator("node_refs")
    @classmethod
    def ensure_unique_quality_node_refs(
        cls,
        values: list[StoryPlanQualityNodeRef],
    ) -> list[StoryPlanQualityNodeRef]:
        identities = {(item.node_id, item.node_version) for item in values}
        if len(identities) != len(values):
            raise ValueError("Story Plan quality node refs must be unique.")
        return values


class StoryPlanQualityEvaluation(BaseModel):
    """Compact model verdict for one representative leaf."""

    model_config = ConfigDict(extra="forbid")

    node_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    node_version: int = Field(ge=1)
    status: StoryPlanQualityStatus
    summary: str = Field(min_length=2, max_length=500)
    issue_codes: list[str] = Field(default_factory=list, max_length=12)
    repair_instruction: str | None = Field(default=None, min_length=2, max_length=1_000)

    @model_validator(mode="after")
    def require_repair_for_revision(self) -> "StoryPlanQualityEvaluation":
        if self.status == StoryPlanQualityStatus.needs_revision:
            if not self.issue_codes or not self.repair_instruction:
                raise ValueError(
                    "A Story Plan quality revision requires issue codes and a repair instruction."
                )
        return self


class StoryPlanQualityModelOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overall_summary: str = Field(min_length=2, max_length=800)
    evaluations: list[StoryPlanQualityEvaluation] = Field(min_length=1, max_length=12)


class StoryPlanQualityFinding(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    node_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    node_version: int = Field(ge=1)
    title: str = Field(min_length=2, max_length=160)
    start_episode: int = Field(ge=1, le=2_000)
    end_episode: int = Field(ge=1, le=2_000)
    summary: str = Field(min_length=2, max_length=500)
    issue_codes: list[str] = Field(min_length=1, max_length=12)
    repair_instruction: str = Field(min_length=2, max_length=1_000)


class StoryPlanQualityAudit(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_version: int = Field(ge=1)
    node_refs: list[StoryPlanQualityNodeRef] = Field(min_length=1, max_length=300)
    node_signature: str = Field(pattern=r"^[a-f0-9]{64}$")
    status: StoryPlanQualityStatus
    summary: str = Field(min_length=2, max_length=800)
    audited_node_count: int = Field(ge=1, le=300)
    semantic_sample_count: int = Field(ge=1, le=12)
    findings: list[StoryPlanQualityFinding] = Field(default_factory=list, max_length=24)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StoryStagePlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    stage_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_version: int = Field(ge=1)
    version: int = Field(default=1, ge=1)
    stage_number: int = Field(ge=1, le=2_000)
    title: str = Field(min_length=2, max_length=160)
    start_episode: int = Field(ge=1, le=2_000)
    end_episode: int = Field(ge=1, le=2_000)
    stage_goal: str = Field(min_length=5, max_length=1_000)
    entry_state: str = Field(min_length=5, max_length=1_000)
    central_conflict: str = Field(min_length=5, max_length=1_000)
    key_turns: list[str] = Field(min_length=1, max_length=20)
    character_arc_movements: dict[str, str] = Field(default_factory=dict)
    setup_refs: list[str] = Field(default_factory=list, max_length=50)
    payoff_refs: list[str] = Field(default_factory=list, max_length=50)
    exit_state: str = Field(min_length=5, max_length=1_000)
    status: PlanningApprovalStatus = PlanningApprovalStatus.draft
    approved_at: datetime | None = None

    @field_validator("key_turns", "setup_refs", "payoff_refs")
    @classmethod
    def ensure_unique_stage_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Story stage values must be unique.")
        return values

    @model_validator(mode="after")
    def validate_story_stage(self) -> "StoryStagePlan":
        if self.end_episode < self.start_episode:
            raise ValueError("end_episode must not be lower than start_episode.")
        if self.status == PlanningApprovalStatus.approved and self.approved_at is None:
            raise ValueError("Approved story stage requires approved_at.")
        if self.status != PlanningApprovalStatus.approved and self.approved_at is not None:
            raise ValueError("approved_at is only valid for an approved story stage.")
        return self


class EpisodePlanningOpenHook(BaseModel):
    """One unresolved roadmap obligation carried across planning leaves."""

    model_config = ConfigDict(extra="forbid")

    source_episode: int = Field(ge=1, le=2_000)
    hook_type: str = Field(min_length=2, max_length=80)
    obligation: str = Field(min_length=3, max_length=500)
    target_episode: int | None = Field(default=None, ge=1, le=2_000)


class EpisodePlanningStateHandoff(BaseModel):
    """Compact observable state passed forward by an accepted roadmap item."""

    model_config = ConfigDict(extra="forbid")

    episode_number: int = Field(ge=1, le=2_000)
    exit_state: str = Field(min_length=3, max_length=500)
    pressure_escalation: str = Field(min_length=3, max_length=500)
    next_episode_obligation: str = Field(min_length=3, max_length=500)


class EpisodePlanningContinuityMemory(BaseModel):
    """Bounded roadmap memory compiled from all previously accepted leaves."""

    model_config = ConfigDict(extra="forbid")

    last_confirmed_episode: int | None = Field(default=None, ge=1, le=2_000)
    active_continuity_requirements: list[str] = Field(default_factory=list, max_length=50)
    unresolved_setup_refs: list[str] = Field(default_factory=list, max_length=100)
    recorded_payoff_refs: list[str] = Field(default_factory=list, max_length=100)
    active_story_line_refs: list[str] = Field(default_factory=list, max_length=50)
    open_hooks: list[EpisodePlanningOpenHook] = Field(default_factory=list, max_length=20)
    recent_state_handoffs: list[EpisodePlanningStateHandoff] = Field(
        default_factory=list,
        max_length=6,
    )


class EpisodePlanBatchDraftRequest(BaseModel):
    """Generate a bounded EpisodePlan batch from one approved episode-ready leaf."""

    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    source_node_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    source_node_version: int = Field(ge=1)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    planning_memory: EpisodePlanningContinuityMemory | None = None


class EpisodeSceneExecutionBeat(BaseModel):
    """Compact scene-level execution contract for one episode roadmap."""

    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=EPISODE_SCENE_MAX)
    scene_heading: str = Field(min_length=5, max_length=200)
    character_refs: list[str] = Field(min_length=1, max_length=20)
    scene_objective: str = Field(min_length=3, max_length=500)
    visible_action: str = Field(min_length=5, max_length=800)
    turn_or_reveal: str = Field(min_length=3, max_length=500)
    dialogue_objective: str = Field(min_length=3, max_length=500)
    dialogue_line_target: int = Field(ge=0, le=EPISODE_DIALOGUE_LINE_MAX)
    shot_target: int = Field(ge=1, le=EPISODE_SHOT_UNIT_MAX)
    exit_state: str = Field(min_length=3, max_length=500)

    @field_validator("scene_heading")
    @classmethod
    def ensure_screenplay_scene_heading(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized.startswith(("INT.", "EXT.")):
            raise ValueError("scene_heading must start with INT. or EXT.")
        return normalized

    @field_validator("character_refs")
    @classmethod
    def ensure_unique_scene_characters(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Scene character_refs must be unique.")
        return values


class EpisodePlanGenerationItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_dialogue_plan(cls, value: Any) -> Any:
        return normalize_episode_dialogue_plan_payload(value)

    episode_number: int = Field(ge=1, le=2_000)
    episode_title: str | None = Field(default=None, min_length=2, max_length=18)
    target_duration_seconds: int = Field(
        default=90,
        ge=EPISODE_RUNTIME_MIN_SECONDS,
        le=EPISODE_RUNTIME_MAX_SECONDS,
    )
    planned_scene_count: int = Field(
        default=3,
        ge=EPISODE_SCENE_MIN,
        le=EPISODE_SCENE_MAX,
    )
    planned_shot_count: int = Field(
        default=16,
        ge=EPISODE_SHOT_UNIT_MIN,
        le=EPISODE_SHOT_UNIT_MAX,
    )
    planned_dialogue_line_count: int = Field(
        default=30,
        ge=EPISODE_DIALOGUE_LINE_MIN,
        le=EPISODE_DIALOGUE_LINE_MAX,
    )
    episode_goal: str = Field(min_length=5, max_length=800)
    entry_state: str = Field(min_length=5, max_length=1_000)
    central_conflict: str = Field(min_length=5, max_length=800)
    protagonist_decision: str = Field(min_length=5, max_length=800)
    reveal: str | None = Field(default=None, min_length=3, max_length=800)
    emotional_movement: str = Field(min_length=3, max_length=500)
    stage_opposition: str = Field(
        default="承接当前阶段的具体阻力。",
        min_length=3,
        max_length=800,
    )
    episode_payoff: str = Field(
        default="兑现一个可见的阶段推进结果。",
        min_length=3,
        max_length=800,
    )
    pressure_escalation: str = Field(
        default="当前结果引出更高一级的因果压力。",
        min_length=3,
        max_length=800,
    )
    setup_refs: list[str] = Field(default_factory=list, max_length=20)
    payoff_refs: list[str] = Field(default_factory=list, max_length=20)
    exit_state: str = Field(min_length=5, max_length=1_000)
    cliffhanger: str = Field(min_length=5, max_length=800)
    character_refs: list[str] = Field(min_length=1, max_length=30)
    story_line_refs: list[str] = Field(default_factory=list, max_length=20)
    continuity_requirements: list[str] = Field(default_factory=list, max_length=30)
    source_turning_points: list[str] = Field(default_factory=list, max_length=30)
    source_unit_story_beats: list[str] = Field(default_factory=list, max_length=12)
    ending_hook_type: str = Field(default="因果压力", min_length=2, max_length=80)
    next_episode_obligation: str = Field(
        default="下一集必须承接本集结尾压力。",
        min_length=3,
        max_length=500,
    )
    hook_payoff_target_episode: int | None = Field(default=None, ge=1, le=2_000)
    scene_execution_plan: list[EpisodeSceneExecutionBeat] = Field(
        default_factory=list,
        max_length=EPISODE_SCENE_MAX,
    )
    layer_contracts: EpisodeThreeLayerContract | None = None

    @field_validator("target_duration_seconds", mode="before")
    @classmethod
    def normalize_legacy_target_duration(cls, value: Any) -> Any:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return value
        return min(
            EPISODE_RUNTIME_MAX_SECONDS,
            max(EPISODE_RUNTIME_MIN_SECONDS, round(value)),
        )

    @field_validator("planned_scene_count", mode="before")
    @classmethod
    def normalize_legacy_planned_scene_count(cls, value: Any) -> Any:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return value
        return min(EPISODE_SCENE_MAX, max(EPISODE_SCENE_MIN, round(value)))

    @field_validator("planned_shot_count", mode="before")
    @classmethod
    def normalize_legacy_planned_shot_count(cls, value: Any) -> Any:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return value
        return min(EPISODE_SHOT_UNIT_MAX, max(EPISODE_SHOT_UNIT_MIN, round(value)))

    @field_validator("planned_dialogue_line_count", mode="before")
    @classmethod
    def normalize_legacy_planned_dialogue_count(cls, value: Any) -> Any:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return value
        return min(
            EPISODE_DIALOGUE_LINE_MAX,
            max(EPISODE_DIALOGUE_LINE_MIN, round(value)),
        )

    @model_validator(mode="after")
    def validate_scene_execution_plan(self) -> "EpisodePlanGenerationItem":
        if not self.scene_execution_plan:
            return self
        if len(self.scene_execution_plan) != self.planned_scene_count:
            raise ValueError("scene_execution_plan must match planned_scene_count.")
        if [item.scene_number for item in self.scene_execution_plan] != list(
            range(1, self.planned_scene_count + 1)
        ):
            raise ValueError("scene_execution_plan must use consecutive scene numbers.")
        if sum(item.shot_target for item in self.scene_execution_plan) != self.planned_shot_count:
            raise ValueError("Scene shot targets must equal planned_shot_count.")
        if (
            sum(item.dialogue_line_target for item in self.scene_execution_plan)
            != self.planned_dialogue_line_count
        ):
            raise ValueError(
                "Scene dialogue targets must equal planned_dialogue_line_count."
            )
        allowed_characters = set(self.character_refs)
        if any(
            not set(item.character_refs).issubset(allowed_characters)
            for item in self.scene_execution_plan
        ):
            raise ValueError("Scene character_refs must exist in the episode plan.")
        return self


class EpisodePlanBatchGenerationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episode_plans: list[EpisodePlanGenerationItem] = Field(min_length=1, max_length=20)


class EpisodePlanItemDraftRequest(EpisodePlanBatchDraftRequest):
    """Generate one resumable roadmap item after a contiguous accepted prefix."""

    episode_number: int = Field(ge=1, le=2_000)
    agent_request_id: str | None = Field(default=None, min_length=3, max_length=240)
    predecessor_plan: EpisodePlanGenerationItem | None = None
    accepted_plans: list[EpisodePlanGenerationItem] = Field(
        default_factory=list,
        max_length=MAX_EPISODE_READY_SPAN - 1,
    )

    @model_validator(mode="after")
    def validate_accepted_prefix(self) -> "EpisodePlanItemDraftRequest":
        numbers = [item.episode_number for item in self.accepted_plans]
        if numbers != sorted(set(numbers)):
            raise ValueError("accepted_plans must be unique and ordered by episode_number.")
        if any(number >= self.episode_number for number in numbers):
            raise ValueError("accepted_plans must precede episode_number.")
        return self


class EpisodePlanItemModificationRequest(EpisodePlanItemDraftRequest):
    """Generate a reviewable revision for one episode roadmap item."""

    revision_mode: PlanningRevisionMode = PlanningRevisionMode.targeted
    instruction: str = Field(default="", max_length=1_000)
    selection_context: StoryBibleSelectionContext | None = None
    current_plan: EpisodePlanGenerationItem

    @model_validator(mode="after")
    def validate_modification_context(self) -> "EpisodePlanItemModificationRequest":
        if self.current_plan.episode_number != self.episode_number:
            raise ValueError("current_plan episode_number must match the request path.")
        if (
            self.revision_mode == PlanningRevisionMode.targeted
            and len(self.instruction.strip()) < 2
        ):
            raise ValueError("A targeted Episode roadmap revision requires an instruction.")
        return self


class EpisodeRoadmapItemDraftResponse(BaseModel):
    data: EpisodePlanGenerationItem


class EpisodeRoadmapDraftResponse(BaseModel):
    data: list[EpisodePlanGenerationItem]


class EpisodePlan(BaseModel):
    """Defines why one episode exists without containing scene prose."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    episode_plan_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_version: int = Field(ge=1)
    version: int = Field(default=1, ge=1)
    stage_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    stage_version: int = Field(default=1, ge=1)
    episode_number: int = Field(ge=1, le=2_000)
    episode_title: str | None = Field(default=None, min_length=2, max_length=18)
    episode_goal: str = Field(min_length=5, max_length=800)
    entry_state: str = Field(min_length=5, max_length=1_000)
    central_conflict: str = Field(min_length=5, max_length=800)
    protagonist_decision: str = Field(min_length=5, max_length=800)
    reveal: str | None = Field(default=None, min_length=3, max_length=800)
    emotional_movement: str = Field(min_length=3, max_length=500)
    setup_refs: list[str] = Field(default_factory=list, max_length=20)
    payoff_refs: list[str] = Field(default_factory=list, max_length=20)
    exit_state: str = Field(min_length=5, max_length=1_000)
    cliffhanger: str = Field(min_length=5, max_length=800)
    character_refs: list[str] = Field(min_length=1, max_length=30)
    continuity_requirements: list[str] = Field(default_factory=list, max_length=30)
    source_turning_points: list[str] = Field(default_factory=list, max_length=30)
    source_unit_story_beats: list[str] = Field(default_factory=list, max_length=12)
    status: PlanningApprovalStatus = PlanningApprovalStatus.draft
    approved_at: datetime | None = None

    @field_validator(
        "setup_refs",
        "payoff_refs",
        "character_refs",
        "continuity_requirements",
        "source_turning_points",
        "source_unit_story_beats",
    )
    @classmethod
    def ensure_unique_episode_plan_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Episode Plan list values must be unique.")
        return values

    @model_validator(mode="after")
    def validate_episode_plan_approval(self) -> "EpisodePlan":
        if self.status == PlanningApprovalStatus.approved and self.approved_at is None:
            raise ValueError("Approved Episode Plan requires approved_at.")
        if self.status != PlanningApprovalStatus.approved and self.approved_at is not None:
            raise ValueError("approved_at is only valid for an approved Episode Plan.")
        return self


class ContinuityKnowledgeState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    knowledge_key: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.:-]+$",
    )
    statement: str = Field(min_length=2, max_length=500)
    status: str = Field(
        pattern=r"^(known|believed|suspected|disproved|forgotten)$"
    )


class ContinuityCharacterState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_ref: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    current_goal: str = Field(min_length=3, max_length=500)
    emotional_state: str = Field(min_length=2, max_length=300)
    belief_or_attitude: str | None = Field(default=None, min_length=2, max_length=300)
    life_status: str | None = Field(
        default=None,
        pattern=r"^(alive|dead|missing|unknown)$",
    )
    physical_state: str | None = Field(default=None, min_length=2, max_length=300)
    location: str | None = Field(default=None, min_length=2, max_length=300)
    current_knowledge: list[str] = Field(default_factory=list, max_length=100)
    knowledge_states: list[ContinuityKnowledgeState] = Field(default_factory=list, max_length=50)
    health_conditions: list[str] = Field(default_factory=list, max_length=30)
    action_capabilities: list[str] = Field(default_factory=list, max_length=30)
    lasting_marks: list[str] = Field(default_factory=list, max_length=30)
    active_constraints: list[str] = Field(default_factory=list, max_length=30)
    personality_development: str | None = Field(default=None, min_length=2, max_length=300)
    latest_change_summary: str | None = Field(default=None, min_length=2, max_length=500)
    latest_change_cause: str | None = Field(default=None, min_length=2, max_length=500)
    evidence_scene_numbers: list[int] = Field(default_factory=list, max_length=20)
    last_updated_episode: int = Field(ge=0, le=2_000)

    @field_validator(
        "current_knowledge",
        "health_conditions",
        "action_capabilities",
        "lasting_marks",
        "active_constraints",
        "evidence_scene_numbers",
    )
    @classmethod
    def ensure_unique_character_state_values(cls, values: list[Any]) -> list[Any]:
        normalized = [str(value).strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Character continuity values must be unique.")
        return values

    @field_validator("knowledge_states")
    @classmethod
    def ensure_unique_knowledge_states(
        cls,
        values: list[ContinuityKnowledgeState],
    ) -> list[ContinuityKnowledgeState]:
        keys = [value.knowledge_key.casefold() for value in values]
        if len(set(keys)) != len(keys):
            raise ValueError("Character knowledge state keys must be unique.")
        return values


class ContinuityRelationshipState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relationship_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    source_character_ref: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    target_character_ref: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    current_state: str = Field(min_length=3, max_length=500)
    last_changed_episode: int = Field(ge=0, le=2_000)


class ContinuityStoryLineState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    story_line_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    status: StoryLineStatus
    current_state: str = Field(min_length=3, max_length=800)
    last_progressed_episode: int = Field(ge=0, le=2_000)
    last_contribution_type: str | None = Field(
        default=None,
        pattern=r"^(setup|progress|turning_point|payoff|resolution)$",
    )
    planned_alignment: str | None = Field(
        default=None,
        pattern=r"^(aligned|expanded|deviated)$",
    )
    next_required_step: str | None = Field(default=None, min_length=3, max_length=300)
    last_evidence_scene_numbers: list[int] = Field(default_factory=list, max_length=12)


class ContinuityWorldState(BaseModel):
    """Latest value of one entity/domain pair with causal provenance."""

    model_config = ConfigDict(extra="forbid")

    entity_key: str = Field(min_length=3, max_length=120, pattern=r"^[a-z0-9_.:-]+$")
    entity_type: str = Field(
        pattern=r"^(character|item|location|organization|environment|society|time)$"
    )
    entity_name: str = Field(min_length=1, max_length=160)
    state_domain: str = Field(
        pattern=(
            r"^(existence|life|health|ability|condition|ownership|possession|location|"
            r"access|affiliation|authority|identity|resource|rule|schedule|weather|"
            r"reputation|legal_status|technology|knowledge|obligation|environment)$"
        )
    )
    current_state: str = Field(min_length=2, max_length=300)
    persistence: str = Field(pattern=r"^(temporary|ongoing|permanent)$")
    future_constraint: str | None = Field(default=None, min_length=2, max_length=300)
    last_transition: str = Field(
        pattern=(
            r"^(established|changed|resolved|acquired|lost|moved|transferred|destroyed|"
            r"died|recovered|repaired)$"
        )
    )
    change_cause: str = Field(min_length=2, max_length=300)
    evidence_episode_number: int = Field(ge=1, le=2_000)
    evidence_scene_numbers: list[int] = Field(min_length=1, max_length=12)

    @field_validator("evidence_scene_numbers")
    @classmethod
    def ensure_unique_world_state_evidence(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("World state evidence scene numbers must be unique.")
        return values


class ContinuityEntityAlias(BaseModel):
    """Maps a display name or model-produced alias to one stable entity key."""

    model_config = ConfigDict(extra="forbid")

    canonical_entity_key: str = Field(
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    alias: str = Field(min_length=1, max_length=160)
    entity_type: str = Field(
        pattern=r"^(character|item|location|organization|environment|society|time)$"
    )
    source: str = Field(pattern=r"^(story_bible|generated)$")
    last_seen_episode: int = Field(ge=0, le=2_000)


class ContinuityFact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fact_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    statement: str = Field(min_length=3, max_length=800)
    established_episode: int = Field(ge=0, le=2_000)
    source: ContinuityFactSource
    locked: bool = False


class SetupPayoffRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    setup_payoff_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    description: str = Field(min_length=5, max_length=800)
    hook_type: str | None = Field(default=None, min_length=2, max_length=80)
    next_episode_obligation: str | None = Field(default=None, min_length=3, max_length=300)
    status: SetupPayoffStatus = SetupPayoffStatus.planned
    setup_episode: int | None = Field(default=None, ge=1, le=2_000)
    target_payoff_episode: int | None = Field(default=None, ge=1, le=2_000)
    payoff_episode: int | None = Field(default=None, ge=1, le=2_000)
    response_summary: str | None = Field(default=None, min_length=3, max_length=300)
    response_evidence_scene_numbers: list[int] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def validate_setup_payoff_lifecycle(self) -> "SetupPayoffRecord":
        if self.status in {SetupPayoffStatus.setup, SetupPayoffStatus.paid_off}:
            if self.setup_episode is None:
                raise ValueError("A setup or paid-off record requires setup_episode.")
        if self.status == SetupPayoffStatus.paid_off and self.payoff_episode is None:
            raise ValueError("A paid-off record requires payoff_episode.")
        if self.target_payoff_episode is not None and self.setup_episode is not None:
            if self.target_payoff_episode < self.setup_episode:
                raise ValueError("target_payoff_episode must not precede setup_episode.")
        if self.payoff_episode is not None and self.setup_episode is not None:
            if self.payoff_episode < self.setup_episode:
                raise ValueError("payoff_episode must not precede setup_episode.")
        return self


class ContinuityTimelineEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    episode_number: int = Field(ge=1, le=2_000)
    sequence_order: int = Field(ge=1, le=10_000)
    summary: str = Field(min_length=3, max_length=800)


class EpisodeContinuitySummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episode_number: int = Field(ge=1, le=2_000)
    entry_state: str = Field(min_length=3, max_length=1_000)
    exit_state: str = Field(min_length=3, max_length=1_000)
    consequences: list[str] = Field(min_length=1, max_length=20)
    new_fact_ids: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("consequences", "new_fact_ids")
    @classmethod
    def ensure_unique_episode_summary_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Episode continuity summary values must be unique.")
        return values


class ContinuityLedger(BaseModel):
    """Compact current state; it is not a copy of all generated episode prose."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    ledger_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_version: int = Field(ge=1)
    memory_layer: MemoryLayer = MemoryLayer.derived
    version: int = Field(default=1, ge=1)
    through_episode_number: int = Field(default=0, ge=0, le=2_000)
    character_states: list[ContinuityCharacterState] = Field(default_factory=list, max_length=50)
    relationship_states: list[ContinuityRelationshipState] = Field(default_factory=list, max_length=100)
    story_line_states: list[ContinuityStoryLineState] = Field(default_factory=list, max_length=50)
    world_states: list[ContinuityWorldState] = Field(default_factory=list, max_length=1_000)
    entity_aliases: list[ContinuityEntityAlias] = Field(default_factory=list, max_length=2_000)
    canonical_facts: list[ContinuityFact] = Field(default_factory=list, max_length=2_000)
    setup_payoffs: list[SetupPayoffRecord] = Field(default_factory=list, max_length=500)
    timeline: list[ContinuityTimelineEvent] = Field(default_factory=list, max_length=2_000)
    recent_episode_summaries: list[EpisodeContinuitySummary] = Field(
        default_factory=list,
        max_length=20,
    )
    warnings: list[str] = Field(default_factory=list, max_length=50)
    source_artifact_id: str | None = Field(
        default=None,
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    restored_from_version: int | None = Field(default=None, ge=1)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("warnings")
    @classmethod
    def ensure_unique_ledger_warnings(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Continuity warnings must be unique.")
        return values

    @model_validator(mode="after")
    def validate_ledger_state(self) -> "ContinuityLedger":
        if self.memory_layer != MemoryLayer.derived:
            raise ValueError("Continuity Ledger is a derived projection, not canon.")
        identity_groups = {
            "character": [item.character_ref.casefold() for item in self.character_states],
            "relationship": [item.relationship_id.casefold() for item in self.relationship_states],
            "story line": [item.story_line_id.casefold() for item in self.story_line_states],
            "fact": [item.fact_id.casefold() for item in self.canonical_facts],
            "setup/payoff": [item.setup_payoff_id.casefold() for item in self.setup_payoffs],
            "timeline event": [item.event_id.casefold() for item in self.timeline],
        }
        for label, values in identity_groups.items():
            if len(set(values)) != len(values):
                raise ValueError(f"Continuity {label} IDs must be unique.")

        observed_episodes = [
            *(item.last_updated_episode for item in self.character_states),
            *(item.last_changed_episode for item in self.relationship_states),
            *(item.last_progressed_episode for item in self.story_line_states),
            *(item.evidence_episode_number for item in self.world_states),
            *(item.last_seen_episode for item in self.entity_aliases),
            *(item.established_episode for item in self.canonical_facts),
            *(item.episode_number for item in self.timeline),
            *(item.episode_number for item in self.recent_episode_summaries),
            *(item.setup_episode for item in self.setup_payoffs if item.setup_episode is not None),
            *(item.payoff_episode for item in self.setup_payoffs if item.payoff_episode is not None),
        ]
        if any(value > self.through_episode_number for value in observed_episodes):
            raise ValueError("Continuity events cannot exceed through_episode_number.")

        summary_numbers = [item.episode_number for item in self.recent_episode_summaries]
        if len(set(summary_numbers)) != len(summary_numbers):
            raise ValueError("Recent episode summaries must reference unique episodes.")
        world_state_keys = [
            f"{item.entity_key.casefold()}::{item.state_domain}"
            for item in self.world_states
        ]
        if len(set(world_state_keys)) != len(world_state_keys):
            raise ValueError("Continuity world entity/domain pairs must be unique.")
        alias_keys = [
            f"{item.entity_type}::{''.join(item.alias.split()).casefold()}"
            for item in self.entity_aliases
        ]
        if len(set(alias_keys)) != len(alias_keys):
            raise ValueError("Continuity aliases must be unique within an entity type.")
        return self


class ContinuityLedgerRollbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_version: int = Field(ge=1)
    expected_current_version: int | None = Field(default=None, ge=1)


class ContinuityLedgerAuditStatus(str, Enum):
    consistent = "consistent"
    drifted = "drifted"
    incomplete = "incomplete"


class ContinuityLedgerAudit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(
        default="continuity_ledger_audit.v1",
        pattern=r"^continuity_ledger_audit\.v\d+$",
    )
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    ledger_version: int | None = Field(default=None, ge=1)
    checked_through_episode_number: int | None = Field(default=None, ge=1, le=2_000)
    event_set_count: int = Field(default=0, ge=0)
    event_count: int = Field(default=0, ge=0)
    status: ContinuityLedgerAuditStatus
    conflicts: list[str] = Field(default_factory=list, max_length=30)
    expected_source_artifact_id: str | None = Field(
        default=None,
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    actual_source_artifact_id: str | None = Field(
        default=None,
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    audited_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ContinuityLedgerAuditResponse(BaseModel):
    data: ContinuityLedgerAudit


class GenerationBatchPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    batch_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    revision: int = Field(default=1, ge=1)
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    batch_number: int = Field(ge=1, le=2_000)
    start_episode: int = Field(ge=1, le=2_000)
    end_episode: int = Field(ge=1, le=2_000)
    stage_id: str | None = Field(default=None, min_length=3, max_length=120)
    stage_version: int | None = Field(default=None, ge=1)
    episode_plan_ids: list[str] = Field(min_length=1, max_length=20)
    instruction: str | None = Field(default=None, max_length=1_000)
    status: GenerationBatchStatus = GenerationBatchStatus.planned
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None

    @field_validator("episode_plan_ids")
    @classmethod
    def ensure_unique_batch_episode_plans(cls, values: list[str]) -> list[str]:
        normalized = [value.casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Batch Episode Plan IDs must be unique.")
        return values

    @model_validator(mode="after")
    def validate_batch_plan(self) -> "GenerationBatchPlan":
        if self.end_episode < self.start_episode:
            raise ValueError("end_episode must not be lower than start_episode.")
        expected_count = self.end_episode - self.start_episode + 1
        if len(self.episode_plan_ids) != expected_count:
            raise ValueError("Batch requires one Episode Plan ID per episode.")
        if (self.stage_id is None) != (self.stage_version is None):
            raise ValueError("stage_id and stage_version must be set together.")
        if self.status == GenerationBatchStatus.completed and self.completed_at is None:
            raise ValueError("Completed batch requires completed_at.")
        if self.status != GenerationBatchStatus.completed and self.completed_at is not None:
            raise ValueError("completed_at is only valid for a completed batch.")
        return self


class GenerationJobCheckpoint(BaseModel):
    """Persistence-ready technical state; it does not decide story quality."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    job_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    revision: int = Field(default=1, ge=1)
    batch_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    status: GenerationJobStatus = GenerationJobStatus.queued
    attempt_count: int = Field(default=0, ge=0, le=20)
    completed_episode_numbers: list[int] = Field(default_factory=list, max_length=20)
    failed_episode_numbers: list[int] = Field(default_factory=list, max_length=20)
    last_error: str | None = Field(default=None, max_length=2_000)
    checkpointed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("completed_episode_numbers", "failed_episode_numbers")
    @classmethod
    def ensure_unique_job_episodes(cls, values: list[int]) -> list[int]:
        if any(value < 1 or value > 2_000 for value in values):
            raise ValueError("Generation job episode numbers must be between 1 and 2000.")
        if len(set(values)) != len(values):
            raise ValueError("Generation job episode numbers must be unique.")
        return values

    @model_validator(mode="after")
    def validate_job_checkpoint(self) -> "GenerationJobCheckpoint":
        overlap = set(self.completed_episode_numbers).intersection(self.failed_episode_numbers)
        if overlap:
            raise ValueError("An episode cannot be both completed and failed.")
        if self.status == GenerationJobStatus.failed and not self.last_error:
            raise ValueError("Failed generation job requires last_error.")
        return self


class GenerationTaskCheckpoint(BaseModel):
    """Atomic persistence payload for one resumable generation batch."""

    model_config = ConfigDict(extra="forbid")

    batch: GenerationBatchPlan
    checkpoint: GenerationJobCheckpoint

    @model_validator(mode="after")
    def validate_task_identity(self) -> "GenerationTaskCheckpoint":
        if self.checkpoint.batch_id != self.batch.batch_id:
            raise ValueError("Generation task checkpoint must reference its batch.")
        return self


class GenerationTaskCheckpointResponse(BaseModel):
    data: GenerationTaskCheckpoint | None


class StoryProjectResponse(BaseModel):
    data: StoryProject


class StoryProjectListResponse(BaseModel):
    data: list[StoryProject]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)


class StoryProjectDeletionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    deleted: bool = True
    deleted_records: dict[str, int] = Field(default_factory=dict)


class StoryProjectDeletionResponse(BaseModel):
    data: StoryProjectDeletionResult


class StoryBibleResponse(BaseModel):
    data: StoryBible


class StoryBibleDraftResponse(BaseModel):
    data: StoryBible
    project_revision: int = Field(ge=1)
    workspace_revision: int | None = Field(default=None, ge=1)


class StoryPlanNodeResponse(BaseModel):
    data: StoryPlanNode


class StoryPlanNodeListResponse(BaseModel):
    data: list[StoryPlanNode]


class StoryPlanQualityAuditResponse(BaseModel):
    data: StoryPlanQualityAudit


class StoryStagePlanResponse(BaseModel):
    data: StoryStagePlan


class StoryStagePlanListResponse(BaseModel):
    data: list[StoryStagePlan]


class EpisodePlanResponse(BaseModel):
    data: EpisodePlan


class EpisodePlanListResponse(BaseModel):
    data: list[EpisodePlan]


class LongStoryErrorResponse(BaseModel):
    detail: str


class StoryProjectWorkspaceSave(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    revision: int = Field(default=1, ge=1)
    payload_schema_version: str = Field(
        default="frontend.script_project.v1",
        min_length=3,
        max_length=80,
    )
    client_instance_id: str = Field(
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    memory_layer: MemoryLayer = MemoryLayer.provisional
    workspace_payload: dict[str, Any]
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def validate_workspace_identity(self) -> "StoryProjectWorkspaceSave":
        if self.memory_layer != MemoryLayer.provisional:
            raise ValueError("Workspace snapshots must remain provisional memory.")
        payload_project_id = self.workspace_payload.get("id")
        if payload_project_id != self.project_id:
            raise ValueError("workspace_payload.id must match project_id.")
        return self


class StoryProjectWorkspaceSnapshot(StoryProjectWorkspaceSave):
    payload_checksum: str = Field(pattern=r"^[a-f0-9]{64}$")
    payload_size_bytes: int = Field(ge=2, le=MAX_WORKSPACE_PAYLOAD_BYTES)


class StoryProjectWorkspaceResponse(BaseModel):
    data: StoryProjectWorkspaceSnapshot


class PlanningSessionPhase(str, Enum):
    creative_intent = "creative_intent"
    story_bible = "story_bible"
    story_tree = "story_tree"
    episode_roadmap = "episode_roadmap"
    script = "script"


class PlanningSessionStatus(str, Enum):
    idle = "idle"
    active = "active"
    awaiting_review = "awaiting_review"
    approved = "approved"
    paused = "paused"


class PlanningTurnScope(str, Enum):
    creative_intent = "creative_intent"
    story_bible = "story_bible"
    story_tree = "story_tree"
    story_node = "story_node"


class PlanningTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    turn_id: str = Field(min_length=3, max_length=160, pattern=IDENTIFIER_PATTERN)
    scope: PlanningTurnScope
    node_id: str | None = Field(default=None, min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    instruction: str = Field(default="", max_length=2_000)
    selected_candidate_titles: list[str] = Field(default_factory=list, max_length=20)
    outcome: Literal["proposed", "accepted", "rejected"]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PlanningSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    session_id: str = Field(min_length=3, max_length=160, pattern=IDENTIFIER_PATTERN)
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    revision: int = Field(default=1, ge=1)
    phase: PlanningSessionPhase
    status: PlanningSessionStatus
    story_bible_author_instruction: str = Field(default="", max_length=2_000)
    tree_author_instruction: str = Field(default="", max_length=2_000)
    story_bible_step: str = Field(default="premise", max_length=40)
    story_bible_sections: dict[str, Any] = Field(default_factory=dict)
    active_node_id: str | None = Field(default=None, min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    reviewed_node_ids: list[str] = Field(default_factory=list, max_length=500)
    turns: list[PlanningTurn] = Field(default_factory=list, max_length=500)
    started_at: datetime | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PlanningSessionSave(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    client_instance_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    session: PlanningSession

    @model_validator(mode="after")
    def validate_session_identity(self) -> "PlanningSessionSave":
        if self.session.story_project_id != self.project_id:
            raise ValueError("session.story_project_id must match project_id.")
        return self


class PlanningSessionSnapshot(PlanningSession):
    client_instance_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    payload_checksum: str = Field(pattern=r"^[a-f0-9]{64}$")
    payload_size_bytes: int = Field(ge=2, le=2_000_000)


class PlanningSessionResponse(BaseModel):
    data: PlanningSessionSnapshot


class ContinuityLedgerResponse(BaseModel):
    data: ContinuityLedger | None


class EpisodeArtifactCreate(BaseModel):
    """Immutable episode milestone submitted by an authoring client."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    artifact_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_project_id: str = Field(
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    episode_number: int = Field(ge=1, le=2_000)
    artifact_kind: EpisodeArtifactKind
    # Older artifacts have no explicit layer. Their effective layer is inferred
    # from kind so existing projects remain readable during migration.
    memory_layer: MemoryLayer | None = None
    content_schema_version: str = Field(min_length=2, max_length=80)
    content_payload: dict[str, Any]
    source_artifact_id: str | None = Field(
        default=None,
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    lineage_refs: dict[str, str] = Field(default_factory=dict)
    client_instance_id: str | None = Field(
        default=None,
        min_length=3,
        max_length=120,
        pattern=IDENTIFIER_PATTERN,
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("lineage_refs")
    @classmethod
    def validate_lineage_refs(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 30:
            raise ValueError("Episode Artifact lineage_refs cannot exceed 30 entries.")
        if any(not key.strip() or not item.strip() for key, item in value.items()):
            raise ValueError("Episode Artifact lineage_refs cannot contain blank values.")
        return value

    @model_validator(mode="after")
    def validate_artifact_memory_layer(self) -> "EpisodeArtifactCreate":
        if (
            self.memory_layer == MemoryLayer.canonical
            and self.artifact_kind == EpisodeArtifactKind.revised
        ):
            raise ValueError("A revised artifact cannot be canonical memory.")
        if (
            self.memory_layer == MemoryLayer.provisional
            and self.artifact_kind == EpisodeArtifactKind.final
        ):
            raise ValueError("A final artifact cannot remain provisional memory.")
        return self

    @property
    def effective_memory_layer(self) -> MemoryLayer:
        if self.memory_layer is not None:
            return self.memory_layer
        return (
            MemoryLayer.derived
            if self.artifact_kind == EpisodeArtifactKind.revised
            else MemoryLayer.canonical
        )


class EpisodeArtifact(EpisodeArtifactCreate):
    artifact_version: int = Field(ge=1)
    payload_checksum: str = Field(pattern=r"^[a-f0-9]{64}$")
    payload_size_bytes: int = Field(ge=2, le=5_000_000)


class NarrativeEvent(BaseModel):
    """Immutable, source-linked fact extracted from one canonical artifact."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str = Field(default="narrative_event.v1", pattern=r"^narrative_event\.v\d+$")
    event_id: str = Field(min_length=3, max_length=180, pattern=IDENTIFIER_PATTERN)
    event_set_id: str = Field(min_length=3, max_length=160, pattern=IDENTIFIER_PATTERN)
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    episode_number: int = Field(ge=1, le=2_000)
    sequence_order: int = Field(ge=1, le=10_000)
    source_artifact_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    event_type: NarrativeEventType
    summary: str = Field(min_length=3, max_length=800)
    entity_refs: list[str] = Field(default_factory=list, max_length=30)
    evidence_refs: list[str] = Field(min_length=1, max_length=30)
    state_mutation: dict[str, Any] | None = None
    memory_layer: MemoryLayer = MemoryLayer.canonical
    recorded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("entity_refs", "evidence_refs")
    @classmethod
    def ensure_unique_event_refs(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Narrative event references must be unique.")
        return values

    @model_validator(mode="after")
    def validate_event_memory_layer(self) -> "NarrativeEvent":
        if self.memory_layer != MemoryLayer.canonical:
            raise ValueError("Narrative events must be canonical source records.")
        return self


class NarrativeEventSet(BaseModel):
    """Immutable event batch produced from one canonical episode artifact."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str = Field(
        default="narrative_event_set.v1",
        pattern=r"^narrative_event_set\.v\d+$",
    )
    event_set_id: str = Field(min_length=3, max_length=160, pattern=IDENTIFIER_PATTERN)
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    episode_number: int = Field(ge=1, le=2_000)
    source_artifact_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    source_artifact_version: int = Field(ge=1)
    extractor_policy_version: str = Field(default="structured_continuity.v1", min_length=3, max_length=80)
    status: NarrativeEventSetStatus = NarrativeEventSetStatus.validated
    event_ids: list[str] = Field(min_length=1, max_length=500)
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    memory_layer: MemoryLayer = MemoryLayer.canonical
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("event_ids")
    @classmethod
    def ensure_unique_event_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Narrative Event Set event IDs must be unique.")
        return values

    @model_validator(mode="after")
    def validate_event_set_memory_layer(self) -> "NarrativeEventSet":
        if self.memory_layer != MemoryLayer.canonical:
            raise ValueError("Narrative Event Sets must remain canonical source records.")
        return self


class EpisodeArtifactResponse(BaseModel):
    data: EpisodeArtifact


class EpisodeArtifactListResponse(BaseModel):
    data: list[EpisodeArtifact]


class NarrativeEventSetResponse(BaseModel):
    data: NarrativeEventSet | None


class NarrativeEventListResponse(BaseModel):
    data: list[NarrativeEvent]
