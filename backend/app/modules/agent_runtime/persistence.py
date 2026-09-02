from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Column,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    JSON,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


def _json_column(*, nullable: bool) -> Column[Any]:
    payload_type = JSON(none_as_null=True).with_variant(
        JSONB(none_as_null=True),
        "postgresql",
    )
    return Column(payload_type, nullable=nullable)


class AgentRunRecordTable(SQLModel, table=True):
    """Durable sanitized state for one bounded Agent request."""

    __tablename__ = "agent_runs"
    __table_args__ = (
        UniqueConstraint("request_key", name="uq_agent_runs_request_key"),
        Index("ix_agent_runs_request_key", "request_key"),
        Index("ix_agent_runs_subject_ref", "subject_ref"),
        Index("ix_agent_runs_project_updated", "project_id", "updated_at"),
        Index("ix_agent_runs_subject_updated", "subject_ref", "updated_at"),
        Index("ix_agent_runs_status_updated", "status", "updated_at"),
        Index(
            "uq_agent_runs_active_episode",
            "project_id",
            "episode_number",
            unique=True,
            sqlite_where=text("status = 'running'"),
            postgresql_where=text("status = 'running'"),
        ),
        CheckConstraint(
            "attempt_count BETWEEN 1 AND 20",
            name="ck_agent_runs_attempts",
        ),
        CheckConstraint(
            "episode_number IS NULL OR episode_number BETWEEN 1 AND 2000",
            name="ck_agent_runs_episode_number",
        ),
    )

    run_id: str = Field(primary_key=True, max_length=240)
    request_key: str = Field(max_length=240)
    agent_name: str = Field(index=True, max_length=80)
    subject_ref: str = Field(max_length=240)
    project_id: str | None = Field(default=None, index=True, max_length=120)
    episode_number: int | None = Field(default=None, index=True)
    input_fingerprint: str = Field(max_length=64)
    status: str = Field(index=True, max_length=40)
    attempt_count: int = Field(default=1)
    started_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    failure_type: str | None = Field(default=None, max_length=120)
    result_type: str | None = Field(default=None, max_length=120)
    result_payload: dict[str, Any] | None = Field(
        default=None,
        sa_column=_json_column(nullable=True),
    )
    payload: dict[str, Any] = Field(sa_column=_json_column(nullable=False))


class AgentStepRecordTable(SQLModel, table=True):
    """One sanitized tool execution and its optional validated checkpoint."""

    __tablename__ = "agent_steps"
    __table_args__ = (
        Index("ix_agent_steps_run_status", "run_id", "status"),
        Index("ix_agent_steps_tool_updated", "tool_name", "completed_at"),
        ForeignKeyConstraint(
            ["run_id"],
            ["agent_runs.run_id"],
            ondelete="CASCADE",
        ),
    )

    run_id: str = Field(primary_key=True, max_length=240)
    attempt: int = Field(primary_key=True)
    step: int = Field(primary_key=True)
    tool_name: str = Field(max_length=80)
    kind: str = Field(max_length=40)
    status: str = Field(max_length=40)
    started_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    elapsed_ms: int = Field(default=0)
    error_type: str | None = Field(default=None, max_length=120)
    checkpoint_type: str | None = Field(default=None, max_length=120)
    checkpoint_payload: dict[str, Any] | None = Field(
        default=None,
        sa_column=_json_column(nullable=True),
    )
