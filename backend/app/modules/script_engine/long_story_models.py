from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.script_delivery_contract import (
    EPISODE_RUNTIME_MAX_SECONDS,
    EPISODE_RUNTIME_MIN_SECONDS,
)


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


class StoryBibleModificationRequest(BaseModel):
    """Generate a reviewable AI revision candidate without persisting it."""

    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_bible_version: int = Field(ge=1)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    revision_mode: PlanningRevisionMode = PlanningRevisionMode.targeted
    instruction: str = Field(default="", max_length=1_000)

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
            "Optional legacy override. When omitted, the model chooses 2-12 "
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

    @model_validator(mode="after")
    def require_targeted_revision_instruction(self) -> "StoryPlanNodeModificationRequest":
        if (
            self.revision_mode == PlanningRevisionMode.targeted
            and len(self.instruction.strip()) < 2
        ):
            raise ValueError("A targeted Story Plan Node revision requires an instruction.")
        return self


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


class EpisodePlanBatchDraftRequest(BaseModel):
    """Generate a bounded EpisodePlan batch from one approved episode-ready leaf."""

    model_config = ConfigDict(extra="forbid")

    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    source_node_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    source_node_version: int = Field(ge=1)
    generation_strategy_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)


class EpisodePlanGenerationItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episode_number: int = Field(ge=1, le=2_000)
    target_duration_seconds: int = Field(
        default=90,
        ge=EPISODE_RUNTIME_MIN_SECONDS,
        le=EPISODE_RUNTIME_MAX_SECONDS,
    )
    planned_scene_count: int = Field(default=3, ge=2, le=5)
    planned_shot_count: int = Field(default=16, ge=8, le=24)
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

    @field_validator("target_duration_seconds", mode="before")
    @classmethod
    def normalize_legacy_target_duration(cls, value: Any) -> Any:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return value
        return min(
            EPISODE_RUNTIME_MAX_SECONDS,
            max(EPISODE_RUNTIME_MIN_SECONDS, round(value)),
        )


class EpisodePlanBatchGenerationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episode_plans: list[EpisodePlanGenerationItem] = Field(min_length=1, max_length=20)


class EpisodePlanItemDraftRequest(EpisodePlanBatchDraftRequest):
    """Generate one resumable roadmap item after a contiguous accepted prefix."""

    episode_number: int = Field(ge=1, le=2_000)
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
    workspace_payload: dict[str, Any]
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def validate_workspace_identity(self) -> "StoryProjectWorkspaceSave":
        payload_project_id = self.workspace_payload.get("id")
        if payload_project_id != self.project_id:
            raise ValueError("workspace_payload.id must match project_id.")
        return self


class StoryProjectWorkspaceSnapshot(StoryProjectWorkspaceSave):
    payload_checksum: str = Field(pattern=r"^[a-f0-9]{64}$")
    payload_size_bytes: int = Field(ge=2, le=MAX_WORKSPACE_PAYLOAD_BYTES)


class StoryProjectWorkspaceResponse(BaseModel):
    data: StoryProjectWorkspaceSnapshot


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


class EpisodeArtifact(EpisodeArtifactCreate):
    artifact_version: int = Field(ge=1)
    payload_checksum: str = Field(pattern=r"^[a-f0-9]{64}$")
    payload_size_bytes: int = Field(ge=2, le=5_000_000)


class EpisodeArtifactResponse(BaseModel):
    data: EpisodeArtifact


class EpisodeArtifactListResponse(BaseModel):
    data: list[EpisodeArtifact]
