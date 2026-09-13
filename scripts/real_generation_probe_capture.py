"""Raw structured-output evidence for standalone synthetic workflow probes."""

from contextlib import contextmanager
from functools import wraps
from unittest.mock import patch
from uuid import uuid4

from app.modules.script_engine.llm_adapter import RealLLMAdapter
from scripts.run_real_generation_probe import write_json


@contextmanager
def capture_structured_responses(output):
    original = RealLLMAdapter._parse_json_content

    @wraps(original)
    def parse(self, content, **kwargs):
        directory = output / "structured_responses"
        directory.mkdir(exist_ok=True)
        record = {"model": self.get_model_info().model_name,
                  "raw_content": content, "schema": kwargs.get("output_schema")}
        try:
            result = original(self, content, **kwargs)
            record["parsed"] = result
            return result
        except Exception as error:
            record.update(error_type=type(error).__name__, detail=str(error))
            raise
        finally:
            write_json(directory / f"response-{uuid4().hex}.json", record)

    with patch.object(RealLLMAdapter, "_parse_json_content", parse):
        yield
