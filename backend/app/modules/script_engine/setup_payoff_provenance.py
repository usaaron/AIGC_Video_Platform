"""Resolve first setup/payoff timing without inferring story facts from prose."""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
import re

from app.modules.script_engine.models import ApprovedEpisodePlanContext, EpisodeGenerationContext, SameEpisodeSetupPayoffSource


def stable_setup_payoff_id(reference: str) -> str:
    """Preserve existing technical IDs; retain authored text separately as a ref."""
    if len(reference) <= 120 and re.fullmatch(r"[a-zA-Z0-9_.:-]+", reference):
        return reference
    return "generated.setup_payoff." + hashlib.sha256(reference.encode()).hexdigest()[:12]


def hydrate_persisted_setup_payoff_records(context: EpisodeGenerationContext | None, workspace: Mapping | None) -> None:
    """Recover identity from saved history, never from a recall capsule label.

    The compact client checkpoint may omit an open record that the writer still
    sees in task recall. Both writing and QC must use the same durable IDs.
    """
    if context is None:
        return
    context._persisted_setup_payoff_records = []
    if not workspace:
        return
    for record in workspace.get("setupPayoffs", []):
        if not isinstance(record, dict):
            continue
        reference = record.get("ref")
        first, last = record.get("setupEpisode"), record.get("lastUpdatedEpisode")
        if (not isinstance(reference, str) or not reference.strip()
                or type(first) is not int or not 0 < first < context.episode_number
                or type(last) is not int or not first <= last < context.episode_number):
            continue
        context._persisted_setup_payoff_records.append({
            "setup_payoff_id": stable_setup_payoff_id(reference),
            "source_ref": reference,
            "setup_episode": first,
            "status": record.get("status"),
        })


def _key(value: object) -> str:
    return str(value or "").strip().casefold()


def _refs(row: Mapping, field: str) -> set[str]:
    return {_key(value) for value in row.get(field, []) if isinstance(value, str)}


def same_episode_setup_payoff_sources(workspace: Mapping, episode_number: int, story_bible_version: int) -> list[SameEpisodeSetupPayoffSource]:
    """Require a complete current approved prefix and no earlier actual setup."""
    rows = [row for row in workspace.get("episodeRoadmaps", []) if isinstance(row, dict)
            and row.get("story_bible_version") == story_bible_version]
    latest: dict[str, int] = {}
    for row in rows:
        node, version = row.get("source_node_id"), row.get("source_node_version")
        if isinstance(node, str) and type(version) is int:
            latest[node] = max(latest.get(node, 0), version)
    prefix: dict[int, dict] = {}
    for number in range(1, episode_number + 1):
        current = [row for row in rows if row.get("episode_number") == number
                   and row.get("source_node_version") == latest.get(row.get("source_node_id"))]
        if len(current) != 1 or current[0].get("status") != "approved" or current[0].get("source_revision_review"):
            return []
        prefix[number] = current[0]
    current = prefix[episode_number]
    earlier_refs = set().union(*(_refs(row, "setup_refs") | _refs(row, "payoff_refs")
                                 for number, row in prefix.items() if number < episode_number))
    for record in workspace.get("setupPayoffs", []):
        if not isinstance(record, dict):
            continue
        times = [record.get("setupEpisode"), record.get("lastUpdatedEpisode"), record.get("payoffEpisode")]
        times += [change.get("episodeNumber") for change in record.get("history", []) if isinstance(change, dict)]
        if any(type(number) is int and 0 <= number < episode_number for number in times):
            earlier_refs.add(_key(record.get("ref")))
    # Check the saved bodies too: a damaged or missing derived projection must
    # not make an actual earlier setup appear to be a first introduction.
    for episode in workspace.get("episodes", []):
        if not isinstance(episode, dict) or not 0 < episode.get("episodeNumber", 0) < episode_number:
            continue
        payloads = [(episode.get("generationRun") or {}).get("draft_master_script"),
                    (episode.get("finalizationResult") or {}).get("master_script")]
        for field in ("workingDraftJson", "confirmedDraftJson"):
            try:
                payloads.append(json.loads(episode.get(field) or "null"))
            except (TypeError, ValueError):
                pass
        for draft in payloads:
            if isinstance(draft, dict):
                earlier_refs.update(_key(update.get("source_ref") or update.get("setup_payoff_ref") or update.get("setup_payoff_id"))
                                    for update in draft.get("setup_payoff_updates", []) if isinstance(update, dict))
    def seen_before(reference: str) -> bool:
        parts = {_key(part) for part in re.split(r"[,，;；\s]+", reference) if part}
        # Old normalizers split prose refs. Conservatively recognize a complete
        # old fragment group without rewriting any approved source text.
        return _key(reference) in earlier_refs or len(parts) > 1 and parts <= earlier_refs

    eligible = (_refs(current, "setup_refs") & _refs(current, "payoff_refs")) - earlier_refs
    return [SameEpisodeSetupPayoffSource(
        setup_payoff_ref=reference, episode_number=episode_number,
        source_node_id=current["source_node_id"], source_node_version=current["source_node_version"],
        story_bible_version=story_bible_version,
    ) for reference in dict.fromkeys(current.get("setup_refs", [])) if _key(reference) in eligible and not seen_before(reference)]


def validate_same_episode_setup_payoff_sources(context: EpisodeGenerationContext | None, workspace: Mapping | None) -> None:
    if context is None:
        return
    context._verified_same_episode_setup_payoff_refs = set()
    claims = context.memory_recall.same_episode_setup_payoffs if context.memory_recall else []
    if not claims:
        return
    failure = "本集伏笔建立与兑现的批准来源已变化或无法核验，请刷新当前规划后重试。"
    if not workspace or (workspace.get("planningRevision") or {}).get("status") == "active":
        raise ValueError(failure)
    version = workspace.get("storyBibleVersion")
    if type(version) is not int or not context.approved_episode_plan or not context.approved_story_node:
        raise ValueError(failure)
    expected = same_episode_setup_payoff_sources(workspace, context.episode_number, version)
    expected_by_ref = {item.setup_payoff_ref: item for item in expected}
    if len({item.setup_payoff_ref for item in claims}) != len(claims) or any(expected_by_ref.get(item.setup_payoff_ref) != item for item in claims):
        raise ValueError(failure)
    current = next((row for row in workspace.get("episodeRoadmaps", [])
                    if row.get("episode_number") == context.episode_number
                    and row.get("source_node_id") == claims[0].source_node_id
                    and row.get("source_node_version") == claims[0].source_node_version
                    and row.get("story_bible_version") == version), None)
    if current is None:
        raise ValueError(failure)
    approved = ApprovedEpisodePlanContext.model_validate({key: value for key, value in current.items()
                                                        if key in ApprovedEpisodePlanContext.model_fields})
    node = context.approved_story_node
    if (approved != context.approved_episode_plan or node.node_id != current["source_node_id"]
            or node.node_version != current["source_node_version"]):
        raise ValueError(failure)
    refs = {item.setup_payoff_ref for item in claims}
    if not refs <= set(context.planned_setup_refs) & set(context.planned_payoff_refs):
        raise ValueError(failure)
    context._verified_same_episode_setup_payoff_refs = refs
