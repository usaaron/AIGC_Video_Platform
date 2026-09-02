from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from app.modules.script_engine.long_story_models import (
    ContinuityCharacterState,
    ContinuityEntityAlias,
    ContinuityLedger,
    ContinuityKnowledgeState,
    ContinuityRelationshipState,
    ContinuityStoryLineState,
    ContinuityTimelineEvent,
    ContinuityWorldState,
    EpisodeArtifact,
    EpisodeArtifactKind,
    EpisodeContinuitySummary,
    MemoryLayer,
    NarrativeEvent,
    NarrativeEventSet,
    NarrativeEventSetStatus,
    NarrativeEventType,
    SetupPayoffRecord,
    SetupPayoffStatus,
    StoryBible,
    StoryLineStatus,
)


def project_episode_artifact_to_ledger(
    *,
    artifact: EpisodeArtifact,
    story_bible: StoryBible,
    previous: ContinuityLedger | None,
) -> ContinuityLedger:
    """Apply one confirmed episode artifact to an immutable continuity checkpoint."""

    payload = artifact.content_payload
    episode_number = artifact.episode_number
    character_states = {
        item.character_ref: item
        for item in (previous.character_states if previous else [])
    }
    relationship_states = {
        item.relationship_id: item
        for item in (previous.relationship_states if previous else [])
    }
    story_line_states = {
        item.story_line_id: item
        for item in (previous.story_line_states if previous else [])
    }
    world_states = {
        (item.entity_key, item.state_domain): item
        for item in (previous.world_states if previous else [])
    }
    aliases = {
        (item.entity_type, _normalize_name(item.alias)): item
        for item in (previous.entity_aliases if previous else [])
    }
    for item in story_bible.character_registry:
        aliases.setdefault(
            ("character", _normalize_name(item.name)),
            ContinuityEntityAlias(
                canonical_entity_key=item.character_ref,
                alias=item.name,
                entity_type="character",
                source="story_bible",
                last_seen_episode=0,
            ),
        )

    if not relationship_states:
        relationship_states = {
            item.relationship_id: ContinuityRelationshipState(
                relationship_id=item.relationship_id,
                source_character_ref=item.source_character_ref,
                target_character_ref=item.target_character_ref,
                current_state=item.initial_state,
                last_changed_episode=0,
            )
            for item in story_bible.relationships
        }
    if not story_line_states:
        story_line_states = {
            item.story_line_id: ContinuityStoryLineState(
                story_line_id=item.story_line_id,
                status=StoryLineStatus.setup,
                current_state=item.premise,
                last_progressed_episode=0,
                next_required_step=item.planned_resolution,
            )
            for item in story_bible.story_lines
        }

    character_refs_by_name = {
        _normalize_name(item.name): item.character_ref
        for item in story_bible.character_registry
    }
    for update in payload.get("character_state_updates", []):
        if not isinstance(update, dict):
            continue
        name = str(update.get("character_name", "")).strip()
        if not name:
            continue
        character_ref = character_refs_by_name.get(_normalize_name(name))
        if character_ref is None:
            character_ref = f"character.generated.{_short_hash(name)}"
        alias_key = ("character", _normalize_name(name))
        aliases[alias_key] = ContinuityEntityAlias(
            canonical_entity_key=character_ref,
            alias=name,
            entity_type="character",
            source=(
                "story_bible"
                if character_ref in character_refs_by_name.values()
                else "generated"
            ),
            last_seen_episode=episode_number,
        )
        prior = character_states.get(character_ref)
        character_states[character_ref] = _project_character_state(
            character_ref=character_ref,
            update=update,
            prior=prior,
            episode_number=episode_number,
        )

    character_refs_by_name.update({
        _normalize_name(item.alias): item.canonical_entity_key
        for item in aliases.values()
        if item.entity_type == "character"
    })
    relationships_by_pair = {
        frozenset((item.source_character_ref, item.target_character_ref)): item
        for item in relationship_states.values()
    }
    for update in payload.get("relationship_state_updates", []):
        if not isinstance(update, dict):
            continue
        source_name = str(update.get("source_character_name", "")).strip()
        target_name = str(update.get("target_character_name", "")).strip()
        if not source_name or not target_name:
            continue
        source_ref = _relationship_character_ref(
            source_name,
            character_refs_by_name=character_refs_by_name,
            aliases=aliases,
            episode_number=episode_number,
        )
        target_ref = _relationship_character_ref(
            target_name,
            character_refs_by_name=character_refs_by_name,
            aliases=aliases,
            episode_number=episode_number,
        )
        if source_ref == target_ref:
            continue
        pair = frozenset((source_ref, target_ref))
        prior = relationships_by_pair.get(pair)
        relationship_id = (
            prior.relationship_id
            if prior
            else f"relationship.generated.{_short_hash('|'.join(sorted(pair)))}"
        )
        state = ContinuityRelationshipState(
            relationship_id=relationship_id,
            source_character_ref=(prior.source_character_ref if prior else source_ref),
            target_character_ref=(prior.target_character_ref if prior else target_ref),
            current_state=_relationship_current_state(
                update,
                source_name=source_name,
                target_name=target_name,
            ),
            last_changed_episode=episode_number,
        )
        relationship_states[relationship_id] = state
        relationships_by_pair[pair] = state

    for update in payload.get("story_line_updates", []):
        if not isinstance(update, dict):
            continue
        story_line_id = str(update.get("story_line_id", "")).strip()
        if not story_line_id:
            continue
        story_line_states[story_line_id] = ContinuityStoryLineState(
            story_line_id=story_line_id,
            status=StoryLineStatus(str(update.get("status", "active"))),
            current_state=str(update.get("progress_summary", "")).strip(),
            last_progressed_episode=episode_number,
            last_contribution_type=str(
                update.get("contribution_type", "progress")
            ).strip(),
            planned_alignment=str(
                update.get("planned_alignment", "aligned")
            ).strip(),
            next_required_step=_optional_text(update.get("next_required_step")),
            last_evidence_scene_numbers=_int_list(
                update.get("evidence_scene_numbers")
            ),
        )

    for update in payload.get("continuity_state_updates", []):
        if not isinstance(update, dict):
            continue
        entity_type = str(update.get("entity_type", "")).strip()
        entity_name = str(update.get("entity_name", "")).strip()
        alias_key = (entity_type, _normalize_name(entity_name))
        existing_alias = aliases.get(alias_key)
        entity_key = (
            existing_alias.canonical_entity_key
            if existing_alias
            else str(update.get("entity_key", "")).strip()
        )
        aliases[alias_key] = ContinuityEntityAlias(
            canonical_entity_key=entity_key,
            alias=entity_name,
            entity_type=entity_type,
            source="generated",
            last_seen_episode=episode_number,
        )
        state = ContinuityWorldState(
            entity_key=entity_key,
            entity_type=entity_type,
            entity_name=entity_name,
            state_domain=str(update.get("state_domain", "")).strip(),
            current_state=str(update.get("current_state", "")).strip(),
            persistence=str(update.get("persistence", "")).strip(),
            future_constraint=_optional_text(update.get("future_constraint")),
            last_transition=str(update.get("transition", "")).strip(),
            change_cause=str(update.get("change_cause", "")).strip(),
            evidence_episode_number=episode_number,
            evidence_scene_numbers=_int_list(update.get("evidence_scene_numbers")),
        )
        world_states[(state.entity_key, state.state_domain)] = state

    setup_payoffs = _project_setup_payoffs(
        list(previous.setup_payoffs if previous else []),
        payload.get("setup_payoff_updates"),
        episode_number,
    )
    setup_payoffs = _project_hooks(
        setup_payoffs,
        payload.get("continuation_hook"),
        episode_number,
    )
    consequences = _episode_consequences(payload)
    summary = EpisodeContinuitySummary(
        episode_number=episode_number,
        entry_state=(
            previous.recent_episode_summaries[-1].exit_state
            if previous and previous.recent_episode_summaries
            else "从已批准总纲和人物固定设定进入本集。"
        ),
        exit_state=_episode_exit_state(payload),
        consequences=consequences,
        new_fact_ids=[],
    )
    summaries = {
        item.episode_number: item
        for item in (previous.recent_episode_summaries if previous else [])
    }
    summaries[episode_number] = summary
    timeline = {
        item.event_id: item for item in (previous.timeline if previous else [])
    }
    timeline[f"timeline.episode_{episode_number:04d}"] = ContinuityTimelineEvent(
        event_id=f"timeline.episode_{episode_number:04d}",
        episode_number=episode_number,
        sequence_order=episode_number,
        summary=_episode_exit_state(payload),
    )

    return ContinuityLedger(
        ledger_id=(
            previous.ledger_id
            if previous
            else f"ledger.{_short_hash(artifact.story_project_id)}"
        ),
        story_project_id=artifact.story_project_id,
        story_bible_id=story_bible.story_bible_id,
        story_bible_version=story_bible.version,
        version=(previous.version + 1 if previous else 1),
        through_episode_number=max(
            episode_number,
            previous.through_episode_number if previous else 0,
        ),
        character_states=list(character_states.values()),
        relationship_states=list(relationship_states.values()),
        story_line_states=list(story_line_states.values()),
        world_states=list(world_states.values()),
        entity_aliases=list(aliases.values()),
        canonical_facts=list(previous.canonical_facts if previous else []),
        setup_payoffs=setup_payoffs,
        timeline=sorted(timeline.values(), key=lambda item: item.episode_number),
        recent_episode_summaries=sorted(
            summaries.values(), key=lambda item: item.episode_number
        )[-20:],
        warnings=list(previous.warnings if previous else []),
        source_artifact_id=artifact.artifact_id,
        updated_at=datetime.now(timezone.utc),
    )


def project_narrative_event_set_to_ledger(
    *,
    event_set: NarrativeEventSet,
    events: list[NarrativeEvent],
    story_bible: StoryBible,
    previous: ContinuityLedger | None,
) -> ContinuityLedger:
    """Replay a canonical event set through the existing ledger projector."""

    if event_set.memory_layer != MemoryLayer.canonical:
        raise ValueError("Only canonical event sets can update the continuity ledger.")
    if event_set.status != NarrativeEventSetStatus.validated:
        raise ValueError("Only validated event sets can update the continuity ledger.")
    if {event.event_id for event in events} != set(event_set.event_ids):
        raise ValueError("Narrative Event Set events do not match event_ids.")
    if any(
        event.event_set_id != event_set.event_set_id
        or event.source_artifact_id != event_set.source_artifact_id
        or event.story_project_id != event_set.story_project_id
        or event.episode_number != event_set.episode_number
        for event in events
    ):
        raise ValueError("Narrative events must share their event set source identity.")
    event_hash = hashlib.sha256(
        json.dumps(
            [
                event.model_dump(mode="json")
                for event in sorted(events, key=lambda item: item.sequence_order)
            ],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    if event_hash != event_set.content_hash:
        raise ValueError("Narrative Event Set content hash does not match its events.")

    payload: dict[str, Any] = {
        "character_state_updates": [],
        "relationship_state_updates": [],
        "continuity_state_updates": [],
        "story_line_updates": [],
        "setup_payoff_updates": [],
    }
    for event in sorted(events, key=lambda item: item.sequence_order):
        mutation = dict(event.state_mutation or {})
        if event.event_type == NarrativeEventType.episode_summary:
            payload["synopsis"] = event.summary
        elif event.event_type == NarrativeEventType.character_state_changed:
            payload["character_state_updates"].append(mutation)
        elif event.event_type == NarrativeEventType.relationship_state_changed:
            payload["relationship_state_updates"].append(mutation)
        elif event.event_type == NarrativeEventType.world_state_changed:
            payload["continuity_state_updates"].append(mutation)
        elif event.event_type == NarrativeEventType.story_line_progressed:
            payload["story_line_updates"].append(mutation)
        elif event.event_type == NarrativeEventType.setup_payoff_updated:
            payload["setup_payoff_updates"].append(mutation)
        elif event.event_type == NarrativeEventType.hook_emitted:
            payload["continuation_hook"] = mutation

    payload.setdefault(
        "synopsis",
        f"Canonical event set accepted for episode {event_set.episode_number}.",
    )
    payload_size = len(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    )
    bridge_artifact = EpisodeArtifact(
        artifact_id=event_set.source_artifact_id,
        story_project_id=event_set.story_project_id,
        episode_number=event_set.episode_number,
        artifact_kind=EpisodeArtifactKind.final,
        memory_layer=MemoryLayer.canonical,
        content_schema_version="narrative_event_projection.v1",
        content_payload=payload,
        artifact_version=event_set.source_artifact_version,
        payload_checksum=event_set.content_hash,
        payload_size_bytes=max(2, min(payload_size, 5_000_000)),
        created_at=event_set.created_at,
    )
    return project_episode_artifact_to_ledger(
        artifact=bridge_artifact,
        story_bible=story_bible,
        previous=previous,
    )


def _project_character_state(
    *,
    character_ref: str,
    update: dict[str, Any],
    prior: ContinuityCharacterState | None,
    episode_number: int,
) -> ContinuityCharacterState:
    prior_knowledge = list(prior.current_knowledge if prior else [])
    current_knowledge = _unique_recent(
        [*prior_knowledge, *_string_list(update.get("knowledge_changes"))],
        100,
    )
    knowledge_states = {
        item.knowledge_key: item
        for item in (prior.knowledge_states if prior else [])
    }
    for item in update.get("knowledge_states") or []:
        if isinstance(item, dict) and item.get("knowledge_key"):
            knowledge_state = ContinuityKnowledgeState(
                knowledge_key=str(item["knowledge_key"]),
                statement=str(item.get("statement", "")).strip(),
                status=str(item.get("status", "known")),
            )
            knowledge_states[knowledge_state.knowledge_key] = knowledge_state
    return ContinuityCharacterState(
        character_ref=character_ref,
        current_goal=str(update.get("current_goal") or (prior.current_goal if prior else "延续当前目标")).strip(),
        emotional_state=str(update.get("emotional_state") or (prior.emotional_state if prior else "状态稳定")).strip(),
        belief_or_attitude=_updated_optional(update, "belief_or_attitude", prior),
        life_status=_updated_optional(update, "life_status", prior),
        physical_state=_updated_optional(update, "physical_state", prior),
        location=_updated_optional(update, "location", prior),
        current_knowledge=current_knowledge,
        knowledge_states=list(knowledge_states.values())[-50:],
        health_conditions=_updated_list(update, "health_conditions", prior),
        action_capabilities=_updated_list(update, "action_capabilities", prior),
        lasting_marks=_updated_list(update, "lasting_marks", prior),
        active_constraints=_string_list(update.get("active_constraints")) or (
            list(prior.active_constraints) if prior else []
        ),
        personality_development=(
            _optional_text(update.get("personality_change"))
            or (prior.personality_development if prior else None)
        ),
        latest_change_summary=_optional_text(update.get("change_summary")),
        latest_change_cause=_optional_text(update.get("change_cause")),
        evidence_scene_numbers=_int_list(update.get("evidence_scene_numbers")),
        last_updated_episode=episode_number,
    )


def _project_hooks(
    existing: list[SetupPayoffRecord],
    raw_hook: Any,
    episode_number: int,
) -> list[SetupPayoffRecord]:
    if not isinstance(raw_hook, dict):
        return existing
    records = list(existing)
    response_summary = _optional_text(raw_hook.get("previous_hook_response"))
    if response_summary:
        responds_to_episode = raw_hook.get("responds_to_episode")
        matching_index = next((
            index
            for index in range(len(records) - 1, -1, -1)
            if records[index].status == SetupPayoffStatus.setup
            and (
                responds_to_episode is None
                or records[index].setup_episode == responds_to_episode
            )
        ), None)
        if matching_index is not None:
            records[matching_index] = records[matching_index].model_copy(
                update={
                    "status": SetupPayoffStatus.paid_off,
                    "payoff_episode": episode_number,
                    "response_summary": response_summary,
                    "response_evidence_scene_numbers": _int_list(
                        raw_hook.get("response_evidence_scene_numbers")
                    ),
                }
            )
    hook_id = f"hook.episode_{episode_number:04d}"
    ending_summary = str(raw_hook.get("ending_hook_summary", "")).strip()
    obligation = str(raw_hook.get("next_episode_obligation", "")).strip()
    if ending_summary and obligation:
        record = SetupPayoffRecord(
            setup_payoff_id=hook_id,
            description=f"{ending_summary}；后续义务：{obligation}",
            hook_type=_optional_text(raw_hook.get("ending_hook_type")),
            next_episode_obligation=obligation,
            status=SetupPayoffStatus.setup,
            setup_episode=episode_number,
            target_payoff_episode=raw_hook.get("target_payoff_episode"),
        )
        records = [item for item in records if item.setup_payoff_id != hook_id]
        records.append(record)
    return records[-500:]


def _project_setup_payoffs(
    existing: list[SetupPayoffRecord],
    raw_updates: Any,
    episode_number: int,
) -> list[SetupPayoffRecord]:
    records = {item.setup_payoff_id: item for item in existing}
    if not isinstance(raw_updates, list):
        return list(records.values())
    for update in raw_updates:
        if not isinstance(update, dict):
            continue
        setup_payoff_ref = str(update.get("setup_payoff_ref", "")).strip()
        if not setup_payoff_ref:
            continue
        prior = records.get(setup_payoff_ref)
        action = str(update.get("action", "setup")).strip()
        paid_off = action == "payoff" or update.get("status") == "paid_off"
        records[setup_payoff_ref] = SetupPayoffRecord(
            setup_payoff_id=setup_payoff_ref,
            description=str(update.get("progress_summary", "")).strip(),
            status=(SetupPayoffStatus.paid_off if paid_off else SetupPayoffStatus.setup),
            setup_episode=(prior.setup_episode if prior and prior.setup_episode else episode_number),
            target_payoff_episode=(
                update.get("target_payoff_episode")
                if update.get("target_payoff_episode") is not None
                else prior.target_payoff_episode if prior else None
            ),
            payoff_episode=episode_number if paid_off else None,
            response_summary=(
                str(update.get("progress_summary", "")).strip() if paid_off else None
            ),
            response_evidence_scene_numbers=(
                _int_list(update.get("evidence_scene_numbers")) if paid_off else []
            ),
            next_episode_obligation=_optional_text(update.get("next_required_step")),
        )
    return list(records.values())[-500:]


def _episode_consequences(payload: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for update in payload.get("character_state_updates", []):
        if isinstance(update, dict):
            values.append(str(update.get("change_summary", "")).strip())
    for update in payload.get("story_line_updates", []):
        if isinstance(update, dict):
            values.append(str(update.get("progress_summary", "")).strip())
    for update in payload.get("continuity_state_updates", []):
        if isinstance(update, dict):
            values.append(str(update.get("current_state", "")).strip())
    for update in payload.get("relationship_state_updates", []):
        if isinstance(update, dict):
            values.append(str(update.get("change_summary", "")).strip())
    return _unique_recent([value for value in values if value], 20) or [
        _episode_exit_state(payload)
    ]


def _episode_exit_state(payload: dict[str, Any]) -> str:
    return str(
        payload.get("synopsis")
        or payload.get("episode_goal")
        or payload.get("next_episode_question")
        or "本集完成可追溯的剧情推进。"
    ).strip()[:1_000]


def _updated_optional(
    update: dict[str, Any],
    field: str,
    prior: ContinuityCharacterState | None,
) -> str | None:
    if field in update and update[field] is not None:
        return _optional_text(update[field])
    return getattr(prior, field) if prior else None


def _relationship_character_ref(
    name: str,
    *,
    character_refs_by_name: dict[str, str],
    aliases: dict[tuple[str, str], ContinuityEntityAlias],
    episode_number: int,
) -> str:
    normalized_name = _normalize_name(name)
    character_ref = character_refs_by_name.get(normalized_name)
    if character_ref is None:
        character_ref = f"character.generated.{_short_hash(name)}"
        character_refs_by_name[normalized_name] = character_ref
    aliases[("character", normalized_name)] = ContinuityEntityAlias(
        canonical_entity_key=character_ref,
        alias=name,
        entity_type="character",
        source=(
            "story_bible"
            if not character_ref.startswith("character.generated.")
            else "generated"
        ),
        last_seen_episode=episode_number,
    )
    return character_ref


def _relationship_current_state(
    update: dict[str, Any],
    *,
    source_name: str,
    target_name: str,
) -> str:
    values = [
        str(update.get("relationship_type", "")).strip(),
        f"{source_name}->{target_name}：{str(update.get('source_to_target', '')).strip()}",
        f"{target_name}->{source_name}：{str(update.get('target_to_source', '')).strip()}",
        f"当前：{str(update.get('current_state', '')).strip()}",
        f"变化：{str(update.get('change_summary', '')).strip()}",
        f"原因：{str(update.get('change_cause', '')).strip()}",
    ]
    return "；".join(value for value in values if value and not value.endswith("："))[:500]


def _updated_list(
    update: dict[str, Any],
    field: str,
    prior: ContinuityCharacterState | None,
) -> list[str]:
    if field in update and update[field] is not None:
        return _string_list(update[field])
    return list(getattr(prior, field)) if prior else []


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _int_list(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(int(item) for item in value))


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _unique_recent(values: list[str], limit: int) -> list[str]:
    unique: dict[str, str] = {}
    for value in values:
        text = value.strip()
        if text:
            unique[text.casefold()] = text
    return list(unique.values())[-limit:]


def _normalize_name(value: str) -> str:
    return "".join(value.split()).casefold()


def _short_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]
