"""Persist ContentSpec payloads required by long-story planning.

Revision ID: 20260804_0005
Revises: 20260803_0004
Create Date: 2026-08-04 14:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260804_0005"
down_revision: Union[str, Sequence[str], None] = "20260803_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


JSON_PAYLOAD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "content_specs",
        sa.Column("content_spec_id", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("platform_profile_id", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", JSON_PAYLOAD, nullable=False),
        sa.PrimaryKeyConstraint("content_spec_id"),
    )
    op.create_index(
        "ix_content_specs_platform_profile_id",
        "content_specs",
        ["platform_profile_id"],
    )
    op.create_index("ix_content_specs_status", "content_specs", ["status"])
    op.create_index(
        "ix_content_specs_status_updated",
        "content_specs",
        ["status", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_content_specs_status_updated", table_name="content_specs")
    op.drop_index("ix_content_specs_status", table_name="content_specs")
    op.drop_index(
        "ix_content_specs_platform_profile_id",
        table_name="content_specs",
    )
    op.drop_table("content_specs")
