import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.episode_quality_review import (
    review_episode_dramatic_evidence,
)
from app.modules.master_script.models import DraftMasterScript
from tests.test_master_script_models import build_draft_payload


RHYTHM_CALIBRATION_FIXTURE = Path(__file__).parent / "fixtures" / (
    "episode_quality_review_calibration/rhythm_shapes.json"
)
RHYTHM_CALIBRATION_CASES = json.loads(RHYTHM_CALIBRATION_FIXTURE.read_text())


def _draft(
    *,
    action: str | None = None,
    actions: list[str] | None = None,
    outcome: str,
    dialogues: list[dict[str, str]] | None = None,
) -> DraftMasterScript:
    payload = build_draft_payload()
    payload["scenes"] = [
        {
            "scene_number": 1,
            "slug": "INT. ARCHIVE NIGHT",
            "purpose": "Secure the original ledger.",
            "setting_hint": "Archive room",
            "beat_summary": "The lead reaches the original ledger.",
            "emotional_shift": "doubt_to_commitment",
            "character_actions": actions or [action or "Nina opens the archive."],
            "dialogues": dialogues or [{
                "character_name": "Nina",
                "intent": "state a decision",
                "text": "I am taking it.",
            }],
            "scene_causality": {
                "goal": "Secure the original ledger.",
                "conflict": "The archive lock blocks Nina.",
                "outcome": outcome,
            },
            "cliffhanger": True,
        },
    ]
    return DraftMasterScript.model_validate(payload)


def _plan() -> SimpleNamespace:
    return SimpleNamespace(
        dramatic_units=[SimpleNamespace(
            trigger="The archive lock seals.",
            choice="Nina cuts the lock instead of leaving the witness behind.",
            visible_consequence="The lock opens, but the alarm exposes Nina's location.",
            change_type="cost",
            evidence_hint="the alarm exposes Nina's location",
        )],
        protagonist_cost="Nina loses anonymity.",
    )


def _split_count(total: int, buckets: int) -> list[int]:
    base, remainder = divmod(total, buckets)
    return [base + (index < remainder) for index in range(buckets)]


def _rhythm_calibration_draft(
    *,
    scene_count: int,
    dialogue_line_count: int,
    action_unit_count: int,
) -> DraftMasterScript:
    payload = build_draft_payload()
    dialogue_counts = _split_count(dialogue_line_count, scene_count)
    action_counts = _split_count(action_unit_count, scene_count)
    scenes: list[dict[str, object]] = []
    dialogue_index = 0
    action_index = 0
    for scene_number, (scene_dialogues, scene_actions) in enumerate(
        zip(dialogue_counts, action_counts),
        start=1,
    ):
        actions = [
            f"Nina把第{action_index + index}份证据放到灯下确认，门外传来脚步声。"
            for index in range(scene_actions)
        ]
        dialogues = [
            {
                "character_name": "Nina",
                "intent": "state a concrete change",
                "text": f"第{dialogue_index + index}项账页变了，先别出声，门外的人来了。",
            }
            for index in range(scene_dialogues)
        ]
        causality: dict[str, object] = {
            "goal": f"Nina must secure archive item {scene_number}.",
            "conflict": f"The archive blocks item {scene_number}.",
            "outcome": f"Nina exposes a new risk in item {scene_number}.",
        }
        if scene_number > 1:
            causality.update({
                "caused_by_scene_number": scene_number - 1,
                "causal_link": "The previous alarm forces Nina to change position.",
            })
        scenes.append({
            "scene_number": scene_number,
            "slug": f"INT. ARCHIVE {scene_number}",
            "purpose": f"Secure archive item {scene_number}.",
            "setting_hint": "Archive room",
            "beat_summary": f"Nina works through archive item {scene_number}.",
            "emotional_shift": "doubt_to_commitment",
            "character_actions": actions,
            "dialogues": dialogues,
            "scene_causality": causality,
            "cliffhanger": scene_number == scene_count,
        })
        dialogue_index += scene_dialogues
        action_index += scene_actions
    payload["scenes"] = scenes
    return DraftMasterScript.model_validate(payload)


def test_episode_quality_review_finds_a_candidate_without_calling_it_proof() -> None:
    report = review_episode_dramatic_evidence(
        _draft(
            actions=[
                "Nina cuts the lock instead of leaving the witness behind. "
                "The witness covers the corridor.",
                "The lock opens, but the alarm exposes Nina's location.",
                "Nina loses anonymity.",
            ],
            outcome="The lock opens, but the alarm exposes Nina's location.",
        ),
        _plan(),
    )

    assert report["status"] == "review_required"
    assert report["design_evidence_status"] == "review_signal_ready"
    assert report["candidate_unit_count"] == 1
    assert report["unit_reviews"][0]["candidate_scene_numbers"] == [1]
    assert report["unit_reviews"][0]["choice_evidence"][0]["kind"] == "action"
    assert report["unit_reviews"][0]["consequence_evidence"][0]["kind"] == "action"
    assert report["unit_reviews"][0][
        "has_distinct_choice_and_consequence_evidence"
    ] is True
    assert report["protagonist_cost_review"]["status"] == "candidate_found"
    assert report["unit_reviews"][0]["matching_is_semantic_proof"] is False
    assert report["segmented_change_review"]["segments"][0][
        "candidate_unit_indices"
    ] == [0]
    assert report["segmented_change_review"]["segments"][1][
        "candidate_unit_indices"
    ] == [0]


def test_episode_quality_review_requires_distinct_choice_and_consequence_entries() -> None:
    report = review_episode_dramatic_evidence(
        _draft(
            action=(
                "Nina cuts the lock instead of leaving the witness behind. "
                "The lock opens, but the alarm exposes Nina's location."
            ),
            outcome="The lock opens, but the alarm exposes Nina's location.",
        ),
        _plan(),
    )

    unit_review = report["unit_reviews"][0]
    assert unit_review["choice_evidence"]
    assert unit_review["consequence_evidence"]
    assert unit_review["has_distinct_choice_and_consequence_evidence"] is False
    assert unit_review["status"] == "review_required"


def test_episode_quality_review_requires_review_for_abstract_or_missing_evidence() -> None:
    report = review_episode_dramatic_evidence(
        _draft(
            action="Nina looks determined.",
            outcome="The episode progresses and escalates the pressure.",
        ),
        _plan(),
    )

    assert report["status"] == "review_required"
    assert report["review_required_unit_count"] == 1
    assert report["scene_reviews"][0]["has_visible_change_candidate"] is False


def test_episode_quality_review_does_not_count_planning_summary_as_body_evidence() -> None:
    draft = _draft(
        action="Nina looks at the locked archive.",
        outcome="The lock opens, but the alarm exposes Nina's location.",
    )
    draft = draft.model_copy(update={
        "scenes": [draft.scenes[0].model_copy(update={
            "beat_summary": (
                "Nina cuts the lock instead of leaving the witness behind. "
                "The lock opens, but the alarm exposes Nina's location."
            ),
        })],
    })

    report = review_episode_dramatic_evidence(draft, _plan())

    assert report["unit_reviews"][0]["candidate_scene_numbers"] == []
    assert report["unit_reviews"][0]["status"] == "review_required"


def test_general_review_still_runs_without_optional_design() -> None:
    report = review_episode_dramatic_evidence(
        _draft(action="Nina opens the archive door.", outcome="The witness escapes."),
        SimpleNamespace(dramatic_units=[], protagonist_cost=None),
    )

    assert report["status"] == "review_required"
    assert report["design_evidence_status"] == "not_applicable"
    assert "production_count_out_of_range" in report["review_reasons"]
    assert report["production_count_review"]["status"] == "warning"
    assert report["production_count_review"]["metrics"]["dialogue_line_count"] == 1
    assert report["dialogue_function_review"]["line_count"] == 1
    assert report["segmented_change_review"]["body_entry_count"] == 2


def test_production_count_review_accepts_existing_hard_ranges() -> None:
    report = review_episode_dramatic_evidence(
        _draft(
            actions=[
                f"林夏把第{index}页账本放到灯下，圈出变化的编号。"
                for index in range(15)
            ],
            dialogues=[
                {
                    "character_name": "林夏",
                    "intent": f"陈述第{index}处账目变化",
                    "text": f"第{index}份账页编号与封存记录完全对不上。",
                }
                for index in range(25)
            ],
            outcome="林夏公开了被替换的账页编号和封存记录。",
        ),
        SimpleNamespace(dramatic_units=[], protagonist_cost=None),
    )

    production_review = report["production_count_review"]
    assert production_review["status"] == "within_range"
    assert production_review["metrics"]["dialogue_line_count"] == 25
    assert production_review["metrics"]["observable_action_unit_count"] == 15
    assert 75 <= production_review["metrics"]["estimated_duration_seconds"] <= 115


@pytest.mark.parametrize(
    "case",
    RHYTHM_CALIBRATION_CASES,
    ids=lambda case: case["sample_id"],
)
def test_fixed_rhythm_samples_keep_hard_ranges_as_non_blocking_diagnostics(case) -> None:
    draft = _rhythm_calibration_draft(
        scene_count=case["scene_count"],
        dialogue_line_count=case["dialogue_line_count"],
        action_unit_count=case["action_unit_count"],
    )

    report = review_episode_dramatic_evidence(
        draft,
        SimpleNamespace(dramatic_units=[], protagonist_cost=None),
    )
    production_review = report["production_count_review"]

    assert production_review["status"] in {"within_range", "warning"}
    assert production_review["is_quality_gate"] is False
    assert production_review["metrics"] == {
        "scene_count": case["scene_count"],
        "dialogue_line_count": case["dialogue_line_count"],
        "observable_action_unit_count": case["action_unit_count"],
        "estimated_duration_seconds": case["expected_runtime_seconds"],
    }
    assert all(
        alert["metric"] == "estimated_duration_seconds"
        for alert in production_review["alerts"]
    )
    for target in case["soft_targets"].values():
        if target is not None:
            assert len(target) == 2
            assert target[0] <= target[1]


def test_dialogue_function_review_flags_four_consecutive_refusals() -> None:
    report = review_episode_dramatic_evidence(
        _draft(
            action="Nina keeps the archive key in her fist.",
            dialogues=[
                {
                    "character_name": "Nina",
                    "intent": "reject the demand",
                    "text": f"No, I will not hand over key {index}.",
                }
                for index in range(4)
            ],
            outcome="The witness takes the only exit while Nina keeps the key.",
        ),
        None,
    )

    dialogue_review = report["dialogue_function_review"]
    assert dialogue_review["status"] == "warning"
    assert "dialogue_function_warning" in report["review_reasons"]
    assert dialogue_review["repeated_runs"] == [{
        "category": "refusal",
        "start_sequence": 0,
        "end_sequence": 3,
        "line_count": 4,
        "scene_numbers": [1],
    }]
    assert dialogue_review["alerts"][0]["type"] == "repeated_function_run"


def test_dialogue_function_matching_uses_english_word_boundaries() -> None:
    report = review_episode_dramatic_evidence(
        _draft(
            action="Nina writes the archive code on the glass.",
            dialogues=[{
                "character_name": "Nina",
                "intent": "state known information",
                "text": "I know the archive code.",
            }],
            outcome="The witness copies the code before the glass is wiped clean.",
        ),
        None,
    )

    assert report["dialogue_function_review"]["lines"][0]["category"] == "other"


def test_persisted_evidence_details_are_bounded_without_losing_total() -> None:
    report = review_episode_dramatic_evidence(
        _draft(
            actions=[
                f"Nina loses anonymity when camera {index} broadcasts her face."
                for index in range(13)
            ],
            outcome="Every lobby screen now shows Nina's face beside her real name.",
        ),
        SimpleNamespace(
            dramatic_units=[],
            protagonist_cost="Nina loses anonymity.",
        ),
    )

    cost_review = report["protagonist_cost_review"]
    assert cost_review["evidence_total"] == 13
    assert len(cost_review["evidence"]) == 12
    assert cost_review["evidence_truncated"] is True


def test_generation_service_persists_review_signal_in_draft_metadata() -> None:
    draft = _draft(
        actions=[
            "Nina cuts the lock instead of leaving the witness behind. "
            "The witness covers the corridor.",
            "The lock opens, but the alarm exposes Nina's location.",
            "Nina loses anonymity.",
        ],
        outcome="The lock opens, but the alarm exposes Nina's location.",
    )

    reviewed = ScriptGenerationService._attach_episode_quality_review(  # noqa: SLF001
        draft,
        SimpleNamespace(approved_episode_plan=_plan()),
    )

    assert reviewed.llm_metadata["provider"] == "mock"
    assert reviewed.llm_metadata["episode_quality_review"]["schema_version"] == (
        "episode_quality_review.v1"
    )
    assert reviewed.llm_metadata["episode_quality_review"][
        "design_evidence_status"
    ] == "review_signal_ready"
