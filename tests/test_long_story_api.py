from datetime import datetime, timezone
import hashlib

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
from app.modules.script_engine.llm_adapter import LLMRequestError
from app.modules.script_engine.long_story_models import (
    EpisodePlan,
    GenerationBatchPlan,
    GenerationJobCheckpoint,
    GenerationTaskCheckpoint,
    PlanningApprovalStatus,
    StoryBible,
    StoryPlanNode,
    StoryProject,
    StoryStagePlan,
)
from app.modules.script_engine.long_story_repository import LongStoryRepository
from app.modules.script_engine.long_story_service import LongStoryService


NOW = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)


def build_project(
    *,
    revision: int = 1,
    title: str = "The Price of Truth",
    output_language: str = "zh",
) -> StoryProject:
    return StoryProject(
        project_id="story_project.api_demo",
        revision=revision,
        title=title,
        content_spec_id="content_spec.api_demo",
        output_language=output_language,
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


def build_generation_task() -> GenerationTaskCheckpoint:
    batch = GenerationBatchPlan(
        batch_id="generation-batch.api_demo.001",
        story_project_id="story_project.api_demo",
        batch_number=1,
        start_episode=1,
        end_episode=2,
        episode_plan_ids=[
            "episode-plan.api_demo.001",
            "episode-plan.api_demo.002",
        ],
        status="running",
        created_at=NOW,
    )
    return GenerationTaskCheckpoint(
        batch=batch,
        checkpoint=GenerationJobCheckpoint(
            job_id="generation-job.api_demo.001",
            batch_id=batch.batch_id,
            status="running",
            attempt_count=1,
            completed_episode_numbers=[1],
            checkpointed_at=NOW,
        ),
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


def build_episode_plan_materialization_payload(
    *,
    target_node_version: int = 1,
    source_fingerprint: str | None = None,
) -> dict:
    source_document = "第1集\n本集目标：找到钥匙"
    fields = {
        "episode_title": None,
        "synopsis": None,
        "episode_goal": "找到钥匙",
        "entry_state": None,
        "central_conflict": None,
        "protagonist_decision": None,
        "reveal": None,
        "emotional_movement": None,
        "stage_opposition": None,
        "episode_payoff": None,
        "pressure_escalation": None,
        "exit_state": None,
        "cliffhanger": None,
        "ending_hook_type": None,
        "next_episode_obligation": None,
        "locations": [],
        "character_refs": [],
        "story_line_refs": [],
        "setup_refs": [],
        "payoff_refs": [],
        "source_turning_points": [],
        "source_unit_story_beats": [],
    }
    unresolved_fields = [
        field
        for field, value in fields.items()
        if value is None or value == []
    ]
    return {
        "schema_version": "episode_plan_materialization.v1",
        "draft_schema_version": "episode_plan_import.v1",
        "adapter_version": "heading-segment-v1",
        "source_document": source_document,
        "source_fingerprint": source_fingerprint or (
            f"sha256:{hashlib.sha256(source_document.encode('utf-8')).hexdigest()}"
        ),
        "fingerprint_algorithm": "sha256",
        "story_bible_id": "story_bible.api_demo",
        "story_bible_version": 1,
        "mappings": [{
            "episode_number": 1,
            "source_row_ordinal": 0,
            "source_start": 0,
            "source_end": len(source_document),
            "source_raw_text": source_document,
            "target_node_id": "story_plan.api_demo.root",
            "target_node_version": target_node_version,
            "target_episode_start": 1,
            "target_episode_end": 8,
            "fields": fields,
            "field_provenance": {
                "episode_goal": {
                    "source": "source",
                    "row_ordinal": 0,
                    "episode_number": 1,
                    "field": "episode_goal",
                    "value": "找到钥匙",
                    "span": {"start": 4, "end": len(source_document)},
                }
            },
            "unresolved_fields": unresolved_fields,
            "review_required": True,
        }],
        "unresolved_fields": [{
            "episode_number": 1,
            "row_ordinal": 0,
            "fields": unresolved_fields,
        }],
        "review_required": True,
        "preview_status": "staging",
        "preview_created_at": NOW.isoformat(),
        "author_confirmed_at": NOW.isoformat(),
        "confirmed_by": "author",
    }


def seed_episode_plan_materialization_lineage(runtime) -> None:
    project = build_project().model_copy(update={
        "active_story_bible_id": "story_bible.api_demo",
        "active_story_bible_version": 1,
    })
    story_bible = build_story_bible().model_copy(update={
        "status": PlanningApprovalStatus.approved,
        "approved_at": NOW,
    })
    node = build_story_plan_node(
        planned_start_episode=1,
        planned_end_episode=8,
        expansion_status="episode_ready",
    ).model_copy(update={
        "unit_story_beats": ["beat 1", "beat 2", "beat 3", "beat 4"],
        "unit_resolution": "Mara secures the verified record.",
        "handoff_pressure": "The source is placed in immediate danger.",
        "status": PlanningApprovalStatus.approved,
        "approved_at": NOW,
    })
    with runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(project)
        repository.save_story_bible(story_bible)
        repository.save_story_plan_node(node)


def test_script_phase_guard_accepts_only_complete_tree_and_roadmap_coverage() -> None:
    project = build_project().model_copy(update={
        "active_story_bible_id": "story_bible.api_demo",
        "active_story_bible_version": 1,
    })
    story_bible = build_story_bible().model_copy(update={
        "status": PlanningApprovalStatus.approved,
        "approved_at": NOW,
    })
    root = build_story_plan_node(
        planned_start_episode=1,
        planned_end_episode=60,
        expansion_status="expanded",
    ).model_copy(update={
        "status": PlanningApprovalStatus.approved,
        "approved_at": NOW,
    })
    leaves = []
    roadmaps = []
    for index in range(6):
        start_episode = index * 10 + 1
        end_episode = start_episode + 9
        leaf = build_story_plan_node(
            node_id=f"story_plan.api_demo.leaf_{index + 1}",
            parent_node_id=root.node_id,
            sequence_order=index + 1,
            planned_start_episode=start_episode,
            planned_end_episode=end_episode,
            expansion_status="episode_ready",
        ).model_copy(update={
            "status": PlanningApprovalStatus.approved,
            "approved_at": NOW,
        })
        leaves.append(leaf)
        roadmaps.extend({
            "source_node_id": leaf.node_id,
            "source_node_version": leaf.version,
            "story_bible_version": 1,
            "status": "approved",
            "episode_number": episode_number,
        } for episode_number in range(start_episode, end_episode + 1))

    class CompletePlanningRepository:
        @staticmethod
        def get_story_bible(story_bible_id: str, *, version: int):
            assert story_bible_id == story_bible.story_bible_id
            assert version == story_bible.version
            return story_bible

        @staticmethod
        def list_story_plan_nodes(*_args, **_kwargs):
            return [root, *leaves]

        @staticmethod
        def get_workspace_snapshot(_project_id: str):
            return type("Workspace", (), {
                "workspace_payload": {"episodeRoadmaps": roadmaps},
            })()

    LongStoryService._require_complete_planning_before_script(
        CompletePlanningRepository(),
        project,
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
async def test_episode_plan_materialization_is_atomic_draft_and_idempotent(
    long_story_app,
) -> None:
    app, runtime = long_story_app
    seed_episode_plan_materialization_lineage(runtime)
    payload = build_episode_plan_materialization_payload()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        saved = await client.post(
            "/story-projects/story_project.api_demo/episode-plan-materializations",
            json=payload,
        )
        replay_payload = {
            **payload,
            "author_confirmed_at": "2026-08-01T09:05:00Z",
        }
        replayed = await client.post(
            "/story-projects/story_project.api_demo/episode-plan-materializations",
            json=replay_payload,
        )
        listed = await client.get(
            "/story-projects/story_project.api_demo/episode-plan-materializations",
            params={
                "story_bible_id": "story_bible.api_demo",
                "story_bible_version": 1,
            },
        )

    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["status"] == "draft"
    assert saved.json()["data"]["confirmed_by"] == "author"
    assert replayed.status_code == 200, replayed.text
    assert replayed.json()["data"]["materialization_id"] == (
        saved.json()["data"]["materialization_id"]
    )
    assert replayed.json()["data"]["author_confirmed_at"] == (
        saved.json()["data"]["author_confirmed_at"]
    )
    assert listed.status_code == 200, listed.text
    assert len(listed.json()["data"]) == 1


@pytest.mark.anyio
async def test_episode_plan_materialization_rejects_stale_batch_without_partial_write(
    long_story_app,
) -> None:
    app, runtime = long_story_app
    seed_episode_plan_materialization_lineage(runtime)
    payload = build_episode_plan_materialization_payload(target_node_version=2)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        rejected = await client.post(
            "/story-projects/story_project.api_demo/episode-plan-materializations",
            json=payload,
        )
        listed = await client.get(
            "/story-projects/story_project.api_demo/episode-plan-materializations",
        )

    assert rejected.status_code == 409, rejected.text
    assert "target node" in rejected.json()["detail"].lower()
    assert listed.status_code == 200, listed.text
    assert listed.json()["data"] == []


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("field_name", "identity_key"),
    [
        ("episodes", "episodeNumber"),
        ("episodeRoadmaps", "episode_number"),
        ("episodePlanMaterializations", "materializationId"),
    ],
)
@pytest.mark.parametrize(
    "invalid_shape",
    ["null", "object", "non_object_item", "missing_identity", "invalid_identity"],
)
async def test_episode_plan_materialization_rejects_malformed_workspace_occupancy(
    long_story_app,
    field_name: str,
    identity_key: str,
    invalid_shape: str,
) -> None:
    app, runtime = long_story_app
    seed_episode_plan_materialization_lineage(runtime)
    invalid_value = {
        "null": None,
        "object": {},
        "non_object_item": [None],
        "missing_identity": [{}],
        "invalid_identity": [{identity_key: []}],
    }[invalid_shape]
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        saved_workspace = await client.put(
            "/story-projects/story_project.api_demo/workspace",
            json={
                "project_id": "story_project.api_demo",
                "revision": 1,
                "client_instance_id": "client.materialization_audit",
                "workspace_payload": {
                    "id": "story_project.api_demo",
                    field_name: invalid_value,
                },
            },
        )
        rejected = await client.post(
            "/story-projects/story_project.api_demo/episode-plan-materializations",
            json=build_episode_plan_materialization_payload(),
        )
        listed = await client.get(
            "/story-projects/story_project.api_demo/episode-plan-materializations",
        )

    assert saved_workspace.status_code == 200, saved_workspace.text
    assert rejected.status_code == 409, rejected.text
    assert field_name in rejected.json()["detail"]
    assert "malformed" in rejected.json()["detail"]
    assert listed.status_code == 200, listed.text
    assert listed.json()["data"] == []


@pytest.mark.anyio
@pytest.mark.parametrize("ancestor_depth", [1, 2])
@pytest.mark.parametrize(
    "ancestor_change",
    ["draft", "replaced_approved", "replaced_draft", "replay_after_replacement"],
)
async def test_episode_plan_materialization_rejects_inactive_ancestor_lineage(
    long_story_app,
    ancestor_depth: int,
    ancestor_change: str,
) -> None:
    app, runtime = long_story_app
    project = build_project().model_copy(update={
        "active_story_bible_id": "story_bible.api_demo",
        "active_story_bible_version": 1,
    })
    story_bible = build_story_bible().model_copy(update={
        "status": PlanningApprovalStatus.approved,
        "approved_at": NOW,
    })
    ancestors = []
    for index in range(ancestor_depth):
        ancestor = build_story_plan_node(
            node_id=f"story_plan.api_demo.ancestor_{index}",
            parent_node_id=ancestors[-1].node_id if ancestors else None,
            planned_start_episode=1,
            planned_end_episode=60,
            expansion_status="expanded",
        ).model_copy(update={
            "status": PlanningApprovalStatus.approved,
            "approved_at": NOW,
        })
        ancestors.append(ancestor)
    if ancestor_change == "draft":
        ancestors[0] = ancestors[0].model_copy(update={
            "status": PlanningApprovalStatus.draft,
            "approved_at": None,
        })
    leaf = build_story_plan_node(
        parent_node_id=ancestors[-1].node_id,
        planned_start_episode=1,
        planned_end_episode=8,
        expansion_status="episode_ready",
    ).model_copy(update={
        "unit_story_beats": ["beat 1", "beat 2", "beat 3", "beat 4"],
        "unit_resolution": "Mara secures the verified record.",
        "handoff_pressure": "The source is placed in immediate danger.",
        "status": PlanningApprovalStatus.approved,
        "approved_at": NOW,
    })
    with runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(project)
        repository.save_story_bible(story_bible)
        for node in (*ancestors, leaf):
            repository.save_story_plan_node(node)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        url = "/story-projects/story_project.api_demo/episode-plan-materializations"
        payload = build_episode_plan_materialization_payload()
        saved = None
        if ancestor_change == "replay_after_replacement":
            saved = await client.post(url, json=payload)
            replayed = await client.post(url, json=payload)
            assert saved.status_code == replayed.status_code == 200
            assert replayed.json()["data"] == saved.json()["data"]
        if ancestor_change != "draft":
            approved_replacement = ancestor_change == "replaced_approved"
            replacement = ancestors[0].model_copy(update={
                "version": 2,
                "status": (
                    PlanningApprovalStatus.approved
                    if approved_replacement
                    else PlanningApprovalStatus.draft
                ),
                "approved_at": NOW if approved_replacement else None,
            })
            replaced = await client.put(
                "/story-projects/story_project.api_demo/plan-nodes/"
                f"{replacement.node_id}/versions/2",
                json=replacement.model_dump(mode="json"),
            )
            assert replaced.status_code == 200, replaced.text
        rejected = await client.post(url, json=payload)
        listed = await client.get(url)

    assert rejected.status_code == 409, rejected.text
    assert "ancestor" in rejected.json()["detail"]
    assert listed.status_code == 200, listed.text
    assert listed.json()["data"] == ([saved.json()["data"]] if saved else [])


@pytest.mark.anyio
async def test_generation_task_can_be_reloaded_by_exact_job_id(long_story_app) -> None:
    app, _runtime = long_story_app
    task = build_generation_task()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        saved = await client.put(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation-job.api_demo.001",
            json=task.model_dump(mode="json"),
        )
        loaded = await client.get(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation-job.api_demo.001"
        )
        missing = await client.get(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation-job.api_demo.missing"
        )

    assert saved.status_code == 200, saved.text
    assert loaded.status_code == 200, loaded.text
    assert loaded.json()["data"] == saved.json()["data"]
    assert missing.status_code == 200
    assert missing.json()["data"] is None


@pytest.mark.anyio
async def test_long_story_planning_api_persists_complete_planning_slice(
    long_story_app,
) -> None:
    app, runtime = long_story_app
    episode_payload = build_episode_plan().model_dump(mode="json")
    episode_payload["dramatic_units"] = [{
        "trigger": "The witness refuses to release the timestamp without a guarantee.",
        "choice": "Mara leaves her own address as the guarantee.",
        "visible_consequence": "The witness releases the record and sends a guard to her home.",
        "change_type": "safety and commitment",
        "evidence_hint": "The guard copies Mara's address before leaving.",
    }]
    episode_payload["protagonist_cost"] = "Mara can no longer use her home as a hiding place."
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
            json=episode_payload,
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
        assert episode_list.json()["data"][0]["dramatic_units"] == episode_payload["dramatic_units"]
        assert episode_list.json()["data"][0]["protagonist_cost"] == episode_payload["protagonist_cost"]

    restarted_app = create_app()
    restarted_app.dependency_overrides[get_long_story_service] = (
        lambda: LongStoryService(runtime)
    )
    async with AsyncClient(
        transport=ASGITransport(app=restarted_app),
        base_url="http://testserver",
    ) as client:
        persisted = await client.get("/story-projects/story_project.api_demo")
        persisted_episodes = await client.get(
            "/story-projects/story_project.api_demo/episode-plans?"
            "start_episode=1&end_episode=1"
        )
    assert persisted.status_code == 200
    assert persisted.json()["data"]["title"] == "The Price of Truth"
    assert persisted_episodes.status_code == 200
    assert persisted_episodes.json()["data"][0]["dramatic_units"] == episode_payload["dramatic_units"]
    assert persisted_episodes.json()["data"][0]["protagonist_cost"] == episode_payload["protagonist_cost"]


@pytest.mark.anyio
async def test_story_bible_rejects_cross_project_version_without_blocking_owner(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    owner = build_project()
    other = owner.model_copy(update={
        "project_id": "story_project.other",
        "content_spec_id": "content_spec.other",
    })
    bible = build_story_bible()
    owner_url = (
        f"/story-projects/{owner.project_id}/story-bibles/{bible.story_bible_id}"
    )
    other_url = (
        f"/story-projects/{other.project_id}/story-bibles/{bible.story_bible_id}"
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        for project in (owner, other):
            created = await client.put(
                f"/story-projects/{project.project_id}",
                json=project.model_dump(mode="json"),
            )
            assert created.status_code == 200, created.text

        initial_response = await client.put(
            f"{owner_url}/versions/1",
            json=bible.model_dump(mode="json"),
        )
        assert initial_response.status_code == 200, initial_response.text
        initial_draft = initial_response.json()["data"]

        conflicting_response = await client.put(
            f"{other_url}/versions/2",
            json={
                **initial_draft,
                "story_project_id": other.project_id,
                "content_spec_id": other.content_spec_id,
                "version": 2,
                "theme": "Another project's competing draft.",
            },
        )
        assert conflicting_response.status_code == 409, conflicting_response.text
        assert conflicting_response.json()["detail"] == (
            "Story Bible identity already belongs to another Story Project."
        )

        owner_latest = await client.get(owner_url)
        assert owner_latest.status_code == 200, owner_latest.text
        assert owner_latest.json()["data"] == initial_draft
        other_latest = await client.get(other_url)
        assert other_latest.status_code == 404, other_latest.text

        saved_response = await client.put(
            f"{owner_url}/versions/2",
            json={
                **initial_draft,
                "version": 2,
                "theme": "The original author can continue developing the truth.",
            },
        )
        assert saved_response.status_code == 200, saved_response.text
        saved_draft = saved_response.json()["data"]
        confirmed_response = await client.put(
            f"{owner_url}/versions/3",
            json={
                **saved_draft,
                "version": 3,
                "status": "approved",
                "approved_at": NOW.isoformat(),
            },
        )
        assert confirmed_response.status_code == 200, confirmed_response.text
        assert confirmed_response.json()["data"]["theme"] == saved_draft["theme"]

        owner_latest = await client.get(owner_url)
        assert owner_latest.status_code == 200, owner_latest.text
        assert owner_latest.json()["data"] == confirmed_response.json()["data"]
        historical = await client.get(owner_url, params={"version": 1})
        assert historical.status_code == 200, historical.text
        assert historical.json()["data"] == initial_draft
        owner_project = await client.get(f"/story-projects/{owner.project_id}")
        assert owner_project.status_code == 200, owner_project.text
        assert owner_project.json()["data"]["active_story_bible_id"] == bible.story_bible_id
        assert owner_project.json()["data"]["active_story_bible_version"] == 3
        other_project = await client.get(f"/story-projects/{other.project_id}")
        assert other_project.status_code == 200, other_project.text
        assert other_project.json()["data"]["active_story_bible_id"] is None


@pytest.mark.anyio
async def test_story_bible_requires_save_before_confirm_and_unchanged_revision_clone(
    long_story_app,
) -> None:
    app, _runtime = long_story_app
    story_bible_url = (
        "/story-projects/story_project.api_demo/story-bibles/"
        "story_bible.api_demo/versions"
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        project_response = await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        assert project_response.status_code == 200

        draft_response = await client.put(
            f"{story_bible_url}/1",
            json=build_story_bible().model_dump(mode="json"),
        )
        assert draft_response.status_code == 200
        initial_draft = draft_response.json()["data"]

        changed_confirmation = await client.put(
            f"{story_bible_url}/2",
            json={
                **initial_draft,
                "version": 2,
                "status": "approved",
                "theme": "Truth costs more when it is delayed.",
                "approved_at": NOW.isoformat(),
            },
        )
        assert changed_confirmation.status_code == 409
        assert "save" in changed_confirmation.json()["detail"].lower()

        saved_draft_response = await client.put(
            f"{story_bible_url}/2",
            json={
                **initial_draft,
                "version": 2,
                "theme": "Truth costs more when it is delayed.",
            },
        )
        assert saved_draft_response.status_code == 200
        saved_draft = saved_draft_response.json()["data"]

        confirmed_response = await client.put(
            f"{story_bible_url}/3",
            json={
                **saved_draft,
                "version": 3,
                "status": "approved",
                "approved_at": NOW.isoformat(),
            },
        )
        assert confirmed_response.status_code == 200
        confirmed = confirmed_response.json()["data"]

        changed_revision = await client.put(
            f"{story_bible_url}/4",
            json={
                **confirmed,
                "version": 4,
                "status": "draft",
                "theme": "A new theme cannot bypass the revision boundary.",
                "approved_at": None,
            },
        )
        assert changed_revision.status_code == 409
        assert "unchanged editable" in changed_revision.json()["detail"].lower()

        editable_clone_response = await client.put(
            f"{story_bible_url}/4",
            json={
                **confirmed,
                "version": 4,
                "status": "draft",
                "approved_at": None,
            },
        )
        assert editable_clone_response.status_code == 200
        editable_clone = editable_clone_response.json()["data"]

        revised_draft_response = await client.put(
            f"{story_bible_url}/5",
            json={
                **editable_clone,
                "version": 5,
                "theme": "A confirmed story can change only in an explicit new draft.",
            },
        )
        assert revised_draft_response.status_code == 200
        revised_draft = revised_draft_response.json()["data"]

        reconfirmed_response = await client.put(
            f"{story_bible_url}/6",
            json={
                **revised_draft,
                "version": 6,
                "status": "approved",
                "approved_at": NOW.isoformat(),
            },
        )

    assert reconfirmed_response.status_code == 200
    assert reconfirmed_response.json()["data"]["status"] == "approved"
    assert (
        reconfirmed_response.json()["data"]["theme"]
        == "A confirmed story can change only in an explicit new draft."
    )


@pytest.mark.anyio
async def test_story_bible_versions_inherit_overseas_project_market_route(
    long_story_app,
) -> None:
    app, runtime = long_story_app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        project_response = await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project(output_language="en").model_dump(mode="json"),
        )
        assert project_response.status_code == 200

        first_response = await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/1",
            json=build_story_bible().model_dump(mode="json"),
        )
        assert first_response.status_code == 200
        assert "market_profile" not in first_response.json()["data"]

        second_payload = {
            **first_response.json()["data"],
            "version": 2,
            "status": "draft",
            "approved_at": None,
        }
        second_response = await client.put(
            "/story-projects/story_project.api_demo/story-bibles/"
            "story_bible.api_demo/versions/2",
            json=second_payload,
        )
        assert second_response.status_code == 200

    with runtime.session() as session:
        repository = LongStoryRepository(session)
        persisted = repository.get_story_bible("story_bible.api_demo", version=2)
        assert persisted is not None
        assert persisted.market_profile == "overseas_tiktok"

        # Simulate a historical version saved before market metadata inheritance.
        repository.save_story_bible(
            StoryBible.model_validate({**second_payload, "version": 3})
        )

    repaired = LongStoryService(runtime).get_story_bible(
        "story_project.api_demo",
        "story_bible.api_demo",
        version=3,
    )
    assert repaired.market_profile == "overseas_tiktok"

    regenerated = LongStoryService(runtime).save_generated_story_bible_draft(
        StoryBible.model_validate({
            **second_payload,
            "version": 99,
            "market_profile": "cn_mainland",
        })
    )
    assert regenerated.version == 4
    assert regenerated.market_profile == "overseas_tiktok"


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

        # A revision is review material only; it must not create or win the
        # continuity projection before a canonical artifact is confirmed.
        derived_preview = {
            "schema_version": "v1",
            "artifact_id": "artifact.api_demo.episode_0001.revision_preview",
            "story_project_id": "story_project.api_demo",
            "episode_number": 1,
            "artifact_kind": "revised",
            "memory_layer": "derived",
            "content_schema_version": "revised_draft_master_script.v1",
            "content_payload": {"synopsis": "Unconfirmed revision preview."},
            "lineage_refs": {},
            "created_at": NOW.isoformat(),
        }
        preview_response = await client.post(
            "/story-projects/story_project.api_demo/episodes/1/artifacts",
            json=derived_preview,
        )
        assert preview_response.status_code == 200, preview_response.text
        assert (await client.get(
            "/story-projects/story_project.api_demo/continuity-ledger/latest"
        )).json()["data"] is None
        assert (await client.get(
            "/story-projects/story_project.api_demo/episodes/1/artifacts/"
            "artifact.api_demo.episode_0001.revision_preview/event-set"
        )).json()["data"] is None

        first_artifact = {
            "schema_version": "v1",
            "artifact_id": "artifact.api_demo.episode_0001.draft",
            "story_project_id": "story_project.api_demo",
            "episode_number": 1,
            "artifact_kind": "draft",
            "memory_layer": "canonical",
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
        assert ledger["source_artifact_id"] == first_artifact["artifact_id"]
        event_set = (await client.get(
            "/story-projects/story_project.api_demo/episodes/1/artifacts/"
            "artifact.api_demo.episode_0001.draft/event-set"
        )).json()["data"]
        events = (await client.get(
            "/story-projects/story_project.api_demo/episodes/1/events"
        )).json()["data"]
        assert event_set["source_artifact_id"] == first_artifact["artifact_id"]
        assert event_set["status"] == "validated"
        assert event_set["memory_layer"] == "canonical"
        assert len(event_set["event_ids"]) == len(events)
        assert {event["event_type"] for event in events} >= {
            "episode_summary",
            "character_state_changed",
            "world_state_changed",
            "story_line_progressed",
            "hook_emitted",
        }
        assert all(
            event["source_artifact_id"] == first_artifact["artifact_id"]
            and event["memory_layer"] == "canonical"
            and event["evidence_refs"]
            for event in events
        )
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
            "memory_layer": "derived",
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

        rebuilt_response = await client.post(
            "/story-projects/story_project.api_demo/continuity-ledger/rebuild"
        )
        assert rebuilt_response.status_code == 200, rebuilt_response.text
        rebuilt = rebuilt_response.json()["data"]
        assert rebuilt["version"] == 4
        assert rebuilt["through_episode_number"] == 2
        assert rebuilt["source_artifact_id"] == second_artifact["artifact_id"]
        assert rebuilt["character_states"][0]["life_status"] == "dead"
        assert rebuilt["setup_payoffs"][0]["status"] == "paid_off"

        audit_response = await client.get(
            "/story-projects/story_project.api_demo/continuity-ledger/audit"
        )
        assert audit_response.status_code == 200, audit_response.text
        audit = audit_response.json()["data"]
        assert audit["status"] == "consistent"
        assert audit["ledger_version"] == 4
        assert audit["event_set_count"] == 2
        assert audit["event_count"] >= len(events)

        rollback_response = await client.post(
            "/story-projects/story_project.api_demo/continuity-ledger/rollback",
            json={"target_version": 2, "expected_current_version": 4},
        )
        assert rollback_response.status_code == 200, rollback_response.text
        rolled_back = rollback_response.json()["data"]
        assert rolled_back["version"] == 5
        assert rolled_back["restored_from_version"] == 2
        assert rolled_back["through_episode_number"] == 2

        stale_rollback = await client.post(
            "/story-projects/story_project.api_demo/continuity-ledger/rollback",
            json={"target_version": 1, "expected_current_version": 4},
        )
        assert stale_rollback.status_code == 409


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
@pytest.mark.parametrize("total,resolution,pressure,expected", [
    (8, "人物完成既定选择，主要冲突已经收束。", None, 200),
    (8, None, None, 409),
    (16, "人物取得当前阶段所需的证据。", None, 409),
    (16, "人物取得当前阶段所需的证据。", "证据使下一段的责任追查成为必要。", 200),
])
async def test_final_story_leaf_can_close_without_inventing_future_pressure(
    long_story_app, total, resolution, pressure, expected,
) -> None:
    app, _runtime = long_story_app
    node = build_story_plan_node(
        planned_start_episode=1, planned_end_episode=8, expansion_status="episode_ready",
    ).model_copy(update={
        "unit_story_beats": ["人物明确当前目标。", "行动遭遇实际阻力。", "人物选择并承担代价。", "结果得到当场确认。"],
        "unit_resolution": resolution, "handoff_pressure": pressure,
        "status": PlanningApprovalStatus.approved, "approved_at": NOW,
    })
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await client.put("/story-projects/story_project.api_demo", json=build_project().model_copy(
            update={"planned_episode_count": total},
        ).model_dump(mode="json"))
        await client.put("/story-projects/story_project.api_demo/story-bibles/story_bible.api_demo/versions/1",
                         json=build_story_bible().model_dump(mode="json"))
        response = await client.put(
            f"/story-projects/story_project.api_demo/plan-nodes/{node.node_id}/versions/{node.version}",
            json=node.model_dump(mode="json"),
        )
    assert response.status_code == expected
    if expected == 200:
        assert response.json()["data"]["handoff_pressure"] == pressure


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
        "preproduction_storyboards": 0,
        "agent_steps": 0,
        "agent_runs": 0,
        "generation_job_checkpoints": 0,
        "episode_artifact_versions": 0,
        "generation_batches": 0,
        "episode_plan_materializations": 0,
        "episode_plan_versions": 1,
        "continuity_ledger_versions": 0,
        "story_plan_node_versions": 0,
        "story_stage_plan_versions": 1,
        "story_project_workspace_snapshots": 1,
        "planning_sessions": 0,
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
async def test_planning_session_api_is_versioned_and_recoverable(long_story_app) -> None:
    app, _runtime = long_story_app
    session_payload = {
        "schema_version": "v1",
        "session_id": "planning.story_project.api_demo",
        "story_project_id": "story_project.api_demo",
        "revision": 1,
        "phase": "story_tree",
        "status": "awaiting_review",
        "story_bible_author_instruction": "保留人物之间的互不信任。",
        "tree_author_instruction": "先推进主线冲突，不要提前揭示最终真相。",
        "active_node_id": "story_plan.api_demo.root",
        "reviewed_node_ids": [],
        "turns": [{
            "turn_id": "turn.api_demo.001",
            "scope": "story_tree",
            "node_id": None,
            "instruction": "先推进主线冲突，不要提前揭示最终真相。",
            "selected_candidate_titles": [],
            "outcome": "proposed",
            "created_at": NOW.isoformat(),
        }],
        "started_at": NOW.isoformat(),
        "updated_at": NOW.isoformat(),
    }
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        created_project = await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        assert created_project.status_code == 200
        created = await client.put(
            "/story-projects/story_project.api_demo/planning-session",
            json={
                "project_id": "story_project.api_demo",
                "client_instance_id": "client.api_demo",
                "session": session_payload,
            },
        )
        loaded = await client.get(
            "/story-projects/story_project.api_demo/planning-session",
        )
        stale = await client.put(
            "/story-projects/story_project.api_demo/planning-session",
            json={
                "project_id": "story_project.api_demo",
                "client_instance_id": "client.api_demo",
                "session": {
                    **session_payload,
                    "tree_author_instruction": "尝试直接解决最终谜团。",
                },
            },
        )
        next_revision = await client.put(
            "/story-projects/story_project.api_demo/planning-session",
            json={
                "project_id": "story_project.api_demo",
                "client_instance_id": "client.api_demo",
                "session": {
                    **session_payload,
                    "revision": 2,
                    "tree_author_instruction": "提高中段反转密度，但保留未解压力。",
                },
            },
        )

    assert created.status_code == 200, created.text
    assert created.json()["data"]["revision"] == 1
    assert loaded.status_code == 200
    assert loaded.json()["data"]["tree_author_instruction"] == session_payload["tree_author_instruction"]
    assert loaded.json()["data"]["turns"][0]["outcome"] == "proposed"
    assert stale.status_code == 409
    assert next_revision.status_code == 200
    assert next_revision.json()["data"]["revision"] == 2


@pytest.mark.anyio
async def test_planning_session_rejects_script_phase_before_roadmaps_complete(
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
        response = await client.put(
            "/story-projects/story_project.api_demo/planning-session",
            json={
                "project_id": "story_project.api_demo",
                "client_instance_id": "client.api_demo",
                "session": {
                    "schema_version": "v1",
                    "session_id": "planning.story_project.api_demo",
                    "story_project_id": "story_project.api_demo",
                    "revision": 1,
                    "phase": "script",
                    "status": "active",
                    "story_bible_author_instruction": "",
                    "tree_author_instruction": "",
                    "reviewed_node_ids": [],
                    "turns": [],
                    "updated_at": NOW.isoformat(),
                },
            },
        )

    assert response.status_code == 409
    assert "active Story Bible" in response.json()["detail"]


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
    assert first.json()["data"]["memory_layer"] == "canonical"
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
async def test_episode_roadmap_chunk_route_uses_static_path_and_returns_batch(
    long_story_app,
) -> None:
    app, _runtime = long_story_app

    class EpisodeChunkStub:
        def generate_episode_plan_chunk(self, payload):
            assert payload.episode_number == 1
            return []

    app.dependency_overrides[get_story_planning_service] = lambda: EpisodeChunkStub()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/story-projects/story_project.api_demo/plan-nodes/"
            "story_plan.api_demo.root/episode-plans/chunk",
            json={
                "story_project_id": "story_project.api_demo",
                "source_node_id": "story_plan.api_demo.root",
                "source_node_version": 1,
                "generation_strategy_id": "strategy.api_demo",
                "episode_number": 1,
                "accepted_plans": [],
            },
        )

    assert response.status_code == 200
    assert response.json() == {"data": []}
    assert response.headers["X-Agent-Run-ID"].startswith("agent-run.")


@pytest.mark.anyio
async def test_episode_roadmap_agent_preserves_provider_rate_limit_status(
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
            "story_plan.api_demo.root/episode-plans/1/agent-run",
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
@pytest.mark.parametrize("operation", ["modify", "prepare"])
async def test_episode_roadmap_modification_route_validates_path_and_returns_candidate(
    long_story_app, operation,
) -> None:
    app, _runtime = long_story_app

    class EpisodeModificationStub:
        def prepare_episode_plan_item(self, payload):
            return payload.current_plan.model_copy(update={"execution_ready": True})

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

    if operation == "prepare":
        payload.pop("instruction")
        payload.pop("revision_mode")
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/story-projects/story_project.api_demo/plan-nodes/"
            f"story_plan.api_demo.root/episode-plans/1/{operation}",
            json=payload,
        )
        mismatch = await client.post(
            "/story-projects/story_project.api_demo/plan-nodes/"
            f"story_plan.api_demo.root/episode-plans/2/{operation}",
            json=payload,
        )

    assert response.status_code == 200, response.text
    if operation == "prepare":
        assert response.json()["data"]["episode_goal"] == current_plan["episode_goal"]
        assert response.json()["data"]["execution_ready"] is True
    else:
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


@pytest.mark.anyio
async def test_generation_task_claim_is_leased_and_idempotent(long_story_app) -> None:
    app, _runtime = long_story_app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await client.put(
            "/story-projects/story_project.api_demo",
            json=build_project().model_dump(mode="json"),
        )
        task = build_generation_task()
        saved = await client.put(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation-job.api_demo.001",
            json=task.model_dump(mode="json"),
        )
        assert saved.status_code == 200, saved.text

        first = await client.post(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation-job.api_demo.001/claim",
            json={"lease_id": "worker.api.1", "lease_ttl_seconds": 30},
        )
        same_worker = await client.post(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation-job.api_demo.001/claim",
            json={"lease_id": "worker.api.1", "lease_ttl_seconds": 30},
        )
        other_worker = await client.post(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation-job.api_demo.001/claim",
            json={"lease_id": "worker.api.2", "lease_ttl_seconds": 30},
        )

        claimed = first.json()["data"]
        paused_payload = {
            **claimed,
            "batch": {
                **claimed["batch"],
                "revision": claimed["batch"]["revision"] + 1,
                "status": "paused",
            },
            "checkpoint": {
                **claimed["checkpoint"],
                "revision": claimed["checkpoint"]["revision"] + 1,
                "status": "paused",
            },
        }
        released = await client.put(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation-job.api_demo.001",
            json=paused_payload,
        )
        reclaimed = await client.post(
            "/story-projects/story_project.api_demo/generation-tasks/"
            "generation-job.api_demo.001/claim",
            json={"lease_id": "worker.api.2", "lease_ttl_seconds": 30},
        )

    assert first.status_code == 200, first.text
    assert first.json()["data"]["checkpoint"]["lease_id"] == "worker.api.1"
    assert same_worker.status_code == 200, same_worker.text
    assert same_worker.json()["data"]["checkpoint"]["revision"] == claimed["checkpoint"]["revision"]
    assert other_worker.status_code == 409, other_worker.text
    assert released.status_code == 200, released.text
    assert released.json()["data"]["checkpoint"]["lease_id"] is None
    assert reclaimed.status_code == 200, reclaimed.text
    assert reclaimed.json()["data"]["checkpoint"]["lease_id"] == "worker.api.2"


@pytest.mark.anyio
@pytest.mark.parametrize("explicitly_deferred", [False, True])
@pytest.mark.parametrize("proposal, confirmed", [
    ("AI草案（待确认）：调查员通过原始航海日志查明船舶事故的真正原因。",
     "调查员通过原始航海日志查明船舶事故的真正原因。"),
    ("结局来源为AI草案（待确认）：两份记录未同步，调查员用原始档案核实真相。",
     "结局来源：两份记录未同步，调查员用原始档案核实真相。"),
    ("最终真相：AI草案(待确认): 两份记录未同步，调查员用原始档案核实真相。",
     "最终真相：两份记录未同步，调查员用原始档案核实真相。"),
])
async def test_outline_confirmation_retires_proposal_labels_but_preserves_deferred_decisions(
    long_story_app, explicitly_deferred, proposal, confirmed,
):
    from app.modules.script_engine.story_bible_approval import approved_story_bible_context

    app, _runtime = long_story_app
    base = "/story-projects/story_project.api_demo/story-bibles/story_bible.api_demo"
    draft = build_story_bible().model_dump(mode="json")
    draft["ending_direction"] = proposal
    draft["major_setup_payoff_refs"] = [
        "事故责任归属仍待定，须由作者另行决定。",
        "文档原文写着“结局来源为AI草案（待确认）：等待核实”，该原文不得被修改。",
    ]
    draft["avoid_patterns"] = [
        "不要把AI草案（待确认）标签写进人物对白。",
        "不得把已批准事实重写为AI草案（待确认）：这一标签仅用于新提议。",
    ]
    draft["imported_source_document"] = proposal
    if explicitly_deferred:
        draft["creative_decisions"] = [{
            "decision_key": "mystery.ending", "title": "暂缓结局决定",
            "status": "unresolved", "source": "grill_answer", "owner": "user",
            "ai_permission": "none", "required_before_stage": "script",
        }]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        assert (await client.put("/story-projects/story_project.api_demo", json=build_project().model_dump(mode="json"))).status_code == 200
        saved = await client.put(base + "/versions/1", json=draft)
        assert saved.status_code == 200
        reviewed = saved.json()["data"]
        approval = {**reviewed, "version": 2, "status": "approved", "approved_at": NOW.isoformat()}
        response = await client.put(base + "/versions/2", json=approval)
        assert response.status_code == 200
        approved = response.json()["data"]
        expected = proposal if explicitly_deferred else confirmed
        assert approved["ending_direction"] == expected
        assert approved["imported_source_document"] == proposal
        assert approved["major_setup_payoff_refs"] == draft["major_setup_payoff_refs"]
        assert approved["avoid_patterns"] == draft["avoid_patterns"]
        assert approved["creative_decisions"] == reviewed["creative_decisions"]
        original = await client.get(base + "?version=1")
        assert original.json()["data"]["ending_direction"] == proposal
        # Legacy approved versions get the same execution interpretation without
        # mutating their stored fields or the caller's object.
        legacy = StoryBible.model_validate(approval)
        assert approved_story_bible_context(legacy).ending_direction == expected
        assert legacy.ending_direction == proposal
