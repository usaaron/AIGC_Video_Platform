"""Copy the UI preview's backed-up project into the new local backend once."""
from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:8190"


def request(path: str, payload: dict | None = None):
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    req = Request(BASE + path, data=data, method="PUT" if data else "GET",
                  headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=30) as response:
        return json.load(response)


def main():
    backup = json.loads((ROOT / ".cache/local-preview/mock-project-backup.json").read_text(encoding="utf-8-sig"))
    metadata = backup["metadata"]
    workspace = backup["workspace"]
    if metadata["project_id"] != "project-1" or workspace["workspace_payload"]["id"] != "project-1":
        raise SystemExit("Unexpected preview project; nothing was migrated.")
    for record in (metadata, workspace):
        if not 1 <= record.get("revision", 1) <= 100:
            raise SystemExit("Unexpected revision count; nothing was migrated.")
    try:
        request("/story-projects/project-1/workspace")
    except HTTPError as error:
        if error.code != 404:
            raise SystemExit(f"Local backend returned HTTP {error.code}; nothing was migrated.") from None
    else:
        print("Local workspace already exists; retained without changes.")
        return
    # Preserve the browser's revision counters using the normal versioned API.
    # This is a one-time import into a dedicated local database, never production.
    for revision in range(1, metadata.get("revision", 1) + 1):
        request("/story-projects/project-1", {**metadata, "revision": revision})
    allowed = {"schema_version", "project_id", "revision", "payload_schema_version",
               "client_instance_id", "memory_layer", "workspace_payload", "updated_at"}
    saved = {key: value for key, value in workspace.items() if key in allowed}
    saved.setdefault("project_id", "project-1")
    saved.setdefault("client_instance_id", "local-preview-migration")
    for revision in range(1, workspace.get("revision", 1) + 1):
        request("/story-projects/project-1/workspace", {**saved, "revision": revision})
    verified = request("/story-projects/project-1/workspace")["data"]
    if verified["workspace_payload"] != workspace["workspace_payload"]:
        raise SystemExit("Migrated workspace differs from its backup; do not switch the preview.")
    print("Local project migrated and verified; synopsis and existing draft preserved.")


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        raise SystemExit(f"Local migration returned HTTP {error.code}; backup retained.") from None
