"""Apply the reviewed third-episode changes to an isolated, provisional copy."""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.continuity_qc import evaluate_episode_continuity
from app.modules.script_engine.long_story_models import EpisodeArtifactCreate
from app.modules.script_engine.models import ScriptGenerationDraftRequest
from scripts.audit_real_probe_continuity import render_prompt_section
from scripts.real_generation_probe_continuity import CONTINUITY_SOURCES, project_probe_continuity
from scripts.real_generation_probe_fixture import _data, _handoff, _save_workspace, _workspace, build_probe_request
from scripts.real_generation_probe_transport import ProviderRequestMeter
from scripts.revise_overseas_report38 import file_fingerprints
from scripts.run_real_generation_probe import overseas_language_audit, prepare_runtime, screenplay_markdown, write_json


SOURCE_PINS = {
    "probe.db": "cf179ae9c24e8da2a213115bde86333ac65f29e6ce1c123289d654367493e6d9",
    "fixed_inputs.json": "42b8089646872b37a848cb9b2e977e6d1b19e6e2690227dcb8b540b2c6ba4f91",
    "episode_001/draft.json": "986adf0a4d5183c4c294c5e8d61844b608495cc1e3c4f7127304f8af374669a2",
    "episode_002/draft.json": "b428eddfdb6cd41349835dbe0d5a23955444a744633e08752d2f873a6638a78e",
    "episode_003/draft.json": "b6d3d291756ea2ec423a259dc7c08d4f0cdfb27b1dcbb60e5e8bc89b8bbceb1b",
}

# Each entry is tied to an explicit finding; metadata provenance is added separately.
REPLACEMENTS = (
    ("N01", ("scenes", 0, "character_actions", 0),
     "候车厅入口人声嘈杂，伊芙握着手机，背包里装着平板和存有工单影像的硬盘。"),
    ("N01", ("scenes", 0, "character_actions", 1),
     "亚当已在马路对面等候。伊芙站在候车厅入口，与他接通电话，隔街抬手让他留在原地。"),
    ("N01", ("scenes", 0, "character_actions", 2),
     "伊芙隔街指向亚当脚下的人行道，手机仍贴在耳边。"),
    ("N01", ("scenes", 0, "character_actions", 3),
     "伊芙重新拨给亚当，让他沿对街再退远。亚当照做后停下，伊芙挂断电话；诺拉看着新增的距离，点头后带她走向长椅。两人的低声交谈传不到亚当那里。"),
    ("N01", ("scenes", 0, "character_actions", 4),
     "伊芙挂断电话。诺拉从长椅尽头走出，先盯住马路对面的亚当，再谨慎靠近伊芙。"),
    ("N03", ("scenes", 0, "body_order"), [
        "action:0", "action:1", "dialogue:0", "dialogue:1", "action:2",
        "dialogue:2", "dialogue:3", "dialogue:4", "dialogue:5", "dialogue:6",
        "dialogue:7", "action:4", "dialogue:8", "dialogue:9", "action:3",
    ]),
    ("N01", ("scenes", 0, "dialogues", 4, "intent"), "隔街盯着亚当，在电话里警告"),
    ("N01", ("scenes", 0, "dialogues", 6, "text"), "Then stay across the road. Keep the entrance clear."),
    ("N01", ("scenes", 0, "dialogues", 6, "chinese_translation"), "那就留在马路对面。别靠近入口。"),
    ("N01", ("scenes", 0, "dialogues", 7, "text"), "Fine. I'll stay here and keep my phone on."),
    ("N01", ("scenes", 0, "dialogues", 7, "chinese_translation"), "好。我留在这儿，手机保持畅通。"),
    ("N01", ("scenes", 0, "dialogues", 9, "text"), "I'll have him move farther back. You choose where we sit."),
    ("N01", ("scenes", 0, "dialogues", 9, "chinese_translation"), "我让他再退远些。我们坐哪里，由你选。"),
    ("N03", ("scenes", 1, "character_actions", 0),
     "伊芙从包里取出平板，打开备份影像，将画面停在工单箱号和签收栏。"),
    ("N03", ("scenes", 1, "body_order"), [
        "action:0", "action:1", "dialogue:0", "dialogue:1", "dialogue:2",
        "dialogue:3", "action:2", "dialogue:4", "dialogue:5", "action:3",
        "dialogue:6", "dialogue:7", "action:4", "dialogue:8", "dialogue:9",
    ]),
    ("N03", ("scenes", 1, "dialogues", 2, "intent"), "压低声音，攥紧外套袖口"),
    ("N03", ("scenes", 1, "dialogues", 5, "intent"), "坚定，手掌按住平板边框"),
    ("N03", ("scenes", 2, "character_actions", 0),
     "候车厅广播响起，诺拉将平板还给伊芙，迅速望向出口。"),
    ("N03", ("scenes", 2, "body_order"), [
        "action:0", "dialogue:0", "dialogue:1", "action:1", "action:2",
        "dialogue:2", "dialogue:3", "dialogue:4", "dialogue:5", "action:3",
        "dialogue:6", "dialogue:7", "action:4", "dialogue:8", "action:5", "dialogue:9",
    ]),
    ("N03", ("scenes", 2, "dialogues", 0, "intent"), "低声，示意还有线索"),
    ("N03", ("scenes", 2, "dialogues", 1, "intent"), "立即追问具体位置"),
    ("N03", ("scenes", 2, "dialogues", 3, "intent"), "立即追问调阅权限"),
    ("N03", ("scenes", 2, "dialogues", 4, "intent"), "严肃，捏住递出的纸条"),
    ("N03", ("scenes", 2, "dialogues", 5, "intent"), "认真，明确承诺"),
    ("N04", ("scenes", 2, "dialogues", 5, "text"), "I'll protect your identity. We agree on what goes public first."),
    ("N04", ("scenes", 2, "dialogues", 5, "chinese_translation"), "我会保护你的身份。公开哪些内容，我们先商量。"),
    ("N04", ("scenes", 2, "dialogue_prompts", 5), "I'll protect your identity. We agree on what goes public first."),
    ("N01", ("scenes", 2, "character_actions", 4),
     "伊芙在出口抬手示意目前安全。亚当从马路对面更远处看见手势，仍留在原地，没有听见会面内容。"),
    ("N03", ("scenes", 2, "character_actions", 5),
     "诺拉在出口处展开另一张旧便签，伊芙姐姐的签名和矿难前一周的日期露在伊芙面前。伊芙俯身辨认日期。"),
    ("N03", ("scenes", 2, "dialogues", 8, "intent"), "声音发颤，取出另一张旧便签"),
    ("N03", ("scenes", 2, "dialogues", 9, "intent"), "盯住日期，声音绷紧"),
    ("N02", ("character_state_updates", 0, "location"), "河湾镇长途车站候车厅出口"),
    ("N06", ("character_state_updates", 0, "lasting_marks"), []),
    ("N06", ("character_state_updates", 0, "active_constraints"), [
        "不能公开诺拉身份", "不能把材料差异当作事故时刻证明", "必须让亚当与诺拉保持距离",
        "暂时不能立即公开完整影像，公开范围须先与诺拉商量",
    ]),
    ("N02", ("character_state_updates", 1, "location"), "车站马路对面，比最初等候处更远的位置"),
    ("N02", ("character_state_updates", 1, "knowledge_changes"), [
        "看见伊芙在候车厅出口示意目前安全", "未听到私下核验和调度室线索的谈话",
        "未获知伊芙姐姐生前签字调阅记录的内容",
    ]),
    ("N02", ("character_state_updates", 1, "knowledge_states"), [{
        "knowledge_key": "distance_agreement", "status": "known",
        "statement": "伊芙要求亚当留在马路对面，并在诺拉仍害怕时退到更远处",
    }]),
    ("N02", ("character_state_updates", 1, "active_constraints"), [
        "不能接近诺拉", "不能替伊芙决定公开时机", "尚未掌握实际事故时刻或修改者",
        "会面内容尚未向他传达，不得基于调度线索或伊芙姐姐签字采取行动",
    ]),
    ("N02", ("character_state_updates", 1, "change_summary"),
     "亚当守住距离，只收到安全手势，未得知会面内容"),
    ("N02", ("character_state_updates", 1, "change_cause"),
     "亚当留在马路对面，按伊芙电话要求再退远，仅从出口手势得知她目前安全"),
    ("N02", ("character_state_updates", 2, "knowledge_changes", 3),
     "告知伊芙：伊芙的姐姐曾在矿难前一周签字调阅记录"),
    ("N02", ("character_state_updates", 2, "knowledge_changes", 0),
     "查看遮盖姓名的工单备份影像，并核对保留的签名、箱号和停工时间"),
    ("N02", ("character_state_updates", 2, "knowledge_states", 3, "statement"),
     "伊芙的姐姐在矿难前一周签字调阅过这批旧记录"),
    ("N02", ("character_state_updates", 2, "knowledge_states", 4, "statement"),
     "伊芙的姐姐当时为何调阅记录仍未查明"),
    ("N06", ("character_state_updates", 2, "lasting_marks"), []),
    ("N02", ("continuity_state_updates", 3, "entity_name"), "伊芙姐姐生前调阅签字"),
    ("N02", ("continuity_state_updates", 3, "current_state"),
     "伊芙的姐姐在矿难前一周签字调阅这批旧记录，调阅原因未知"),
    ("N03", ("continuity_state_updates", 3, "change_cause"),
     "诺拉现场说明，并向伊芙展开写有其姐姐签名和日期的旧便签"),
    ("N01", ("relationship_state_updates", 0, "change_cause"),
     "亚当先留在马路对面，诺拉仍害怕时按伊芙电话要求退得更远，随后未接近会面"),
    ("N05", ("setup_payoff_updates",), []),
)


def apply_report39_corrections(draft: dict) -> tuple[dict, list[dict]]:
    revised = deepcopy(draft)
    changes = []
    for finding, path, after in REPLACEMENTS:
        parent = revised
        for part in path[:-1]:
            parent = parent[part]
        before = deepcopy(parent[path[-1]])
        if before == after:
            raise ValueError(f"Expected an uncorrected field at {path}.")
        parent[path[-1]] = deepcopy(after)
        changes.append({"finding": finding, "path": list(path), "before": before, "after": deepcopy(after)})
    # E2 already created this key. Updating it prevents a stale "not yet viewed" fact from surviving projection.
    path = ["character_state_updates", 2, "knowledge_states"]
    states = revised["character_state_updates"][2]["knowledge_states"]
    before = deepcopy(states)
    states.append({"knowledge_key": "full_work_order_content", "status": "known",
                   "statement": "诺拉已私下查看遮盖姓名的工单备份影像，并核验签名、箱号和18:30停工记录"})
    changes.append({"finding": "N02", "path": path, "before": before, "after": deepcopy(states)})
    return revised, changes


def _database_rows(path: Path, table: str) -> list[tuple]:
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        return db.execute(f'SELECT * FROM "{table}" ORDER BY 1').fetchall()


def validate_report39_source(source: Path, output: Path) -> tuple[dict, dict]:
    if output == source or source in output.parents:
        raise ValueError("The revision output must be outside the immutable source directory.")
    fingerprints = file_fingerprints(source)
    if any(fingerprints.get(name) != digest for name, digest in SOURCE_PINS.items()):
        raise ValueError("This revision only applies to the exact report39 resumed three-episode sample.")
    state = json.loads((source / "fixed_inputs.json").read_text())
    project_id = state["project"]["project_id"]
    with sqlite3.connect(f"file:{source / 'probe.db'}?mode=ro", uri=True) as db:
        row = db.execute("SELECT payload FROM story_project_workspace_snapshots WHERE project_id=?", (project_id,)).fetchone()
        if row is None:
            raise ValueError("Source project has no persisted workspace.")
        workspace = json.loads(row[0])
        if [episode["episodeNumber"] for episode in workspace["episodes"]] != [1, 2, 3]:
            raise ValueError("The reviewed source must have three saved episodes.")
        for number, episode in enumerate(workspace["episodes"], 1):
            directory = source / f"episode_{number:03d}"
            draft = json.loads((directory / "draft.json").read_text())
            run = json.loads((directory / "run.json").read_text())["data"]
            if run["draft_master_script"] != draft or episode["generationRun"] != run:
                raise ValueError(f"Source episode {number} run, draft and workspace disagree.")
            if json.loads(episode["workingDraftJson"]) != draft:
                raise ValueError(f"Source episode {number} working draft disagrees.")
            kind = "revised" if number < 3 else "draft"
            ref = episode["artifactRefs"][kind]
            artifact_row = db.execute("SELECT payload FROM episode_artifact_versions WHERE artifact_id=?", (ref["artifactId"],)).fetchone()
            artifact = json.loads(artifact_row[0])
            if artifact["memory_layer"] != "provisional" or artifact["artifact_kind"] != kind:
                raise ValueError("The source must preserve inherited revised/provisional artifacts.")
            if artifact["content_payload"]["draft_master_script"] != draft:
                raise ValueError(f"Source episode {number} artifact disagrees.")
    if state["bible"]["major_setup_payoff_refs"] or any(plan["setup_refs"] or plan["payoff_refs"] for plan in state["plans"]):
        raise ValueError("The reviewed fixture has no registered setup/payoff refs.")
    return fingerprints, state


def build_fourth_episode_handoff(state: dict, previous: dict) -> dict:
    projection = project_probe_continuity(state["workspace"], state["bible"], {
        "characterRefs": state["bible"]["character_refs"],
        "storyLineRefs": ["storyline.mine_evidence"], "setupPayoffRefs": [],
    })
    request = deepcopy(state["workspace"]["episodes"][-1]["generationRun"])
    context = deepcopy(request["episode_context"])
    context.update(episode_number=4, previous_episode_handoff=_handoff(previous),
                   previous_episode_question=previous["next_episode_question"],
                   provisional_continuity_checkpoint=projection["checkpoint"],
                   memory_recall=projection["memoryRecall"], approved_episode_plan=None,
                   approved_story_node=None, batch_context=None,
                   episode_instruction="后续分集规划须回应调度记录移交和伊芙姐姐生前签字的调查义务；尚未批准第四集规划，不执行生成。")
    return {
        "schema_version": "probe_editorial_handoff.v1", "episode_number": 4,
        "generation_ready": False, "missing_requirements": ["approved_episode_plan"],
        "episode_context": context,
        "scope": "Rebuilt continuity context only; no invented fourth-episode plan, request dispatch or approval.",
    }


def verify_report39_handoff(handoff: dict, workspace: dict, draft: dict) -> dict:
    context = handoff["episode_context"]
    checkpoint = json.loads(context["provisional_continuity_checkpoint"])
    assert checkpoint["through_episode_number"] == 3 and checkpoint["version"] == "provisional"
    assert context["memory_recall"]["through_episode_number"] == 3
    assert context["approved_episode_plan"] is None and not handoff["generation_ready"]
    adam = next(row for row in workspace["characters"] if row["id"] == "adam_cole")["dynamicState"]
    knowledge = {row["knowledgeKey"]: row for row in adam["knowledgeStates"]}
    assert "meeting_result" not in knowledge and "sister_signature" not in knowledge
    assert knowledge["distance_agreement"]["statement"] == draft["character_state_updates"][1]["knowledge_states"][0]["statement"]
    assert draft["character_state_updates"][1]["active_constraints"][-1] in adam["activeConstraints"]
    assert all("诺拉姐姐" not in item for item in adam["currentKnowledge"])
    for row in checkpoint["character_states"]:
        if row["character_ref"] == "character.adam_cole":
            states = {item["knowledge_key"]: item for item in row["knowledge_states"]}
            assert "meeting_result" not in states and "sister_signature" not in states
    for row in workspace["characters"]:
        assert not row.get("dynamicState", {}).get("lastingMarks", [])
    serialized = json.dumps(context, ensure_ascii=False)
    assert "诺拉姐姐" not in serialized
    assert "hook_payoff_target_episode_4" not in serialized
    assert "听见伊芙获悉调度室记录位置" not in serialized
    assert not workspace["setupPayoffs"]
    nora = next(row for row in workspace["characters"] if row["id"] == "nora_reed")["dynamicState"]
    viewed = next(row for row in nora["knowledgeStates"] if row["knowledgeKey"] == "full_work_order_content")
    assert viewed["statement"] == draft["character_state_updates"][2]["knowledge_states"][-1]["statement"]
    assert "完整工单影像内容尚未由诺拉查看" not in serialized
    capsules = {row["capsule_id"]: row for row in context["memory_recall"]["capsules"]}
    assert draft["character_state_updates"][1]["active_constraints"][-1] in capsules["memory.character.adam_cole"]["summary"]
    return {"passed": True, "through_episode_number": 3,
            "adam_unearned_knowledge_keys_absent": ["meeting_result", "sister_signature"],
            "bounded_checkpoint_character_refs": [row["character_ref"] for row in checkpoint["character_states"]],
            "incorrect_known_state_removed_from_recall_and_checkpoint": True,
            "physical_lasting_marks_empty": True, "invalid_setup_reference_removed": True,
            "nora_prior_unviewed_knowledge_key_superseded": True,
            "fourth_episode_generation_ready": False}


def revise_report39_sample(source: Path, output: Path) -> int:
    source, output = source.resolve(), output.resolve()
    fingerprints, state = validate_report39_source(source, output)
    protected_tables = ("agent_runs", "agent_steps", "generation_job_checkpoints", "episode_artifact_versions")
    source_rows = {table: _database_rows(source / "probe.db", table) for table in protected_tables}
    output.mkdir(parents=True, exist_ok=False)
    with sqlite3.connect(f"file:{source / 'probe.db'}?mode=ro", uri=True) as origin:
        with sqlite3.connect(output / "probe.db") as copied:
            origin.backup(copied)
    now = datetime.now(timezone.utc).isoformat()
    meter = ProviderRequestMeter(output / "provider_requests.jsonl", max_requests=0)
    reports = []
    with meter, prepare_runtime(output, "overseas", existing=True) as client:
        project_id = state["project"]["project_id"]
        saved = _data(client, "GET", f"/story-projects/{project_id}/workspace")
        episodes = deepcopy(saved["workspace_payload"]["episodes"])
        state["workspace_revision"] = saved["revision"]
        state["workspace"] = _workspace(state)
        state["drafts"] = []
        previous = None
        for number, episode in enumerate(episodes, 1):
            directory = output / f"episode_{number:03d}"
            directory.mkdir()
            request = build_probe_request(state, number, previous)
            original = json.loads((source / directory.name / "draft.json").read_text())
            source_run = json.loads((source / directory.name / "run.json").read_text())["data"]
            if number < 3:
                candidate = original
                run = source_run
                for name in ("draft.json", "run.json", "request.json"):
                    shutil.copy2(source / directory.name / name, directory / name)
                write_json(directory / "rebuilt_request_context.json", request)
                reports.append({"episode_number": number, "origin": "inherited_report38_revision", "draft_bytes_unchanged": True})
            else:
                revised, changes = apply_report39_corrections(original)
                provenance = {
                    "schema_version": "probe_editorial_revision.v1", "status": "provisional",
                    "source_directory": str(source), "source_draft_sha256": fingerprints[f"{directory.name}/draft.json"],
                    "source_run_sha256": fingerprints[f"{directory.name}/run.json"],
                    "correction_set": "report39", "episode_number": 3, "method": "explicit_editorial_changes",
                    "created_at": now, "new_model_requests": 0,
                    "review_findings": ["N01", "N02", "N03", "N04", "N05", "N06"], "changes": changes,
                }
                revised.update(id=f"{original['id']}.report39.review1", created_at=now, updated_at=now,
                               llm_metadata={"editorial_revision": provenance})
                candidate_model = DraftMasterScript.model_validate(revised)
                context = ScriptGenerationDraftRequest.model_validate(request).episode_context
                before_qc = evaluate_episode_continuity(DraftMasterScript.model_validate(original), context)
                after_qc = evaluate_episode_continuity(candidate_model, context)
                assert after_qc.blocking_issue_count == 0 and after_qc.warning_count == 0
                review_source = deepcopy(source_run)
                review_source.update(llm_raw_output={}, episode_context=request["episode_context"])
                run = _data(client, "POST", "/script-generation/review-draft", {
                    "source_generation_run": review_source, "draft_master_script": candidate_model.model_dump(mode="json"),
                })
                candidate = run["draft_master_script"]
                assert candidate["scenes"] == revised["scenes"]
                assert run["continuity_qc_report"] == after_qc.model_dump(mode="json")
                artifact_url = f"/story-projects/{project_id}/episodes/3/artifacts"
                source_artifact_id = episode["artifactRefs"]["draft"]["artifactId"]
                payload = EpisodeArtifactCreate(
                    artifact_id=f"artifact.{project_id}.ep3.report39.editorial_revision_1",
                    story_project_id=project_id, episode_number=3, artifact_kind="revised", memory_layer="provisional",
                    source_artifact_id=source_artifact_id, content_schema_version="probe_editorial_revision.v1",
                    content_payload={"provenance": provenance, "draft_master_script": candidate,
                                     "generation_run": run, "continuity_qc_report": after_qc.model_dump(mode="json")},
                    lineage_refs={"source_draft_sha256": provenance["source_draft_sha256"],
                                  "source_run_sha256": provenance["source_run_sha256"]},
                    client_instance_id="probe_editorial_revision.v1",
                ).model_dump(mode="json")
                artifact = _data(client, "POST", artifact_url, payload)
                assert _data(client, "GET", f"{artifact_url}/{artifact['artifact_id']}") == artifact
                episode.update(generationRun=run, workingDraftJson=json.dumps(candidate, ensure_ascii=False, indent=2),
                               hasLocalDraftEdits=False, updatedAt=now)
                episode["artifactRefs"]["revised"] = {
                    "artifactId": artifact["artifact_id"], "artifactKind": "revised", "memoryLayer": "provisional",
                    "artifactVersion": artifact["artifact_version"], "payloadChecksum": artifact["payload_checksum"],
                    "createdAt": artifact["created_at"],
                }
                write_json(directory / "draft.json", candidate)
                write_json(directory / "run.json", {"data": run})
                write_json(directory / "request.json", request)
                write_json(directory / "revision.json", provenance)
                write_json(directory / "revision_artifact.json", artifact)
                write_json(directory / "original_qc_rechecked.json", before_qc.model_dump(mode="json"))
                write_json(directory / "revised_qc.json", after_qc.model_dump(mode="json"))
                reports.append({"episode_number": 3, "origin": "explicit_report39_revision", "changes": len(changes),
                                "blocking_issues": after_qc.blocking_issue_count, "warnings": after_qc.warning_count,
                                "artifact_kind": artifact["artifact_kind"], "memory_layer": artifact["memory_layer"]})
            audit = overseas_language_audit(candidate, state["canonical_names"])
            assert audit["language_contract_passed"]
            state["workspace"]["episodes"].append(episode)
            state["workspace"].update(status="draft", activeEpisodeNumber=number)
            state["workspace"] = project_probe_continuity(state["workspace"], state["bible"])["workspace"]
            state["drafts"].append(candidate)
            _save_workspace(client, state)
            saved = _data(client, "GET", f"/story-projects/{project_id}/workspace")
            assert saved["workspace_payload"] == state["workspace"]
            assert json.loads(saved["workspace_payload"]["episodes"][-1]["workingDraftJson"]) == candidate
            previous = candidate
            write_json(directory / "language_audit.json", audit)
            write_json(directory / "projected_workspace.json", state["workspace"])
            (directory / "SCREENPLAY_REVISED.md").write_text(screenplay_markdown(candidate, number), encoding="utf-8")
        handoff = build_fourth_episode_handoff(state, previous)
        handoff_verification = verify_report39_handoff(handoff, state["workspace"], previous)
        prompt_request = json.loads((output / "episode_003/request.json").read_text())
        prompt_request.update(agent_request_id=None, episode_context=handoff["episode_context"])
        prompt = render_prompt_section(prompt_request)
        assert all(json.dumps(row["summary"], ensure_ascii=False) in prompt
                   for row in handoff["episode_context"]["memory_recall"]["capsules"])
        write_json(output / "episode_004_handoff_context.json", handoff)
        (output / "episode_004_handoff_prompt.txt").write_text(prompt, encoding="utf-8")
        write_json(output / "handoff_verification.json", handoff_verification)
        write_json(output / "projected_workspace.json", state["workspace"])
        write_json(output / "fixed_inputs.json", state)
    assert file_fingerprints(source) == fingerprints
    assert meter.summary()["physical_requests"] == 0
    for table, rows in source_rows.items():
        copied_rows = _database_rows(output / "probe.db", table)
        assert all(row in copied_rows for row in rows)
        assert len(copied_rows) == len(rows) + (1 if table == "episode_artifact_versions" else 0)
    for number in (1, 2):
        assert (output / f"episode_{number:03d}/draft.json").read_bytes() == (source / f"episode_{number:03d}/draft.json").read_bytes()
    lineage = {
        "schema_version": 1, "status": "provisional", "correction_set": "report39", "created_at": now,
        "source_directory": str(source), "source_kind": "resumed_three_episode_run_with_inherited_revisions",
        "source_files_sha256": fingerprints, "revised_files_sha256": file_fingerprints(output),
        "source_hashes": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in (*CONTINUITY_SOURCES, Path(__file__))},
        "source_checkpoint_policy": "Original model checkpoints and artifacts remain unchanged; editorial artifacts are not original model replays.",
        "generation_metadata_policy": "Source run timestamps and model identity remain historical provenance; revised metadata contains deterministic review and explicit editorial changes.",
        "episodes": reports, "changes": changes, "new_model_requests": 0,
    }
    write_json(output / "revision.json", lineage)
    summary = {"passed": True, "source_files_unchanged": True, "source_artifacts_and_checkpoints_unchanged": True,
               "provider": meter.summary(), "episodes": reports, "new_generated_episodes": 0,
               "revised_episodes": 1, "inherited_revised_episodes": 2, "handoff": handoff_verification,
               "acceptance_scope": "Explicit N01-N06 editorial correction and deterministic persistence only; no automated generation or author-quality approval."}
    write_json(output / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    return revise_report39_sample(args.source, args.output_dir)


if __name__ == "__main__":
    raise SystemExit(main())
