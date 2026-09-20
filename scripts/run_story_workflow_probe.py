"""Bounded input-to-planning-to-script probe with an isolated SQLite database."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import sys
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "backend")]
REVIEW_CASE = ROOT / "scripts/story_workflow_review_case.v1.json"


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--real", action="store_true")
    parser.add_argument("--config", type=Path, help="Safely parse model settings; never execute dotenv contents.")
    parser.add_argument("--current-flow", action="store_true", help="Include synopsis and the current semantic quality gate.")
    parser.add_argument("--planning-episodes", type=int, choices=(8, 48), default=48)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--release-region", choices=("cn_mainland", "overseas"), default="cn_mainland")
    parser.add_argument("--episodes", type=int, choices=(1, 2, 3), default=2)
    parser.add_argument("--max-provider-requests", type=int, default=30)
    parser.add_argument("--deadline-seconds", type=float, default=1500)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.config:
        if not args.real:
            parser.error("--config requires --real")
        from scripts.run_local_preview_backend import configure_environment, parse_env
        configure_environment(parse_env(args.config.read_text(encoding="utf-8-sig")))
    total_episodes = args.planning_episodes
    target_characters = 80000 if total_episodes == 48 else total_episodes * 1667
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=args.resume)
    previous = json.loads((output / "summary.json").read_text()) if args.resume else None
    if previous and (previous.get("release_region", "cn_mainland") != args.release_region
                     or previous["requested_body_episodes"] != args.episodes
                     or previous.get("planning_episodes", 48) != total_episodes
                     or previous.get("current_flow", False) != args.current_flow):
        raise ValueError("Resume must retain the original market and episode count.")
    if previous:
        dump(output / f"summary-before-resume-{uuid4().hex[:8]}.json", previous)
    if not args.real:
        for key in list(os.environ):
            if key.startswith("LLM_"):
                del os.environ[key]
        os.environ["LLM_PROVIDER"] = "mock"
    os.environ["SCRIPT_CREATIVE_DEEPENING_ENABLED"] = "false"
    os.environ["AGENT_RUNTIME_INSTANCE_ID"] = f"review-{uuid4().hex}"
    from scripts.run_real_generation_probe import prepare_runtime, screenplay_markdown, replay_result_digest
    from scripts.real_generation_probe_transport import ProviderRequestMeter
    from scripts.run_cn_longform_acceptance import creative_intent
    from scripts.real_generation_probe_fixture import (
        _workspace, _save_workspace, save_probe_artifact, _overseas_fixture, OVERSEAS_NAMES,
        STRATEGY_ID, OVERSEAS_STRATEGY_ID,
    )
    from scripts.probe_production_counts import capture_count_repairs
    from scripts.real_generation_probe_capture import capture_structured_responses
    from scripts.real_generation_probe_continuity import project_probe_continuity
    from app.modules.script_engine.long_story_models import (
        MAX_EPISODE_READY_SPAN, MIN_EPISODE_READY_SPAN, StoryProject, StoryBibleCharacterInput,
    )
    from app.modules.script_engine.models import ScriptGenerationDraftRequest, ApprovedEpisodePlanContext, ApprovedStoryNodeContext
    from app.llm_runtime import get_llm_runtime_config

    config = get_llm_runtime_config()
    if args.real and config.use_mock_adapter:
        raise RuntimeError("Real workflow requires a non-mock base runtime.")
    summary = {"mode": "real" if args.real else "mock", "status": "running", "steps": [],
               "simulated_test_approvals": True, "whole_work_quality_accepted": False,
               "requested_body_episodes": args.episodes, "release_region": args.release_region,
               "planning_episodes": total_episodes, "current_flow": args.current_flow,
               "model_role_settings": {
                   name: value for name, value in sorted(os.environ.items())
                   if name.startswith("LLM_") and name.endswith((
                       "MODEL", "WIRE_API", "THINKING_MODE", "REASONING_EFFORT",
                       "TIMEOUT_SECONDS", "REQUEST_DEADLINE_SECONDS", "MAX_RETRIES", "CHUNK_SIZE",
                   ))
               },
               "scope": "input-to-planning-to-episode-drafts-save-markdown-replay",
               "source_hashes": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                                 for p in [Path(__file__), REVIEW_CASE, ROOT / "backend/app/modules/script_engine/story_planning_service.py",
                                           ROOT / "backend/app/modules/script_engine/generation_service.py",
                                           ROOT / "backend/app/llm_runtime.py",
                                           ROOT / "backend/app/modules/script_engine/llm_protocol.py",
                                           ROOT / "backend/app/modules/script_engine/llm_adapter.py"]}}
    start = time.monotonic()
    current = "bootstrap"
    client = prepare_runtime(output, args.release_region, existing=args.resume)
    meter = ProviderRequestMeter(output / "provider_requests.jsonl", max_requests=args.max_provider_requests if args.real else 0,
                                 deadline_seconds=args.deadline_seconds, request_timeout_seconds=300)

    def call(label, method, path, payload=None, expected=(200, 201)):
        nonlocal current
        current = label
        print(f"{label}: started", flush=True)
        cached_path = output / f"{len(summary['steps']):02d}-{label}.json"
        cached_step = next((s for s in previous["steps"] if s["stage"] == label), None) if previous else None
        if cached_step and cached_step["status"] in expected and cached_path.is_file():
            cached = json.loads(cached_path.read_text())
            summary["steps"].append({**cached_step, "reused_saved_step": True})
            print(f"{label}: reused saved successful step", flush=True)
            return cached["response"]["data"]
        tick = time.monotonic()
        response = client.request(method, path, **({"json": payload} if payload is not None else {}))
        data = response.json()
        dump(output / f"{len(summary['steps']):02d}-{label}.json", {"request": payload, "response": data})
        summary["steps"].append({"stage": label, "status": response.status_code, "seconds": round(time.monotonic()-tick, 3)})
        dump(output / "summary.json", summary)
        print(f"{label}: HTTP {response.status_code}", flush=True)
        if response.status_code not in expected:
            raise RuntimeError(f"{label}: unexpected HTTP {response.status_code}")
        return data["data"]

    def approve_bible(bible):
        approved = {**bible, "version": bible["version"]+1, "status": "approved", "approved_at": datetime.now(timezone.utc).isoformat()}
        return call("bible-confirm", "PUT", f"/story-projects/{pid}/story-bibles/{bible['story_bible_id']}/versions/{approved['version']}", approved)

    def approve_node(node, depth):
        span = node["planned_end_episode"]-node["planned_start_episode"]+1
        approved = {**node, "version": node["version"]+1, "status": "approved", "approved_at": datetime.now(timezone.utc).isoformat(),
                    "expansion_status": "episode_ready" if MIN_EPISODE_READY_SPAN <= span <= MAX_EPISODE_READY_SPAN else "expanded"}
        return call(f"node-confirm-{depth}", "PUT", f"/story-projects/{pid}/plan-nodes/{node['node_id']}/versions/{approved['version']}", approved)

    try:
        with meter, capture_structured_responses(output), capture_count_repairs(output):
            intent = creative_intent()
            intent["title"] = "封存前夜：隔离全流程审查"
            intent["commercial_goal"]["summary"] = "验证八万字连载的规划与开篇连续集链路，非整部创意质量验收。"
            intent["platform_goal"]["target_duration_seconds"] = 90
            intent["selected_tag_ids"] = [{"hook.immediate_conflict": "hook.crisis_opening", "cliffhanger.unanswered_threat": "cliffhanger.new_threat"}.get(t,t) for t in intent["selected_tag_ids"]]
            review_case = json.loads(REVIEW_CASE.read_text(encoding="utf-8"))
            dump(output / "input-case.json", review_case)
            intent["free_creative_prompt"] = "\n".join([
                review_case["creative_prompt"],
                *review_case["locked_test_facts"],
                *review_case["review_criteria"],
            ])
            intent["request_metadata"] = {"source": "isolated_full_workflow_review", "generation_planning": {
                "episode_count_mode": "custom", "total_episodes": total_episodes, "target_total_characters": target_characters,
                "preferred_episode_duration_minutes": 1.5, "story_density": "balanced", "batch_size": args.episodes}}
            creative_source = intent["free_creative_prompt"]
            intent["free_creative_prompt"] = "调查记者苏晚拿到姐姐矿难死亡补偿单，付款早于公司宣称的事故时刻。她必须先核验付款性质和真伪，在保护证人与失去公开机会之间选择，与尚不知真相的未婚夫顾沉舟逐步查明责任链。"
            intent["creative_brief"]["generation_notes"].append(creative_source)
            overseas = args.release_region == "overseas"
            if overseas:
                intent = _overseas_fixture(intent)
                creative_source = _overseas_fixture(creative_source)
                market_rules = "故事位于虚构英语矿业小镇河湾镇。伊芙 = Eve Hart；亚当 = Adam Cole；诺拉 = Nora Reed。叙事用中文，英文对白逐句附中文译文。"
                creative_source += "\n" + market_rules
                intent["creative_brief"]["generation_notes"].append(market_rules)
                intent["platform_goal"].update(platform_profile_id="tiktok_frontend_mvp_v1",
                    objective="面向英语社区观众的悬疑情感连载，中文叙事和中英双语对白。")
                intent["audience_goal"]["summary"] = "英语社区的成年悬疑短剧观众。"
                intent["selected_tag_ids"] = ["hook.immediate_conflict" if tag == "hook.crisis_opening" else
                    "cliffhanger.unanswered_threat" if tag == "cliffhanger.new_threat" else tag for tag in intent["selected_tag_ids"]]
            call("input-readiness", "POST", "/input-readiness/analyze", {
                "creative_prompt": creative_source, "episode_count": total_episodes, "target_total_characters": target_characters})
            resolution = call("resolve-intent", "POST", "/content-specs/resolve-creative-intent", intent)
            pid = f"story_project.review.{uuid4().hex[:12]}"
            project = StoryProject(project_id=pid, title=intent["title"], content_spec_id=resolution["content_spec"]["id"],
                                   output_language="en" if overseas else "zh", target_total_characters=target_characters, planned_episode_count=total_episodes,
                                   default_batch_size=args.episodes).model_dump(mode="json")
            project = call("project-create", "PUT", f"/story-projects/{pid}", project)
            pid = project["project_id"]
            summary["project_id"] = pid
            strategy = OVERSEAS_STRATEGY_ID if overseas else STRATEGY_ID
            synopsis = None
            if args.current_flow:
                synopsis = call("synopsis-generate", "POST", f"/story-projects/{pid}/story-bibles/synopsis-draft", {
                    "story_project_id": pid, "content_spec_id": project["content_spec_id"],
                    "generation_strategy_id": strategy, "creative_prompt": creative_source,
                    "target_episode_count": total_episodes})
                summary["synopsis_review"] = synopsis["review"]
            chars = [StoryBibleCharacterInput.model_validate({k:v for k,v in c.items() if k in StoryBibleCharacterInput.model_fields}).model_dump(mode="json") for c in intent["character_contexts"]]
            bible = call("bible-generate", "POST", f"/story-projects/{pid}/story-bibles/draft", {
                "story_project_id": pid, "content_spec_id": project["content_spec_id"], "generation_strategy_id": strategy,
                "creative_prompt": creative_source, "characters": chars, "target_episode_count": total_episodes,
                **({"confirmed_synopsis": synopsis["text"],
                    "synopsis_review_notes": [issue["message"] for issue in synopsis["review"]["issues"]]} if synopsis else {}),
                "author_instruction": "只根据作者原始设定规划，保持有证据的推断、真实可演的选择与代价。"})
            bible = approve_bible(bible)
            nodes = call("tree-generate", "POST", f"/story-projects/{pid}/plan-nodes/top-level/draft", {
                "story_project_id": pid, "story_bible_id": bible["story_bible_id"], "story_bible_version": bible["version"],
                "generation_strategy_id": strategy, "target_episode_count": total_episodes})
            node = min(nodes, key=lambda n:n["planned_start_episode"])
            for depth in range(6):
                node = approve_node(node, depth)
                if node["expansion_status"] == "episode_ready":
                    break
                nodes = call(f"decompose-{depth}", "POST", f"/story-projects/{pid}/plan-nodes/{node['node_id']}/decompose", {
                    "story_project_id": pid, "parent_node_id": node["node_id"], "parent_node_version": node["version"],
                    "generation_strategy_id": strategy, "max_episode_ready_span": MAX_EPISODE_READY_SPAN})
                node = min(nodes, key=lambda n:n["planned_start_episode"])
            else:
                raise RuntimeError("Planning did not reach an episode-ready leaf within six levels.")
            plans = []
            while len(plans) < node["planned_end_episode"]-node["planned_start_episode"]+1:
                first = node["planned_start_episode"]+len(plans)
                chunk = call(f"roadmap-{first}", "POST", f"/story-projects/{pid}/plan-nodes/{node['node_id']}/episode-plans/chunk", {
                    "story_project_id": pid, "source_node_id": node["node_id"], "source_node_version": node["version"],
                    "generation_strategy_id": strategy, "episode_number": first, "accepted_plans": plans,
                    "agent_request_id": f"review.roadmap.{uuid4().hex}"})
                if not chunk:
                    raise RuntimeError("Empty roadmap chunk")
                plans.extend(chunk)
            project = call("project-readback", "GET", f"/story-projects/{pid}")
            names = OVERSEAS_NAMES.copy() if overseas else {c["name"]:c["name"] for c in bible["character_registry"]}
            state = {"project": project, "bible": bible, "node": node, "plans": [
                {**p, "status":"draft" if args.current_flow else "approved", "source_node_id": node["node_id"], "source_node_version":node["version"],
                 "story_bible_version":bible["version"]} for p in plans], "resolution":resolution, "intent":intent,
                "drafts":[], "workspace_revision":0, "release_region":args.release_region, "strategy_id":strategy, "canonical_names":names}
            state["workspace"] = _workspace(state)
            state["workspace"]["generationSettings"]["batchSize"] = args.episodes
            state["workspace"]["generationSettings"].update(episodeCount=total_episodes, targetTotalCharacters=target_characters)
            state["workspace"]["episodePlansReadyThrough"] = node["planned_end_episode"]
            # On a resumed probe the isolated database already contains the
            # workspace written by the original run.  Reconstructing a fresh
            # workspace above leaves ``workspace_revision`` at zero, so the
            # first save would incorrectly attempt revision 1 and receive a
            # 409 optimistic-concurrency conflict.  Seed both values from the
            # durable snapshot before continuing the workflow.
            resumed_workspace = False
            if args.resume:
                existing_workspace = client.request("GET", f"/story-projects/{pid}/workspace")
                if existing_workspace.status_code == 200:
                    snapshot = existing_workspace.json()["data"]
                    state["workspace_revision"] = snapshot["revision"]
                    state["workspace"] = snapshot["workspace_payload"]
                    resumed_workspace = True
            if not resumed_workspace:
                _save_workspace(client, state)
            dump(output / "planning-state.json", state)
            if args.current_flow:
                from app.modules.script_engine.planning_review_cache import quality_episode_projection
                reviewed = [quality_episode_projection(p).model_dump(mode="json") for p in state["plans"]]
                audit = call("quality-audit", "POST", f"/story-projects/{pid}/plan-nodes/quality-audit/agent-run", {
                    "story_project_id": pid, "story_bible_id": bible["story_bible_id"],
                    "story_bible_version": bible["version"], "generation_strategy_id": strategy,
                    "node_refs": [{"node_id": node["node_id"], "node_version": node["version"]}],
                    "episode_plans": reviewed, "agent_request_id": f"review.quality.{pid}",
                    "planning_revision_epoch": 0, "execution_requirements": []})
                audit = audit.get("audit", audit)
                state["workspace"]["storyTreeQualityAudit"] = {
                    **audit, "review_contract_version": 13,
                    "reviewed_episode_plans": json.dumps(reviewed, ensure_ascii=False, separators=(",", ":"))}
                summary["quality_status"] = audit["status"]
                _save_workspace(client, state)
                dump(output / "planning-state.json", state)
                if audit["status"] != "pass":
                    raise RuntimeError("Generated planning requires revision; body generation was not approved.")
                state["plans"] = [{**p, "status": "approved"} for p in state["plans"]]
                state["workspace"]["episodeRoadmaps"] = state["plans"]
                _save_workspace(client, state)
                dump(output / "planning-state.json", state)
            if len(plans) < args.episodes:
                raise RuntimeError("The first planning leaf has fewer episodes than requested by this probe.")
            for plan in plans[:args.episodes]:
                number = plan["episode_number"]
                # A successful cached body step already has its artifact and
                # workspace projection persisted in the resume database.  Do
                # not reconstruct a new request from that projected workspace
                # (episode 1 would then incorrectly see itself as a previous
                # episode), and do not attempt to insert the same artifact ID.
                cached_body = next(
                    (step for step in (previous or {}).get("steps", [])
                     if step["stage"] == f"body-{number}" and step["status"] == 200),
                    None,
                )
                cached_body_path = next(output.glob(f"*-body-{number}.json"), None)
                if args.resume and cached_body and cached_body_path is not None:
                    cached_data = json.loads(cached_body_path.read_text())["response"]["data"]
                    (output / f"episode-{number}.md").write_text(
                        screenplay_markdown(cached_data["draft_master_script"], number),
                        encoding="utf-8",
                    )
                    summary["steps"].append({**cached_body, "reused_saved_step": True})
                    continue
                projection = project_probe_continuity(state["workspace"], bible, {"characterRefs":plan["character_refs"], "storyLineRefs":plan["story_line_refs"]})
                approved = ApprovedEpisodePlanContext.model_validate({k:v for k,v in plan.items() if k in ApprovedEpisodePlanContext.model_fields})
                nc = ApprovedStoryNodeContext(node_id=node["node_id"], node_version=node["version"], title=node["title"],
                    start_episode=node["planned_start_episode"], end_episode=node["planned_end_episode"], episode_position=number,
                    episode_function=plan["episode_goal"], **{k:node[k] for k in ("narrative_purpose","entry_state","central_conflict","turning_points","unit_story_beats","unit_resolution","handoff_pressure","emotional_direction","exit_state")})
                payload = ScriptGenerationDraftRequest(story_project_id=pid, agent_request_id=f"review.body.{pid}.{number}",
                    content_spec_id=project["content_spec_id"], generation_strategy_id=strategy, release_region=args.release_region,
                    output_language=project["output_language"], desired_scene_count=plan["planned_scene_count"], target_episode_duration_seconds=plan["target_duration_seconds"],
                    target_script_body_characters=1667, resolved_creative_context=resolution["resolved_creative_context"],
                    episode_context={"generation_mode":"full", "memory_layer":"provisional", "episode_number":number, "total_episodes":total_episodes,
                        "ending_mode":plan["ending_mode"], "previous_episode_handoff":projection["previousEpisodeHandoff"],
                        "episode_instruction":"完整演出已批准路线图的行动、变化与代价。只写本集。",
                        "relevant_character_refs":plan["character_refs"], "planned_story_line_refs":plan["story_line_refs"],
                        "approved_story_node":nc.model_dump(mode="json"), "approved_episode_plan":approved.model_dump(mode="json"),
                        "story_bible_context":"\n".join([bible["core_premise"], bible["central_conflict"], *bible["world_rules"], *bible["locked_facts"]]),
                        "provisional_continuity_checkpoint":projection["checkpoint"], "memory_recall":projection["memoryRecall"],
                        "canonical_character_names":names}).model_dump(mode="json")
                data = call(f"body-{number}", "POST", "/script-generation/generate-draft", payload)
                artifact = save_probe_artifact(client, state, number, data)
                summary["steps"].append({"stage":f"artifact-workspace-readback-{number}", "status":"equal", "artifact_id":artifact["artifact_id"]})
                (output / f"episode-{number}.md").write_text(screenplay_markdown(data["draft_master_script"], number), encoding="utf-8")
                before = meter.summary()["physical_requests"]
                replay = call(f"replay-{number}", "POST", "/script-generation/generate-draft", payload)
                if replay_result_digest({"data":data}) != replay_result_digest({"data":replay}):
                    raise RuntimeError("Idempotent replay changed the stored result")
                if before != meter.summary()["physical_requests"]:
                    raise RuntimeError("Idempotent replay called the model provider")
                summary["steps"].append({"stage":f"replay-no-provider-call-{number}", "status":True})
            dump(output / "completed-workspace.json", state["workspace"])
            summary["status"] = "passed"
            summary["limitations"] = [f"Only the first {args.episodes} episodes were generated; remaining branches untested.",
                "API test simulates approvals; it does not establish creative approval.",
                "Review Markdown only; frontend DOCX and formal Finalization covered separately, not by this probe."]
    except Exception as error:
        summary.update(status="failed", failed_stage=current, error_type=type(error).__name__, error=str(error))
    finally:
        summary["seconds"] = round(time.monotonic()-start, 3)
        summary["provider"] = meter.summary()
        dump(output / "summary.json", summary)
        client.close()
        print(f"Workflow: {summary['status']} at {current}", flush=True)
    return 0 if summary["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
