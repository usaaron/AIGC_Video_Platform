"""Model-specific wire parameters shared by every generation role."""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelProtocol:
    family: str
    model_name: str

    @classmethod
    def identify(cls, provider: str, model_name: str) -> "ModelProtocol":
        identity = f"{model_name} {provider}".casefold()
        for family in ("deepseek", "glm", "qwen", "gemini"):
            if re.search(rf"(?:^|[^a-z0-9]){family}(?:[^a-z]|$)", identity):
                return cls(family, model_name.casefold())
        if re.search(r"(?:^|[^a-z0-9])(?:gpt-[56]|o[134])", identity):
            return cls("openai_reasoning", model_name.casefold())
        return cls("compatible", model_name.casefold())

    @property
    def requires_thinking(self) -> bool:
        return (
            self.family == "glm" and self.model_name.startswith("glm-5.3")
        ) or (
            self.family == "gemini"
            and (self.model_name.startswith("gemini-3") or "2.5-pro" in self.model_name)
        )

    def thinking_mode(self, requested: str | None, effort: str | None) -> str:
        if self.requires_thinking:
            return "enabled"
        return requested or ("disabled" if effort == "none" else "enabled")

    def reasoning_effort(self, requested: str | None, thinking: str | None) -> str | None:
        disabled = thinking == "disabled" or requested == "none"
        if self.family == "deepseek":
            if disabled:
                return "none"
            return {"minimal": "low", "medium": "high", "xhigh": "high"}.get(
                requested, requested
            )
        if self.family == "glm" and self.requires_thinking:
            if disabled:
                return "low"
            return {"minimal": "low", "medium": "high", "xhigh": "max"}.get(
                requested, requested
            )
        if self.family == "gemini":
            if disabled:
                return "minimal" if self.requires_thinking else "none"
            return {"max": "high", "xhigh": "high"}.get(requested, requested)
        if self.family in {"glm", "qwen"}:
            return "none" if disabled else requested
        # OpenAI uses reasoning.effort; legacy thinking switches belong to
        # other providers and must not override an explicitly configured effort.
        return requested

    @property
    def chat_token_limit_key(self) -> str:
        return "max_completion_tokens" if self.family == "openai_reasoning" else "max_tokens"

    def chat_response_format_type(self, *, strict: bool, thinking: str | None) -> str | None:
        if self.family == "deepseek":
            # V4 supports JSON output with thinking, but not OpenAI's json_schema.
            # Keep the older reasoner compatibility path for legacy profiles.
            if thinking == "enabled" and not (
                self.model_name.startswith("deepseek-v4-")
                or self.model_name == "deepseek-flash"
            ):
                return None
            return "json_object"
        if self.family == "glm" and thinking == "enabled":
            return None
        return "json_schema" if strict else "json_object"
