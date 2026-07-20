from __future__ import annotations

from dataclasses import dataclass

from app.modules.script_engine.models import RevisionPolicy


@dataclass(frozen=True)
class MasterScriptFinalizationPolicy:
    policy_id: str = "master_script_finalization_policy.v1"
    finalization_version: str = "final_master_script.v1"
    minimum_re_qc_score: float = 0.65


MASTER_SCRIPT_FINALIZATION_POLICY = MasterScriptFinalizationPolicy()


# Observational thresholds only; shadow acceptance does not gate finalization.
REVISION_ACCEPTANCE_SHADOW_POLICY = RevisionPolicy(
    policy_version="revision_acceptance_shadow_policy.v1",
    max_revision_rounds=1,
    minimum_improvement_threshold=0.05,
    acceptance_threshold=0.65,
    regression_limit=0,
    dimension_regression_tolerance=0.01,
)
