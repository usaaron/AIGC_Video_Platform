"""Real driver regressions; TEST_DATABASE_URL must name a disposable PostgreSQL DB.

Uses only synthetic content and temporary account schemas. No model calls.
Can run with pytest or python -m unittest tests.test_story_storage_postgres_cas.
"""

import os
import unittest
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import text

# Match application import order before loading the storage aggregates.
import app.main
from app.account_context import StorageScope, account_schema, storage_scope
from app.database import create_database_runtime
from app.modules.preproduction.models import PreproductionStoryboard
from app.modules.preproduction.repository import PreproductionRepository, StoryboardConflictError
from app.modules.script_engine.long_story_models import (
    StoryBible, StoryBibleDraftRequest, StoryBibleGenerationOutput, StoryProject, StoryProjectWorkspaceSave,
)
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.story_bible_recovery import StoryBibleRecoveryConflictError, StoryBibleRecoveryKey


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "Requires disposable TEST_DATABASE_URL")
class PostgresStoryStorageCASTest(unittest.TestCase):
    def setUp(self):
        self.runtime = create_database_runtime(os.environ["TEST_DATABASE_URL"])
        self.assertEqual(self.runtime.engine.dialect.name, "postgresql")
        self.runtime.account_storage.ensure_schema("public")
        self.schema = account_schema("story-cas-test", uuid4().hex)
        self.scope = StorageScope(required=True, schema=self.schema)
        self.token = storage_scope.set(self.scope)
        self.service = LongStoryService(self.runtime)
        self.service.save_project(StoryProject(
            project_id="project.cas", title="存储回归测试", content_spec_id="spec.cas",
            planned_episode_count=10,
        ))

    def tearDown(self):
        self.scope.active = False
        storage_scope.reset(self.token)
        with self.runtime.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE'))
        self.runtime.engine.dispose()

    @staticmethod
    def candidate():
        return StoryBibleGenerationOutput(
            project_title="证据与代价", core_premise="证人保留原始证据并坚持公开完整真相。",
            series_goal="主角建立证据链并揭露真正责任人。", theme="坚持与责任",
            central_conflict="主角必须在保护证人与揭露真相之间选择。",
            ending_direction="主角公开完整证据并承担关系破裂的代价。",
            character_refs=["character.lead"],
            character_registry=[{"character_ref": "character.lead", "name": "林岚", "role": "主角"}],
            story_lines=[{
                "story_line_id": "storyline.truth", "title": "查明真相", "story_line_type": "main",
                "premise": "主角在多重压力下逐步验证真相。",
                "planned_resolution": "主角公开证据并承担代价。", "character_refs": ["character.lead"],
            }],
        )

    def test_checkpoint_first_save_update_stale_conflict_and_atomic_completion(self):
        candidate = self.candidate()
        repository = self.service.story_bible_recovery_repository()
        key = StoryBibleRecoveryKey(story_project_id="project.cas", request_fingerprint="0" * 64)
        first = repository.save_pending(key, candidate, stage="validated_candidate")
        self.assertEqual(first.revision, 1)
        with self.assertRaises(StoryBibleRecoveryConflictError):
            repository.save_pending(key, candidate, stage="duplicate")
        updated = repository.save_pending(key, candidate, stage="ready", previous=first)
        self.assertEqual(updated.revision, 2)
        with self.assertRaises(StoryBibleRecoveryConflictError):
            repository.save_pending(key, candidate, stage="stale", previous=first)
        self.assertEqual(repository.get_pending(key), updated)
        saved = self.service.save_generated_story_bible_draft(StoryBible(
            **candidate.model_dump(), story_bible_id="bible.cas",
            story_project_id="project.cas", content_spec_id="spec.cas",
        ), recovery_checkpoint=updated)
        self.assertEqual(saved.status.value, "draft")
        self.assertIsNone(self.service.get_project("project.cas").active_story_bible_id)
        self.assertIsNone(repository.get_pending(key))
        self.assertEqual([entry.status for entry in repository.list_history(key)], ["pending", "pending", "saved"])
        self.assertEqual(self.service.get_story_bible("project.cas", "bible.cas"), saved)

    def test_story_bible_generation_route_persists_and_returns_workspace_revision(self):
        from app.api.routes.story_projects import generate_story_bible_draft
        from app.modules.content_spec.models import ContentSpec
        from app.modules.content_spec.repository import ContentSpecRepository
        from app.modules.script_engine.models import GenerationStrategy
        from app.modules.script_engine.repository import GenerationStrategyRepository
        from app.modules.script_engine.story_planning_service import StoryPlanningService

        specs = ContentSpecRepository()
        specs.save(ContentSpec.model_validate({
            "id": "spec.cas", "title": "真相的代价",
            "audience_goal": {"summary": "中国大陆悬疑故事受众", "success_metric": "持续追更意愿"},
            "commercial_goal": {"summary": "创作连续故事", "success_metric": "长线连续性"},
            "platform_goal": {"platform_profile_id": "cn_mainland_comic_drama_v1",
                              "objective": "生成中文故事", "target_duration_seconds": 180},
            "story_goal": "记者追查旧案并建立完整证据链。", "quality_level": "high", "budget_level": "medium",
            "creative_brief": {"hook": "旧证据开启调查", "tone": "悬疑", "pacing": "递进", "target_emotion": "期待"},
        }))
        strategies = GenerationStrategyRepository()
        strategy = strategies.save(GenerationStrategy.model_validate({
            "id": "strategy.cas", "name": "离线故事规划", "target_platform": "mainland china comic drama",
            "target_content_type": "serialized story", "model_provider": "fixed", "model_name": "offline-only",
            "workflow_steps": [{"step_order": 1, "name": "故事规划", "description": "生成可编辑初稿",
                                "prompt_id": "prompt.cas"}], "prompt_ids": ["prompt.cas"],
            "draft_knowledge_bundle_id": "knowledge_bundle.draft.cn_mainland_longform_foundation.v1",
            "version": "v1", "status": "active",
        }))
        calls = []

        def generate(*args, **kwargs):
            calls.append(1)
            return self.candidate().model_dump(mode="json")

        planning = StoryPlanningService(
            long_story_service=self.service, content_spec_repository=specs,
            generation_strategy_repository=strategies,
            llm_adapter=SimpleNamespace(generate_structured_output_stream=generate),
        )
        self.service.save_workspace_snapshot(StoryProjectWorkspaceSave(
            project_id="project.cas", client_instance_id="client.cas", revision=1,
            workspace_payload={"id": "project.cas", "episodes": [], "confirmedSynopsis": "保留已确认梗概"},
        ))
        response = generate_story_bible_draft(
            project_id="project.cas",
            payload=StoryBibleDraftRequest(story_project_id="project.cas", content_spec_id="spec.cas",
                                          generation_strategy_id=strategy.id,
                                          confirmed_synopsis="记者坚持保护证人并公开完整证据。", target_episode_count=10),
            service=planning, long_story_service=self.service,
        )
        self.assertEqual(calls, [1])
        self.assertEqual(response.data.status.value, "draft")
        workspace = self.service.get_workspace_snapshot("project.cas")
        self.assertEqual(response.workspace_revision, workspace.revision)
        self.assertEqual(workspace.workspace_payload["confirmedSynopsis"], "保留已确认梗概")
        self.assertEqual(workspace.workspace_payload["storyBibleVersion"], response.data.version)
        fresh = create_database_runtime(os.environ["TEST_DATABASE_URL"])
        try:
            recovered = LongStoryService(fresh).get_story_bible("project.cas", response.data.story_bible_id)
            self.assertEqual(recovered, response.data)
            self.assertEqual(LongStoryService(fresh).get_workspace_snapshot("project.cas"), workspace)
        finally:
            fresh.engine.dispose()

    def test_storyboard_first_save_update_and_stale_writes_keep_history(self):
        repository = PreproductionRepository(self.runtime)
        first = PreproductionStoryboard(
            story_project_id="project.cas", episode_number=1,
            source_draft={"episode_number": 1, "scenes": []}, source_signature="synthetic",
        )
        repository.save(first, expected_revision=0)
        with self.assertRaises(StoryboardConflictError):
            repository.save(first, expected_revision=0)
        updated = first.model_copy(update={"revision": 2, "visual_direction": "保留人物行动的连续性。"})
        repository.save(updated, expected_revision=1)
        with self.assertRaises(StoryboardConflictError):
            repository.save(updated.model_copy(update={"visual_direction": "过期修改"}), expected_revision=1)
        self.assertEqual(repository.get("project.cas", 1), updated)
        self.assertEqual(repository.get("project.cas", 1, revision=1), first)
        self.assertEqual(repository.get("project.cas", 1, revision=2), updated)


if __name__ == "__main__":
    unittest.main()
