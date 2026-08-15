from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


DEFAULT_BASE_URL = "http://127.0.0.1:8000"
BASELINE_STRATEGY_ID = "strategy.cn_mainland.frontend_mvp.general.v1"
CANDIDATE_STRATEGY_ID = "strategy.cn_mainland.longform_knowledge_candidate.v2"
PLATFORM_PROFILE_ID = "cn_mainland_comic_drama_v1"
OUTPUT_ROOT = Path("examples/prompt_evaluations/longform_knowledge_planning_candidate_v2")

FIXTURES: dict[str, dict[str, Any]] = {
    "apocalypse_survival": {
        "title": "末日断电后的生存共同体",
        "creative_prompt": (
            "一场原因不明的全球断电让现代城市彻底失序，一名普通社区医生必须带领"
            "陌生邻居活下去，同时查明灾难是否有人为因素。"
        ),
        "selected_tag_labels": ["末世生存", "群像", "资源危机", "人性抉择"],
    },
    "alien_scifi": {
        "title": "沉默星门",
        "creative_prompt": (
            "人类首次收到外星文明的求救信号，一名深空通信工程师发现信号中的坐标"
            "指向尚未建成的人类殖民地，而发送者似乎认识她。"
        ),
        "selected_tag_labels": ["外星科幻", "宇宙探索", "文明接触", "身份谜团"],
    },
}


def main() -> None:
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    timeout = httpx.Timeout(args.timeout_seconds)

    with httpx.Client(base_url=base_url, timeout=timeout, trust_env=False) as client:
        strategies = get_data(client, "/generation-strategies")
        strategy_ids = {item["id"] for item in strategies}
        required_strategy_ids = {BASELINE_STRATEGY_ID, CANDIDATE_STRATEGY_ID}
        missing_strategy_ids = sorted(required_strategy_ids - strategy_ids)
        if missing_strategy_ids:
            raise RuntimeError(
                "Missing comparison strategies: "
                + ", ".join(missing_strategy_ids)
                + ". Restart with ./start-local.sh so runtime resources are bootstrapped."
            )

        if args.resume_output_dir:
            output_dir = args.resume_output_dir.resolve()
            baseline_result = read_json(output_dir / "baseline_v1_story_bible.json")
            source_project = {
                **baseline_result["comparison_project"],
                "title": FIXTURES[args.fixture]["title"],
            }
            authoring_input = fixture_authoring_input(
                fixture_id=args.fixture,
                target_episode_count=source_project["planned_episode_count"],
            )
            source_reference = f"fixture:{args.fixture}"
            run_id = output_dir.name
        elif args.fixture:
            source_project, authoring_input = create_fixture_source(
                client,
                fixture_id=args.fixture,
            )
            source_reference = f"fixture:{args.fixture}"
        else:
            source_project = get_data(client, f"/story-projects/{args.project_id}")
            workspace = get_data(client, f"/story-projects/{args.project_id}/workspace")
            ontology_nodes = get_data(client, "/ontology-nodes")
            ontology_labels = {item["id"]: item["label"] for item in ontology_nodes}
            authoring_input = build_authoring_input(
                source_project=source_project,
                workspace_payload=workspace["workspace_payload"],
                ontology_labels=ontology_labels,
            )
            source_reference = args.project_id

        if not args.resume_output_dir:
            run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            output_dir = OUTPUT_ROOT / (args.fixture or "persisted_project") / run_id
            output_dir.mkdir(parents=True, exist_ok=False)

        results: dict[str, dict[str, Any]] = {}
        for variant, strategy_id in (
            ("baseline_v1", BASELINE_STRATEGY_ID),
            ("candidate_v2", CANDIDATE_STRATEGY_ID),
        ):
            artifact_path = output_dir / f"{variant}_story_bible.json"
            if artifact_path.exists():
                results[variant] = read_json(artifact_path)
                print(f"Resumed {variant}: existing artifact preserved")
                continue
            comparison_project_id = f"knowledge_ab.{run_id.lower()}.{variant}"
            comparison_project = get_or_create_comparison_project(
                client,
                source_project=source_project,
                project_id=comparison_project_id,
                variant=variant,
            )
            story_bible = post_data(
                client,
                f"/story-projects/{comparison_project_id}/story-bibles/draft",
                {
                    "story_project_id": comparison_project_id,
                    "content_spec_id": source_project["content_spec_id"],
                    "generation_strategy_id": strategy_id,
                    **authoring_input,
                },
            )
            result = {
                "strategy_id": strategy_id,
                "comparison_project": comparison_project,
                "story_bible": story_bible,
            }
            results[variant] = result
            write_json(artifact_path, result)
            print(f"Completed {variant}: Story Bible v{story_bible['version']}")

        manifest = {
            "experiment": "longform_knowledge_planning_candidate_v2_smoke_comparison",
            "status": "completed_pending_human_review",
            "source_project_id": source_reference,
            "content_spec_id": source_project["content_spec_id"],
            "same_input": authoring_input,
            "variants": {
                name: {
                    "strategy_id": result["strategy_id"],
                    "comparison_project_id": result["comparison_project"]["project_id"],
                    "artifact": f"{name}_story_bible.json",
                }
                for name, result in results.items()
            },
            "review_dimensions": [
                "sustainable_story_engine",
                "macro_movement_distinction",
                "character_long_arc_credibility",
                "parallel_storyline_consequence",
                "causal_coherence",
                "formula_or_rigidity_regression",
            ],
            "comparison_boundary": (
                "This single-project smoke comparison is diagnostic only. It cannot "
                "by itself validate, demote, or alter the default long-form strategy."
            ),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        write_json(output_dir / "manifest.json", manifest)

    print(f"Artifacts: {output_dir}")
    print("Status: completed_pending_human_review")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate isolated baseline-v1 and longform-knowledge-v2 Story Bibles "
            "from one existing project's persisted authoring input."
        )
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--project-id")
    source.add_argument("--fixture", choices=sorted(FIXTURES))
    parser.add_argument("--resume-output-dir", type=Path)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout-seconds", type=float, default=900.0)
    args = parser.parse_args()
    if args.resume_output_dir and not args.fixture:
        parser.error("--resume-output-dir requires --fixture.")
    return args


def create_fixture_source(
    client: httpx.Client,
    *,
    fixture_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    fixture = FIXTURES[fixture_id]
    content_spec = post_data(
        client,
        "/content-specs",
        {
            "title": fixture["title"],
            "audience_goal": {
                "summary": "中国大陆长篇连载内容受众",
                "priority": "primary",
                "success_metric": "持续阅读与追更意愿",
            },
            "commercial_goal": {
                "summary": "形成可持续扩展的长篇漫剧故事母本",
                "priority": "primary",
                "success_metric": "长线因果、人物发展与阶段性回报",
            },
            "platform_goal": {
                "platform_profile_id": PLATFORM_PROFILE_ID,
                "objective": "生成面向中国大陆市场参考的中文长篇连载故事",
                "target_duration_seconds": 180,
                "target_aspect_ratio": "9:16",
            },
            "story_goal": fixture["creative_prompt"],
            "quality_level": "high",
            "budget_level": "medium",
            "tags": [],
            "creative_brief": {
                "hook": "尽快建立核心异常、人物目标和持续追读问题。",
                "tone": "严肃且有持续张力",
                "pacing": "阶段递进",
                "target_emotion": "好奇、压力与期待",
                "asset_constraints": [],
                "generation_notes": [
                    "这是长篇连载故事母本，不得在开篇阶段提前解决核心冲突。",
                    "总纲需要提供可持续升级而非重复事件的故事动力。",
                ],
            },
            "metadata": {
                "source": "longform_knowledge_candidate_comparison",
                "fixture_id": fixture_id,
            },
        },
    )
    source_project = {
        "project_id": f"fixture.{fixture_id}",
        "title": fixture["title"],
        "content_spec_id": content_spec["id"],
        "target_total_characters": 600_000,
        "planned_episode_count": 334,
        "default_batch_size": 5,
    }
    authoring_input = fixture_authoring_input(
        fixture_id=fixture_id,
        target_episode_count=source_project["planned_episode_count"],
    )
    return source_project, authoring_input


def fixture_authoring_input(
    *,
    fixture_id: str,
    target_episode_count: int,
) -> dict[str, Any]:
    fixture = FIXTURES[fixture_id]
    return {
        "creative_prompt": fixture["creative_prompt"],
        "selected_tag_labels": fixture["selected_tag_labels"],
        "characters": [],
        "target_episode_count": target_episode_count,
    }


def get_or_create_comparison_project(
    client: httpx.Client,
    *,
    source_project: dict[str, Any],
    project_id: str,
    variant: str,
) -> dict[str, Any]:
    response = client.get(f"/story-projects/{project_id}")
    if response.status_code == 200:
        return response.json()["data"]
    if response.status_code != 404:
        raise RuntimeError(
            f"GET /story-projects/{project_id} failed "
            f"({response.status_code}): {response.text}"
        )
    return create_comparison_project(
        client,
        source_project=source_project,
        project_id=project_id,
        variant=variant,
    )


def build_authoring_input(
    *,
    source_project: dict[str, Any],
    workspace_payload: dict[str, Any],
    ontology_labels: dict[str, str],
) -> dict[str, Any]:
    custom_tags = {
        item["id"]: item["label"]
        for item in workspace_payload.get("customTags", [])
        if isinstance(item, dict) and item.get("id") and item.get("label")
    }
    selected_tag_labels = []
    for tag_id in workspace_payload.get("selectedTagIds", []):
        label = custom_tags.get(tag_id) or ontology_labels.get(tag_id)
        if label and label not in selected_tag_labels:
            selected_tag_labels.append(label)

    characters = []
    for index, character in enumerate(workspace_payload.get("characters", [])):
        if not isinstance(character, dict) or not str(character.get("name", "")).strip():
            continue
        raw_id = str(character.get("id") or index + 1)
        character_ref = "character." + re.sub(r"[^a-zA-Z0-9_.:-]", "-", raw_id)
        description = "；".join(
            value
            for value in (
                _labeled_value("年龄", character.get("age")),
                _labeled_value("性别", character.get("gender")),
                _labeled_value("背景", character.get("background")),
                _labeled_value("外观", character.get("appearance")),
                str(character.get("description") or "").strip(),
            )
            if value
        )
        characters.append(
            {
                "character_ref": character_ref,
                "name": str(character["name"]).strip(),
                "role": str(character.get("role") or ("主角" if index == 0 else "配角")),
                "description": description[:500] or None,
            }
        )

    creative_prompt = str(workspace_payload.get("creativePrompt") or "").strip()
    if not creative_prompt and not selected_tag_labels:
        raise RuntimeError("The source project has neither a creative prompt nor selected tags.")
    return {
        "creative_prompt": creative_prompt,
        "selected_tag_labels": selected_tag_labels,
        "characters": characters,
        "target_episode_count": int(source_project["planned_episode_count"]),
    }


def create_comparison_project(
    client: httpx.Client,
    *,
    source_project: dict[str, Any],
    project_id: str,
    variant: str,
) -> dict[str, Any]:
    return put_data(
        client,
        f"/story-projects/{project_id}",
        {
            "project_id": project_id,
            "revision": 1,
            "title": f"知识对照 {variant}：{source_project['title']}"[:160],
            "content_spec_id": source_project["content_spec_id"],
            "output_language": "zh",
            "target_total_characters": source_project["target_total_characters"],
            "planned_episode_count": source_project["planned_episode_count"],
            "default_batch_size": min(
                source_project["default_batch_size"],
                source_project["planned_episode_count"],
            ),
            "status": "planning",
        },
    )


def get_data(client: httpx.Client, path: str) -> Any:
    return request_data(client, "GET", path)


def post_data(client: httpx.Client, path: str, payload: dict[str, Any]) -> Any:
    return request_data(client, "POST", path, payload)


def put_data(client: httpx.Client, path: str, payload: dict[str, Any]) -> Any:
    return request_data(client, "PUT", path, payload)


def request_data(
    client: httpx.Client,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    response = client.request(method, path, json=payload)
    if response.is_error:
        raise RuntimeError(f"{method} {path} failed ({response.status_code}): {response.text}")
    body = response.json()
    return body["data"]


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _labeled_value(label: str, value: object) -> str:
    text = str(value or "").strip()
    return f"{label}：{text}" if text else ""


if __name__ == "__main__":
    main()
