from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AgentToolKind(str, Enum):
    deterministic = "deterministic"
    model = "model"
    persistence = "persistence"


class AgentToolStatus(str, Enum):
    running = "running"
    completed = "completed"
    failed = "failed"


class AgentRunStatus(str, Enum):
    running = "running"
    completed = "completed"
    failed = "failed"


class AgentRunPolicy(BaseModel):
    """Hard execution limits owned by code rather than by the model."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    max_steps: int = Field(default=4, ge=1, le=20)
    max_model_tool_calls: int = Field(default=2, ge=0, le=8)
    allowed_tools: frozenset[str] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def ensure_model_budget_fits_step_budget(self) -> "AgentRunPolicy":
        if self.max_model_tool_calls > self.max_steps:
            raise ValueError("max_model_tool_calls cannot exceed max_steps.")
        return self


class AgentToolExecution(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    attempt: int = Field(default=1, ge=1, le=20)
    step: int = Field(ge=1, le=20)
    tool_name: str = Field(min_length=2, max_length=80)
    kind: AgentToolKind
    status: AgentToolStatus
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    elapsed_ms: int = Field(default=0, ge=0)
    error_type: str | None = Field(default=None, max_length=120)
    checkpoint_type: str | None = Field(default=None, min_length=3, max_length=120)


class AgentRunRecord(BaseModel):
    """Sanitized execution trace. It never stores prompts, model output, or secrets."""

    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(default_factory=lambda: f"agent-run.{uuid4()}")
    agent_name: str = Field(min_length=3, max_length=80)
    subject_ref: str = Field(min_length=1, max_length=240)
    request_key: str = Field(
        default_factory=lambda: f"agent-request.{uuid4()}",
        min_length=3,
        max_length=240,
    )
    input_fingerprint: str = Field(
        default="0" * 64,
        pattern=r"^[a-f0-9]{64}$",
    )
    project_id: str | None = Field(default=None, min_length=3, max_length=120)
    episode_number: int | None = Field(default=None, ge=1, le=2_000)
    owner_instance_id: str | None = Field(default=None, min_length=3, max_length=160)
    policy: AgentRunPolicy
    status: AgentRunStatus = AgentRunStatus.running
    attempt_count: int = Field(default=1, ge=1, le=20)
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    tool_executions: list[AgentToolExecution] = Field(default_factory=list, max_length=400)
    failure_type: str | None = Field(default=None, max_length=120)
    result_type: str | None = Field(default=None, min_length=3, max_length=120)

    @property
    def model_tool_call_count(self) -> int:
        return sum(
            execution.kind == AgentToolKind.model
            and execution.status != AgentToolStatus.running
            for execution in self.tool_executions
        )

    @property
    def current_attempt_model_tool_call_count(self) -> int:
        return sum(
            execution.attempt == self.attempt_count
            and execution.kind == AgentToolKind.model
            and execution.status != AgentToolStatus.running
            for execution in self.tool_executions
        )


class AgentRunResponse(BaseModel):
    data: AgentRunRecord


class AgentRunListResponse(BaseModel):
    data: list[AgentRunRecord]
