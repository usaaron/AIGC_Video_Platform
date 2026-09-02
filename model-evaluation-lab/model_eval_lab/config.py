from __future__ import annotations

from dataclasses import dataclass
import os
from urllib.parse import urlparse


STAGE_ENV_NAMES = {
    "outline": "OUTLINE",
    "story_tree": "STORY_TREE",
    "episode_roadmap": "EPISODE_ROADMAP",
    "screenplay": "SCREENPLAY",
}


@dataclass(frozen=True)
class EvaluationModelConfig:
    id: str
    stage: str
    label: str
    provider: str
    model: str
    api_key: str
    base_url: str
    wire_api: str
    reasoning_effort: str | None
    thinking_mode: str | None
    timeout_seconds: int
    max_retries: int
    max_tokens: int
    temperature: float

    @property
    def configured(self) -> bool:
        return bool(
            self.model.strip()
            and self.api_key.strip()
            and self.base_url.strip()
            and "your-" not in self.model.casefold()
            and "provider.example" not in self.base_url.casefold()
        )

    def public_dict(self) -> dict[str, object]:
        parsed = urlparse(self.base_url)
        route = parsed.netloc or self.base_url or "待填写"
        return {
            "id": self.id,
            "label": self.label,
            "provider": self.provider,
            "model": self.model or "待填写模型",
            "route": route,
            "wire_api": self.wire_api,
            "reasoning_effort": self.reasoning_effort,
            "thinking_mode": self.thinking_mode,
            "timeout_seconds": self.timeout_seconds,
            "configured": self.configured,
        }


def load_stage_models(stage: str) -> list[EvaluationModelConfig]:
    stage_env = STAGE_ENV_NAMES.get(stage)
    if stage_env is None:
        raise ValueError(f"Unknown evaluation stage: {stage}")
    models: list[EvaluationModelConfig] = []
    # The evaluation lab is intentionally limited to the five A-E slots.
    for index in range(1, 6):
        prefix = f"EVAL_{stage_env}_MODEL_{index:02d}"
        fields = {
            suffix: os.getenv(f"{prefix}_{suffix}", "").strip()
            for suffix in (
                "LABEL",
                "PROVIDER",
                "MODEL",
                "API_KEY",
                "BASE_URL",
                "WIRE_API",
                "REASONING_EFFORT",
                "THINKING_MODE",
            )
        }
        if not any(fields.values()):
            continue
        if not _env_flag(f"{prefix}_ENABLED", default=True):
            continue
        models.append(
            EvaluationModelConfig(
                id=f"{stage}.model.{index:02d}",
                stage=stage,
                label=fields["LABEL"] or f"模型 {index}",
                provider=fields["PROVIDER"] or "openai_compatible",
                model=fields["MODEL"],
                api_key=fields["API_KEY"],
                base_url=fields["BASE_URL"].rstrip("/"),
                wire_api=fields["WIRE_API"] or "chat_completions",
                reasoning_effort=fields["REASONING_EFFORT"] or None,
                thinking_mode=fields["THINKING_MODE"] or None,
                timeout_seconds=_bounded_int(
                    f"{prefix}_TIMEOUT_SECONDS", default=600, minimum=10, maximum=3600
                ),
                max_retries=_bounded_int(
                    f"{prefix}_MAX_RETRIES", default=0, minimum=0, maximum=3
                ),
                max_tokens=_bounded_int(
                    f"{prefix}_MAX_TOKENS", default=12000, minimum=128, maximum=32000
                ),
                temperature=_bounded_float(
                    f"{prefix}_TEMPERATURE", default=0.7, minimum=0.0, maximum=2.0
                ),
            )
        )
    return models


def load_all_models() -> dict[str, list[EvaluationModelConfig]]:
    return {stage: load_stage_models(stage) for stage in STAGE_ENV_NAMES}


def _bounded_int(name: str, *, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, "").strip()
    try:
        value = int(raw) if raw else default
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _bounded_float(
    name: str,
    *,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    raw = os.getenv(name, "").strip()
    try:
        value = float(raw) if raw else default
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _env_flag(name: str, *, default: bool) -> bool:
    raw = os.getenv(name, "").strip().casefold()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}
