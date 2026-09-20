"""Explicit episode edits must survive scope filtering without changing retained facts."""
import pytest

import app.modules.agent_runtime  # Establish the production service import order.
from app.modules.script_engine.long_story_models import EpisodePlanGenerationItem
from app.modules.script_engine.story_planning_service import (
    apply_episode_roadmap_modification_scope,
    infer_episode_roadmap_modification_scope,
)
from tests.test_story_planning_service import (
    build_active_lineage_episode_item,
    build_episode_dramatic_design,
)


@pytest.mark.parametrize("summary_name", ["synopsis", "摘要", "概要", "梗概"])
def test_explicit_summary_sync_keeps_updated_narrative_and_protects_retained_title(summary_name):
    source = EpisodePlanGenerationItem.model_validate({
        **build_active_lineage_episode_item(), **build_episode_dramatic_design(),
    })
    revised_fields = {
        "synopsis": "主角与证人通过电话核对材料使用范围，明确对方尚未同意作证，随后仅申请个人咨询预约。",
        "episode_payoff": "证人保有是否出席的决定权，预约草稿不再预填证人。",
        "protagonist_cost": "主角接受缺少亲见证词时可能无法完成全部核验。",
        "continuity_requirements": ["证人尚未同意到场；材料来源不等于作证承诺。"],
        "dramatic_units": [{
            "trigger": "证人担心被预先登记为同意作证。",
            "choice": "主角当面删除证人预填项。",
            "visible_consequence": "预约仅供主角个人咨询。",
            "change_type": "材料边界",
            "evidence_hint": "空白证人栏与个人咨询预约草稿。",
        }],
    }
    candidate = EpisodePlanGenerationItem.model_validate({
        **source.model_dump(mode="json"), **revised_fields, "episode_title": "不该更换的标题",
        "entry_state": "未获授权的新进入状态。",
    })
    scope = infer_episode_roadmap_modification_scope(
        instruction=f"保留已批准标题和进入状态；更新{summary_name}及dramatic_units等可编辑摘要以匹配分场，分场目标须保持因果一致。",
        selection_context=None, revision_mode="targeted",
    )
    result = apply_episode_roadmap_modification_scope(source, candidate, scope)
    assert set(revised_fields) <= scope
    assert result.model_dump(mode="json") == {
        **source.model_dump(mode="json"), **revised_fields,
    }
    assert result.episode_title == source.episode_title
    assert result.entry_state == source.entry_state


@pytest.mark.parametrize("mode,instruction", [
    ("targeted", "保留标题；修改目标并同步前后因果。"),
    ("targeted", "保持标题不变；整体修订本集。"),
    ("rewrite", "保留episode_title，重新组织各场行动。"),
])
def test_retained_title_wins_over_dependencies_and_whole_rewrite(mode, instruction):
    scope = infer_episode_roadmap_modification_scope(
        instruction=instruction, selection_context=None, revision_mode=mode,
    )
    assert "scene_execution_plan" in scope
    assert "episode_title" not in scope


def test_negated_retention_does_not_freeze_requested_title():
    scope = infer_episode_roadmap_modification_scope(
        instruction="不要保留标题，修改本集目标并同步标题。",
        selection_context=None, revision_mode="targeted",
    )
    assert {"episode_title", "episode_goal"} <= scope


def test_scene_only_edit_does_not_implicitly_authorize_all_summaries():
    scope = infer_episode_roadmap_modification_scope(
        instruction="修改第二场的可见行动。", selection_context=None, revision_mode="targeted",
    )
    assert scope == {"scene_execution_plan"}


def test_exact_field_name_does_not_authorize_lookalike_identifier():
    scope = infer_episode_roadmap_modification_scope(
        instruction="修改标题，参考synopsis_backup。", selection_context=None, revision_mode="targeted",
    )
    assert scope == {"episode_title"}
