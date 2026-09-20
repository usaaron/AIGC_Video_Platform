from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.long_story_models import EpisodePlanGenerationItem, StoryProjectWorkspaceSnapshot


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class QuickModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QuickSettings(QuickModel):
    language: Literal["zh"] = "zh"
    target_total_characters: int = Field(default=8_000, ge=1_000, le=10_000)
    episode_count: int = Field(default=8, ge=1, le=12)
    target_duration_seconds: int = Field(default=90, ge=75, le=115)
    storyline_count: int = Field(default=1, ge=1, le=2)


class QuickCharacter(QuickModel):
    character_ref: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=80)
    role: str = Field(default="主要人物", max_length=200)
    motivation: str = Field(default="", max_length=800)
    fixed_identity: str = Field(default="", max_length=800)
    abilities_and_limits: str = Field(default="", max_length=800)
    appearance: str = Field(default="", max_length=500)


class QuickPlanContent(QuickModel):
    title: str = Field(min_length=2, max_length=160)
    characters: list[QuickCharacter] = Field(min_length=1, max_length=6)
    fixed_facts: list[str] = Field(default_factory=list, max_length=24)
    relationships: list[str] = Field(default_factory=list, max_length=15)
    main_storyline: str = Field(min_length=5, max_length=1_000)
    subplot: str | None = Field(default=None, max_length=800)
    opening: str = Field(min_length=5, max_length=800)
    turning_points: list[str] = Field(min_length=1, max_length=6)
    ending: str = Field(min_length=5, max_length=800)
    episodes: list[EpisodePlanGenerationItem] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def unique_identifiers(self):
        for values, label in (([c.character_ref for c in self.characters], "人物ID"),
                              ([c.name for c in self.characters], "人物姓名")):
            if len(set(values)) != len(values):
                raise ValueError(f"{label}不能重复。")
        if [p.episode_number for p in self.episodes] != list(range(1, len(self.episodes) + 1)):
            raise ValueError("快速创作安排必须从第1集开始连续覆盖全部集数。")
        return self


class QuickPlan(QuickPlanContent):
    id: str = Field(default_factory=lambda: f"quick-plan-{uuid4()}")
    version: int = Field(default=1, ge=1)
    source_synopsis_hash: str
    content_hash: str


class QuickIssue(QuickModel):
    code: str = Field(min_length=1, max_length=100)
    severity: Literal["critical", "ambiguity", "warning"]
    message: str = Field(min_length=1, max_length=1_500)
    episode_number: int | None = Field(default=None, ge=1, le=12)
    scene_number: int | None = Field(default=None, ge=1)
    path: str | None = Field(default=None, max_length=200)
    evidence_quote: str = Field(default="", max_length=1_000)


class QuickFact(QuickModel):
    id: str = Field(min_length=1, max_length=160)
    kind: Literal["knowledge", "possession", "location", "relationship", "event", "obligation", "ability"]
    subject: str = Field(min_length=1, max_length=160)
    value: str = Field(min_length=1, max_length=1_000)
    certainty: Literal["established", "suspected", "unknown"]
    episode_number: int = Field(ge=1, le=12)
    scene_number: int = Field(ge=1)
    body_hash: str = Field(default="", max_length=64)
    evidence_quote: str = Field(min_length=1, max_length=1_000)


class QuickReview(QuickModel):
    status: Literal["passed", "blocked", "needs_author"]
    summary: str = Field(min_length=1, max_length=2_000)
    issues: list[QuickIssue] = Field(default_factory=list, max_length=40)
    accepted_facts: list[QuickFact] = Field(default_factory=list, max_length=100)
    source_body_hashes: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def cannot_pass_unresolved_issues(self):
        if any(i.severity == "critical" for i in self.issues):
            self.status = "blocked"
        elif any(i.severity == "ambiguity" for i in self.issues):
            self.status = "needs_author"
        if self.status != "passed":
            self.accepted_facts = []
        return self


class QuickModelCall(QuickModel):
    stage: str
    provider: str
    model: str
    response_model: str | None = None
    physical_requests: int = Field(default=1, ge=0)
    input_upper_bound_tokens: int = Field(ge=0)
    output_reserve_tokens: int = Field(ge=1)
    elapsed_ms: int = Field(ge=0)
    usage: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class QuickEpisode(QuickModel):
    episode_number: int = Field(ge=1, le=12)
    revision: int = Field(default=1, ge=1)
    status: Literal["drafted", "passed", "blocked", "stale"] = "drafted"
    draft: DraftMasterScript
    initial_draft: DraftMasterScript | None = None
    source_plan_hash: str
    source_episode_hashes: dict[str, str] = Field(default_factory=dict)
    body_hash: str
    review: QuickReview | None = None
    repair_count: int = Field(default=0, ge=0, le=1)
    repair_attempts: int = Field(default=0, ge=0, le=1)
    metrics: dict[str, Any] = Field(default_factory=dict)
    artifact_id: str | None = None
    history: list[dict[str, Any]] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=utc_now)


QuickPhase = Literal["setup", "synopsis", "plan", "writing", "review", "complete", "paused", "standard"]
QuickNextStep = Literal["synopsis", "plan", "draft", "review", "repair", "recheck", "final_review", "done"]


class QuickState(QuickModel):
    schema_version: Literal["quick_script.v1"] = "quick_script.v1"
    project_id: str
    revision: int = Field(default=0, ge=0)
    phase: QuickPhase = "setup"
    status: Literal["idle", "busy", "blocked", "stale", "completed"] = "idle"
    next_step: QuickNextStep = "synopsis"
    settings: QuickSettings = Field(default_factory=QuickSettings)
    idea: str = Field(default="", max_length=10_000)
    source_material: str = Field(default="", max_length=20_000)
    supplied_characters: list[QuickCharacter] = Field(default_factory=list, max_length=6)
    synopsis: str = Field(default="", max_length=8_000)
    synopsis_confirmed: bool = False
    synopsis_hash: str = ""
    plan: QuickPlan | None = None
    plan_confirmed: bool = False
    episodes: list[QuickEpisode] = Field(default_factory=list, max_length=12)
    facts: list[QuickFact] = Field(default_factory=list, max_length=200)
    final_review: QuickReview | None = None
    blocked_reason: str | None = None
    active_operation: dict[str, Any] | None = None
    operation_records: list[dict[str, Any]] = Field(default_factory=list)
    model_calls: list[QuickModelCall] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


QuickAction = Literal["setup", "draft_synopsis", "confirm_synopsis", "draft_plan", "confirm_plan",
                      "advance", "save_episode", "switch_standard", "resume"]


class QuickActionRequest(QuickModel):
    action: QuickAction
    operation_id: str = Field(min_length=8, max_length=160)
    expected_revision: int = Field(ge=0)
    payload: dict[str, Any] = Field(default_factory=dict)


class QuickResponseData(QuickModel):
    state: QuickState | None
    workspace_snapshot: StoryProjectWorkspaceSnapshot
    project_revision: int


class QuickResponse(QuickModel):
    data: QuickResponseData


class QuickSynopsisResult(QuickModel):
    synopsis: str
    call: QuickModelCall


class QuickPlanResult(QuickModel):
    plan: QuickPlan
    call: QuickModelCall


class QuickDraftResult(QuickModel):
    draft: DraftMasterScript
    body_hash: str
    source_plan_hash: str
    source_episode_hashes: dict[str, str]
    metrics: dict[str, Any]
    mechanical_issues: list[QuickIssue]
    call: QuickModelCall


class QuickReviewResult(QuickModel):
    review: QuickReview
    call: QuickModelCall
