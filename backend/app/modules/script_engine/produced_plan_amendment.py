"""Explicit, auditable amendments of execution plans with existing screenplays.

The caller holds the project lock and persists the returned workspace with CAS.
Ordinary saves never grant authority to modify the frozen planning prefix.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Mapping

from pydantic import ValidationError

from app.modules.script_engine.long_story_models import EpisodePlanGenerationItem
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.models import ApprovedEpisodePlanContext
from app.modules.script_engine.episode_layer_contracts import compile_episode_three_layer_contract
from app.modules.script_engine.episode_readiness import episode_execution_readiness_issues


REQUEST_FIELD = "producedPlanAmendmentRequest"
RESOLUTION_FIELD = "producedPlanAmendmentResolutionRequest"
RECEIPTS_FIELD = "producedPlanAmendments"
RESOLUTIONS_FIELD = "producedPlanAmendmentResolutions"
MARKER_FIELD = "sourceAmendment"
EDITABLE_PLAN_FIELDS = frozenset({
    "episode_title", "synopsis", "locations", "character_refs", "scene_execution_plan",
    "dramatic_units", "emotional_movement", "protagonist_cost", "episode_goal",
    "central_conflict", "protagonist_decision", "stage_opposition", "episode_payoff",
    "pressure_escalation", "reveal", "continuity_requirements", "target_duration_seconds",
    "planned_scene_count", "planned_shot_count", "planned_dialogue_line_count",
})
_PLAN_DERIVED_FIELDS = {"status", "source_revision_review", "execution_ready", "layer_contracts"}
_BODY_DERIVED_FIELDS = {"id", "created_at", "updated_at", "llm_metadata"}


def _fail(message: str) -> None:
    raise LongStoryPersistenceConflictError("Produced plan amendment: " + message)


def stable_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":")).encode("utf-8")).hexdigest()


def plan_hash(row: Mapping[str, Any]) -> str:
    return stable_hash({k: v for k, v in row.items() if k not in _PLAN_DERIVED_FIELDS})


def episode_draft(episode: Mapping[str, Any]) -> dict:
    final = (episode.get("finalizationResult") or {}).get("master_script")
    locked = bool(episode.get("lockedAt") or episode.get("status") == "final"
                  or (episode.get("artifactRefs") or {}).get("final"))
    value = final or (episode.get("confirmedDraftJson") if locked else episode.get("workingDraftJson"))
    if value is None:
        value = episode.get("workingDraftJson") if locked else episode.get("confirmedDraftJson")
    if value is None:
        value = (episode.get("generationRun") or {}).get("draft_master_script")
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            _fail("a saved screenplay must contain its complete structured draft.")
    if not isinstance(value, dict):
        _fail("a saved screenplay and its original generation context are required.")
    return value


def draft_hash(draft: Mapping[str, Any]) -> str:
    return stable_hash({k: v for k, v in draft.items() if k not in _BODY_DERIVED_FIELDS})


def body_hash(episode: Mapping[str, Any]) -> str:
    return draft_hash(episode_draft(episode))


def _indexed(workspace: Mapping[str, Any], field: str, number_field: str) -> dict[int, dict]:
    values = workspace.get(field, [])
    if not isinstance(values, list) or any(not isinstance(v, dict) or type(v.get(number_field)) is not int for v in values):
        _fail(f"invalid {field} identities.")
    result = {v[number_field]: v for v in values}
    if len(result) != len(values):
        _fail(f"duplicate {field} identities.")
    return result


def pending_episode_numbers(workspace: Mapping[str, Any]) -> list[int]:
    return sorted(e["episodeNumber"] for e in (workspace.get("episodes") or [])
                  if isinstance(e, dict) and isinstance(e.get(MARKER_FIELD), dict))


def latest_resolution(workspace: Mapping[str, Any], episode_number: int) -> dict | None:
    return next((r for r in reversed(workspace.get(RESOLUTIONS_FIELD, []))
                 if isinstance(r, dict) and r.get("episodeNumber") == episode_number), None)


def _operation_hash(candidate: Mapping[str, Any], field: str) -> str:
    request = candidate.get(field) or {}
    if field == REQUEST_FIELD:
        numbers = request.get("episodeNumbers", [])
        plans = _indexed(candidate, "episodeRoadmaps", "episode_number")
        return stable_hash({"request": request, "plans": [plans.get(n) for n in numbers]})
    number = request.get("episodeNumber")
    episode = _indexed(candidate, "episodes", "episodeNumber").get(number)
    return stable_hash({"request": request, "episode": episode})


def is_idempotent_operation(previous: Mapping[str, Any], candidate: Mapping[str, Any], *, revision: int) -> bool:
    for field, collection in ((REQUEST_FIELD, RECEIPTS_FIELD), (RESOLUTION_FIELD, RESOLUTIONS_FIELD)):
        if not candidate.get(field):
            continue
        request = candidate[field]
        for receipt in previous.get(collection, []):
            if receipt.get("amendmentId") != request.get("amendmentId"):
                continue
            if field == RESOLUTION_FIELD and receipt.get("episodeNumber") != request.get("episodeNumber"):
                continue
            if receipt.get("appliedWorkspaceRevision") != revision:
                continue
            if receipt.get("requestHash") != _operation_hash(candidate, field):
                _fail("an operation identity was reused with different content.")
            return True
    return False


def _validate_receipts(previous: Mapping[str, Any], candidate: Mapping[str, Any]) -> None:
    for field in (RECEIPTS_FIELD, RESOLUTIONS_FIELD):
        if candidate.get(field, []) != previous.get(field, []):
            _fail("server receipts and original snapshots are immutable.")


def prepare_workspace_transition(previous: dict, candidate: dict, *, source_revision: int,
                                 has_running_work: bool, validate_plan_source) -> tuple[dict, str | None]:
    """Validate explicit commands and add only server-derived receipts/markers."""
    _validate_receipts(previous, candidate)
    if candidate.get(REQUEST_FIELD) and candidate.get(RESOLUTION_FIELD):
        _fail("apply a planning amendment and resolve a screenplay in separate transactions.")
    if candidate.get(REQUEST_FIELD):
        return _apply(previous, candidate, source_revision=source_revision,
                      has_running_work=has_running_work, validate_plan_source=validate_plan_source), "amend"
    if candidate.get(RESOLUTION_FIELD):
        return _resolve(previous, candidate, source_revision=source_revision,
                        has_running_work=has_running_work), "resolve"
    if any(previous.get(key) or candidate.get(key) for key in (RECEIPTS_FIELD, RESOLUTIONS_FIELD)) or any(
        isinstance(item, dict) and item.get(MARKER_FIELD) for item in (candidate.get("episodes") or [])
    ):
        validate_ordinary_save(previous, candidate)
    return candidate, None


def _apply(previous: dict, candidate: dict, *, source_revision: int,
           has_running_work: bool, validate_plan_source) -> dict:
    request = candidate[REQUEST_FIELD]
    if not isinstance(request, dict):
        _fail("invalid explicit amendment request.")
    expected_keys = {"amendmentId", "sourceWorkspaceRevision", "sourcePlanningRevisionEpoch", "episodeNumbers", "reason"}
    if set(request) != expected_keys:
        _fail("the amendment request must provide its exact source and selected episodes.")
    if has_running_work or (previous.get("activeGenerationTask") or {}).get("status") in {"running", "pending"}:
        _fail("running project work must finish before applying an amendment.")
    if pending_episode_numbers(previous):
        _fail("resolve the existing affected screenplays before applying another amendment.")
    amendment_id = request.get("amendmentId")
    if not isinstance(amendment_id, str) or not amendment_id.strip() or any(r.get("amendmentId") == amendment_id for r in previous.get(RECEIPTS_FIELD, [])):
        _fail("a new amendment identity is required.")
    if not isinstance(request.get("reason"), str) or len(request["reason"].strip()) < 5:
        _fail("a concrete amendment reason is required.")
    epoch = previous.get("planningRevisionEpoch", 0)
    if (request.get("sourceWorkspaceRevision") != source_revision
            or request.get("sourcePlanningRevisionEpoch") != epoch
            or candidate.get("planningRevisionEpoch") != epoch + 1):
        _fail("source workspace revision or planning epoch changed.")
    session = previous.get("planningSession") or {}
    if session.get("phase") != "script" or session.get("status") != "approved":
        _fail("only previously confirmed planning can be amended.")
    numbers = request.get("episodeNumbers")
    if (not isinstance(numbers, list) or not numbers or len(numbers) > 10
            or any(type(n) is not int or n < 1 for n in numbers)
            or numbers != list(range(numbers[0], numbers[-1] + 1))):
        _fail("select one explicit contiguous range of at most ten saved episodes.")
    episodes = _indexed(previous, "episodes", "episodeNumber")
    if not set(numbers).issubset(episodes):
        _fail("every selected episode must already have a saved screenplay.")
    if candidate.get("episodes", []) != previous.get("episodes", []):
        _fail("the planning transaction must preserve every existing screenplay verbatim.")
    for n in numbers:
        episode_draft(episodes[n])
        if not isinstance(episodes[n].get("generationRun"), dict):
            _fail("the original generation run must be preserved with every amended screenplay.")
    before = _indexed(previous, "episodeRoadmaps", "episode_number")
    after = _indexed(candidate, "episodeRoadmaps", "episode_number")
    if set(before) != set(after) or not set(numbers).issubset(before):
        _fail("the amendment must retain every roadmap identity.")
    allowed_root = {REQUEST_FIELD, "planningRevisionEpoch", "episodeRoadmaps", "updatedAt", "serverSync"}
    for field in set(previous) | set(candidate):
        if field not in allowed_root and previous.get(field) != candidate.get(field):
            _fail(f"the amendment cannot change unrelated workspace state ({field}).")
    result = deepcopy(candidate)
    for number, row in after.items():
        if number not in numbers:
            if row != before[number]:
                _fail("unselected roadmaps are frozen.")
            continue
        changed = {field for field in set(row) | set(before[number]) if row.get(field) != before[number].get(field)}
        if changed - EDITABLE_PLAN_FIELDS - {"status", "execution_ready", "layer_contracts"}:
            _fail("episode lineage, source events, entry/exit and handoff facts are frozen.")
        if row.get("status") != "draft" or not (changed & EDITABLE_PLAN_FIELDS):
            _fail("each selected execution plan must contain a concrete unapproved change.")
        # Reject out-of-range raw values before legacy model normalizers clamp them.
        for field, minimum, maximum in (("planned_dialogue_line_count",25,35),("planned_scene_count",1,5),
                                        ("planned_shot_count",15,20),("target_duration_seconds",75,115)):
            if type(row.get(field)) is not int or not minimum <= row[field] <= maximum:
                _fail("amended production counts must satisfy the unchanged short-drama contract.")
        try:
            plan = EpisodePlanGenerationItem.model_validate({k:v for k,v in row.items() if k in EpisodePlanGenerationItem.model_fields})
        except ValidationError as error:
            _fail("invalid execution plan: " + str(error))
        if not plan.scene_execution_plan or plan.scene_execution_plan[-1].exit_state != plan.exit_state:
            _fail("a complete scene blueprint must retain the approved episode exit.")
        # The client deliberately removes derived approvals. Recompute readiness
        # from the authored blueprint, not the legacy default for that flag.
        plan = plan.model_copy(update={"execution_ready": True})
        readiness = episode_execution_readiness_issues(plan)
        if readiness:
            _fail("execution plan is not ready: " + ", ".join(readiness))
        validate_plan_source(row, before[number])
        target = next(p for p in result['episodeRoadmaps'] if p['episode_number'] == number)
        target['execution_ready'] = True
        target['layer_contracts'] = compile_episode_three_layer_contract(plan).model_dump(mode='json')
    normalized = _indexed(result, "episodeRoadmaps", "episode_number")
    affected = sorted(n for n in episodes if n >= numbers[0])
    now = datetime.now(timezone.utc).isoformat()
    receipt = {
        "schemaVersion":1, "amendmentId":amendment_id, "appliedAt":now,
        "sourceWorkspaceRevision":source_revision, "appliedWorkspaceRevision":source_revision + 1,
        "sourcePlanningRevisionEpoch":epoch, "planningRevisionEpoch":epoch + 1,
        "episodeNumbers":numbers, "affectedEpisodeNumbers":affected, "reason":request['reason'],
        "originalRoadmaps":[deepcopy(before[n]) for n in numbers],
        "originalEpisodes":[deepcopy(episodes[n]) for n in numbers],
        "originalAudit":deepcopy(previous.get('storyTreeQualityAudit')),
        "sources":[{"episodeNumber":n, "sourceNodeId":before[n]['source_node_id'],
                    "sourceNodeVersion":before[n]['source_node_version'], "storyBibleVersion":before[n]['story_bible_version'],
                    "previousPlanHash":plan_hash(before[n]), "currentPlanHash":plan_hash(normalized[n]),
                    "previousBodyHash":body_hash(episodes[n])} for n in numbers],
        "invalidatedJobIds":[previous['activeGenerationTask']['jobId']] if previous.get('activeGenerationTask') else [],
        "requestHash":_operation_hash(candidate, REQUEST_FIELD),
    }
    result[RECEIPTS_FIELD] = [*deepcopy(previous.get(RECEIPTS_FIELD, [])), receipt]
    result.pop(REQUEST_FIELD)
    for episode in result['episodes']:
        n = episode['episodeNumber']
        if n in affected:
            episode[MARKER_FIELD] = {"amendmentId":amendment_id,
                "status":"revision_required" if n in numbers else "review_required",
                "planningRevisionEpoch":epoch + 1, "sourcePlanHash":plan_hash(normalized[n]),
                "sourceBodyHash":body_hash(episodes[n])}
    for field in ('activeGenerationTask','storyTreeQualityAudit','deliveryConfirmation'):
        result.pop(field, None)
    return result


def validate_ordinary_save(previous: dict, candidate: dict) -> None:
    before = _indexed(previous, "episodes", "episodeNumber")
    after = _indexed(candidate, "episodes", "episodeNumber")
    before_plans = _indexed(previous, "episodeRoadmaps", "episode_number")
    after_plans = _indexed(candidate, "episodeRoadmaps", "episode_number")
    for number, old in before.items():
        marker = old.get(MARKER_FIELD)
        current = after.get(number)
        if marker:
            if current is None or current.get(MARKER_FIELD) != marker:
                _fail("pending source markers can only be cleared by an explicit verified resolution.")
            if body_hash(current) != body_hash(old) or current.get("generationRun") != old.get("generationRun"):
                _fail("a pending screenplay cannot be replaced by an ordinary save.")
            if marker.get('status') == 'revision_required':
                old_plan, new_plan = before_plans.get(number), after_plans.get(number)
                if not old_plan or not new_plan or plan_hash(old_plan) != plan_hash(new_plan):
                    _fail("amended execution text requires another explicit amendment transaction.")
        elif current and current.get(MARKER_FIELD):
            _fail("source markers are server-generated.")
        elif latest_resolution(previous, number):
            if current is None or body_hash(current) != body_hash(old):
                _fail("a reviewed screenplay source requires an explicit amendment before replacing its body.")
            old_plan, new_plan = before_plans.get(number), after_plans.get(number)
            if not old_plan or not new_plan or plan_hash(old_plan) != plan_hash(new_plan):
                _fail("a reviewed screenplay source requires an explicit amendment before changing its plan.")
    if any(row.get(MARKER_FIELD) for n, row in after.items() if n not in before):
        _fail("source markers are server-generated.")
    if pending_episode_numbers(previous) and candidate.get('deliveryConfirmation') != previous.get('deliveryConfirmation') and candidate.get('deliveryConfirmation'):
        _fail("pending source changes cannot be confirmed for delivery.")


def _resolve(previous: dict, candidate: dict, *, source_revision: int, has_running_work: bool) -> dict:
    if has_running_work or (previous.get('planningRevision') or {}).get('status') == 'active':
        _fail("finish planning and running work before resolving a saved screenplay.")
    request = candidate[RESOLUTION_FIELD]
    if not isinstance(request, dict):
        _fail("invalid screenplay resolution request.")
    expected_keys = {"amendmentId", "episodeNumber", "resolution", "sourcePlanHash", "sourceBodyHash",
                     "acceptedBodyHash", "predecessorBodyHash", "evidence", "summary"}
    if set(request) != expected_keys:
        _fail("resolution must identify its source, accepted body and exact review evidence.")
    pending = pending_episode_numbers(previous)
    number = request.get('episodeNumber')
    if not pending or number != pending[0]:
        _fail("resolve affected screenplays in episode order.")
    before = _indexed(previous,'episodes','episodeNumber')
    after = _indexed(candidate,'episodes','episodeNumber')
    if set(before) != set(after):
        _fail("a resolution cannot replace the saved episode range.")
    old, new = before[number], after[number]
    marker = old[MARKER_FIELD]
    if request.get('amendmentId') != marker['amendmentId'] or new.get(MARKER_FIELD) != marker:
        _fail("resolution must retain the current server marker until acknowledgment.")
    if previous.get('planningRevisionEpoch',0) != candidate.get('planningRevisionEpoch',0):
        _fail("a screenplay resolution cannot change the planning epoch.")
    plans = _indexed(previous,'episodeRoadmaps','episode_number')
    plan = plans[number]
    if plan.get('status') != 'approved':
        _fail("approve the amended execution plan before accepting a screenplay.")
    if request.get('sourcePlanHash') != marker['sourcePlanHash'] or plan_hash(plan) != marker['sourcePlanHash']:
        _fail("the approved execution source has changed.")
    if request.get('sourceBodyHash') != marker['sourceBodyHash'] or request.get('sourceBodyHash') != body_hash(old) or request.get('acceptedBodyHash') != body_hash(new):
        _fail("source or accepted screenplay fingerprint changed.")
    predecessor = before.get(number - 1)
    if request.get('predecessorBodyHash') != (body_hash(predecessor) if predecessor else None):
        _fail("the preceding effective screenplay has changed.")
    revised = request.get('resolution') == 'revised'
    if (request.get('resolution') not in {'revised','reviewed'}
            or (revised and body_hash(old) == body_hash(new))
            or (not revised and body_hash(old) != body_hash(new))):
        _fail("a changed body requires revised adoption; an unchanged body requires explicit review.")
    # A plan amendment can bring its blueprint into line with a screenplay the
    # author already corrected. Keep the marker until this explicit operation
    # verifies the refreshed source, exact body/evidence and immutable history;
    # requiring a different body hash here would force an unrelated rewrite.
    allowed = {RESOLUTION_FIELD,'episodes','updatedAt','serverSync','deliveryContentRevision','deliveryConfirmation'}
    for field in set(previous) | set(candidate):
        if field not in allowed and previous.get(field) != candidate.get(field):
            _fail(f"a resolution cannot change unrelated workspace state ({field}).")
    for n in before:
        if n != number and before[n] != after[n]:
            _fail("a resolution may change only its selected episode.")
    if candidate.get('deliveryConfirmation'):
        _fail("resolve the source changes before confirming delivery.")
    run = new.get('generationRun') or {}
    context = run.get('episode_context') or {}
    fields = ApprovedEpisodePlanContext.model_fields
    try:
        expected = ApprovedEpisodePlanContext.model_validate({k:v for k,v in plan.items() if k in fields})
        supplied = ApprovedEpisodePlanContext.model_validate(context.get('approved_episode_plan'))
    except ValidationError:
        _fail("the accepted run must carry the current approved episode execution plan.")
    if expected != supplied or draft_hash(run.get('draft_master_script') or {}) != body_hash(new):
        _fail("the accepted run, visible draft and amended source must match.")
    node = context.get('approved_story_node') or {}
    if (node.get('node_id') != plan['source_node_id']
            or node.get('node_version') != plan['source_node_version']):
        _fail("the accepted run must carry the current approved story node.")
    evidence = request.get('evidence')
    if not isinstance(request.get('summary'),str) or len(request['summary'].strip()) < 8 or not isinstance(evidence,list) or not evidence:
        _fail("a concrete review summary and exact body evidence are required.")
    draft = episode_draft(new)
    for item in evidence:
        try:
            scene = next(s for s in draft['scenes'] if s['scene_number'] == item['sceneNumber'])
            ref = item['bodyOrderRef'];kind,index = ref.split(':');index=int(index)
            if ref not in scene['body_order']:
                raise ValueError('unknown ordered entry')
            text = scene['character_actions'][index] if kind == 'action' else scene['dialogues'][index]['text'] if kind == 'dialogue' else None
            if not isinstance(item.get('quote'),str) or not item['quote'].strip() or item['quote'] not in text:
                raise ValueError('quote mismatch')
        except (KeyError,TypeError,ValueError,StopIteration,IndexError):
            _fail("review evidence must quote an existing ordered screenplay entry.")
    result=deepcopy(candidate)
    result.pop(RESOLUTION_FIELD)
    next_episode=next(e for e in result['episodes'] if e['episodeNumber']==number)
    next_episode.pop(MARKER_FIELD)
    receipt={**deepcopy(request), 'resolvedAt':datetime.now(timezone.utc).isoformat(),
             'planningRevisionEpoch':previous.get('planningRevisionEpoch',0),
             'appliedWorkspaceRevision':source_revision+1, 'requestHash':_operation_hash(candidate,RESOLUTION_FIELD),
             'previousEpisodeSnapshot':deepcopy(old)}
    result[RESOLUTIONS_FIELD]=[*deepcopy(previous.get(RESOLUTIONS_FIELD,[])),receipt]
    return result


def require_amendment_body_operation(workspace: Mapping[str, Any], episode_number: int, epoch: int,
                                     context: object) -> None:
    """Allow an edit/review of the earliest pending body with its adopted source."""
    if epoch != workspace.get('planningRevisionEpoch', 0):
        _fail('planning revision epoch changed; reload before editing.')
    if (workspace.get('planningRevision') or {}).get('status') == 'active':
        _fail('finish the active planning revision before editing screenplay bodies.')
    pending = pending_episode_numbers(workspace)
    if not pending:
        return
    if episode_number != pending[0]:
        _fail('resolve affected screenplays in episode order before editing other episodes.')
    episodes = _indexed(workspace, 'episodes', 'episodeNumber')
    plans = _indexed(workspace, 'episodeRoadmaps', 'episode_number')
    episode, plan = episodes[episode_number], plans.get(episode_number)
    marker = episode[MARKER_FIELD]
    if not plan or plan.get('status') != 'approved' or plan_hash(plan) != marker['sourcePlanHash']:
        _fail('approve the current amended execution plan before editing a screenplay.')
    supplied = context.model_dump(mode='json') if hasattr(context, 'model_dump') else context
    try:
        expected = ApprovedEpisodePlanContext.model_validate({k:v for k,v in plan.items() if k in ApprovedEpisodePlanContext.model_fields})
        current = ApprovedEpisodePlanContext.model_validate(supplied.get('approved_episode_plan'))
        node = supplied.get('approved_story_node') or {}
        if (expected != current or node.get('node_id') != plan['source_node_id']
                or node.get('node_version') != plan['source_node_version']):
            raise ValueError('context mismatch')
    except (ValidationError, ValueError, AttributeError):
        _fail('the screenplay edit must use its current approved execution source.')
