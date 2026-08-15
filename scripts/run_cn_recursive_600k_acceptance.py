from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


DEFAULT_BASE_URL = "http://127.0.0.1:8000"
DEFAULT_STRATEGY_ID = "strategy.cn_mainland.longform_knowledge_candidate.v2"
DEFAULT_OUTPUT_ROOT = Path("examples/longform_acceptance/cn_recursive_600k_v1")
TARGET_TOTAL_CHARACTERS = 600_000
MAX_PLANNING_NODES = 200
MAX_PLANNING_CALLS_PER_RUN = 100
DEFAULT_EXECUTION_BATCH_EPISODES = 10


def main() -> None:
    args = parse_args()
    output_dir = (args.output_dir or DEFAULT_OUTPUT_ROOT / args.project_id).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        timeout=httpx.Timeout(args.timeout_seconds),
        trust_env=False,
    ) as client:
        project = get_data(client, f"/story-projects/{args.project_id}")
        validate_project(project)
        story_bible = load_story_bible(client, project)
        if args.auto_approve and story_bible["status"] != "approved":
            story_bible = approve_story_bible(client, story_bible)
            project = get_data(client, f"/story-projects/{args.project_id}")
        if story_bible["status"] != "approved":
            raise RuntimeError("Story Bible must be approved before recursive planning.")

        write_json(output_dir / "story_bible.json", story_bible)
        if args.phase == "all":
            run_branchwise_acceptance(
                client,
                project=project,
                story_bible=story_bible,
                strategy_id=args.strategy_id,
                auto_approve=args.auto_approve,
                output_dir=output_dir,
                max_episodes=args.max_body_episodes,
                request_delay_seconds=args.request_delay_seconds,
                retries=args.technical_retries,
                retry_delay_seconds=args.retry_delay_seconds,
            )
        elif args.phase == "planning":
            run_planning(
                client,
                project=project,
                story_bible=story_bible,
                strategy_id=args.strategy_id,
                auto_approve=args.auto_approve,
                output_dir=output_dir,
                retries=args.technical_retries,
                retry_delay_seconds=args.retry_delay_seconds,
            )
        elif args.phase == "body":
            run_body_generation(
                client,
                project=project,
                story_bible=story_bible,
                strategy_id=args.strategy_id,
                output_dir=output_dir,
                max_episodes=args.max_body_episodes,
                request_delay_seconds=args.request_delay_seconds,
                retries=args.technical_retries,
                retry_delay_seconds=args.retry_delay_seconds,
            )


def run_branchwise_acceptance(
    client: httpx.Client,
    *,
    project: dict[str, Any],
    story_bible: dict[str, Any],
    strategy_id: str,
    auto_approve: bool,
    output_dir: Path,
    max_episodes: int | None,
    request_delay_seconds: float,
    retries: int,
    retry_delay_seconds: float,
) -> None:
    """Plan and generate one earliest unfinished story branch at a time."""

    project_id = project["project_id"]
    episodes_dir = output_dir / "episodes"
    episodes_dir.mkdir(exist_ok=True)
    completed = load_completed_runs(episodes_dir)
    requested_end = min(
        max_episodes or project["planned_episode_count"],
        project["planned_episode_count"],
    )
    planning_calls = 0

    while completed_through(completed) < requested_end:
        nodes = latest_by_id(
            get_data(client, f"/story-projects/{project_id}/plan-nodes"),
            "node_id",
        )
        if not nodes:
            top_level = post_data_with_retries(
                client,
                f"/story-projects/{project_id}/plan-nodes/top-level/draft",
                {
                    "story_project_id": project_id,
                    "story_bible_id": story_bible["story_bible_id"],
                    "story_bible_version": story_bible["version"],
                    "generation_strategy_id": strategy_id,
                    "sequence_order": 1,
                    "target_episode_count": project["planned_episode_count"],
                },
                retries=retries,
                retry_delay_seconds=retry_delay_seconds,
            )
            planning_calls += 1
            nodes = top_level
            print(
                f"Generated {len(top_level)} first-layer story branches",
                flush=True,
            )
        if len(nodes) > MAX_PLANNING_NODES:
            raise RuntimeError("Planning exceeded the 200-node acceptance safety limit.")

        node = next_branch_node(nodes, completed_through=completed_through(completed) + 1)
        if node is None:
            raise RuntimeError(
                "No planning branch covers the next unfinished episode; inspect the plan tree."
            )
        if node["status"] != "approved":
            if not auto_approve:
                raise RuntimeError(
                    f"Planning node '{node['node_id']}' requires review and approval."
                )
            node = approve_plan_node(
                client,
                node,
                max_episode_ready_span=DEFAULT_EXECUTION_BATCH_EPISODES,
            )
            print(f"Approved node: {node['title']}", flush=True)

        if not is_direct_script_node(node):
            if planning_calls >= MAX_PLANNING_CALLS_PER_RUN:
                raise RuntimeError("Planning call safety limit reached; rerun to resume.")
            children = post_data_with_retries(
                client,
                f"/story-projects/{project_id}/plan-nodes/{node['node_id']}/decompose",
                {
                    "story_project_id": project_id,
                    "parent_node_id": node["node_id"],
                    "parent_node_version": node["version"],
                    "generation_strategy_id": strategy_id,
                    "max_episode_ready_span": DEFAULT_EXECUTION_BATCH_EPISODES,
                },
                retries=retries,
                retry_delay_seconds=retry_delay_seconds,
            )
            planning_calls += 1
            print(
                f"Decomposed current part {node['planned_start_episode']}-"
                f"{node['planned_end_episode']} into {len(children)} child parts",
                flush=True,
            )
            continue

        generated = generate_leaf_body(
            client,
            project=project,
            story_bible=story_bible,
            node=node,
            strategy_id=strategy_id,
            output_dir=output_dir,
            completed=completed,
            requested_end=requested_end,
            request_delay_seconds=request_delay_seconds,
            retries=retries,
            retry_delay_seconds=retry_delay_seconds,
        )
        if not generated and completed_through(completed) < requested_end:
            raise RuntimeError("Current episode-ready branch produced no unfinished episode.")

    nodes = latest_by_id(
        get_data(client, f"/story-projects/{project_id}/plan-nodes"),
        "node_id",
    )
    plans = latest_by_id(
        get_data(client, f"/story-projects/{project_id}/episode-plans"),
        "episode_plan_id",
    )
    write_json(output_dir / "plan_nodes.json", nodes)
    write_json(output_dir / "episode_plans.json", plans)
    write_body_summary(output_dir, completed, project)


def next_branch_node(
    nodes: list[dict[str, Any]],
    *,
    completed_through: int,
) -> dict[str, Any] | None:
    """Return the deepest existing node covering the next unfinished episode."""

    candidates = [
        node
        for node in nodes
        if (node.get("planned_start_episode") or 0) <= completed_through
        <= (node.get("planned_end_episode") or 0)
    ]
    if not candidates:
        return None
    approved_ready = [
        node
        for node in candidates
        if is_direct_script_node(node)
    ]
    if approved_ready:
        return max(approved_ready, key=episode_span)
    parent_ids = {node.get("parent_node_id") for node in candidates}
    leaves = [node for node in candidates if node["node_id"] not in parent_ids]
    return max(leaves, key=plan_node_depth_key)


def plan_node_depth_key(node: dict[str, Any]) -> tuple[int, int]:
    node_id = node.get("node_id", "")
    return (node_id.count("."), node.get("sequence_order") or 0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Resumably validate the formal mainland-China 600k path: approved Story Bible, "
            "recursive non-balanced plan tree, then direct sequential episode drafts."
        )
    )
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--strategy-id", default=DEFAULT_STRATEGY_ID)
    parser.add_argument("--phase", choices=("planning", "body", "all"), default="all")
    parser.add_argument("--auto-approve", action="store_true")
    parser.add_argument("--max-body-episodes", type=int, default=None)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--timeout-seconds", type=float, default=900.0)
    parser.add_argument("--request-delay-seconds", type=float, default=5.0)
    parser.add_argument("--technical-retries", type=int, default=2)
    parser.add_argument("--retry-delay-seconds", type=float, default=180.0)
    args = parser.parse_args()
    if args.max_body_episodes is not None and args.max_body_episodes < 1:
        parser.error("--max-body-episodes must be positive.")
    if args.technical_retries < 0:
        parser.error("--technical-retries cannot be negative.")
    return args


def run_planning(
    client: httpx.Client,
    *,
    project: dict[str, Any],
    story_bible: dict[str, Any],
    strategy_id: str,
    auto_approve: bool,
    output_dir: Path,
    retries: int,
    retry_delay_seconds: float,
) -> None:
    project_id = project["project_id"]
    planning_calls = 0
    nodes = latest_by_id(get_data(client, f"/story-projects/{project_id}/plan-nodes"), "node_id")
    if not nodes:
        top_level = post_data_with_retries(
            client,
            f"/story-projects/{project_id}/plan-nodes/top-level/draft",
            {
                "story_project_id": project_id,
                "story_bible_id": story_bible["story_bible_id"],
                "story_bible_version": story_bible["version"],
                "generation_strategy_id": strategy_id,
                "sequence_order": 1,
                "target_episode_count": project["planned_episode_count"],
            },
            retries=retries,
            retry_delay_seconds=retry_delay_seconds,
        )
        planning_calls += 1
        nodes = top_level
        print(
            f"Generated {len(top_level)} first-layer story branches",
            flush=True,
        )

    while True:
        nodes = latest_by_id(get_data(client, f"/story-projects/{project_id}/plan-nodes"), "node_id")
        if len(nodes) > MAX_PLANNING_NODES:
            raise RuntimeError("Planning exceeded the 200-node acceptance safety limit.")
        children_by_parent: dict[str, list[dict[str, Any]]] = {}
        for node in nodes:
            if node.get("parent_node_id"):
                children_by_parent.setdefault(node["parent_node_id"], []).append(node)

        pending = sorted(
            nodes,
            key=lambda item: (
                item.get("planned_start_episode") or 0,
                item.get("sequence_order") or 0,
            ),
        )
        changed = False
        for node in pending:
            if node["status"] != "approved":
                if not auto_approve:
                    raise RuntimeError(
                        f"Planning node '{node['node_id']}' requires approval. "
                        "Use --auto-approve only for isolated capacity acceptance."
                    )
                node = approve_plan_node(
                    client,
                    node,
                    max_episode_ready_span=DEFAULT_EXECUTION_BATCH_EPISODES,
                )
                changed = True
                print(f"Approved node: {node['title']}", flush=True)

            if is_direct_script_node(node):
                continue

            if children_by_parent.get(node["node_id"]):
                continue
            if planning_calls >= MAX_PLANNING_CALLS_PER_RUN:
                raise RuntimeError("Planning call safety limit reached; rerun to resume.")
            span = episode_span(node)
            children = post_data_with_retries(
                client,
                f"/story-projects/{project_id}/plan-nodes/{node['node_id']}/decompose",
                {
                    "story_project_id": project_id,
                    "parent_node_id": node["node_id"],
                    "parent_node_version": node["version"],
                    "generation_strategy_id": strategy_id,
                    "max_episode_ready_span": DEFAULT_EXECUTION_BATCH_EPISODES,
                },
                retries=retries,
                retry_delay_seconds=retry_delay_seconds,
            )
            planning_calls += 1
            changed = True
            print(
                f"Decomposed {node['planned_start_episode']}-{node['planned_end_episode']} "
                f"into {len(children)} content-driven branches",
                flush=True,
            )
            break
        if changed:
            continue

        plans = latest_by_id(
            get_data(client, f"/story-projects/{project_id}/episode-plans"),
            "episode_plan_id",
        )
        validate_episode_plan_coverage(
            plans,
            project["planned_episode_count"],
            nodes=nodes,
        )
        write_json(output_dir / "plan_nodes.json", nodes)
        write_json(output_dir / "episode_plans.json", plans)
        write_json(
            output_dir / "planning_summary.json",
            build_planning_summary(project, nodes, plans),
        )
        print(
            f"Planning complete: nodes={len(nodes)} direct_script_leaves="
            f"{sum(1 for node in nodes if is_direct_script_node(node))}",
            flush=True,
        )
        return


def run_body_generation(
    client: httpx.Client,
    *,
    project: dict[str, Any],
    story_bible: dict[str, Any],
    strategy_id: str,
    output_dir: Path,
    max_episodes: int | None,
    request_delay_seconds: float,
    retries: int,
    retry_delay_seconds: float,
) -> None:
    project_id = project["project_id"]
    requested_end = min(
        max_episodes or project["planned_episode_count"],
        project["planned_episode_count"],
    )
    plans = latest_by_id(
        get_data(client, f"/story-projects/{project_id}/episode-plans"),
        "episode_plan_id",
    )
    nodes = latest_by_id(
        get_data(client, f"/story-projects/{project_id}/plan-nodes"),
        "node_id",
    )
    validate_episode_plan_coverage(
        plans,
        requested_end,
        nodes=nodes,
    )
    plans_by_episode = {item["episode_number"]: item for item in plans}
    direct_nodes_by_episode = {
        episode_number: item
        for item in nodes
        if is_direct_script_node(item)
        for episode_number in range(
            item["planned_start_episode"],
            item["planned_end_episode"] + 1,
        )
    }
    episodes_dir = output_dir / "episodes"
    episodes_dir.mkdir(exist_ok=True)
    completed = load_completed_runs(episodes_dir)
    previous_draft = None
    for episode_number in range(1, requested_end + 1):
        if episode_number in completed:
            previous_draft = completed[episode_number]["data"]["draft_master_script"]
            print(f"Resumed episode {episode_number:04d}", flush=True)
            continue
        plan = direct_nodes_by_episode.get(episode_number) or plans_by_episode.get(episode_number)
        if plan is None:
            raise RuntimeError(
                f"Episode {episode_number} has no approved direct-script leaf or Episode Plan."
            )
        generation_source = {**plan, "episode_number": episode_number}
        payload = build_generation_request(
            project=project,
            story_bible=story_bible,
            plan=generation_source,
            strategy_id=strategy_id,
            previous_draft=previous_draft,
        )
        episode_dir = episodes_dir / f"episode_{episode_number:04d}"
        episode_dir.mkdir(exist_ok=True)
        write_json(episode_dir / "request.json", payload)
        started = time.perf_counter()
        try:
            run = post_data_with_retries(
                client,
                "/script-generation/generate-draft",
                payload,
                retries=retries,
                retry_delay_seconds=retry_delay_seconds,
            )
        except Exception as exc:
            write_json(
                episode_dir / "failure.json",
                {
                    "episode_number": episode_number,
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                    "failed_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            write_body_summary(output_dir, completed, project)
            raise
        latency = round(time.perf_counter() - started, 3)
        draft = run["draft_master_script"]
        metrics = episode_metrics(episode_number, draft, latency)
        write_json(episode_dir / "run.json", {"data": run})
        write_json(episode_dir / "draft.json", draft)
        write_json(episode_dir / "metrics.json", metrics)
        save_episode_artifact(client, project_id, episode_number, run, generation_source)
        completed[episode_number] = {"data": run}
        previous_draft = draft
        write_body_summary(output_dir, completed, project)
        print(
            f"Completed episode {episode_number:04d}: "
            f"body={metrics['effective_body_characters']} cumulative="
            f"{sum(episode_metrics_from_run(item)['effective_body_characters'] for item in completed.values())}",
            flush=True,
        )
        failure_path = episode_dir / "failure.json"
        if failure_path.exists():
            failure_path.unlink()
        if episode_number < requested_end and request_delay_seconds:
            time.sleep(request_delay_seconds)


def generate_leaf_body(
    client: httpx.Client,
    *,
    project: dict[str, Any],
    story_bible: dict[str, Any],
    node: dict[str, Any],
    strategy_id: str,
    output_dir: Path,
    completed: dict[int, dict[str, Any]],
    requested_end: int,
    request_delay_seconds: float,
    retries: int,
    retry_delay_seconds: float,
) -> bool:
    branch_end = min(node["planned_end_episode"], requested_end)
    generated = False
    for episode_number in range(node["planned_start_episode"], branch_end + 1):
        if episode_number in completed:
            continue
        if not is_direct_script_node(node):
            raise RuntimeError(
                f"Approved direct-script leaf for episode {episode_number} is missing."
            )
        plan = {**node, "episode_number": episode_number}
        previous_run = completed.get(episode_number - 1)
        previous_draft = (
            previous_run["data"]["draft_master_script"] if previous_run else None
        )
        continuity = load_continuity_snapshot(output_dir, story_bible)
        payload = build_generation_request(
            project=project,
            story_bible=story_bible,
            plan=plan,
            strategy_id=strategy_id,
            previous_draft=previous_draft,
            continuity_snapshot=continuity,
        )
        episode_dir = output_dir / "episodes" / f"episode_{episode_number:04d}"
        episode_dir.mkdir(parents=True, exist_ok=True)
        write_json(episode_dir / "request.json", payload)
        started = time.perf_counter()
        try:
            run = post_data_with_retries(
                client,
                "/script-generation/generate-draft",
                payload,
                retries=retries,
                retry_delay_seconds=retry_delay_seconds,
            )
        except Exception as exc:
            write_json(
                episode_dir / "failure.json",
                {
                    "episode_number": episode_number,
                    "story_plan_node_id": node["node_id"],
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                    "failed_at": now_iso(),
                },
            )
            write_body_summary(output_dir, completed, project)
            raise
        latency = round(time.perf_counter() - started, 3)
        draft = run["draft_master_script"]
        write_json(episode_dir / "run.json", {"data": run})
        write_json(episode_dir / "draft.json", draft)
        write_json(episode_dir / "metrics.json", episode_metrics(episode_number, draft, latency))
        save_episode_artifact(client, project["project_id"], episode_number, run, plan)
        continuity = update_continuity_snapshot(
            continuity,
            story_bible=story_bible,
            node=node,
            plan=plan,
            draft=draft,
            episode_number=episode_number,
        )
        write_json(output_dir / "continuity_snapshot.json", continuity)
        completed[episode_number] = {"data": run}
        write_body_summary(output_dir, completed, project)
        generated = True
        print(
            f"Completed part episode {episode_number:04d}: "
            f"characters={len(continuity['character_cards'])} "
            f"relationships={len(continuity['relationships'])}",
            flush=True,
        )
        failure_path = episode_dir / "failure.json"
        if failure_path.exists():
            failure_path.unlink()
        if episode_number < branch_end and request_delay_seconds:
            time.sleep(request_delay_seconds)
    return generated


def load_continuity_snapshot(
    output_dir: Path,
    story_bible: dict[str, Any],
) -> dict[str, Any]:
    path = output_dir / "continuity_snapshot.json"
    if path.exists():
        return read_json(path)
    return {
        "snapshot_version": 0,
        "through_episode_number": 0,
        "character_cards": [],
        "relationships": [
            {
                "relationship_id": item["relationship_id"],
                "source_character_ref": item["source_character_ref"],
                "target_character_ref": item["target_character_ref"],
                "relationship_type": item["relationship_type"],
                "current_state": item["initial_state"],
                "changes": [],
            }
            for item in story_bible.get("relationships", [])
        ],
        "story_lines": [
            {
                "story_line_id": item["story_line_id"],
                "title": item["title"],
                "status": "setup",
                "current_state": item["premise"],
                "last_progressed_episode": 0,
            }
            for item in story_bible.get("story_lines", [])
        ],
        "recent_episode_summaries": [],
        "warnings": [],
    }


def update_continuity_snapshot(
    snapshot: dict[str, Any],
    *,
    story_bible: dict[str, Any],
    node: dict[str, Any],
    plan: dict[str, Any],
    draft: dict[str, Any],
    episode_number: int,
) -> dict[str, Any]:
    updated = json.loads(json.dumps(snapshot, ensure_ascii=False))
    cards = {normalize_name(item["name"]): item for item in updated["character_cards"]}
    for character in draft.get("characters", []):
        name = character.get("name", "").strip()
        if not name:
            continue
        key = normalize_name(name)
        card = cards.get(key)
        if card is None:
            card = {
                "character_ref": generated_character_ref(name),
                "name": name,
                "role": character.get("role", "角色"),
                "description": character.get("description", ""),
                "motivation": character.get("motivation", ""),
                "first_seen_episode": episode_number,
                "last_updated_episode": episode_number,
                "source": "generated",
            }
            updated["character_cards"].append(card)
            cards[key] = card
        else:
            card["role"] = character.get("role") or card.get("role", "角色")
            card["description"] = character.get("description") or card.get("description", "")
            card["motivation"] = character.get("motivation") or card.get("motivation", "")
            card["last_updated_episode"] = episode_number

    relation_by_pair = {
        frozenset((item["source_character_ref"], item["target_character_ref"])): item
        for item in updated["relationships"]
    }
    draft_characters = [
        cards[normalize_name(item.get("name", ""))]
        for item in draft.get("characters", [])
        if normalize_name(item.get("name", "")) in cards
    ]
    for source_index, source in enumerate(draft_characters):
        for target in draft_characters[source_index + 1:]:
            evidence = relationship_evidence(draft, source["name"], target["name"])
            if evidence is None:
                continue
            pair = frozenset((source["character_ref"], target["character_ref"]))
            relationship = relation_by_pair.get(pair)
            if relationship is None:
                relationship = {
                    "relationship_id": (
                        f"relationship.generated.{source['character_ref'].rsplit('.', 1)[-1]}."
                        f"{target['character_ref'].rsplit('.', 1)[-1]}"
                    ),
                    "source_character_ref": source["character_ref"],
                    "target_character_ref": target["character_ref"],
                    "relationship_type": "剧情关联",
                    "current_state": evidence,
                    "changes": [],
                }
                updated["relationships"].append(relationship)
                relation_by_pair[pair] = relationship
            relationship["current_state"] = evidence
            changes = [
                item for item in relationship["changes"]
                if item["episode_number"] != episode_number
            ]
            changes.append({"episode_number": episode_number, "summary": evidence})
            relationship["changes"] = changes[-20:]

    active_refs = set(node.get("story_line_refs", []))
    for story_line in updated["story_lines"]:
        if story_line["story_line_id"] in active_refs:
            story_line["status"] = "active"
            story_line["current_state"] = plan["exit_state"]
            story_line["last_progressed_episode"] = episode_number

    final_scene = draft.get("scenes", [])[-1] if draft.get("scenes") else {}
    final_causality = final_scene.get("scene_causality") or {}
    summaries = [
        item for item in updated["recent_episode_summaries"]
        if item["episode_number"] != episode_number
    ]
    summaries.append(
        {
            "episode_number": episode_number,
            "entry_state": plan["entry_state"],
            "exit_state": plan["exit_state"],
            "consequence": final_causality.get("outcome") or final_scene.get("turning_point", ""),
            "next_episode_question": draft.get("next_episode_question"),
            "source_node_id": node["node_id"],
            "episode_plan_id": plan.get("episode_plan_id"),
            "story_plan_node_id": node["node_id"],
        }
    )
    updated["recent_episode_summaries"] = summaries[-10:]
    updated["snapshot_version"] = int(updated.get("snapshot_version", 0)) + 1
    updated["through_episode_number"] = episode_number
    updated["updated_at"] = now_iso()
    return updated


def load_story_bible(client: httpx.Client, project: dict[str, Any]) -> dict[str, Any]:
    story_bible_id = project.get("active_story_bible_id") or (
        f"story_bible.{project['project_id']}.main"
    )
    return get_data(client, f"/story-projects/{project['project_id']}/story-bibles/{story_bible_id}")


def approve_story_bible(client: httpx.Client, story_bible: dict[str, Any]) -> dict[str, Any]:
    approved = {
        **story_bible,
        "version": story_bible["version"] + 1,
        "status": "approved",
        "approved_at": now_iso(),
    }
    return put_data(
        client,
        f"/story-projects/{story_bible['story_project_id']}/story-bibles/"
        f"{story_bible['story_bible_id']}/versions/{approved['version']}",
        approved,
    )


def approve_plan_node(
    client: httpx.Client,
    node: dict[str, Any],
    *,
    max_episode_ready_span: int,
) -> dict[str, Any]:
    approved = {
        **node,
        "version": node["version"] + 1,
        "status": "approved",
        "expansion_status": approved_expansion_status(
            node,
            max_episode_ready_span=max_episode_ready_span,
        ),
        "approved_at": now_iso(),
    }
    return put_data(
        client,
        f"/story-projects/{node['story_project_id']}/plan-nodes/"
        f"{node['node_id']}/versions/{approved['version']}",
        approved,
    )


def approved_expansion_status(
    node: dict[str, Any],
    *,
    max_episode_ready_span: int,
) -> str:
    if episode_span(node) <= min(max_episode_ready_span, DEFAULT_EXECUTION_BATCH_EPISODES):
        return "episode_ready"
    return "expanded"


def approve_episode_plan(client: httpx.Client, plan: dict[str, Any]) -> dict[str, Any]:
    approved = {
        **plan,
        "version": plan["version"] + 1,
        "status": "approved",
        "approved_at": now_iso(),
    }
    return put_data(
        client,
        f"/story-projects/{plan['story_project_id']}/episode-plans/"
        f"{plan['episode_plan_id']}/versions/{approved['version']}",
        approved,
    )


def build_generation_request(
    *,
    project: dict[str, Any],
    story_bible: dict[str, Any],
    plan: dict[str, Any],
    strategy_id: str,
    previous_draft: dict[str, Any] | None,
    continuity_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    episode_number = plan.get("episode_number") or plan.get("planned_start_episode")
    if episode_number is None:
        raise RuntimeError("Episode generation source has no episode number.")
    batch_size = project["default_batch_size"]
    batch_start = ((episode_number - 1) // batch_size) * batch_size + 1
    batch_end = min(project["planned_episode_count"], batch_start + batch_size - 1)
    source_estimate = plan.get("estimated_script_body_characters")
    source_start = plan.get("planned_start_episode")
    source_end = plan.get("planned_end_episode")
    source_span = (
        source_end - source_start + 1
        if isinstance(source_start, int) and isinstance(source_end, int)
        else None
    )
    target_body = round(
        source_estimate / source_span
        if (
            isinstance(source_estimate, int)
            and source_estimate > 0
            and isinstance(source_span, int)
            and source_span > 0
        )
        else project["target_total_characters"] / project["planned_episode_count"]
    )
    return {
        "content_spec_id": project["content_spec_id"],
        "generation_strategy_id": strategy_id,
        "output_language": "zh",
        "desired_scene_count": 4,
        "target_script_body_characters": target_body,
        "resolved_creative_context": {
            "schema_version": "v1",
            "content_spec_id": project["content_spec_id"],
            "characters": [],
            "excluded_tag_ids": [],
            "excluded_patterns": story_bible.get("avoid_patterns", [])[:20],
            "resolution_warnings": [],
        },
        "episode_context": {
            "generation_mode": "full",
            "episode_number": episode_number,
            "total_episodes": project["planned_episode_count"],
            "previous_episode_summary": previous_episode_summary(previous_draft),
            "previous_episode_question": (
                previous_draft.get("next_episode_question") if previous_draft else None
            ),
            "episode_instruction": episode_source_instruction(plan),
            "project_continuity_summary": combined_continuity_summary(
                story_bible,
                continuity_snapshot,
            ),
            "batch_context": {
                "batch_number": ((episode_number - 1) // batch_size) + 1,
                "start_episode": batch_start,
                "end_episode": batch_end,
                "batch_instruction": "承接既有状态推进当前规划节点，不得重置冲突或重复上一集。",
            },
        },
    }


def episode_plan_instruction(plan: dict[str, Any]) -> str:
    fields = (
        ("本集目标", plan["episode_goal"]),
        ("进入状态", plan["entry_state"]),
        ("中心冲突", plan["central_conflict"]),
        ("主角决定", plan["protagonist_decision"]),
        ("揭示", plan.get("reveal")),
        ("情绪推进", plan["emotional_movement"]),
        ("退出状态", plan["exit_state"]),
        ("结尾悬念或回报", plan["cliffhanger"]),
    )
    return "；".join(f"{label}：{value}" for label, value in fields if value)[:1000]


def episode_source_instruction(source: dict[str, Any]) -> str:
    if source.get("episode_plan_id") or "episode_goal" in source:
        return episode_plan_instruction(source)
    episode_number = source.get("episode_number")
    start_episode = source.get("planned_start_episode")
    end_episode = source.get("planned_end_episode")
    progress = None
    if episode_number is not None and start_episode is not None:
        progress = f"第{episode_number - start_episode + 1}集"
    fields = (
        ("当前只生成", f"第{episode_number}集" if episode_number is not None else None),
        (
            "所属正文阶段",
            f"第{start_episode}-{end_episode}集"
            if start_episode is not None and end_episode is not None
            else None,
        ),
        ("阶段内进度", progress),
        ("剧情节点", source["title"]),
        ("叙事职责", source["narrative_purpose"]),
        ("阶段概要", source["synopsis"]),
        ("进入状态", source["entry_state"]),
        ("中心冲突", source["central_conflict"]),
        ("关键转折", "、".join(source.get("turning_points", []))),
        ("情绪推进", source["emotional_direction"]),
        ("退出状态", source["exit_state"]),
        (
            "生成要求",
            "只写当前这一集的完整剧本正文；承接上一集状态逐步推进本阶段，"
            "不得一次写完整个阶段，也不得重复上一集。",
        ),
    )
    return "；".join(f"{label}：{value}" for label, value in fields if value)[:1000]


def story_bible_summary(story_bible: dict[str, Any]) -> str:
    lines = [
        f"核心前提：{story_bible['core_premise']}",
        f"整部目标：{story_bible['series_goal']}",
        f"主题：{story_bible['theme']}",
        f"中心冲突：{story_bible['central_conflict']}",
        f"结局方向：{story_bible['ending_direction']}",
        "锁定事实：" + "；".join(story_bible.get("locked_facts", [])[:8]),
    ]
    return "\n".join(lines)[:4000]


def combined_continuity_summary(
    story_bible: dict[str, Any],
    continuity_snapshot: dict[str, Any] | None,
) -> str:
    if not continuity_snapshot or not continuity_snapshot.get("through_episode_number"):
        return story_bible_summary(story_bible)
    characters = continuity_snapshot.get("character_cards", [])[-12:]
    relationships = continuity_snapshot.get("relationships", [])[-20:]
    story_lines = [
        item for item in continuity_snapshot.get("story_lines", [])
        if item.get("status") != "resolved"
    ][:12]
    recent = continuity_snapshot.get("recent_episode_summaries", [])[-3:]
    sections = [
        story_bible_summary(story_bible),
        "当前人物状态：\n" + "\n".join(
            f"- {item['name']}（{item.get('role', '角色')}）："
            f"{item.get('motivation') or item.get('description') or '待继续明确'}"
            for item in characters
        ),
        "当前人物关系：\n" + "\n".join(
            f"- {item['source_character_ref']} → {item['target_character_ref']}："
            f"{item.get('relationship_type', '剧情关联')}；{item.get('current_state', '')}"
            for item in relationships
        ),
        "活跃故事线：\n" + "\n".join(
            f"- {item.get('title', item['story_line_id'])}：{item.get('current_state', '')}"
            for item in story_lines
        ),
        "最近剧情状态：\n" + "\n".join(
            f"- 第{item['episode_number']}集退出状态：{item['exit_state']}；"
            f"后果：{item.get('consequence', '')}"
            for item in recent
        ),
    ]
    return "\n\n".join(section for section in sections if not section.endswith("：\n"))[:4000]


def relationship_evidence(
    draft: dict[str, Any],
    source_name: str,
    target_name: str,
) -> str | None:
    source = normalize_name(source_name)
    target = normalize_name(target_name)
    for scene in draft.get("scenes", []):
        text = " ".join(
            [
                scene.get("beat_summary", ""),
                *scene.get("character_actions", []),
                *[
                    f"{line.get('character_name', '')} {line.get('text', '')}"
                    for line in scene.get("dialogues", [])
                ],
            ]
        ).casefold()
        if source in text and target in text:
            causality = scene.get("scene_causality") or {}
            return (
                causality.get("outcome")
                or scene.get("turning_point")
                or scene.get("beat_summary")
            )
    return None


def generated_character_ref(name: str) -> str:
    normalized = normalize_name(name)
    identifier = "".join(
        character if character.isalnum() else "_" for character in normalized
    ).strip("_")[:48]
    return f"character.generated.{identifier or 'unknown'}"


def normalize_name(value: str) -> str:
    return " ".join(value.strip().casefold().split())


def previous_episode_summary(draft: dict[str, Any] | None) -> str | None:
    if not draft:
        return None
    final_scene = draft.get("scenes", [])[-1] if draft.get("scenes") else {}
    causality = final_scene.get("scene_causality") or {}
    return "\n".join(
        part
        for part in (
            f"上一集标题：{draft.get('title', '')}",
            f"上一集概述：{draft.get('synopsis', '')}",
            f"最终状态变化：{causality.get('outcome', '')}",
            f"最终转折：{final_scene.get('turning_point', '')}",
        )
        if not part.endswith("：")
    )[:2000]


def save_episode_artifact(
    client: httpx.Client,
    project_id: str,
    episode_number: int,
    run: dict[str, Any],
    plan: dict[str, Any],
) -> None:
    post_data(
        client,
        f"/story-projects/{project_id}/episodes/{episode_number}/artifacts",
        {
            "schema_version": "v1",
            "artifact_id": f"artifact.{project_id}.episode_{episode_number:04d}.draft.acceptance_v1",
            "story_project_id": project_id,
            "episode_number": episode_number,
            "artifact_kind": "draft",
            "content_schema_version": "script_generation_run.v1",
            "content_payload": run,
            "lineage_refs": {
                **(
                    {"episode_plan_id": plan["episode_plan_id"]}
                    if plan.get("episode_plan_id")
                    else {"story_plan_node_id": plan["node_id"]}
                ),
                "story_bible_id": plan["story_bible_id"],
            },
            "client_instance_id": "recursive_600k_acceptance_v1",
            "created_at": now_iso(),
        },
    )


def validate_project(project: dict[str, Any]) -> None:
    if project["output_language"] != "zh":
        raise RuntimeError("The 600k mainland acceptance requires output_language=zh.")
    if project["target_total_characters"] < TARGET_TOTAL_CHARACTERS:
        raise RuntimeError("Story Project target_total_characters must be at least 600000.")
    if not project.get("content_spec_id"):
        raise RuntimeError("Story Project requires a persisted ContentSpec.")


def validate_episode_plan_coverage(
    plans: list[dict[str, Any]],
    expected_count: int,
    *,
    nodes: list[dict[str, Any]] | None = None,
) -> None:
    approved = {
        item["episode_number"] for item in plans if item["status"] == "approved"
    }
    approved.update(
        episode_number
        for item in nodes or []
        if is_direct_script_node(item)
        for episode_number in range(
            max(1, item["planned_start_episode"]),
            min(expected_count, item["planned_end_episode"]) + 1,
        )
    )
    ordered = sorted(approved)
    if ordered != list(range(1, expected_count + 1)):
        raise RuntimeError(
            f"Approved direct-script leaves and legacy Episode Plans do not cover "
            f"1-{expected_count} exactly; current approved count={len(ordered)}."
        )


def episode_span(node: dict[str, Any]) -> int:
    start = node.get("planned_start_episode")
    end = node.get("planned_end_episode")
    if start is None or end is None:
        raise RuntimeError(f"Planning node '{node['node_id']}' has no episode range.")
    return end - start + 1


def is_direct_script_node(node: dict[str, Any]) -> bool:
    return (
        node.get("status") == "approved"
        and node.get("expansion_status") == "episode_ready"
        and 1 <= episode_span(node) <= DEFAULT_EXECUTION_BATCH_EPISODES
    )


def latest_by_id(items: list[dict[str, Any]], id_field: str) -> list[dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for item in items:
        current = latest.get(item[id_field])
        if current is None or item["version"] > current["version"]:
            latest[item[id_field]] = item
    return list(latest.values())


def completed_through(completed: dict[int, dict[str, Any]]) -> int:
    """Return the highest contiguous episode completed from episode one."""
    current = 0
    while current + 1 in completed:
        current += 1
    return current


def build_planning_summary(
    project: dict[str, Any],
    nodes: list[dict[str, Any]],
    plans: list[dict[str, Any]],
) -> dict[str, Any]:
    leaves = [item for item in nodes if item["expansion_status"] == "episode_ready"]
    return {
        "status": "planning_complete",
        "project_id": project["project_id"],
        "target_total_characters": project["target_total_characters"],
        "planned_episode_count": project["planned_episode_count"],
        "node_count": len(nodes),
        "episode_ready_leaf_count": len(leaves),
        "episode_plan_count": len(plans),
        "leaf_ranges": [
            [item["planned_start_episode"], item["planned_end_episode"]]
            for item in sorted(leaves, key=lambda value: value["planned_start_episode"])
        ],
        "generated_at": now_iso(),
    }


def episode_metrics(
    episode_number: int,
    draft: dict[str, Any],
    latency_seconds: float,
) -> dict[str, Any]:
    actions = [
        action
        for scene in draft.get("scenes", [])
        for action in scene.get("character_actions", [])
    ]
    dialogues = [
        dialogue.get("text", "")
        for scene in draft.get("scenes", [])
        for dialogue in scene.get("dialogues", [])
    ]
    return {
        "episode_number": episode_number,
        "effective_body_characters": count_effective("".join(actions + dialogues)),
        "action_characters": count_effective("".join(actions)),
        "dialogue_characters": count_effective("".join(dialogues)),
        "scene_count": len(draft.get("scenes", [])),
        "latency_seconds": latency_seconds,
    }


def episode_metrics_from_run(run: dict[str, Any]) -> dict[str, Any]:
    return episode_metrics(0, run["data"]["draft_master_script"], 0)


def load_completed_runs(episodes_dir: Path) -> dict[int, dict[str, Any]]:
    completed: dict[int, dict[str, Any]] = {}
    for path in sorted(episodes_dir.glob("episode_*/run.json")):
        run = read_json(path)
        number = int(path.parent.name.rsplit("_", 1)[1])
        completed[number] = run
    if completed and sorted(completed) != list(range(1, max(completed) + 1)):
        raise RuntimeError("Local episode artifacts contain a gap; repair it before resuming.")
    return completed


def write_body_summary(
    output_dir: Path,
    completed: dict[int, dict[str, Any]],
    project: dict[str, Any],
) -> None:
    metrics = [episode_metrics_from_run(run) for _, run in sorted(completed.items())]
    total = sum(item["effective_body_characters"] for item in metrics)
    count = len(metrics)
    average = round(total / count) if count else 0
    write_json(
        output_dir / "body_summary.json",
        {
            "status": (
                "planned_story_complete"
                if count >= project["planned_episode_count"]
                else "generation_in_progress"
            ),
            "project_id": project["project_id"],
            "completed_episodes": count,
            "planned_episode_count": project["planned_episode_count"],
            "effective_body_characters": total,
            "target_total_characters": project["target_total_characters"],
            "target_semantics": "approximate_scale_reference_not_completion_quota",
            "counting_scope": "generated_episode_character_actions_and_dialogue_text",
            "excluded_artifacts": [
                "story_bible",
                "story_plan_nodes",
                "story_stage_plans",
                "episode_plans",
                "episode_metadata",
            ],
            "completion_ratio": round(total / project["target_total_characters"], 4),
            "average_effective_body_characters": average,
            "projected_total_characters": average * project["planned_episode_count"],
            "updated_at": now_iso(),
        },
    )


def get_data(client: httpx.Client, path: str) -> Any:
    return request_data(client, "GET", path)


def post_data(client: httpx.Client, path: str, payload: dict[str, Any]) -> Any:
    return request_data(client, "POST", path, payload)


def put_data(client: httpx.Client, path: str, payload: dict[str, Any]) -> Any:
    return request_data(client, "PUT", path, payload)


def post_data_with_retries(
    client: httpx.Client,
    path: str,
    payload: dict[str, Any],
    *,
    retries: int,
    retry_delay_seconds: float,
) -> Any:
    for attempt in range(retries + 1):
        effective_delay = retry_delay_seconds
        try:
            response = client.post(path, json=payload)
            if response.status_code < 400:
                return response.json()["data"]
            retryable = is_retryable_post_response(response)
            if not retryable or attempt >= retries:
                raise RuntimeError(
                    f"POST {path} failed ({response.status_code}): {response.text}"
                )
            effective_delay = (
                min(retry_delay_seconds, 10.0)
                if response.status_code == 422
                else retry_delay_seconds
            )
            print(
                f"Technical HTTP {response.status_code}; retrying after "
                f"{effective_delay:g}s ({attempt + 1}/{retries}).",
                flush=True,
            )
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            if attempt >= retries:
                raise RuntimeError(f"POST {path} failed: {type(exc).__name__}: {exc}") from exc
            print(
                f"Technical {type(exc).__name__}; retrying after "
                f"{retry_delay_seconds:g}s ({attempt + 1}/{retries}).",
                flush=True,
            )
        time.sleep(effective_delay)
    raise RuntimeError("Technical retry loop ended unexpectedly.")


def is_retryable_post_response(response: httpx.Response) -> bool:
    if response.status_code in {429, 502, 503, 504}:
        return True
    if response.status_code != 422:
        return False
    try:
        detail = response.json().get("detail", "")
    except (ValueError, AttributeError):
        return False
    if not isinstance(detail, str):
        return False
    retryable_structured_output_messages = (
        "Model returned invalid JSON content",
        "Model returned JSON that is not an object",
        "Model response did not contain readable text content",
        "Responses payload is missing output items",
        "Responses payload did not contain output text",
        "Model response is missing choices",
        "Model response choice has an invalid shape",
        "Model response is missing a message payload",
        "Structured output generation failed unexpectedly",
        "Real LLM output did not validate as DraftMasterScript",
    )
    return any(message in detail for message in retryable_structured_output_messages)


def request_data(
    client: httpx.Client,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    response = client.request(method, path, json=payload)
    if response.status_code >= 400:
        raise RuntimeError(f"{method} {path} failed ({response.status_code}): {response.text}")
    return response.json()["data"]


def count_effective(text: str) -> int:
    return sum(1 for character in text if character.isalnum())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


if __name__ == "__main__":
    main()
