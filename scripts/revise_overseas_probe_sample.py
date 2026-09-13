"""Apply reviewed probe corrections to an isolated copy, with no LLM calls."""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
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
from scripts.real_generation_probe_continuity import project_probe_continuity
from scripts.real_generation_probe_fixture import _data, _save_workspace, build_probe_request
from scripts.real_generation_probe_transport import ProviderRequestMeter
from scripts.run_real_generation_probe import overseas_language_audit, prepare_runtime, screenplay_markdown, write_json


SOURCE_DRAFT_SHA256 = "76a7c9f5fa9831a4f40cff53a212f3a4e6ac41c7ef836955388b2a1426b3bf09"
REPLACEMENTS = (
    (("scenes", 0, "character_actions", 0),
     "宴会厅大屏短暂显示付款截图；只有讲台操作端的预览侧栏选中了证人名单，名单尚未出现在大屏上，投屏倒计时跳到三。"),
    (("scenes", 0, "dialogues", 0, "text"),
     "Eve, the names in your preview are about to go up."),
    (("scenes", 0, "dialogues", 0, "chinese_translation"),
     "伊芙，你预览里的名字马上就要投上去了。"),
    (("scenes", 0, "dialogues", 6, "text"),
     "Post that screenshot online, and they'll hunt for the list."),
    (("scenes", 0, "dialogues", 6, "chinese_translation"),
     "你把那张截图发到网上，他们就会追查名单。"),
    (("continuity_state_updates", 0, "current_state"),
     "由伊芙持有，曾短暂显示在宴会大屏；没有证据表明已发布到网络，仍可用于后续核验。"),
    (("continuity_state_updates", 0, "change_cause"),
     "付款截图曾在宴会大屏短暂显示；伊芙随后拔线并保留文件，名单未展示。"),
    (("continuity_state_updates", 1, "change_cause"),
     "伊芙在名单投屏前拔线，并将名单文件锁入手机加密夹。"),
)
CORRECTION_SETS = {
    "report34": {
        "source_draft_sha256": SOURCE_DRAFT_SHA256,
        "replacements": REPLACEMENTS,
    },
    "report36": {
        "source_draft_sha256": "7765ace85f37ae6070c827e1f1ed6b5a037f5853f84b9d2f6986b09c552b0604",
        "replacements": (
            (("character_state_updates", 0, "knowledge_states", 0, "status"), "known"),
            (("character_state_updates", 1, "knowledge_states", 0, "status"), "known"),
            (("scenes", 1, "character_actions", 4), "亚当滑到页脚的次日08:00。"),
            (("scenes", 1, "body_order"), [
                "action:0", "dialogue:0", "dialogue:1", "action:1", "dialogue:2", "dialogue:3",
                "action:2", "dialogue:4", "dialogue:5", "action:3", "dialogue:6", "action:4",
                "dialogue:7", "dialogue:8", "dialogue:9",
            ]),
            (("scenes", 1, "dialogues", 8, "intent"), "滑回事故当日20:00字段"),
            (("scenes", 1, "dialogues", 9, "chinese_translation"),
             "我们只证明付款早于通报所载的事故发生时间，没证明事故实际时间，也没证明谁改过记录。"),
        ),
    },
    "report38": {
        "episodes": {
            1: {
                "source_draft_sha256": "e06e10aa1165018a1811e0e6dabb800165d8cd565a4a5025c65758980bed2755",
                "findings": ["S01", "S02", "S03"],
                "replacements": (
                    (("scenes", 1, "character_actions", 2),
                     "亚当滑到通报末尾的次日08:00发布时间，再滑回事故记载20:00；伊芙按住他的手腕，把两部手机重新并排。"),
                    (("scenes", 1, "dialogues", 6, "intent"), "将通报滑到页脚，点向次日08:00发布时间"),
                    (("scenes", 1, "character_actions", 4),
                     "亚当将通报滑回并放大事故记载20:00；伊芙先确认自己的18:00付款截图已保存，再切换相机拍下亚当屏幕上的20:00表述，确认照片保存后收起手机。"),
                    (("scenes", 1, "dialogues", 2, "chinese_translation"),
                     "还声称作业一直持续到八点。这两个时间都很重要。"),
                ),
            },
            2: {
                "source_draft_sha256": "05e0ecfcbfbe5d7002c7536d3db6708c0ecdd8f1ec5f4187988a45ba5cd1018c",
                "findings": ["S04", "S05"],
                "replacements": (
                    (("scenes", 2, "character_actions", 5),
                     "诺拉的第二条消息覆盖屏幕：不要让科尔家族的人靠近我。伊芙走到停车区另一端，将手机上的整条警告展示给亚当；他看清后点头，留在原地。"),
                    (("scenes", 2, "dialogues", 5, "text"),
                     "Or the list. I told her who I am and that I have footage of a work order with her signature. No attachments."),
                    (("scenes", 2, "dialogues", 5, "chinese_translation"),
                     "也不会发名单。我告诉了她我是谁，还说我拍到了有她签名的工单。没有发附件。"),
                    (("scenes", 2, "dialogue_prompts", 5),
                     "Or the list. I told her who I am and that I have footage of a work order with her signature. No attachments."),
                ),
            },
        },
    },
}


def apply_corrections(draft: dict, correction_set: str, episode_number: int = 1) -> tuple[dict, list[dict]]:
    revised = deepcopy(draft)
    changes = []
    correction = CORRECTION_SETS[correction_set]
    if "episodes" in correction:
        correction = correction["episodes"][episode_number]
    for path, after in correction["replacements"]:
        parent = revised
        for part in path[:-1]:
            parent = parent[part]
        changes.append({"path": list(path), "before": deepcopy(parent[path[-1]]), "after": deepcopy(after)})
        parent[path[-1]] = deepcopy(after)
    return revised, changes


def verify_next_episode_state(payload: dict, revised: dict, prompt: str, correction_set: str) -> None:
    context = payload["episode_context"]
    checkpoint = json.loads(context["provisional_continuity_checkpoint"])
    assert checkpoint["through_episode_number"] == 1
    if correction_set == "report34":
        payment = next(item for item in checkpoint["world_states"] if item["entity_key"] == "evidence.payment_screenshot")
        assert payment["current_state"] == revised["continuity_state_updates"][0]["current_state"]
        assert payment["current_state"] in prompt
        return
    for index, character_ref in enumerate(("character.eve_hart", "character.adam_cole")):
        character = next(item for item in checkpoint["character_states"] if item["character_ref"] == character_ref)
        knowledge = next(item for item in character["knowledge_states"]
                         if item["knowledge_key"] == "mine.payment_statement.time_gap")
        assert knowledge == revised["character_state_updates"][index]["knowledge_states"][0]
        assert knowledge["status"] == "known"
        capsule = next(item for item in context["memory_recall"]["capsules"]
                       if item["capsule_id"] == f"memory.{character_ref}")
        assert f"known:{knowledge['statement']}" in capsule["summary"]
        assert f"disproved:{knowledge['statement']}" not in capsule["summary"]
        assert capsule["summary"] in prompt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--correction-set", choices=tuple(CORRECTION_SETS), default="report34")
    args = parser.parse_args()
    if args.correction_set == "report38":
        from scripts.revise_overseas_report38 import revise_report38_sample

        return revise_report38_sample(args.source.resolve(), args.output_dir.resolve())
    source_sha256 = CORRECTION_SETS[args.correction_set]["source_draft_sha256"]
    source, output = args.source.resolve(), args.output_dir.resolve()
    originals = {path: hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in source.rglob("*") if path.is_file()}
    draft_path = source / "episode_001/draft.json"
    if originals.get(draft_path) != source_sha256:
        raise ValueError(f"This reviewed correction only applies to the exact {args.correction_set} sample.")
    output.mkdir(parents=True, exist_ok=False)
    with sqlite3.connect(f"file:{source / 'probe.db'}?mode=ro", uri=True) as origin:
        with sqlite3.connect(output / "probe.db") as copied:
            origin.backup(copied)
    state = json.loads((source / "fixed_inputs.json").read_text())
    source_run = json.loads((source / "episode_001/run.json").read_text())["data"]
    request = ScriptGenerationDraftRequest.model_validate(
        json.loads((source / "episode_001/request.json").read_text())
    )
    original_draft = DraftMasterScript.model_validate(json.loads(draft_path.read_text()))
    revised, changes = apply_corrections(original_draft.model_dump(mode="json"), args.correction_set)
    now = datetime.now(timezone.utc).isoformat()
    provenance = {"schema_version": "probe_editorial_revision.v1", "status": "provisional",
                  "source_draft_sha256": source_sha256, "source_directory": str(source),
                  "correction_set": args.correction_set,
                  "method": "explicit_editorial_changes", "created_at": now,
                  "new_model_requests": 0, "review_findings": ["S01", "S02", "S03"], "changes": changes}
    revised.update(id=f"{original_draft.id}.review1", created_at=now, updated_at=now)
    # Generation usage and acceptance flags describe the immutable source, not this edit.
    revised["llm_metadata"] = {"editorial_revision": provenance}
    candidate = DraftMasterScript.model_validate(revised)
    before_qc = evaluate_episode_continuity(original_draft, request.episode_context)
    after_qc = evaluate_episode_continuity(candidate, request.episode_context)
    if args.correction_set == "report34":
        assert any("公开展示" in issue.summary for issue in before_qc.issues)
    else:
        assert any(issue.issue_type.value == "knowledge_conflict"
                   and issue.entity_key == "mine.payment_statement.time_gap" for issue in before_qc.issues)
    assert not after_qc.issues
    audit = overseas_language_audit(candidate.model_dump(mode="json"), state["canonical_names"])
    assert audit["language_contract_passed"]
    meter = ProviderRequestMeter(output / "provider_requests.jsonl", max_requests=0)
    with meter, prepare_runtime(output, "overseas", existing=True) as client:
        review_source = deepcopy(source_run)
        review_source["llm_raw_output"] = {}
        review_run = _data(client, "POST", "/script-generation/review-draft", {
            "source_generation_run": review_source,
            "draft_master_script": candidate.model_dump(mode="json"),
        })
        reviewed = DraftMasterScript.model_validate(review_run["draft_master_script"])
        assert reviewed.scenes == candidate.scenes
        assert review_run["continuity_qc_report"] == after_qc.model_dump(mode="json")
        candidate = reviewed
        project_id = state["project"]["project_id"]
        saved_workspace = _data(client, "GET", f"/story-projects/{project_id}/workspace")
        state["workspace"] = saved_workspace["workspace_payload"]
        state["workspace_revision"] = saved_workspace["revision"]
        episode = state["workspace"]["episodes"][0]
        source_artifact_id = episode["artifactRefs"]["draft"]["artifactId"]
        source_artifact = _data(client, "GET", f"/story-projects/{project_id}/episodes/1/artifacts/{source_artifact_id}")
        artifact_payload = EpisodeArtifactCreate(
            artifact_id=f"artifact.{project_id}.ep1.editorial_revision_1", story_project_id=project_id,
            episode_number=1, artifact_kind="revised", memory_layer="provisional",
            source_artifact_id=source_artifact_id, content_schema_version="probe_editorial_revision.v1",
            content_payload={"provenance": provenance, "draft_master_script": candidate.model_dump(mode="json"),
                             "continuity_qc_report": after_qc.model_dump(mode="json")},
            lineage_refs={"source_draft_sha256": source_sha256},
            client_instance_id="probe_editorial_revision.v1",
        ).model_dump(mode="json")
        artifact = _data(client, "POST", f"/story-projects/{project_id}/episodes/1/artifacts", artifact_payload)
        reloaded = _data(client, "GET", f"/story-projects/{project_id}/episodes/1/artifacts/{artifact['artifact_id']}")
        assert reloaded == artifact
        episode.update(generationRun=review_run, workingDraftJson=candidate.model_dump_json(indent=2),
                       hasLocalDraftEdits=False, updatedAt=now)
        episode["artifactRefs"]["revised"] = {
            "artifactId": artifact["artifact_id"], "artifactKind": "revised", "memoryLayer": "provisional",
            "artifactVersion": artifact["artifact_version"], "payloadChecksum": artifact["payload_checksum"],
            "createdAt": artifact["created_at"],
        }
        state["workspace"] = project_probe_continuity(state["workspace"], state["bible"])["workspace"]
        _save_workspace(client, state)
        saved = _data(client, "GET", f"/story-projects/{project_id}/workspace")
        assert saved["workspace_payload"] == state["workspace"]
        assert _data(client, "GET", f"/story-projects/{project_id}/episodes/1/artifacts/{source_artifact_id}") == source_artifact
        payload = build_probe_request(state, 2, candidate.model_dump(mode="json"))
        prompt = render_prompt_section(payload)
        verify_next_episode_state(payload, revised, prompt, args.correction_set)
        write_json(output / "episode_002_request.json", payload)
        (output / "episode_002_structured_prompt.txt").write_text(prompt, encoding="utf-8")
        write_json(output / "projected_workspace.json", state["workspace"])
        write_json(output / "revision_artifact.json", artifact)
        write_json(output / "review_run.json", review_run)
    write_json(output / "revision.json", provenance)
    write_json(output / "revised_draft.json", candidate.model_dump(mode="json"))
    write_json(output / "original_qc_rechecked.json", before_qc.model_dump(mode="json"))
    write_json(output / "revised_qc.json", after_qc.model_dump(mode="json"))
    write_json(output / "language_audit.json", audit)
    (output / "SCREENPLAY_REVISED.md").write_text(screenplay_markdown(candidate.model_dump(mode="json"), 1), encoding="utf-8")
    assert all(hashlib.sha256(path.read_bytes()).hexdigest() == sha for path, sha in originals.items())
    summary = {"passed": True, "source_files_unchanged": True, "changes": len(changes),
               "original_warning_count": before_qc.warning_count, "revised_warning_count": after_qc.warning_count,
               "artifact_kind": artifact["artifact_kind"], "memory_layer": artifact["memory_layer"],
               "source_artifact_id": source_artifact_id, "revised_artifact_id": artifact["artifact_id"],
               "second_episode_request_only": True, "second_episode_has_corrected_state": True,
               "provider": meter.summary(), "new_generated_episodes": 0,
               "correction_set": args.correction_set,
               "acceptance_scope": f"{args.correction_set} localized corrections; no new generative quality acceptance"}
    write_json(output / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
