from contextlib import contextmanager

import pytest
from sqlalchemy import event
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.platform_profile.models import PlatformProfile
from app.modules.platform_profile.repository import PlatformProfileRepository
from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.repository import GenerationStrategyRepository
from tests.test_content_spec_repository import build_content_spec
from tests.test_llm_adapter import build_strategy
from tests.test_platform_profile_models import build_payload


@pytest.fixture
def runtimes(tmp_path):
    url = f"sqlite:///{tmp_path / 'documents.db'}"
    first, second = create_database_runtime(url), create_database_runtime(url)
    SQLModel.metadata.create_all(first.engine)
    yield first, second
    first.engine.dispose()
    second.engine.dispose()


@pytest.mark.parametrize("repository,build", [
    (GenerationStrategyRepository, lambda: GenerationStrategy.model_validate(build_strategy())),
    (ContentSpecRepository, build_content_spec),
])
def test_updates_are_visible_across_instances_without_cache(runtimes, repository, build):
    first, second = (repository(lambda runtime=runtime: runtime) for runtime in runtimes)
    item = build()
    first.save(item)
    assert second.get(item.id) == item
    field = "title" if isinstance(first, ContentSpecRepository) else "name"
    updated = item.model_copy(update={field: "Updated by another instance"})
    second.save(updated)
    assert first.get(item.id) == updated
    assert first.list() == [updated]
    assert not first._items


def test_namespace_isolation_and_batched_ordered_lookup(runtimes):
    strategies = GenerationStrategyRepository(lambda: runtimes[0])
    profiles = PlatformProfileRepository(lambda: runtimes[0])
    strategy = GenerationStrategy.model_validate({**build_strategy(), "id": "shared_document_id"})
    profile = PlatformProfile.model_validate({**build_payload(), "id": strategy.id})
    strategies.save(strategy)
    strategies.save(strategy.model_copy(update={"id": "strategy.second"}))
    profiles.save(profile)
    assert profiles.get(strategy.id) == profile
    assert strategies.get(strategy.id) == strategy
    queries = []
    def capture(_connection, _cursor, statement, *_args):
        queries.append(statement)
    event.listen(runtimes[0].engine, "before_cursor_execute", capture)
    result = strategies.list_by_ids(["strategy.second", "missing", strategy.id, strategy.id])
    assert [item.id for item in result] == ["strategy.second", strategy.id, strategy.id]
    assert len(queries) == 1
    event.remove(runtimes[0].engine, "before_cursor_execute", capture)


@pytest.mark.parametrize("repository,build", [
    (GenerationStrategyRepository, lambda: GenerationStrategy.model_validate(build_strategy())),
    (ContentSpecRepository, build_content_spec),
])
def test_failed_commit_does_not_publish_unsaved_document(runtimes, repository, build):
    class RejectCommit:
        engine = runtimes[0].engine

        @contextmanager
        def session(self):
            with runtimes[0].session() as session:
                yield session
                raise RuntimeError("commit rejected")

    failing = repository(lambda: RejectCommit())
    item = build()
    with pytest.raises(RuntimeError, match="commit rejected"):
        failing.save(item)
    assert failing._items == {}
    assert repository(lambda: runtimes[1]).get(item.id) is None
