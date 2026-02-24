from __future__ import annotations

import shutil
import json
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import OUTPUT_ROOT, PROJECT_ROOT, ensure_directories
from .models import PipelineResponse, TextToModelRequest
from .pipeline import FullPipeline


ensure_directories()
app = FastAPI(title="3D Auto Rig Pipeline", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pipeline = FullPipeline()
web_root = PROJECT_ROOT / "web"
app.mount("/web", StaticFiles(directory=web_root), name="web")


def _normalize_action_policy(action_policy: str) -> Literal["strict", "balanced"]:
    value = (action_policy or "strict").strip().lower()
    return "balanced" if value == "balanced" else "strict"


def _publish_result(
    processed_model: Path,
    source: str,
    animations: list[str],
    action_report: list[dict[str, str]],
    action_policy: str,
) -> PipelineResponse:
    public_name = pipeline.make_public_name(processed_model)
    public_path = OUTPUT_ROOT / public_name
    shutil.copy2(processed_model, public_path)

    output_model_url = f"/models/{public_name}"
    viewer_url = f"/web/index.html?model={output_model_url}"
    return PipelineResponse(
        status="ok",
        source=source,
        action_policy=_normalize_action_policy(action_policy),
        output_model_url=output_model_url,
        viewer_url=viewer_url,
        animations=animations,
        action_report=action_report,
    )


@app.get("/models/{filename}")
def get_model(filename: str) -> FileResponse:
    model_path = OUTPUT_ROOT / filename
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Model not found")
    return FileResponse(model_path)


def _resolve_manifest_path_from_public_model(filename: str) -> Path:
    actual_name = filename.split("_", 1)[1] if "_" in filename else filename
    stem = Path(actual_name).stem

    candidates = [
        OUTPUT_ROOT / f"{stem}_animations.json",
        OUTPUT_ROOT / f"{stem.replace('_interactive', '')}_animations.json",
    ]
    for path in candidates:
        if path.exists():
            return path

    return candidates[0]


@app.get("/reports/{filename}")
def get_action_report(filename: str) -> JSONResponse:
    manifest_path = _resolve_manifest_path_from_public_model(filename)
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="Action report not found")

    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    return JSONResponse(content=data)


@app.post("/pipeline/text", response_model=PipelineResponse)
def pipeline_from_text(payload: TextToModelRequest) -> PipelineResponse:
    try:
        action_policy = _normalize_action_policy(payload.action_policy)
        (
            processed_model,
            animations,
            action_report,
            source,
            used_policy,
        ) = pipeline.run_from_text(payload.prompt, action_policy)
        return _publish_result(
            processed_model, source, animations, action_report, used_policy
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/pipeline/image", response_model=PipelineResponse)
def pipeline_from_image(
    file: UploadFile = File(...), action_policy: str = Form("strict")
) -> PipelineResponse:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload an image file")
    try:
        normalized_policy = _normalize_action_policy(action_policy)
        (
            processed_model,
            animations,
            action_report,
            source,
            used_policy,
        ) = pipeline.run_from_image(file, normalized_policy)
        return _publish_result(
            processed_model, source, animations, action_report, used_policy
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/pipeline/model", response_model=PipelineResponse)
def pipeline_from_model(
    file: UploadFile = File(...), action_policy: str = Form("strict")
) -> PipelineResponse:
    try:
        normalized_policy = _normalize_action_policy(action_policy)
        (
            processed_model,
            animations,
            action_report,
            source,
            used_policy,
        ) = pipeline.run_from_model(file, normalized_policy)
        return _publish_result(
            processed_model, source, animations, action_report, used_policy
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
