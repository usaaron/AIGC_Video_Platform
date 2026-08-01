"""Create long-story persistence foundation.

Revision ID: 20260801_0001
Revises:
Create Date: 2026-08-01 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260801_0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


JSON_PAYLOAD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "story_projects",
        sa.Column("project_id", sa.String(length=120), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("content_spec_id", sa.String(length=120), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("output_language", sa.String(length=20), nullable=False),
        sa.Column("target_total_characters", sa.Integer(), nullable=False),
        sa.Column("planned_episode_count", sa.Integer(), nullable=False),
        sa.Column("default_batch_size", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("active_story_bible_id", sa.String(length=120), nullable=True),
        sa.Column("active_story_bible_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint(
            "default_batch_size BETWEEN 1 AND 20",
            name="ck_story_projects_batch_size",
        ),
        sa.CheckConstraint(
            "(active_story_bible_id IS NULL AND active_story_bible_version IS NULL) OR "
            "(active_story_bible_id IS NOT NULL AND active_story_bible_version IS NOT NULL)",
            name="ck_story_projects_active_bible_pair",
        ),
        sa.CheckConstraint(
            "planned_episode_count BETWEEN 1 AND 2000",
            name="ck_story_projects_episode_count",
        ),
        sa.CheckConstraint(
            "target_total_characters >= 1000",
            name="ck_story_projects_target_characters",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_story_projects_revision"),
        sa.PrimaryKeyConstraint("project_id"),
    )
    op.create_index("ix_story_projects_content_spec_id", "story_projects", ["content_spec_id"])
    op.create_index("ix_story_projects_status", "story_projects", ["status"])
    op.create_index(
        "ix_story_projects_status_updated",
        "story_projects",
        ["status", "updated_at"],
    )

    op.create_table(
        "story_bible_versions",
        sa.Column("story_bible_id", sa.String(length=120), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("story_project_id", sa.String(length=120), nullable=False),
        sa.Column("content_spec_id", sa.String(length=120), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.ForeignKeyConstraint(["story_project_id"], ["story_projects.project_id"]),
        sa.PrimaryKeyConstraint("story_bible_id", "version"),
    )
    op.create_index("ix_story_bible_versions_content_spec_id", "story_bible_versions", ["content_spec_id"])
    op.create_index("ix_story_bible_versions_status", "story_bible_versions", ["status"])
    op.create_index("ix_story_bible_versions_story_project_id", "story_bible_versions", ["story_project_id"])
    op.create_index(
        "ix_story_bible_versions_project_status",
        "story_bible_versions",
        ["story_project_id", "status"],
    )

    op.create_table(
        "story_stage_plan_versions",
        sa.Column("stage_id", sa.String(length=120), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("story_project_id", sa.String(length=120), nullable=False),
        sa.Column("story_bible_id", sa.String(length=120), nullable=False),
        sa.Column("story_bible_version", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("stage_number", sa.Integer(), nullable=False),
        sa.Column("start_episode", sa.Integer(), nullable=False),
        sa.Column("end_episode", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint(
            "start_episode >= 1 AND end_episode >= start_episode",
            name="ck_story_stage_episode_range",
        ),
        sa.ForeignKeyConstraint(
            ["story_bible_id", "story_bible_version"],
            ["story_bible_versions.story_bible_id", "story_bible_versions.version"],
        ),
        sa.ForeignKeyConstraint(["story_project_id"], ["story_projects.project_id"]),
        sa.PrimaryKeyConstraint("stage_id", "version"),
    )
    op.create_index("ix_story_stage_plan_versions_status", "story_stage_plan_versions", ["status"])
    op.create_index("ix_story_stage_plan_versions_story_bible_id", "story_stage_plan_versions", ["story_bible_id"])
    op.create_index("ix_story_stage_plan_versions_story_project_id", "story_stage_plan_versions", ["story_project_id"])
    op.create_index(
        "ix_story_stage_versions_project_range",
        "story_stage_plan_versions",
        ["story_project_id", "start_episode", "end_episode"],
    )

    op.create_table(
        "episode_plan_versions",
        sa.Column("episode_plan_id", sa.String(length=120), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("story_project_id", sa.String(length=120), nullable=False),
        sa.Column("story_bible_id", sa.String(length=120), nullable=False),
        sa.Column("story_bible_version", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("stage_id", sa.String(length=120), nullable=False),
        sa.Column("stage_version", sa.Integer(), nullable=False),
        sa.Column("episode_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint(
            "episode_number BETWEEN 1 AND 2000",
            name="ck_episode_plan_number",
        ),
        sa.ForeignKeyConstraint(
            ["stage_id", "stage_version"],
            ["story_stage_plan_versions.stage_id", "story_stage_plan_versions.version"],
        ),
        sa.ForeignKeyConstraint(
            ["story_bible_id", "story_bible_version"],
            ["story_bible_versions.story_bible_id", "story_bible_versions.version"],
        ),
        sa.ForeignKeyConstraint(["story_project_id"], ["story_projects.project_id"]),
        sa.PrimaryKeyConstraint("episode_plan_id", "version"),
    )
    op.create_index("ix_episode_plan_versions_stage_id", "episode_plan_versions", ["stage_id"])
    op.create_index("ix_episode_plan_versions_status", "episode_plan_versions", ["status"])
    op.create_index("ix_episode_plan_versions_story_bible_id", "episode_plan_versions", ["story_bible_id"])
    op.create_index("ix_episode_plan_versions_story_project_id", "episode_plan_versions", ["story_project_id"])
    op.create_index(
        "ix_episode_plan_versions_project_episode",
        "episode_plan_versions",
        ["story_project_id", "episode_number"],
    )

    op.create_table(
        "continuity_ledger_versions",
        sa.Column("ledger_id", sa.String(length=120), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("story_project_id", sa.String(length=120), nullable=False),
        sa.Column("story_bible_id", sa.String(length=120), nullable=False),
        sa.Column("story_bible_version", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("through_episode_number", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint(
            "through_episode_number BETWEEN 0 AND 2000",
            name="ck_continuity_through_episode",
        ),
        sa.ForeignKeyConstraint(
            ["story_bible_id", "story_bible_version"],
            ["story_bible_versions.story_bible_id", "story_bible_versions.version"],
        ),
        sa.ForeignKeyConstraint(["story_project_id"], ["story_projects.project_id"]),
        sa.PrimaryKeyConstraint("ledger_id", "version"),
    )
    op.create_index("ix_continuity_ledger_versions_story_bible_id", "continuity_ledger_versions", ["story_bible_id"])
    op.create_index("ix_continuity_ledger_versions_story_project_id", "continuity_ledger_versions", ["story_project_id"])
    op.create_index(
        "ix_continuity_versions_project_episode",
        "continuity_ledger_versions",
        ["story_project_id", "through_episode_number"],
    )

    op.create_table(
        "generation_batches",
        sa.Column("batch_id", sa.String(length=120), nullable=False),
        sa.Column("story_project_id", sa.String(length=120), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("batch_number", sa.Integer(), nullable=False),
        sa.Column("start_episode", sa.Integer(), nullable=False),
        sa.Column("end_episode", sa.Integer(), nullable=False),
        sa.Column("stage_id", sa.String(length=120), nullable=True),
        sa.Column("stage_version", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint(
            "start_episode >= 1 AND end_episode >= start_episode",
            name="ck_generation_batch_episode_range",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_generation_batch_revision"),
        sa.ForeignKeyConstraint(
            ["stage_id", "stage_version"],
            ["story_stage_plan_versions.stage_id", "story_stage_plan_versions.version"],
        ),
        sa.ForeignKeyConstraint(["story_project_id"], ["story_projects.project_id"]),
        sa.PrimaryKeyConstraint("batch_id"),
    )
    op.create_index("ix_generation_batches_stage_id", "generation_batches", ["stage_id"])
    op.create_index("ix_generation_batches_status", "generation_batches", ["status"])
    op.create_index("ix_generation_batches_story_project_id", "generation_batches", ["story_project_id"])
    op.create_index(
        "ix_generation_batches_project_number",
        "generation_batches",
        ["story_project_id", "batch_number"],
        unique=True,
    )

    op.create_table(
        "generation_job_checkpoints",
        sa.Column("job_id", sa.String(length=120), nullable=False),
        sa.Column("batch_id", sa.String(length=120), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("checkpointed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint(
            "attempt_count BETWEEN 0 AND 20",
            name="ck_generation_job_attempts",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_generation_job_revision"),
        sa.ForeignKeyConstraint(["batch_id"], ["generation_batches.batch_id"]),
        sa.PrimaryKeyConstraint("job_id"),
    )
    op.create_index("ix_generation_job_checkpoints_batch_id", "generation_job_checkpoints", ["batch_id"])
    op.create_index("ix_generation_job_checkpoints_status", "generation_job_checkpoints", ["status"])
    op.create_index(
        "ix_generation_jobs_status_checkpoint",
        "generation_job_checkpoints",
        ["status", "checkpointed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_generation_jobs_status_checkpoint", table_name="generation_job_checkpoints")
    op.drop_index("ix_generation_job_checkpoints_status", table_name="generation_job_checkpoints")
    op.drop_index("ix_generation_job_checkpoints_batch_id", table_name="generation_job_checkpoints")
    op.drop_table("generation_job_checkpoints")

    op.drop_index("ix_generation_batches_project_number", table_name="generation_batches")
    op.drop_index("ix_generation_batches_story_project_id", table_name="generation_batches")
    op.drop_index("ix_generation_batches_status", table_name="generation_batches")
    op.drop_index("ix_generation_batches_stage_id", table_name="generation_batches")
    op.drop_table("generation_batches")

    op.drop_index("ix_continuity_versions_project_episode", table_name="continuity_ledger_versions")
    op.drop_index("ix_continuity_ledger_versions_story_project_id", table_name="continuity_ledger_versions")
    op.drop_index("ix_continuity_ledger_versions_story_bible_id", table_name="continuity_ledger_versions")
    op.drop_table("continuity_ledger_versions")

    op.drop_index("ix_episode_plan_versions_project_episode", table_name="episode_plan_versions")
    op.drop_index("ix_episode_plan_versions_story_project_id", table_name="episode_plan_versions")
    op.drop_index("ix_episode_plan_versions_story_bible_id", table_name="episode_plan_versions")
    op.drop_index("ix_episode_plan_versions_status", table_name="episode_plan_versions")
    op.drop_index("ix_episode_plan_versions_stage_id", table_name="episode_plan_versions")
    op.drop_table("episode_plan_versions")

    op.drop_index("ix_story_stage_versions_project_range", table_name="story_stage_plan_versions")
    op.drop_index("ix_story_stage_plan_versions_story_project_id", table_name="story_stage_plan_versions")
    op.drop_index("ix_story_stage_plan_versions_story_bible_id", table_name="story_stage_plan_versions")
    op.drop_index("ix_story_stage_plan_versions_status", table_name="story_stage_plan_versions")
    op.drop_table("story_stage_plan_versions")

    op.drop_index("ix_story_bible_versions_project_status", table_name="story_bible_versions")
    op.drop_index("ix_story_bible_versions_story_project_id", table_name="story_bible_versions")
    op.drop_index("ix_story_bible_versions_status", table_name="story_bible_versions")
    op.drop_index("ix_story_bible_versions_content_spec_id", table_name="story_bible_versions")
    op.drop_table("story_bible_versions")

    op.drop_index("ix_story_projects_status_updated", table_name="story_projects")
    op.drop_index("ix_story_projects_status", table_name="story_projects")
    op.drop_index("ix_story_projects_content_spec_id", table_name="story_projects")
    op.drop_table("story_projects")
