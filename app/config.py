from pathlib import Path
import os

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env", override=True)

DATA_ROOT = PROJECT_ROOT / "data"
UPLOAD_ROOT = DATA_ROOT / "uploads"
OUTPUT_ROOT = DATA_ROOT / "outputs"
TEMP_ROOT = DATA_ROOT / "temp"
EXTERNAL_ANIM_DIR = PROJECT_ROOT / "external_animations"
BONE_ALIAS_MAP_PATH = EXTERNAL_ANIM_DIR / "bone_alias_map.json"


def _normalize_meshy_api_base(raw: str) -> str:
    value = (raw or "").strip().rstrip("/")
    if not value:
        return "https://api.meshy.ai/openapi/v1"

    if "api.meshy.ai" in value:
        if "/openapi/v2" in value:
            return value.replace("/openapi/v2", "/openapi/v1")
        if "/openapi/v1" not in value:
            return f"{value}/openapi/v1"
    return value


BLENDER_BIN = os.getenv("BLENDER_BIN", "blender")
MESHY_API_KEY = os.getenv("MESHY_API_KEY", "")
MESHY_API_BASE = _normalize_meshy_api_base(
    os.getenv("MESHY_API_BASE", "https://api.meshy.ai/openapi/v1")
)
EXTERNAL_ANIM_DIR = Path(os.getenv("EXTERNAL_ANIM_DIR", str(EXTERNAL_ANIM_DIR)))
BONE_ALIAS_MAP_PATH = Path(os.getenv("BONE_ALIAS_MAP_PATH", str(BONE_ALIAS_MAP_PATH)))
ENABLE_EXTERNAL_ANIM = os.getenv("ENABLE_EXTERNAL_ANIM", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


def ensure_directories() -> None:
    for path in (DATA_ROOT, UPLOAD_ROOT, OUTPUT_ROOT, TEMP_ROOT, EXTERNAL_ANIM_DIR):
        path.mkdir(parents=True, exist_ok=True)

    if BONE_ALIAS_MAP_PATH.parent:
        BONE_ALIAS_MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
