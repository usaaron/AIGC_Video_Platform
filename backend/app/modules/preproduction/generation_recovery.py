"""One source-preserving retry for an explicitly truncated scene proposal."""
from __future__ import annotations

import json
import logging

from app.modules.script_engine.llm_adapter import (
    LLMRequestError, LLMStructuredOutputError, bind_deepseek_output_recovery,
)

logger = logging.getLogger(__name__)


def storyboard_output_truncated(error: Exception) -> bool:
    termination = str(getattr(error, "stream_termination", "") or "").casefold()
    supported_error = isinstance(error, LLMStructuredOutputError) or (
        isinstance(error, LLMRequestError) and error.category == "empty_response"
    )
    return (
        supported_error
        and not getattr(error, "refusal", None)
        and any(marker in termination for marker in ("length", "max_output", "max_tokens", "token_limit"))
        and not any(marker in termination for marker in ("refusal", "content_filter", "failed"))
    )


def generate_scene_output(*, adapter, prompt: str, strategy, schema: dict) -> dict:
    try:
        return adapter.generate_structured_output_stream(prompt, strategy=strategy, output_schema=schema)
    except (LLMRequestError, LLMStructuredOutputError) as error:
        model_info = getattr(adapter, "get_model_info", None)
        if (not storyboard_output_truncated(error) or not callable(model_info)
                or "deepseek" not in model_info().model_name.casefold()):
            raise
        # Keep the entire source and director contract authoritative. The
        # partial proposal is reference material, never an accepted scene.
        partial = getattr(error, "raw_content", None) or ""
        recovery_prompt = (
            prompt + "\n\n本场输出达到模型长度上限，以下是未保存的截断候选。"
            "这是本次唯一一次完整输出恢复。保留上方原请求的全部正文、引用顺序、摄影和导演约束；"
            "保留截断候选中与正文一致的可用设计，补全整场，不将残缺片段视为已通过方案。"
            "只返回同一Schema要求的完整JSON，不能删减原文引用、改写对白或新增剧情以缩短输出。\n"
            + json.dumps({"incomplete_proposal": partial}, ensure_ascii=False)
        )
        logger.warning(
            "Storyboard proposal reached output limit; using one same-model output recovery "
            "model=%s max_tokens=%d partial_chars=%d termination=%s",
            model_info().model_name, strategy.max_tokens, len(partial), error.stream_termination,
        )
        with bind_deepseek_output_recovery():
            return adapter.generate_structured_output_stream(
                recovery_prompt, strategy=strategy, output_schema=schema,
            )
