from copy import deepcopy
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.modules.script_engine.episode_development_contract import validate_episode_developments
from app.modules.script_engine.long_story_models import (
    StoryPlanNodeChildOutput, StoryPlanNodeDecompositionOutput,
    StoryPlanNodeGenerationOutput, StoryPlanQualityModelOutput,
    EpisodePlanBatchGenerationOutput,
)
from app.modules.script_engine.planning_wire_contract import (
    expand_node_event_references, planning_wire_schema,
    expand_quality_review_references, quality_review_wire_schema,
    expand_scene_heading, expand_episode_title,
)
from app.modules.script_engine.story_planning_service import (
    StoryPlanningService, _decomposition_recovery_candidate_score,
    _salvage_story_plan_child_from_partial_json, planning_payload_for_validation,
    apply_story_plan_node_modification_scope, infer_story_plan_node_modification_scope,
    _episode_scene_execution_completion_schema, _normalize_scene_execution_plan,
)
from tests.test_episode_development_contract import authored_leaf
from tests.test_story_planning_service import build_strategy
from tests.test_story_planning_service import build_active_lineage_story_bible


def compact_leaf():
    node = authored_leaf()
    payload = {key: value for key, value in node.model_dump(mode="json").items() if key in StoryPlanNodeGenerationOutput.model_fields}
    payload.pop("turning_points")
    payload["turning_point_indices"] = [1, 3]
    payload["episode_developments"] = [
        {key: value for key, value in entry.items() if key in {"episode_number", "synopsis", "exit_state"}}
        | {"source_event_indices": [payload["unit_story_beats"].index(event) + 1 for event in entry["source_unit_story_beats"]]}
        for entry in payload["episode_developments"]
    ]
    return payload


def test_references_preserve_story_and_uneven_event_ownership_without_rewriting():
    compact = compact_leaf()
    before = deepcopy(compact)
    expanded = expand_node_event_references(compact)
    node = StoryPlanNodeGenerationOutput.model_validate(expanded)
    validate_episode_developments(node, required=True, require_canonical_events=True)
    assert compact == before
    assert node.unit_story_beats == compact["unit_story_beats"]
    assert node.turning_points == [compact["unit_story_beats"][0], compact["unit_story_beats"][2]]
    assert [entry.synopsis for entry in node.episode_developments] == [entry["synopsis"] for entry in compact["episode_developments"]]
    assert [entry.exit_state for entry in node.episode_developments] == [entry["exit_state"] for entry in compact["episode_developments"]]
    assert [entry.entry_state for entry in node.episode_developments] == [node.entry_state, *[entry.exit_state for entry in node.episode_developments[:-1]]]
    assert node.episode_developments[3].source_turning_points == [node.unit_story_beats[2]]
    assert expand_node_event_references(expanded) == expanded
    assert planning_payload_for_validation(compact, StoryPlanNodeGenerationOutput) == expanded


@pytest.mark.parametrize("failure", ["zero", "high", "string", "bool", "duplicate_turn", "duplicate_owner", "missing_owner", "missing_map", "gap", "early_end", "final_state", "mixed_turns", "mixed_states", "mixed_sources", "missing_turns", "duplicate_event"])
def test_invalid_references_never_get_guessed_renumbered_or_dropped(failure):
    payload = compact_leaf()
    entries = payload["episode_developments"]
    if failure in {"zero", "high", "string", "bool"}:
        payload["turning_point_indices"] = [{"zero": 0, "high": 12, "string": "1", "bool": True}[failure]]
    elif failure == "duplicate_turn": payload["turning_point_indices"] = [1, 1]
    elif failure == "duplicate_owner": entries[2]["source_event_indices"] = [1]
    elif failure == "missing_owner": entries[0]["source_event_indices"] = []
    elif failure == "missing_map": payload["episode_developments"] = []
    elif failure == "gap": entries.pop(2)
    elif failure == "early_end":
        entries[-2]["source_event_indices"], entries[-1]["source_event_indices"] = entries[-1]["source_event_indices"], []
    elif failure == "final_state": entries[-1]["exit_state"] = "未曾建立的另一种结局。"
    elif failure == "mixed_turns": payload["turning_points"] = payload["unit_story_beats"][:1]
    elif failure == "mixed_states": entries[0]["entry_state"] = payload["entry_state"]
    elif failure == "mixed_sources": entries[0]["source_unit_story_beats"] = []
    elif failure == "missing_turns": payload.pop("turning_point_indices")
    elif failure == "duplicate_event": payload["unit_story_beats"][1] = payload["unit_story_beats"][0]
    before = deepcopy(payload)
    with pytest.raises(ValidationError):
        planning_payload_for_validation(payload, StoryPlanNodeGenerationOutput)
    assert payload == before


@pytest.mark.parametrize("model", [StoryPlanNodeGenerationOutput, StoryPlanNodeChildOutput, StoryPlanNodeDecompositionOutput])
def test_model_schema_removes_duplicate_prose_without_changing_public_schema(model):
    original = model.model_json_schema()
    wire = planning_wire_schema(original)
    node_shape = wire["$defs"]["StoryPlanNodeChildOutput"] if model is StoryPlanNodeDecompositionOutput else wire
    assert "turning_points" not in node_shape["properties"]
    assert "turning_point_indices" in node_shape["required"]
    assert set(wire["$defs"]["EpisodeDevelopment"]["properties"]) == {"episode_number", "synopsis", "exit_state", "source_event_indices"}
    assert original == model.model_json_schema()
    assert planning_wire_schema(wire) == wire


def test_quality_audit_schema_is_not_changed_by_event_projection():
    schema = StoryPlanQualityModelOutput.model_json_schema()
    assert planning_wire_schema(schema) == schema


def test_first_roadmap_request_contains_the_same_scene_constraints_as_completion():
    public_schema = EpisodePlanBatchGenerationOutput.model_json_schema()
    first = planning_wire_schema(public_schema)["$defs"]["EpisodeSceneExecutionBeat"]
    repair = _episode_scene_execution_completion_schema()["$defs"]["EpisodeSceneExecutionBeat"]
    assert first == repair
    heading = first["properties"]["scene_heading"]
    assert heading["properties"]["environment"]["enum"] == ["INT", "EXT"]
    assert set(heading["required"]) == {"environment", "location", "time"}
    assert first["properties"]["evidence_requirements"]["minItems"] == 1
    assert {"opposition", "information_shift", "choice_or_cost", "evidence_requirements"} <= set(first["required"])
    assert public_schema == EpisodePlanBatchGenerationOutput.model_json_schema()


@pytest.mark.parametrize("invalid", [{"environment": "日内", "location": "登记处", "time": "日"},
                                    {"location": "入口", "time": "晨"},
                                    {"environment": "EXT", "location": " ", "time": "夜"}])
def test_structured_heading_never_guesses_missing_or_invalid_metadata(invalid):
    with pytest.raises(ValidationError):
        expand_scene_heading({"scene_heading": invalid})


@pytest.mark.parametrize("english,expected", [(None, "灯下补训"), ("UNDER THE LAMP", "UNDER THE LAMP｜灯下补训")])
def test_episode_title_rendering_preserves_authored_words(english, expected):
    payload = {"episode_title": {"chinese": "灯下补训", "english": english}}
    original = deepcopy(payload)
    assert expand_episode_title(payload)["episode_title"] == expected
    assert payload == original


def test_title_wire_rejects_chinese_in_english_slot_without_translation_or_repair():
    with pytest.raises(ValidationError):
        expand_episode_title({"episode_title": {"chinese": "灯下补训", "english": "灯下补训"}})


@pytest.mark.parametrize("schema_transport", [True, False])
@pytest.mark.parametrize("bind_boundaries", [True, False])
def test_resumable_episode_entry_sends_first_call_contract_and_renders_authored_scene(schema_transport, bind_boundaries):
    import json
    from tests.test_story_planning_service import build_active_lineage_episode_item, build_episode_dramatic_design
    from app.modules.script_engine.episode_readiness import episode_execution_readiness_issues
    from app.modules.script_engine.planning_wire_contract import EPISODE_BOUNDARY_FIELDS
    calls = []
    payload = {**build_active_lineage_episode_item(), **build_episode_dramatic_design(),
               "episode_title": {"chinese": "封存的原件", "english": "SEALED ORIGINAL"},
               "planned_scene_count": 1, "scene_execution_plan": [{
        "scene_number": 1, "scene_heading": {"environment": "EXT", "location": "档案馆门口", "time": "晨"},
        "character_refs": ["character.mara"], "scene_objective": "核验原件并取得签收。",
        "visible_action": "主角向管理员出示原件，管理员核验后签收。", "turn_or_reveal": "签名与留档一致。",
        "dialogue_objective": "核实并确认签收责任。", "dialogue_line_target": 26, "shot_target": 16,
        "opposition": "管理员质疑材料来源。", "information_shift": "原件来源获得确认。",
        "choice_or_cost": "主角留下原件并取得签收凭据。", "evidence_requirements": ["原件签名与管理员签收凭据。"],
        "forbidden_changes": ["不得销毁已经签收的原件。"], "exit_state": "原件进入档案馆保管。",
    }]}
    class Adapter:
        def get_model_info(self): return SimpleNamespace(provider="test", model_name="contract-probe")
        def generate_structured_output_stream(self, prompt, *, strategy, output_schema):
            calls.append(prompt)
            if not schema_transport:
                assert output_schema is None
                output_schema = json.loads(prompt.split("AUTHORITATIVE JSON SCHEMA:\n", 1)[1].split("\n\n", 1)[0])
            shape = output_schema["$defs"]["EpisodeSceneExecutionBeat"]
            assert "场景传输合同" in prompt
            assert "标题传输合同" in prompt
            assert "先落实动作再写退出状态" in prompt
            assert "把承诺或安排升级为完成" in prompt
            if schema_transport:
                assert "先落实动作再写退出状态" in shape["properties"]["visible_action"]["description"]
            assert shape["properties"]["scene_heading"]["type"] == "object"
            assert {"opposition", "information_shift", "choice_or_cost", "evidence_requirements"} <= set(shape["required"])
            item = output_schema["$defs"]["EpisodePlanGenerationItem"]
            assert not {"execution_ready", "layer_contracts", "planned_scene_count"} & item["properties"].keys()
            assert "先编排行动，再统计场数" in prompt
            assert list(item["properties"]).index("scene_execution_plan") < list(item["properties"]).index("planned_shot_count")
            authored = deepcopy(payload)
            authored.pop("planned_scene_count")
            if bind_boundaries:
                assert not set(EPISODE_BOUNDARY_FIELDS) & item["properties"].keys()
                assert "本次 JSON 不再输出这四个集级字段" in prompt
                assert "exit_state" in shape["properties"]
                for field in EPISODE_BOUNDARY_FIELDS:
                    authored.pop(field)
            assert "EpisodeThreeLayerContract" not in output_schema["$defs"]
            assert "scene_execution_plan" in item["required"]
            assert item["properties"]["scene_execution_plan"]["minItems"] == 1
            return {"episode_plans": [authored]}
    service = object.__new__(StoryPlanningService)
    result = service._generate_segmented_episode_roadmap(
        prompt="完成批准的单集事件。", strategy=build_strategy(), expected_episode_numbers=[1], llm_adapter=Adapter(),
        use_schema_transport=schema_transport,
        episode_boundaries={1: {field: deepcopy(payload[field]) for field in EPISODE_BOUNDARY_FIELDS}} if bind_boundaries else None,
    )
    assert len(calls) == 1
    assert result.episode_plans[0].episode_title == "SEALED ORIGINAL｜封存的原件"
    scene = result.episode_plans[0].scene_execution_plan[0]
    assert scene.scene_heading == "EXT. 档案馆门口 - 晨"
    assert scene.visible_action == payload["scene_execution_plan"][0]["visible_action"]
    assert result.episode_plans[0].planned_scene_count == 1
    for field in EPISODE_BOUNDARY_FIELDS:
        assert getattr(result.episode_plans[0], field) == payload[field]
    assert not [issue for issue in episode_execution_readiness_issues(result.episode_plans[0]) if issue.startswith("scene_execution_plan")]


def test_boundary_binding_preserves_every_scene_claim_and_uses_explicit_episode_identity():
    from app.modules.script_engine.planning_wire_contract import expand_episode_boundaries
    bounds = {
        2: {"entry_state": "原件仍在父亲手中", "exit_state": "仅取得当面核验许可", "source_turning_points": [], "source_unit_story_beats": []},
        3: {"entry_state": "仅取得当面核验许可", "exit_state": "当面完成原件核验", "source_turning_points": ["当面核验"], "source_unit_story_beats": ["当面核验"]},
    }
    # A false scene claim must survive the transport so semantic review can
    # reject it. Binding an approved boundary cannot certify its execution.
    payload = {"episode_plans": [
        {"episode_number": 3, "scene_execution_plan": [{"visible_action": "尚未核验就直接把原件带走", "exit_state": "主角取得原件"}]},
        {"episode_number": 2, "scene_execution_plan": [{"visible_action": "父亲答应共同核验", "exit_state": "仅取得许可"}]},
    ]}
    original = deepcopy(payload)
    result = expand_episode_boundaries(payload, bounds)
    assert payload == original
    for item, before in zip(result["episode_plans"], original["episode_plans"]):
        assert item["scene_execution_plan"] == before["scene_execution_plan"]
        assert item["entry_state"] == bounds[item["episode_number"]]["entry_state"]
    result["episode_plans"][0]["source_turning_points"].append("不能污染批准来源")
    assert bounds[3]["source_turning_points"] == ["当面核验"]


@pytest.mark.parametrize("claim", [{"entry_state": "原件已经交出"}, {"source_unit_story_beats": ["新事件"]},
                                   {"episode_number": 4}, {"episode_number": "2"}, {"episode_number": None}])
def test_boundary_binding_rejects_contradiction_or_unknown_identity_without_overwriting(claim):
    from app.modules.script_engine.planning_wire_contract import expand_episode_boundaries
    bounds = {2: {"entry_state": "原件仍在父亲手中", "exit_state": "仅取得许可", "source_turning_points": [], "source_unit_story_beats": []}}
    payload = {"episode_number": 2, **claim}
    original = deepcopy(payload)
    with pytest.raises(ValidationError):
        expand_episode_boundaries(payload, bounds)
    assert payload == original


@pytest.mark.parametrize("heading,expected", [
    ("外景·旧摊位·凌晨", "EXT. 外景·旧摊位·凌晨"),
    ("内景·餐桌旁·清晨", "INT. 内景·餐桌旁·清晨"),
    ("ext. 河岸 - 夜", "EXT. 河岸 - 夜"),
    ("旧摊位·凌晨", "旧摊位·凌晨"),
])
def test_scene_heading_normalization_preserves_explicit_environment_without_guessing(heading, expected):
    scene = {
        "scene_heading": heading, "character_refs": ["character.lead"],
        "scene_objective": "核对票据来源。", "visible_action": "主角摊开原件核对签名。",
        "turn_or_reveal": "签名和回执编号一致。", "dialogue_objective": "确认取得过程。",
        "exit_state": "原件来源已得到核验。", "dialogue_line_target": 24, "shot_target": 16,
    }
    original = deepcopy(scene)
    result = _normalize_scene_execution_plan([scene], dialogue_total=24, shot_total=16, fallback_character_refs=["character.lead"])
    assert result[0]["scene_heading"] == expected
    assert scene == original


@pytest.mark.parametrize("child", [False, True])
def test_initial_service_call_uses_compact_schema_and_returns_full_public_contract(child):
    calls = []
    compact = compact_leaf()
    model = StoryPlanNodeGenerationOutput
    if child:
        compact["recommended_next_step"] = "episode_ready"
        model = StoryPlanNodeChildOutput
    service = object.__new__(StoryPlanningService)
    service._llm_adapter = SimpleNamespace()
    def generate(adapter, prompt, **kwargs):
        calls.append(kwargs)
        assert "turning_point_indices" in kwargs["output_schema"]["properties"]
        return deepcopy(compact)
    service._generate_structured_planning_response = generate
    node = service._generate_planning_output(prompt="一次编排完整因果。", strategy=build_strategy(), output_model=model, artifact_name="Story Plan Node")
    assert len(calls) == 1
    validate_episode_developments(node, required=True, require_canonical_events=True)


def test_decomposition_and_partial_transport_salvage_share_reference_validation():
    import json
    compact = compact_leaf() | {"recommended_next_step": "episode_ready"}
    second = deepcopy(compact)
    second["planned_start_episode"], second["planned_end_episode"] = 9, 16
    for entry in second["episode_developments"]:
        entry["episode_number"] += 8
    output = StoryPlanNodeDecompositionOutput.model_validate(planning_payload_for_validation({"children": [compact, second]}, StoryPlanNodeDecompositionOutput))
    assert len(output.children) == 2
    assert _decomposition_recovery_candidate_score([compact, second]) == (2, 2)
    raw = json.dumps(compact, ensure_ascii=False)
    assert _salvage_story_plan_child_from_partial_json("说明：" + raw) == output.children[0].model_dump(mode="json")
    compact["turning_point_indices"] = [99]
    assert _decomposition_recovery_candidate_score([compact, second]) == (1, 2)
    assert _salvage_story_plan_child_from_partial_json(json.dumps(compact, ensure_ascii=False)) is None


def test_expandable_node_has_one_event_table_without_episode_allocation():
    compact = compact_leaf() | {"planned_end_episode": 20, "episode_developments": []}
    output = expand_node_event_references(compact)
    assert output["turning_points"] == [compact["unit_story_beats"][0], compact["unit_story_beats"][2]]
    assert output["episode_developments"] == []


@pytest.mark.parametrize("span", [8, 20])
def test_targeted_revision_does_not_splice_a_valid_new_map_into_old_events(span):
    source = authored_leaf()
    compact = compact_leaf()
    compact["unit_story_beats"][0] = "主角取回原始材料，当面对照签章确认来源并保留核验记录。"
    compact["title"] = "模型擅改的标题"
    if span == 20:
        source = source.model_copy(update={"planned_end_episode": 20, "episode_developments": []})
        compact.update(planned_end_episode=20, episode_developments=[])
    candidate = StoryPlanNodeGenerationOutput.model_validate(expand_node_event_references(compact))
    original = source.model_dump()
    allowed = infer_story_plan_node_modification_scope(
        instruction="补齐结算前材料取得的因果过程。", selection_context=None, revision_mode="targeted",
    )
    scoped = apply_story_plan_node_modification_scope(source, candidate, allowed)
    validate_episode_developments(scoped, required=True, require_canonical_events=True)
    assert scoped.unit_story_beats == candidate.unit_story_beats
    assert scoped.turning_points == candidate.turning_points
    assert scoped.episode_developments == candidate.episode_developments
    assert scoped.title == source.title
    assert source.model_dump() == original


def test_title_only_revision_preserves_all_existing_event_content():
    source = authored_leaf()
    compact = compact_leaf()
    compact["unit_story_beats"][0] = "未经请求的改动：主角销毁材料导致证据彻底丧失。"
    compact["title"] = "新的节点标题"
    candidate = StoryPlanNodeGenerationOutput.model_validate(expand_node_event_references(compact))
    allowed = infer_story_plan_node_modification_scope(
        instruction="修改标题。", selection_context=None, revision_mode="targeted",
    )
    scoped = apply_story_plan_node_modification_scope(source, candidate, allowed)
    assert allowed == {"title"}
    assert scoped.title == candidate.title
    for field in ("unit_story_beats", "turning_points", "episode_developments", "entry_state", "exit_state"):
        assert getattr(scoped, field) == getattr(source, field)


@pytest.mark.parametrize("failure", [None, "omitted_acquisition", "replayed_acquisition", "reordered"])
def test_decomposition_preserves_causal_acquisition_not_only_the_major_reveal(failure):
    from app.modules.script_engine.story_decomposition_contracts import validate_inherited_parent_events
    from app.modules.script_engine.planning_errors import StoryPlanningInputError
    parent = authored_leaf().model_copy(update={"unit_story_beats": [
        "主角从移交记录找到保管人，联系对方并当面取得封存原件。",
        "主角与保管人核对原件签名，确认既有副本缺少关键一页。",
        "主角提交原件和交接记录，使审查人员能够独立复核缺页。",
    ]})
    first = StoryPlanNodeChildOutput.model_validate(expand_node_event_references(compact_leaf()) | {"recommended_next_step": "episode_ready"})
    first = first.model_copy(update={"unit_story_beats": parent.unit_story_beats[:2]})
    second = first.model_copy(update={"unit_story_beats": ["保管人要求保留个人信息，主角同意限制展示范围。", parent.unit_story_beats[2]]})
    if failure == "omitted_acquisition": first = first.model_copy(update={"unit_story_beats": parent.unit_story_beats[1:2]})
    if failure == "replayed_acquisition": second = second.model_copy(update={"unit_story_beats": [*second.unit_story_beats, parent.unit_story_beats[0]]})
    if failure == "reordered": first = first.model_copy(update={"unit_story_beats": list(reversed(first.unit_story_beats))})
    output = StoryPlanNodeDecompositionOutput(children=[first, second])
    before = output.model_dump()
    if failure:
        with pytest.raises(StoryPlanningInputError, match="parent causal event"):
            validate_inherited_parent_events(output, parent)
    else:
        validate_inherited_parent_events(output, parent)
    assert output.model_dump() == before


def test_quality_review_binds_mixed_versions_without_model_generated_metadata():
    refs = {"review_1": {"node_id": "node.first", "node_version": 1}, "review_2": {"node_id": "node.second", "node_version": 7}}
    verdict = {"status": "pass", "summary": "实际因果与前后状态一致。"}
    payload = {"overall_summary": "检查完成。", "evaluations": {"review_2": dict(verdict), "review_1": dict(verdict)}}
    before = deepcopy(payload)
    output = StoryPlanQualityModelOutput.model_validate(expand_quality_review_references(payload, refs))
    assert [(item.node_id, item.node_version) for item in output.evaluations] == [("node.first", 1), ("node.second", 7)]
    assert payload == before
    schema = quality_review_wire_schema(StoryPlanQualityModelOutput.model_json_schema(), refs)
    assert schema["properties"]["evaluations"]["required"] == ["review_1", "review_2"]
    assert "node_version" not in schema["$defs"]["StoryPlanQualityEvaluation"]["properties"]


@pytest.mark.parametrize("failure", ["missing", "unknown", "metadata", "invalid_verdict"])
def test_quality_review_never_fabricates_a_missing_or_invalid_verdict(failure):
    refs = {"review_1": {"node_id": "node.first", "node_version": 2}}
    verdict = {"status": "needs_revision", "summary": "结果尚未建立。", "issue_codes": ["causal_gap"], "repair_instruction": "补齐成立结果的行动。"}
    payload = {"overall_summary": "检查完成。", "evaluations": {"review_1": verdict}}
    if failure == "missing": payload["evaluations"] = {}
    elif failure == "unknown": payload["evaluations"] = {"review_2": verdict}
    elif failure == "metadata": verdict["node_version"] = 1
    else: verdict.pop("repair_instruction")
    before = deepcopy(payload)
    with pytest.raises(ValidationError):
        StoryPlanQualityModelOutput.model_validate(expand_quality_review_references(payload, refs))
    assert payload == before


def test_review_accepts_legacy_optional_resolution_without_inventing_one():
    node = authored_leaf().model_copy(update={"unit_resolution": None, "handoff_pressure": None})
    prompt = StoryPlanningService._build_story_plan_quality_prompt(
        story_bible=build_active_lineage_story_bible(), leaves=[node], sampled_leaves=[node],
    )
    assert "结算=未提供" in prompt and "后续压力=未提供" in prompt
    assert node.unit_resolution is None and node.handoff_pressure is None


def test_review_and_modification_share_approved_relationship_and_arc_facts():
    bible = build_active_lineage_story_bible()
    # Approved canon can live in relational/arc fields rather than locked_facts.
    bible.relationships = [{"initial_state": "师父要求主角暂存档案，双方都知道这项约定。"}]
    bible.character_arc_targets = [{"internal_need": "公开承认当年的暂存决定。"}]
    node = authored_leaf()
    review = StoryPlanningService._build_story_plan_quality_prompt(story_bible=bible, leaves=[node], sampled_leaves=[node])
    modification = StoryPlanningService._build_story_plan_node_modification_prompt(
        source=node, story_bible=bible, instruction="核对因果", revision_mode="targeted",
        selection_context=None, continuity_context={}, knowledge_context="",
    )
    for prompt in (review, modification):
        assert "师父要求主角暂存档案" in prompt
        assert "公开承认当年的暂存决定" in prompt
        assert "不能仅因某条事实未在locked_facts重复列出" in prompt
