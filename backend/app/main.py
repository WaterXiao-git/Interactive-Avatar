from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import random
import re
import secrets
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from collections.abc import Sequence
from urllib.parse import parse_qs

import jwt
import requests
import websockets
from requests.exceptions import RequestException, SSLError
from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from sqlalchemy import and_, desc, func, inspect, or_, select, text
from sqlalchemy.orm import Session

from .config import (
    ANIMATIONS_DIR,
    AUTH_CODE_TTL_SECONDS,
    AUTH_SEND_COOLDOWN_SECONDS,
    CAPTCHA_TTL_SECONDS,
    CHAT_AUDIO_DIR,
    DASHSCOPE_API_KEY,
    MODELS_DIR,
    LOCAL_ASR_COMPUTE_TYPE,
    LOCAL_ASR_DEVICE,
    LOCAL_ASR_MODEL,
    PASSWORD_MIN_LENGTH,
    PRESETS_DIR,
    RECORDINGS_DIR,
    QWEN_DEBUG,
    QWEN_ASR_MODEL,
    QWEN_IMAGE_MODEL,
    QWEN_MODEL,
    QWEN_RT_URL,
    QWEN_TTS_MODEL,
    QWEN_TEXT_MODEL,
    QWEN_VISION_MODEL,
    QWEN_VOICE,
    QWEN_VOICE_FEMALE,
    QWEN_VOICE_MALE,
    SMS_DEBUG,
    SMS_PROVIDER,
    SMS_WEBHOOK_TOKEN,
    SMS_WEBHOOK_URL,
    SYSTEM_PROMPT,
    TURNSTILE_SECRET_KEY,
    TURNSTILE_SITE_KEY,
    TURNSTILE_VERIFY_URL,
    UNSPLASH_ACCESS_KEY,
)
from .db import Base, SessionLocal, engine, get_db
from .meshy import MeshyClient, MeshyError
from .models_db import (
    AuthCaptchaChallenge,
    InteractionEvent,
    InteractionSession,
    SmsVerificationCode,
    User,
    UserModel,
    UserRecording,
)
from .security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{4,32}$")
PHONE_RE = re.compile(r"^(?:\+?86)?1\d{10}$")
MALE_PRESET_RE = re.compile(
    r"(\u7537\u4eba|\u7537\u6027|\u7537\u751f|\u7537\u58eb|\bmale\b|\bman\b|\bboy\b)",
    re.IGNORECASE,
)
FEMALE_PRESET_RE = re.compile(
    r"(\u5973\u4eba|\u5973\u6027|\u5973\u751f|\u5973\u58eb|\bfemale\b|\bwoman\b|\bgirl\b)",
    re.IGNORECASE,
)

app = FastAPI(title="Interactive Avatar Backend", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/assets",
    StaticFiles(directory=Path(__file__).resolve().parent.parent / "assets"),
    name="assets",
)

meshy = MeshyClient()
rig_tasks: dict[str, dict] = {}
auth_scheme = HTTPBearer(auto_error=False)


@app.on_event("startup")
def startup() -> None:
    _ensure_auth_schema()
    Base.metadata.create_all(bind=engine)
    _validate_presets_integrity()
    _cleanup_launch_data()


def _dbg(*args):
    if QWEN_DEBUG:
        print(*args)


def _ensure_auth_schema() -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    user_columns = {item["name"] for item in inspector.get_columns("users")}
    ddl = []
    if "phone_number" not in user_columns:
        ddl.append("ALTER TABLE users ADD COLUMN phone_number VARCHAR(20)")
    if "phone_verified_at" not in user_columns:
        ddl.append("ALTER TABLE users ADD COLUMN phone_verified_at DATETIME")

    if not ddl:
        return

    with engine.begin() as conn:
        for statement in ddl:
            conn.execute(text(statement))


def _recording_path_from_url(file_url: str) -> Path:
    name = Path(str(file_url or "").strip()).name
    return RECORDINGS_DIR / name


def _is_recording_row_valid(row: UserRecording) -> bool:
    path = _recording_path_from_url(row.file_url)
    if not path.exists() or not path.is_file():
        return False
    data = path.read_bytes()
    return _looks_like_video_upload(data, row.mime_type or "", path.name)


def _cleanup_launch_data() -> None:
    db = SessionLocal()
    try:
        sessions = db.scalars(select(InteractionSession)).all()
        for row in sessions:
            events = db.scalars(
                select(InteractionEvent)
                .where(InteractionEvent.session_id == row.id)
                .order_by(InteractionEvent.created_at)
            ).all()
            if not events:
                db.delete(row)
                continue
            input_count = sum(1 for event in events if event.role == "user")
            output_count = sum(1 for event in events if event.role == "assistant")
            row.input_count = input_count
            row.output_count = output_count
            row.turns = (
                min(input_count, output_count)
                if input_count and output_count
                else max(input_count, output_count)
            )
            row.summary_text = _build_summary(events)
            row.ended_at = row.ended_at or _now()

        recordings = db.scalars(select(UserRecording)).all()
        for row in recordings:
            if _is_recording_row_valid(row):
                continue
            path = _recording_path_from_url(row.file_url)
            if path.exists():
                path.unlink(missing_ok=True)
            db.delete(row)
        db.commit()
    finally:
        db.close()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _mask_phone_number(phone_number: str) -> str:
    if len(phone_number) != 11:
        return phone_number
    return f"{phone_number[:3]}****{phone_number[-4:]}"


def _normalize_phone_number(raw: str) -> str:
    phone_number = re.sub(r"[\s\-()]+", "", str(raw or "").strip())
    if not PHONE_RE.match(phone_number):
        raise HTTPException(status_code=400, detail="请输入有效的中国大陆手机号")
    if phone_number.startswith("+86"):
        phone_number = phone_number[3:]
    elif phone_number.startswith("86") and len(phone_number) == 13:
        phone_number = phone_number[2:]
    return phone_number


def _hash_auth_value(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _build_captcha_prompt() -> tuple[str, str]:
    left = random.randint(2, 9)
    right = random.randint(1, 8)
    if random.random() < 0.5:
        return f"{left} + {right} = ?", str(left + right)
    high = max(left, right)
    low = min(left, right)
    return f"{high} - {low} = ?", str(high - low)


def _human_verification_provider() -> str:
    if TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY:
        return "turnstile"
    return "math"


def _client_ip_from_request(request: Request) -> str:
    forwarded_for = str(request.headers.get("x-forwarded-for") or "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return str((request.client.host if request.client else "") or "").strip()


def _create_captcha_challenge(db: Session, purpose: str) -> AuthCaptchaChallenge:
    prompt, answer = _build_captcha_prompt()
    challenge = AuthCaptchaChallenge(
        challenge_id=secrets.token_urlsafe(18),
        purpose=purpose,
        prompt=prompt,
        answer_hash=_hash_auth_value(answer),
        expires_at=_now() + timedelta(seconds=CAPTCHA_TTL_SECONDS),
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return challenge


def _verify_captcha_challenge(
    db: Session, challenge_id: str, captcha_answer: str, purpose: str
) -> None:
    now = _now()
    challenge = db.scalar(
        select(AuthCaptchaChallenge)
        .where(AuthCaptchaChallenge.challenge_id == challenge_id)
        .where(AuthCaptchaChallenge.purpose == purpose)
        .order_by(desc(AuthCaptchaChallenge.id))
    )
    if not challenge or challenge.consumed_at or _as_utc(challenge.expires_at) < now:
        raise HTTPException(status_code=400, detail="人机验证已失效，请刷新后重试")
    if _hash_auth_value(str(captcha_answer).strip()) != challenge.answer_hash:
        raise HTTPException(status_code=400, detail="真人验证答案不正确")
    challenge.consumed_at = now
    db.commit()


def _verify_turnstile_token(token: str, purpose: str, remote_ip: str = "") -> None:
    if not TURNSTILE_SECRET_KEY or not TURNSTILE_SITE_KEY:
        raise HTTPException(status_code=503, detail="Turnstile 未配置完成")
    if not token:
        raise HTTPException(status_code=400, detail="请先完成人机验证")

    payload = {
        "secret": TURNSTILE_SECRET_KEY,
        "response": token,
    }
    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        response = requests.post(
            TURNSTILE_VERIFY_URL,
            data=payload,
            timeout=10,
        )
        data = response.json() if response.content else {}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Turnstile 校验失败：{exc}") from exc

    if not response.ok:
        raise HTTPException(status_code=502, detail="Turnstile 服务不可用")
    if not data.get("success"):
        raise HTTPException(status_code=400, detail="人机验证未通过，请重试")

    action = str(data.get("action") or "").strip()
    if action and action != purpose:
        raise HTTPException(status_code=400, detail="人机验证用途不匹配，请刷新后重试")


def _verify_human_challenge(
    db: Session,
    request: Request,
    payload: dict,
    purpose: str,
) -> None:
    provider = _human_verification_provider()
    if provider == "turnstile":
        token = str(payload.get("turnstile_token", "")).strip()
        _verify_turnstile_token(token, purpose, _client_ip_from_request(request))
        return

    challenge_id = str(payload.get("captcha_id", "")).strip()
    captcha_answer = str(payload.get("captcha_answer", "")).strip()
    _verify_captcha_challenge(db, challenge_id, captcha_answer, purpose)


def _send_sms_code(phone_number: str, code: str, purpose: str) -> dict:
    if SMS_PROVIDER == "webhook" and SMS_WEBHOOK_URL:
        headers = {"Content-Type": "application/json"}
        if SMS_WEBHOOK_TOKEN:
            headers["Authorization"] = f"Bearer {SMS_WEBHOOK_TOKEN}"
        payload = {
            "phone_number": phone_number,
            "code": code,
            "purpose": purpose,
            "ttl_seconds": AUTH_CODE_TTL_SECONDS,
        }
        try:
            response = requests.post(
                SMS_WEBHOOK_URL,
                headers=headers,
                json=payload,
                timeout=12,
            )
            if not response.ok:
                raise HTTPException(status_code=502, detail="短信服务发送失败，请稍后重试")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"短信服务不可用：{exc}") from exc
        return {"provider": "webhook"}

    print(f"[auth-sms][{purpose}] {phone_number} -> {code}")
    result = {"provider": "mock"}
    if SMS_DEBUG:
        result["debug_code"] = code
    return result


def _issue_sms_code(db: Session, phone_number: str, purpose: str) -> dict:
    now = _now()
    latest = db.scalar(
        select(SmsVerificationCode)
        .where(SmsVerificationCode.phone_number == phone_number)
        .where(SmsVerificationCode.purpose == purpose)
        .order_by(desc(SmsVerificationCode.id))
    )
    latest_created_at = _as_utc(latest.created_at) if latest else None
    if latest and latest_created_at and (now - latest_created_at).total_seconds() < AUTH_SEND_COOLDOWN_SECONDS:
        retry_after = AUTH_SEND_COOLDOWN_SECONDS - int((now - latest_created_at).total_seconds())
        raise HTTPException(status_code=429, detail=f"验证码发送过于频繁，请 {retry_after} 秒后再试")

    code = f"{random.randint(0, 999999):06d}"
    send_result = _send_sms_code(phone_number, code, purpose)

    row = SmsVerificationCode(
        phone_number=phone_number,
        purpose=purpose,
        code_hash=_hash_auth_value(code),
        created_at=now,
        expires_at=now + timedelta(seconds=AUTH_CODE_TTL_SECONDS),
    )
    db.add(row)
    db.commit()

    response = {
        "ok": True,
        "masked_phone_number": _mask_phone_number(phone_number),
        "expires_in_seconds": AUTH_CODE_TTL_SECONDS,
        "retry_after_seconds": AUTH_SEND_COOLDOWN_SECONDS,
        "provider": send_result["provider"],
    }
    if send_result.get("debug_code"):
        response["debug_code"] = send_result["debug_code"]
    return response


def _consume_sms_code(db: Session, phone_number: str, purpose: str, code: str) -> None:
    now = _now()
    row = db.scalar(
        select(SmsVerificationCode)
        .where(SmsVerificationCode.phone_number == phone_number)
        .where(SmsVerificationCode.purpose == purpose)
        .where(SmsVerificationCode.consumed_at.is_(None))
        .order_by(desc(SmsVerificationCode.id))
    )
    if not row or _as_utc(row.expires_at) < now:
        raise HTTPException(status_code=400, detail="短信验证码已失效，请重新获取")
    if _hash_auth_value(str(code).strip()) != row.code_hash:
        raise HTTPException(status_code=400, detail="短信验证码不正确")
    row.consumed_at = now
    db.commit()


def _serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "phone_number": user.phone_number,
        "phone_verified_at": user.phone_verified_at,
        "created_at": user.created_at,
        "last_login_at": user.last_login_at,
    }


def _make_pipeline_response(model_path: Path, source: str) -> dict:
    output_model_url = f"/assets/models/{model_path.name}"
    return {
        "status": "ok",
        "source": source,
        "output_model_url": output_model_url,
        "viewer_url": output_model_url,
    }


def _extract_token_from_ws(websocket: WebSocket) -> str | None:
    query = parse_qs(websocket.scope.get("query_string", b"").decode("utf-8"))
    token = query.get("token", [None])[0]
    return token


def _extract_model_id_from_ws(websocket: WebSocket) -> int | None:
    query = parse_qs(websocket.scope.get("query_string", b"").decode("utf-8"))
    raw = query.get("model_id", [None])[0]
    if not raw:
        return None
    try:
        return int(raw)
    except Exception:
        return None


def _extract_voice_hint_from_ws(websocket: WebSocket) -> str:
    query = parse_qs(websocket.scope.get("query_string", b"").decode("utf-8"))
    raw = str(query.get("voice_hint", [""])[0] or "").strip().lower()
    if raw in {"male", "man", "boy"}:
        return "male"
    if raw in {"female", "woman", "girl"}:
        return "female"
    return ""


def _user_payload_from_token(token: str) -> dict:
    try:
        return decode_access_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


def _get_user_by_payload(db: Session, payload: dict) -> User:
    user_id = int(payload.get("sub", "0"))
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(auth_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Unauthorized")
    payload = _user_payload_from_token(credentials.credentials)
    return _get_user_by_payload(db, payload)


def get_current_user_optional(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(auth_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User | None:
    if not credentials:
        return None
    try:
        payload = _user_payload_from_token(credentials.credentials)
        return _get_user_by_payload(db, payload)
    except HTTPException:
        return None


def _scan_preset(name: str) -> dict | None:
    root = PRESETS_DIR / name
    if not root.is_dir():
        return None
    avatar = root / "avatar.fbx"
    background = root / "background.png"
    view = root / "view.png"
    actions_dir = root / "animations"
    if not avatar.exists() or not actions_dir.exists():
        return None

    meta_file = root / "meta.json"
    meta = {}
    if meta_file.exists():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception:
            meta = {}

    actions = sorted([f.name for f in actions_dir.glob("*.fbx")])
    return {
        "name": name,
        "display_name": meta.get("display_name", name),
        "description": meta.get("description", ""),
        "hidden": bool(meta.get("hidden", False)),
        "avatar_url": f"/assets/presets/{name}/avatar.fbx",
        "view_url": f"/assets/presets/{name}/view.png" if view.exists() else "",
        "background_url": f"/assets/presets/{name}/background.png"
        if background.exists()
        else "",
        "actions": actions,
    }


def _resolve_keyword_preset(prompt: str) -> str | None:
    male_pos = max((m.start() for m in MALE_PRESET_RE.finditer(prompt)), default=-1)
    female_pos = max((m.start() for m in FEMALE_PRESET_RE.finditer(prompt)), default=-1)
    if male_pos < 0 and female_pos < 0:
        return None
    return "male" if male_pos > female_pos else "female"


def _resolve_voice_for_model(db: Session, user: User, model_id: int | None) -> str:
    if not model_id:
        return QWEN_VOICE

    row = db.get(UserModel, model_id)
    if not row or row.user_id != user.id:
        return QWEN_VOICE

    preset = str(row.preset_name or "").strip().lower()
    if preset in {"male", "man", "boy"}:
        return QWEN_VOICE_MALE or QWEN_VOICE
    if preset in {"female", "women", "woman", "girl"}:
        return QWEN_VOICE_FEMALE or QWEN_VOICE
    return QWEN_VOICE


def _apply_voice_hint(base_voice: str, voice_hint: str) -> str:
    hint = str(voice_hint or "").strip().lower()
    if hint in {"male", "man", "boy"}:
        return QWEN_VOICE_MALE or base_voice or QWEN_VOICE
    if hint in {"female", "woman", "girl"}:
        return QWEN_VOICE_FEMALE or base_voice or QWEN_VOICE
    return base_voice or QWEN_VOICE


MULTIMODAL_IMAGE_MIME = {"image/jpeg", "image/png", "image/webp"}
MULTIMODAL_DOC_MIME = {
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MULTIMODAL_ALLOWED_MIME = MULTIMODAL_IMAGE_MIME | MULTIMODAL_DOC_MIME
MAX_CHAT_FILE_SIZE = 10 * 1024 * 1024
MAX_RECORDING_FILE_SIZE = 120 * 1024 * 1024
CHAT_TEXT_TIMEOUT_SECONDS = 12
CHAT_VISION_TIMEOUT_SECONDS = 15
CHAT_REMOTE_RETRIES = 0
_LOCAL_ASR_MODEL_INSTANCE = None
_LOCAL_ASR_LOAD_ERROR = None


def _read_upload_bytes(upload: UploadFile) -> bytes:
    upload.file.seek(0)
    data = upload.file.read()
    upload.file.seek(0)
    return data


def _extract_text_from_document(upload: UploadFile, data: bytes) -> str:
    content_type = (upload.content_type or "").lower().strip()
    if content_type == "text/plain":
        return data.decode("utf-8", errors="ignore")[:4000].strip()
    return ""


def _decode_audio_for_local_asr(audio_bytes: bytes):
    try:
        import numpy as np
    except Exception as exc:
        raise RuntimeError("numpy is unavailable for local ASR") from exc

    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-f",
                "s16le",
                "-acodec",
                "pcm_s16le",
                "-ac",
                "1",
                "-ar",
                "16000",
                "pipe:1",
            ],
            input=audio_bytes,
            capture_output=True,
            check=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg is not installed") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(stderr or "ffmpeg failed to decode audio") from exc

    audio = np.frombuffer(result.stdout, np.int16).astype("float32") / 32768.0
    if audio.size == 0:
        raise RuntimeError("decoded audio is empty")
    return audio


def _get_local_asr_model():
    global _LOCAL_ASR_MODEL_INSTANCE, _LOCAL_ASR_LOAD_ERROR
    if _LOCAL_ASR_MODEL_INSTANCE is not None:
        return _LOCAL_ASR_MODEL_INSTANCE
    if _LOCAL_ASR_LOAD_ERROR is not None:
        raise RuntimeError(_LOCAL_ASR_LOAD_ERROR)

    try:
        from faster_whisper import WhisperModel

        _LOCAL_ASR_MODEL_INSTANCE = WhisperModel(
            LOCAL_ASR_MODEL or "tiny",
            device=LOCAL_ASR_DEVICE or "cpu",
            compute_type=LOCAL_ASR_COMPUTE_TYPE or "int8",
        )
        return _LOCAL_ASR_MODEL_INSTANCE
    except Exception as exc:
        _LOCAL_ASR_LOAD_ERROR = f"local Whisper initialization failed: {exc}"
        raise RuntimeError(_LOCAL_ASR_LOAD_ERROR) from exc


def _transcribe_with_local_asr(audio_bytes: bytes) -> str:
    model = _get_local_asr_model()
    audio = _decode_audio_for_local_asr(audio_bytes)
    segments, _ = model.transcribe(
        audio,
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    text = " ".join(str(segment.text or "").strip() for segment in segments).strip()
    return text


def _build_attachment_user_note(files_meta: list[dict]) -> str:
    if not files_meta:
        return ""
    parts: list[str] = []
    for item in files_meta:
        name = item.get("name") or "unnamed"
        mime = item.get("mime") or "application/octet-stream"
        size = int(item.get("size") or 0)
        summary = (item.get("summary") or "").strip()
        one = f"[{name}] mime:{mime} size:{size} bytes"
        if summary:
            one += f" summary:{summary[:500]}"
        parts.append(one)
    return "\n".join(parts)


def _looks_like_mp4(data: bytes) -> bool:
    return len(data) > 12 and data[4:8] == b"ftyp"


def _looks_like_video_upload(data: bytes, content_type: str, filename: str) -> bool:
    kind = (content_type or "").lower().strip()
    suffix = Path(filename or "").suffix.lower()
    if kind.startswith("video/mp4") or suffix in {".mp4", ".m4v"}:
        return _looks_like_mp4(data)
    if kind.startswith("video/ogg") or suffix == ".ogv":
        return data.startswith(b"OggS")
    if kind.startswith("video/webm") or suffix == ".webm":
        return data.startswith(b"\x1a\x45\xdf\xa3")
    return False



def _safe_json_response(resp: requests.Response) -> dict:
    if not resp.content:
        return {}
    try:
        return resp.json()
    except ValueError:
        return {}


def _post_with_retry(
    url: str,
    *,
    headers: dict,
    json_body: dict,
    timeout: int,
    retries: int = 2,
) -> requests.Response:
    for attempt in range(retries + 1):
        try:
            return requests.post(
                url,
                headers=headers,
                json=json_body,
                timeout=timeout,
            )
        except SSLError as exc:
            if attempt >= retries:
                raise HTTPException(
                    status_code=502,
                    detail="DashScope SSL connection failed",
                ) from exc
            time.sleep(0.4 * (attempt + 1))
        except RequestException as exc:
            if attempt >= retries:
                raise HTTPException(
                    status_code=502,
                    detail="DashScope network request failed",
                ) from exc
            time.sleep(0.4 * (attempt + 1))

    raise HTTPException(status_code=502, detail="DashScope request failed")


def _chat_text_with_ai(
    messages: list[dict], *, timeout: int = 45, retries: int = 2
) -> str:
    if not DASHSCOPE_API_KEY:
        raise HTTPException(status_code=502, detail="DashScope API key is not configured")
    headers = {
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": QWEN_TEXT_MODEL,
        "input": {"messages": messages},
        "parameters": {"temperature": 0.4, "max_tokens": 720},
    }
    resp = _post_with_retry(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
        headers=headers,
        json_body=payload,
        timeout=timeout,
        retries=retries,
    )
    data = _safe_json_response(resp)
    if not resp.ok:
        message = (
            data.get("message")
            or data.get("error", {}).get("message")
            or "DashScope text generation failed"
        )
        raise HTTPException(status_code=502, detail=message)
    text = (
        data.get("output", {}).get("text")
        or data.get("output", {})
        .get("choices", [{}])[0]
        .get("message", {})
        .get("content")
        or ""
    )
    answer = str(text).strip()
    if not answer:
        raise HTTPException(status_code=502, detail="DashScope returned an empty answer")
    return answer


def _chat_with_vision(prompt: str, image_meta: dict, doc_note: str) -> str:
    fallback_messages = [
        {
            "role": "system",
            "content": "You are a helpful multimodal avatar assistant.",
        },
        {"role": "user", "content": f"Prompt: {prompt}\nAttachments: {doc_note or 'none'}"},

    ]
    if not DASHSCOPE_API_KEY:
        return _chat_text_with_ai(fallback_messages)

    image_data_url = image_meta.get("data_url") or ""
    user_text = f"Prompt: {prompt or 'none'}\nAttachments: {doc_note or 'none'}"

    payload = {
        "model": QWEN_VISION_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful multimodal avatar assistant.",
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
    }
    headers = {
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        resp = _post_with_retry(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            headers=headers,
            json_body=payload,
            timeout=CHAT_VISION_TIMEOUT_SECONDS,
            retries=CHAT_REMOTE_RETRIES,
        )
    except HTTPException:
        return _chat_text_with_ai(
            fallback_messages,
            timeout=CHAT_TEXT_TIMEOUT_SECONDS,
            retries=CHAT_REMOTE_RETRIES,
        )

    data = _safe_json_response(resp)
    if not resp.ok:
        return _chat_text_with_ai(
            fallback_messages,
            timeout=CHAT_TEXT_TIMEOUT_SECONDS,
            retries=CHAT_REMOTE_RETRIES,
        )
    text = data.get("choices", [{}])[0].get("message", {}).get("content") or ""
    answer = str(text).strip()
    if answer:
        return answer
    return _chat_text_with_ai(
        fallback_messages,
        timeout=CHAT_TEXT_TIMEOUT_SECONDS,
        retries=CHAT_REMOTE_RETRIES,
    )


def _synthesize_reply_audio_local(answer_text: str, voice: str) -> tuple[str, str]:
    content = str(answer_text or "").strip()
    if not content:
        return "", "Local TTS received an empty answer"

    file_name = f"chat_reply_{uuid.uuid4().hex}.wav"
    out_path = CHAT_AUDIO_DIR / file_name
    env = {
        **os.environ,
        "IA_TTS_TEXT": content[:1200],
        "IA_TTS_VOICE": str(voice or "").strip(),
        "IA_TTS_OUT": str(out_path),
    }
    script = r"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voiceHint = [string]$env:IA_TTS_VOICE
  $voices = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }
  $candidate = $null
  if ($voiceHint -match 'male|moon') {
    $candidate = $voices | Where-Object { $_.Name -match 'male|david|guy' } | Select-Object -First 1
  } elseif ($voiceHint -match 'female|cherry') {
    $candidate = $voices | Where-Object { $_.Name -match 'female|zira|hazel' } | Select-Object -First 1
  }
  if (-not $candidate) {
    $candidate = $voices | Select-Object -First 1
  }
  if ($candidate) {
    $s.SelectVoice($candidate.Name)
  }
  $s.SetOutputToWaveFile($env:IA_TTS_OUT)
  $s.Speak($env:IA_TTS_TEXT)
} finally {
  $s.Dispose()
}
"""
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-EncodedCommand", encoded],
            env=env,
            capture_output=True,
            check=True,
            timeout=60,
        )
        if not out_path.exists() or out_path.stat().st_size == 0:
            return "", "Local TTS did not produce an audio file"
        return f"/assets/chat_audio/{file_name}", ""
    except Exception as exc:
        out_path.unlink(missing_ok=True)
        return "", f"Local TTS failed: {exc}"


def _synthesize_reply_audio(
    answer_text: str, voice: str, *, allow_default_fallback: bool = False
) -> tuple[str, str]:
    if not DASHSCOPE_API_KEY or not answer_text.strip():
        return "", "Server-side TTS is unavailable"

    payload = {
        "model": QWEN_TTS_MODEL,
        "input": answer_text[:1200],
        "voice": voice or QWEN_VOICE,
        "response_format": "mp3",
    }
    headers = {
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "audio/mpeg, application/json",
    }

    def _extract_error_message(resp: requests.Response, data: dict) -> str:
        message = data.get("message") or data.get("error", {}).get("message")
        if message:
            return str(message)
        snippet = (resp.text or "")[:180].strip()
        if snippet:
            return f"TTS request failed with HTTP {resp.status_code}: {snippet}"
        return f"TTS request failed with HTTP {resp.status_code}"

    def _run_tts_once(target_voice: str) -> tuple[str, str]:
        one_payload = {**payload, "voice": target_voice or QWEN_VOICE}
        try:
            resp = _post_with_retry(
                "https://dashscope.aliyuncs.com/compatible-mode/v1/audio/speech",
                headers=headers,
                json_body=one_payload,
                timeout=45,
                retries=1,
            )
            data = _safe_json_response(resp)
            if not resp.ok:
                return "", _extract_error_message(resp, data)

            content_type = (resp.headers.get("content-type") or "").lower()
            if "application/json" in content_type:
                return "", _extract_error_message(resp, data)

            if not resp.content:
                return "", "TTS returned an empty audio payload"

            file_name = f"chat_reply_{uuid.uuid4().hex}.mp3"
            out_path = CHAT_AUDIO_DIR / file_name
            out_path.write_bytes(resp.content)
            return f"/assets/chat_audio/{file_name}", ""
        except HTTPException as exc:
            return "", str(exc.detail)
        except Exception as exc:
            return "", f"TTS request failed: {exc}"

    primary_url, primary_error = _run_tts_once(voice or QWEN_VOICE)
    if primary_url:
        return primary_url, ""

    fallback_voice = QWEN_VOICE
    if (
        allow_default_fallback
        and (voice or "").strip()
        and (voice or "").strip() != fallback_voice
    ):
        fallback_url, fallback_error = _run_tts_once(fallback_voice)
        if fallback_url:
            return fallback_url, ""
        primary_error = f"{primary_error}; fallback voice also failed: {fallback_error}"

    local_url, local_error = _synthesize_reply_audio_local(
        answer_text, voice or fallback_voice
    )
    if local_url:
        return local_url, ""

    if local_error:
        return "", f"{primary_error}; {local_error}"
    return "", primary_error


def _generate_local_chat_reply(
    user_text: str,
    attachment_note: str,
    files_meta: list[dict],
    *,
    reason: str = "",
) -> str:
    prompt = str(user_text or "").strip()
    prompt_lower = prompt.lower()

    if not prompt and files_meta:
        first_name = files_meta[0].get("name") or "the uploaded file"
        return (
            f"I received {len(files_meta)} attachment(s), including {first_name}. "
            "The remote AI service is temporarily unavailable, but your files were accepted. "
            "Please ask a specific question about the attachment and I will keep helping."
        )

    if any(word in prompt_lower for word in {"hello", "hi", "hey", "你好", "您好"}):
        return (
            "Hello. The remote AI service is temporarily unavailable, so I switched to local fallback mode. "
            "You can still continue with text, attachments, rigging, scene setup, and recordings."
        )

    if any(word in prompt_lower for word in {"summary", "summarize", "总结", "概括"}):
        if attachment_note:
            return (
                "Here is a local summary fallback: "
                f"{attachment_note[:600]}. "
                "The remote AI summary service is temporarily unavailable."
            )
        return (
            "The remote AI summary service is temporarily unavailable. "
            f"Your latest request was: {prompt[:500]}"
        )

    if any(word in prompt_lower for word in {"who are you", "你是谁", "what can you do", "你能做什么"}):
        return (
            "I am the avatar assistant running in local fallback mode. "
            "I can acknowledge your request, keep the interaction session active, "
            "track uploaded attachments, and continue the workflow while the cloud model recovers."
        )

    parts = []
    if prompt:
        parts.append(f"I received your request: {prompt[:600]}.")
    if attachment_note:
        parts.append(f"Attachment context: {attachment_note[:600]}.")
    parts.append(
        "The cloud language model is temporarily unavailable, so this answer was generated locally. "
        "You can continue the workflow and retry later for a richer AI response."
    )
    if reason:
        parts.append(f"Service detail: {reason[:240]}.")
    return " ".join(parts)


def _pick_scene_fallback(prompt: str) -> dict:
    library = scenes_library(query=prompt or "office", page=1, per_page=6)
    items = library.get("items") or []
    if items:
        item = items[0]
        return {
            "id": str(item.get("id") or f"fallback_{uuid.uuid4().hex[:12]}"),
            "thumb_url": item.get("thumb_url") or item.get("full_url") or "",
            "full_url": item.get("full_url") or item.get("thumb_url") or "",
            "title": item.get("title") or "Fallback background",
            "source": f"{item.get('source') or 'library'}_fallback",
        }
    return {
        "id": f"fallback_{uuid.uuid4().hex[:12]}",
        "thumb_url": "/textures/BackGround.jpg",
        "full_url": "/textures/BackGround.jpg",
        "title": "Fallback background",
        "source": "local_fallback",
    }


def _upsert_interaction_session(
    db: Session,
    user: User,
    model_id: int | None,
    session_id: int | None,
) -> InteractionSession:
    session_row: InteractionSession | None = None
    if session_id:
        row = db.get(InteractionSession, int(session_id))
        if row and row.user_id == user.id:
            session_row = row
            if model_id and row.model_id != model_id:
                owner_model = db.get(UserModel, int(model_id))
                if owner_model and owner_model.user_id == user.id:
                    session_row.model_id = int(model_id)
                    db.commit()
                    db.refresh(session_row)

    if not session_row:
        session_row = InteractionSession(
            user_id=user.id, model_id=model_id, started_at=_now()
        )
        db.add(session_row)
        db.commit()
        db.refresh(session_row)
    return session_row


def _build_preset_pipeline_response(
    item: dict,
    *,
    preset_name: str,
    source: str,
    user: User | None,
    db: Session,
    route: str | None = None,
) -> dict:
    data = {
        "status": "ok",
        "source": source,
        "output_model_url": item["avatar_url"],
        "viewer_url": item["avatar_url"],
        "preset_name": preset_name,
        "background_url": item["background_url"],
        "view_url": item.get("view_url", ""),
    }
    if route:
        data["route"] = route
    if user:
        row = _save_user_model(
            db,
            user,
            source_type="preset",
            model_url=item["avatar_url"],
            preset_name=preset_name,
            cover_url=item.get("view_url") or item["background_url"],
        )
        data["model_id"] = row.id
    return data


def _validate_presets_integrity() -> None:
    if not PRESETS_DIR.exists():
        return

    errors = []
    for child in sorted(PRESETS_DIR.iterdir()):
        if not child.is_dir():
            continue
        avatar = child / "avatar.fbx"
        background = child / "background.png"
        actions_dir = child / "animations"
        actions = list(actions_dir.glob("*.fbx")) if actions_dir.exists() else []

        if not avatar.exists():
            errors.append(f"{child.name}: missing avatar.fbx")
        if not background.exists():
            errors.append(f"{child.name}: missing background.png")
        if not actions_dir.exists():
            errors.append(f"{child.name}: missing animations directory")
        elif not actions:
            errors.append(f"{child.name}: animations directory has no fbx files")

    if errors:
        joined = "\n".join(errors)
        raise RuntimeError(f"Preset integrity check failed:\n{joined}")


def _save_user_model(
    db: Session,
    user: User,
    source_type: str,
    model_url: str,
    preset_name: str | None = None,
    cover_url: str | None = None,
) -> UserModel:
    row = UserModel(
        user_id=user.id,
        source_type=source_type,
        preset_name=preset_name,
        model_url=model_url,
        cover_url=cover_url,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _resolve_cover_version(row: UserModel) -> int:
    try:
        if row.preset_name:
            path = PRESETS_DIR / row.preset_name / "view.png"
            return int(path.stat().st_mtime)
        cover_url = str(row.cover_url or "")
        if cover_url.startswith("/assets/models/"):
            path = MODELS_DIR / Path(cover_url).name
            return int(path.stat().st_mtime)
    except Exception:
        pass
    try:
        return int(row.created_at.timestamp())
    except Exception:
        return int(time.time())


def _build_summary(events: Sequence[InteractionEvent]) -> str:
    user_lines = [e.text for e in events if e.role == "user" and e.text.strip()]
    assistant_lines = [
        e.text for e in events if e.role == "assistant" and e.text.strip()
    ]
    first_user = user_lines[0] if user_lines else ""
    last_user = user_lines[-1] if user_lines else ""
    last_assistant = assistant_lines[-1] if assistant_lines else ""

    parts = []
    if first_user:
        parts.append(f"User: {first_user}")
    if last_user and last_user != first_user:
        parts.append(f"Latest user: {last_user}")
    if last_assistant:
        parts.append(f"Assistant: {last_assistant}")
    if not parts:
        return "No meaningful conversation summary available."
    text = " | ".join(parts)
    return text[:300]


def _build_summary_with_ai(events: Sequence[InteractionEvent]) -> str:
    fallback = _build_summary(events)
    if not DASHSCOPE_API_KEY:
        return fallback

    lines = []
    for event in events[-32:]:
        text = (event.text or "").strip()
        if not text:
            continue
        role = "User" if event.role == "user" else "Assistant"
        lines.append(f"{role}: {text}")
    if not lines:
        return fallback

    prompt = "\n".join(lines)

    payload = {
        "model": QWEN_TEXT_MODEL,
        "input": {
            "messages": [
                {
                    "role": "system",
                    "content": "?????????????????? 2 ? 4 ????????????????????????????????????",
                },
                {"role": "user", "content": prompt},
            ]
        },
        "parameters": {"temperature": 0.2, "max_tokens": 260},
    }
    headers = {
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
            headers=headers,
            json=payload,
            timeout=18,
        )
        data = resp.json() if resp.content else {}
        if not resp.ok:
            return fallback
        text = (
            data.get("output", {}).get("text")
            or data.get("output", {})
            .get("choices", [{}])[0]
            .get("message", {})
            .get("content")
            or ""
        )
        summary = str(text).strip()
        return summary[:300] if summary else fallback
    except Exception:
        return fallback


def _fallback_polish_prompt(prompt: str) -> str:
    text = re.sub(r"\s+", " ", prompt).strip(" ???;,")
    if len(text) < 6:
        return f"???????????????{text}??????????????????"
    if text.endswith("?"):
        text = text[:-1]
    return (
        f"????? 3D ?????????{text}?"
        "????????????????????????????????????????????????"
    )


def _polish_prompt_with_ai(prompt: str) -> str:
    if not DASHSCOPE_API_KEY:
        return _fallback_polish_prompt(prompt)

    instruction = (
        "?? 3D ???????????????????????????????????????? 3D ??????"
        "????????????????????????"
    )
    payload = {
        "model": QWEN_TEXT_MODEL,
        "input": {
            "messages": [
                {"role": "system", "content": instruction},
                {"role": "user", "content": prompt},
            ]
        },
        "parameters": {"temperature": 0.5, "max_tokens": 320},
    }
    headers = {
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
            headers=headers,
            json=payload,
            timeout=20,
        )
        data = resp.json() if resp.content else {}
        if not resp.ok:
            return _fallback_polish_prompt(prompt)
        text = (
            data.get("output", {}).get("text")
            or data.get("output", {})
            .get("choices", [{}])[0]
            .get("message", {})
            .get("content")
            or ""
        )
        polished = str(text).strip()
        return polished if polished else _fallback_polish_prompt(prompt)
    except Exception:
        return _fallback_polish_prompt(prompt)


def _fallback_polish_scene_prompt(prompt: str) -> str:
    text = re.sub(r"\s+", " ", prompt).strip(" ???;,")
    if len(text) < 6:
        return f"???????????????{text}????????????????"
    if text.endswith("?"):
        text = text[:-1]
    return (
        f"???????????????????????{text}?"
        "????????????????????????????????????????"
    )


def _polish_scene_prompt_with_ai(prompt: str) -> str:
    if not DASHSCOPE_API_KEY:
        return _fallback_polish_scene_prompt(prompt)

    instruction = (
        "??????????????????????????????????????????????"
        "????????????????????????"
    )
    payload = {
        "model": QWEN_TEXT_MODEL,
        "input": {
            "messages": [
                {"role": "system", "content": instruction},
                {"role": "user", "content": prompt},
            ]
        },
        "parameters": {"temperature": 0.5, "max_tokens": 320},
    }
    headers = {
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
            headers=headers,
            json=payload,
            timeout=20,
        )
        data = resp.json() if resp.content else {}
        if not resp.ok:
            return _fallback_polish_scene_prompt(prompt)
        text = (
            data.get("output", {}).get("text")
            or data.get("output", {})
            .get("choices", [{}])[0]
            .get("message", {})
            .get("content")
            or ""
        )
        polished = str(text).strip()
        return polished if polished else _fallback_polish_scene_prompt(prompt)
    except Exception:
        return _fallback_polish_scene_prompt(prompt)


def _scene_library_fallback() -> list[dict]:
    return [
        {
            "id": "local-black",
            "thumb_url": "/textures/Black.jpg",
            "full_url": "/textures/Black.jpg",
            "title": "纯色背景",
            "author": "Local",
            "author_url": "",
            "source": "local",
        },
        {
            "id": "local-background",
            "thumb_url": "/textures/BackGround.jpg",
            "full_url": "/textures/BackGround.jpg",
            "title": "渐变背景",
            "author": "Local",
            "author_url": "",
            "source": "local",
        },
        {
            "id": "local-book",
            "thumb_url": "/textures/Book.jpg",
            "full_url": "/textures/Book.jpg",
            "title": "书架背景",
            "author": "Local",
            "author_url": "",
            "source": "local",
        },
    ]


SCENE_QUERY_MAP = {
    "办公室": "office",
    "会议室": "meeting room",
    "教室": "classroom",
    "校园": "campus",
    "客厅": "living room",
    "卧室": "bedroom",
    "书房": "study room",
    "展厅": "exhibition hall",
    "舞台": "stage",
    "摄影棚": "studio",
    "科技": "technology",
    "未来": "futuristic",
    "自然": "nature",
    "森林": "forest",
    "海边": "beach",
    "城市": "city",
    "街道": "street",
    "夜景": "night city",
    "阳光": "sunlight",
}


def _normalize_scene_query(query: str) -> str:
    text = str(query or "").strip()
    if not text:
        return "office"
    if not re.search(r"[一-鿿]", text):
        return text

    mapped = []
    for key, value in SCENE_QUERY_MAP.items():
        if key in text:
            mapped.append(value)
    if mapped:
        return " ".join(dict.fromkeys(mapped))
    return "office"


def _generate_scene_image(prompt: str) -> str:
    if not DASHSCOPE_API_KEY:
        raise HTTPException(
            status_code=400, detail="DASHSCOPE_API_KEY 未配置，无法生成场景图像"
        )

    payload = {
        "model": QWEN_IMAGE_MODEL,
        "input": {"prompt": prompt},
        "parameters": {"size": "1280*720", "n": 1},
    }
    headers = {
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
    }
    try:
        resp = requests.post(
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
            headers=headers,
            json=payload,
            timeout=45,
        )
        data = resp.json() if resp.content else {}
        if not resp.ok:
            message = data.get("message") or "场景图像生成失败"
            if "does not support synchronous calls" in str(message):
                message = "当前图像模型仅支持异步调用，请稍后重试"
            raise HTTPException(status_code=400, detail=message)

        output = data.get("output") or {}
        results = output.get("results") or []
        if results and results[0].get("url"):
            return str(results[0]["url"])

        task_id = output.get("task_id") or data.get("task_id")
        if task_id:
            deadline = time.time() + 40
            while time.time() < deadline:
                poll = requests.get(
                    f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}",
                    headers=headers,
                    timeout=20,
                )
                poll_data = poll.json() if poll.content else {}
                poll_output = poll_data.get("output") or {}
                status = str(poll_output.get("task_status") or "").upper()
                poll_results = poll_output.get("results") or []
                if poll_results and poll_results[0].get("url"):
                    return str(poll_results[0]["url"])
                if (
                    status in {"SUCCEEDED", "DONE"}
                    and poll_results
                    and poll_results[0].get("url")
                ):
                    return str(poll_results[0]["url"])
                if status in {"FAILED", "FAIL", "CANCELED", "CANCELLED"}:
                    break
                time.sleep(1.0)
        raise HTTPException(status_code=400, detail="背景图生成未返回有效图片")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"背景图生成失败：{exc}") from exc


@app.post("/auth/captcha/request")
def auth_request_captcha(
    db: Annotated[Session, Depends(get_db)], payload: dict | None = None
) -> dict:
    payload = payload or {}
    purpose = str(payload.get("purpose", "register")).strip().lower()
    if purpose not in {"register", "reset_password"}:
        raise HTTPException(status_code=400, detail="不支持的验证码用途")
    provider = _human_verification_provider()
    if provider == "turnstile":
        return {
            "provider": "turnstile",
            "site_key": TURNSTILE_SITE_KEY,
            "action": purpose,
            "purpose": purpose,
        }
    challenge = _create_captcha_challenge(db, purpose)
    return {
        "provider": "math",
        "challenge_id": challenge.challenge_id,
        "prompt": challenge.prompt,
        "expires_in_seconds": CAPTCHA_TTL_SECONDS,
        "purpose": purpose,
    }


@app.post("/auth/register/send-code")
def auth_register_send_code(
    payload: dict,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    phone_number = _normalize_phone_number(payload.get("phone_number", ""))
    if db.scalar(select(User).where(User.phone_number == phone_number)):
        raise HTTPException(status_code=409, detail="该手机号已注册")
    _verify_human_challenge(db, request, payload, "register")
    return _issue_sms_code(db, phone_number, "register")


@app.post("/auth/register")
def auth_register(payload: dict, db: Annotated[Session, Depends(get_db)]) -> dict:
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    phone_number = _normalize_phone_number(payload.get("phone_number", ""))
    sms_code = str(payload.get("sms_code", "")).strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="用户名仅支持 4-32 位字母、数字或下划线")
    if len(password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=400, detail=f"密码长度至少 {PASSWORD_MIN_LENGTH} 位")
    if not re.fullmatch(r"\d{6}", sms_code):
        raise HTTPException(status_code=400, detail="请输入 6 位短信验证码")
    if db.scalar(select(User).where(User.username == username)):
        raise HTTPException(status_code=409, detail="用户名已存在")
    if db.scalar(select(User).where(User.phone_number == phone_number)):
        raise HTTPException(status_code=409, detail="该手机号已注册")

    _consume_sms_code(db, phone_number, "register", sms_code)

    user = User(
        username=username,
        password_hash=hash_password(password),
        phone_number=phone_number,
        phone_verified_at=_now(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.username)
    return {
        "token": token,
        "user": _serialize_user(user),
    }


@app.post("/auth/login")
def auth_login(payload: dict, db: Annotated[Session, Depends(get_db)]) -> dict:
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    user = db.scalar(select(User).where(User.username == username))
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    user.last_login_at = _now()
    db.commit()

    token = create_access_token(user.id, user.username)
    return {
        "token": token,
        "user": _serialize_user(user),
    }


@app.post("/auth/password/send-reset-code")
def auth_send_reset_code(
    payload: dict,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    phone_number = _normalize_phone_number(payload.get("phone_number", ""))
    user = db.scalar(select(User).where(User.phone_number == phone_number))
    if not user:
        raise HTTPException(status_code=404, detail="该手机号未绑定账号")
    _verify_human_challenge(db, request, payload, "reset_password")
    return _issue_sms_code(db, phone_number, "reset_password")


@app.post("/auth/password/reset")
def auth_reset_password(payload: dict, db: Annotated[Session, Depends(get_db)]) -> dict:
    phone_number = _normalize_phone_number(payload.get("phone_number", ""))
    sms_code = str(payload.get("sms_code", "")).strip()
    new_password = str(payload.get("new_password", ""))
    if len(new_password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=400, detail=f"新密码长度至少 {PASSWORD_MIN_LENGTH} 位")
    if not re.fullmatch(r"\d{6}", sms_code):
        raise HTTPException(status_code=400, detail="请输入 6 位短信验证码")

    user = db.scalar(select(User).where(User.phone_number == phone_number))
    if not user:
        raise HTTPException(status_code=404, detail="该手机号未绑定账号")

    _consume_sms_code(db, phone_number, "reset_password", sms_code)
    user.password_hash = hash_password(new_password)
    user.phone_verified_at = user.phone_verified_at or _now()
    db.commit()
    return {"ok": True, "message": "密码已重置，请使用新密码登录"}


@app.get("/auth/me")
def auth_me(user: Annotated[User, Depends(get_current_user)]) -> dict:
    return {"user": _serialize_user(user)}


@app.get("/presets")
def list_presets() -> dict:
    items = []
    if PRESETS_DIR.exists():
        for child in sorted(PRESETS_DIR.iterdir()):
            if not child.is_dir():
                continue
            item = _scan_preset(child.name)
            if item and not item.get("hidden", False):
                items.append(item)
    return {"items": items}


@app.get("/presets/{name}")
def get_preset(name: str) -> dict:
    item = _scan_preset(name)
    if not item:
        raise HTTPException(status_code=404, detail="Preset not found")
    return item


@app.get("/presets/{name}/animations")
def get_preset_animations(name: str) -> dict:
    item = _scan_preset(name)
    if not item:
        raise HTTPException(status_code=404, detail="Preset not found")
    items = [
        {
            "file_name": file_name,
            "display_name": Path(file_name).stem.replace("_", " "),
            "file_url": f"/assets/presets/{name}/animations/{file_name}",
        }
        for file_name in item["actions"]
    ]
    return {"items": items}


@app.post("/models/save")
def save_model(
    payload: dict,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    source_type = str(payload.get("source_type", "preset"))
    model_url = str(payload.get("model_url", "")).strip()
    if not model_url:
        raise HTTPException(status_code=400, detail="model_url is required")
    row = _save_user_model(
        db,
        user,
        source_type=source_type,
        model_url=model_url,
        preset_name=payload.get("preset_name"),
        cover_url=payload.get("cover_url"),
    )
    return {
        "id": row.id,
        "source_type": row.source_type,
        "preset_name": row.preset_name,
        "model_url": row.model_url,
        "cover_url": row.cover_url,
        "created_at": row.created_at,
    }


@app.get("/models/my")
def my_models(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    page: int = 1,
    page_size: int = 20,
) -> dict:
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    stmt = (
        select(UserModel)
        .where(UserModel.user_id == user.id)
        .order_by(desc(UserModel.created_at))
    )
    rows = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    total = db.scalar(
        select(func.count()).select_from(UserModel).where(UserModel.user_id == user.id)
    ) or 0
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "items": [
            {
                "id": row.id,
                "source_type": row.source_type,
                "preset_name": row.preset_name,
                "model_url": row.model_url,
                "cover_url": (
                    f"/assets/presets/{row.preset_name}/view.png"
                    if row.source_type == "preset" and row.preset_name
                    else row.cover_url
                ),
                "cover_version": _resolve_cover_version(row),
                "created_at": row.created_at,
            }
            for row in rows
        ],
    }


@app.get("/pipeline/text")
def invalid_text_get() -> dict:
    raise HTTPException(status_code=405, detail="Use POST")


@app.post("/pipeline/text")
def pipeline_text(
    payload: dict,
    user: Annotated[User | None, Depends(get_current_user_optional)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    prompt = str(payload.get("prompt", "")).strip()
    if len(prompt) < 2:
        raise HTTPException(status_code=400, detail="prompt is required")

    keyword_preset = _resolve_keyword_preset(prompt)
    if keyword_preset:
        item = _scan_preset(keyword_preset)
        if item:
            return _build_preset_pipeline_response(
                item,
                preset_name=keyword_preset,
                source="text",
                user=user,
                db=db,
                route="preset_keyword",
            )

    try:
        model_path = meshy.text_to_model(prompt)
    except MeshyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    data = _make_pipeline_response(model_path, "text")
    if user:
        row = _save_user_model(
            db,
            user,
            "text",
            data["output_model_url"],
            cover_url="/assets/models/model-placeholder.jpg",
        )
        data["model_id"] = row.id
    return data


@app.post("/pipeline/polish-text")
def pipeline_polish_text(payload: dict) -> dict:
    prompt = str(payload.get("prompt", "")).strip()
    if len(prompt) < 2:
        raise HTTPException(status_code=400, detail="prompt is required")
    polished = _polish_prompt_with_ai(prompt)
    return {"polished_prompt": polished}


@app.post("/pipeline/image")
def pipeline_image(
    file: UploadFile = File(...),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> dict:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload an image file")

    return _run_image_pipeline(
        file.file.read(),
        suffix=Path(file.filename or "img").suffix or ".png",
        user=user,
        db=db,
    )


def _run_image_pipeline(
    image_bytes: bytes,
    *,
    suffix: str = ".png",
    user: User | None,
    db: Session,
) -> dict:
    if not image_bytes:
        raise HTTPException(status_code=400, detail="image content is required")

    image_path = MODELS_DIR / f"upload_tmp_{uuid.uuid4().hex}{suffix or '.png'}"
    image_path.write_bytes(image_bytes)
    cover_url = ""
    if user:
        cover_path = MODELS_DIR / f"upload_cover_{uuid.uuid4().hex}{suffix or '.png'}"
        cover_path.write_bytes(image_bytes)
        cover_url = f"/assets/models/{cover_path.name}"

    try:
        model_path = meshy.image_to_model(image_path)
    except MeshyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if image_path.exists():
            image_path.unlink(missing_ok=True)

    data = _make_pipeline_response(model_path, "image")
    if user:
        row = _save_user_model(
            db,
            user,
            "image",
            data["output_model_url"],
            cover_url=cover_url,
        )
        data["model_id"] = row.id
        data["cover_url"] = row.cover_url
    return data


@app.post("/pipeline/retry")
def pipeline_retry(
    payload: dict,
    user: Annotated[User | None, Depends(get_current_user_optional)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    retry_type = str(payload.get("type", "")).strip().lower()
    if retry_type == "text":
        prompt = str(payload.get("prompt", "")).strip()
        if len(prompt) < 2:
            raise HTTPException(status_code=400, detail="prompt is required")

        keyword_preset = _resolve_keyword_preset(prompt)
        if keyword_preset:
            item = _scan_preset(keyword_preset)
            if item:
                return _build_preset_pipeline_response(
                    item,
                    preset_name=keyword_preset,
                    source="text",
                    user=user,
                    db=db,
                    route="preset_keyword",
                )

        try:
            model_path = meshy.text_to_model(prompt)
        except MeshyError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        data = _make_pipeline_response(model_path, "text")
        if user:
            row = _save_user_model(
                db,
                user,
                "text",
                data["output_model_url"],
                cover_url="/assets/models/model-placeholder.jpg",
            )
            data["model_id"] = row.id
        return data

    if retry_type != "image":
        raise HTTPException(
            status_code=400, detail="Only text/image retry is supported"
        )

    image_data_url = str(payload.get("image_data_url", "")).strip()
    if not image_data_url:
        raise HTTPException(status_code=400, detail="image_data_url is required")

    match = re.match(
        r"^data:image/(?P<fmt>[a-zA-Z0-9.+-]+);base64,(?P<data>.+)$", image_data_url
    )
    if not match:
        raise HTTPException(status_code=400, detail="Invalid image_data_url format")

    fmt = match.group("fmt").lower()
    suffix = f".{fmt.split('.')[-1]}"
    try:
        image_bytes = base64.b64decode(match.group("data"), validate=True)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail="Invalid image base64 data"
        ) from exc

    return _run_image_pipeline(image_bytes, suffix=suffix, user=user, db=db)


@app.post("/pipeline/preset")
def pipeline_preset(
    payload: dict,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    preset_name = str(payload.get("preset_name", "")).strip()
    item = _scan_preset(preset_name)
    if not item:
        raise HTTPException(status_code=404, detail="Preset not found")

    return _build_preset_pipeline_response(
        item,
        preset_name=preset_name,
        source="preset",
        user=user,
        db=db,
    )


@app.post("/pipeline/rig")
def pipeline_rig(
    payload: dict, user: Annotated[User, Depends(get_current_user)]
) -> dict:
    model_url = str(payload.get("model_url", "")).strip()
    markers = payload.get("markers")
    if not model_url.startswith("/assets/models/") and not model_url.startswith(
        "/assets/presets/"
    ):
        raise HTTPException(status_code=400, detail="Invalid model_url")
    if not isinstance(markers, dict):
        raise HTTPException(status_code=400, detail="markers is required")

    task_id = uuid.uuid4().hex
    rig_tasks[task_id] = {
        "task_id": task_id,
        "user_id": user.id,
        "created_at": time.time(),
        "duration": 10.0,
        "model_url": model_url,
        "markers": markers,
    }
    return {"status": "accepted", "task_id": task_id}


@app.get("/pipeline/rig/{task_id}")
def pipeline_rig_status(
    task_id: str, user: Annotated[User, Depends(get_current_user)]
) -> dict:
    task = rig_tasks.get(task_id)
    if not task or task.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Task not found")

    elapsed = max(0.0, time.time() - task["created_at"])
    duration = task["duration"]
    progress = min(100, int((elapsed / duration) * 100))
    if elapsed >= duration:
        return {
            "task_id": task_id,
            "status": "completed",
            "progress": 100,
            "output_model_url": task["model_url"],
        }

    return {
        "task_id": task_id,
        "status": "processing",
        "progress": progress,
    }


@app.get("/animations")
def get_animations(preset_name: str | None = None) -> dict:
    items = []
    if preset_name:
        preset = _scan_preset(preset_name)
        if not preset:
            raise HTTPException(status_code=404, detail="Preset not found")
        for file_name in preset["actions"]:
            items.append(
                {
                    "file_name": file_name,
                    "display_name": Path(file_name).stem.replace("_", " "),
                    "file_url": f"/assets/presets/{preset_name}/animations/{file_name}",
                }
            )
        return {"items": items}

    for file in sorted(ANIMATIONS_DIR.glob("*.fbx")):
        items.append(
            {
                "file_name": file.name,
                "display_name": file.stem.replace("_", " "),
                "file_url": f"/assets/animations/{file.name}",
            }
        )
    return {"items": items}


@app.get("/scenes/library")
def scenes_library(query: str = "office", page: int = 1, per_page: int = 12) -> dict:
    page = max(1, page)
    per_page = max(1, min(30, per_page))
    normalized_query = _normalize_scene_query(query)

    if not UNSPLASH_ACCESS_KEY:
        return {"items": _scene_library_fallback(), "source": "local"}

    try:
        resp = requests.get(
            "https://api.unsplash.com/search/photos",
            headers={"Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}"},
            params={
                "query": normalized_query,
                "page": page,
                "per_page": per_page,
                "orientation": "landscape",
                "content_filter": "high",
            },
            timeout=20,
        )
        data = resp.json() if resp.content else {}
        if not resp.ok:
            return {"items": _scene_library_fallback(), "source": "local"}

        results = []
        for item in data.get("results", []):
            user = item.get("user") or {}
            links = item.get("links") or {}
            urls = item.get("urls") or {}
            results.append(
                {
                    "id": str(item.get("id") or uuid.uuid4().hex),
                    "thumb_url": urls.get("small") or urls.get("thumb") or "",
                    "full_url": urls.get("regular") or urls.get("full") or "",
                    "title": item.get("description")
                    or item.get("alt_description")
                    or str(item.get("slug") or "").replace("-", " ")
                    or str(item.get("id") or "Untitled"),
                    "author": user.get("name") or "Unsplash",
                    "author_url": links.get("html") or "",
                    "source": "unsplash",
                }
            )

        if not results:
            return {"items": _scene_library_fallback(), "source": "local"}
        return {"items": results, "source": "unsplash"}
    except Exception:
        return {"items": _scene_library_fallback(), "source": "local"}


@app.post("/scenes/generate")
def scenes_generate(
    payload: dict, user: Annotated[User, Depends(get_current_user)]
) -> dict:
    prompt = str(payload.get("prompt", "")).strip()
    if len(prompt) < 2:
        raise HTTPException(status_code=400, detail="prompt is required")
    try:
        image_url = _generate_scene_image(prompt)
        return {
            "id": f"ai_{uuid.uuid4().hex[:12]}",
            "thumb_url": image_url,
            "full_url": image_url,
            "title": f"AI generated: {prompt}",
            "source": "ai",
        }
    except HTTPException as exc:
        fallback = _pick_scene_fallback(prompt)
        return {
            **fallback,
            "warning": "AI scene generation is temporarily unavailable. A fallback background was applied.",
        }


@app.get("/scenes/proxy-image")
def scenes_proxy_image(url: str) -> Response:
    target = str(url or "").strip()
    if not re.match(r"^https?://", target, flags=re.I):
        raise HTTPException(status_code=400, detail="Invalid image url")
    try:
        resp = requests.get(target, timeout=25)
        if not resp.ok:
            raise HTTPException(status_code=400, detail="Image fetch failed")
        content_type = (
            (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        )
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Target is not an image")
        return Response(
            content=resp.content,
            media_type=content_type or "image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Image proxy failed: {exc}"
        ) from exc


@app.post("/scenes/polish-text")
def scenes_polish_text(payload: dict) -> dict:
    prompt = str(payload.get("prompt", "")).strip()
    if len(prompt) < 2:
        raise HTTPException(status_code=400, detail="prompt is required")
    polished = _polish_scene_prompt_with_ai(prompt)
    return {"polished_prompt": polished}


@app.post("/speech/transcribe")
def speech_transcribe(file: UploadFile = File(...)) -> dict:
    if not file.content_type or not file.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Please upload an audio file")

    audio_bytes = file.file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio payload is empty")

    remote_error = ""
    if DASHSCOPE_API_KEY:
        headers = {"Authorization": f"Bearer {DASHSCOPE_API_KEY}"}
        try:
            resp = requests.post(
                "https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions",
                headers=headers,
                data={"model": QWEN_ASR_MODEL},
                files={
                    "file": (
                        file.filename or f"speech_{uuid.uuid4().hex}.webm",
                        audio_bytes,
                        file.content_type,
                    )
                },
                timeout=45,
            )
            data = _safe_json_response(resp)
            if resp.ok:
                text = str(data.get("text") or data.get("result") or "").strip()
                if text:
                    return {"text": text, "source": "dashscope"}
                remote_error = "DashScope returned an empty transcription"
            else:
                remote_error = (
                    data.get("error", {}).get("message")
                    or data.get("message")
                    or f"DashScope ASR failed with HTTP {resp.status_code}"
                )
        except Exception as exc:
            remote_error = str(exc)
    else:
        remote_error = "DashScope API key is not configured"

    try:
        text = _transcribe_with_local_asr(audio_bytes)
        if not text:
            raise RuntimeError("local ASR returned an empty transcription")
        warning = (
            f"Remote ASR unavailable: {remote_error}. Local Whisper fallback was used."
            if remote_error
            else ""
        )
        return {"text": text, "source": "local_whisper", "warning": warning}
    except Exception as exc:
        detail = "Speech transcription failed"
        if remote_error:
            detail += f". Remote ASR error: {remote_error}"
        detail += f". Local ASR error: {exc}"
        raise HTTPException(status_code=503, detail=detail) from exc


@app.post("/chat/multimodal")
def chat_multimodal(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    text: str = Form(""),
    model_id: int | None = Form(None),
    session_id: int | None = Form(None),
    voice_hint: str = Form(""),
    files: list[UploadFile] = File(default_factory=list),
) -> dict:
    user_text = str(text or "").strip()
    if not user_text and not files:
        raise HTTPException(status_code=400, detail="请至少输入文本或上传一个文件")

    files_meta: list[dict] = []
    image_meta: dict | None = None
    for upload in files[:6]:
        content_type = (upload.content_type or "").lower().strip()
        if content_type not in MULTIMODAL_ALLOWED_MIME:
            raise HTTPException(
                status_code=400,
                detail=f"?????????{content_type or 'unknown'}",
            )

        data = _read_upload_bytes(upload)
        if not data:
            continue
        if len(data) > MAX_CHAT_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"?????{upload.filename}????? 10MB ??",
            )

        summary = _extract_text_from_document(upload, data)
        item = {
            "name": upload.filename or "unnamed",
            "mime": content_type,
            "size": len(data),
            "summary": summary,
        }
        if content_type in MULTIMODAL_IMAGE_MIME and image_meta is None:
            data_url = (
                f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}"
            )
            image_meta = {**item, "data_url": data_url}
        files_meta.append(item)

    attachment_note = _build_attachment_user_note(files_meta)
    local_reply_reason = ""

    try:
        if image_meta is not None:
            answer_text = _chat_with_vision(user_text, image_meta, attachment_note)
        else:
            prompt_messages = [
                {
                    "role": "system",
                    "content": "You are a helpful digital-avatar assistant. Answer clearly and concisely.",
                },
                {
                    "role": "user",
                    "content": f"User text: {user_text or 'none'}\nAttachments: {attachment_note or 'none'}",
                },
            ]
            answer_text = _chat_text_with_ai(
                prompt_messages,
                timeout=CHAT_TEXT_TIMEOUT_SECONDS,
                retries=CHAT_REMOTE_RETRIES,
            )
    except HTTPException as exc:
        local_reply_reason = str(exc.detail)
        answer_text = _generate_local_chat_reply(
            user_text,
            attachment_note,
            files_meta,
            reason=local_reply_reason,
        )
    except Exception as exc:
        local_reply_reason = str(exc)
        answer_text = _generate_local_chat_reply(
            user_text,
            attachment_note,
            files_meta,
            reason=local_reply_reason,
        )

    session_row = _upsert_interaction_session(db, current_user, model_id, session_id)
    session_voice = _resolve_voice_for_model(db, current_user, session_row.model_id)
    if session_voice == QWEN_VOICE:
        text_hint = _resolve_keyword_preset(f"{user_text}\n{attachment_note}") or ""
        session_voice = _apply_voice_hint(session_voice, text_hint)
    session_voice = _apply_voice_hint(session_voice, voice_hint)
    audio_url, audio_error = _synthesize_reply_audio(
        answer_text, session_voice, allow_default_fallback=False
    )
    if local_reply_reason and audio_error:
        audio_error = f"Remote AI unavailable: {local_reply_reason}; {audio_error}"
    elif local_reply_reason and not audio_url:
        audio_error = f"Remote AI unavailable: {local_reply_reason}"

    user_event_text = user_text or ""
    if attachment_note:
        user_event_text = f"{user_event_text}\n\n[attachments]\n{attachment_note}".strip()

    if user_event_text:
        db.add(
            InteractionEvent(
                session_id=session_row.id,
                role="user",
                text=user_event_text[:4000],
            )
        )

    db.add(
        InteractionEvent(
            session_id=session_row.id,
            role="assistant",
            text=answer_text[:4000],
        )
    )
    db.commit()

    events = db.scalars(
        select(InteractionEvent)
        .where(InteractionEvent.session_id == session_row.id)
        .order_by(InteractionEvent.created_at)
    ).all()
    input_count = sum(1 for event in events if event.role == "user")
    output_count = sum(1 for event in events if event.role == "assistant")

    session_row.ended_at = _now()
    session_row.input_count = input_count
    session_row.output_count = output_count
    session_row.turns = (
        min(input_count, output_count)
        if input_count and output_count
        else max(input_count, output_count)
    )
    session_row.summary_text = _build_summary_with_ai(events)
    db.commit()

    return {
        "session_id": session_row.id,
        "answer_text": answer_text,
        "audio_url": audio_url,
        "audio_error": audio_error,
        "voice": session_voice,
        "attachments": [
            {
                "name": item["name"],
                "mime": item["mime"],
                "size": item["size"],
            }
            for item in files_meta
        ],
    }


@app.get("/history/my")
def my_history(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    q: str | None = None,
    start: str | None = None,
    end: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    stmt = select(InteractionSession).where(InteractionSession.user_id == user.id)

    filters = []
    if start:
        try:
            start_dt = datetime.fromisoformat(start)
            filters.append(InteractionSession.started_at >= start_dt)
        except Exception:
            raise HTTPException(status_code=400, detail="invalid start datetime")
    if end:
        try:
            end_dt = datetime.fromisoformat(end)
            filters.append(InteractionSession.started_at <= end_dt)
        except Exception:
            raise HTTPException(status_code=400, detail="invalid end datetime")

    if q:
        search = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                InteractionSession.summary_text.like(search),
                InteractionSession.events.any(InteractionEvent.text.like(search)),
            )
        )

    if filters:
        stmt = stmt.where(and_(*filters))

    ordered = stmt.order_by(desc(InteractionSession.started_at))
    rows = db.scalars(ordered.offset((page - 1) * page_size).limit(page_size)).all()
    total = db.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ) or 0
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "items": [
            {
                "id": row.id,
                "model_id": row.model_id,
                "started_at": row.started_at,
                "ended_at": row.ended_at,
                "summary_text": row.summary_text,
                "turns": row.turns,
                "input_count": row.input_count,
                "output_count": row.output_count,
            }
            for row in rows
        ],
    }


@app.get("/history/{session_id}")
def history_detail(
    session_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    row = db.scalar(
        select(InteractionSession).where(InteractionSession.id == session_id)
    )
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    events = db.scalars(
        select(InteractionEvent)
        .where(InteractionEvent.session_id == session_id)
        .order_by(InteractionEvent.created_at)
    ).all()
    return {
        "session": {
            "id": row.id,
            "summary_text": row.summary_text,
            "started_at": row.started_at,
            "ended_at": row.ended_at,
            "turns": row.turns,
            "input_count": row.input_count,
            "output_count": row.output_count,
        },
        "events": [
            {
                "id": event.id,
                "role": event.role,
                "text": event.text,
                "created_at": event.created_at,
            }
            for event in events
        ],
    }


@app.post("/recordings/upload")
def recordings_upload(
    file: UploadFile = File(...),
    model_id: int | None = None,
    session_id: int | None = None,
    duration_ms: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Please upload a video file")

    ext = Path(file.filename or "recording.webm").suffix or ".webm"
    safe_ext = ext[:10]
    save_name = f"recording_{user.id}_{uuid.uuid4().hex}{safe_ext}"
    output_path = RECORDINGS_DIR / save_name
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded video is empty")
    if len(data) > MAX_RECORDING_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Uploaded video is too large")
    if not _looks_like_video_upload(data, file.content_type or "", file.filename or ""):
        raise HTTPException(
            status_code=400,
            detail="Uploaded file does not look like a supported video container",
        )
    output_path.write_bytes(data)
    file_url = f"/assets/recordings/{save_name}"

    row = UserRecording(
        user_id=user.id,
        model_id=model_id,
        session_id=session_id,
        file_url=file_url,
        mime_type=file.content_type,
        size_bytes=len(data),
        duration_ms=max(0, int(duration_ms or 0)),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "file_url": row.file_url,
        "mime_type": row.mime_type,
        "size_bytes": row.size_bytes,
        "duration_ms": row.duration_ms,
        "created_at": row.created_at,
    }


@app.get("/recordings/my")
def recordings_my(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    page: int = 1,
    page_size: int = 20,
) -> dict:
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    stmt = (
        select(UserRecording)
        .where(UserRecording.user_id == user.id)
        .order_by(desc(UserRecording.created_at))
    )
    rows = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    total = db.scalar(
        select(func.count())
        .select_from(UserRecording)
        .where(UserRecording.user_id == user.id)
    ) or 0
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "items": [
            {
                "id": row.id,
                "model_id": row.model_id,
                "session_id": row.session_id,
                "file_url": row.file_url,
                "mime_type": row.mime_type,
                "size_bytes": row.size_bytes,
                "duration_ms": row.duration_ms,
                "created_at": row.created_at,
            }
            for row in rows
        ],
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def _make_event(event_type: str, **kwargs) -> dict:
    return {
        "type": event_type,
        "event_id": f"evt_{int(asyncio.get_event_loop().time() * 1000)}",
        **kwargs,
    }


@app.websocket("/ws/audio")
async def ws_audio(client_ws: WebSocket):
    await client_ws.accept()

    token = _extract_token_from_ws(client_ws)
    if not token:
        await client_ws.close(code=4401)
        return

    from .db import SessionLocal

    db = SessionLocal()
    try:
        payload = _user_payload_from_token(token)
        user = _get_user_by_payload(db, payload)
    except HTTPException:
        db.close()
        await client_ws.close(code=4401)
        return

    session_row = InteractionSession(
        user_id=user.id,
        model_id=_extract_model_id_from_ws(client_ws),
        started_at=_now(),
    )
    db.add(session_row)
    db.commit()
    db.refresh(session_row)

    dash_url = QWEN_RT_URL
    if "?" in dash_url:
        if "model=" not in dash_url:
            dash_url = f"{dash_url}&model={QWEN_MODEL}"
    else:
        dash_url = f"{dash_url}?model={QWEN_MODEL}"

    if not DASHSCOPE_API_KEY:
        await client_ws.close(code=1011)
        return

    headers = {"Authorization": f"Bearer {DASHSCOPE_API_KEY}"}
    input_count = 0
    output_count = 0
    session_voice = _resolve_voice_for_model(db, user, session_row.model_id)
    session_voice = _apply_voice_hint(session_voice, _extract_voice_hint_from_ws(client_ws))

    try:
        try:
            dash_ctx = websockets.connect(
                dash_url, additional_headers=headers, ping_interval=20, ping_timeout=20
            )
        except TypeError:
            dash_ctx = websockets.connect(
                dash_url, extra_headers=headers, ping_interval=20, ping_timeout=20
            )

        async with dash_ctx as dash_ws:
            _dbg("connected to realtime ws", dash_url)
            session_update = _make_event(
                "session.update",
                session={
                    "modalities": ["text", "audio"],
                    "voice": session_voice,
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm24",
                    "instructions": SYSTEM_PROMPT,
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "silence_duration_ms": 600,
                    },
                },
            )
            await dash_ws.send(json.dumps(session_update, ensure_ascii=False))

            stop_event = asyncio.Event()

            async def browser_to_dash():
                try:
                    while not stop_event.is_set():
                        msg = await client_ws.receive()
                        text_payload = msg.get("text")
                        if text_payload:
                            try:
                                data = json.loads(text_payload)
                            except Exception:
                                data = {}
                            if data.get("type") == "interrupt":
                                try:
                                    await dash_ws.send(
                                        json.dumps(
                                            _make_event("response.cancel"),
                                            ensure_ascii=False,
                                        )
                                    )
                                except Exception:
                                    pass
                                continue

                        payload = msg.get("bytes")
                        if not payload:
                            continue
                        b64 = base64.b64encode(payload).decode("ascii")
                        evt = _make_event("input_audio_buffer.append", audio=b64)
                        await dash_ws.send(json.dumps(evt))
                except WebSocketDisconnect:
                    pass
                except Exception as exc:
                    _dbg("browser_to_dash error", exc)
                finally:
                    stop_event.set()

            async def dash_to_browser():
                nonlocal input_count, output_count
                try:
                    while not stop_event.is_set():
                        msg = await dash_ws.recv()
                        if not msg:
                            continue

                        data = json.loads(msg)
                        typ = data.get("type", "")

                        if typ == "input_audio_buffer.speech_started":
                            await client_ws.send_text(
                                json.dumps(
                                    {"type": "speech_started"}, ensure_ascii=False
                                )
                            )
                            continue

                        if typ == "response.audio.delta":
                            delta = data.get("delta")
                            if delta:
                                pcm_bytes = base64.b64decode(delta)
                                await client_ws.send_bytes(pcm_bytes)
                            continue

                        if typ == "response.done":
                            await client_ws.send_text(
                                json.dumps(
                                    {"type": "assistant_done"}, ensure_ascii=False
                                )
                            )
                            continue

                        if (
                            typ
                            == "conversation.item.input_audio_transcription.completed"
                        ):
                            transcript = data.get("transcript", "")
                            if transcript:
                                input_count += 1
                                print(f"[USER] {transcript}")
                                db.add(
                                    InteractionEvent(
                                        session_id=session_row.id,
                                        role="user",
                                        text=transcript,
                                    )
                                )
                                db.commit()
                                await client_ws.send_text(
                                    json.dumps(
                                        {"type": "user_final", "text": transcript},
                                        ensure_ascii=False,
                                    )
                                )
                            continue

                        if typ in {
                            "response.audio_transcript.delta",
                            "response.audio_transcript.done",
                        }:
                            transcript = data.get("transcript", "")
                            if transcript:
                                await client_ws.send_text(
                                    json.dumps(
                                        {"type": typ, "text": transcript},
                                        ensure_ascii=False,
                                    )
                                )
                                if typ == "response.audio_transcript.done":
                                    output_count += 1
                                    print(f"[ASSISTANT] {transcript}")
                                    db.add(
                                        InteractionEvent(
                                            session_id=session_row.id,
                                            role="assistant",
                                            text=transcript,
                                        )
                                    )
                                    db.commit()
                            continue
                except WebSocketDisconnect:
                    pass
                except Exception as exc:
                    _dbg("dash_to_browser error", exc)
                finally:
                    stop_event.set()

            task1 = asyncio.create_task(browser_to_dash())
            task2 = asyncio.create_task(dash_to_browser())

            await stop_event.wait()
            for task in (task1, task2):
                if not task.done():
                    task.cancel()

    except Exception as exc:
        _dbg("ws bridge error", exc)
    finally:
        events = db.scalars(
            select(InteractionEvent)
            .where(InteractionEvent.session_id == session_row.id)
            .order_by(InteractionEvent.created_at)
        ).all()
        if not events:
            db.delete(session_row)
            db.commit()
            try:
                await client_ws.close()
            except Exception:
                pass
            db.close()
            return
        turns = (
            min(input_count, output_count)
            if input_count and output_count
            else max(input_count, output_count)
        )
        session_row.ended_at = _now()
        session_row.input_count = input_count
        session_row.output_count = output_count
        session_row.turns = turns
        session_row.summary_text = _build_summary_with_ai(events)
        db.commit()

        try:
            await client_ws.close()
        except Exception:
            pass
        db.close()

