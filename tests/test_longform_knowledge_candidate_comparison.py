import pytest

from scripts.run_longform_knowledge_candidate_comparison import (
    FIXTURES,
    build_authoring_input,
    create_fixture_source,
)


def test_comparison_reuses_persisted_authoring_input() -> None:
    result = build_authoring_input(
        source_project={"planned_episode_count": 320},
        workspace_payload={
            "creativePrompt": "一个女孩回乡调查母亲死亡真相。",
            "selectedTagIds": ["genre.mystery", "custom.return_home"],
            "customTags": [
                {"id": "custom.return_home", "label": "返乡秘密"},
            ],
            "characters": [
                {
                    "id": "lead-1",
                    "name": "尚婉清",
                    "role": "主角",
                    "age": "27",
                    "gender": "女",
                    "background": "调查记者",
                    "appearance": "黑色短发",
                    "description": "克制但执着",
                }
            ],
        },
        ontology_labels={"genre.mystery": "悬疑"},
    )

    assert result["creative_prompt"] == "一个女孩回乡调查母亲死亡真相。"
    assert result["selected_tag_labels"] == ["悬疑", "返乡秘密"]
    assert result["target_episode_count"] == 320
    assert result["characters"] == [
        {
            "character_ref": "character.lead-1",
            "name": "尚婉清",
            "role": "主角",
            "description": "年龄：27；性别：女；背景：调查记者；外观：黑色短发；克制但执着",
        }
    ]


def test_comparison_rejects_an_empty_source_input() -> None:
    with pytest.raises(RuntimeError, match="neither a creative prompt nor selected tags"):
        build_authoring_input(
            source_project={"planned_episode_count": 320},
            workspace_payload={
                "creativePrompt": "",
                "selectedTagIds": [],
                "customTags": [],
                "characters": [],
            },
            ontology_labels={},
        )


class FixtureClient:
    def __init__(self) -> None:
        self.path = ""
        self.payload: dict[str, object] = {}

    def request(self, method: str, path: str, json: dict[str, object] | None = None):
        assert method == "POST"
        self.path = path
        self.payload = json or {}
        return FixtureResponse({"data": {"id": "content-spec.fixture"}})


class FixtureResponse:
    is_error = False

    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def json(self) -> dict[str, object]:
        return self.payload


@pytest.mark.parametrize("fixture_id", sorted(FIXTURES))
def test_comparison_fixture_creates_sparse_chinese_longform_input(fixture_id: str) -> None:
    client = FixtureClient()

    source_project, authoring_input = create_fixture_source(
        client,  # type: ignore[arg-type]
        fixture_id=fixture_id,
    )

    assert client.path == "/content-specs"
    assert client.payload["platform_goal"]["platform_profile_id"] == (
        "cn_mainland_comic_drama_v1"
    )
    assert client.payload["tags"] == []
    assert source_project["content_spec_id"] == "content-spec.fixture"
    assert source_project["planned_episode_count"] == 334
    assert authoring_input["characters"] == []
    assert authoring_input["selected_tag_labels"]
    assert authoring_input["creative_prompt"]
