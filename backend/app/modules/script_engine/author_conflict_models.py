from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


from app.script_delivery_contract import SCRIPT_MODIFICATION_INSTRUCTION_MAX_LENGTH

class AuthorConflictEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_ref: str = Field(min_length=3, max_length=240)
    established_fact: str = Field(min_length=3, max_length=700)
    requested_change: str = Field(min_length=3, max_length=700)
    impact: str = Field(min_length=3, max_length=700)


class AuthorConflictOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    option_id: str = Field(min_length=3, max_length=80, pattern=r"^[a-zA-Z0-9_.:-]+$")
    kind: Literal["bridge", "revise_upstream"]
    title: str = Field(min_length=3, max_length=100)
    plan: str = Field(min_length=3, max_length=2_000)
    impact: str = Field(min_length=3, max_length=700)


class AuthorConflictAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_goal: str = Field(min_length=3, max_length=500)
    rewrite_scope: Literal["preserve_unaffected_text", "reexecute_approved_plan"] = Field(
        default="preserve_unaffected_text",
        description=(
            "Use reexecute_approved_plan only when the author explicitly asks to discard the current "
            "episode body and rebuild it from the approved scene plan. Ordinary polishing, dialogue "
            "changes and local revisions preserve unaffected source text."
        ),
    )
    conflicts: list[AuthorConflictEvidence] = Field(default_factory=list, max_length=8)
    options: list[AuthorConflictOption] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def validate_options(self):
        if bool(self.conflicts) != bool(self.options):
            raise ValueError("Conflicts require actionable options; clear requests need none.")
        if len({item.option_id for item in self.options}) != len(self.options):
            raise ValueError("Conflict option IDs must be distinct.")
        return self


class AuthorConflictReview(AuthorConflictAssessment):
    review_id: str = Field(min_length=3, max_length=120)
    source_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    instruction: str = Field(min_length=3, max_length=SCRIPT_MODIFICATION_INSTRUCTION_MAX_LENGTH)
    source_story_bible_version: int | None = Field(default=None, ge=1)


class AuthorConflictResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    review: AuthorConflictReview
    option_id: str = Field(min_length=3, max_length=80)


class StoredAuthorConflictReview(BaseModel):
    id: str
    source_project_id: str | None = None
    review: AuthorConflictReview
