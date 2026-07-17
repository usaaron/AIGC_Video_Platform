from __future__ import annotations

from app.modules.asset.models import Asset
from app.modules.asset.repository import AssetRepository
from app.modules.orchestrator.models import AssetRequest
from app.modules.orchestrator.repository import OrchestrationPlanRepository
from app.modules.retrieval.models import (
    RetrievalCandidate,
    RetrievalPlanResult,
    RetrievalResolvedRequest,
    RetrievalResolveRequest,
    RetrievalStatus,
)


class MissingOrchestrationPlanError(ValueError):
    """Raised when a referenced orchestration plan does not exist."""


class RetrievalService:
    def __init__(
        self,
        asset_repository: AssetRepository,
        orchestration_plan_repository: OrchestrationPlanRepository,
    ) -> None:
        self._asset_repository = asset_repository
        self._orchestration_plan_repository = orchestration_plan_repository

    def resolve(self, payload: RetrievalResolveRequest) -> RetrievalPlanResult:
        plan = self._orchestration_plan_repository.get(payload.plan_id)
        if plan is None:
            raise MissingOrchestrationPlanError(
                f"OrchestrationPlan '{payload.plan_id}' was not found."
            )

        resolved_requests: list[RetrievalResolvedRequest] = []
        unresolved_request_ids: list[str] = []
        for asset_request in plan.asset_requests:
            candidates = self._resolve_asset_request(
                asset_request=asset_request,
                platform_profile_id=plan.platform_profile_id,
            )
            if not candidates:
                unresolved_request_ids.append(asset_request.request_id)

            resolved_requests.append(
                RetrievalResolvedRequest(
                    request_id=asset_request.request_id,
                    asset_type=asset_request.asset_type,
                    reason=asset_request.reason,
                    required_tag_ids=asset_request.required_tag_ids,
                    optional_tag_ids=asset_request.optional_tag_ids,
                    candidates=candidates,
                )
            )

        status = (
            RetrievalStatus.resolved
            if not unresolved_request_ids
            else RetrievalStatus.partial
        )
        notes = [
            f"Resolved {len(resolved_requests) - len(unresolved_request_ids)} of {len(resolved_requests)} asset requests.",
            "Current retrieval uses deterministic rule-based matching on asset type and controlled tags.",
        ]
        return RetrievalPlanResult(
            plan_id=plan.id,
            content_spec_id=plan.content_spec_id,
            platform_profile_id=plan.platform_profile_id,
            status=status,
            resolved_requests=resolved_requests,
            unresolved_request_ids=unresolved_request_ids,
            notes=notes,
        )

    def _resolve_asset_request(
        self,
        asset_request: AssetRequest,
        platform_profile_id: str,
    ) -> list[RetrievalCandidate]:
        ranked_candidates: list[tuple[float, RetrievalCandidate]] = []
        for asset in self._asset_repository.list():
            candidate = self._match_asset(
                asset=asset,
                asset_request=asset_request,
                platform_profile_id=platform_profile_id,
            )
            if candidate is None:
                continue
            ranked_candidates.append((candidate.score, candidate))

        ranked_candidates.sort(
            key=lambda item: (-item[0], item[1].asset_id),
        )
        return [candidate for _, candidate in ranked_candidates[: asset_request.limit]]

    def _match_asset(
        self,
        asset: Asset,
        asset_request: AssetRequest,
        platform_profile_id: str,
    ) -> RetrievalCandidate | None:
        if not asset.is_active:
            return None
        if asset.asset_type.value != asset_request.asset_type:
            return None
        if asset.applicable_platform_profile_ids and platform_profile_id not in asset.applicable_platform_profile_ids:
            return None

        asset_tag_index = {tag.ontology_node_id: tag for tag in asset.tags}
        matched_required_tag_ids = [
            tag_id for tag_id in asset_request.required_tag_ids if tag_id in asset_tag_index
        ]
        if len(matched_required_tag_ids) != len(asset_request.required_tag_ids):
            return None

        matched_optional_tag_ids = [
            tag_id for tag_id in asset_request.optional_tag_ids if tag_id in asset_tag_index
        ]
        optional_ratio = (
            len(matched_optional_tag_ids) / len(asset_request.optional_tag_ids)
            if asset_request.optional_tag_ids
            else 1.0
        )
        confidence_values = [
            asset_tag_index[tag_id].confidence for tag_id in matched_required_tag_ids + matched_optional_tag_ids
        ]
        confidence_bonus = sum(confidence_values) / len(confidence_values) if confidence_values else 0.0
        score = min(0.65 + optional_ratio * 0.25 + confidence_bonus * 0.1, 1.0)

        rationale = [
            f"Matched all {len(matched_required_tag_ids)} required tags.",
        ]
        if matched_optional_tag_ids:
            rationale.append(
                f"Matched {len(matched_optional_tag_ids)} optional tags."
            )
        if asset.applicable_platform_profile_ids:
            rationale.append("Asset is explicitly scoped to the target platform profile.")

        return RetrievalCandidate(
            asset_id=asset.id,
            asset_type=asset.asset_type.value,
            title=asset.title,
            summary=asset.summary,
            matched_required_tag_ids=matched_required_tag_ids,
            matched_optional_tag_ids=matched_optional_tag_ids,
            score=round(score, 3),
            rationale=rationale,
        )
