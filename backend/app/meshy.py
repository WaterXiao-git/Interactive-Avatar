from __future__ import annotations

import base64
import mimetypes
import shutil
import time
import uuid
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from requests.exceptions import RequestException, SSLError
from urllib3.util.retry import Retry

from .config import MESHY_API_BASE_V1, MESHY_API_BASE_V2, MESHY_API_KEY, MODELS_DIR


class MeshyError(RuntimeError):
    pass


class MeshyClient:
    def __init__(self) -> None:
        self.session = requests.Session()
        retry = Retry(
            total=3,
            connect=3,
            read=3,
            status=2,
            backoff_factor=0.7,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=("GET", "POST"),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

    @staticmethod
    def _normalize_request_error(exc: Exception) -> MeshyError:
        if isinstance(exc, SSLError):
            return MeshyError(
                "Meshy SSL connection failed. This is usually caused by network/proxy/TLS interception instability. "
                "Please retry or switch network/VPN and try again."
            )
        if isinstance(exc, RequestException):
            return MeshyError(f"Meshy network request failed: {exc}")
        return MeshyError(str(exc))

    def _headers(self) -> dict[str, str]:
        if not MESHY_API_KEY:
            raise MeshyError("MESHY_API_KEY is required")
        return {
            "Authorization": f"Bearer {MESHY_API_KEY}",
            "Content-Type": "application/json",
        }

    def _extract_task_id(self, body: dict) -> str:
        task_id = body.get("result") or body.get("id")
        if isinstance(task_id, str) and task_id:
            return task_id
        raise MeshyError("Meshy task id not found")

    def _extract_model_url(self, body: dict) -> str:
        model_urls = body.get("model_urls")
        if isinstance(model_urls, dict) and model_urls.get("glb"):
            return model_urls["glb"]
        direct = body.get("model_url") or body.get("glb")
        if isinstance(direct, str) and direct:
            return direct
        raise MeshyError("Meshy model url not found")

    def _poll(self, task_id: str, task_type: str, base: str) -> dict:
        url = f"{base}/{task_type}/{task_id}"
        headers = self._headers()
        for _ in range(120):
            try:
                response = self.session.get(url, headers=headers, timeout=30)
            except Exception as exc:
                raise self._normalize_request_error(exc) from exc
            if response.status_code >= 400:
                raise MeshyError(f"Meshy polling failed: {response.text}")
            body = response.json()
            status = str(body.get("status", "")).upper()
            if status in {"SUCCEEDED", "SUCCESS", "DONE", "COMPLETED"}:
                return body
            if status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED"}:
                raise MeshyError(f"Meshy generation failed: {body}")
            time.sleep(5)
        raise MeshyError("Meshy generation timed out")

    def _download_glb(self, model_url: str) -> Path:
        filename = f"{uuid.uuid4().hex}.glb"
        target = MODELS_DIR / filename
        try:
            with self.session.get(model_url, stream=True, timeout=90) as response:
                if response.status_code >= 400:
                    raise MeshyError(f"Meshy model download failed: {response.text}")
                with target.open("wb") as file_obj:
                    shutil.copyfileobj(response.raw, file_obj)
        except Exception as exc:
            raise self._normalize_request_error(exc) from exc
        return target

    def text_to_model(self, prompt: str) -> Path:
        payload = {
            "prompt": prompt,
            "mode": "preview",
            "ai_model": "latest",
            "model_type": "standard",
            "pose_mode": "t-pose",
            "should_remesh": True,
        }
        try:
            response = self.session.post(
                f"{MESHY_API_BASE_V2}/text-to-3d",
                headers=self._headers(),
                json=payload,
                timeout=45,
            )
        except Exception as exc:
            raise self._normalize_request_error(exc) from exc
        if response.status_code >= 400:
            raise MeshyError(f"Meshy text request failed: {response.text}")
        task_id = self._extract_task_id(response.json())
        body = self._poll(task_id, "text-to-3d", MESHY_API_BASE_V2)
        return self._download_glb(self._extract_model_url(body))

    def image_to_model(self, image_path: Path) -> Path:
        mime, _ = mimetypes.guess_type(str(image_path))
        if not mime:
            mime = "image/png"
        data_uri = f"data:{mime};base64,{base64.b64encode(image_path.read_bytes()).decode('ascii')}"

        payload = {
            "image_url": data_uri,
            "ai_model": "latest",
            "model_type": "standard",
            "pose_mode": "t-pose",
            "should_remesh": True,
            "should_texture": True,
        }
        try:
            response = self.session.post(
                f"{MESHY_API_BASE_V1}/image-to-3d",
                headers=self._headers(),
                json=payload,
                timeout=45,
            )
        except Exception as exc:
            raise self._normalize_request_error(exc) from exc
        if response.status_code >= 400:
            raise MeshyError(f"Meshy image request failed: {response.text}")
        task_id = self._extract_task_id(response.json())
        body = self._poll(task_id, "image-to-3d", MESHY_API_BASE_V1)
        return self._download_glb(self._extract_model_url(body))
