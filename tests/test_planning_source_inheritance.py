"""Exercise the source evidence at actual planning and recovery prompt boundaries."""

from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from app.modules.script_engine.long_story_models import (
    StoryPlanExpansionStatus, StoryPlanNodeChildOutput, StoryPlanNodeDecompositionRequest,
)
from app.modules.script_engine.long_story_service import LongStoryNotFoundError
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.planning_source_inheritance import (
    load_planning_source_context, planning_source_context,
)
from app.modules.script_engine.story_planning_service import (
    StoryPlanningService, TECHNICAL_STORY_ROOT_MARKER,
)
from tests.test_story_decomposition_recovery import recovery_example
from tests.test_story_planning_service import (
    build_active_lineage_story_bible, build_active_lineage_story_node, build_strategy,
    build_active_lineage_decomposition_output, MutableActiveLineageLongStoryService,
)


def source_example():
    bible = build_active_lineage_story_bible()
    bible.story_project_id = "story_project.inflight"
    # Both sources exceed the old summary-sized windows. Their endings are facts,
    # not decorative markers: the actor and sequence must survive every transport.
    events = [
        "Nora先救出Ezra；Ezra因此加入队伍。",
        "June与Nora合作解封工具，真相在进城之前揭示。",
        "Nora离城后遭偷袭受伤；随后围城开始。",
        "Nora带伤返回并救出Ezra，June只负责提供工具。",
        "三人撤离之后关闭城门；已经揭示的真相继续生效。",
    ]
    synopsis = "\n".join(events[:2]) + "\n" + "作者已确认的生活背景。" * 1_600 + "\n" + "\n".join(events[2:])
    bible.imported_source_document = "历史原文背景。" * 2_000 + "\n原文末尾：获救者Ezra存活；行动者为Nora。"
    workspace = {
        "id": bible.story_project_id, "storyBibleVersion": bible.version,
        "storyBibleSynopsisOutdated": False,
        "storySynopsis": {"version": 4, "status": "confirmed", "pendingChanges": False, "text": synopsis},
    }
    return bible, workspace, events


def prompt_source(prompt):
    opening = "<planning_source_evidence>\n"
    closing = "\n</planning_source_evidence>"
    assert prompt.count(opening) == 1
    return json.loads(prompt.split(opening, 1)[1].split(closing, 1)[0])


def assert_exact_source(prompt, expected):
    observed = prompt_source(prompt)
    assert observed == expected
    # Parsing and equality prove that names, sequence, and trailing facts were
    # transported intact, rather than merely mentioned in a generic instruction.
    assert observed["confirmed_synopsis"]["text"] == expected["confirmed_synopsis"]["text"]
    assert observed["imported_source_document"] == expected["imported_source_document"]


@pytest.mark.parametrize("change", [
    {"id": "different-project"}, {"storyBibleVersion": 99}, {"storyBibleSynopsisOutdated": True},
    {"storySynopsis": {"status": "draft", "text": "a different unapproved story"}},
    {"storySynopsis": {"status": "confirmed", "pendingChanges": True, "text": "pending edit"}},
    {"storySynopsis": {"status": "confirmed", "text": "  "}},
    {"storySynopsis": None},
])
def test_changed_or_unconfirmed_workspace_cannot_replace_bible_bound_source(change):
    bible, workspace, _ = source_example()
    workspace.update(change)
    before = deepcopy(workspace)
    context = planning_source_context(bible, workspace)
    assert context["confirmed_synopsis"] is None
    assert context["imported_source_document"] == bible.imported_source_document
    assert workspace == before


def test_loader_uses_one_matching_snapshot_without_mutating_or_truncating_sources():
    bible, workspace, _ = source_example()
    before = deepcopy(workspace)
    calls = []

    def snapshot(project_id):
        calls.append(project_id)
        return SimpleNamespace(workspace_payload=workspace)

    context = load_planning_source_context(SimpleNamespace(get_workspace_snapshot=snapshot), bible)
    assert calls == [bible.story_project_id]
    assert context["confirmed_synopsis"] == {
        "version": 4, "status": "confirmed", "text": workspace["storySynopsis"]["text"],
    }
    assert len(context["confirmed_synopsis"]["text"]) > 16_000
    assert context["imported_source_document"] == bible.imported_source_document
    assert workspace == before


@pytest.mark.parametrize("missing", ["project", "snapshot", "api"])
def test_legacy_source_remains_explicitly_bible_only(missing):
    bible, _, _ = source_example()
    if missing == "project":
        del bible.story_project_id

    def snapshot(_project_id):
        if missing == "project":
            raise AssertionError("A legacy Bible without a project cannot select a workspace.")
        raise LongStoryNotFoundError("No saved workspace exists.")

    repository = SimpleNamespace() if missing == "api" else SimpleNamespace(get_workspace_snapshot=snapshot)
    context = load_planning_source_context(repository, bible)
    assert context["confirmed_synopsis"] is None
    assert context["imported_source_document"] == bible.imported_source_document


class PromptCaptured(RuntimeError):
    pass


def test_source_changed_while_generating_never_saves_stale_children():
    bible, workspace, _ = source_example()
    parent = build_active_lineage_story_node(
        node_id="node.source.changed", version=1, start_episode=1, end_episode=16,
        expansion_status=StoryPlanExpansionStatus.expanded,
    )
    long_story = MutableActiveLineageLongStoryService(parent, parent, bible)
    long_story.get_workspace_snapshot = lambda _: SimpleNamespace(workspace_payload=workspace)
    service = object.__new__(StoryPlanningService)
    service._long_story_service = long_story
    service._generation_strategy_repository = SimpleNamespace(get=lambda _: build_strategy())
    service._content_spec_for_story_bible = lambda _: SimpleNamespace()
    service._knowledge_context = lambda **_: ""
    service._requires_episode_developments = lambda _: False
    service._ensure_mainland_planning_language = lambda **kwargs: kwargs["output"]

    def generate(**_kwargs):
        workspace["storySynopsis"]["text"] += "作者刚确认了新的剧情前提。"
        return build_active_lineage_decomposition_output(parent)

    service._generate_planning_output = generate
    with pytest.raises(StoryPlanningInputError, match="Confirmed story source changed"):
        service.decompose_story_plan_node(StoryPlanNodeDecompositionRequest(
            story_project_id=parent.story_project_id, parent_node_id=parent.node_id,
            parent_node_version=parent.version, generation_strategy_id="test", requested_child_count=2,
        ))
    assert long_story.saved_nodes == []


@pytest.mark.parametrize("technical_root", [True, False])
def test_decomposition_entrypoint_carries_full_ordered_source_and_actual_parent_scope(technical_root):
    bible, workspace, events = source_example()
    parent = build_active_lineage_story_node(
        node_id="node.source.scope", version=3, start_episode=1 if technical_root else 33,
        end_episode=130 if technical_root else 64, expansion_status=StoryPlanExpansionStatus.expanded,
    ).model_copy(update={
        "decomposition_reason": TECHNICAL_STORY_ROOT_MARKER if technical_root else "展开已分配事件",
        "unit_story_beats": events[2:4], "entry_state": "Nora已经离城。",
        "exit_state": "Nora已经带伤救出Ezra；城门尚未关闭。",
    })
    source_reads, prompts = [], []

    def snapshot(project_id):
        source_reads.append(project_id)
        return SimpleNamespace(workspace_payload=workspace)

    service = object.__new__(StoryPlanningService)
    service._long_story_service = SimpleNamespace(
        get_project=lambda _id: SimpleNamespace(), get_story_plan_node=lambda *a, **k: parent,
        get_story_bible=lambda *a, **k: bible, get_workspace_snapshot=snapshot,
    )
    service._generation_strategy_repository = SimpleNamespace(get=lambda _id: build_strategy())
    service._validate_planning_epoch = lambda *a, **k: None
    service._require_active_story_plan_lineage = lambda *a, **k: None
    service._content_spec_for_story_bible = lambda *a: SimpleNamespace()
    service._knowledge_context = lambda **k: ""
    service._story_plan_node_revision_context = lambda _node: {
        "previous_sibling": {"unit_story_beats": events[:2]},
        "next_sibling": {"unit_story_beats": events[4:]},
    }

    def capture(**kwargs):
        prompts.append(kwargs["prompt"])
        raise PromptCaptured("Stop before any model request or project save.")

    service._generate_planning_output = capture
    with pytest.raises(PromptCaptured):
        service.decompose_story_plan_node(StoryPlanNodeDecompositionRequest(
            story_project_id=bible.story_project_id, parent_node_id=parent.node_id,
            parent_node_version=parent.version, generation_strategy_id="test", requested_child_count=2,
        ))
    # Evidence binding and the generation prompt share one immutable snapshot.
    assert source_reads == [bible.story_project_id]
    assert len(prompts) == 1
    prompt = prompts[0]
    assert_exact_source(prompt, planning_source_context(bible, workspace))
    assert f"Parent node: {parent.node_id} v3" in prompt
    assert f"Parent range: episodes {parent.planned_start_episode}-{parent.planned_end_episode}" in prompt
    ordered_parent = prompt.split("Parent complete ordered event table for 1-based parent_event_bindings: ", 1)[1].split("\n", 1)[0]
    assert json.loads(ordered_parent) == ([] if technical_root else events[2:4])
    assert parent.exit_state in prompt
    assert events[0] in prompt and events[-1] in prompt  # Adjacent events stay identified as adjacent.

    repaired = service._build_decomposition_semantic_repair_prompt(
        original_prompt=prompt, output=SimpleNamespace(model_dump_json=lambda: '{"children":[]}'),
        validation_error=StoryPlanningInputError("incorrect actor and order"),
    )
    assert_exact_source(repaired, planning_source_context(bible, workspace))
    assert repaired.startswith(prompt)


def test_segmented_child_and_last_transport_retry_keep_full_source_and_parent_bounds():
    parent, _, strategy, raw = recovery_example()
    bible, workspace, _ = source_example()
    parent.unit_story_beats = ["姐姐先完成复诊，弟弟随后承担连续接送。", "两人完成照护约定。"]
    parent.version = 7
    source_context = planning_source_context(bible, workspace)
    partial = [{key: child[key] for key in (
        "title", "synopsis", "entry_state", "exit_state", "turning_points", "planned_start_episode", "planned_end_episode",
    )} for child in raw]
    before = deepcopy(partial)
    service = object.__new__(StoryPlanningService)
    prompts = []

    def generate(**kwargs):
        assert kwargs["output_model"] is StoryPlanNodeChildOutput
        prompts.append(kwargs["prompt"])
        if len(prompts) == 1:
            raise StoryPlanningInputError("incomplete child transport")
        return StoryPlanNodeChildOutput.model_validate(raw[0 if len(prompts) == 2 else 1])

    service._generate_planning_output = generate
    output = service._generate_segmented_decomposition_recovery(
        original_prompt="initial prompt", strategy=strategy, parent=parent, story_bible=bible,
        requested_child_count=2, max_episode_ready_span=12, source_children=partial, source_context=source_context,
    )
    assert len(prompts) == 3
    assert "FINAL SEGMENTED CHILD TRANSPORT RETRY" in prompts[1]
    for prompt in prompts:
        assert_exact_source(prompt, source_context)
        start = "Allowed recovery facts:\n" if "FINAL SEGMENTED" in prompt else "Approved compact recovery context. Every included fact and reference is binding:\n"
        compact = json.JSONDecoder().raw_decode(prompt.split(start, 1)[1])[0]
        assert compact["parent"]["node_id"] == parent.node_id
        assert compact["parent"]["version"] == 7
        assert (compact["parent"]["planned_start_episode"], compact["parent"]["planned_end_episode"]) == (1, 32)
        assert compact["parent"]["unit_story_beats"] == parent.unit_story_beats
        assert compact["parent"]["exit_state"] == parent.exit_state
    assert [(child.planned_start_episode, child.planned_end_episode) for child in output.children] == [(1, 8), (9, 32)]
    assert [child.synopsis for child in output.children] == [child["synopsis"] for child in raw]
    assert partial == before
