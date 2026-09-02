"""Persist interactive planning sessions independently from the frontend workspace.

Revision ID: 20260823_0009
Revises: 20260818_0008
Create Date: 2026-08-23 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260823_0009"
down_revision: Union[str, Sequence[str], None] = "20260818_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON_PAYLOAD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "planning_sessions",
        sa.Column("project_id", sa.String(length=120), nullable=False),
        sa.Column("session_id", sa.String(length=160), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("client_instance_id", sa.String(length=120), nullable=False),
        sa.Column("payload_checksum", sa.String(length=64), nullable=False),
        sa.Column("payload_size_bytes", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.CheckConstraint("revision >= 1", name="ck_planning_session_revision"),
        sa.CheckConstraint(
            "payload_size_bytes BETWEEN 2 AND 2000000",
            name="ck_planning_session_payload_size",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["story_projects.project_id"]),
        sa.PrimaryKeyConstraint("project_id"),
    )
    op.create_index(
        "ix_planning_sessions_updated",
        "planning_sessions",
        ["updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_planning_sessions_updated", table_name="planning_sessions")
    op.drop_table("planning_sessions")
