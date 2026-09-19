"""Recover legacy reference text only when its deterministic ID proves the match."""
from hashlib import sha256

from app.modules.master_script.models import DraftMasterScript


def restore_legacy_setup_payoff_sources(draft: DraftMasterScript, approved_refs: list[str]) -> DraftMasterScript:
    matches: dict[str, set[str]] = {}
    for reference in approved_refs:
        reference = reference.strip()
        if not reference:
            continue
        identity = "generated.setup_payoff." + sha256(reference.encode("utf-8")).hexdigest()[:12]
        matches.setdefault(identity, set()).add(reference)
    updates = []
    changed = False
    for update in draft.setup_payoff_updates:
        sources = matches.get(update.setup_payoff_ref, set())
        if update.source_ref is None and len(sources) == 1:
            update = update.model_copy(update={"source_ref": next(iter(sources))})
            changed = True
        updates.append(update)
    return draft.model_copy(update={"setup_payoff_updates": updates}) if changed else draft
