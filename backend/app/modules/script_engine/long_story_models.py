from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


IDENTIFIER_PATTERN = r"^[a-zA-Z0-9_.:-]+$"


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


class StoryProject(BaseModel):
    """Versioned aggregate contract for one serialized story project."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    revision: int = Field(default=1, ge=1)
    title: str = Field(min_length=2, max_length=160)
    content_spec_id: str = Field(min_length=3, max_length=120)
    output_language: str = Field(default="zh", min_length=2, max_length=20)
    target_total_characters: int = Field(default=600_000, ge=1_000, le=2_000_000)
    planned_episode_count: int = Field(ge=1, le=2_000)
    default_batch_size: int = Field(default=5, ge=1, le=20)
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


class StoryBible(BaseModel):
    """Human-reviewable source of truth for long-story generation."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="v1", pattern=r"^v\d+$")
    story_bible_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    story_project_id: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    content_spec_id: str = Field(min_length=3, max_length=120)
    version: int = Field(default=1, ge=1)
    status: PlanningApprovalStatus = PlanningApprovalStatus.draft
    core_premise: str = Field(min_length=10, max_length=1_200)
    series_goal: str = Field(min_length=10, max_length=1_200)
    theme: str = Field(min_length=2, max_length=300)
    central_conflict: str = Field(min_length=10, max_length=1_200)
    ending_direction: str = Field(min_length=10, max_length=1_200)
    world_rules: list[str] = Field(default_factory=list, max_length=30)
    character_refs: list[str] = Field(min_length=1, max_length=50)
    character_arc_targets: list[CharacterArcTarget] = Field(default_factory=list, max_length=50)
    relationships: list[StoryBibleRelationship] = Field(default_factory=list, max_length=100)
    story_lines: list[StoryLinePlan] = Field(min_length=1, max_length=50)
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

        if self.status == PlanningApprovalStatus.approved and self.approved_at is None:
            raise ValueError("Approved Story Bible requires approved_at.")
        if self.status != PlanningApprovalStatus.approved and self.approved_at is not None:
            raise ValueError("approved_at is only valid for an approved Story Bible.")
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
    status: PlanningApprovalStatus = PlanningApprovalStatus.draft
    approved_at: datetime | None = None

    @field_validator(
        "setup_refs",
        "payoff_refs",
        "character_refs",
        "continuity_requirements",
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


class ContinuityCharacterState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_ref: str = Field(min_length=3, max_length=120, pattern=IDENTIFIER_PATTERN)
    current_goal: str = Field(min_length=3, max_length=500)
    emotional_state: str = Field(min_length=2, max_length=300)
    current_knowledge: list[str] = Field(default_factory=list, max_length=100)
    active_constraints: list[str] = Field(default_factory=list, max_length=30)
    last_updated_episode: int = Field(ge=0, le=2_000)

    @field_validator("current_knowledge", "active_constraints")
    @classmethod
    def ensure_unique_character_state_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Character continuity values must be unique.")
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
    status: SetupPayoffStatus = SetupPayoffStatus.planned
    setup_episode: int | None = Field(default=None, ge=1, le=2_000)
    target_payoff_episode: int | None = Field(default=None, ge=1, le=2_000)
    payoff_episode: int | None = Field(default=None, ge=1, le=2_000)

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
    canonical_facts: list[ContinuityFact] = Field(default_factory=list, max_length=2_000)
    setup_payoffs: list[SetupPayoffRecord] = Field(default_factory=list, max_length=500)
    timeline: list[ContinuityTimelineEvent] = Field(default_factory=list, max_length=2_000)
    recent_episode_summaries: list[EpisodeContinuitySummary] = Field(
        default_factory=list,
        max_length=20,
    )
    warnings: list[str] = Field(default_factory=list, max_length=50)
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


class StoryProjectResponse(BaseModel):
    data: StoryProject


class StoryProjectListResponse(BaseModel):
    data: list[StoryProject]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)


class StoryBibleResponse(BaseModel):
    data: StoryBible


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
