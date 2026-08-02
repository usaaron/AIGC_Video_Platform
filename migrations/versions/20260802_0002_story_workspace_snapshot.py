"""Add durable story workspace snapshots.

Revision ID: 20260802_0002
Revises: 20260801_0001
Create Date: 2026-08-02 09:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260802_0002"
down_revision: Union[str, Sequence[str], None] = "20260801_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


JSON_PAYLOAD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    with op.batch_alter_table("story_projects") as batch_op:
        batch_op.alter_column(
            "content_spec_id",
            existing_type=sa.String(length=120),
            nullable=True,
        )

    op.create_table(
        "story_project_workspace_snapshots",
        sa.Column("project_id", sa.String(length=120), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("payload_schema_version", sa.String(length=80), nullable=False),
        sa.Column("client_instance_id", sa.String(length=120), nullable=False),
        sa.Column("payload_checksum", sa.String(length=64), nullable=False),
        sa.Column("payload_size_bytes", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint(
            "payload_size_bytes BETWEEN 2 AND 10000000",
            name="ck_story_workspace_payload_size",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_story_workspace_revision"),
        sa.ForeignKeyConstraint(["project_id"], ["story_projects.project_id"]),
        sa.PrimaryKeyConstraint("project_id"),
    )
    op.create_index(
        "ix_story_workspace_updated",
        "story_project_workspace_snapshots",
        ["updated_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_story_workspace_updated",
        table_name="story_project_workspace_snapshots",
    )
    op.drop_table("story_project_workspace_snapshots")

    with op.batch_alter_table("story_projects") as batch_op:
        batch_op.alter_column(
            "content_spec_id",
            existing_type=sa.String(length=120),
            nullable=False,
        )
