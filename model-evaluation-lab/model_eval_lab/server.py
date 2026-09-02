from __future__ import annotations

from datetime import UTC, datetime
import hashlib
from pathlib import Path
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .attachments import AttachmentPayload, extract_attachments
from .config import load_all_models, load_stage_models
from .prompts import STAGES, build_evaluation_prompt
from .runner import run_evaluation_models


ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "static"


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: str
    input_text: str = Field(default="", max_length=120_000)
    attachments: list[AttachmentPayload] = Field(default_factory=list, max_length=8)


app = FastAPI(
    title="My Comic Model Evaluation Lab",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url=None,
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def configuration() -> dict[str, object]:
    all_models = load_all_models()
    return {
        "stages": [
            {
                **definition.public_dict(),
                "models": [model.public_dict() for model in all_models[stage]],
            }
            for stage, definition in STAGES.items()
        ],
        "accepted_extensions": [".docx", ".txt", ".md", ".markdown", ".json", ".csv", ".srt"],
        "max_attachment_bytes": 8 * 1024 * 1024,
    }


@app.post("/api/evaluations")
async def create_evaluation(request: EvaluationRequest) -> dict[str, object]:
    if request.stage not in STAGES:
        raise HTTPException(status_code=404, detail="未知的测试阶段。")
    if not request.input_text.strip() and not request.attachments:
        raise HTTPException(status_code=422, detail="请填写输入或上传参考文件。")
    selected = [
        model for model in load_stage_models(request.stage) if model.configured
    ]
    if not selected:
        raise HTTPException(status_code=422, detail="本阶段至少需要配置一个可用模型。")
    try:
        attachments = extract_attachments(
            request.attachments,
            input_characters=len(request.input_text),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    prompt = build_evaluation_prompt(request.stage, request.input_text, attachments)
    results = await run_evaluation_models(
        stage=request.stage,
        prompt=prompt,
        models=selected,
    )
    return {
        "run_id": f"evaluation-run.{uuid.uuid4()}",
        "stage": request.stage,
        "submitted_at": datetime.now(UTC).isoformat(),
        "parallel_model_count": len(selected),
        "shared_input_fingerprint": hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12],
        "input_character_count": len(request.input_text) + sum(len(text) for _, text in attachments),
        "attachment_names": [name for name, _ in attachments],
        "results": results,
    }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
