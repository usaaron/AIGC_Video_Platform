from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.story_qc import PlaceholderStoryQC


def build_strategy() -> dict:
    return {
        "id": "strategy.tiktok.master_script.v1",
        "name": "TikTok Master Script Strategy",
        "target_platform": "tiktok",
        "target_content_type": "ai_comic_drama",
        "applicable_tags": ["genre.romance"],
        "model_provider": "mock",
        "model_name": "mock-script-generator",
        "temperature": 0.7,
        "top_p": 0.9,
        "max_tokens": 4000,
        "workflow_steps": [
            {
                "step_order": 1,
                "name": "story_planning",
                "description": "Build the initial story plan.",
                "prompt_id": "prompt.story_planning.v1",
            }
        ],
        "prompt_ids": ["prompt.story_planning.v1"],
        "qc_enabled": True,
        "self_check_enabled": True,
        "human_review_required": False,
        "output_schema": {"type": "object", "properties": {"title": {"type": "string"}}},
        "version": "v1",
        "status": "active",
    }


def test_placeholder_story_qc_returns_report() -> None:
    qc = PlaceholderStoryQC()
    strategy = GenerationStrategy.model_validate(build_strategy())
    report = qc.evaluate(
        {
            "hook": "She married him before she learned his real name.",
            "next_episode_question": "What will she do with the secret she just exposed?",
            "scenes": [
                {
                    "scene_number": 1,
                    "purpose": "Reveal the contradiction at the altar.",
                    "beat_summary": "The bride sees proof and keeps walking.",
                    "emotional_shift": "shock_to_control",
                    "turning_point": "She decides not to run.",
                    "character_actions": [
                        "She keeps walking toward the altar.",
                        "She hides the evidence inside the bouquet.",
                    ],
                    "dialogues": [
                        {
                            "character_name": "Ava",
                            "intent": "Take control",
                            "text": "I came here for evidence, not vows.",
                        }
                    ],
                    "cliffhanger": False,
                },
                {
                    "scene_number": 2,
                    "purpose": "Expose the groom and seize the livestream.",
                    "beat_summary": "She refuses the vow and names the betrayal.",
                    "emotional_shift": "control_to_public_revenge",
                    "turning_point": "She publicly exposes the payment.",
                    "character_actions": [
                        "She refuses the officiant.",
                        "She activates the livestream.",
                    ],
                    "dialogues": [
                        {
                            "character_name": "Ava",
                            "intent": "Expose him",
                            "text": "No. I do not marry men who bury my sister.",
                        }
                    ],
                    "cliffhanger": False,
                },
                {
                    "scene_number": 3,
                    "purpose": "Escalate the trap into an unanswered threat.",
                    "beat_summary": "A missing sister interrupts the reveal.",
                    "emotional_shift": "revenge_to_suspense",
                    "turning_point": "The missing sister appears on the screen.",
                    "character_actions": [
                        "She turns the screen toward the guests.",
                        "She demands the truth on speaker.",
                    ],
                    "dialogues": [
                        {
                            "character_name": "Ava",
                            "intent": "Confront him",
                            "text": "Then tell me why my dead sister is calling right now.",
                        }
                    ],
                    "cliffhanger": True,
                },
            ],
        },
        strategy=strategy,
    )

    assert report.status.value == "placeholder"
    assert report.overall_score > 0.0
    assert len(report.checks) == 4
    assert report.rubric_overall_score is not None
    assert len(report.rubric_categories) >= 1
    assert report.report_version == "story_qc_report.v1"
    assert report.explainability_status == "partial"
    assert len(report.dimension_evaluations) == 5
    assert report.evidence_summary
    assert report.knowledge_refs == []

    hook_evaluation = next(
        item for item in report.dimension_evaluations if item.dimension.value == "hook_quality"
    )
    assert hook_evaluation.scene_refs == [1]
    assert hook_evaluation.evidence

    cliffhanger_evaluation = next(
        item
        for item in report.dimension_evaluations
        if item.dimension.value == "cliffhanger_strength"
    )
    assert cliffhanger_evaluation.scene_refs == [3]


def test_placeholder_story_qc_dimension_evaluations_expose_revision_signals() -> None:
    qc = PlaceholderStoryQC()
    strategy = GenerationStrategy.model_validate(build_strategy())
    report = qc.evaluate(
        {
            "hook": "She found his signature.",
            "scenes": [
                {
                    "scene_number": 1,
                    "purpose": "Start the ceremony.",
                    "beat_summary": "She notices the document.",
                    "emotional_shift": "shock",
                    "character_actions": ["She freezes."],
                    "cliffhanger": False,
                },
                {
                    "scene_number": 2,
                    "purpose": "Continue the ceremony.",
                    "beat_summary": "He smiles and says nothing.",
                    "emotional_shift": "shock",
                    "character_actions": ["He watches her."],
                    "cliffhanger": True,
                },
            ],
        },
        strategy=strategy,
    )

    dimensions_with_revision_signals = [
        item for item in report.dimension_evaluations if item.revision_signals
    ]

    assert dimensions_with_revision_signals
    assert any(item.scene_refs for item in report.dimension_evaluations)
    assert any(item.revision_signals for item in report.dimension_evaluations)


def test_story_qc_recognizes_visible_agency_and_unresolved_cliffhanger() -> None:
    qc = PlaceholderStoryQC()
    strategy = GenerationStrategy.model_validate(build_strategy())

    report = qc.evaluate(
        {
            "hook": "At the microphone, Mara learns her evidence may be planted.",
            "next_episode_question": "Will Mara expose the ally or reverse Adrian's trap?",
            "scenes": [
                {
                    "scene_number": 1,
                    "purpose": "Put the accusation under immediate pressure.",
                    "beat_summary": "Mara stops her upload and demands proof.",
                    "emotional_shift": "certainty_to_doubt",
                    "turning_point": "Mara stops her own upload.",
                    "character_actions": ["Mara demands proof before continuing."],
                    "scene_causality": {
                        "goal": "Mara intends to expose Adrian.",
                        "conflict": "Her evidence may implicate the wrong person.",
                        "outcome": "Mara stops the upload and forces Adrian to show proof.",
                    },
                    "cliffhanger": False,
                },
                {
                    "scene_number": 2,
                    "purpose": "Force a public moral choice.",
                    "beat_summary": "Mara takes the microphone before revealing her intent.",
                    "emotional_shift": "doubt_to_defiance",
                    "turning_point": "Mara takes control of the live microphone.",
                    "character_actions": ["Mara takes the microphone from Adrian."],
                    "scene_causality": {
                        "goal": "Mara wants the complete source trail.",
                        "conflict": "Adrian demands that she name an innocent ally.",
                        "outcome": "Mara begins speaking before her true choice is revealed.",
                    },
                    "cliffhanger": True,
                },
            ],
        },
        strategy=strategy,
    )

    dimensions = {item.dimension.value: item for item in report.dimension_evaluations}
    assert dimensions["character_agency"].score == 4.0
    assert dimensions["character_agency"].revision_signals == []
    assert dimensions["cliffhanger_strength"].score == 5.0
    assert dimensions["cliffhanger_strength"].revision_signals == []


def test_story_qc_recognizes_visible_chinese_character_agency() -> None:
    qc = PlaceholderStoryQC()
    strategy = GenerationStrategy.model_validate(build_strategy())

    report = qc.evaluate(
        {
            "language": "zh",
            "target_platform": "mainland_china",
            "hook": "林夏刚拿到证据，就发现出卖她的人站在会议室里。",
            "next_episode_question": "林夏公开证据后，幕后主使会怎样反击？",
            "target_duration_seconds": 75,
            "scenes": [{
                "scene_number": 1,
                "purpose": "林夏拒绝交出证据，并决定当众揭露交易。",
                "beat_summary": "林夏夺回证物，封住唯一出口。",
                "emotional_shift": "怀疑转为决绝",
                "turning_point": "林夏选择立即对峙。",
                "character_actions": [
                    "林夏抢下证物袋，反锁会议室大门，要求所有人留下。"
                ],
                "dialogues": [
                    {"character_name": "林夏", "text": "谁也别走。"},
                    {"character_name": "周岚", "text": "你没有资格命令我。"},
                ],
                "cliffhanger": True,
            }],
        },
        strategy=strategy,
    )

    category = next(
        item
        for item in report.rubric_categories
        if item.category_name == "Character Agency"
    )
    dimension = next(
        item
        for item in report.dimension_evaluations
        if item.dimension.value == "character_agency"
    )
    assert category.score == 4.0
    assert dimension.score == 4.0
    assert dimension.revision_signals == []
