from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


class OrchestrationStatus(str, Enum):
    ready = "ready"
    blocked = "blocked"


class AssetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(min_length=3, max_length=80)
    asset_type: str = Field(min_length=3, max_length=80)
    reason: str = Field(min_length=5, max_length=240)
    required_tag_ids: list[str] = Field(min_length=1, max_length=10)
    optional_tag_ids: list[str] = Field(default_factory=list, max_length=10)
    limit: int = Field(default=5, ge=1, le=20)


class ScriptConstraint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(min_length=3, max_length=80)
    rule: str = Field(min_length=5, max_length=240)
    priority: str = Field(min_length=3, max_length=20)


class SceneBlueprint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=20)
    purpose: str = Field(min_length=5, max_length=200)
    target_emotion: str = Field(min_length=2, max_length=80)
    recommended_focus: str = Field(min_length=3, max_length=120)


class OrchestrationPlanCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_spec_id: str = Field(min_length=3, max_length=80)
    desired_scene_count: int = Field(default=3, ge=2, le=8)


class OrchestrationPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()))
    content_spec_id: str = Field(min_length=3, max_length=80)
    platform_profile_id: str = Field(min_length=3, max_length=80)
    title: str = Field(min_length=3, max_length=120)
    creative_hook: str = Field(min_length=5, max_length=240)
    episode_goal: str = Field(min_length=5, max_length=240)
    target_duration_seconds: int = Field(ge=5, le=600)
    desired_scene_count: int = Field(ge=2, le=8)
    asset_requests: list[AssetRequest] = Field(min_length=1, max_length=20)
    script_constraints: list[ScriptConstraint] = Field(min_length=1, max_length=20)
    scene_blueprints: list[SceneBlueprint] = Field(min_length=2, max_length=8)
    status: OrchestrationStatus
    blocking_issues: list[str] = Field(default_factory=list, max_length=10)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("scene_blueprints")
    @classmethod
    def ensure_unique_scene_numbers(
        cls, scene_blueprints: list[SceneBlueprint]
    ) -> list[SceneBlueprint]:
        numbers = [scene.scene_number for scene in scene_blueprints]
        if len(set(numbers)) != len(numbers):
            raise ValueError("Scene blueprint numbers must be unique.")
        return scene_blueprints


class OrchestrationPlanResponse(BaseModel):
    data: OrchestrationPlan


class OrchestrationPlanListResponse(BaseModel):
    data: list[OrchestrationPlan]


class ErrorResponse(BaseModel):
    detail: str
