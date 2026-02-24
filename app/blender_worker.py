from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .config import (
    BLENDER_BIN,
    BONE_ALIAS_MAP_PATH,
    ENABLE_EXTERNAL_ANIM,
    EXTERNAL_ANIM_DIR,
    OUTPUT_ROOT,
    PROJECT_ROOT,
)


class BlenderWorker:
    def __init__(self) -> None:
        self.script_path = PROJECT_ROOT / "blender_scripts" / "auto_rig_and_animate.py"

    @staticmethod
    def _decode_output(raw: bytes) -> str:
        if not raw:
            return ""
        for enc in ("utf-8", "gbk", "cp936"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")

    def process(
        self, input_model: Path, action_policy: str
    ) -> tuple[Path, list[str], list[dict[str, str]]]:
        output_glb = OUTPUT_ROOT / f"{input_model.stem}_interactive.glb"
        manifest = OUTPUT_ROOT / f"{input_model.stem}_animations.json"
        normalized_policy = (
            action_policy.strip().lower()
            if action_policy.strip().lower() in {"strict", "balanced"}
            else "strict"
        )

        command = [
            BLENDER_BIN,
            "-b",
            "--python-exit-code",
            "1",
            "-P",
            str(self.script_path),
            "--",
            "--input",
            str(input_model),
            "--output",
            str(output_glb),
            "--manifest",
            str(manifest),
            "--external-anim-dir",
            str(EXTERNAL_ANIM_DIR),
            "--enable-external-anim",
            "true" if ENABLE_EXTERNAL_ANIM else "false",
            "--action-policy",
            normalized_policy,
            "--bone-alias-map",
            str(BONE_ALIAS_MAP_PATH),
        ]

        run = subprocess.run(command, capture_output=True, text=False)
        stdout = self._decode_output(run.stdout)
        stderr = self._decode_output(run.stderr)

        if run.returncode != 0:
            raise RuntimeError(
                "Blender automation failed\n"
                f"COMMAND: {' '.join(command)}\n"
                f"STDOUT:\n{stdout}\n"
                f"STDERR:\n{stderr}"
            )

        if not output_glb.exists():
            raise RuntimeError(
                "Blender finished without producing output model\n"
                f"EXPECTED: {output_glb}\n"
                f"COMMAND: {' '.join(command)}\n"
                f"STDOUT:\n{stdout}\n"
                f"STDERR:\n{stderr}"
            )

        animations = ["idle", "wave", "jump"]
        action_report: list[dict[str, str]] = []
        if manifest.exists():
            data = json.loads(manifest.read_text(encoding="utf-8"))
            animations = data.get("animations", animations)
            action_report = data.get("action_report", action_report)

        return output_glb, animations, action_report
