import httpx
import scripts.run_cn_recursive_600k_acceptance as acceptance

from scripts.run_cn_recursive_600k_acceptance import (
    approved_expansion_status,
    build_generation_request,
    completed_through,
    latest_by_id,
    is_retryable_post_response,
    is_direct_script_node,
    next_branch_node,
    update_continuity_snapshot,
    validate_episode_plan_coverage,
)


def test_only_transient_or_model_format_responses_are_retryable() -> None:
    assert is_retryable_post_response(httpx.Response(503))
    assert is_retryable_post_response(
        httpx.Response(
            422,
            json={"detail": "Model returned invalid JSON content."},
        )
    )
    assert is_retryable_post_response(
        httpx.Response(
            422,
            json={"detail": "Real LLM output did not validate as DraftMasterScript."},
        )
    )
    assert not is_retryable_post_response(
        httpx.Response(
            422,
            json={"detail": "Episode Plan range does not match its source node."},
        )
    )
    assert not is_retryable_post_response(httpx.Response(400))


def test_direct_script_leaf_approval_enforces_the_ten_episode_ceiling() -> None:
    assert approved_expansion_status({
        "expansion_status": "unexpanded",
        "planned_start_episode": 6,
        "planned_end_episode": 10,
    }, max_episode_ready_span=14) == "episode_ready"
    assert approved_expansion_status({
        "expansion_status": "unexpanded",
        "planned_start_episode": 6,
        "planned_end_episode": 19,
    }, max_episode_ready_span=14) == "expanded"
    assert approved_expansion_status({
        "expansion_status": "episode_ready",
        "planned_start_episode": 6,
        "planned_end_episode": 30,
    }, max_episode_ready_span=14) == "expanded"

    assert not is_direct_script_node({
        "status": "approved",
        "expansion_status": "episode_ready",
        "planned_start_episode": 1,
        "planned_end_episode": 11,
    })


def test_latest_by_id_discards_old_immutable_versions() -> None:
    result = latest_by_id(
        [
            {"node_id": "node.1", "version": 1},
            {"node_id": "node.1", "version": 2},
            {"node_id": "node.2", "version": 1},
        ],
        "node_id",
    )

    assert {(item["node_id"], item["version"]) for item in result} == {
        ("node.1", 2),
        ("node.2", 1),
    }


def test_episode_plan_coverage_requires_every_approved_episode() -> None:
    validate_episode_plan_coverage(
        [
            {"episode_number": 1, "status": "approved"},
            {"episode_number": 2, "status": "approved"},
        ],
        2,
    )


def test_ten_episode_leaf_completes_generation_coverage_without_plans() -> None:
    validate_episode_plan_coverage(
        [{"episode_number": 1, "status": "approved"}],
        10,
        nodes=[{
            "node_id": "node.episodes.2-10",
            "status": "approved",
            "expansion_status": "episode_ready",
            "planned_start_episode": 2,
            "planned_end_episode": 10,
        }],
    )


def test_body_recovery_can_validate_only_the_requested_leaf_window() -> None:
    validate_episode_plan_coverage(
        [],
        10,
        nodes=[{
            "node_id": "node.episodes.1-10",
            "status": "approved",
            "expansion_status": "episode_ready",
            "planned_start_episode": 1,
            "planned_end_episode": 10,
        }],
    )


def test_only_semantically_ready_leaf_is_direct_script_ready() -> None:
    assert not is_direct_script_node({
        "node_id": "node.episodes.1-10",
        "status": "approved",
        "expansion_status": "expanded",
        "planned_start_episode": 1,
        "planned_end_episode": 10,
    })


def test_completed_through_stops_at_the_first_missing_episode() -> None:
    assert completed_through({
        1: {"data": {}},
        2: {"data": {}},
        4: {"data": {}},
    }) == 2


def test_body_phase_resumes_from_direct_leaf_without_episode_plans(
    monkeypatch,
    tmp_path,
) -> None:
    node = {
        "node_id": "node.episodes.1-10",
        "version": 1,
        "status": "approved",
        "expansion_status": "episode_ready",
        "planned_start_episode": 1,
        "planned_end_episode": 10,
    }

    def fake_get_data(_client, path):
        return [node] if path.endswith("/plan-nodes") else []

    monkeypatch.setattr(acceptance, "get_data", fake_get_data)
    monkeypatch.setattr(
        acceptance,
        "load_completed_runs",
        lambda _episodes_dir: {
            episode_number: {"data": {"draft_master_script": {}}}
            for episode_number in range(1, 11)
        },
    )

    acceptance.run_body_generation(
        object(),
        project={
            "project_id": "project.1",
            "planned_episode_count": 334,
        },
        story_bible={},
        strategy_id="strategy.1",
        output_dir=tmp_path,
        max_episodes=10,
        request_delay_seconds=0,
        retries=0,
        retry_delay_seconds=0,
    )


def test_generation_request_uses_multi_episode_leaf_for_only_current_episode() -> None:
    payload = build_generation_request(
        project={
            "content_spec_id": "content.1",
            "target_total_characters": 600_000,
            "planned_episode_count": 334,
            "default_batch_size": 5,
        },
        story_bible={
            "core_premise": "核心前提",
            "series_goal": "整部目标",
            "theme": "主题",
            "central_conflict": "中心冲突",
            "ending_direction": "结局方向",
            "locked_facts": [],
            "avoid_patterns": [],
        },
        plan={
            "node_id": "node.episodes.6-15",
            "episode_number": 9,
            "planned_start_episode": 6,
            "planned_end_episode": 15,
            "title": "证人消失",
            "narrative_purpose": "让调查转为救援",
            "synopsis": "主角发现证人被转移，必须立即追踪。",
            "entry_state": "证人即将作证",
            "central_conflict": "救人和固定证据无法同时完成",
            "turning_points": ["主角锁定车辆", "主角放弃公开证据"],
            "emotional_direction": "愤怒转为承担",
            "exit_state": "证人获救但证据被毁",
        },
        strategy_id="strategy.v2",
        previous_draft=None,
    )

    assert payload["episode_context"]["episode_number"] == 9
    assert "当前只生成：第9集" in payload["episode_context"]["episode_instruction"]
    assert "所属正文阶段：第6-15集" in payload["episode_context"]["episode_instruction"]
    assert "阶段内进度：第4集" in payload["episode_context"]["episode_instruction"]
    assert "剧情节点：证人消失" in payload["episode_context"]["episode_instruction"]
    assert "关键转折：主角锁定车辆、主角放弃公开证据" in (
        payload["episode_context"]["episode_instruction"]
    )
    assert "只写当前这一集的完整剧本正文" in (
        payload["episode_context"]["episode_instruction"]
    )


def test_generation_request_uses_the_whole_story_scale_as_a_reference() -> None:
    payload = build_generation_request(
        project={
            "content_spec_id": "content.1",
            "target_total_characters": 600_000,
            "planned_episode_count": 334,
            "default_batch_size": 5,
        },
        story_bible={
            "core_premise": "核心前提",
            "series_goal": "整部目标",
            "theme": "主题",
            "central_conflict": "中心冲突",
            "ending_direction": "结局方向",
            "locked_facts": [],
            "avoid_patterns": [],
        },
        plan={
            "episode_number": 6,
            "episode_goal": "推进目标",
            "entry_state": "进入状态",
            "central_conflict": "冲突",
            "protagonist_decision": "作出决定",
            "reveal": None,
            "emotional_movement": "情绪升级",
            "exit_state": "退出状态",
            "cliffhanger": "悬念",
        },
        strategy_id="strategy.v2",
        previous_draft=None,
    )

    assert payload["target_script_body_characters"] == 1796
    assert payload["episode_context"]["episode_number"] == 6
    assert payload["episode_context"]["batch_context"] == {
        "batch_number": 2,
        "start_episode": 6,
        "end_episode": 10,
        "batch_instruction": "承接既有状态推进当前规划节点，不得重置冲突或重复上一集。",
    }
    assert "本集目标：推进目标" in payload["episode_context"]["episode_instruction"]


def test_next_branch_node_selects_deepest_part_covering_next_episode() -> None:
    nodes = [
        {
            "node_id": "node.root",
            "parent_node_id": None,
            "planned_start_episode": 1,
            "planned_end_episode": 100,
            "sequence_order": 1,
        },
        {
            "node_id": "node.root.first",
            "parent_node_id": "node.root",
            "planned_start_episode": 1,
            "planned_end_episode": 30,
            "sequence_order": 1,
        },
        {
            "node_id": "node.root.first.opening",
            "parent_node_id": "node.root.first",
            "planned_start_episode": 1,
            "planned_end_episode": 10,
            "sequence_order": 1,
        },
        {
            "node_id": "node.root.second",
            "parent_node_id": "node.root",
            "planned_start_episode": 31,
            "planned_end_episode": 60,
            "sequence_order": 2,
        },
    ]

    selected = next_branch_node(nodes, completed_through=1)

    assert selected is not None
    assert selected["node_id"] == "node.root.first.opening"


def test_next_branch_node_prefers_approved_five_episode_leaf_over_stale_children() -> None:
    nodes = [
        {
            "node_id": "node.batch",
            "parent_node_id": "node.parent",
            "planned_start_episode": 1,
            "planned_end_episode": 5,
            "sequence_order": 1,
            "status": "approved",
            "expansion_status": "episode_ready",
        },
        {
            "node_id": "node.batch.stale-child",
            "parent_node_id": "node.batch",
            "planned_start_episode": 1,
            "planned_end_episode": 1,
            "sequence_order": 1,
            "status": "draft",
            "expansion_status": "episode_ready",
        },
    ]

    selected = next_branch_node(nodes, completed_through=1)

    assert selected is not None
    assert selected["node_id"] == "node.batch"


def test_continuity_snapshot_updates_cards_relationships_and_story_lines() -> None:
    snapshot = {
        "snapshot_version": 0,
        "through_episode_number": 0,
        "character_cards": [],
        "relationships": [],
        "story_lines": [{
            "story_line_id": "storyline.survival",
            "title": "避难所生存线",
            "status": "setup",
            "current_state": "污染逼近",
            "last_progressed_episode": 0,
        }],
        "recent_episode_summaries": [],
        "warnings": [],
    }
    story_bible = {"relationships": [], "story_lines": []}
    node = {
        "node_id": "node.root.opening",
        "story_line_refs": ["storyline.survival"],
    }
    plan = {
        "episode_plan_id": "episode_plan.1",
        "entry_state": "污染逼近避难所",
        "exit_state": "主角与医生暂时结盟并封闭污染阀",
    }
    draft = {
        "characters": [
            {
                "name": "林夏",
                "role": "主角",
                "description": "避难所工程师",
                "motivation": "守住避难所",
            },
            {
                "name": "周野",
                "role": "医生",
                "description": "坚持救治感染者",
                "motivation": "保住伤员",
            },
        ],
        "scenes": [{
            "beat_summary": "林夏与周野共同关闭污染阀。",
            "character_actions": ["林夏拉住周野，一起转动阀门。"],
            "dialogues": [],
            "turning_point": "两人必须暂时合作。",
            "scene_causality": {"outcome": "林夏与周野形成暂时同盟。"},
        }],
        "next_episode_question": "阀门为何再次开启？",
    }

    updated = update_continuity_snapshot(
        snapshot,
        story_bible=story_bible,
        node=node,
        plan=plan,
        draft=draft,
        episode_number=1,
    )

    assert updated["through_episode_number"] == 1
    assert {item["name"] for item in updated["character_cards"]} == {"林夏", "周野"}
    assert updated["relationships"][0]["current_state"] == "林夏与周野形成暂时同盟。"
    assert updated["story_lines"][0]["status"] == "active"
    assert updated["story_lines"][0]["last_progressed_episode"] == 1

    payload = build_generation_request(
        project={
            "content_spec_id": "content.1",
            "target_total_characters": 600_000,
            "planned_episode_count": 334,
            "default_batch_size": 5,
        },
        story_bible={
            "core_premise": "核心前提",
            "series_goal": "整部目标",
            "theme": "主题",
            "central_conflict": "中心冲突",
            "ending_direction": "结局方向",
            "locked_facts": [],
            "avoid_patterns": [],
        },
        plan={
            "episode_number": 2,
            "episode_goal": "推进目标",
            "entry_state": "进入状态",
            "central_conflict": "冲突",
            "protagonist_decision": "作出决定",
            "reveal": None,
            "emotional_movement": "情绪升级",
            "exit_state": "退出状态",
            "cliffhanger": "悬念",
        },
        strategy_id="strategy.v2",
        previous_draft=None,
        continuity_snapshot=updated,
    )
    assert "林夏" in payload["episode_context"]["project_continuity_summary"]
    assert "避难所生存线" in payload["episode_context"]["project_continuity_summary"]
