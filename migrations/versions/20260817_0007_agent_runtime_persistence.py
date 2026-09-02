"""Persist bounded Agent runs and validated step checkpoints.

Revision ID: 20260817_0007
Revises: 20260811_0006
Create Date: 2026-08-17 18:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260817_0007"
down_revision: Union[str, Sequence[str], None] = "20260811_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


JSON_PAYLOAD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("run_id", sa.String(length=240), nullable=False),
        sa.Column("request_key", sa.String(length=240), nullable=False),
        sa.Column("agent_name", sa.String(length=80), nullable=False),
        sa.Column("subject_ref", sa.String(length=240), nullable=False),
        sa.Column("project_id", sa.String(length=120), nullable=True),
        sa.Column("episode_number", sa.Integer(), nullable=True),
        sa.Column("input_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_type", sa.String(length=120), nullable=True),
        sa.Column("result_type", sa.String(length=120), nullable=True),
        sa.Column("result_payload", JSON_PAYLOAD, nullable=True),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.PrimaryKeyConstraint("run_id"),
        sa.UniqueConstraint("request_key", name="uq_agent_runs_request_key"),
        sa.CheckConstraint("attempt_count BETWEEN 1 AND 20", name="ck_agent_runs_attempts"),
        sa.CheckConstraint(
            "episode_number IS NULL OR episode_number BETWEEN 1 AND 2000",
            name="ck_agent_runs_episode_number",
        ),
    )
    op.create_index("ix_agent_runs_agent_name", "agent_runs", ["agent_name"])
    op.create_index("ix_agent_runs_request_key", "agent_runs", ["request_key"])
    op.create_index("ix_agent_runs_subject_ref", "agent_runs", ["subject_ref"])
    op.create_index("ix_agent_runs_project_id", "agent_runs", ["project_id"])
    op.create_index("ix_agent_runs_episode_number", "agent_runs", ["episode_number"])
    op.create_index("ix_agent_runs_status", "agent_runs", ["status"])
    op.create_index(
        "ix_agent_runs_project_updated",
        "agent_runs",
        ["project_id", "updated_at"],
    )
    op.create_index(
        "ix_agent_runs_subject_updated",
        "agent_runs",
        ["subject_ref", "updated_at"],
    )
    op.create_index(
        "ix_agent_runs_status_updated",
        "agent_runs",
        ["status", "updated_at"],
    )

    op.create_table(
        "agent_steps",
        sa.Column("run_id", sa.String(length=240), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("step", sa.Integer(), nullable=False),
        sa.Column("tool_name", sa.String(length=80), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("elapsed_ms", sa.Integer(), nullable=False),
        sa.Column("error_type", sa.String(length=120), nullable=True),
        sa.Column("checkpoint_type", sa.String(length=120), nullable=True),
        sa.Column("checkpoint_payload", JSON_PAYLOAD, nullable=True),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["agent_runs.run_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("run_id", "attempt", "step"),
    )
    op.create_index("ix_agent_steps_run_status", "agent_steps", ["run_id", "status"])
    op.create_index(
        "ix_agent_steps_tool_updated",
        "agent_steps",
        ["tool_name", "completed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_steps_tool_updated", table_name="agent_steps")
    op.drop_index("ix_agent_steps_run_status", table_name="agent_steps")
    op.drop_table("agent_steps")
    op.drop_index("ix_agent_runs_status_updated", table_name="agent_runs")
    op.drop_index("ix_agent_runs_subject_updated", table_name="agent_runs")
    op.drop_index("ix_agent_runs_project_updated", table_name="agent_runs")
    op.drop_index("ix_agent_runs_status", table_name="agent_runs")
    op.drop_index("ix_agent_runs_episode_number", table_name="agent_runs")
    op.drop_index("ix_agent_runs_project_id", table_name="agent_runs")
    op.drop_index("ix_agent_runs_request_key", table_name="agent_runs")
    op.drop_index("ix_agent_runs_subject_ref", table_name="agent_runs")
    op.drop_index("ix_agent_runs_agent_name", table_name="agent_runs")
    op.drop_table("agent_runs")
