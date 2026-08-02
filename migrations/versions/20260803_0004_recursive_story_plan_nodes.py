"""Add recursively decomposable story plan nodes.

Revision ID: 20260803_0004
Revises: 20260802_0003
Create Date: 2026-08-03 10:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260803_0004"
down_revision: Union[str, Sequence[str], None] = "20260802_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


JSON_PAYLOAD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "story_plan_node_versions",
        sa.Column("node_id", sa.String(length=120), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("story_project_id", sa.String(length=120), nullable=False),
        sa.Column("story_bible_id", sa.String(length=120), nullable=False),
        sa.Column("story_bible_version", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("parent_node_id", sa.String(length=120), nullable=True),
        sa.Column("parent_node_version", sa.Integer(), nullable=True),
        sa.Column("predecessor_node_id", sa.String(length=120), nullable=True),
        sa.Column("predecessor_node_version", sa.Integer(), nullable=True),
        sa.Column("sequence_order", sa.Integer(), nullable=False),
        sa.Column("planned_start_episode", sa.Integer(), nullable=True),
        sa.Column("planned_end_episode", sa.Integer(), nullable=True),
        sa.Column("expansion_status", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint("sequence_order >= 1", name="ck_story_plan_node_order"),
        sa.CheckConstraint(
            "(parent_node_id IS NULL AND parent_node_version IS NULL) OR "
            "(parent_node_id IS NOT NULL AND parent_node_version IS NOT NULL)",
            name="ck_story_plan_node_parent_pair",
        ),
        sa.CheckConstraint(
            "(predecessor_node_id IS NULL AND predecessor_node_version IS NULL) OR "
            "(predecessor_node_id IS NOT NULL AND predecessor_node_version IS NOT NULL)",
            name="ck_story_plan_node_predecessor_pair",
        ),
        sa.CheckConstraint(
            "(planned_start_episode IS NULL AND planned_end_episode IS NULL) OR "
            "(planned_start_episode >= 1 AND planned_end_episode >= planned_start_episode)",
            name="ck_story_plan_node_episode_range",
        ),
        sa.ForeignKeyConstraint(["story_project_id"], ["story_projects.project_id"]),
        sa.ForeignKeyConstraint(
            ["story_bible_id", "story_bible_version"],
            ["story_bible_versions.story_bible_id", "story_bible_versions.version"],
        ),
        sa.ForeignKeyConstraint(
            ["parent_node_id", "parent_node_version"],
            ["story_plan_node_versions.node_id", "story_plan_node_versions.version"],
        ),
        sa.ForeignKeyConstraint(
            ["predecessor_node_id", "predecessor_node_version"],
            ["story_plan_node_versions.node_id", "story_plan_node_versions.version"],
        ),
        sa.PrimaryKeyConstraint("node_id", "version"),
    )
    op.create_index(
        "ix_story_plan_nodes_project_parent_order",
        "story_plan_node_versions",
        ["story_project_id", "parent_node_id", "sequence_order"],
    )
    op.create_index(
        "ix_story_plan_node_versions_story_project_id",
        "story_plan_node_versions",
        ["story_project_id"],
    )
    op.create_index(
        "ix_story_plan_node_versions_story_bible_id",
        "story_plan_node_versions",
        ["story_bible_id"],
    )
    op.create_index(
        "ix_story_plan_node_versions_expansion_status",
        "story_plan_node_versions",
        ["expansion_status"],
    )
    op.create_index(
        "ix_story_plan_node_versions_status",
        "story_plan_node_versions",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_story_plan_node_versions_status",
        table_name="story_plan_node_versions",
    )
    op.drop_index(
        "ix_story_plan_node_versions_expansion_status",
        table_name="story_plan_node_versions",
    )
    op.drop_index(
        "ix_story_plan_node_versions_story_bible_id",
        table_name="story_plan_node_versions",
    )
    op.drop_index(
        "ix_story_plan_node_versions_story_project_id",
        table_name="story_plan_node_versions",
    )
    op.drop_index(
        "ix_story_plan_nodes_project_parent_order",
        table_name="story_plan_node_versions",
    )
    op.drop_table("story_plan_node_versions")
