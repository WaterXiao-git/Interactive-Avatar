from __future__ import annotations

import base64
import mimetypes
import shutil
import time
import uuid
from pathlib import Path

import requests
from fastapi import UploadFile

from .config import MESHY_API_BASE, MESHY_API_KEY, TEMP_ROOT, UPLOAD_ROOT


class SourceResolver:
    def _raise_for_status_with_detail(
        self, response: requests.Response, context: str
    ) -> None:
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            detail = response.text.strip()
            raise RuntimeError(
                f"{context} failed ({response.status_code}): {detail}"
            ) from exc

    def save_upload(self, file: UploadFile, suffix_hint: str = "") -> Path:
        ext = Path(file.filename or "").suffix.lower()
        suffix = ext if ext else suffix_hint
        target = UPLOAD_ROOT / f"{uuid.uuid4().hex}{suffix}"
        with target.open("wb") as out:
            shutil.copyfileobj(file.file, out)
        return target

    def from_existing_model(self, file: UploadFile) -> Path:
        return self.save_upload(file)

    def from_image(self, file: UploadFile) -> Path:
        image_path = self.save_upload(file)
        return self._meshy_image_to_model(image_path)

    def from_text(self, prompt: str) -> Path:
        return self._meshy_text_to_model(prompt)

    def _meshy_headers(self) -> dict[str, str]:
        if not MESHY_API_KEY:
            raise RuntimeError(
                "MESHY_API_KEY is required for text/image to 3D generation"
            )
        return {
            "Authorization": f"Bearer {MESHY_API_KEY}",
            "Content-Type": "application/json",
        }

    def _meshy_text_to_model(self, prompt: str) -> Path:
        create_url = f"{MESHY_API_BASE}/text-to-3d"
        payload = {
            "prompt": prompt,
            "mode": "preview",
            "art_style": "realistic",
            "should_remesh": True,
        }
        response = requests.post(
            create_url, headers=self._meshy_headers(), json=payload, timeout=45
        )
        self._raise_for_status_with_detail(response, "Meshy text-to-3d request")
        task_id = self._extract_task_id(response.json())
        return self._poll_and_download_meshy(task_id, task_type="text-to-3d")

    def _meshy_image_to_model(self, image_path: Path) -> Path:
        if not MESHY_API_KEY:
            raise RuntimeError(
                "MESHY_API_KEY is required for text/image to 3D generation"
            )

        create_url = f"{MESHY_API_BASE}/image-to-3d"
        image_data_uri = self._image_to_data_uri(image_path)
        payload = {
            "image_url": image_data_uri,
        }
        response = requests.post(
            create_url, headers=self._meshy_headers(), json=payload, timeout=45
        )
        self._raise_for_status_with_detail(response, "Meshy image-to-3d request")
        task_id = self._extract_task_id(response.json())
        return self._poll_and_download_meshy(task_id, task_type="image-to-3d")

    def _poll_and_download_meshy(self, task_id: str, task_type: str) -> Path:
        status_url = f"{MESHY_API_BASE}/{task_type}/{task_id}"
        headers = self._meshy_headers()

        for _ in range(120):
            response = requests.get(status_url, headers=headers, timeout=30)
            self._raise_for_status_with_detail(response, "Meshy task polling")
            body = response.json()
            status = str(body.get("status", "")).upper()
            if status in {"SUCCEEDED", "SUCCESS", "DONE", "COMPLETED"}:
                model_url = self._extract_model_url(body)
                return self._download_model(model_url)
            if status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED"}:
                raise RuntimeError(f"Meshy generation failed: {body}")
            time.sleep(5)

        raise TimeoutError("Meshy generation timed out")

    def _extract_task_id(self, body: dict) -> str:
        task_id = body.get("result") or body.get("id")
        if isinstance(task_id, str) and task_id:
            return task_id
        raise RuntimeError(f"Meshy task id not found in response: {body}")

    def _extract_model_url(self, body: dict) -> str:
        model_urls = body.get("model_urls")
        if isinstance(model_urls, dict):
            glb_url = model_urls.get("glb")
            if isinstance(glb_url, str) and glb_url:
                return glb_url

        direct_url = body.get("model_url") or body.get("glb")
        if isinstance(direct_url, str) and direct_url:
            return direct_url

        raise RuntimeError(f"Meshy model URL not found in response: {body}")

    def _image_to_data_uri(self, image_path: Path) -> str:
        mime, _ = mimetypes.guess_type(str(image_path))
        if not mime:
            mime = "image/png"

        data = image_path.read_bytes()
        encoded = base64.b64encode(data).decode("ascii")
        return f"data:{mime};base64,{encoded}"

    def _download_model(self, model_url: str) -> Path:
        target = TEMP_ROOT / f"{uuid.uuid4().hex}.glb"
        with requests.get(model_url, stream=True, timeout=90) as response:
            self._raise_for_status_with_detail(response, "Meshy model download")
            with target.open("wb") as file_obj:
                shutil.copyfileobj(response.raw, file_obj)
        return target
