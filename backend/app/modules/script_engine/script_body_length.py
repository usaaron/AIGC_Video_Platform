from dataclasses import dataclass


PREFERRED_MIN_RATIO = 0.70
PREFERRED_MAX_RATIO = 1.40
# The preferred minimum is the usable lower edge. Only an extreme shortfall is
# treated as transport/model truncation; plot-complete scripts are never padded
# merely to hit the baseline.
TRUNCATION_FLOOR_RATIO = 0.25


@dataclass(frozen=True)
class ScriptBodyLengthGuidance:
    reference_characters: int
    preferred_min_characters: int
    preferred_max_characters: int
    truncation_floor_characters: int


def script_body_length_guidance(reference_characters: int) -> ScriptBodyLengthGuidance:
    """Turn a series-average reference into broad, plot-first episode guardrails."""
    reference = max(1, round(reference_characters))
    return ScriptBodyLengthGuidance(
        reference_characters=reference,
        preferred_min_characters=max(1, round(reference * PREFERRED_MIN_RATIO)),
        preferred_max_characters=max(1, round(reference * PREFERRED_MAX_RATIO)),
        truncation_floor_characters=max(1, round(reference * TRUNCATION_FLOOR_RATIO)),
    )
