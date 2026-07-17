from scripts.run_real_generation_validation import render_master_script_markdown


def build_master_script() -> dict:
    return {
        "title": "Wedding Trap",
        "logline": "A bride weaponizes her ceremony to expose a betrayal.",
        "synopsis": "A public wedding becomes a revenge ambush.",
        "hook": "This wedding is a sting.",
        "target_audience": "TikTok drama viewers",
        "target_platform": "TikTok",
        "language": "en",
        "episode_goal": "End on a marriage twist.",
        "characters": [
            {
                "name": "Maya Cross",
                "role": "Bride",
                "description": "A strategic bride with a revenge plan.",
                "motivation": "Expose the family that destroyed her mother.",
            }
        ],
        "scenes": [
            {
                "scene_number": 1,
                "slug": "Scene 1 - Hook",
                "purpose": "Open with a public contradiction.",
                "setting": "Wedding altar",
                "beat_summary": "Maya stops the ceremony and turns to the crowd.",
                "emotional_shift": "shock_to_suspense",
                "emotional_objective": "Hook the audience immediately.",
                "character_actions": [
                    "Maya pulls her hand away before the ring lands",
                    "Adrian studies the evidence in silence.",
                ],
                "turning_point": "Maya reveals Adrian's signature.",
                "cliffhanger": True,
                "dialogues": [
                    {
                        "character_name": "Maya Cross",
                        "intent": "stop the ceremony",
                        "text": "Don't pronounce us married",
                    }
                ],
            }
        ],
        "next_episode_question": "Was the fake marriage already legal?",
        "lineage": {
            "content_spec_id": "content_spec_001",
            "platform_profile_id": "tiktok_v1",
            "generation_strategy_id": "strategy_001",
            "generation_strategy_version": "v1",
            "selected_prompt_ids": ["prompt_001"],
            "selected_prompt_versions": ["v1"],
            "prompt_builder_version": "v0.1",
            "llm_provider": "openai_compatible",
            "llm_model_name": "gpt-5.6-sol",
            "original_draft_master_script_id": "draft_001",
            "original_story_qc_score": 0.9,
            "original_story_qc_status": "placeholder",
            "revision_plan_created_at": "2026-07-15T06:36:10.157498Z",
            "revision_action_ids": ["revision_001"],
            "revised_draft_master_script_id": "draft_001",
            "re_qc_score": 0.92,
            "re_qc_status": "placeholder",
            "minimum_re_qc_score_required": 0.65,
            "dialogue_line_count_per_scene": 2,
            "speaker_name_cycle": ["Heroine", "Counterpart"],
            "finalization_policy_id": "policy_001",
            "finalization_version": "final_master_script.v1",
            "draft_generated_at": "2026-07-15T06:36:10.157546Z",
            "revision_generated_at": "2026-07-15T06:36:10.174815Z",
            "finalized_at": "2026-07-15T06:36:10.182820Z",
        },
    }


def test_render_master_script_markdown_humanizes_export_format() -> None:
    markdown = render_master_script_markdown(build_master_script())

    assert "### Scene 1 - Hook" in markdown
    assert "- Emotional Shift: Shock to Suspense." in markdown
    assert "#### Character Actions" in markdown
    assert "- Maya pulls her hand away before the ring lands." in markdown
    assert "- Adrian studies the evidence in silence." in markdown
    assert "- **Maya Cross** (stop the ceremony): Don't pronounce us married." in markdown
