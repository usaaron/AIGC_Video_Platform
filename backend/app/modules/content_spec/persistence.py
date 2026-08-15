from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


def _json_payload_column() -> Column[Any]:
    payload_type = JSON().with_variant(JSONB(), "postgresql")
    return Column(payload_type, nullable=False)


class ContentSpecRecord(SQLModel, table=True):
    __tablename__ = "content_specs"
    __table_args__ = (
        Index("ix_content_specs_status_updated", "status", "updated_at"),
    )

    content_spec_id: str = Field(primary_key=True, max_length=120)
    status: str = Field(index=True, max_length=40)
    platform_profile_id: str = Field(index=True, max_length=80)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    payload: dict[str, Any] = Field(sa_column=_json_payload_column())
