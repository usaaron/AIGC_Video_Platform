from typing import Any, TypeVar

from pydantic import BaseModel


PROMPT_OMITTED = "Prompt omitted from product result."
ResultT = TypeVar("ResultT", bound=BaseModel)


def compact_generation_payload(result: BaseModel) -> dict[str, Any]:
    """Keep the source-run contract, without internal prompts or raw completions."""
    payload = result.model_dump(mode="json")

    def compact(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                compact(item)
        elif isinstance(value, dict):
            if "llm_raw_output" in value:
                value["llm_raw_output"] = {}
            prompt_build = value.get("prompt_build_result")
            if isinstance(prompt_build, dict):
                prompt_build["prompt_text"] = PROMPT_OMITTED
                prompt_build["rendered_variables"] = {}
            retrieval = value.get("prompt_retrieval_result")
            if isinstance(retrieval, dict):
                for prompt in retrieval.get("prompts", []):
                    prompt["prompt_template"] = PROMPT_OMITTED
                    prompt["input_variables"] = []
                    prompt["output_schema"] = {}
                    prompt["evaluation_notes"] = []
            for child in value.values():
                compact(child)

    compact(payload)
    return payload


def compact_generation_result(result: ResultT) -> ResultT:
    return type(result).model_validate(compact_generation_payload(result))
