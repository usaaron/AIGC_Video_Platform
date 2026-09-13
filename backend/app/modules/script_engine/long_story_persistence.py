from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKeyConstraint,
    Index,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


def _json_payload_column() -> Column[Any]:
    payload_type = JSON().with_variant(JSONB(), "postgresql")
    return Column(payload_type, nullable=False)


class StoryProjectRecord(SQLModel, table=True):
    __tablename__ = "story_projects"
    __table_args__ = (
        Index("ix_story_projects_status_updated", "status", "updated_at"),
        CheckConstraint("target_total_characters >= 1000", name="ck_story_projects_target_characters"),
        CheckConstraint(
            "planned_episode_count BETWEEN 1 AND 2000",
            name="ck_story_projects_episode_count",
        ),
        CheckConstraint(
            "default_batch_size BETWEEN 1 AND 20",
            name="ck_story_projects_batch_size",
        ),
        CheckConstraint("revision >= 1", name="ck_story_projects_revision"),
        CheckConstraint(
            "(active_story_bible_id IS NULL AND active_story_bible_version IS NULL) OR "
            "(active_story_bible_id IS NOT NULL AND active_story_bible_version IS NOT NULL)",
            name="ck_story_projects_active_bible_pair",
        ),
    )

    project_id: str = Field(primary_key=True, max_length=120)
    schema_version: str = Field(max_length=20)
    revision: int
    content_spec_id: str | None = Field(default=None, index=True, max_length=120)
    title: str = Field(max_length=160)
    output_language: str = Field(max_length=20)
    target_total_characters: int
    planned_episode_count: int
    default_batch_size: int
    status: str = Field(index=True, max_length=40)
    active_story_bible_id: str | None = Field(default=None, max_length=120)
    active_story_bible_version: int | None = None
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class StoryBibleVersionRecord(SQLModel, table=True):
    __tablename__ = "story_bible_versions"
    __table_args__ = (
        Index(
            "ix_story_bible_versions_project_status",
            "story_project_id",
            "status",
        ),
    )

    story_bible_id: str = Field(primary_key=True, max_length=120)
    version: int = Field(primary_key=True)
    story_project_id: str = Field(
        foreign_key="story_projects.project_id",
        index=True,
        max_length=120,
    )
    content_spec_id: str = Field(index=True, max_length=120)
    schema_version: str = Field(max_length=20)
    status: str = Field(index=True, max_length=40)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    approved_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class StoryPlanNodeVersionRecord(SQLModel, table=True):
    __tablename__ = "story_plan_node_versions"
    __table_args__ = (
        Index(
            "ix_story_plan_nodes_project_parent_order",
            "story_project_id",
            "parent_node_id",
            "sequence_order",
        ),
        ForeignKeyConstraint(
            ["story_bible_id", "story_bible_version"],
            ["story_bible_versions.story_bible_id", "story_bible_versions.version"],
        ),
        ForeignKeyConstraint(
            ["parent_node_id", "parent_node_version"],
            ["story_plan_node_versions.node_id", "story_plan_node_versions.version"],
        ),
        ForeignKeyConstraint(
            ["predecessor_node_id", "predecessor_node_version"],
            ["story_plan_node_versions.node_id", "story_plan_node_versions.version"],
        ),
        CheckConstraint("sequence_order >= 1", name="ck_story_plan_node_order"),
        CheckConstraint(
            "(parent_node_id IS NULL AND parent_node_version IS NULL) OR "
            "(parent_node_id IS NOT NULL AND parent_node_version IS NOT NULL)",
            name="ck_story_plan_node_parent_pair",
        ),
        CheckConstraint(
            "(predecessor_node_id IS NULL AND predecessor_node_version IS NULL) OR "
            "(predecessor_node_id IS NOT NULL AND predecessor_node_version IS NOT NULL)",
            name="ck_story_plan_node_predecessor_pair",
        ),
        CheckConstraint(
            "(planned_start_episode IS NULL AND planned_end_episode IS NULL) OR "
            "(planned_start_episode >= 1 AND planned_end_episode >= planned_start_episode)",
            name="ck_story_plan_node_episode_range",
        ),
    )

    node_id: str = Field(primary_key=True, max_length=120)
    version: int = Field(primary_key=True)
    story_project_id: str = Field(
        foreign_key="story_projects.project_id",
        index=True,
        max_length=120,
    )
    story_bible_id: str = Field(index=True, max_length=120)
    story_bible_version: int
    schema_version: str = Field(max_length=20)
    parent_node_id: str | None = Field(default=None, max_length=120)
    parent_node_version: int | None = None
    predecessor_node_id: str | None = Field(default=None, max_length=120)
    predecessor_node_version: int | None = None
    sequence_order: int
    planned_start_episode: int | None = None
    planned_end_episode: int | None = None
    expansion_status: str = Field(index=True, max_length=40)
    status: str = Field(index=True, max_length=40)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    approved_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class StoryStagePlanVersionRecord(SQLModel, table=True):
    __tablename__ = "story_stage_plan_versions"
    __table_args__ = (
        Index(
            "ix_story_stage_versions_project_range",
            "story_project_id",
            "start_episode",
            "end_episode",
        ),
        ForeignKeyConstraint(
            ["story_bible_id", "story_bible_version"],
            ["story_bible_versions.story_bible_id", "story_bible_versions.version"],
        ),
        CheckConstraint(
            "start_episode >= 1 AND end_episode >= start_episode",
            name="ck_story_stage_episode_range",
        ),
    )

    stage_id: str = Field(primary_key=True, max_length=120)
    version: int = Field(primary_key=True)
    story_project_id: str = Field(
        foreign_key="story_projects.project_id",
        index=True,
        max_length=120,
    )
    story_bible_id: str = Field(index=True, max_length=120)
    story_bible_version: int
    schema_version: str = Field(max_length=20)
    stage_number: int
    start_episode: int
    end_episode: int
    status: str = Field(index=True, max_length=40)
    approved_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class EpisodePlanVersionRecord(SQLModel, table=True):
    __tablename__ = "episode_plan_versions"
    __table_args__ = (
        Index(
            "ix_episode_plan_versions_project_episode",
            "story_project_id",
            "episode_number",
        ),
        ForeignKeyConstraint(
            ["story_bible_id", "story_bible_version"],
            ["story_bible_versions.story_bible_id", "story_bible_versions.version"],
        ),
        ForeignKeyConstraint(
            ["stage_id", "stage_version"],
            ["story_stage_plan_versions.stage_id", "story_stage_plan_versions.version"],
        ),
        CheckConstraint(
            "episode_number BETWEEN 1 AND 2000",
            name="ck_episode_plan_number",
        ),
    )

    episode_plan_id: str = Field(primary_key=True, max_length=120)
    version: int = Field(primary_key=True)
    story_project_id: str = Field(
        foreign_key="story_projects.project_id",
        index=True,
        max_length=120,
    )
    story_bible_id: str = Field(index=True, max_length=120)
    story_bible_version: int
    schema_version: str = Field(max_length=20)
    stage_id: str = Field(index=True, max_length=120)
    stage_version: int
    episode_number: int
    status: str = Field(index=True, max_length=40)
    approved_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class EpisodePlanMaterializationRecord(SQLModel, table=True):
    __tablename__ = "episode_plan_materializations"
    __table_args__ = (
        Index(
            "ix_episode_plan_materializations_project_created",
            "story_project_id",
            "created_at",
        ),
        Index(
            "ix_episode_plan_materializations_project_range",
            "story_project_id",
            "start_episode",
            "end_episode",
        ),
        ForeignKeyConstraint(
            ["story_bible_id", "story_bible_version"],
            ["story_bible_versions.story_bible_id", "story_bible_versions.version"],
        ),
        CheckConstraint(
            "start_episode BETWEEN 1 AND 2000 AND "
            "end_episode BETWEEN start_episode AND 2000",
            name="ck_episode_plan_materialization_range",
        ),
        CheckConstraint(
            "episode_count BETWEEN 1 AND 2000",
            name="ck_episode_plan_materialization_count",
        ),
        CheckConstraint(
            "status = 'draft'",
            name="ck_episode_plan_materialization_status",
        ),
    )

    materialization_id: str = Field(primary_key=True, max_length=120)
    story_project_id: str = Field(
        foreign_key="story_projects.project_id",
        index=True,
        max_length=120,
    )
    story_bible_id: str = Field(index=True, max_length=120)
    story_bible_version: int
    schema_version: str = Field(max_length=50)
    source_fingerprint: str = Field(index=True, max_length=80)
    start_episode: int
    end_episode: int
    episode_count: int
    status: str = Field(index=True, max_length=20)
    author_confirmed_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class ContinuityLedgerVersionRecord(SQLModel, table=True):
    __tablename__ = "continuity_ledger_versions"
    __table_args__ = (
        Index(
            "ix_continuity_versions_project_episode",
            "story_project_id",
            "through_episode_number",
        ),
        ForeignKeyConstraint(
            ["story_bible_id", "story_bible_version"],
            ["story_bible_versions.story_bible_id", "story_bible_versions.version"],
        ),
        CheckConstraint(
            "through_episode_number BETWEEN 0 AND 2000",
            name="ck_continuity_through_episode",
        ),
    )

    ledger_id: str = Field(primary_key=True, max_length=120)
    version: int = Field(primary_key=True)
    story_project_id: str = Field(
        foreign_key="story_projects.project_id",
        index=True,
        max_length=120,
    )
    story_bible_id: str = Field(index=True, max_length=120)
    story_bible_version: int
    schema_version: str = Field(max_length=20)
    through_episode_number: int
    updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class GenerationBatchPlanRecord(SQLModel, table=True):
    __tablename__ = "generation_batches"
    __table_args__ = (
        Index(
            "ix_generation_batches_project_number",
            "story_project_id",
            "batch_number",
            unique=True,
        ),
        ForeignKeyConstraint(
            ["stage_id", "stage_version"],
            ["story_stage_plan_versions.stage_id", "story_stage_plan_versions.version"],
        ),
        CheckConstraint(
            "start_episode >= 1 AND end_episode >= start_episode",
            name="ck_generation_batch_episode_range",
        ),
        CheckConstraint("revision >= 1", name="ck_generation_batch_revision"),
    )

    batch_id: str = Field(primary_key=True, max_length=120)
    story_project_id: str = Field(
        foreign_key="story_projects.project_id",
        index=True,
        max_length=120,
    )
    schema_version: str = Field(max_length=20)
    revision: int
    batch_number: int
    start_episode: int
    end_episode: int
    stage_id: str | None = Field(default=None, index=True, max_length=120)
    stage_version: int | None = None
    status: str = Field(index=True, max_length=40)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class GenerationJobCheckpointRecord(SQLModel, table=True):
    __tablename__ = "generation_job_checkpoints"
    __table_args__ = (
        Index("ix_generation_jobs_status_checkpoint", "status", "checkpointed_at"),
        CheckConstraint("attempt_count BETWEEN 0 AND 20", name="ck_generation_job_attempts"),
        CheckConstraint("revision >= 1", name="ck_generation_job_revision"),
    )

    job_id: str = Field(primary_key=True, max_length=120)
    batch_id: str = Field(
        foreign_key="generation_batches.batch_id",
        index=True,
        max_length=120,
    )
    schema_version: str = Field(max_length=20)
    revision: int
    status: str = Field(index=True, max_length=40)
    attempt_count: int
    checkpointed_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class StoryProjectWorkspaceSnapshotRecord(SQLModel, table=True):
    __tablename__ = "story_project_workspace_snapshots"
    __table_args__ = (
        Index("ix_story_workspace_updated", "updated_at"),
        CheckConstraint("revision >= 1", name="ck_story_workspace_revision"),
        CheckConstraint(
            "payload_size_bytes BETWEEN 2 AND 50000000",
            name="ck_story_workspace_payload_size",
        ),
    )

    project_id: str = Field(
        primary_key=True,
        foreign_key="story_projects.project_id",
        max_length=120,
    )
    schema_version: str = Field(max_length=20)
    revision: int
    payload_schema_version: str = Field(max_length=80)
    client_instance_id: str = Field(max_length=120)
    payload_checksum: str = Field(max_length=64)
    payload_size_bytes: int
    updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class PlanningSessionRecord(SQLModel, table=True):
    __tablename__ = "planning_sessions"
    __table_args__ = (
        Index("ix_planning_sessions_updated", "updated_at"),
        CheckConstraint("revision >= 1", name="ck_planning_session_revision"),
        CheckConstraint(
            "payload_size_bytes BETWEEN 2 AND 2000000",
            name="ck_planning_session_payload_size",
        ),
    )

    project_id: str = Field(
        primary_key=True,
        foreign_key="story_projects.project_id",
        max_length=120,
    )
    session_id: str = Field(max_length=160)
    schema_version: str = Field(max_length=20)
    revision: int
    client_instance_id: str = Field(max_length=120)
    payload_checksum: str = Field(max_length=64)
    payload_size_bytes: int
    updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class EpisodeArtifactVersionRecord(SQLModel, table=True):
    __tablename__ = "episode_artifact_versions"
    __table_args__ = (
        UniqueConstraint(
            "story_project_id",
            "episode_number",
            "artifact_kind",
            "artifact_version",
            name="uq_episode_artifact_version",
        ),
        Index(
            "ix_episode_artifact_project_episode",
            "story_project_id",
            "episode_number",
        ),
        CheckConstraint("artifact_version >= 1", name="ck_episode_artifact_version"),
        CheckConstraint(
            "episode_number BETWEEN 1 AND 2000",
            name="ck_episode_artifact_episode_number",
        ),
        CheckConstraint(
            "artifact_kind IN ('draft', 'revised', 'final')",
            name="ck_episode_artifact_kind",
        ),
        CheckConstraint(
            "payload_size_bytes BETWEEN 2 AND 5000000",
            name="ck_episode_artifact_payload_size",
        ),
    )

    artifact_id: str = Field(primary_key=True, max_length=120)
    story_project_id: str = Field(
        foreign_key="story_projects.project_id",
        max_length=120,
    )
    episode_number: int
    artifact_kind: str = Field(max_length=20)
    artifact_version: int
    schema_version: str = Field(max_length=20)
    content_schema_version: str = Field(max_length=80)
    source_artifact_id: str | None = Field(
        default=None,
        foreign_key="episode_artifact_versions.artifact_id",
        max_length=120,
    )
    client_instance_id: str | None = Field(default=None, max_length=120)
    payload_checksum: str = Field(max_length=64)
    payload_size_bytes: int
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class NarrativeEventSetRecord(SQLModel, table=True):
    """Immutable source batch extracted from one canonical artifact."""

    __tablename__ = "narrative_event_sets"
    __table_args__ = (
        Index(
            "ix_narrative_event_sets_project_episode",
            "story_project_id",
            "episode_number",
        ),
        Index(
            "ix_narrative_event_sets_source_artifact",
            "source_artifact_id",
            unique=True,
        ),
        CheckConstraint(
            "episode_number BETWEEN 1 AND 2000",
            name="ck_narrative_event_set_episode_number",
        ),
        CheckConstraint(
            "source_artifact_version >= 1",
            name="ck_narrative_event_set_artifact_version",
        ),
    )

    event_set_id: str = Field(primary_key=True, max_length=160)
    story_project_id: str = Field(
        foreign_key="story_projects.project_id",
        index=True,
        max_length=120,
    )
    episode_number: int
    source_artifact_id: str = Field(max_length=120)
    source_artifact_version: int
    schema_version: str = Field(max_length=40)
    extractor_policy_version: str = Field(max_length=80)
    status: str = Field(index=True, max_length=20)
    memory_layer: str = Field(max_length=20)
    content_hash: str = Field(max_length=64)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())


class NarrativeEventRecord(SQLModel, table=True):
    """Immutable source event with explicit evidence references."""

    __tablename__ = "narrative_events"
    __table_args__ = (
        Index(
            "ix_narrative_events_project_episode",
            "story_project_id",
            "episode_number",
        ),
        Index("ix_narrative_events_event_set_order", "event_set_id", "sequence_order"),
        UniqueConstraint(
            "event_set_id",
            "sequence_order",
            name="uq_narrative_event_set_order",
        ),
        CheckConstraint(
            "episode_number BETWEEN 1 AND 2000",
            name="ck_narrative_event_episode_number",
        ),
        CheckConstraint(
            "sequence_order BETWEEN 1 AND 10000",
            name="ck_narrative_event_sequence_order",
        ),
    )

    event_id: str = Field(primary_key=True, max_length=180)
    event_set_id: str = Field(max_length=160)
    story_project_id: str = Field(
        foreign_key="story_projects.project_id",
        index=True,
        max_length=120,
    )
    episode_number: int
    sequence_order: int
    source_artifact_id: str = Field(max_length=120)
    event_type: str = Field(index=True, max_length=50)
    memory_layer: str = Field(max_length=20)
    recorded_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())
