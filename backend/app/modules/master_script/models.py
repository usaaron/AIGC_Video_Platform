from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

if TYPE_CHECKING:
    from app.modules.script_engine.models import ScriptGenerationDraftRun, ScriptRevisionRun


class ScriptTone(str, Enum):
    intense = "intense"
    melodramatic = "melodramatic"
    suspenseful = "suspenseful"
    emotional = "emotional"


class DialogueLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_name: str = Field(min_length=2, max_length=80)
    intent: str = Field(min_length=3, max_length=120)
    text: str = Field(min_length=3, max_length=280)


class CharacterProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=80)
    role: str = Field(min_length=2, max_length=80)
    description: str = Field(min_length=10, max_length=300)
    motivation: str = Field(min_length=5, max_length=200)


class SceneCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=50)
    slug: str = Field(min_length=3, max_length=120)
    purpose: str = Field(min_length=5, max_length=240)
    setting: str = Field(min_length=3, max_length=120)
    beat_summary: str = Field(min_length=5, max_length=300)
    emotional_shift: str = Field(min_length=3, max_length=120)
    emotional_objective: str | None = Field(default=None, min_length=3, max_length=160)
    character_actions: list[str] = Field(default_factory=list, max_length=10)
    turning_point: str | None = Field(default=None, min_length=3, max_length=240)
    cliffhanger: bool = False
    dialogues: list[DialogueLine] = Field(min_length=1, max_length=20)


class DraftSceneCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=50)
    slug: str = Field(min_length=3, max_length=120)
    purpose: str = Field(min_length=5, max_length=240)
    setting_hint: str = Field(min_length=3, max_length=120)
    beat_summary: str = Field(min_length=5, max_length=300)
    emotional_shift: str = Field(min_length=3, max_length=120)
    emotional_objective: str | None = Field(default=None, min_length=3, max_length=160)
    character_actions: list[str] = Field(default_factory=list, max_length=10)
    turning_point: str | None = Field(default=None, min_length=3, max_length=240)
    cliffhanger: bool = False
    dialogue_prompts: list[str] = Field(default_factory=list, max_length=10)
    dialogues: list[DialogueLine] = Field(default_factory=list, max_length=20)
    supporting_asset_ids: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("dialogue_prompts", "supporting_asset_ids", "character_actions")
    @classmethod
    def ensure_unique_string_values(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


class MasterScriptBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_spec_id: str = Field(min_length=3, max_length=80)
    title: str = Field(min_length=3, max_length=120)
    logline: str | None = Field(default=None, min_length=10, max_length=240)
    language: str = Field(min_length=2, max_length=20)
    target_audience: str | None = Field(default=None, min_length=3, max_length=200)
    target_platform: str | None = Field(default=None, min_length=2, max_length=80)
    tone: ScriptTone
    hook: str = Field(min_length=5, max_length=240)
    synopsis: str = Field(min_length=10, max_length=500)
    episode_goal: str = Field(min_length=5, max_length=240)
    target_duration_seconds: int = Field(ge=5, le=600)
    characters: list[CharacterProfile] = Field(default_factory=list, max_length=20)
    scenes: list[SceneCard] = Field(min_length=1, max_length=20)
    next_episode_question: str | None = Field(default=None, min_length=5, max_length=240)
    qa_notes: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("qa_notes")
    @classmethod
    def ensure_unique_qa_notes(cls, notes: list[str]) -> list[str]:
        normalized = [note.strip().lower() for note in notes]
        if len(set(normalized)) != len(normalized):
            raise ValueError("QA notes must be unique.")
        return notes

    @field_validator("scenes")
    @classmethod
    def ensure_unique_scene_numbers(cls, scenes: list[SceneCard]) -> list[SceneCard]:
        numbers = [scene.scene_number for scene in scenes]
        if len(set(numbers)) != len(numbers):
            raise ValueError("Scene numbers must be unique.")
        return scenes

    @model_validator(mode="after")
    def ensure_final_scene_has_cliffhanger(self) -> "MasterScriptBase":
        if not self.scenes[-1].cliffhanger:
            raise ValueError("The final scene must end with a cliffhanger in MVP mode.")
        return self


class DraftMasterScriptBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_spec_id: str = Field(min_length=3, max_length=80)
    generation_strategy_id: str = Field(min_length=3, max_length=120)
    title: str = Field(min_length=3, max_length=120)
    logline: str | None = Field(default=None, min_length=10, max_length=240)
    language: str = Field(min_length=2, max_length=20)
    target_audience: str | None = Field(default=None, min_length=3, max_length=200)
    target_platform: str | None = Field(default=None, min_length=2, max_length=80)
    tone: ScriptTone
    hook: str = Field(min_length=5, max_length=240)
    synopsis: str = Field(min_length=10, max_length=500)
    episode_goal: str = Field(min_length=5, max_length=240)
    target_duration_seconds: int = Field(ge=5, le=600)
    characters: list[CharacterProfile] = Field(default_factory=list, max_length=20)
    scenes: list[DraftSceneCard] = Field(min_length=1, max_length=20)
    next_episode_question: str | None = Field(default=None, min_length=5, max_length=240)
    qa_notes: list[str] = Field(default_factory=list, max_length=10)
    llm_metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("qa_notes")
    @classmethod
    def ensure_unique_draft_qa_notes(cls, notes: list[str]) -> list[str]:
        normalized = [note.strip().lower() for note in notes]
        if len(set(normalized)) != len(normalized):
            raise ValueError("QA notes must be unique.")
        return notes

    @field_validator("scenes")
    @classmethod
    def ensure_unique_draft_scene_numbers(
        cls, scenes: list[DraftSceneCard]
    ) -> list[DraftSceneCard]:
        numbers = [scene.scene_number for scene in scenes]
        if len(set(numbers)) != len(numbers):
            raise ValueError("Scene numbers must be unique.")
        return scenes

    @model_validator(mode="after")
    def ensure_final_draft_scene_has_cliffhanger(self) -> "DraftMasterScriptBase":
        if not self.scenes[-1].cliffhanger:
            raise ValueError("The final draft scene must end with a cliffhanger in MVP mode.")
        return self


class DraftMasterScript(DraftMasterScriptBase):
    id: str = Field(default_factory=lambda: str(uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DraftMasterScriptCreate(DraftMasterScriptBase):
    pass


class MasterScriptCreate(MasterScriptBase):
    pass


class MasterScript(MasterScriptBase):
    id: str = Field(default_factory=lambda: str(uuid4()))
    version: str = Field(min_length=1, max_length=80)
    lineage: "FinalMasterScriptLineage"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MasterScriptResponse(BaseModel):
    data: MasterScript


class MasterScriptListResponse(BaseModel):
    data: list[MasterScript]


class FinalMasterScriptLineage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_spec_id: str = Field(min_length=3, max_length=120)
    platform_profile_id: str = Field(min_length=3, max_length=120)
    generation_strategy_id: str = Field(min_length=3, max_length=120)
    generation_strategy_version: str = Field(min_length=1, max_length=80)
    selected_prompt_ids: list[str] = Field(min_length=1, max_length=20)
    selected_prompt_versions: list[str] = Field(default_factory=list, max_length=20)
    prompt_builder_version: str = Field(min_length=1, max_length=80)
    llm_provider: str = Field(min_length=2, max_length=80)
    llm_model_name: str = Field(min_length=2, max_length=120)
    original_draft_master_script_id: str = Field(min_length=3, max_length=120)
    original_story_qc_score: float = Field(ge=0.0, le=1.0)
    original_story_qc_status: str = Field(min_length=3, max_length=80)
    revision_plan_created_at: datetime
    revision_action_ids: list[str] = Field(default_factory=list, max_length=20)
    revised_draft_master_script_id: str = Field(min_length=3, max_length=120)
    re_qc_score: float = Field(ge=0.0, le=1.0)
    re_qc_status: str = Field(min_length=3, max_length=80)
    minimum_re_qc_score_required: float = Field(ge=0.0, le=1.0)
    dialogue_line_count_per_scene: int = Field(ge=1, le=6)
    speaker_name_cycle: list[str] = Field(min_length=1, max_length=6)
    finalization_policy_id: str = Field(min_length=3, max_length=120)
    finalization_version: str = Field(min_length=3, max_length=120)
    draft_generated_at: datetime
    revision_generated_at: datetime
    finalized_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator(
        "selected_prompt_ids",
        "selected_prompt_versions",
        "revision_action_ids",
        "speaker_name_cycle",
    )
    @classmethod
    def ensure_unique_lineage_lists(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("List values must be unique.")
        return values


class LLMGeneratedSceneCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1, le=50)
    slug: str = Field(min_length=3, max_length=120)
    purpose: str = Field(min_length=5, max_length=240)
    setting: str = Field(min_length=3, max_length=120)
    beat_summary: str = Field(min_length=5, max_length=300)
    emotional_shift: str = Field(min_length=3, max_length=120)
    emotional_objective: str = Field(min_length=3, max_length=160)
    character_actions: list[str] = Field(min_length=1, max_length=10)
    turning_point: str = Field(min_length=3, max_length=240)
    cliffhanger: bool = False
    dialogues: list[DialogueLine] = Field(min_length=1, max_length=20)


class LLMGeneratedDraftMasterScript(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=3, max_length=120)
    logline: str = Field(min_length=10, max_length=240)
    synopsis: str = Field(min_length=10, max_length=500)
    hook: str = Field(min_length=5, max_length=240)
    target_audience: str = Field(min_length=3, max_length=200)
    target_platform: str = Field(min_length=2, max_length=80)
    language: str = Field(min_length=2, max_length=20)
    tone: ScriptTone
    episode_goal: str = Field(min_length=5, max_length=240)
    target_duration_seconds: int = Field(ge=5, le=600)
    characters: list[CharacterProfile] = Field(min_length=1, max_length=20)
    scenes: list[LLMGeneratedSceneCard] = Field(min_length=1, max_length=20)
    next_episode_question: str = Field(min_length=5, max_length=240)


class MasterScriptFinalizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    script_generation_draft_run: "ScriptGenerationDraftRun"
    script_revision_run: "ScriptRevisionRun"
    dialogue_line_count_per_scene: int = Field(ge=1, le=6)
    speaker_name_cycle: list[str] = Field(min_length=1, max_length=6)
    minimum_re_qc_score_override: float | None = Field(default=None, ge=0.0, le=1.0)

    @field_validator("speaker_name_cycle")
    @classmethod
    def ensure_unique_speaker_names(cls, speaker_names: list[str]) -> list[str]:
        normalized = [speaker_name.strip().lower() for speaker_name in speaker_names]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Speaker names must be unique.")
        return speaker_names


class MasterScriptFinalizationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    master_script: MasterScript
    source_draft_id: str = Field(min_length=3, max_length=120)
    mapping_notes: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("mapping_notes")
    @classmethod
    def ensure_unique_mapping_notes(cls, notes: list[str]) -> list[str]:
        normalized = [note.strip().lower() for note in notes]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Mapping notes must be unique.")
        return notes


class MasterScriptFinalizationResponse(BaseModel):
    data: MasterScriptFinalizationResult


class ErrorResponse(BaseModel):
    detail: str


from app.modules.script_engine.models import ScriptGenerationDraftRun, ScriptRevisionRun

MasterScriptFinalizeRequest.model_rebuild(
    _types_namespace={
        "ScriptGenerationDraftRun": ScriptGenerationDraftRun,
        "ScriptRevisionRun": ScriptRevisionRun,
    }
)
MasterScript.model_rebuild()
