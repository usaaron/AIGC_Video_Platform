from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.content_spec.models import ContentSpec
from app.modules.content_spec.repository import ContentSpecRepository


def build_content_spec() -> ContentSpec:
    return ContentSpec.model_validate(
        {
            "title": "长篇恢复测试",
            "audience_goal": {
                "summary": "面向中国大陆连载故事读者",
                "priority": "primary",
                "success_metric": "持续追读意愿",
            },
            "commercial_goal": {
                "summary": "验证长篇内容可持续生成",
                "priority": "primary",
                "success_metric": "跨批次连续性",
            },
            "platform_goal": {
                "platform_profile_id": "cn_mainland_comic_drama_v1",
                "objective": "生成中文长篇故事母本",
                "target_duration_seconds": 180,
                "target_aspect_ratio": "9:16",
            },
            "story_goal": "一个普通人逐步揭开家族秘密并重新选择人生。",
            "quality_level": "high",
            "budget_level": "medium",
            "creative_brief": {
                "hook": "一封不该存在的旧信重新出现。",
                "tone": "悬疑",
                "pacing": "长线递进",
                "target_emotion": "持续期待",
            },
        }
    )


def test_content_spec_survives_repository_recreation() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    try:
        content_spec = build_content_spec()
        ContentSpecRepository(lambda: runtime).save(content_spec)

        restored_repository = ContentSpecRepository(lambda: runtime)
        assert restored_repository.get(content_spec.id) == content_spec
        assert restored_repository.list() == [content_spec]
    finally:
        runtime.engine.dispose()


def test_content_spec_repository_keeps_memory_only_compatibility() -> None:
    repository = ContentSpecRepository()
    content_spec = build_content_spec()

    repository.save(content_spec)

    assert repository.get(content_spec.id) == content_spec
    assert repository.list() == [content_spec]
