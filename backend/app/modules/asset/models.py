from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.content_spec.models import TagRef


class AssetType(str, Enum):
    story_structure = "story_structure"
    character = "character"
    world = "world"
    action = "action"
    voice = "voice"
    camera = "camera"
    scene = "scene"
    style = "style"
    platform_knowledge = "platform_knowledge"


class AssetContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=5, max_length=5000)
    payload: dict[str, Any] = Field(default_factory=dict)


class AssetBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
        description="Stable asset id such as scene.wedding_hall_v1.",
    )
    asset_type: AssetType
    title: str = Field(min_length=3, max_length=120)
    summary: str = Field(min_length=5, max_length=240)
    tags: list[TagRef] = Field(min_length=1, max_length=20)
    content: AssetContent
    applicable_platform_profile_ids: list[str] = Field(default_factory=list, max_length=10)
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True

    @field_validator("tags")
    @classmethod
    def ensure_unique_tags(cls, tags: list[TagRef]) -> list[TagRef]:
        seen = set()
        for tag in tags:
            key = (tag.category.lower(), tag.ontology_node_id.lower())
            if key in seen:
                raise ValueError(
                    f"Duplicate tag reference detected for '{tag.ontology_node_id}'."
                )
            seen.add(key)
        return tags

    @field_validator("applicable_platform_profile_ids")
    @classmethod
    def ensure_unique_platform_profiles(
        cls, applicable_platform_profile_ids: list[str]
    ) -> list[str]:
        normalized = [profile_id.strip().lower() for profile_id in applicable_platform_profile_ids]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Applicable platform profile ids must be unique.")
        return applicable_platform_profile_ids


class AssetCreate(AssetBase):
    pass


class Asset(AssetBase):
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AssetResponse(BaseModel):
    data: Asset


class AssetListResponse(BaseModel):
    data: list[Asset]


class ErrorResponse(BaseModel):
    detail: str
