from pathlib import Path
import os

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env", override=True)

ASSETS_DIR = BASE_DIR / "assets"
MODELS_DIR = ASSETS_DIR / "models"
ANIMATIONS_DIR = ASSETS_DIR / "animations"
PRESETS_DIR = ASSETS_DIR / "presets"
RECORDINGS_DIR = ASSETS_DIR / "recordings"
CHAT_AUDIO_DIR = ASSETS_DIR / "chat_audio"

DATABASE_URL = os.getenv(
    "DATABASE_URL", f"sqlite:///{(BASE_DIR / 'interactive_avatar.db').as_posix()}"
)
JWT_SECRET = os.getenv("JWT_SECRET", "interactive-avatar-dev-secret").strip()
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256").strip()
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "72").strip())
PASSWORD_MIN_LENGTH = int(os.getenv("PASSWORD_MIN_LENGTH", "8").strip())
AUTH_CODE_TTL_SECONDS = int(os.getenv("AUTH_CODE_TTL_SECONDS", "300").strip())
AUTH_SEND_COOLDOWN_SECONDS = int(
    os.getenv("AUTH_SEND_COOLDOWN_SECONDS", "60").strip()
)
CAPTCHA_TTL_SECONDS = int(os.getenv("CAPTCHA_TTL_SECONDS", "180").strip())
TURNSTILE_SITE_KEY = os.getenv("TURNSTILE_SITE_KEY", "").strip()
TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY", "").strip()
TURNSTILE_VERIFY_URL = os.getenv(
    "TURNSTILE_VERIFY_URL",
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
).strip()
SMS_PROVIDER = os.getenv("SMS_PROVIDER", "mock").strip().lower()
SMS_WEBHOOK_URL = os.getenv("SMS_WEBHOOK_URL", "").strip()
SMS_WEBHOOK_TOKEN = os.getenv("SMS_WEBHOOK_TOKEN", "").strip()
SMS_DEBUG = os.getenv("SMS_DEBUG", "1").strip() == "1"

MESHY_API_KEY = os.getenv("MESHY_API_KEY", "").strip()
MESHY_API_BASE_V1 = os.getenv(
    "MESHY_API_BASE_V1", "https://api.meshy.ai/openapi/v1"
).rstrip("/")
MESHY_API_BASE_V2 = os.getenv(
    "MESHY_API_BASE_V2", "https://api.meshy.ai/openapi/v2"
).rstrip("/")

DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "").strip()
QWEN_RT_URL = os.getenv(
    "QWEN_RT_URL", "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
).strip()
QWEN_MODEL = os.getenv("QWEN_MODEL", "qwen3-omni-flash-realtime").strip()
QWEN_VOICE = os.getenv("QWEN_VOICE", "Cherry").strip()
QWEN_VOICE_MALE = os.getenv("QWEN_VOICE_MALE", "Moon").strip()
QWEN_VOICE_FEMALE = os.getenv("QWEN_VOICE_FEMALE", QWEN_VOICE).strip()
QWEN_TEXT_MODEL = os.getenv("QWEN_TEXT_MODEL", "qwen-plus").strip()
QWEN_VISION_MODEL = os.getenv("QWEN_VISION_MODEL", "qwen-vl-plus").strip()
QWEN_IMAGE_MODEL = os.getenv("QWEN_IMAGE_MODEL", "wanx2.1-t2i-turbo").strip()
QWEN_ASR_MODEL = os.getenv("QWEN_ASR_MODEL", "paraformer-v2").strip()
QWEN_TTS_MODEL = os.getenv("QWEN_TTS_MODEL", "cosyvoice-v1").strip()
LOCAL_ASR_MODEL = os.getenv("LOCAL_ASR_MODEL", "tiny").strip()
LOCAL_ASR_DEVICE = os.getenv("LOCAL_ASR_DEVICE", "cpu").strip()
LOCAL_ASR_COMPUTE_TYPE = os.getenv("LOCAL_ASR_COMPUTE_TYPE", "int8").strip()
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT", "").strip()
QWEN_DEBUG = os.getenv("QWEN_DEBUG", "0").strip() == "1"
UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY", "").strip()

for path in (
    ASSETS_DIR,
    MODELS_DIR,
    ANIMATIONS_DIR,
    PRESETS_DIR,
    RECORDINGS_DIR,
    CHAT_AUDIO_DIR,
):
    path.mkdir(parents=True, exist_ok=True)
