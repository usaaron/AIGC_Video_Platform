"""Prevent concurrent Agent runs for the same project episode.

Revision ID: 20260818_0008
Revises: 20260817_0007
Create Date: 2026-08-18 22:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260818_0008"
down_revision: Union[str, Sequence[str], None] = "20260817_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "uq_agent_runs_active_episode",
        "agent_runs",
        ["project_id", "episode_number"],
        unique=True,
        sqlite_where=sa.text("status = 'running'"),
        postgresql_where=sa.text("status = 'running'"),
    )


def downgrade() -> None:
    op.drop_index("uq_agent_runs_active_episode", table_name="agent_runs")
