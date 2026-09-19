"""Compact a schema without dropping field meaning or validation rules."""

from copy import deepcopy
from typing import Any


def compact_json_schema(schema: Any) -> Any:
    if not isinstance(schema, dict):
        return deepcopy(schema)
    result = {}
    for key, value in schema.items():
        # Descriptions carry execution semantics (for example, what is prior
        # knowledge and which bilingual field is the original spoken line).
        # Removing them made JSON-only routes obey a weaker contract than
        # strict-schema routes even though their field shapes were identical.
        if key in {"title", "examples", "default", "$comment"}:
            continue
        if key in {"properties", "patternProperties", "$defs", "definitions", "dependentSchemas"}:
            result[key] = {name: compact_json_schema(child) for name, child in value.items()}
        elif key in {"items", "additionalProperties", "unevaluatedProperties", "contains", "not", "if", "then", "else", "propertyNames"}:
            result[key] = compact_json_schema(value)
        elif key in {"allOf", "anyOf", "oneOf", "prefixItems"}:
            result[key] = [compact_json_schema(child) for child in value]
        else:
            # Values such as enum/const/required are data, not schema nodes.
            result[key] = deepcopy(value)
    return result
