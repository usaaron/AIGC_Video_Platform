"""Add immutable episode artifact versions.

Revision ID: 20260802_0003
Revises: 20260802_0002
Create Date: 2026-08-02 11:30:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260802_0003"
down_revision: Union[str, Sequence[str], None] = "20260802_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


JSON_PAYLOAD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "episode_artifact_versions",
        sa.Column("artifact_id", sa.String(length=120), nullable=False),
        sa.Column("story_project_id", sa.String(length=120), nullable=False),
        sa.Column("episode_number", sa.Integer(), nullable=False),
        sa.Column("artifact_kind", sa.String(length=20), nullable=False),
        sa.Column("artifact_version", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("content_schema_version", sa.String(length=80), nullable=False),
        sa.Column("source_artifact_id", sa.String(length=120), nullable=True),
        sa.Column("client_instance_id", sa.String(length=120), nullable=True),
        sa.Column("payload_checksum", sa.String(length=64), nullable=False),
        sa.Column("payload_size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint(
            "artifact_version >= 1",
            name="ck_episode_artifact_version",
        ),
        sa.CheckConstraint(
            "episode_number BETWEEN 1 AND 2000",
            name="ck_episode_artifact_episode_number",
        ),
        sa.CheckConstraint(
            "artifact_kind IN ('draft', 'revised', 'final')",
            name="ck_episode_artifact_kind",
        ),
        sa.CheckConstraint(
            "payload_size_bytes BETWEEN 2 AND 5000000",
            name="ck_episode_artifact_payload_size",
        ),
        sa.ForeignKeyConstraint(["story_project_id"], ["story_projects.project_id"]),
        sa.ForeignKeyConstraint(
            ["source_artifact_id"],
            ["episode_artifact_versions.artifact_id"],
        ),
        sa.PrimaryKeyConstraint("artifact_id"),
        sa.UniqueConstraint(
            "story_project_id",
            "episode_number",
            "artifact_kind",
            "artifact_version",
            name="uq_episode_artifact_version",
        ),
    )
    op.create_index(
        "ix_episode_artifact_project_episode",
        "episode_artifact_versions",
        ["story_project_id", "episode_number"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_episode_artifact_project_episode",
        table_name="episode_artifact_versions",
    )
    op.drop_table("episode_artifact_versions")
