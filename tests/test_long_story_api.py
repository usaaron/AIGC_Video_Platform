from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.dependencies import (
    get_long_story_database_runtime,
    get_long_story_service,
    get_story_planning_service,
)
from app.main import create_app
from app.modules.script_engine.long_story_models import (
    EpisodePlan,
    PlanningApprovalStatus,
    StoryBible,
    StoryPlanNode,
    StoryProject,
    StoryStagePlan,
)
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.llm_adapter import LLMRequestError


NOW = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)


def build_project(*, revision: int = 1, title: str = "The Price of Truth") -> StoryProject:
    return StoryProject(
        project_id="story_project.api_demo",
        revision=revision,
        title=title,
        content_spec_id="content_spec.api_demo",
        planned_episode_count=60,
        default_batch_size=5,
        created_at=NOW,
        updated_at=NOW,
    )


def build_story_bible() -> StoryBible:
    return StoryBible(
        story_bible_id="story_bible.api_demo",
        story_project_id="story_project.api_demo",
        content_spec_id="content_spec.api_demo",
        core_premise="A forensic accountant exposes the empire that destroyed her family.",
        series_goal="Follow her pursuit of proof without sacrificing innocent people.",
        theme="Truth has a cost.",
        central_conflict="Every piece of evidence threatens both the empire and someone she loves.",
        ending_direction="She reveals the conspiracy and chooses an independent future.",
        character_refs=["character.mara", "character.adrian"],
        story_lines=[
            {
                "story_line_id": "storyline.hidden_ledger",
                "title": "The Hidden Ledger",
                "story_line_type": "main",
                "premise": "Mara traces a falsified payment into a protected network.",
                "planned_resolution": "The hidden ledger becomes admissible evidence.",
                "character_refs": ["character.mara", "character.adrian"],
            }
        ],
        created_at=NOW,
    )


def build_stage() -> StoryStagePlan:
    return StoryStagePlan(
        stage_id="stage.api_demo.opening",
        story_project_id="story_project.api_demo",
        story_bible_id="story_bible.api_demo",
        story_bible_version=1,
        stage_number=1,
        title="The Evidence Returns",
        start_episode=1,
        end_episode=5,
        stage_goal="Force Mara to choose reliable proof over immediate revenge.",
        entry_state="Mara trusts one suspicious payment record.",
        central_conflict="Adrian claims that the evidence was planted for her.",
        key_turns=["The payment timestamp predates Adrian's authority."],
        exit_state="Mara and Adrian hold complementary evidence but remain adversaries.",
    )


def build_story_plan_node(
    *,
    node_id: str = "story_plan.api_demo.root",
    parent_node_id: str | None = None,
    predecessor_node_id: str | None = None,
    sequence_order: int = 1,
    planned_start_episode: int | None = None,
    planned_end_episode: int | None = None,
    expansion_status: str = "unexpanded",
) -> StoryPlanNode:
    return StoryPlanNode(
        node_id=node_id,
        story_project_id="story_project.api_demo",
        story_bible_id="story_bible.api_demo",
        story_bible_version=1,
        parent_node_id=parent_node_id,
        parent_node_version=1 if parent_node_id else None,
        predecessor_node_id=predecessor_node_id,
        predecessor_node_version=1 if predecessor_node_id else None,
        sequence_order=sequence_order,
        title="The Evidence Returns",
        narrative_purpose="Move the investigation from accusation to verified proof.",
        synopsis="Mara discovers that her strongest evidence was altered and traces its source.",
        entry_state="Mara trusts one suspicious payment record.",
        central_conflict="Public revenge would destroy her access to reliable evidence.",
        turning_points=["The timestamp predates Adrian's authority."],
        emotional_direction="Certainty becomes controlled doubt.",
        exit_state="Mara obtains one verified fact and a more dangerous lead.",
        character_refs=["character.mara", "character.adrian"],
        story_line_refs=["storyline.hidden_ledger"],
        planned_start_episode=planned_start_episode,
        planned_end_episode=planned_end_episode,
        expansion_status=expansion_status,
    )


def build_episode_plan(*, episode_number: int = 1) -> EpisodePlan:
    return EpisodePlan(
        episode_plan_id=f"episode_plan.api_demo.{episode_number:03d}",
        story_project_id="story_project.api_demo",
        story_bible_id="story_bible.api_demo",
        story_bible_version=1,
        stage_id="stage.api_demo.opening",
        stage_version=1,
        episode_number=episode_number,
        episode_goal="Mara must verify the source before making a public accusation.",
        entry_state="Mara begins with incomplete evidence.",
        central_conflict="The source of the evidence cannot be trusted.",
        protagonist_decision="Mara delays revenge and verifies the payment timestamp.",
        emotional_movement="Certainty to controlled doubt.",
        exit_state="Mara gains one verified fact and one dangerous question.",
        cliffhanger="A hidden record identifies someone Mara trusted.",
        character_refs=["character.mara", "character.adrian"],
    )


@pytest.fixture
def long_story_app(tmp_path):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'long_story_api.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    app = create_app()
    app.dependency_overrides[get_long_story_service] = lambda: LongStoryService(runtime)
    try:
        yield app, runtime
    finally:
        runtime.engine.dispose()


@pytest.mark.anyio
async def test_long_story_planning_api_persists_complete_planning_slice(
    long_story_app,
) -> None:
    app, runtime = long_story_app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        project_response = await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        assert project_response.status_code == 200

        bible_response = await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/1",
            json=build_story_bible().model_dump(mode="json"),
        )
        assert bible_response.status_code == 200

        stage_response = await client.put(
            "/story-projects/story_project.api_demo/stages/"
            "stage.api_demo.opening/versions/1",
            json=build_stage().model_dump(mode="json"),
        )
        assert stage_response.status_code == 200

        episode_response = await client.put(
            "/story-projects/story_project.api_demo/episode-plans/"
            "episode_plan.api_demo.001/versions/1",
            json=build_episode_plan().model_dump(mode="json"),
        )
        assert episode_response.status_code == 200

        project_list = await client.get("/story-projects?limit=10&offset=0")
        stage_list = await client.get("/story-projects/story_project.api_demo/stages")
        episode_list = await client.get(
            "/story-projects/story_project.api_demo/episode-plans?"
            "start_episode=1&end_episode=1"
        )
        assert project_list.json()["total"] == 1
        assert len(stage_list.json()["data"]) == 1
        assert len(episode_list.json()["data"]) == 1

    restarted_app = create_app()
    restarted_app.dependency_overrides[get_long_story_service] = (
        lambda: LongStoryService(runtime)
    )
    async with AsyncClient(
        transport=ASGITransport(app=restarted_app),
        base_url="http://testserver",
    ) as client:
        persisted = await client.get("/story-projects/story_project.api_demo")
    assert persisted.status_code == 200
    assert persisted.json()["data"]["title"] == "The Price of Truth"


@pytest.mark.anyio
async def test_confirmed_episode_artifacts_advance_durable_continuity_checkpoint(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    approved_bible = StoryBible.model_validate({
        **build_story_bible().model_dump(mode="json"),
            "status": "approved",
            "approved_at": NOW,
            "character_registry": [
                {
                    "character_ref": "character.mara",
                    "name": "Mara",
                    "role": "protagonist",
                },
                {
                    "character_ref": "character.adrian",
                    "name": "Adrian",
                    "role": "supporting",
                },
            ],
    })
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        assert (await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )).status_code == 200
        assert (await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/1",
            json=approved_bible.model_dump(mode="json"),
        )).status_code == 200

        first_artifact = {
            "schema_version": "v1",
            "artifact_id": "artifact.api_demo.episode_0001.draft",
            "story_project_id": "story_project.api_demo",
            "episode_number": 1,
            "artifact_kind": "draft",
            "content_schema_version": "draft_master_script.v1",
            "content_payload": {
                "synopsis": "Mara is killed after hiding the only copy of the ledger.",
                "character_state_updates": [{
                    "character_name": "Mara",
                    "current_goal": "Protect the evidence after death through her contingency.",
                    "emotional_state": "Resolved",
                    "life_status": "dead",
                    "knowledge_changes": ["Adrian ordered the transfer."],
                    "knowledge_states": [{
                        "knowledge_key": "transfer.orderer",
                        "statement": "Adrian ordered the transfer.",
                        "status": "known",
                    }],
                    "health_conditions": [],
                    "action_capabilities": ["Cannot take new chronological actions."],
                    "lasting_marks": [],
                    "active_constraints": ["May appear only in memories or recordings."],
                    "change_summary": "Mara dies after securing the evidence.",
                    "change_cause": "The attacker shoots her in scene 3.",
                    "evidence_scene_numbers": [3],
                }],
                "continuity_state_updates": [{
                    "entity_key": "item.hidden_ledger",
                    "entity_type": "item",
                    "entity_name": "Hidden ledger",
                    "state_domain": "condition",
                    "transition": "destroyed",
                    "current_state": "The paper original is destroyed.",
                    "persistence": "permanent",
                    "future_constraint": "Only a previously established copy may reappear.",
                    "change_cause": "The attacker burns it in scene 3.",
                    "evidence_scene_numbers": [3],
                }],
                "story_line_updates": [{
                    "story_line_id": "storyline.hidden_ledger",
                    "status": "active",
                    "progress_summary": "The physical ledger is gone, but a hidden copy may exist.",
                }],
                "continuation_hook": {
                    "ending_hook_summary": "A scheduled upload begins.",
                    "next_episode_obligation": "Reveal who receives Mara's copy.",
                },
            },
            "lineage_refs": {},
            "created_at": NOW.isoformat(),
        }
        response = await client.post(
            "/story-projects/story_project.api_demo/episodes/1/artifacts",
            json=first_artifact,
        )
        assert response.status_code == 200
        checkpoint = await client.get(
            "/story-projects/story_project.api_demo/continuity-ledger/latest"
        )
        assert checkpoint.status_code == 200
        ledger = checkpoint.json()["data"]
        assert ledger["version"] == 1
        assert ledger["through_episode_number"] == 1
        assert ledger["character_states"][0]["character_ref"] == "character.mara"
        assert ledger["character_states"][0]["life_status"] == "dead"
        assert ledger["world_states"][0]["last_transition"] == "destroyed"
        assert ledger["setup_payoffs"][0]["status"] == "setup"

        second_artifact = {
            **first_artifact,
            "artifact_id": "artifact.api_demo.episode_0002.draft",
            "episode_number": 2,
            "content_payload": {
                "synopsis": "Adrian receives the scheduled upload and realizes Mara planned ahead.",
                "character_state_updates": [],
                "continuity_state_updates": [{
                    "entity_key": "item.ledger_alias_from_model",
                    "entity_type": "item",
                    "entity_name": "Hidden ledger",
                    "state_domain": "ownership",
                    "transition": "transferred",
                    "current_state": "Adrian controls the only established digital copy.",
                    "persistence": "ongoing",
                    "future_constraint": "Others must obtain access before using the copy.",
                    "change_cause": "The scheduled upload reaches Adrian in scene 1.",
                    "evidence_scene_numbers": [1],
                }],
                "story_line_updates": [],
                "continuation_hook": {
                    "previous_hook_response": "Adrian receives Mara's copy.",
                    "ending_hook_summary": "The copy contains Adrian's signature.",
                    "next_episode_obligation": "Explain whether the signature was forged.",
                    "response_evidence_scene_numbers": [1],
                },
            },
        }
        assert (await client.post(
            "/story-projects/story_project.api_demo/episodes/2/artifacts",
            json=second_artifact,
        )).status_code == 200
        ledger = (await client.get(
            "/story-projects/story_project.api_demo/continuity-ledger/latest"
        )).json()["data"]
        assert ledger["version"] == 2
        assert ledger["through_episode_number"] == 2
        assert ledger["character_states"][0]["life_status"] == "dead"
        assert ledger["world_states"][0]["current_state"] == "The paper original is destroyed."
        assert {item["entity_key"] for item in ledger["world_states"]} == {
            "item.hidden_ledger"
        }
        assert any(
            item["canonical_entity_key"] == "item.hidden_ledger"
            and item["alias"] == "Hidden ledger"
            for item in ledger["entity_aliases"]
        )
        assert ledger["setup_payoffs"][0]["status"] == "paid_off"

        older_retry = {
            **first_artifact,
            "artifact_id": "artifact.api_demo.episode_0001.revised",
            "artifact_kind": "revised",
        }
        assert (await client.post(
            "/story-projects/story_project.api_demo/episodes/1/artifacts",
            json=older_retry,
        )).status_code == 200
        ledger_after_retry = (await client.get(
            "/story-projects/story_project.api_demo/continuity-ledger/latest"
        )).json()["data"]
        assert ledger_after_retry["version"] == 2
        assert ledger_after_retry["source_artifact_id"] == second_artifact["artifact_id"]


@pytest.mark.anyio
async def test_planning_lists_isolate_regenerated_story_bible_lineage(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    first_node = build_story_plan_node(
        planned_start_episode=1,
        planned_end_episode=60,
    )
    second_node = first_node.model_copy(
        update={"version": 2, "story_bible_version": 2}
    )
    second_stage = build_stage().model_copy(
        update={"version": 2, "story_bible_version": 2}
    )
    second_episode = build_episode_plan().model_copy(
        update={
            "version": 2,
            "story_bible_version": 2,
            "stage_version": 2,
        }
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        assert (
            await client.put(
                "/story-projects/story_project.api_demo",
                json=build_project().model_dump(mode="json"),
            )
        ).status_code == 200
        assert (
            await client.put(
                "/story-projects/story_project.api_demo/story-bibles/"
                "story_bible.api_demo/versions/1",
                json=build_story_bible().model_dump(mode="json"),
            )
        ).status_code == 200
        assert (
            await client.put(
                "/story-projects/story_project.api_demo/plan-nodes/"
                f"{first_node.node_id}/versions/1",
                json=first_node.model_dump(mode="json"),
            )
        ).status_code == 200
        assert (
            await client.put(
                "/story-projects/story_project.api_demo/stages/"
                "stage.api_demo.opening/versions/1",
                json=build_stage().model_dump(mode="json"),
            )
        ).status_code == 200
        assert (
            await client.put(
                "/story-projects/story_project.api_demo/episode-plans/"
                "episode_plan.api_demo.001/versions/1",
                json=build_episode_plan().model_dump(mode="json"),
            )
        ).status_code == 200

        second_bible = build_story_bible().model_copy(update={"version": 2})
        assert (
            await client.put(
                "/story-projects/story_project.api_demo/story-bibles/"
                "story_bible.api_demo/versions/2",
                json=second_bible.model_dump(mode="json"),
            )
        ).status_code == 200

        empty_new_nodes = await client.get(
            "/story-projects/story_project.api_demo/plan-nodes",
            params={
                "roots_only": "true",
                "story_bible_id": "story_bible.api_demo",
                "story_bible_version": 2,
            },
        )
        empty_new_stages = await client.get(
            "/story-projects/story_project.api_demo/stages",
            params={
                "story_bible_id": "story_bible.api_demo",
                "story_bible_version": 2,
            },
        )
        empty_new_episodes = await client.get(
            "/story-projects/story_project.api_demo/episode-plans",
            params={
                "story_bible_id": "story_bible.api_demo",
                "story_bible_version": 2,
            },
        )
        assert empty_new_nodes.json()["data"] == []
        assert empty_new_stages.json()["data"] == []
        assert empty_new_episodes.json()["data"] == []

        assert (
            await client.put(
                "/story-projects/story_project.api_demo/plan-nodes/"
                f"{second_node.node_id}/versions/2",
                json=second_node.model_dump(mode="json"),
            )
        ).status_code == 200
        assert (
            await client.put(
                "/story-projects/story_project.api_demo/stages/"
                "stage.api_demo.opening/versions/2",
                json=second_stage.model_dump(mode="json"),
            )
        ).status_code == 200
        assert (
            await client.put(
                "/story-projects/story_project.api_demo/episode-plans/"
                "episode_plan.api_demo.001/versions/2",
                json=second_episode.model_dump(mode="json"),
            )
        ).status_code == 200

        old_nodes = await client.get(
            "/story-projects/story_project.api_demo/plan-nodes",
            params={
                "roots_only": "true",
                "story_bible_id": "story_bible.api_demo",
                "story_bible_version": 1,
            },
        )
        new_nodes = await client.get(
            "/story-projects/story_project.api_demo/plan-nodes",
            params={
                "roots_only": "true",
                "story_bible_id": "story_bible.api_demo",
                "story_bible_version": 2,
            },
        )
        old_episodes = await client.get(
            "/story-projects/story_project.api_demo/episode-plans",
            params={
                "story_bible_id": "story_bible.api_demo",
                "story_bible_version": 1,
            },
        )
        new_episodes = await client.get(
            "/story-projects/story_project.api_demo/episode-plans",
            params={
                "story_bible_id": "story_bible.api_demo",
                "story_bible_version": 2,
            },
        )
        incomplete_lineage = await client.get(
            "/story-projects/story_project.api_demo/plan-nodes",
            params={"story_bible_id": "story_bible.api_demo"},
        )

    assert [node["story_bible_version"] for node in old_nodes.json()["data"]] == [1]
    assert [node["story_bible_version"] for node in new_nodes.json()["data"]] == [2]
    assert [plan["story_bible_version"] for plan in old_episodes.json()["data"]] == [1]
    assert [plan["story_bible_version"] for plan in new_episodes.json()["data"]] == [2]
    assert incomplete_lineage.status_code == 422


@pytest.mark.anyio
async def test_story_plan_node_api_persists_a_level_free_recursive_tree(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    root = build_story_plan_node(
        planned_start_episode=1,
        planned_end_episode=60,
        expansion_status="expanded",
    )
    first = build_story_plan_node(
        node_id="story_plan.api_demo.first",
        parent_node_id=root.node_id,
        planned_start_episode=1,
        planned_end_episode=8,
    )
    second = build_story_plan_node(
        node_id="story_plan.api_demo.second",
        parent_node_id=root.node_id,
        predecessor_node_id=first.node_id,
        sequence_order=2,
        planned_start_episode=9,
        planned_end_episode=20,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/1",
            json=build_story_bible().model_dump(mode="json"),
        )
        for node in (root, first, second):
            response = await client.put(
                f"/story-projects/story_project.api_demo/plan-nodes/"
                f"{node.node_id}/versions/{node.version}",
                json=node.model_dump(mode="json"),
            )
            assert response.status_code == 200

        roots = await client.get(
            "/story-projects/story_project.api_demo/plan-nodes?roots_only=true"
        )
        children = await client.get(
            "/story-projects/story_project.api_demo/plan-nodes?"
            f"parent_node_id={root.node_id}"
        )
        fetched = await client.get(
            f"/story-projects/story_project.api_demo/plan-nodes/{second.node_id}"
        )

    assert [node["node_id"] for node in roots.json()["data"]] == [root.node_id]
    assert [node["node_id"] for node in children.json()["data"]] == [
        first.node_id,
        second.node_id,
    ]
    assert fetched.json()["data"]["predecessor_node_id"] == first.node_id


@pytest.mark.anyio
async def test_story_plan_node_approval_rebases_descendants_idempotently(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    root = build_story_plan_node(
        planned_start_episode=1,
        planned_end_episode=60,
        expansion_status="expanded",
    )
    child = build_story_plan_node(
        node_id="story_plan.api_demo.approved_leaf",
        parent_node_id=root.node_id,
        planned_start_episode=1,
        planned_end_episode=8,
        expansion_status="episode_ready",
    ).model_copy(update={
        "unit_story_beats": [
            "主角确认当前威胁。",
            "对手封锁关键证据。",
            "主角做出不可逆选择。",
            "行动结果迫使冲突升级。",
        ],
        "unit_resolution": "主角固定第一份可验证证据。",
        "handoff_pressure": "更高层对手开始直接反制主角。",
        "status": PlanningApprovalStatus.approved,
        "approved_at": NOW,
    })
    approved_root = root.model_copy(update={
        "version": 2,
        "status": PlanningApprovalStatus.approved,
        "approved_at": NOW,
    })

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/1",
            json=build_story_bible().model_dump(mode="json"),
        )
        for node in (root, child):
            response = await client.put(
                f"/story-projects/story_project.api_demo/plan-nodes/"
                f"{node.node_id}/versions/{node.version}",
                json=node.model_dump(mode="json"),
            )
            assert response.status_code == 200

        approval_url = (
            f"/story-projects/story_project.api_demo/plan-nodes/{root.node_id}/"
            "versions/2?descendant_policy=rebase"
        )
        first_approval = await client.put(
            approval_url,
            json=approved_root.model_dump(mode="json"),
        )
        retried_approval = await client.put(
            approval_url,
            json=approved_root.model_dump(mode="json"),
        )
        fetched_child = await client.get(
            f"/story-projects/story_project.api_demo/plan-nodes/{child.node_id}"
        )

    assert first_approval.status_code == 200
    assert retried_approval.status_code == 200
    assert fetched_child.status_code == 200
    assert fetched_child.json()["data"]["version"] == 2
    assert fetched_child.json()["data"]["parent_node_version"] == 2
    assert fetched_child.json()["data"]["status"] == "approved"


@pytest.mark.anyio
async def test_story_plan_node_api_rejects_unlinked_non_first_child(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    root = build_story_plan_node(
        planned_start_episode=1,
        planned_end_episode=60,
        expansion_status="expanded",
    )
    invalid = build_story_plan_node(
        node_id="story_plan.api_demo.unlinked",
        parent_node_id=root.node_id,
        sequence_order=2,
        planned_start_episode=9,
        planned_end_episode=20,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/1",
            json=build_story_bible().model_dump(mode="json"),
        )
        await client.put(
            f"/story-projects/story_project.api_demo/plan-nodes/"
            f"{root.node_id}/versions/1",
            json=root.model_dump(mode="json"),
        )
        response = await client.put(
            f"/story-projects/story_project.api_demo/plan-nodes/"
            f"{invalid.node_id}/versions/1",
            json=invalid.model_dump(mode="json"),
        )

    assert response.status_code == 409
    assert "predecessor" in response.json()["detail"].lower()


@pytest.mark.anyio
async def test_story_plan_tree_allows_branch_specific_decomposition_depth(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    root = build_story_plan_node(
        planned_start_episode=1,
        planned_end_episode=60,
        expansion_status="expanded",
    )
    shallow_leaf = build_story_plan_node(
        node_id="story_plan.api_demo.shallow_leaf",
        parent_node_id=root.node_id,
        planned_start_episode=1,
        planned_end_episode=4,
        expansion_status="episode_ready",
    )
    deep_branch = build_story_plan_node(
        node_id="story_plan.api_demo.deep_branch",
        parent_node_id=root.node_id,
        predecessor_node_id=shallow_leaf.node_id,
        sequence_order=2,
        planned_start_episode=5,
        planned_end_episode=30,
        expansion_status="expanded",
    )
    deep_leaf = build_story_plan_node(
        node_id="story_plan.api_demo.deep_leaf",
        parent_node_id=deep_branch.node_id,
        planned_start_episode=5,
        planned_end_episode=10,
        expansion_status="episode_ready",
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/1",
            json=build_story_bible().model_dump(mode="json"),
        )
        for node in (root, shallow_leaf, deep_branch, deep_leaf):
            response = await client.put(
                f"/story-projects/story_project.api_demo/plan-nodes/"
                f"{node.node_id}/versions/1",
                json=node.model_dump(mode="json"),
            )
            assert response.status_code == 200

        root_children = await client.get(
            "/story-projects/story_project.api_demo/plan-nodes?"
            f"parent_node_id={root.node_id}"
        )
        deep_children = await client.get(
            "/story-projects/story_project.api_demo/plan-nodes?"
            f"parent_node_id={deep_branch.node_id}"
        )

    assert root_children.json()["data"][0]["expansion_status"] == "episode_ready"
    assert root_children.json()["data"][1]["expansion_status"] == "expanded"
    assert [node["node_id"] for node in deep_children.json()["data"]] == [
        deep_leaf.node_id
    ]


@pytest.mark.anyio
async def test_long_story_api_rejects_stale_project_revision(long_story_app) -> None:
    app, _runtime = long_story_app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        updated = await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project(revision=2, title="Updated title").model_dump(mode="json"),
        )
        stale = await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project(revision=2, title="Stale title").model_dump(mode="json"),
        )
    assert updated.status_code == 200
    assert stale.status_code == 409
    assert "revision" in stale.json()["detail"].lower()


@pytest.mark.anyio
async def test_story_project_archive_is_revision_safe_and_hidden_by_default(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        stale = await client.delete(
            "/story-projects/story_project.api_demo?expected_revision=2"
        )
        archived = await client.delete(
            "/story-projects/story_project.api_demo?expected_revision=1"
        )
        visible = await client.get("/story-projects")
        including_archived = await client.get(
            "/story-projects?include_archived=true"
        )

    assert stale.status_code == 409
    assert archived.status_code == 200
    assert archived.json()["data"]["status"] == "archived"
    assert archived.json()["data"]["revision"] == 2
    assert visible.json()["total"] == 0
    assert including_archived.json()["total"] == 1


@pytest.mark.anyio
async def test_story_project_permanent_delete_removes_complete_owned_workspace(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    workspace_payload = {
        "id": "story_project.api_demo",
        "title": "The Price of Truth",
        "episodes": [{"episodeNumber": 1, "status": "framework"}],
        "updatedAt": NOW.isoformat(),
    }
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/1",
            json=build_story_bible().model_dump(mode="json"),
        )
        await client.put(
            "/story-projects/story_project.api_demo/stages/"
            "stage.api_demo.opening/versions/1",
            json=build_stage().model_dump(mode="json"),
        )
        await client.put(
            "/story-projects/story_project.api_demo/episode-plans/"
            "episode_plan.api_demo.001/versions/1",
            json=build_episode_plan().model_dump(mode="json"),
        )
        workspace = await client.put(
            "/story-projects/story_project.api_demo/workspace",
            json={
                "schema_version": "v1",
                "project_id": "story_project.api_demo",
                "revision": 1,
                "payload_schema_version": "frontend.script_project.v1",
                "client_instance_id": "client.api_demo",
                "workspace_payload": workspace_payload,
                "updated_at": NOW.isoformat(),
            },
        )
        stale = await client.delete(
            "/story-projects/story_project.api_demo/permanent?expected_revision=2"
        )
        deleted = await client.delete(
            "/story-projects/story_project.api_demo/permanent?expected_revision=1"
        )
        project = await client.get("/story-projects/story_project.api_demo")
        restored_workspace = await client.get(
            "/story-projects/story_project.api_demo/workspace"
        )
        projects = await client.get(
            "/story-projects?include_archived=true"
        )

    assert workspace.status_code == 200
    assert stale.status_code == 409
    assert deleted.status_code == 200
    assert deleted.json()["data"]["deleted"] is True
    assert deleted.json()["data"]["deleted_records"] == {
        "generation_job_checkpoints": 0,
        "episode_artifact_versions": 0,
        "generation_batches": 0,
        "episode_plan_versions": 1,
        "continuity_ledger_versions": 0,
        "story_plan_node_versions": 0,
        "story_stage_plan_versions": 1,
        "story_project_workspace_snapshots": 1,
        "story_bible_versions": 1,
        "story_projects": 1,
    }
    assert project.status_code == 404
    assert restored_workspace.status_code == 404
    assert projects.json()["total"] == 0


@pytest.mark.anyio
async def test_workspace_snapshot_api_restores_full_frontend_payload(
    long_story_app,
) -> None:
    app, runtime = long_story_app
    workspace_payload = {
        "id": "story_project.api_demo",
        "title": "The Price of Truth",
        "selectedTagIds": ["genre.dark_romance"],
        "characters": [{"id": "character.mara", "name": "Mara"}],
        "episodes": [{"episodeNumber": 1, "status": "framework"}],
        "updatedAt": NOW.isoformat(),
    }
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        created = await client.put(
            "/story-projects/story_project.api_demo/workspace",
            json={
                "project_id": "story_project.api_demo",
                "revision": 1,
                "client_instance_id": "client.browser_one",
                "workspace_payload": workspace_payload,
                "updated_at": NOW.isoformat(),
            },
        )
        assert created.status_code == 200
        assert created.json()["data"]["payload_size_bytes"] > 2
        assert len(created.json()["data"]["payload_checksum"]) == 64

    restarted_app = create_app()
    restarted_app.dependency_overrides[get_long_story_service] = (
        lambda: LongStoryService(runtime)
    )
    async with AsyncClient(
        transport=ASGITransport(app=restarted_app),
        base_url="http://testserver",
    ) as client:
        restored = await client.get(
            "/story-projects/story_project.api_demo/workspace"
        )
        stale = await client.put(
            "/story-projects/story_project.api_demo/workspace",
            json={
                "project_id": "story_project.api_demo",
                "revision": 1,
                "client_instance_id": "client.browser_two",
                "workspace_payload": {
                    **workspace_payload,
                    "title": "Stale overwrite",
                },
                "updated_at": NOW.isoformat(),
            },
        )
    assert restored.status_code == 200
    assert restored.json()["data"]["workspace_payload"] == workspace_payload
    assert stale.status_code == 409


@pytest.mark.anyio
async def test_episode_artifact_api_assigns_immutable_versions_and_lineage(
    long_story_app,
) -> None:
    app, runtime = long_story_app
    first_payload = {
        "artifact_id": "artifact.api_demo.episode_001.draft.initial",
        "story_project_id": "story_project.api_demo",
        "episode_number": 1,
        "artifact_kind": "draft",
        "content_schema_version": "draft_master_script.v1",
        "content_payload": {"title": "Episode 1", "scenes": []},
        "lineage_refs": {"generation_run_id": "generation.run.api_demo.001"},
        "client_instance_id": "client.browser_one",
        "created_at": NOW.isoformat(),
    }
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        first = await client.post(
            "/story-projects/story_project.api_demo/episodes/1/artifacts",
            json=first_payload,
        )
        replay = await client.post(
            "/story-projects/story_project.api_demo/episodes/1/artifacts",
            json=first_payload,
        )
        second = await client.post(
            "/story-projects/story_project.api_demo/episodes/1/artifacts",
            json={
                **first_payload,
                "artifact_id": "artifact.api_demo.episode_001.draft.confirmed",
                "content_payload": {"title": "Episode 1 Confirmed", "scenes": []},
                "source_artifact_id": first_payload["artifact_id"],
            },
        )
        listed = await client.get(
            "/story-projects/story_project.api_demo/episodes/1/artifacts?"
            "artifact_kind=draft"
        )

    assert first.status_code == 200
    assert replay.json()["data"]["artifact_version"] == 1
    assert second.json()["data"]["artifact_version"] == 2
    assert second.json()["data"]["source_artifact_id"] == first_payload["artifact_id"]
    assert [item["artifact_version"] for item in listed.json()["data"]] == [1, 2]

    restarted_app = create_app()
    restarted_app.dependency_overrides[get_long_story_service] = (
        lambda: LongStoryService(runtime)
    )
    async with AsyncClient(
        transport=ASGITransport(app=restarted_app),
        base_url="http://testserver",
    ) as client:
        restored = await client.get(
            "/story-projects/story_project.api_demo/episodes/1/artifacts/"
            "artifact.api_demo.episode_001.draft.confirmed"
        )
    assert restored.status_code == 200
    assert restored.json()["data"]["payload_checksum"]


@pytest.mark.anyio
async def test_episode_plan_must_stay_inside_its_stage(long_story_app) -> None:
    app, _runtime = long_story_app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/1",
            json=build_story_bible().model_dump(mode="json"),
        )
        await client.put(
            "/story-projects/story_project.api_demo/stages/"
            "stage.api_demo.opening/versions/1",
            json=build_stage().model_dump(mode="json"),
        )
        invalid_episode = build_episode_plan(episode_number=6)
        response = await client.put(
            "/story-projects/story_project.api_demo/episode-plans/"
            "episode_plan.api_demo.006/versions/1",
            json=invalid_episode.model_dump(mode="json"),
        )
    assert response.status_code == 409
    assert "stage range" in response.json()["detail"].lower()


@pytest.mark.anyio
async def test_planning_api_rejects_version_gaps_and_overlapping_stages(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/1",
            json=build_story_bible().model_dump(mode="json"),
        )
        skipped_version = build_story_bible().model_copy(update={"version": 3})
        skipped_response = await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/3",
            json=skipped_version.model_dump(mode="json"),
        )

        await client.put(
            "/story-projects/story_project.api_demo/stages/"
            "stage.api_demo.opening/versions/1",
            json=build_stage().model_dump(mode="json"),
        )
        overlapping_stage = StoryStagePlan.model_validate(
            {
                **build_stage().model_dump(),
                "stage_id": "stage.api_demo.overlap",
                "stage_number": 2,
                "start_episode": 5,
                "end_episode": 10,
            }
        )
        overlap_response = await client.put(
            "/story-projects/story_project.api_demo/stages/"
            "stage.api_demo.overlap/versions/1",
            json=overlapping_stage.model_dump(mode="json"),
        )
    assert skipped_response.status_code == 409
    assert "skips" in skipped_response.json()["detail"]
    assert overlap_response.status_code == 409
    assert "overlap" in overlap_response.json()["detail"]


@pytest.mark.anyio
async def test_story_bible_generation_returns_reset_revisions(long_story_app) -> None:
    app, runtime = long_story_app
    long_story = LongStoryService(runtime)

    class PersistingStoryPlanningStub:
        def generate_story_bible_draft(self, _payload):
            return long_story.save_generated_story_bible_draft(build_story_bible())

    app.dependency_overrides[get_story_planning_service] = (
        lambda: PersistingStoryPlanningStub()
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        await client.put(
            "/story-projects/story_project.api_demo/workspace",
            json={
                "project_id": "story_project.api_demo",
                "revision": 1,
                "client_instance_id": "client.api_demo",
                "workspace_payload": {
                    "id": "story_project.api_demo",
                    "episodes": [],
                },
                "updated_at": NOW.isoformat(),
            },
        )
        response = await client.post(
            "/story-projects/story_project.api_demo/story-bibles/draft",
            json={
                "story_project_id": "story_project.api_demo",
                "content_spec_id": "content_spec.api_demo",
                "generation_strategy_id": "strategy.api_demo",
                "creative_prompt": "生成中文长篇总纲。",
                "target_episode_count": 60,
            },
        )

    assert response.status_code == 200
    assert response.json()["data"]["version"] == 1
    assert response.json()["project_revision"] == 1
    assert response.json()["workspace_revision"] == 2

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        workspace_response = await client.put(
            "/story-projects/story_project.api_demo/workspace",
            json={
                "project_id": "story_project.api_demo",
                "revision": 3,
                "client_instance_id": "client.api_demo",
                "workspace_payload": {
                    "id": "story_project.api_demo",
                    "episodes": [{"episodeNumber": 1}],
                    "storyBibleVersion": 1,
                    "storyBibleStatus": "approved",
                },
                "updated_at": NOW.isoformat(),
            },
        )
        locked_response = await client.post(
            "/story-projects/story_project.api_demo/story-bibles/draft",
            json={
                "story_project_id": "story_project.api_demo",
                "content_spec_id": "content_spec.api_demo",
                "generation_strategy_id": "strategy.api_demo",
                "creative_prompt": "重新生成中文长篇总纲。",
                "target_episode_count": 60,
            },
        )

    assert workspace_response.status_code == 200
    assert locked_response.status_code == 409
    assert "locked after episode generation" in locked_response.json()["detail"]


@pytest.mark.anyio
async def test_top_level_story_generation_returns_visible_branches(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    first_branch = build_story_plan_node(
        node_id="story_plan.api_demo.first",
        parent_node_id="story_plan.api_demo.root",
        planned_start_episode=1,
        planned_end_episode=20,
    )

    class TopLevelStoryPlanningStub:
        def generate_top_level_story_plan_nodes(self, _payload):
            return [first_branch]

    app.dependency_overrides[get_story_planning_service] = (
        lambda: TopLevelStoryPlanningStub()
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/story-projects/story_project.api_demo/plan-nodes/top-level/draft",
            json={
                "story_project_id": "story_project.api_demo",
                "story_bible_id": "story_bible.api_demo",
                "story_bible_version": 1,
                "generation_strategy_id": "strategy.api_demo",
                "sequence_order": 1,
                "target_episode_count": 60,
            },
        )

    assert response.status_code == 200
    assert response.json()["data"][0]["node_id"] == first_branch.node_id


@pytest.mark.anyio
async def test_episode_roadmap_preserves_provider_rate_limit_status(
    long_story_app,
) -> None:
    app, _runtime = long_story_app

    class RateLimitedStoryPlanningStub:
        def generate_episode_plan_item(self, _payload):
            raise LLMRequestError(
                "exceeded retry limit, last status: 429 Too Many Requests",
                status_code=429,
                category="provider_http",
                recoverable=True,
            )

    app.dependency_overrides[get_story_planning_service] = (
        lambda: RateLimitedStoryPlanningStub()
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/story-projects/story_project.api_demo/plan-nodes/"
            "story_plan.api_demo.root/episode-plans/1/draft",
            json={
                "story_project_id": "story_project.api_demo",
                "source_node_id": "story_plan.api_demo.root",
                "source_node_version": 1,
                "generation_strategy_id": "strategy.api_demo",
                "episode_number": 1,
                "accepted_plans": [],
            },
        )

    assert response.status_code == 429
    assert response.json()["detail"] == (
        "剧情规划模型当前请求较多，已保存的规划内容不会丢失，请稍后继续。"
    )
    assert "Too Many Requests" not in response.text


@pytest.mark.anyio
async def test_episode_roadmap_modification_route_validates_path_and_returns_candidate(
    long_story_app,
) -> None:
    app, _runtime = long_story_app

    class EpisodeModificationStub:
        def modify_episode_plan_item(self, payload):
            return payload.current_plan.model_copy(
                update={"episode_goal": "迫使中间人当场交出原始凭证。"}
            )

    app.dependency_overrides[get_story_planning_service] = (
        lambda: EpisodeModificationStub()
    )
    current_plan = {
        "episode_number": 1,
        "episode_goal": "验证旧账本的来源。",
        "entry_state": "主角刚取得一份来源不明的旧账本。",
        "central_conflict": "公开账本会立刻暴露证人。",
        "protagonist_decision": "主角决定先保护证人再验证账本。",
        "reveal": "账本的时间戳曾被人改写。",
        "emotional_movement": "从急于公开转为克制取证。",
        "stage_opposition": "中间人正在销毁原始凭证。",
        "episode_payoff": "主角保住证人并固定原始凭证。",
        "pressure_escalation": "原始凭证指向更高层的操控者。",
        "exit_state": "主角取得下一步可验证的资金入口。",
        "cliffhanger": "资金入口出现主角熟悉的签名。",
        "character_refs": ["character.mara"],
        "story_line_refs": ["storyline.truth_network"],
    }
    payload = {
        "story_project_id": "story_project.api_demo",
        "source_node_id": "story_plan.api_demo.root",
        "source_node_version": 1,
        "generation_strategy_id": "strategy.api_demo",
        "episode_number": 1,
        "accepted_plans": [],
        "revision_mode": "targeted",
        "instruction": "增强本集的可见行动回报。",
        "current_plan": current_plan,
    }

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/story-projects/story_project.api_demo/plan-nodes/"
            "story_plan.api_demo.root/episode-plans/1/modify",
            json=payload,
        )
        mismatch = await client.post(
            "/story-projects/story_project.api_demo/plan-nodes/"
            "story_plan.api_demo.root/episode-plans/2/modify",
            json=payload,
        )

    assert response.status_code == 200, response.text
    assert response.json()["data"]["episode_goal"] == "迫使中间人当场交出原始凭证。"
    assert mismatch.status_code == 409


@pytest.mark.anyio
async def test_long_story_api_returns_503_without_database_configuration(
    monkeypatch,
) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    get_long_story_database_runtime.cache_clear()
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/story-projects")
    get_long_story_database_runtime.cache_clear()
    assert response.status_code == 503
    assert "DATABASE_URL" in response.json()["detail"]


@pytest.mark.anyio
async def test_generation_task_checkpoint_can_resume_and_complete(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        project_response = await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        running_payload = {
            "batch": {
                "batch_id": "generation_batch.api_demo.1",
                "revision": 1,
                "story_project_id": "story_project.api_demo",
                "batch_number": 1,
                "start_episode": 1,
                "end_episode": 2,
                "episode_plan_ids": [
                    "episode_plan.api_demo.001",
                    "episode_plan.api_demo.002",
                ],
                "status": "running",
                "created_at": NOW.isoformat(),
            },
            "checkpoint": {
                "job_id": "generation_job.api_demo.1",
                "revision": 1,
                "batch_id": "generation_batch.api_demo.1",
                "status": "running",
                "attempt_count": 1,
                "completed_episode_numbers": [],
                "failed_episode_numbers": [],
                "checkpointed_at": NOW.isoformat(),
            },
        }
        saved_response = await client.put(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation_job.api_demo.1",
            json=running_payload,
        )
        paused_payload = {
            **running_payload,
            "batch": {
                **running_payload["batch"],
                "revision": 2,
                "status": "paused",
            },
            "checkpoint": {
                **running_payload["checkpoint"],
                "revision": 2,
                "status": "paused",
            },
        }
        paused_response = await client.put(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation_job.api_demo.1",
            json=paused_payload,
        )
        paused_recovery_response = await client.get(
            "/story-projects/story_project.api_demo/generation-tasks/recoverable"
        )
        resumed_payload = {
            **paused_payload,
            "batch": {
                **paused_payload["batch"],
                "revision": 3,
                "status": "running",
            },
            "checkpoint": {
                **paused_payload["checkpoint"],
                "revision": 3,
                "status": "running",
            },
        }
        resumed_response = await client.put(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation_job.api_demo.1",
            json=resumed_payload,
        )
        partial_payload = {
            **resumed_payload,
            "batch": {
                **resumed_payload["batch"],
                "revision": 4,
                "status": "partial",
            },
            "checkpoint": {
                **resumed_payload["checkpoint"],
                "revision": 4,
                "status": "partial",
                "completed_episode_numbers": [1],
                "failed_episode_numbers": [2],
                "last_error": "model connection interrupted",
            },
        }
        partial_response = await client.put(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation_job.api_demo.1",
            json=partial_payload,
        )
        recovery_response = await client.get(
            "/story-projects/story_project.api_demo/generation-tasks/recoverable"
        )
        completed_payload = {
            **partial_payload,
            "batch": {
                **partial_payload["batch"],
                "revision": 5,
                "status": "completed",
                "completed_at": NOW.isoformat(),
            },
            "checkpoint": {
                **partial_payload["checkpoint"],
                "revision": 5,
                "status": "completed",
                "completed_episode_numbers": [1, 2],
                "failed_episode_numbers": [],
                "last_error": None,
            },
        }
        completed_response = await client.put(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation_job.api_demo.1",
            json=completed_payload,
        )
        empty_recovery_response = await client.get(
            "/story-projects/story_project.api_demo/generation-tasks/recoverable"
        )

    assert project_response.status_code == 200
    assert saved_response.status_code == 200
    assert paused_response.status_code == 200, paused_response.text
    assert paused_recovery_response.status_code == 200
    assert paused_recovery_response.json()["data"]["checkpoint"]["status"] == "paused"
    assert resumed_response.status_code == 200, resumed_response.text
    assert partial_response.status_code == 200, partial_response.text
    assert recovery_response.status_code == 200
    assert recovery_response.json()["data"]["checkpoint"]["completed_episode_numbers"] == [1]
    assert completed_response.status_code == 200
    assert empty_recovery_response.status_code == 200
    assert empty_recovery_response.json()["data"] is None
