"""Persist author-confirmed episode-plan source materializations.

Revision ID: 20260907_0011
Revises: 20260828_0010
Create Date: 2026-09-07 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260907_0011"
down_revision: Union[str, Sequence[str], None] = "20260828_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


JSON_PAYLOAD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "episode_plan_materializations",
        sa.Column("materialization_id", sa.String(length=120), nullable=False),
        sa.Column("story_project_id", sa.String(length=120), nullable=False),
        sa.Column("story_bible_id", sa.String(length=120), nullable=False),
        sa.Column("story_bible_version", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.String(length=50), nullable=False),
        sa.Column("source_fingerprint", sa.String(length=80), nullable=False),
        sa.Column("start_episode", sa.Integer(), nullable=False),
        sa.Column("end_episode", sa.Integer(), nullable=False),
        sa.Column("episode_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("author_confirmed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint(
            "start_episode BETWEEN 1 AND 2000 AND "
            "end_episode BETWEEN start_episode AND 2000",
            name="ck_episode_plan_materialization_range",
        ),
        sa.CheckConstraint(
            "episode_count BETWEEN 1 AND 2000",
            name="ck_episode_plan_materialization_count",
        ),
        sa.CheckConstraint(
            "status = 'draft'",
            name="ck_episode_plan_materialization_status",
        ),
        sa.ForeignKeyConstraint(
            ["story_bible_id", "story_bible_version"],
            ["story_bible_versions.story_bible_id", "story_bible_versions.version"],
        ),
        sa.ForeignKeyConstraint(
            ["story_project_id"],
            ["story_projects.project_id"],
        ),
        sa.PrimaryKeyConstraint("materialization_id"),
    )
    op.create_index(
        "ix_episode_plan_materializations_project_created",
        "episode_plan_materializations",
        ["story_project_id", "created_at"],
    )
    op.create_index(
        "ix_episode_plan_materializations_project_range",
        "episode_plan_materializations",
        ["story_project_id", "start_episode", "end_episode"],
    )
    op.create_index(
        "ix_episode_plan_materializations_source_fingerprint",
        "episode_plan_materializations",
        ["source_fingerprint"],
    )
    op.create_index(
        "ix_episode_plan_materializations_status",
        "episode_plan_materializations",
        ["status"],
    )
    op.create_index(
        "ix_episode_plan_materializations_story_bible_id",
        "episode_plan_materializations",
        ["story_bible_id"],
    )
    op.create_index(
        "ix_episode_plan_materializations_story_project_id",
        "episode_plan_materializations",
        ["story_project_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_episode_plan_materializations_story_project_id",
        table_name="episode_plan_materializations",
    )
    op.drop_index(
        "ix_episode_plan_materializations_story_bible_id",
        table_name="episode_plan_materializations",
    )
    op.drop_index(
        "ix_episode_plan_materializations_status",
        table_name="episode_plan_materializations",
    )
    op.drop_index(
        "ix_episode_plan_materializations_source_fingerprint",
        table_name="episode_plan_materializations",
    )
    op.drop_index(
        "ix_episode_plan_materializations_project_range",
        table_name="episode_plan_materializations",
    )
    op.drop_index(
        "ix_episode_plan_materializations_project_created",
        table_name="episode_plan_materializations",
    )
    op.drop_table("episode_plan_materializations")
