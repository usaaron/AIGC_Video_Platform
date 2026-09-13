"""Deterministic contracts for story-tree decomposition.

This module owns structural acceptance and budget normalization. It does not
choose narrative content, call a model, or persist planning artifacts.
"""

from __future__ import annotations

import logging
import re
from difflib import SequenceMatcher

from app.modules.script_engine.long_story_models import (
    MAX_EPISODE_READY_SPAN,
    MIN_EPISODE_READY_SPAN,
    StoryBible,
    StoryPlanNode,
    StoryPlanNodeChildOutput,
    StoryPlanNodeDecompositionOutput,
)
from app.modules.script_engine.planning_errors import StoryPlanningInputError


logger = logging.getLogger(__name__)
TECHNICAL_STORY_ROOT_MARKER = "system_story_bible_root.v1"

def story_plan_node_episode_span(node: StoryPlanNode) -> int:
        if node.planned_start_episode is None or node.planned_end_episode is None:
            raise StoryPlanningInputError(
                "A Story Plan Node needs a planned episode range."
            )
        return node.planned_end_episode - node.planned_start_episode + 1

def enforce_decomposition_episode_policy(
        output: StoryPlanNodeDecompositionOutput,
        *,
        parent: StoryPlanNode,
        max_episode_ready_span: int,
    ) -> StoryPlanNodeDecompositionOutput:
        """Normalize readiness only; narrative-aware repairs own boundary changes."""

        normalized_children: list[StoryPlanNodeChildOutput] = []
        previous_exit_state: str | None = None
        for index, child in enumerate(output.children):
            if (
                child.planned_start_episode is None
                or child.planned_end_episode is None
            ):
                normalized_children.append(child)
                continue
            span = child.planned_end_episode - child.planned_start_episode + 1
            update: dict[str, object] = {
                "estimated_episode_count": span,
                "recommended_next_step": (
                    "episode_ready"
                    if MIN_EPISODE_READY_SPAN <= span <= max_episode_ready_span
                    else "expand"
                ),
            }
            if index == 0:
                update["entry_state"] = parent.entry_state
            elif previous_exit_state is not None:
                update["entry_state"] = previous_exit_state
            if index == len(output.children) - 1:
                update["exit_state"] = parent.exit_state
            previous_exit_state = str(update.get("exit_state", child.exit_state))
            normalized_children.append(child.model_copy(update=update))
        return output.model_copy(update={"children": normalized_children})

def validate_decomposition_ranges(
        children: list[StoryPlanNodeChildOutput],
        *,
        parent: StoryPlanNode,
        max_episode_ready_span: int,
    ) -> None:
        if parent.planned_start_episode is None or parent.planned_end_episode is None:
            raise StoryPlanningInputError("A parent node needs a planned episode range before decomposition.")
        parent_span = parent.planned_end_episode - parent.planned_start_episode + 1
        if MIN_EPISODE_READY_SPAN <= parent_span <= max_episode_ready_span:
            raise StoryPlanningInputError(
                "A node inside the 8-12 episode leaf window must not be decomposed."
            )
        if parent_span < MIN_EPISODE_READY_SPAN or 13 <= parent_span <= 15:
            raise StoryPlanningInputError(
                "An undersized or 13-15 episode node must be coordinated at its parent."
            )
        expected_start = parent.planned_start_episode
        previous_child: StoryPlanNodeChildOutput | None = None
        for index, child in enumerate(children):
            if child.planned_start_episode is None or child.planned_end_episode is None:
                raise StoryPlanningInputError("Every child node needs a planned episode range.")
            if child.planned_start_episode != expected_start:
                raise StoryPlanningInputError("Child node ranges must be contiguous and ordered.")
            if child.planned_end_episode > parent.planned_end_episode:
                raise StoryPlanningInputError("Child node range exceeds its parent range.")
            child_span = child.planned_end_episode - child.planned_start_episode + 1
            valid_leaf = MIN_EPISODE_READY_SPAN <= child_span <= max_episode_ready_span
            valid_expandable = child_span >= 16
            if not valid_leaf and not valid_expandable:
                raise StoryPlanningInputError(
                    "Every child must either be an 8-12 episode leaf or cover at least "
                    "16 episodes so it can be decomposed again. Coordinate undersized "
                    "or 13-15 episode fragments with adjacent siblings at this parent."
                )
            required_next_step = (
                "episode_ready"
                if valid_leaf
                else "expand"
            )
            if child.recommended_next_step != required_next_step:
                raise StoryPlanningInputError(
                    "recommended_next_step must be episode_ready for an 8-12 episode "
                    "child and expand for a child covering at least 16 episodes."
                )
            if index == 0 and child.entry_state.strip() != parent.entry_state.strip():
                raise StoryPlanningInputError(
                    "The first child entry_state must copy the parent entry_state verbatim."
                )
            if (
                previous_child is not None
                and child.entry_state.strip() != previous_child.exit_state.strip()
            ):
                raise StoryPlanningInputError(
                    "Each child entry_state must copy the previous sibling exit_state "
                    "verbatim so the handoff cannot be deferred downstream."
                )
            expected_start = child.planned_end_episode + 1
            previous_child = child
        if expected_start != parent.planned_end_episode + 1:
            raise StoryPlanningInputError("Child node ranges must cover the parent range exactly.")
        if children[-1].exit_state.strip() != parent.exit_state.strip():
            raise StoryPlanningInputError(
                "The final child exit_state must copy the parent exit_state verbatim."
            )

def validate_decomposition_output(
        output: StoryPlanNodeDecompositionOutput,
        *,
        parent: StoryPlanNode,
        story_bible: StoryBible,
        requested_child_count: int | None,
        max_episode_ready_span: int,
    ) -> None:
        if (
            requested_child_count is not None
            and len(output.children) != requested_child_count
        ):
            raise StoryPlanningInputError(
                "The decomposition must return exactly the requested child count."
            )
        validate_decomposition_ranges(
            output.children,
            parent=parent,
            max_episode_ready_span=max_episode_ready_span,
        )

        if (
            getattr(parent, "decomposition_reason", None)
            != TECHNICAL_STORY_ROOT_MARKER
        ):
            child_turning_points = {
                turning_point.strip()
                for child in output.children
                for turning_point in child.turning_points
            }
            missing_turning_points = [
                turning_point
                for turning_point in parent.turning_points
                if turning_point.strip() not in child_turning_points
            ]
            if missing_turning_points:
                raise StoryPlanningInputError(
                    "Child nodes omitted approved parent turning points: "
                    + " | ".join(missing_turning_points)
                )

        allowed_character_refs = set(story_bible.character_refs)
        allowed_story_line_refs = {
            item.story_line_id for item in story_bible.story_lines
        }
        invalid_character_refs = sorted(
            {
                character_ref
                for child in output.children
                for character_ref in child.character_refs
                if character_ref not in allowed_character_refs
            }
        )
        invalid_story_line_refs = sorted(
            {
                story_line_ref
                for child in output.children
                for story_line_ref in child.story_line_refs
                if story_line_ref not in allowed_story_line_refs
            }
        )
        if invalid_character_refs or invalid_story_line_refs:
            details = []
            if invalid_character_refs:
                details.append("character_refs=" + ", ".join(invalid_character_refs))
            if invalid_story_line_refs:
                details.append("story_line_refs=" + ", ".join(invalid_story_line_refs))
            raise StoryPlanningInputError(
                "Decomposition returned references outside the approved Story Bible: "
                + "; ".join(details)
            )

        incomplete_unit_children = [
            str(index + 1)
            for index, child in enumerate(output.children)
            if (
                len(child.unit_story_beats) < 4
                or not child.unit_resolution
                or not child.handoff_pressure
            )
        ]
        if incomplete_unit_children:
            raise StoryPlanningInputError(
                "Every child must complete its unit-story contract with at least four "
                "causal unit_story_beats, unit_resolution and handoff_pressure; children="
                + ",".join(incomplete_unit_children)
            )

        validate_decomposition_distinctness(
            output.children,
            parent=parent,
        )
        validate_decomposition_allocation_quality(output.children)

def validate_decomposition_distinctness(
        children: list[StoryPlanNodeChildOutput],
        *,
        parent: StoryPlanNode,
    ) -> None:
        normalized_titles = [
            re.sub(r"\s+", "", child.title).casefold()
            for child in children
        ]
        if len(set(normalized_titles)) != len(normalized_titles):
            raise StoryPlanningInputError(
                "Sibling planning nodes must have distinct narrative titles."
            )

        parent_synopsis = re.sub(r"\s+", "", parent.synopsis).casefold()
        normalized_synopses = [
            re.sub(r"\s+", "", child.synopsis).casefold()
            for child in children
        ]
        for index, synopsis in enumerate(normalized_synopses):
            if SequenceMatcher(None, synopsis, parent_synopsis).ratio() >= 0.90:
                raise StoryPlanningInputError(
                    "A child synopsis repeats the parent instead of adding a distinct "
                    f"event chain (child {index + 1})."
                )
            for previous_index, previous in enumerate(normalized_synopses[:index]):
                if SequenceMatcher(None, synopsis, previous).ratio() >= 0.86:
                    raise StoryPlanningInputError(
                        "Sibling synopses are too similar to represent distinct story "
                        f"progression (children {previous_index + 1} and {index + 1})."
                    )

def validate_decomposition_allocation_quality(
        children: list[StoryPlanNodeChildOutput],
    ) -> None:
        if len(children) < 3:
            return
        spans = [
            child.planned_end_episode - child.planned_start_episode + 1
            for child in children
        ]
        if len(set(spans)) == 1:
            estimates = [child.estimated_script_body_characters for child in children]
            if len(set(estimate for estimate in estimates if estimate is not None)) == 1:
                logger.info(
                    "Accepted equal sibling allocations after distinctness validation "
                    "child_count=%d span=%d",
                    len(children),
                    spans[0],
                )

def allocate_child_body_estimates(
        children: list[StoryPlanNodeChildOutput],
        *,
        parent: StoryPlanNode,
    ) -> list[int | None]:
        parent_budget = parent.estimated_script_body_characters
        if parent_budget is None:
            return [child.estimated_script_body_characters for child in children]

        proposed = [child.estimated_script_body_characters for child in children]
        weights = (
            [int(estimate) for estimate in proposed if estimate is not None]
            if all(estimate is not None for estimate in proposed)
            else [
                child.planned_end_episode - child.planned_start_episode + 1
                for child in children
            ]
        )
        total_weight = sum(weights)
        estimates: list[int] = []
        allocated = 0
        for index, weight in enumerate(weights):
            if index == len(weights) - 1:
                estimate = parent_budget - allocated
            else:
                estimate = parent_budget * weight // total_weight
                allocated += estimate
            estimates.append(estimate)
        return estimates
