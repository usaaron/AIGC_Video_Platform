from __future__ import annotations

import argparse
from datetime import datetime, timezone
from difflib import SequenceMatcher
import json
import os
from pathlib import Path
import time
from typing import Any

import httpx


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT_DIR / "examples" / "longform_acceptance" / "cn_600k_v1"
STRATEGY_ID = "strategy.cn_mainland.longform_knowledge_candidate.v2"
PLATFORM_PROFILE_ID = "cn_mainland_comic_drama_v1"
TARGET_TOTAL_CHARACTERS = 600_000
PLANNED_EPISODES = 334
TARGET_EPISODE_BODY_CHARACTERS = 1_797
SCENE_COUNT = 3


def main() -> None:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    episodes_dir = output_dir / "episodes"
    episodes_dir.mkdir(exist_ok=True)

    with httpx.Client(
        base_url=args.base_url,
        timeout=httpx.Timeout(args.timeout_seconds),
        trust_env=False,
    ) as client:
        verify_runtime(client)
        resolution = ensure_resolution(client, output_dir)
        completed = load_completed_runs(episodes_dir)
        ensure_contiguous(completed)
        write_manifest(output_dir, args, resolution, completed)

        previous_draft: dict[str, Any] | None = None
        for episode_number in range(1, args.episodes + 1):
            if episode_number in completed:
                previous_draft = completed[episode_number]["data"]["draft_master_script"]
                print(f"Resumed episode {episode_number:03d}", flush=True)
                continue

            request_payload = build_generation_request(
                resolution=resolution,
                episode_number=episode_number,
                previous_draft=previous_draft,
                batch_size=args.batch_size,
            )
            episode_dir = episodes_dir / f"episode_{episode_number:03d}"
            episode_dir.mkdir(exist_ok=True)
            write_json(episode_dir / "request.json", request_payload)

            started_at = datetime.now(timezone.utc)
            started = time.perf_counter()
            try:
                run = post_with_technical_retries(
                    client,
                    "/script-generation/generate-draft",
                    request_payload,
                    retries=args.technical_retries,
                    retry_delay_seconds=args.retry_delay_seconds,
                )
            except Exception as exc:
                latency_seconds = round(time.perf_counter() - started, 3)
                failure = serialize_failure(
                    episode_number,
                    exc,
                    latency_seconds=latency_seconds,
                    started_at=started_at,
                )
                write_json(episode_dir / "failure.json", failure)
                write_checkpoint(
                    output_dir,
                    args,
                    completed,
                    failed_episode_number=episode_number,
                    failure=failure,
                )
                write_reports(output_dir, completed)
                raise
            latency_seconds = round(time.perf_counter() - started, 3)
            draft = run["data"]["draft_master_script"]
            metrics = calculate_episode_metrics(
                episode_number,
                run,
                latency_seconds=latency_seconds,
                started_at=started_at,
            )
            write_json(episode_dir / "run.json", run)
            write_json(episode_dir / "draft.json", draft)
            write_json(episode_dir / "metrics.json", metrics)
            failure_path = episode_dir / "failure.json"
            if failure_path.exists():
                failure_path.unlink()
            completed[episode_number] = run
            previous_draft = draft
            write_checkpoint(output_dir, args, completed)
            write_reports(output_dir, completed)
            print(
                f"Completed episode {episode_number:03d}: "
                f"body={metrics['script_body_characters']} "
                f"tokens={metrics['total_tokens']} "
                f"latency={latency_seconds}s",
                flush=True,
            )
            if episode_number < args.episodes and args.request_delay_seconds:
                print(
                    f"Cooling down for {args.request_delay_seconds:g}s",
                    flush=True,
                )
                time.sleep(args.request_delay_seconds)

    summary = build_summary(completed, output_dir)
    print(f"Artifacts: {output_dir}")
    print(f"Completed episodes: {summary['completed_episodes']}")
    print(f"Script body characters: {summary['script_body_characters']}")
    print(f"Projected characters: {summary['projected_characters_at_estimated_episodes']}")
    print(f"Gate status: {summary['gate_status']}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a resumable mainland-China long-form generation acceptance."
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--episodes", type=int, default=5, choices=range(1, 31))
    parser.add_argument("--batch-size", type=int, default=5, choices=range(1, 21))
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=float(os.getenv("CN_LONGFORM_TIMEOUT_SECONDS", "420")),
    )
    parser.add_argument(
        "--request-delay-seconds",
        type=float,
        default=float(os.getenv("CN_LONGFORM_REQUEST_DELAY_SECONDS", "30")),
    )
    parser.add_argument(
        "--technical-retries",
        type=int,
        default=int(os.getenv("CN_LONGFORM_TECHNICAL_RETRIES", "2")),
    )
    parser.add_argument(
        "--retry-delay-seconds",
        type=float,
        default=float(os.getenv("CN_LONGFORM_RETRY_DELAY_SECONDS", "180")),
    )
    return parser.parse_args()


def verify_runtime(client: httpx.Client) -> None:
    profiles = client.get("/platform-profiles").raise_for_status().json()["data"]
    active_profiles = [
        item
        for item in profiles
        if item.get("metadata", {}).get("runtime_status") == "active"
    ]
    if len(active_profiles) != 1 or active_profiles[0]["id"] != PLATFORM_PROFILE_ID:
        raise RuntimeError("Acceptance requires exactly one active cn_mainland profile.")
    strategies = client.get("/generation-strategies").raise_for_status().json()["data"]
    strategy = next((item for item in strategies if item["id"] == STRATEGY_ID), None)
    if strategy is None or strategy["status"] != "active":
        raise RuntimeError(f"Active strategy '{STRATEGY_ID}' was not found.")
    if strategy.get("deepening_mode") != "disabled":
        raise RuntimeError("Creative Deepening must remain disabled for this acceptance.")


def ensure_resolution(client: httpx.Client, output_dir: Path) -> dict[str, Any]:
    path = output_dir / "resolution.json"
    if path.exists():
        saved = read_json(path)
        content_spec_id = saved["data"]["content_spec"]["id"]
        if client.get(f"/content-specs/{content_spec_id}").status_code == 200:
            return saved

    response = client.post("/content-specs/resolve-creative-intent", json=creative_intent())
    response.raise_for_status()
    resolution = response.json()
    write_json(path, resolution)
    return resolution


def creative_intent() -> dict[str, Any]:
    return {
        "schema_version": "v1",
        "title": "订婚宴迷局：六十万字长篇验收",
        "audience_goal": {
            "summary": "中国大陆女性向悬疑情感与复仇连载受众",
            "priority": "primary",
            "success_metric": "持续阅读、人物关系投入与阶段性追更意愿",
        },
        "commercial_goal": {
            "summary": "建立可持续展开并可改编为漫剧的六十万字长篇故事母本",
            "priority": "primary",
            "success_metric": "连续性、人物稳定性、伏笔回收与长期追读动力",
        },
        "platform_goal": {
            "platform_profile_id": PLATFORM_PROFILE_ID,
            "objective": "生成面向中国大陆市场参考的中文长篇连载故事",
            "target_duration_seconds": 180,
            "target_aspect_ratio": "9:16",
        },
        "free_creative_prompt": (
            "订婚宴上，调查记者苏晚准备公开顾氏集团掩盖矿难的证据，"
            "却发现未婚夫顾沉舟早已知道真相。她必须在复仇、保护无辜证人"
            "和追查幕后主使之间作出不可逆选择。"
        ),
        "quality_level": "high",
        "budget_level": "medium",
        "selected_tag_ids": [
            "genre.dark_romance",
            "theme.revenge",
            "theme.hidden_identity",
            "emotion.suspense",
            "audience.romance",
            "hook.immediate_conflict",
            "cliffhanger.unanswered_threat",
        ],
        "added_tag_ids": [],
        "excluded_tag_ids": [],
        "excluded_patterns": ["海外平台术语", "直播带货", "秘密继承人捷径"],
        "creative_brief": {
            "hook": "从订婚宴即将公开证据的临界时刻开场。",
            "tone": "suspenseful",
            "pacing": "有推进但不过度压缩",
            "target_emotion": "持续期待",
            "asset_constraints": [],
            "generation_notes": [
                "这是长篇连载，不得提前解决矿难幕后主线。",
                "每集必须让苏晚作出可见选择，并留下可承接的状态变化。",
            ],
        },
        "character_contexts": [
            {
                "character_ref": "character.su_wan",
                "name": "苏晚",
                "role": "女主角、调查记者",
                "description": (
                    "28岁，冷静敏锐，因姐姐死于被掩盖的矿难而追查顾氏；"
                    "渴望公开真相，害怕再次信错人，底线是不牺牲无辜者。"
                ),
                "locked_fields": ["name", "role", "description"],
                "field_sources": {
                    "name": "user_provided",
                    "role": "user_provided",
                    "description": "user_provided",
                },
            },
            {
                "character_ref": "character.gu_chenzhou",
                "name": "顾沉舟",
                "role": "男主角、顾氏继承人",
                "description": (
                    "30岁，克制强势，表面阻止苏晚曝光，实际在调查父亲；"
                    "渴望终止家族罪恶，但恐惧真相毁掉所有亲近的人。"
                ),
                "locked_fields": ["name", "role", "description"],
                "field_sources": {
                    "name": "user_provided",
                    "role": "user_provided",
                    "description": "user_provided",
                },
            },
        ],
        "request_metadata": {
            "source": "cn_longform_600k_acceptance_v1",
            "generation_planning": {
                "episode_count_mode": "recommended",
                "total_episodes": PLANNED_EPISODES,
                "target_total_characters": TARGET_TOTAL_CHARACTERS,
                "preferred_episode_duration_minutes": 3,
                "story_density": "balanced",
                "batch_size": 5,
            },
        },
    }


def build_generation_request(
    *,
    resolution: dict[str, Any],
    episode_number: int,
    previous_draft: dict[str, Any] | None,
    batch_size: int,
) -> dict[str, Any]:
    batch_start = ((episode_number - 1) // batch_size) * batch_size + 1
    batch_end = min(PLANNED_EPISODES, batch_start + batch_size - 1)
    return {
        "content_spec_id": resolution["data"]["content_spec"]["id"],
        "generation_strategy_id": STRATEGY_ID,
        "output_language": "zh",
        "desired_scene_count": SCENE_COUNT,
        "target_script_body_characters": TARGET_EPISODE_BODY_CHARACTERS,
        "resolved_creative_context": resolution["data"]["resolved_creative_context"],
        "episode_context": {
            "generation_mode": "full",
            "episode_number": episode_number,
            "total_episodes": PLANNED_EPISODES,
            "previous_episode_summary": continuity_summary(previous_draft),
            "previous_episode_question": (
                previous_draft.get("next_episode_question") if previous_draft else None
            ),
            "episode_instruction": episode_instruction(episode_number),
            "project_continuity_summary": (
                "长篇主线：苏晚追查姐姐死亡与顾氏矿难；顾沉舟表面阻止、"
                "暗中调查父亲；两人在不信任中被迫合作。苏晚不牺牲无辜者，"
                "顾沉舟不能替苏晚决定真相如何公开。不得提前揭晓最终幕后主使。"
            ),
            "batch_context": {
                "batch_number": ((episode_number - 1) // batch_size) + 1,
                "start_episode": batch_start,
                "end_episode": batch_end,
                "batch_instruction": (
                    "承接既有状态并推进证据、关系或风险中的至少一项；"
                    "不得重置冲突、重复上一集揭露或解决长篇主线。"
                ),
            },
        },
    }


def continuity_summary(draft: dict[str, Any] | None) -> str | None:
    if draft is None:
        return None
    final_scene = draft.get("scenes", [])[-1] if draft.get("scenes") else {}
    causality = final_scene.get("scene_causality") or {}
    parts = [
        f"Episode title: {draft.get('title', '')}",
        f"Synopsis: {draft.get('synopsis', '')}",
        f"Final state change: {causality.get('outcome', '')}",
        f"Final turning point: {final_scene.get('turning_point', '')}",
    ]
    return "\n".join(part for part in parts if not part.endswith(": "))[:2000]


def episode_instruction(episode_number: int) -> str:
    if episode_number == 1:
        return (
            "建立苏晚准备公开矿难证据的核心矛盾，让她作出主动选择；"
            "结尾留下证据来源被操控的悬念，不解决主线。"
        )
    return (
        f"生成第{episode_number}集，直接承接上一集最终状态和未决问题；"
        "引入新的行动与代价，不复述上一集，不重置人物关系。"
    )


def post_with_technical_retries(
    client: httpx.Client,
    path: str,
    payload: dict[str, Any],
    *,
    retries: int,
    retry_delay_seconds: float,
) -> dict[str, Any]:
    for attempt in range(retries + 1):
        try:
            response = client.post(path, json=payload)
            if response.status_code < 400:
                return response.json()
            retryable = response.status_code in {429, 502, 503, 504} or (
                response.status_code == 422
                and "structured" in response.text.casefold()
            )
            if not retryable or attempt >= retries:
                response.raise_for_status()
            print(
                f"Technical HTTP {response.status_code}; retrying after "
                f"{retry_delay_seconds:g}s ({attempt + 1}/{retries}).",
                flush=True,
            )
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            if attempt >= retries:
                raise
            print(
                f"Technical {type(exc).__name__}; retrying after "
                f"{retry_delay_seconds:g}s ({attempt + 1}/{retries}).",
                flush=True,
            )
        time.sleep(retry_delay_seconds)
    raise RuntimeError("Technical retry loop ended unexpectedly.")


def serialize_failure(
    episode_number: int,
    exc: Exception,
    *,
    latency_seconds: float,
    started_at: datetime,
) -> dict[str, Any]:
    failure: dict[str, Any] = {
        "episode_number": episode_number,
        "error_type": type(exc).__name__,
        "error": str(exc),
        "latency_seconds": latency_seconds,
        "started_at": started_at.isoformat(),
        "failed_at": datetime.now(timezone.utc).isoformat(),
    }
    if isinstance(exc, httpx.HTTPStatusError):
        failure["status_code"] = exc.response.status_code
        try:
            failure["response"] = exc.response.json()
        except json.JSONDecodeError:
            failure["response"] = exc.response.text[:4000]
    return failure


def load_completed_runs(episodes_dir: Path) -> dict[int, dict[str, Any]]:
    completed: dict[int, dict[str, Any]] = {}
    for path in sorted(episodes_dir.glob("episode_*/run.json")):
        episode_number = int(path.parent.name.rsplit("_", 1)[1])
        completed[episode_number] = read_json(path)
    return completed


def ensure_contiguous(completed: dict[int, dict[str, Any]]) -> None:
    if not completed:
        return
    expected = list(range(1, max(completed) + 1))
    if sorted(completed) != expected:
        raise RuntimeError("Completed episode artifacts contain a gap; resolve it first.")


def calculate_episode_metrics(
    episode_number: int,
    run: dict[str, Any],
    *,
    latency_seconds: float,
    started_at: datetime,
) -> dict[str, Any]:
    data = run["data"]
    draft = data["draft_master_script"]
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
    usage = data.get("llm_raw_output", {}).get("_meta", {}).get("usage", {})
    scenes = draft.get("scenes", [])
    expected_characters = {"苏晚", "顾沉舟"}
    generated_characters = {
        item.get("name", "") for item in draft.get("characters", [])
    }
    return {
        "episode_number": episode_number,
        "title": draft.get("title"),
        "script_body_characters": count_effective("".join(actions + dialogues)),
        "action_characters": count_effective("".join(actions)),
        "dialogue_characters": count_effective("".join(dialogues)),
        "action_count": len(actions),
        "dialogue_count": len(dialogues),
        "scene_count": len(scenes),
        "scene_causality_complete": all(
            all((scene.get("scene_causality") or {}).get(key) for key in ("goal", "conflict", "outcome"))
            for scene in scenes
        ),
        "later_scenes_reference_prior_cause": all(
            (scene.get("scene_causality") or {}).get("caused_by_scene_number") is not None
            for scene in scenes[1:]
        ),
        "final_cliffhanger": bool(scenes and scenes[-1].get("cliffhanger")),
        "next_episode_question_present": bool(draft.get("next_episode_question")),
        "locked_characters_preserved": expected_characters <= generated_characters,
        "qc_overall_score": data.get("story_qc_report", {}).get("overall_score"),
        "qc_status": data.get("story_qc_report", {}).get("status"),
        "qc_dimension_scores": {
            item.get("dimension"): item.get("score")
            for item in data.get("story_qc_report", {}).get("dimension_evaluations", [])
        },
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "completion_tokens": usage.get("completion_tokens", 0),
        "total_tokens": usage.get("total_tokens", 0),
        "latency_seconds": latency_seconds,
        "started_at": started_at.isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }


def build_summary(
    completed: dict[int, dict[str, Any]], output_dir: Path
) -> dict[str, Any]:
    episode_metrics = []
    synopses: list[tuple[int, str]] = []
    dialogue_lines: dict[str, list[int]] = {}
    for episode_number, run in sorted(completed.items()):
        episode_dir = output_dir / "episodes" / f"episode_{episode_number:03d}"
        metrics_path = episode_dir / "metrics.json"
        if metrics_path.exists():
            metrics = read_json(metrics_path)
        else:
            metrics = calculate_episode_metrics(
                episode_number,
                run,
                latency_seconds=0,
                started_at=datetime.now(timezone.utc),
            )
        episode_metrics.append(metrics)
        draft = run["data"]["draft_master_script"]
        synopses.append((episode_number, draft.get("synopsis", "")))
        for scene in draft.get("scenes", []):
            for dialogue in scene.get("dialogues", []):
                normalized = normalize_text(dialogue.get("text", ""))
                if normalized:
                    dialogue_lines.setdefault(normalized, []).append(episode_number)

    body_characters = sum(item["script_body_characters"] for item in episode_metrics)
    completed_count = len(episode_metrics)
    average_body = round(body_characters / completed_count) if completed_count else 0
    estimated_episodes = (
        (TARGET_TOTAL_CHARACTERS + average_body - 1) // average_body
        if average_body
        else None
    )
    duplicate_synopsis_pairs = [
        {
            "left_episode": left_number,
            "right_episode": right_number,
            "similarity": round(SequenceMatcher(None, left, right).ratio(), 3),
        }
        for index, (left_number, left) in enumerate(synopses)
        for right_number, right in synopses[index + 1 :]
        if SequenceMatcher(None, left, right).ratio() >= 0.72
    ]
    repeated_dialogues = [
        {"text": text, "episodes": episode_numbers}
        for text, episode_numbers in dialogue_lines.items()
        if len(set(episode_numbers)) > 1 and len(text) >= 8
    ]
    structural_pass = all(
        item["scene_causality_complete"]
        and item["later_scenes_reference_prior_cause"]
        and item["final_cliffhanger"]
        and item["next_episode_question_present"]
        and item["locked_characters_preserved"]
        for item in episode_metrics
    )
    technical_failures = [
        read_json(path)
        for path in sorted((output_dir / "episodes").glob("episode_*/failure.json"))
    ]
    gate_status = (
        "blocked_provider"
        if technical_failures and completed_count < 5
        else "first_stage_pass"
        if completed_count >= 5
        and structural_pass
        and average_body >= 1_400
        and not duplicate_synopsis_pairs
        else "review_required"
    )
    return {
        "evaluation_id": "cn_longform_600k_acceptance_v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "completed_episodes": completed_count,
        "target_total_characters": TARGET_TOTAL_CHARACTERS,
        "script_body_characters": body_characters,
        "average_script_body_characters": average_body,
        "estimated_episodes_to_target": estimated_episodes,
        "projected_characters_at_estimated_episodes": (
            average_body * estimated_episodes if estimated_episodes else 0
        ),
        "total_tokens": sum(item["total_tokens"] for item in episode_metrics),
        "total_latency_seconds": round(
            sum(item["latency_seconds"] for item in episode_metrics), 3
        ),
        "structural_pass": structural_pass,
        "duplicate_synopsis_pairs": duplicate_synopsis_pairs,
        "repeated_dialogues": repeated_dialogues,
        "technical_failures": technical_failures,
        "gate_status": gate_status,
        "episode_metrics": episode_metrics,
    }


def write_reports(output_dir: Path, completed: dict[int, dict[str, Any]]) -> None:
    summary = build_summary(completed, output_dir)
    write_json(output_dir / "summary.json", summary)
    lines = [
        "# 中国大陆 60 万字长篇第一阶段真实模型验收",
        "",
        f"- 已完成集数：{summary['completed_episodes']}",
        f"- 动作与对白正文：{summary['script_body_characters']}",
        f"- 正文集均：{summary['average_script_body_characters']}",
        f"- 预计达标集数：{summary['estimated_episodes_to_target']}",
        f"- 总 Token：{summary['total_tokens']}",
        f"- 总模型耗时：{summary['total_latency_seconds']} 秒",
        f"- 结构检查：{'通过' if summary['structural_pass'] else '需复查'}",
        f"- 第一阶段 Gate：{summary['gate_status']}",
        "",
    ]
    if summary["technical_failures"]:
        latest_failure = summary["technical_failures"][-1]
        response = latest_failure.get("response", {})
        detail = response.get("detail", response) if isinstance(response, dict) else response
        lines.extend(
            [
                "## 当前技术阻断",
                "",
                f"- 失败集数：{latest_failure['episode_number']}",
                f"- HTTP 状态：{latest_failure.get('status_code', '-')}",
                f"- 耗时：{latest_failure['latency_seconds']} 秒",
                f"- 供应商响应：{str(detail)[:1000]}",
                "",
            ]
        )
    lines.extend(
        [
        "## 分集证据",
        "",
        ]
    )
    for episode_number, run in sorted(completed.items()):
        draft = run["data"]["draft_master_script"]
        metrics = next(
            item
            for item in summary["episode_metrics"]
            if item["episode_number"] == episode_number
        )
        lines.extend(
            [
                f"### 第 {episode_number} 集：{draft.get('title', '')}",
                "",
                f"- 正文字符：{metrics['script_body_characters']}",
                f"- Token：{metrics['total_tokens']}",
                f"- 耗时：{metrics['latency_seconds']} 秒",
                f"- Synopsis：{draft.get('synopsis', '')}",
                f"- 下集问题：{draft.get('next_episode_question', '')}",
                "",
            ]
        )
    (output_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")


def write_checkpoint(
    output_dir: Path,
    args: argparse.Namespace,
    completed: dict[int, dict[str, Any]],
    *,
    failed_episode_number: int | None = None,
    failure: dict[str, Any] | None = None,
) -> None:
    write_json(
        output_dir / "checkpoint.json",
        {
            "checkpoint_version": "cn_longform_acceptance.v1",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "requested_episodes": args.episodes,
            "completed_episode_numbers": sorted(completed),
            "next_episode_number": max(completed, default=0) + 1,
            "failed_episode_number": failed_episode_number,
            "last_failure": failure,
        },
    )


def write_manifest(
    output_dir: Path,
    args: argparse.Namespace,
    resolution: dict[str, Any],
    completed: dict[int, dict[str, Any]],
) -> None:
    write_json(
        output_dir / "manifest.json",
        {
            "evaluation_id": "cn_longform_600k_acceptance_v1",
            "evaluation_mode": "real_llm_resumable_bounded",
            "base_url": args.base_url,
            "strategy_id": STRATEGY_ID,
            "platform_profile_id": PLATFORM_PROFILE_ID,
            "content_spec_id": resolution["data"]["content_spec"]["id"],
            "target_total_characters": TARGET_TOTAL_CHARACTERS,
            "initial_planned_episodes": PLANNED_EPISODES,
            "target_episode_body_characters": TARGET_EPISODE_BODY_CHARACTERS,
            "requested_episodes": args.episodes,
            "completed_at_start": sorted(completed),
        },
    )


def count_effective(text: str) -> int:
    return sum(1 for character in text if character.isalnum())


def normalize_text(text: str) -> str:
    return "".join(character for character in text.casefold() if character.isalnum())


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(path)


if __name__ == "__main__":
    main()
