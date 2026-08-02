from __future__ import annotations

from app.modules.content_spec.models import ContentSpec
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.orchestrator.models import (
    AssetRequest,
    OrchestrationPlan,
    OrchestrationPlanCreate,
    OrchestrationStatus,
    SceneBlueprint,
    ScriptConstraint,
)
from app.modules.orchestrator.repository import OrchestrationPlanRepository
from app.modules.platform_profile.repository import PlatformProfileRepository


class MissingContentSpecError(ValueError):
    """Raised when a referenced content spec does not exist."""


class MissingPlatformProfileError(ValueError):
    """Raised when a content spec references a platform profile that does not exist."""


class OrchestratorService:
    def __init__(
        self,
        repository: OrchestrationPlanRepository,
        content_spec_repository: ContentSpecRepository,
        platform_profile_repository: PlatformProfileRepository,
    ) -> None:
        self._repository = repository
        self._content_spec_repository = content_spec_repository
        self._platform_profile_repository = platform_profile_repository

    def create(self, payload: OrchestrationPlanCreate) -> OrchestrationPlan:
        content_spec = self._content_spec_repository.get(payload.content_spec_id)
        if content_spec is None:
            raise MissingContentSpecError(
                f"ContentSpec '{payload.content_spec_id}' was not found."
            )

        platform_profile_id = content_spec.platform_goal.platform_profile_id
        platform_profile = self._platform_profile_repository.get(platform_profile_id)
        if platform_profile is None:
            raise MissingPlatformProfileError(
                f"PlatformProfile '{platform_profile_id}' was not found."
            )

        plan = OrchestrationPlan(
            content_spec_id=content_spec.id,
            platform_profile_id=platform_profile_id,
            title=content_spec.title,
            creative_hook=content_spec.creative_brief.hook,
            episode_goal=content_spec.story_goal,
            target_duration_seconds=content_spec.platform_goal.target_duration_seconds,
            desired_scene_count=payload.desired_scene_count,
            asset_requests=self._build_asset_requests(content_spec),
            script_constraints=self._build_script_constraints(content_spec, platform_profile),
            scene_blueprints=self._build_scene_blueprints(content_spec, payload.desired_scene_count),
            status=OrchestrationStatus.ready,
            blocking_issues=[],
        )
        return self._repository.save(plan)

    def get(self, plan_id: str) -> OrchestrationPlan | None:
        return self._repository.get(plan_id)

    def list(self) -> list[OrchestrationPlan]:
        return self._repository.list()

    def _build_asset_requests(self, content_spec: ContentSpec) -> list[AssetRequest]:
        primary_tag_ids = [tag.ontology_node_id for tag in content_spec.tags]
        asset_requests = [
            AssetRequest(
                request_id="characters_core",
                asset_type="character",
                reason="Retrieve reusable character assets aligned with primary story tags.",
                required_tag_ids=primary_tag_ids[:2],
                optional_tag_ids=[],
                limit=3,
            ),
            AssetRequest(
                request_id="scenes_supporting",
                asset_type="scene",
                reason="Retrieve environment assets that support the episode hook and pacing.",
                required_tag_ids=primary_tag_ids[:1],
                optional_tag_ids=primary_tag_ids[1:3],
                limit=3,
            ),
        ]
        return asset_requests

    def _build_script_constraints(
        self, content_spec: ContentSpec, platform_profile
    ) -> list[ScriptConstraint]:
        constraints = [
            ScriptConstraint(
                source="creative_brief",
                rule=f"Open with the hook: {content_spec.creative_brief.hook}",
                priority="high",
            ),
            ScriptConstraint(
                source="platform_goal",
                rule=(
                    f"Keep pacing aligned with a {content_spec.platform_goal.target_duration_seconds}"
                    " second short-form episode."
                ),
                priority="high",
            ),
            ScriptConstraint(
                source="platform_profile",
                rule=f"Respect platform best practice: {platform_profile.best_practices[0].summary}",
                priority="medium",
            ),
        ]
        return constraints

    def _build_scene_blueprints(
        self, content_spec: ContentSpec, desired_scene_count: int
    ) -> list[SceneBlueprint]:
        blueprints: list[SceneBlueprint] = []
        for index in range(1, desired_scene_count + 1):
            if index == 1:
                purpose = "Establish the hook and the public-facing conflict immediately."
                focus = "hook"
                emotion = content_spec.creative_brief.target_emotion
            elif index == desired_scene_count:
                purpose = "Escalate the conflict and land the cliffhanger ending."
                focus = "cliffhanger"
                emotion = "suspense"
            else:
                purpose = "Increase pressure on the protagonist and sharpen the episode goal."
                focus = "conflict"
                emotion = content_spec.creative_brief.target_emotion

            blueprints.append(
                SceneBlueprint(
                    scene_number=index,
                    purpose=purpose,
                    target_emotion=emotion,
                    recommended_focus=focus,
                )
            )
        return blueprints
