from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.dependencies import get_long_story_database_runtime, get_long_story_service
from app.main import create_app
from app.modules.script_engine.long_story_models import (
    EpisodePlan,
    StoryBible,
    StoryProject,
    StoryStagePlan,
)
from app.modules.script_engine.long_story_service import LongStoryService


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
