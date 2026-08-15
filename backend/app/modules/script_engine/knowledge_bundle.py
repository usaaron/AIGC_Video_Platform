from __future__ import annotations

import json
from pathlib import Path
from typing import TypeVar

from app.modules.content_spec.models import ContentSpec
from app.modules.script_engine.models import (
    KnowledgeBundle,
    KnowledgeSelectionTrace,
    KnowledgeTargetStage,
    StaticKnowledgeItem,
)


_CatalogItem = TypeVar("_CatalogItem", StaticKnowledgeItem, KnowledgeBundle)


class InvalidKnowledgeBundleError(ValueError):
    """Raised when a requested static bundle cannot be safely selected."""


class InvalidStaticKnowledgeCatalogError(ValueError):
    """Raised when the governed static catalog is internally inconsistent."""


class StaticKnowledgeBundleCatalog:
    """Exact-ID catalog for bounded, source-grounded creative knowledge."""

    def __init__(
        self,
        *,
        items: list[StaticKnowledgeItem],
        bundles: list[KnowledgeBundle],
        catalog_version: str = "static_knowledge_catalog.v1",
    ) -> None:
        self.catalog_version = catalog_version
        self._items = self._index_unique(
            items,
            key_name="knowledge_id",
            error_label="knowledge item",
        )
        self._bundles = self._index_unique(
            bundles,
            key_name="bundle_id",
            error_label="knowledge bundle",
        )
        for bundle in bundles:
            missing_ids = [
                knowledge_id
                for knowledge_id in bundle.knowledge_ids
                if knowledge_id not in self._items
            ]
            if missing_ids:
                raise InvalidStaticKnowledgeCatalogError(
                    f"KnowledgeBundle '{bundle.bundle_id}' references unknown knowledge "
                    f"IDs: {', '.join(missing_ids)}."
                )

    @classmethod
    def load_default(cls) -> "StaticKnowledgeBundleCatalog":
        catalog_path = Path(__file__).with_name("static_knowledge_catalog.v1.json")
        payload = json.loads(catalog_path.read_text(encoding="utf-8"))
        return cls(
            catalog_version=payload["catalog_version"],
            items=[StaticKnowledgeItem.model_validate(item) for item in payload["items"]],
            bundles=[KnowledgeBundle.model_validate(bundle) for bundle in payload["bundles"]],
        )

    def select_for_draft(
        self,
        *,
        requested_bundle_id: str,
        content_spec: ContentSpec,
        target_platform: str,
        preferred_categories: list[str] | None = None,
        max_items: int | None = None,
        excluded_knowledge_ids: set[str] | None = None,
    ) -> tuple[KnowledgeBundle, list[StaticKnowledgeItem], KnowledgeSelectionTrace]:
        return self._select(
            requested_bundle_id=requested_bundle_id,
            content_spec=content_spec,
            target_platform=target_platform,
            target_stage=KnowledgeTargetStage.draft_generation,
            preferred_categories=preferred_categories,
            max_items=max_items,
            excluded_knowledge_ids=excluded_knowledge_ids,
        )

    def select_for_deepening(
        self,
        *,
        requested_bundle_id: str,
        content_spec: ContentSpec,
        target_platform: str,
    ) -> tuple[KnowledgeBundle, list[StaticKnowledgeItem], KnowledgeSelectionTrace]:
        return self._select(
            requested_bundle_id=requested_bundle_id,
            content_spec=content_spec,
            target_platform=target_platform,
            target_stage=KnowledgeTargetStage.creative_deepening,
        )

    def _select(
        self,
        *,
        requested_bundle_id: str,
        content_spec: ContentSpec,
        target_platform: str,
        target_stage: KnowledgeTargetStage,
        preferred_categories: list[str] | None = None,
        max_items: int | None = None,
        excluded_knowledge_ids: set[str] | None = None,
    ) -> tuple[KnowledgeBundle, list[StaticKnowledgeItem], KnowledgeSelectionTrace]:
        bundle = self._bundles.get(requested_bundle_id)
        if bundle is None:
            raise InvalidKnowledgeBundleError(
                f"KnowledgeBundle '{requested_bundle_id}' is not present in the static catalog."
            )
        if bundle.target_stage != target_stage:
            raise InvalidKnowledgeBundleError(
                f"KnowledgeBundle '{requested_bundle_id}' cannot be used for "
                f"{target_stage.value}."
            )

        mismatch_reasons = self._find_condition_mismatches(
            bundle=bundle,
            content_spec=content_spec,
            target_platform=target_platform,
        )
        if mismatch_reasons:
            raise InvalidKnowledgeBundleError(
                f"KnowledgeBundle '{requested_bundle_id}' is not applicable: "
                + "; ".join(mismatch_reasons)
            )

        selected_items = [self._items[item_id] for item_id in bundle.knowledge_ids]
        if excluded_knowledge_ids:
            selected_items = [
                item
                for item in selected_items
                if item.knowledge_id not in excluded_knowledge_ids
            ]
        if preferred_categories:
            category_order = {
                category.casefold(): index
                for index, category in enumerate(preferred_categories)
            }
            original_order = {
                knowledge_id: index
                for index, knowledge_id in enumerate(bundle.knowledge_ids)
            }
            selected_items.sort(key=lambda item: (
                category_order.get(item.category.casefold(), len(category_order)),
                original_order[item.knowledge_id],
            ))
        if max_items is not None:
            if max_items < 1:
                raise InvalidKnowledgeBundleError("Knowledge selection max_items must be positive.")
            selected_items = selected_items[:max_items]
        selected_refs = [item.knowledge_id for item in selected_items]
        trace = KnowledgeSelectionTrace(
            selector_version=self.catalog_version,
            target_stage=target_stage,
            requested_bundle_id=requested_bundle_id,
            selected_bundle_id=bundle.bundle_id,
            selected_knowledge_refs=selected_refs,
            selection_reason=(
                "The exact GenerationStrategy bundle matched its target stage, "
                "ContentSpec tags, and target platform; task categories were "
                "prioritized within the governed bundle."
                if preferred_categories or max_items is not None or excluded_knowledge_ids
                else "The exact GenerationStrategy bundle matched its target stage, "
                "ContentSpec tags, and target platform."
            ),
        )
        return bundle, selected_items, trace

    def _find_condition_mismatches(
        self,
        *,
        bundle: KnowledgeBundle,
        content_spec: ContentSpec,
        target_platform: str,
    ) -> list[str]:
        conditions = bundle.applicable_conditions
        tag_ids = {tag.ontology_node_id.casefold() for tag in content_spec.tags}
        tag_labels = {tag.label.casefold() for tag in content_spec.tags}
        mismatches: list[str] = []

        if conditions.any_tag_ids and tag_ids.isdisjoint(
            tag_id.casefold() for tag_id in conditions.any_tag_ids
        ):
            mismatches.append("no required tag ID matched")
        if conditions.any_tag_labels and tag_labels.isdisjoint(
            label.casefold() for label in conditions.any_tag_labels
        ):
            mismatches.append("no required tag label matched")
        if conditions.target_platforms and target_platform.casefold() not in {
            platform.casefold() for platform in conditions.target_platforms
        }:
            mismatches.append("target platform did not match")
        profile_id = content_spec.platform_goal.platform_profile_id.casefold()
        if conditions.platform_profile_ids and profile_id not in {
            value.casefold() for value in conditions.platform_profile_ids
        }:
            mismatches.append("platform profile did not match")
        return mismatches

    def _index_unique(
        self,
        values: list[_CatalogItem],
        *,
        key_name: str,
        error_label: str,
    ) -> dict[str, _CatalogItem]:
        indexed: dict[str, _CatalogItem] = {}
        for value in values:
            key = getattr(value, key_name)
            if key in indexed:
                raise InvalidStaticKnowledgeCatalogError(
                    f"Duplicate {error_label} ID '{key}'."
                )
            indexed[key] = value
        return indexed
