"""Bounded real-model body sampling with fixed planning inputs and isolated data."""

from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sys
import time
from typing import Any
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def replay_result_digest(response: dict[str, Any]) -> str:
    from copy import deepcopy

    stable = deepcopy(response)
    data = stable.get("data", {})
    # Durable checkpoints omit these debug copies; all domain fields must match.
    data.pop("llm_raw_output", None)
    prompt = data.get("prompt_build_result", {})
    prompt.pop("prompt_text", None)
    prompt.pop("rendered_variables", None)
    return digest(stable)


class _ProbeRouteLog(logging.Handler):
    def __init__(self, path: Path) -> None:
        super().__init__()
        self.path = path
        self.secrets = [value for key, value in os.environ.items()
                        if len(value) >= 8 and any(word in key.upper() for word in ("API_KEY", "TOKEN", "SECRET", "PASSWORD"))]

    def emit(self, record: logging.LogRecord) -> None:
        if not str(record.msg).startswith((
            "LLM route ", "Script model output failed validation",
            "Episode production-count repair",
        )):
            return
        text = record.getMessage()
        for secret in self.secrets:
            text = text.replace(secret, "[REDACTED]")
        text = re.sub(r"https?://\S+|gateway=\S+", "[endpoint]", text)
        with self.path.open("a", encoding="utf-8") as output:
            output.write(text + "\n")


def prepare_runtime(output: Path, release_region: str, *, existing: bool = False) -> Any:
    from alembic import command
    from alembic.config import Config

    database = output / "probe.db"
    if existing and not database.is_file():
        raise ValueError("Replay requires the original isolated probe database.")
    os.environ["DATABASE_URL"] = f"sqlite:///{database}"
    command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
    logging.disable(logging.NOTSET)
    logging.getLogger().handlers = [logging.NullHandler()]
    route_logger = logging.getLogger("app.modules.script_engine.llm_adapter")
    route_logger.handlers = [_ProbeRouteLog(output / "route_diagnostics.log")]
    route_logger.propagate = False
    route_logger.setLevel(logging.WARNING)
    for name in ("app.api.routes.script_generation", "app.modules.script_engine.generation_service"):
        diagnostic_logger = logging.getLogger(name)
        diagnostic_logger.handlers = [_ProbeRouteLog(output / "route_diagnostics.log")]
        diagnostic_logger.propagate = False
        diagnostic_logger.setLevel(logging.WARNING)

    from fastapi.testclient import TestClient
    from app.main import create_app
    from scripts.bootstrap_frontend_mvp_runtime import _bootstrap_payloads

    client = TestClient(create_app(), raise_server_exceptions=False)
    mainland = release_region == "cn_mainland"
    for path, payload in _bootstrap_payloads(
        "cn_mainland_comic_drama_v1" if mainland else "tiktok_frontend_mvp_v1",
        "frontend_mvp_cn" if mainland else "frontend_mvp",
        market_profile="cn_mainland" if mainland else "overseas_tiktok",
    ):
        response = client.post(path, json=payload)
        if response.status_code not in {201, 409}:
            raise RuntimeError(f"Bootstrap failed: {path} HTTP {response.status_code}")
    return client


def screenplay_markdown(draft: dict[str, Any], episode: int) -> str:
    from app.modules.master_script.models import normalize_screenplay_body_order

    scenes = draft.get("scenes", [])
    cast = draft.get("episode_cast") or list(dict.fromkeys(
        ref
        for scene in scenes
        for ref in scene.get("character_refs", [])
    ))
    locations = draft.get("locations") or list(dict.fromkeys(
        scene.get("scene_heading") or scene.get("setting_hint") or scene.get("setting") or scene.get("slug", "")
        for scene in scenes
    ))
    lines = [
        f"# 第 {episode} 集：{draft.get('title', '')}",
        "",
        "## 本集信息",
        f"剧情梗概：{draft.get('synopsis', '')}",
        f"本集目标：{draft.get('episode_goal', '')}",
        f"本集出场人物：{'、'.join(cast) or '待补充'}",
        f"使用场地：{'、'.join(locations) or '待补充'}",
        "场景清单：",
    ]
    for scene in scenes:
        manifest = scene.get("content_manifest") or {}
        heading = scene.get("scene_heading") or scene.get("setting_hint") or scene.get("setting") or scene.get("slug", "")
        refs = scene.get("character_refs") or manifest.get("character_refs") or [
            line.get("chinese_character_name") or line.get("character_name", "")
            for line in scene.get("dialogues", [])
        ]
        lines.extend([
            f"{scene['scene_number']}. {heading}",
            f"   出场人物：{'、'.join(dict.fromkeys(refs)) or '待补充'}",
            f"   场景任务：{manifest.get('objective') or scene.get('purpose', '')}",
            f"   主要阻力：{manifest.get('conflict') or scene.get('beat_summary', '')}",
            f"   场景结果：{manifest.get('outcome') or scene.get('turning_point') or scene.get('beat_summary', '')}",
            f"   必要道具：{'、'.join(manifest.get('props', [])) or '无特别道具'}",
            "",
        ])
    lines.extend(["## 正式正文", ""])
    for scene in scenes:
        lines.extend([f"## {scene.get('scene_heading') or scene.get('setting_hint') or scene.get('setting') or scene.get('slug', '')}", ""])
        actions = scene.get("character_actions", [])
        dialogues = scene.get("dialogues", [])
        order = normalize_screenplay_body_order(
            scene.get("body_order", []), action_count=len(actions), dialogue_count=len(dialogues),
        )
        for item in order:
            kind, index_text = item.split(":")
            index = int(index_text)
            if kind == "action":
                lines.extend([str(actions[index]), ""])
            elif kind == "dialogue":
                dialogue = dialogues[index]
                speaker = dialogue.get("character_name") or dialogue.get("character_ref", "")
                chinese_name = dialogue.get("chinese_character_name")
                if chinese_name and chinese_name != speaker:
                    speaker = f"{chinese_name}（{speaker.upper()}）"
                lines.extend([f"**{speaker}**：{dialogue.get('text', '')}", ""])
                if dialogue.get("chinese_translation"):
                    lines.extend([dialogue["chinese_translation"], ""])
    return "\n".join(lines)


def overseas_language_audit(draft: dict[str, Any], canonical_names: dict[str, str]) -> dict[str, Any]:
    from app.modules.master_script.models import DraftMasterScript
    from app.modules.script_engine.script_post_editor import ScriptPostEditor, _SPEAKER_MARKER

    parsed = DraftMasterScript.model_validate(draft)
    pair_issues = ScriptPostEditor.overseas_dialogue_pair_issues(parsed)
    language_issues = ScriptPostEditor._overseas_body_language_issues(parsed, include_narrative=True)
    assessment = ScriptPostEditor.assess_source(
        parsed, overseas_release=True, require_overseas_narrative_language=True,
        canonical_character_names=canonical_names,
    )
    rows = []
    name_issues = []
    for scene_index, scene in enumerate(parsed.scenes):
        for index, dialogue in enumerate(scene.dialogues):
            rows.append({"scene_number": scene.scene_number, "dialogue_index": index,
                         **dialogue.model_dump(mode="json")})
            expected = canonical_names.get(dialogue.chinese_character_name or "")
            speaker = _SPEAKER_MARKER.sub("", dialogue.character_name).strip()
            if (not re.search(r"[A-Za-z]", speaker)
                    or re.search(r"[\u3400-\u9fff]", speaker)
                    or (expected and expected.casefold() != speaker.casefold())):
                name_issues.append(f"scenes.{scene_index}.dialogues.{index}.character_name")
    return {
        "language_contract_passed": not (pair_issues or language_issues or name_issues),
        "pair_issues": pair_issues, "language_issues": language_issues,
        "canonical_name_issues": name_issues, "editorial_issues": assessment.issues,
        "duration": asdict(assessment.duration), "dialogues": rows,
        "translation_semantic_accuracy_verified": False,
    }


def report(output: Path, summary: dict[str, Any]) -> None:
    write_json(output / "summary.json", summary)
    lines = [
        "# 真实正文生成抽样测试", "",
        f"- 发行路径：`{summary.get('release_region', 'cn_mainland')}`",
        f"- 状态：`{summary['status']}`",
        f"- 完成：{len(summary['episodes'])}/{summary['requested_episodes']} 集",
        f"- 总耗时：{summary['elapsed_seconds']} 秒",
        "- 固定测试总纲、首个 8 集规划节点及前三集路线图；本次未测试 AI 规划质量。",
        ("- 后续请求复用产品的 provisional 账本投影与压缩，检查点随分集请求保存；不等于长篇质量验收。"
         if summary.get("continuity_projection") == "product_typescript"
         else "- 前集以正文交接摘要承接，未注入完整结构化连续性检查点；不构成正式账本端到端验收。"),
        "- 独立 SQLite 数据库；正文保存为 provisional 草稿，不批准用户作品。",
        "- 这是短样本测试，不能证明整部 8–20 万字的质量或长程连续性。", "",
        "## 分集结果", "",
        "| 集数 | 有效正文字数 | 场景 | 动作 | 对白 | 耗时（秒） | 连续性状态 | 阻断项 | 警告 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for item in summary["episodes"]:
        lines.append(
            f"| {item['episode_number']} | {item['effective_body_characters']} | "
            f"{item['scene_count']} | {item['action_count']} | {item['dialogue_count']} | "
            f"{item['latency_seconds']} | {item.get('continuity_status', '未记录')} | "
            f"{item['blocking_continuity_issues']} | {item.get('continuity_warning_count')} |"
        )
    if summary.get("resume"):
        resume = summary["resume"]
        lines.extend([
            "", "## 续跑来源与本轮范围", "",
            f"- 来源：`{resume['source_directory']}`",
            f"- 修订来源：`{resume.get('revised_directory') or '未使用修订稿'}`",
            f"- 继承集数：{resume['inherited_episodes']}；本轮新生成：{resume['new_episode_numbers']}。",
            "- 继承稿的本轮生成耗时为空；历史耗时不计入本轮预算。修订稿不算新模型生成。",
            "- 本轮物理请求与截止预算只覆盖新增调用；历史中断请求的未知用量仍保留为未知。",
            "- 分轮续跑不能证明三集在同一轮时限内生成。", "",
            "| 集数 | 来源 | 历史生成耗时（秒） | 本轮生成耗时（秒） |",
            "| --- | --- | --- | --- |",
            *[f"| {item['episode_number']} | {item.get('origin')} | "
              f"{item.get('historical_generation_latency_seconds', '不适用')} | {item['latency_seconds']} |"
              for item in summary["episodes"]],
            "", "历史调用与用量（不计本轮）：", "",
            "```json", json.dumps(resume["historical_provider"], ensure_ascii=False, indent=2), "```",
            "", "下方请求与用量仅统计本轮新增调用。",
        ])
    lines.extend([
        "", "## 海外语言契约", "",
        *[f"- 第 {item['episode_number']} 集：{'通过' if item['language_contract_passed'] else '需检查'}；"
          "详见分集 language_audit.json。" for item in summary["episodes"] if "language_contract_passed" in item],
        "字符与字段检查不能证明译文语义准确，也不替代正文阅读。",
        "", "## 请求与用量", "",
        "底层实际请求包含生成、修复、重试和后处理。缺失用量不按零计算。",
        "未提供供应商计费价目，费用不估填；JSON 用量不是最终账单。", "",
        "```json", json.dumps(summary.get("provider", {}), ensure_ascii=False, indent=2), "```",
        "", "## 范围", "",
        "机器连续性诊断仅用于定位待审阅问题；人物动机、证据因果、情节重复及可表演性需要阅读正文确认。",
        "原始请求和结果保存在 episode_* 目录，provider_requests.jsonl 不记录凭据或提示词。",
    ])
    if summary.get("failure"):
        lines.extend(["", "## 停止原因", "", "```json",
                      json.dumps(summary["failure"], ensure_ascii=False, indent=2), "```"])
    (output / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _ensure_real_generation_runtime(release_region: str) -> None:
    """Reject a normal probe run when its selected market script route is mock."""
    from app.llm_runtime import (
        build_market_routed_role_adapter_from_env,
        build_script_generation_adapter_from_env,
    )
    from app.modules.script_engine.llm_adapter import MarketRoutedLLMAdapter

    fallback = build_script_generation_adapter_from_env()
    adapter = build_market_routed_role_adapter_from_env(
        "SCRIPT",
        fallback=fallback,
        default_timeout_seconds=600,
        default_max_retries=1,
        default_reasoning_effort="high",
        default_thinking_mode="enabled",
        default_use_strict_schema=False,
        default_send_response_format=False,
        default_retry_empty_response=True,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=True,
    )
    if isinstance(adapter, MarketRoutedLLMAdapter):
        market_path = "overseas_tiktok" if release_region == "overseas" else "cn_mainland"
        _, adapter = adapter._select_with_market(f"Market path: {market_path}")
    model_info = adapter.get_model_info()
    if model_info.provider.strip().casefold() == "mock":
        raise RuntimeError(
            "Real generation requires a configured non-mock script route; "
            f"the effective {release_region} script route is mock."
        )


def verify_replay(output: Path) -> int:
    from scripts.real_generation_probe_transport import ProviderRequestMeter

    results = []
    summary = json.loads((output / "summary.json").read_text())
    with ProviderRequestMeter(output / "replay_requests.jsonl", max_requests=0) as meter:
        with prepare_runtime(output, summary.get("release_region", "cn_mainland"), existing=True) as client:
            for directory in sorted(output.glob("episode_*")):
                if not (directory / "run.json").is_file():
                    continue
                request = json.loads((directory / "request.json").read_text())
                original = json.loads((directory / "run.json").read_text())
                provenance_path = directory / "provenance.json"
                provenance = json.loads(provenance_path.read_text()) if provenance_path.is_file() else {}
                if provenance.get("origin") == "inherited_editorial_revision":
                    from scripts.real_generation_probe_fixture import _data
                    number = int(directory.name.removeprefix("episode_"))
                    workspace = _data(client, "GET", f"/story-projects/{summary['project_id']}/workspace")["workspace_payload"]
                    episode = next((item for item in workspace["episodes"] if item["episodeNumber"] == number), None)
                    reference = (episode or {}).get("artifactRefs", {}).get("revised", {})
                    if reference.get("artifactId"):
                        artifact = _data(client, "GET", f"/story-projects/{summary['project_id']}/episodes/{number}/artifacts/{reference['artifactId']}")
                        same = (artifact["content_payload"] == original["data"]
                                and episode["generationRun"] == original["data"]
                                and json.loads(episode["workingDraftJson"]) == original["data"]["draft_master_script"])
                    else:
                        same = False
                    results.append({"episode": directory.name, "verification": "inherited_revised_artifact_retrieval",
                                    "identical_saved_result": same, "generation_replayed": False})
                    continue
                response = client.post("/script-generation/generate-draft", json=request)
                replayed = response.json() if response.status_code == 200 else None
                same = replayed is not None and replay_result_digest(replayed) == replay_result_digest(original)
                results.append({"episode": directory.name, "http_status": response.status_code,
                                "identical_saved_result": same,
                                "identical_full_response": replayed is not None and digest(replayed) == digest(original)})
    result = {"passed": bool(results) and all(item["identical_saved_result"] for item in results),
              "episodes": results, "provider": meter.summary(),
              "checkpoint_debug_fields_excluded": ["data.llm_raw_output",
                                                    "data.prompt_build_result.prompt_text",
                                                    "data.prompt_build_result.rendered_variables"]}
    write_json(output / "replay_verification.json", result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0 if result["passed"] else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--release-region", choices=("cn_mainland", "overseas"), default="overseas")
    parser.add_argument("--episodes", type=int, choices=range(1, 4), default=3)
    parser.add_argument("--max-provider-requests", type=int, default=12)
    parser.add_argument("--deadline-seconds", type=float, default=900)
    parser.add_argument("--request-timeout-seconds", type=float, default=180)
    parser.add_argument("--script-reasoning-effort", choices=("low", "medium", "high"))
    parser.add_argument("--fixture-version", choices=("v1", "v2"), default="v1")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--verify-replay", action="store_true")
    parser.add_argument("--resume-from", type=Path,
                        help="Resume missing episodes from validated historical evidence in a new database copy.")
    parser.add_argument("--revised-dir", type=Path,
                        help="Use a provenance-checked editorial revision bundle with --resume-from.")
    parser.add_argument("--allow-source-change", action="append", default=[], metavar="PATH=SHA256",
                        help="Acknowledge one exact code fingerprint change relative to the historical source.")
    parser.add_argument("--audit-continuity", type=Path,
                        help="Reuse saved real prose to audit product continuity with zero model requests.")
    args = parser.parse_args()
    output = (args.output_dir or ROOT / ".cache" / "real-generation-probe"
              / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")).resolve()
    if sum(bool(value) for value in (args.verify_replay, args.audit_continuity, args.resume_from)) > 1:
        parser.error("--verify-replay, --audit-continuity and --resume-from are separate operations.")
    if (args.revised_dir or args.allow_source_change) and not args.resume_from:
        parser.error("--revised-dir and --allow-source-change require --resume-from.")
    if args.verify_replay:
        return verify_replay(output)
    if args.audit_continuity:
        from scripts.audit_real_probe_continuity import audit_continuity
        return audit_continuity(args.audit_continuity.resolve(), output)
    resume = None
    if args.resume_from:
        from scripts.real_generation_probe_resume import load_resume_source
        if output == args.resume_from.resolve() or output.is_relative_to(args.resume_from.resolve()):
            parser.error("Resume output must be separate from the immutable source directory.")
        if args.revised_dir and (output == args.revised_dir.resolve() or output.is_relative_to(args.revised_dir.resolve())):
            parser.error("Resume output must be separate from the immutable editorial revision directory.")
        try:
            resume = load_resume_source(
                args.resume_from, episodes=args.episodes, release_region=args.release_region,
                fixture_version=args.fixture_version, allowed_source_changes=args.allow_source_change,
                revised_directory=args.revised_dir,
            )
        except (ValueError, KeyError, OSError) as error:
            parser.error(str(error))
    if not args.prepare_only:
        try:
            _ensure_real_generation_runtime(args.release_region)
        except RuntimeError as error:
            parser.error(str(error))
    output.mkdir(parents=True, exist_ok=False)
    if args.script_reasoning_effort:
        market = "OVERSEAS" if args.release_region == "overseas" else "CN"
        os.environ[f"LLM_{market}_SCRIPT_REASONING_EFFORT"] = args.script_reasoning_effort

    from scripts.real_generation_probe_transport import ProviderRequestMeter
    from scripts.real_generation_probe_fixture import (
        setup_probe, build_probe_request, save_probe_artifact, fixture_metadata,
    )
    from scripts.real_generation_probe_continuity import CONTINUITY_SOURCES
    from scripts.run_cn_recursive_600k_acceptance import episode_metrics

    summary: dict[str, Any] = {
        "status": "preparing", "requested_episodes": args.episodes, "episodes": [],
        "release_region": args.release_region,
        "continuity_projection": "product_typescript",
        "script_reasoning_effort_override": args.script_reasoning_effort,
        "fixture": fixture_metadata(args.fixture_version),
        "source_hashes": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in (Path(__file__), ROOT / "scripts/real_generation_probe_fixture.py",
                                       ROOT / "scripts/real_generation_probe_resume.py",
                                       ROOT / "scripts/real_generation_probe_transport.py",
                                       ROOT / "scripts/run_with_wall_timeout.py",
                                       ROOT / "backend/app/modules/script_engine/prompt_builder.py",
                                       ROOT / "backend/app/modules/script_engine/script_post_editor.py",
                                       ROOT / "backend/app/modules/script_engine/generation_service.py",
                                       ROOT / "backend/app/modules/script_engine/models.py",
                                       ROOT / "backend/app/modules/script_engine/long_story_models.py",
                                       ROOT / "backend/app/modules/script_engine/continuity_ledger.py",
                                       ROOT / "backend/app/modules/script_engine/llm_adapter.py",
                                       ROOT / "backend/app/modules/script_engine/llm_deadline.py",
                                       ROOT / "backend/app/modules/script_engine/llm_stream_progress.py",
                                       ROOT / "backend/app/llm_runtime.py",
                                       ROOT / "backend/app/dependencies.py",
                                       ROOT / "backend/app/modules/script_engine/continuity_qc.py",
                                       *CONTINUITY_SOURCES)},
        "started_at": datetime.now(timezone.utc).isoformat(), "elapsed_seconds": 0,
        "limits": {"max_provider_requests": args.max_provider_requests,
                   "new_request_deadline_seconds": args.deadline_seconds,
                   "request_timeout_seconds": args.request_timeout_seconds},
        "deadline_environment": {name: os.getenv(name) for name in (
            "LLM_INITIAL_GENERATION_TIMEOUT_SECONDS",
            "LLM_OVERSEAS_SCRIPT_REQUEST_DEADLINE_SECONDS",
            "LLM_OVERSEAS_SCRIPT_REPAIR_REQUEST_DEADLINE_SECONDS",
            "LLM_SCRIPT_REQUEST_DEADLINE_SECONDS",
            "LLM_SCRIPT_REPAIR_REQUEST_DEADLINE_SECONDS",
        )},
    }
    if resume:
        from scripts.real_generation_probe_resume import copy_resume_database
        copy_resume_database(resume, output)
        summary["resume"] = {
            "source_directory": str(resume["source"]),
            "revised_directory": str(resume["revised_directory"]) if resume["revised_directory"] else None,
            "source_files_sha256": resume["source_files_sha256"],
            "revision_files_sha256": resume["revision_files_sha256"],
            "source_code_changes": resume["source_code_changes"],
            "inherited_episodes": [item["episode_number"] for item in resume["selected"]],
            "first_new_episode": len(resume["selected"]) + 1,
            "new_episode_numbers": [], "historical_provider": resume["historical_provider"],
            "historical_elapsed_seconds": resume["historical_elapsed_seconds"],
            "historical_elapsed_is_intermediate_snapshot": resume["historical_elapsed_is_intermediate_snapshot"],
            "current_budget_scope": "new_provider_requests_only",
            "current_elapsed_scope": "this_resume_invocation_only",
            "single_run_performance_acceptance": False,
            "retired_incomplete_agent_ids_in_copy": resume["stale_agent_ids"],
        }
    started = time.perf_counter()
    meter = ProviderRequestMeter(
        output / "provider_requests.jsonl",
        max_requests=0 if args.prepare_only else args.max_provider_requests,
        deadline_seconds=args.deadline_seconds,
        request_timeout_seconds=args.request_timeout_seconds,
    )
    print(f"Artifacts: {output}", flush=True)
    try:
        with meter, prepare_runtime(output, args.release_region) as client:
            if resume:
                from scripts.real_generation_probe_resume import restore_resume_state
                state, previous = restore_resume_state(client, resume, output)
                for item in resume["selected"]:
                    number = item["episode_number"]
                    draft = item["run"]["data"]["draft_master_script"]
                    metrics = episode_metrics(number, draft, 0)
                    metrics.update(origin=item["origin"], latency_seconds=None,
                                   historical_generation_latency_seconds=item["metrics"]["latency_seconds"],
                                   action_count=sum(len(scene["character_actions"]) for scene in draft["scenes"]),
                                   dialogue_count=sum(len(scene["dialogues"]) for scene in draft["scenes"]),
                                   blocking_continuity_issues=(item["run"]["data"].get("continuity_qc_report") or {}).get("blocking_issue_count"),
                                   continuity_warning_count=(item["run"]["data"].get("continuity_qc_report") or {}).get("warning_count"),
                                   continuity_status=(item["run"]["data"].get("continuity_qc_report") or {}).get("status"))
                    directory = output / f"episode_{number:03d}"
                    if args.release_region == "overseas":
                        audit = overseas_language_audit(draft, state["canonical_names"])
                        write_json(directory / "language_audit.json", audit)
                        metrics["language_contract_passed"] = audit["language_contract_passed"]
                    write_json(directory / "metrics.json", metrics)
                    summary["episodes"].append(metrics)
                first_episode = len(resume["selected"]) + 1
            else:
                state = setup_probe(client, release_region=args.release_region, fixture_version=args.fixture_version)
                previous = None
                first_episode = 1
            write_json(output / "fixed_inputs.json", state)
            summary["project_id"] = state["project"]["project_id"]
            summary["provider"] = meter.summary()
            write_json(output / "run_manifest.json", summary)
            if resume:
                report(output, summary)
            # Later requests depend on actual preceding prose, unavailable in preflight.
            for episode in range(first_episode, (first_episode if args.prepare_only else args.episodes) + 1):
                directory = output / f"episode_{episode:03d}"
                directory.mkdir()
                payload = build_probe_request(state, episode, previous)
                if resume:
                    payload["agent_request_id"] = f"agent-request.probe-resume.{uuid4().hex}.ep{episode}"
                write_json(directory / "request.json", payload)
                if args.prepare_only:
                    continue
                print(f"Episode {episode}/{args.episodes}: generating", flush=True)
                tick = time.perf_counter()
                response = client.post("/script-generation/generate-draft", json=payload)
                latency = round(time.perf_counter() - tick, 3)
                if response.status_code != 200:
                    summary["failure"] = {
                        "episode": episode, "http_status": response.status_code,
                        "error_type": response.headers.get("X-Generation-Error-Type"),
                        "failure_class": response.headers.get("X-Generation-Failure-Class"),
                    }
                    write_json(directory / "failure.json", summary["failure"])
                    summary["status"] = "generation_failed"
                    break
                run = response.json()
                write_json(directory / "run.json", run)
                data = run["data"]
                draft = data["draft_master_script"]
                write_json(directory / "draft.json", draft)
                (directory / "SCREENPLAY.md").write_text(screenplay_markdown(draft, episode), encoding="utf-8")
                metrics = episode_metrics(episode, draft, latency)
                if resume:
                    metrics["origin"] = "new_generation"
                    summary["resume"]["new_episode_numbers"].append(episode)
                metrics["action_count"] = sum(len(scene["character_actions"]) for scene in draft["scenes"])
                metrics["dialogue_count"] = sum(len(scene["dialogues"]) for scene in draft["scenes"])
                metrics["blocking_continuity_issues"] = (data.get("continuity_qc_report") or {}).get("blocking_issue_count")
                metrics["continuity_warning_count"] = (data.get("continuity_qc_report") or {}).get("warning_count")
                metrics["continuity_status"] = (data.get("continuity_qc_report") or {}).get("status")
                write_json(directory / "continuity_audit.json", data.get("continuity_qc_report"))
                if args.release_region == "overseas":
                    audit = overseas_language_audit(draft, payload["episode_context"]["canonical_character_names"])
                    write_json(directory / "language_audit.json", audit)
                    metrics["language_contract_passed"] = audit["language_contract_passed"]
                write_json(directory / "metrics.json", metrics)
                summary["episodes"].append(metrics)
                save_probe_artifact(client, state, episode, data)
                write_json(directory / "projected_workspace.json", state["workspace"])
                previous = draft
                summary["provider"] = meter.summary()
                summary["elapsed_seconds"] = round(time.perf_counter() - started, 3)
                report(output, summary)
                print(f"Episode {episode}: saved {metrics['effective_body_characters']} body characters in {latency}s", flush=True)
            else:
                summary["status"] = "prepared" if args.prepare_only else "sample_generated"
    except Exception as error:
        summary["status"] = "probe_failed"
        summary["failure"] = {"error_type": type(error).__name__}
        if resume and isinstance(error, ValueError):
            summary["failure"]["detail"] = str(error)
        import httpx
        if isinstance(error, httpx.HTTPStatusError):
            summary["failure"].update(http_status=error.response.status_code, api_path=error.request.url.path)
            if error.response.status_code in {400, 409, 422}:
                summary["failure"]["validation"] = error.response.json()
        print(f"Probe stopped: {type(error).__name__}", flush=True)
    finally:
        summary["provider"] = meter.summary()
        summary["elapsed_seconds"] = round(time.perf_counter() - started, 3)
        if resume:
            from scripts.real_generation_probe_resume import verify_resume_inputs_unchanged
            try:
                verify_resume_inputs_unchanged(resume)
                summary["resume"]["inputs_unchanged"] = True
            except ValueError as error:
                summary.update(status="probe_failed", failure={"error_type": type(error).__name__, "detail": str(error)})
                summary["resume"]["inputs_unchanged"] = False
            summary["resume"]["new_provider"] = summary["provider"]
            write_json(output / "run_manifest.json", summary)
        report(output, summary)
    print(f"Status: {summary['status']}; completed: {len(summary['episodes'])}/{args.episodes}", flush=True)
    print(f"Report: {output / 'REPORT.md'}", flush=True)
    return 0 if summary["status"] in {"prepared", "sample_generated"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
