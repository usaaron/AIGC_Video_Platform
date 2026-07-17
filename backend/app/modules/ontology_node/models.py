from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class OntologyCategory(str, Enum):
    genre = "Genre"
    theme = "Theme"
    emotion = "Emotion"
    relationship = "Relationship"
    conflict = "Conflict"
    character = "Character"
    world = "World"
    action = "Action"
    camera = "Camera"
    voice = "Voice"
    scene = "Scene"
    style = "Style"
    audience = "Audience"
    culture_cluster = "CultureCluster"
    platform = "Platform"
    monetization = "Monetization"
    pace = "Pace"
    hook = "Hook"
    twist = "Twist"
    cliffhanger = "Cliffhanger"


class OntologyNodeBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_]+\.[a-z0-9_]+$",
        description="Stable ontology node id such as genre.romance.",
    )
    label: str = Field(min_length=2, max_length=80)
    category: OntologyCategory
    description: str = Field(min_length=5, max_length=240)
    aliases: list[str] = Field(default_factory=list, max_length=10)
    is_active: bool = True

    @field_validator("aliases")
    @classmethod
    def ensure_unique_aliases(cls, aliases: list[str]) -> list[str]:
        normalized = [alias.strip().lower() for alias in aliases]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Aliases must be unique.")
        return aliases

    @model_validator(mode="after")
    def ensure_id_matches_category_prefix(self) -> "OntologyNodeBase":
        expected_prefix = f"{self.category.value.lower()}."
        if not self.id.startswith(expected_prefix):
            raise ValueError(
                f"Ontology node id '{self.id}' must start with '{expected_prefix}'."
            )
        return self


class OntologyNodeCreate(OntologyNodeBase):
    pass


class OntologyNode(OntologyNodeBase):
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class OntologyNodeResponse(BaseModel):
    data: OntologyNode


class OntologyNodeListResponse(BaseModel):
    data: list[OntologyNode]


class ErrorResponse(BaseModel):
    detail: str
