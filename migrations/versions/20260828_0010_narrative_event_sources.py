"""Persist canonical narrative event sets and evidence-linked events.

Revision ID: 20260828_0010
Revises: 20260823_0009
Create Date: 2026-08-28 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260828_0010"
down_revision: Union[str, Sequence[str], None] = "20260823_0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


JSON_PAYLOAD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "narrative_event_sets",
        sa.Column("event_set_id", sa.String(length=160), nullable=False),
        sa.Column("story_project_id", sa.String(length=120), nullable=False),
        sa.Column("episode_number", sa.Integer(), nullable=False),
        sa.Column("source_artifact_id", sa.String(length=120), nullable=False),
        sa.Column("source_artifact_version", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.String(length=40), nullable=False),
        sa.Column("extractor_policy_version", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("memory_layer", sa.String(length=20), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint(
            "episode_number BETWEEN 1 AND 2000",
            name="ck_narrative_event_set_episode_number",
        ),
        sa.CheckConstraint(
            "source_artifact_version >= 1",
            name="ck_narrative_event_set_artifact_version",
        ),
        sa.ForeignKeyConstraint(["story_project_id"], ["story_projects.project_id"]),
        sa.PrimaryKeyConstraint("event_set_id"),
    )
    op.create_index(
        "ix_narrative_event_sets_project_episode",
        "narrative_event_sets",
        ["story_project_id", "episode_number"],
    )
    op.create_index(
        "ix_narrative_event_sets_source_artifact",
        "narrative_event_sets",
        ["source_artifact_id"],
        unique=True,
    )
    op.create_index(
        "ix_narrative_event_sets_status",
        "narrative_event_sets",
        ["status"],
    )
    op.create_index(
        "ix_narrative_event_sets_story_project_id",
        "narrative_event_sets",
        ["story_project_id"],
    )

    op.create_table(
        "narrative_events",
        sa.Column("event_id", sa.String(length=180), nullable=False),
        sa.Column("event_set_id", sa.String(length=160), nullable=False),
        sa.Column("story_project_id", sa.String(length=120), nullable=False),
        sa.Column("episode_number", sa.Integer(), nullable=False),
        sa.Column("sequence_order", sa.Integer(), nullable=False),
        sa.Column("source_artifact_id", sa.String(length=120), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("memory_layer", sa.String(length=20), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint(
            "episode_number BETWEEN 1 AND 2000",
            name="ck_narrative_event_episode_number",
        ),
        sa.CheckConstraint(
            "sequence_order BETWEEN 1 AND 10000",
            name="ck_narrative_event_sequence_order",
        ),
        sa.ForeignKeyConstraint(["story_project_id"], ["story_projects.project_id"]),
        sa.PrimaryKeyConstraint("event_id"),
        sa.UniqueConstraint(
            "event_set_id",
            "sequence_order",
            name="uq_narrative_event_set_order",
        ),
    )
    op.create_index(
        "ix_narrative_events_project_episode",
        "narrative_events",
        ["story_project_id", "episode_number"],
    )
    op.create_index(
        "ix_narrative_events_event_set_order",
        "narrative_events",
        ["event_set_id", "sequence_order"],
    )
    op.create_index(
        "ix_narrative_events_event_type",
        "narrative_events",
        ["event_type"],
    )
    op.create_index(
        "ix_narrative_events_story_project_id",
        "narrative_events",
        ["story_project_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_narrative_events_story_project_id",
        table_name="narrative_events",
    )
    op.drop_index(
        "ix_narrative_events_event_type",
        table_name="narrative_events",
    )
    op.drop_index(
        "ix_narrative_events_event_set_order",
        table_name="narrative_events",
    )
    op.drop_index(
        "ix_narrative_events_project_episode",
        table_name="narrative_events",
    )
    op.drop_table("narrative_events")
    op.drop_index(
        "ix_narrative_event_sets_source_artifact",
        table_name="narrative_event_sets",
    )
    op.drop_index(
        "ix_narrative_event_sets_story_project_id",
        table_name="narrative_event_sets",
    )
    op.drop_index(
        "ix_narrative_event_sets_status",
        table_name="narrative_event_sets",
    )
    op.drop_index(
        "ix_narrative_event_sets_project_episode",
        table_name="narrative_event_sets",
    )
    op.drop_table("narrative_event_sets")
