from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import UploadFile

from .blender_worker import BlenderWorker
from .input_handlers import SourceResolver


class FullPipeline:
    def __init__(self) -> None:
        self.sources = SourceResolver()
        self.blender = BlenderWorker()

    def run_from_text(
        self, prompt: str, action_policy: str
    ) -> tuple[Path, list[str], list[dict[str, str]], str, str]:
        model_path = self.sources.from_text(prompt)
        output_model, animations, action_report = self.blender.process(
            model_path, action_policy
        )
        return output_model, animations, action_report, "text", action_policy

    def run_from_image(
        self, image_file: UploadFile, action_policy: str
    ) -> tuple[Path, list[str], list[dict[str, str]], str, str]:
        model_path = self.sources.from_image(image_file)
        output_model, animations, action_report = self.blender.process(
            model_path, action_policy
        )
        return output_model, animations, action_report, "image", action_policy

    def run_from_model(
        self, model_file: UploadFile, action_policy: str
    ) -> tuple[Path, list[str], list[dict[str, str]], str, str]:
        model_path = self.sources.from_existing_model(model_file)
        output_model, animations, action_report = self.blender.process(
            model_path, action_policy
        )
        return output_model, animations, action_report, "model", action_policy

    @staticmethod
    def make_public_name(path: Path) -> str:
        return f"{uuid.uuid4().hex}_{path.name}"
