from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProfileRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(
        min_length=3,
        max_length=80,
        pattern=r"^[a-z0-9_]+$",
    )
    title: str = Field(min_length=3, max_length=120)
    summary: str = Field(min_length=5, max_length=300)


class PublishingStrategy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recommended_posts_per_day: int = Field(ge=1, le=20)
    preferred_time_windows: list[str] = Field(min_length=1, max_length=8)
    notes: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("preferred_time_windows")
    @classmethod
    def ensure_unique_time_windows(cls, windows: list[str]) -> list[str]:
        normalized = [window.strip() for window in windows]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Preferred time windows must be unique.")
        return normalized


class PlatformProfileBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(
        min_length=3,
        max_length=80,
        pattern=r"^[a-z0-9_]+$",
        description="Stable platform profile key such as tiktok_v1.",
    )
    platform_name: str = Field(min_length=2, max_length=80)
    version: str = Field(min_length=2, max_length=40)
    content_mode: str = Field(
        min_length=3,
        max_length=80,
        description="Generic content mode such as short_video or webtoon.",
    )
    primary_regions: list[str] = Field(default_factory=list, max_length=20)
    supported_aspect_ratios: list[str] = Field(min_length=1, max_length=10)
    recommendation_rules: list[ProfileRule] = Field(min_length=1, max_length=20)
    creator_rewards: list[ProfileRule] = Field(min_length=1, max_length=20)
    ai_policies: list[ProfileRule] = Field(min_length=1, max_length=20)
    community_guidelines: list[ProfileRule] = Field(min_length=1, max_length=20)
    best_practices: list[ProfileRule] = Field(min_length=1, max_length=20)
    publishing_strategy: PublishingStrategy
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator(
        "supported_aspect_ratios",
        "primary_regions",
        mode="after",
    )
    @classmethod
    def ensure_unique_string_lists(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List items must be unique.")
        return normalized

    @field_validator(
        "recommendation_rules",
        "creator_rewards",
        "ai_policies",
        "community_guidelines",
        "best_practices",
    )
    @classmethod
    def ensure_unique_rule_codes(cls, rules: list[ProfileRule]) -> list[ProfileRule]:
        codes = [rule.code for rule in rules]
        if len(set(codes)) != len(codes):
            raise ValueError("Rule codes must be unique within the same section.")
        return rules


class PlatformProfileCreate(PlatformProfileBase):
    pass


class PlatformProfile(PlatformProfileBase):
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )


class PlatformProfileResponse(BaseModel):
    data: PlatformProfile


class PlatformProfileListResponse(BaseModel):
    data: list[PlatformProfile]


class ErrorResponse(BaseModel):
    detail: str
