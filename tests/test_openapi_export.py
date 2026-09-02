from __future__ import annotations

import json

from scripts.export_openapi import build_openapi_schema, write_openapi_schema


def test_openapi_export_is_deterministic_and_contains_critical_workflows(tmp_path) -> None:
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"

    write_openapi_schema(first)
    write_openapi_schema(second)

    assert first.read_bytes() == second.read_bytes()
    exported = json.loads(first.read_text(encoding="utf-8"))
    assert exported == build_openapi_schema()
    assert "/story-projects" in exported["paths"]
    assert "/story-projects/{project_id}/story-bibles/draft" in exported["paths"]
    assert "/story-projects/{project_id}/agent-runs" in exported["paths"]
