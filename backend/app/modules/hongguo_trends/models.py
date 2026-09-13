from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


HongguoFormat = Literal["real", "comic", "ai"]


class HongguoCategory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=20)
    tag_id: str | None = None


class HongguoSampleWork(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=240)
    url: str
    rank: int = Field(ge=1)
    cover_url: str | None = None


class HongguoTagRecommendation(HongguoCategory):
    raw_labels: list[str] = Field(min_length=1)
    rank: int = Field(ge=1, description="Derived tag recommendation order, not an official tag rank.")
    ranked_work_count: int = Field(ge=1)
    weighted_score: float = Field(ge=0)
    sample_works: list[HongguoSampleWork] = Field(default_factory=list, max_length=3)


class HongguoFeedState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=3, max_length=120)
    format: HongguoFormat
    source_url: str
    source_updated_label: str | None = None
    fetched_at: AwareDatetime | None = None
    status: Literal["fresh", "stale", "unavailable"]
    stale: bool = False
    last_attempt_at: AwareDatetime
    last_attempt_status: Literal["succeeded", "failed"]
    next_retry_at: AwareDatetime | None = None
    next_refresh_at: AwareDatetime


class HongguoTrendsData(HongguoFeedState):
    sample_work_count: int = Field(default=0, ge=0)
    pages_fetched: int = Field(default=0, ge=0, le=5)
    recommendations: list[HongguoTagRecommendation] = Field(default_factory=list)


class HongguoCategoriesData(HongguoFeedState):
    categories: list[HongguoCategory] = Field(default_factory=list)


class HongguoTrendsSnapshot(HongguoTrendsData):
    """One bounded cache document per feed kind and format, including failed attempts."""

    taxonomy_revision: int = Field(default=0, ge=0)
    categories: list[HongguoCategory] = Field(default_factory=list)


class HongguoTrendsResponse(BaseModel):
    data: HongguoTrendsData


class HongguoCategoriesResponse(BaseModel):
    data: HongguoCategoriesData
