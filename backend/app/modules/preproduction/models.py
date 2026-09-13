from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ShotContent(Contract):
    source_refs: list[str] = Field(min_length=1, max_length=60)
    purpose: str = Field(min_length=1, max_length=500)
    duration_seconds: float = Field(gt=0, le=600, allow_inf_nan=False)
    framing: str = Field(min_length=1, max_length=120)
    camera: str = Field(min_length=1, max_length=500)
    action_sequence: list[str] = Field(min_length=1, max_length=30)
    sound: str = Field(default="", max_length=1000)
    continuity_in: str = Field(min_length=1, max_length=1000)
    continuity_out: str = Field(min_length=1, max_length=1000)


class StoryboardShot(ShotContent):
    shot_id: str = Field(default_factory=lambda: f"shot.{uuid4()}", min_length=3, max_length=80)
    locked: bool = False
    dialogue: list[str] = Field(default_factory=list, max_length=60)
    prompt: str = Field(default="", max_length=20000)


class SceneDesign(Contract):
    purpose: str = Field(min_length=1, max_length=1000)
    reveal_order: str = Field(min_length=1, max_length=1000)
    spatial_layout: str = Field(min_length=1, max_length=1000)
    action_rhythm: str = Field(min_length=1, max_length=1000)
    transition: str = Field(min_length=1, max_length=500)


class SceneProposal(Contract):
    design: SceneDesign
    shots: list[ShotContent] = Field(min_length=1, max_length=60)
    unresolved_questions: list[str] = Field(default_factory=list, max_length=20)


class StoryboardScene(Contract):
    scene_number: int = Field(ge=1, le=50)
    source_revision: int = Field(default=1, ge=1)
    design: SceneDesign
    shots: list[StoryboardShot] = Field(min_length=1, max_length=100)
    unresolved_questions: list[str] = Field(default_factory=list, max_length=20)


class PreflightFinding(Contract):
    code: str
    severity: Literal["error", "warning", "info"]
    message: str
    scene_number: int | None = None


class PreproductionStoryboard(Contract):
    schema_version: Literal["preproduction_storyboard.v1"] = "preproduction_storyboard.v1"
    storyboard_id: str = Field(default_factory=lambda: f"storyboard.{uuid4()}", max_length=80)
    story_project_id: str = Field(min_length=3, max_length=120)
    episode_number: int = Field(ge=1, le=2000)
    revision: int = Field(default=1, ge=1)
    status: Literal["draft", "review", "source_changed"] = "draft"
    source_draft: dict[str, Any]
    source_signature: str
    visual_direction: str = Field(default="", max_length=4000)
    scenes: list[StoryboardScene] = Field(default_factory=list, max_length=50)
    candidate: StoryboardScene | None = None
    stale_scene_numbers: list[int] = Field(default_factory=list)
    findings: list[PreflightFinding] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StoryboardStartRequest(Contract):
    source_draft: dict[str, Any]
    expected_revision: int = Field(default=0, ge=0)


class StoryboardEditRequest(Contract):
    expected_revision: int = Field(ge=1)
    visual_direction: str = Field(default="", max_length=4000)
    scenes: list[StoryboardScene] = Field(max_length=50)
    candidate_action: Literal["keep", "accept", "reject"] = "keep"


class StoryboardGenerateRequest(Contract):
    expected_revision: int = Field(ge=1)
    instruction: str = Field(default="", max_length=4000)


class StoryboardResponse(Contract):
    data: PreproductionStoryboard
