"""Expand workspace snapshots for long-form authoring state.

Revision ID: 20260811_0006
Revises: 20260804_0005
Create Date: 2026-08-11 12:00:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260811_0006"
down_revision: Union[str, Sequence[str], None] = "20260804_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("story_project_workspace_snapshots") as batch_op:
        batch_op.drop_constraint(
            "ck_story_workspace_payload_size",
            type_="check",
        )
        batch_op.create_check_constraint(
            "ck_story_workspace_payload_size",
            "payload_size_bytes BETWEEN 2 AND 50000000",
        )


def downgrade() -> None:
    with op.batch_alter_table("story_project_workspace_snapshots") as batch_op:
        batch_op.drop_constraint(
            "ck_story_workspace_payload_size",
            type_="check",
        )
        batch_op.create_check_constraint(
            "ck_story_workspace_payload_size",
            "payload_size_bytes BETWEEN 2 AND 10000000",
        )
