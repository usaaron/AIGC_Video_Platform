from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MasterScriptFinalizationPolicy:
    policy_id: str = "master_script_finalization_policy.v1"
    finalization_version: str = "final_master_script.v1"
    minimum_re_qc_score: float = 0.65


MASTER_SCRIPT_FINALIZATION_POLICY = MasterScriptFinalizationPolicy()
