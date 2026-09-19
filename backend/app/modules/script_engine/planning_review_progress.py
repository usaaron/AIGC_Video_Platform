"""Request-scoped persistence hooks for completed semantic review groups."""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any


REVIEW_GROUP_CHECKPOINT_TYPE = "story_plan_quality_groups.v1"


@dataclass(frozen=True)
class ReviewCheckpointHooks:
    recovered: dict[str, Any]
    save: Callable[[dict[str, Any]], None]


_hooks: ContextVar[ReviewCheckpointHooks | None] = ContextVar("quality_review_checkpoint_hooks", default=None)


def quality_review_checkpoint_hooks() -> ReviewCheckpointHooks | None:
    return _hooks.get()


@contextmanager
def quality_review_checkpoints(
    recovered: dict[str, Any] | None, save: Callable[[dict[str, Any]], None],
) -> Iterator[None]:
    token = _hooks.set(ReviewCheckpointHooks(recovered or {}, save))
    try:
        yield
    finally:
        _hooks.reset(token)
