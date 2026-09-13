"""Persist shared module configuration and content documents."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260910_0012"
down_revision = "20260907_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "module_documents",
        sa.Column("namespace", sa.String(80), primary_key=True),
        sa.Column("document_id", sa.String(120), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.JSON().with_variant(JSONB(), "postgresql"), nullable=False),
    )
    op.create_index("ix_module_documents_namespace_created", "module_documents", ["namespace", "created_at"])


def downgrade() -> None:
    op.drop_table("module_documents")
