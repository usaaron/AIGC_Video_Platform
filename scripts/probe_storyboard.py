"""Isolated storyboard acceptance fixture; never opens the local project database."""

import argparse
import json
from pathlib import Path
from time import perf_counter, sleep
from uuid import uuid4

from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.dependencies import get_long_story_service, get_storyboard_service
from app.llm_runtime import build_planning_editor_llm_adapter_from_env
from app.main import create_app
from app.modules.preproduction.repository import PreproductionRepository
from app.modules.preproduction.service import StoryboardService
from app.modules.script_engine.long_story_models import StoryProject, StoryProjectWorkspaceSave
from app.modules.script_engine.long_story_service import LongStoryService
from test_preproduction import SceneAdapter, SOURCE


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--real", action="store_true")
    parser.add_argument("--serve", type=int)
    parser.add_argument("--delay-seconds", type=float, default=0)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    runtime = create_database_runtime(f"sqlite:///{args.output.resolve() / 'isolated.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    project_id = "story_project.storyboard_probe." + uuid4().hex[:8]
    projects = LongStoryService(runtime)
    projects.save_project(StoryProject(project_id=project_id, title="分镜验收：门后的钥匙",
                                     planned_episode_count=1, default_batch_size=1))
    adapter = SceneAdapter()
    if args.delay_seconds:
        original_generate = adapter.generate_structured_output_stream
        def delayed_generate(*arguments, **keywords):
            sleep(args.delay_seconds)
            return original_generate(*arguments, **keywords)
        adapter.generate_structured_output_stream = delayed_generate
    factory = build_planning_editor_llm_adapter_from_env if args.real else lambda: adapter
    service = StoryboardService(PreproductionRepository(runtime), factory)
    now = SOURCE["updated_at"]
    workspace = {
        "id": project_id, "title": "分镜验收：门后的钥匙", "titleSource": "user", "marketProfile": "cn_mainland",
        "creativePrompt": SOURCE["synopsis"], "referenceMaterials": [], "selectedTagIds": [], "customTags": [],
        "characters": [], "storyLines": [], "characterRelationships": [], "generationBatches": [],
        "activeEpisodeNumber": 1, "status": "draft", "createdAt": now, "updatedAt": now,
        "generationSettings": {"mode": "full", "episodeCountMode": "custom", "episodeCount": 1,
            "targetTotalCharacters": 1000, "preferredEpisodeDurationMinutes": 1.5, "storyDensity": "balanced",
            "batchSize": 1, "outputLanguage": "zh", "sceneCount": 1, "failureRetryMode": "manual",
            "releaseRegion": "cn_mainland", "customInstructions": ""},
        "episodes": [{"id": "episode.storyboard_probe.1", "episodeNumber": 1, "status": "saved",
            "generationRun": {"draft_master_script": SOURCE}, "workingDraftJson": json.dumps(SOURCE, ensure_ascii=False),
            "hasLocalDraftEdits": False, "createdAt": now, "updatedAt": now}],
    }
    projects.save_workspace_snapshot(StoryProjectWorkspaceSave(project_id=project_id, workspace_payload=workspace,
                                                               client_instance_id="storyboard.probe"))
    (args.output / "workspace.json").write_text(json.dumps(workspace, ensure_ascii=False, indent=2))
    print(f"project_id={project_id}", flush=True)
    if args.real:
        started = perf_counter()
        try:
            plan = service.start(project_id, 1, SOURCE, 0)
            plan = service.generate_scene(project_id, 1, 1, plan.revision, "保持左手持钥匙，三声敲击发生在门关上之后。")
            (args.output / "storyboard.json").write_text(plan.model_dump_json(indent=2))
            print(json.dumps({"status": "passed", "elapsed_seconds": round(perf_counter() - started, 2),
                              "scenes": len(plan.scenes), "shots": len(plan.scenes[0].shots),
                              "revision": plan.revision}, ensure_ascii=False), flush=True)
        except Exception as exc:
            print(json.dumps({"status": "failed", "error_type": type(exc).__name__,
                              "category": getattr(exc, "category", None),
                              "elapsed_seconds": round(perf_counter() - started, 2)}, ensure_ascii=False), flush=True)
            raise SystemExit(1) from None
    if args.serve:
        import uvicorn
        app = create_app()
        app.dependency_overrides[get_long_story_service] = lambda: projects
        app.dependency_overrides[get_storyboard_service] = lambda: service
        uvicorn.run(app, host="127.0.0.1", port=args.serve)


if __name__ == "__main__":
    main()
