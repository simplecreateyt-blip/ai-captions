"""AutoCaption AI — FastAPI backend.

Patched changes vs. the version that was throwing `Internal Server Error`:

*   Every failure now returns a **JSON** body with `code`, `message`, `hint`
    (+ `upstream` when Groq itself complained).  A global `Exception` handler
    replaces Starlette's bare-text "Internal Server Error" page.
*   `groq_transcriber.TranscriptionError` sub-classes map onto sensible HTTP
    codes (401/429/413/503/422) instead of a blanket 500.
*   The client-supplied key is validated; if it is stale (e.g. an old key still
    sitting in the browser's localStorage) the server key is used as a fallback
    and the response says so.
*   Caption styles are no longer a hard whitelist: unknown ids fall back to a
    default grouping and raise a warning instead of HTTP 400.
*   `/api/diagnose` performs a live check of the key, the models the key can
    see, and the caption-rewrite chain — the fastest way to find the real cause
    of any remaining upstream failure.
*   Optional, size-bounded transcription concurrency so parallel uploads cannot
    stampede the free-tier rate limits.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import subprocess
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

load_dotenv()

try:
    import truststore

    truststore.inject_into_ssl()
except Exception:
    pass

import groq_transcriber
from groq_transcriber import (
    SUPPORTED_TARGET_LANGUAGES,
    STYLE_WORDS_PER_CAPTION,
    TranscriptionError,
    diagnose_groq,
    words_per_caption_for_style,
)

try:
    import transcriber
    LOCAL_ENGINE_AVAILABLE = True
except Exception as _import_error:  # pragma: no cover - optional local engine
    transcriber = None  # type: ignore[assignment]
    LOCAL_ENGINE_AVAILABLE = False
    _LOCAL_ENGINE_IMPORT_ERROR = _import_error


# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("autocaption")
DEBUG = os.getenv("DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads"))).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE_BYTES = int(float(os.getenv("MAX_UPLOAD_MB", "1536")) * 1024 * 1024)
MULTIPART_OVERHEAD_BYTES = 10 * 1024 * 1024
MAX_REQUEST_BODY_BYTES = MAX_FILE_SIZE_BYTES + MULTIPART_OVERHEAD_BYTES
UPLOAD_PATHS = {
    "/api/upload",
    "/api/upload/",
    "/api/process-video",
    "/api/process-video/",
    "/api/export",
    "/api/export/",
    "/api/parse-srt",
    "/api/parse-srt/",
}
TRANSCRIBE_CONCURRENCY = max(1, int(os.getenv("TRANSCRIBE_CONCURRENCY", "2")))
TRANSCRIBE_QUEUE_TIMEOUT = float(os.getenv("TRANSCRIBE_QUEUE_TIMEOUT", "180"))
_TRANSCRIBE_SLOTS = threading.BoundedSemaphore(TRANSCRIBE_CONCURRENCY)

ALLOWED_EXTENSIONS = {
    ".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v",
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
}
SUPPORTED_ENGINES = {"groq", "local"}
DEFAULT_CORS_ORIGINS = (
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:3001,http://127.0.0.1:3001,"
    "http://localhost:5173,http://127.0.0.1:5173"
)
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]
for _local_origin in [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]:
    if _local_origin not in CORS_ORIGINS:
        CORS_ORIGINS.append(_local_origin)
# Any local dev port, plus the sandbox preview hosts this project is often run in.
CORS_ORIGIN_REGEX = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$|^https://[\w.-]+\.e2b\.app$",
)


class RequestBodyTooLarge(Exception):
    pass


class UploadBodyLimitMiddleware:
    """Reject oversized multipart requests before Starlette spools them to disk."""

    def __init__(self, app, max_body_bytes: int, paths: set[str]):
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.paths = paths

    async def __call__(self, scope, receive, send):
        if (
            scope.get("type") != "http"
            or scope.get("method") != "POST"
            or scope.get("path") not in self.paths
        ):
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length:
            try:
                if int(content_length) > self.max_body_bytes:
                    await self._send_too_large(send)
                    return
            except ValueError:
                pass

        received_bytes = 0
        response_started = False

        async def limited_receive():
            nonlocal received_bytes
            message = await receive()
            if message["type"] == "http.request":
                received_bytes += len(message.get("body", b""))
                if received_bytes > self.max_body_bytes:
                    raise RequestBodyTooLarge
            return message

        async def tracking_send(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except RequestBodyTooLarge:
            # Only safe to answer ourselves if nothing has been written yet.
            if not response_started:
                await self._send_too_large(send)
            else:  # pragma: no cover - defensive
                logger.warning("Upload limit hit after the response had started.")

    @staticmethod
    async def _send_too_large(send):
        limit_gb = MAX_FILE_SIZE_BYTES / (1024 ** 3)
        body = json.dumps({
            "detail": f"Upload exceeds the {limit_gb:.2f} GB maximum file size.",
            "code": "upload_too_large",
            "message": (
                f"This file is larger than the {limit_gb:.2f} GB upload limit."
            ),
            "hint": (
                "Trim the clip, compress it, or raise MAX_UPLOAD_MB in backend/.env."
            ),
        }).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})


app = FastAPI(
    title="AutoCaption AI API",
    description="Video captioning with Groq Whisper and a live caption-rewrite model.",
    version="2.1.0",
)

# Register the upload limiter before CORS so its 413 response also gets CORS headers.
app.add_middleware(
    UploadBodyLimitMiddleware,
    max_body_bytes=MAX_REQUEST_BODY_BYTES,
    paths=UPLOAD_PATHS,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["x-request-id"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


# --------------------------------------------------------------------------- #
# Exception handlers: never return a bare "Internal Server Error"
# --------------------------------------------------------------------------- #
def _error_payload(
    code: str,
    message: str,
    hint: str = "",
    request: Optional[Request] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "detail": message,
        "code": code,
        "message": message,
    }
    if hint:
        payload["hint"] = hint
    if request is not None:
        payload["request_id"] = getattr(request.state, "request_id", None)
    if extra:
        payload.update(extra)
    if DEBUG:
        payload["debug"] = {"path": str(request.url) if request else None}
    return payload


@app.exception_handler(TranscriptionError)
async def transcription_error_handler(request: Request, error: TranscriptionError):
    payload = _error_payload(error.code, str(error), error.hint, request)
    headers: Dict[str, str] = {}
    retry_after = getattr(error, "retry_after", None)
    if retry_after:
        headers["Retry-After"] = str(int(retry_after))
        payload["retry_after_seconds"] = int(retry_after)
    log = logger.warning if error.http_status < 500 else logger.error
    log("[%s] %s: %s", payload.get("request_id"), error.code, error)
    return JSONResponse(
        status_code=error.http_status, content=payload, headers=headers or None
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, error: HTTPException):
    detail = error.detail
    if isinstance(detail, dict):
        payload = _error_payload(
            str(detail.get("code", "http_error")),
            str(detail.get("message") or detail.get("detail") or "Request failed."),
            str(detail.get("hint", "")),
            request,
        )
    else:
        payload = _error_payload("http_error", str(detail), "", request)
        payload["detail"] = detail
    return JSONResponse(
        status_code=error.status_code, content=payload, headers=error.headers
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, error: RequestValidationError):
    first = (error.errors() or [{}])[0]
    location = ".".join(str(part) for part in first.get("loc", []))
    message = f"Invalid request: {location} {first.get('msg', 'is not valid')}".strip()
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            "invalid_request",
            message,
            "Check the field types sent by the frontend.",
            request,
            {"errors": json.loads(json.dumps(error.errors(), default=str))},
        ),
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, error: Exception):
    """Last line of defence: always answer with JSON, never bare text."""
    request_id = getattr(request.state, "request_id", "?")
    logger.error(
        "[%s] Unhandled %s on %s: %s\n%s",
        request_id,
        type(error).__name__,
        request.url.path,
        error,
        traceback.format_exc(),
    )
    hint = (
        "This is an unexpected server error. The backend log has the full "
        "traceback; run GET /api/diagnose to check the Groq key and models, and "
        "start the server with DEBUG=1 for details in the response."
    )
    payload = _error_payload(
        "internal_error",
        f"{type(error).__name__}: {error}" if DEBUG else
        "Unexpected server error while processing the video.",
        hint,
        request,
    )
    if DEBUG:
        payload["traceback"] = traceback.format_exc().splitlines()[-12:]
    return JSONResponse(status_code=500, content=payload)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request.state.request_id = uuid.uuid4().hex[:12]
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        raise
    else:
        duration_ms = (time.perf_counter() - started) * 1000
        if request.url.path.startswith("/api"):
            logger.info(
                "[%s] %s %s -> %s (%.0f ms)",
                request.state.request_id,
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )
        response.headers["x-request-id"] = request.state.request_id
        return response


# --------------------------------------------------------------------------- #
# Models / validators
# --------------------------------------------------------------------------- #
class TranscribeRequest(BaseModel):
    file_id: str = Field(..., description="UUID returned by /api/upload")
    target_language: Optional[str] = "Hinglish"
    style: Optional[str] = "hormozi"
    engine: Optional[str] = "groq"
    groq_api_key: Optional[str] = None
    model_size: Optional[str] = "base"
    language: Optional[str] = None
    force: bool = False


class ExportCaption(BaseModel):
    start: float
    end: float
    text: str = Field(..., min_length=1, max_length=300)


class ExportStyle(BaseModel):
    font: str = Field(..., min_length=1, max_length=60, pattern=r"^[A-Za-z0-9 _-]+$")
    color: str = Field(..., pattern=r"^#[0-9A-Fa-f]{6}$")
    accent: str = Field(..., pattern=r"^#[0-9A-Fa-f]{6}$")
    outline_color: str = Field(..., pattern=r"^#[0-9A-Fa-f]{6}$")
    outline_width: int = Field(..., ge=0, le=8)
    weight: int = Field(..., ge=100, le=900)
    uppercase: bool = False


class ExportRequest(BaseModel):
    file_id: str = Field(..., description="UUID returned by /api/upload")
    captions: list[ExportCaption] = Field(..., min_length=1, max_length=20000)
    style: ExportStyle
    position: str = Field(..., pattern=r"^(top|center|bottom)$")
    font_size: str = Field(..., pattern=r"^(sm|md|lg|xl)$")


async def save_upload(file: UploadFile, destination: Path) -> int:
    """Stream an upload to disk while enforcing the per-file size limit."""
    total_bytes = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_FILE_SIZE_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail={
                            "code": "upload_too_large",
                            "message": (
                                "File exceeds the "
                                f"{MAX_FILE_SIZE_BYTES / (1024 ** 3):.2f} GB "
                                "maximum file size."
                            ),
                            "hint": "Trim or compress the clip, or raise "
                                    "MAX_UPLOAD_MB in backend/.env.",
                        },
                    )
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    if total_bytes == 0:
        destination.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "empty_upload",
                "message": "The uploaded file was empty.",
                "hint": "Pick the file again; the browser sent 0 bytes.",
            },
        )
    return total_bytes


def validate_upload(file: UploadFile) -> str:
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "missing_filename",
                "message": "No filename provided.",
                "hint": "Send the file as multipart/form-data under field 'file'.",
            },
        )

    extension = Path(file.filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "unsupported_format",
                "message": f"Unsupported file format: {extension or '(none)'}.",
                "hint": "Allowed: " + ", ".join(sorted(ALLOWED_EXTENSIONS)),
            },
        )
    return extension


def validate_file_id(file_id: str) -> None:
    try:
        uuid.UUID(file_id)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_file_id",
                "message": "Invalid file_id (expected a UUID).",
                "hint": "Use the file_id returned by /api/upload.",
            },
        )


def find_video_by_id(file_id: str) -> Optional[Path]:
    validate_file_id(file_id)
    for extension in ALLOWED_EXTENSIONS:
        candidate = UPLOAD_DIR / f"{file_id}{extension}"
        if candidate.is_file():
            return candidate
    return None


def cache_path_for(file_id: str, engine: str, language: str) -> Path:
    """Cache key: upload + engine + language.

    The style is deliberately NOT part of the key.  Whisper timestamps and the
    caption rewrite do not depend on how the words are later grouped, so keeping
    one transcript per (file, engine, language) means switching a template —
    or picking one of the 20 gallery presets — is instant instead of another
    Whisper + LLM run.
    """
    safe_language = re.sub(r"[^A-Za-z0-9_-]", "_", language)
    safe_engine = re.sub(r"[^A-Za-z0-9_-]", "_", engine)
    return UPLOAD_DIR / f"{file_id}_{safe_engine}_{safe_language}.json"


def regroup_for_style(data: dict, style: str) -> tuple[dict, bool]:
    """Return (data, was_regrouped) with caption chunks for the requested style."""
    if not isinstance(data, dict) or not data.get("words"):
        return data, False
    if data.get("style") == style and data.get("caption_chunks"):
        return data, False

    words = data["words"]
    per_caption = words_per_caption_for_style(style)
    chunks = groq_transcriber.create_caption_chunks(words, max_words=per_caption)

    regrouped = dict(data)
    regrouped.update({
        "style": style,
        "words_per_caption": per_caption,
        "caption_chunks": chunks,
        "hormozi_chunks": chunks,
        "total_chunks": len(chunks),
        "regrouped": True,
    })
    return regrouped, True


def write_cache(path: Path, data: dict) -> None:
    try:
        temporary_path = path.with_suffix(path.suffix + ".tmp")
        with temporary_path.open("w", encoding="utf-8") as cache_file:
            json.dump(data, cache_file, indent=2, ensure_ascii=False)
        temporary_path.replace(path)
    except OSError as error:  # a broken cache must never fail a good result
        logger.warning("Could not write transcription cache %s: %s", path, error)


def normalise_language(language: Optional[str]) -> str:
    candidate = (language or "Hinglish").strip()
    if candidate.lower() not in SUPPORTED_TARGET_LANGUAGES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "unsupported_language",
                "message": f"Unsupported target language: {candidate}.",
                "hint": "Supported: " + ", ".join(sorted(SUPPORTED_TARGET_LANGUAGES)),
            },
        )
    return candidate


def normalise_style(style: Optional[str]) -> tuple[str, list[str]]:
    """Unknown styles degrade to the default grouping instead of a hard 400."""
    candidate = (style or "hormozi").strip().lower()
    warnings: list[str] = []
    if candidate not in STYLE_WORDS_PER_CAPTION:
        warnings.append(
            f"Unknown caption style '{candidate}'; using a "
            f"{words_per_caption_for_style(candidate)}-word grouping."
        )
    return candidate, warnings


def normalise_engine(engine: Optional[str]) -> str:
    candidate = (engine or "groq").strip().lower()
    if candidate not in SUPPORTED_ENGINES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "unsupported_engine",
                "message": f"Unsupported transcription engine: {candidate}.",
                "hint": "Use 'groq' or 'local'.",
            },
        )
    if candidate == "local" and not LOCAL_ENGINE_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "local_engine_unavailable",
                "message": "The local Whisper engine is not installed.",
                "hint": "pip install faster-whisper, or use engine='groq'.",
            },
        )
    return candidate


def transcribe_file(
    video_path: Path,
    engine: str,
    language: str,
    style: str,
    api_key: Optional[str],
    model_size: str,
    source_language: Optional[str],
    warnings: Optional[list] = None,
) -> dict:
    warnings = warnings if warnings is not None else []

    if engine == "groq":
        env_key = os.getenv("GROQ_API_KEY")
        client_key = (api_key or "").strip()
        candidate_keys = [key for key in (client_key, env_key) if key]
        if not candidate_keys:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "missing_api_key",
                    "message": "GROQ_API_KEY is not configured.",
                    "hint": "Add GROQ_API_KEY=gsk_... to backend/.env "
                            "(get one at console.groq.com) or enter it in the app.",
                },
            )

        last_error: Optional[Exception] = None
        for index, key in enumerate(candidate_keys):
            try:
                return groq_transcriber.transcribe_video_double_layer(
                    video_path=video_path,
                    target_language=language,
                    style=style,
                    api_key=key,
                    source_language=source_language,
                )
            except groq_transcriber.InvalidApiKeyError as error:
                last_error = error
                if index == 0 and len(candidate_keys) > 1:
                    warnings.append(
                        "The Groq key entered in the app was rejected; the "
                        "server-side GROQ_API_KEY was used instead."
                    )
                    continue
                raise

        assert last_error is not None
        raise last_error

    if engine == "local":
        if not LOCAL_ENGINE_AVAILABLE:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "local_engine_unavailable",
                    "message": "Local engine import failed.",
                    "hint": str(globals().get("_LOCAL_ENGINE_IMPORT_ERROR", "")),
                },
            )
        return transcriber.transcribe_video(
            video_path=video_path,
            model_size=model_size,
            language=source_language,
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"code": "unsupported_engine", "message": "Unsupported engine."},
    )


def run_transcription(
    video_path: Path,
    engine: str,
    language: str,
    style: str,
    api_key: Optional[str],
    model_size: str,
    source_language: Optional[str],
    warnings: Optional[list] = None,
) -> dict:
    """Run the (blocking) transcription inside a bounded worker slot."""
    acquired = _TRANSCRIBE_SLOTS.acquire(timeout=TRANSCRIBE_QUEUE_TIMEOUT)
    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "server_busy",
                "message": (
                    f"{TRANSCRIBE_CONCURRENCY} transcription job(s) are already "
                    "running."
                ),
                "hint": "Wait for the running job to finish, or raise "
                        "TRANSCRIBE_CONCURRENCY in backend/.env.",
            },
        )
    try:
        return transcribe_file(
            video_path, engine, language, style, api_key, model_size,
            source_language, warnings,
        )
    finally:
        _TRANSCRIBE_SLOTS.release()


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/")
async def root():
    return {
        "service": "AutoCaption AI API",
        "status": "online",
        "version": "2.1.0",
        "groq_configured": bool(os.getenv("GROQ_API_KEY")),
        "groq_sdk": groq_transcriber.GROQ_SDK_AVAILABLE,
        "local_engine_available": LOCAL_ENGINE_AVAILABLE,
        "whisper_model": groq_transcriber.WHISPER_MODEL,
        "llm_models": groq_transcriber.LLM_MODEL_CHAIN,
        "concurrency": TRANSCRIBE_CONCURRENCY,
        "max_upload_bytes": MAX_FILE_SIZE_BYTES,
        "docs_url": "/docs",
        "diagnostics_url": "/api/diagnose",
    }


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "version": "2.1.0",
        "groq_configured": bool(os.getenv("GROQ_API_KEY")),
        "groq_sdk": groq_transcriber.GROQ_SDK_AVAILABLE,
        "local_engine_available": LOCAL_ENGINE_AVAILABLE,
        "max_upload_bytes": MAX_FILE_SIZE_BYTES,
    }


@app.get("/api/diagnose")
async def diagnose(groq_api_key: Optional[str] = None):
    """Live check: key validity, served models, and a real chat round-trip."""
    report = await run_in_threadpool(diagnose_groq, groq_api_key)
    report["server"] = {
        "version": "2.1.0",
        "local_engine_available": LOCAL_ENGINE_AVAILABLE,
        "upload_dir": str(UPLOAD_DIR),
        "upload_dir_writable": os.access(UPLOAD_DIR, os.W_OK),
        "concurrency": TRANSCRIBE_CONCURRENCY,
        "env_key_present": bool(os.getenv("GROQ_API_KEY")),
    }
    if report.get("error"):
        return JSONResponse(status_code=503, content=report)
    return report


@app.post("/api/upload")
@app.post("/api/upload/")
async def upload_video(file: UploadFile = File(...)):
    extension = validate_upload(file)
    file_id = str(uuid.uuid4())
    stored_filename = f"{file_id}{extension}"
    destination = UPLOAD_DIR / stored_filename

    try:
        size_bytes = await save_upload(file, destination)
    except HTTPException:
        raise
    except Exception as error:
        destination.unlink(missing_ok=True)
        logger.error("Upload failed: %s", error, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "upload_failed",
                "message": f"Failed to save upload: {error}",
                "hint": "Check that the backend can write to "
                        f"{UPLOAD_DIR} and that the disk is not full.",
            },
        ) from error

    return {
        "success": True,
        "file_id": file_id,
        "original_filename": file.filename,
        "stored_filename": stored_filename,
        "content_type": file.content_type,
        "size_bytes": size_bytes,
        "size_mb": round(size_bytes / (1024 * 1024), 2),
        "video_url": f"/uploads/{stored_filename}",
    }


def _ass_timestamp(seconds: float) -> str:
    centiseconds = max(0, int(round(seconds * 100)))
    hours, remainder = divmod(centiseconds, 360000)
    minutes, remainder = divmod(remainder, 6000)
    whole_seconds, fraction = divmod(remainder, 100)
    return f"{hours}:{minutes:02}:{whole_seconds:02}.{fraction:02}"


def _parse_timestamp(ts: str) -> float:
    """Parse 'HH:MM:SS,mmm' or 'HH:MM:SS.mmm' into seconds."""
    ts = ts.strip().replace(",", ".")
    parts = ts.split(":")
    if len(parts) == 3:
        return float(parts[0]) * 3600.0 + float(parts[1]) * 60.0 + float(parts[2])
    elif len(parts) == 2:
        return float(parts[0]) * 60.0 + float(parts[1])
    return float(ts)


def _ass_color(color: str) -> str:
    cleaned = color.lstrip("#")
    if len(cleaned) == 6:
        red, green, blue = cleaned[0:2], cleaned[2:4], cleaned[4:6]
        return f"&H00{blue}{green}{red}".upper()
    return "&H00FFFFFF&"


def _ass_escape(text: str) -> str:
    return (
        text.replace("\\", "")
        .replace("{", "")
        .replace("}", "")
        .replace("\r", "")
        .replace("\n", r"\N")
    )


def parse_srt(content: str) -> list[dict]:
    """Parse standard SRT subtitle content into structured cues."""
    content = content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    pattern = re.compile(
        r"(?:(\d+)\s*\n)?"
        r"(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})"
        r"[\t ]*(?:[^\n]*)\n"
        r"(.*?)(?=\n\s*\n|\Z)",
        re.DOTALL,
    )
    cues = []
    for match in pattern.finditer(content):
        start_str = match.group(2)
        end_str = match.group(3)
        raw_text = match.group(4).strip()
        clean_text = re.sub(r"<[^>]+>", "", raw_text)
        clean_text = " ".join(clean_text.split())
        if not clean_text:
            continue
        start_sec = _parse_timestamp(start_str)
        end_sec = _parse_timestamp(end_str)
        if end_sec > start_sec:
            cues.append({
                "start": start_sec,
                "end": end_sec,
                "text": clean_text,
            })
    return cues


def _get_video_dimensions(video_path: Optional[Path]) -> tuple[int, int]:
    """Probe video dimensions via FFmpeg, defaulting to 1920x1080."""
    if not video_path:
        return 1920, 1080
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        proc = subprocess.run(
            [ffmpeg, "-i", str(video_path)],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        match = re.search(r"Stream.*Video:.*,\s*(\d{2,5})x(\d{2,5})", proc.stderr)
        if match:
            w, h = int(match.group(1)), int(match.group(2))
            if w > 0 and h > 0:
                return w, h
    except Exception:
        pass
    return 1920, 1080


def _split_into_sentences_or_phrases(text: str, max_words: int = 8) -> list[str]:
    """Split subtitle line into individual sentences or readable phrases."""
    raw_sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if s.strip()]
    if not raw_sentences:
        raw_sentences = [text.strip()]
    
    phrases = []
    for s in raw_sentences:
        words = s.split()
        if not words:
            continue
        if len(words) <= max_words:
            phrases.append(" ".join(words))
        else:
            for i in range(0, len(words), max_words):
                phrases.append(" ".join(words[i : i + max_words]))
    return phrases


PRO_CAPTION_STYLES: dict[str, dict[str, Any]] = {
    "tharun_classic": {
        "name": "Tharun Classic",
        "font": "Montserrat",
        "active_color": "&H0000FFFF&",    # Bright Yellow (BGR: B=00, G=FF, R=FF)
        "inactive_color": "&H00FFFFFF&",  # White
        "scale": 120,
        "outline": 3,
        "shadow": 2,
        "bold": -1,
        "is_static": False,
    },
    "abdaal_minimal": {
        "name": "Abdaal Minimal",
        "font": "Inter",                 # or Arial
        "active_color": "&H00D4FF7F&",    # Soft Mint Green (BGR: B=D4, G=FF, R=7F)
        "inactive_color": "&H00FFFFFF&",  # White
        "scale": 110,
        "outline": 2,
        "shadow": 1,
        "bold": -1,
        "is_static": False,
    },
    "beast_impact": {
        "name": "Beast Impact",
        "font": "Impact",                # High energy Impact
        "active_color": "&H00FFFF00&",    # Bright Cyan (BGR: B=FF, G=FF, R=00)
        "inactive_color": "&H00FFFFFF&",  # White
        "scale": 130,
        "outline": 4,
        "shadow": 3,
        "bold": -1,
        "is_static": False,
    },
    "gadzhi_luxury": {
        "name": "Gadzhi Luxury",
        "font": "Montserrat",
        "active_color": "&H0000A5FF&",    # Gold / Orange (BGR: B=00, G=A5, R=FF)
        "inactive_color": "&H00C0C0C0&",  # Light Gray (BGR: B=C0, G=C0, R=C0)
        "scale": 115,
        "outline": 3,
        "shadow": 3,
        "bold": -1,
        "is_static": False,
    },
    "dev_hacker": {
        "name": "Dev Hacker",
        "font": "Consolas",              # Terminal Mono
        "active_color": "&H0000FF00&",    # Terminal Green (BGR: B=00, G=FF, R=00)
        "inactive_color": "&H00FFFFFF&",  # White
        "scale": 115,
        "outline": 2,
        "shadow": 2,
        "bold": -1,
        "is_static": False,
    },
    "plain_hinglish": {
        "name": "Plain Hinglish (Static)",
        "font": "Arial",
        "active_color": "&H00FFFFFF&",    # White
        "inactive_color": "&H00FFFFFF&",  # White
        "scale": 100,
        "outline": 2,
        "shadow": 1,
        "bold": -1,
        "is_static": True,
    },
    "mkbhd_crisp": {
        "name": "MKBHD Crisp",
        "font": "Inter",                 # or SF Pro Display
        "active_color": "&H00303BFF&",    # Matte Studio Red #FF3B30 (BGR: B=30, G=3B, R=FF)
        "inactive_color": "&H00FFFFFF&",  # Crisp Pure White
        "scale": 120,
        "outline": 3,
        "shadow": 2,
        "bold": -1,
        "is_static": False,
    },
    "huberman_clean": {
        "name": "Huberman Clean",
        "font": "Montserrat",            # or Outfit
        "active_color": "&H00FEF200&",    # Electric Ice Cyan #00F2FE (BGR: B=FE, G=F2, R=00)
        "inactive_color": "&H00F0E8E2&",  # Slate Light Gray #E2E8F0 (BGR: B=F0, G=E8, R=E2)
        "scale": 112,
        "outline": 2,
        "shadow": 1,
        "bold": -1,
        "is_static": False,
    },
}


def _get_style_cfg(style_id: Optional[str]) -> dict[str, Any]:
    sid = (style_id or "tharun_classic").strip().lower()
    if sid in PRO_CAPTION_STYLES:
        return PRO_CAPTION_STYLES[sid]
    if sid in ("hormozi", "classic", "default"):
        return PRO_CAPTION_STYLES["tharun_classic"]
    if sid in ("ali_abdaal", "abdaal"):
        return PRO_CAPTION_STYLES["abdaal_minimal"]
    if sid in ("beast", "mrbeast", "impact"):
        return PRO_CAPTION_STYLES["beast_impact"]
    if sid in ("gadzhi", "luxury"):
        return PRO_CAPTION_STYLES["gadzhi_luxury"]
    if sid in ("hacker", "neon_hacker", "dev"):
        return PRO_CAPTION_STYLES["dev_hacker"]
    if sid in ("plain", "hinglish", "static"):
        return PRO_CAPTION_STYLES["plain_hinglish"]
    if sid in ("mkbhd", "crisp", "mkbhd_crisp"):
        return PRO_CAPTION_STYLES["mkbhd_crisp"]
    if sid in ("huberman", "huberman_clean", "clean"):
        return PRO_CAPTION_STYLES["huberman_clean"]
    return PRO_CAPTION_STYLES["tharun_classic"]


def generate_word_by_word_ass(
    cues: list[dict],
    position: str = "bottom",
    font_size: str = "lg",
    video_path: Optional[Path] = None,
    font_name: Optional[str] = None,
    alignment: Optional[int] = None,
    style_id: str = "tharun_classic",
    aspect_ratio: str = "original",
) -> str:
    """Generate an Advanced SubStation Alpha (.ass) file with dynamic karaoke or static styling."""
    ar = str(aspect_ratio or "original").strip().lower()
    if ar in ("16:9", "16_9", "landscape", "youtube"):
        res_x, res_y = 1920, 1080
    elif ar in ("9:16", "9_16", "portrait", "shorts"):
        res_x, res_y = 1080, 1920
    else:
        res_x, res_y = _get_video_dimensions(video_path)

    font_size_pt = {"sm": 48, "md": 58, "lg": 68, "xl": 80}.get(font_size, 68)

    cfg = _get_style_cfg(style_id)
    clean_font = (font_name or cfg["font"]).split(",")[0].strip().strip("'\"")
    if not clean_font:
        clean_font = cfg["font"]

    active_color = cfg["active_color"]
    inactive_color = cfg["inactive_color"]
    scale = cfg["scale"]
    outline = cfg["outline"]
    shadow = cfg["shadow"]
    bold = cfg["bold"]
    is_static = cfg["is_static"]

    if alignment is not None:
        align_val = int(alignment)
        margin_v = 0 if align_val == 5 else 50
    elif position in ("center", "5", 5):
        align_val = 5
        margin_v = 0
    elif position in ("top", "8", 8):
        align_val = 8
        margin_v = 50
    else:  # bottom
        align_val = 2
        margin_v = 50

    ass_lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {res_x}",
        f"PlayResY: {res_y}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        # BorderStyle=1 ensures Outline + Drop Shadow only (NEVER BorderStyle=3, which creates an opaque background box).
        # OutlineColour and BackColour act purely on glyph strokes and shadows with 100% transparent background.
        f"Style: Default,{clean_font},{font_size_pt},{inactive_color},{active_color},&H00000000&,&H00000000&,{bold},0,1,{outline},{shadow},{align_val},40,40,{margin_v},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    # Plain Hinglish / Static style: single event per sentence, no override tags
    if is_static:
        for cue in cues:
            start = float(cue.get("start", 0.0))
            end = float(cue.get("end", 0.0))
            raw_text = str(cue.get("text", "")).strip()
            if not raw_text or end <= start:
                continue
            clean_text = _ass_escape(raw_text)
            ass_lines.append(
                f"Dialogue: 0,{_ass_timestamp(start)},{_ass_timestamp(end)},Default,,0,0,0,,{clean_text}"
            )
        return "\n".join(ass_lines)

    # Dynamic word-by-word karaoke pop styles
    for cue in cues:
        start = float(cue.get("start", 0.0))
        end = float(cue.get("end", 0.0))
        raw_text = str(cue.get("text", "")).strip()
        if not raw_text or end <= start:
            continue

        phrases = _split_into_sentences_or_phrases(raw_text, max_words=8)
        if not phrases:
            continue

        total_cue_words = sum(len(p.split()) for p in phrases)
        if total_cue_words == 0:
            continue

        total_duration = end - start
        current_time = start

        for phrase in phrases:
            words = phrase.split()
            if not words:
                continue

            phrase_duration = (len(words) / total_cue_words) * total_duration
            phrase_start = current_time
            phrase_end = current_time + phrase_duration
            current_time = phrase_end

            # Estimated duration of each word (Total Line Duration / Number of Words)
            word_duration = phrase_duration / len(words)

            # Generate multiple ASS Dialogue events for a single sentence (one event per word)
            for i, active_word in enumerate(words):
                w_start = phrase_start + i * word_duration
                w_end = phrase_start + (i + 1) * word_duration
                if i == len(words) - 1:
                    w_end = phrase_end
                if w_end <= w_start:
                    w_end = w_start + 0.05

                formatted_parts = []
                for j, w in enumerate(words):
                    clean_w = _ass_escape(w)
                    if j == i:
                        formatted_parts.append(
                            rf"{{\c{active_color}\fscx{scale}\fscy{scale}}}{clean_w}{{\r}}"
                        )
                    else:
                        formatted_parts.append(
                            rf"{{\c{inactive_color}\fscx100\fscy100}}{clean_w}"
                        )

                dialogue_text = " ".join(formatted_parts)
                ass_lines.append(
                    f"Dialogue: 0,{_ass_timestamp(w_start)},{_ass_timestamp(w_end)},Default,,0,0,0,,{dialogue_text}"
                )

    return "\n".join(ass_lines)


def generate_word_by_word_ass_from_words(
    words: list[dict],
    position: str = "bottom",
    font_size: str = "lg",
    video_path: Optional[Path] = None,
    max_words_per_sentence: int = 6,
    font_name: Optional[str] = None,
    alignment: Optional[int] = None,
    style_id: str = "tharun_classic",
    aspect_ratio: str = "original",
) -> str:
    """Generate ASS with frame-accurate word timings and style-driven pop effect."""
    ar = str(aspect_ratio or "original").strip().lower()
    if ar in ("16:9", "16_9", "landscape", "youtube"):
        res_x, res_y = 1920, 1080
    elif ar in ("9:16", "9_16", "portrait", "shorts"):
        res_x, res_y = 1080, 1920
    else:
        res_x, res_y = _get_video_dimensions(video_path)

    font_size_pt = {"sm": 48, "md": 58, "lg": 68, "xl": 80}.get(font_size, 68)

    cfg = _get_style_cfg(style_id)
    clean_font = (font_name or cfg["font"]).split(",")[0].strip().strip("'\"")
    if not clean_font:
        clean_font = cfg["font"]

    active_color = cfg["active_color"]
    inactive_color = cfg["inactive_color"]
    scale = cfg["scale"]
    outline = cfg["outline"]
    shadow = cfg["shadow"]
    bold = cfg["bold"]
    is_static = cfg["is_static"]

    if alignment is not None:
        align_val = int(alignment)
        margin_v = 0 if align_val == 5 else 50
    elif position in ("center", "5", 5):
        align_val = 5
        margin_v = 0
    elif position in ("top", "8", 8):
        align_val = 8
        margin_v = 50
    else:  # bottom
        align_val = 2
        margin_v = 50

    ass_lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {res_x}",
        f"PlayResY: {res_y}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        # BorderStyle=1 ensures Outline + Drop Shadow only (NEVER BorderStyle=3, which creates an opaque background box).
        # OutlineColour and BackColour act purely on glyph strokes and shadows with 100% transparent background.
        f"Style: Default,{clean_font},{font_size_pt},{inactive_color},{active_color},&H00000000&,&H00000000&,{bold},0,1,{outline},{shadow},{align_val},40,40,{margin_v},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    if not words:
        return "\n".join(ass_lines)

    sentence_groups: list[list[dict]] = []
    current_group: list[dict] = []

    for w in words:
        current_group.append(w)
        word_text = str(w.get("word", "")).strip()
        if word_text.endswith((".", "!", "?")) or len(current_group) >= max_words_per_sentence:
            sentence_groups.append(current_group)
            current_group = []

    if current_group:
        sentence_groups.append(current_group)

    if is_static:
        for group in sentence_groups:
            if not group:
                continue
            g_start = float(group[0].get("start", 0.0))
            g_end = float(group[-1].get("end", g_start + 1.0))
            full_text = " ".join(_ass_escape(str(w.get("word", "")).strip()) for w in group)
            ass_lines.append(
                f"Dialogue: 0,{_ass_timestamp(g_start)},{_ass_timestamp(g_end)},Default,,0,0,0,,{full_text}"
            )
        return "\n".join(ass_lines)

    for group in sentence_groups:
        for i, active_w in enumerate(group):
            w_start = float(active_w.get("start", 0.0))
            w_end = float(active_w.get("end", w_start + 0.3))
            if w_end <= w_start:
                w_end = w_start + 0.25

            formatted_parts = []
            for j, w_item in enumerate(group):
                clean_w = _ass_escape(str(w_item.get("word", "")).strip())
                if j == i:
                    formatted_parts.append(
                        rf"{{\c{active_color}\fscx{scale}\fscy{scale}}}{clean_w}{{\r}}"
                    )
                else:
                    formatted_parts.append(
                        rf"{{\c{inactive_color}\fscx100\fscy100}}{clean_w}"
                    )

            dialogue_text = " ".join(formatted_parts)
            ass_lines.append(
                f"Dialogue: 0,{_ass_timestamp(w_start)},{_ass_timestamp(w_end)},Default,,0,0,0,,{dialogue_text}"
            )

    return "\n".join(ass_lines)


def _burn_ass_to_video(
    video_path: Path,
    subtitle_path: Optional[Path],
    output_path: Path,
    aspect_ratio: str = "original",
) -> None:
    """Render ASS subtitles into video via FFmpeg with aspect ratio scaling.
    If subtitle_path is None or missing, renders only the scaled/padded video without subtitles.
    """
    import imageio_ffmpeg

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    ar = str(aspect_ratio or "original").strip().lower()

    sub_filter = f",ass='{subtitle_path.name}'" if (subtitle_path and subtitle_path.is_file()) else ""

    if ar in ("16:9", "16_9", "landscape", "youtube"):
        vf_filter = (
            f"scale=1920:1080:force_original_aspect_ratio=decrease,"
            f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2"
            f"{sub_filter}"
        )
    elif ar in ("9:16", "9_16", "portrait", "shorts"):
        vf_filter = (
            f"scale=1080:1920:force_original_aspect_ratio=decrease,"
            f"pad=1080:1920:(ow-iw)/2:(oh-ih)/2"
            f"{sub_filter}"
        )
    else:
        vf_filter = f"ass='{subtitle_path.name}'" if (subtitle_path and subtitle_path.is_file()) else ""

    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(video_path),
    ]
    if vf_filter:
        cmd.extend(["-vf", vf_filter])

    cmd.extend([
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(output_path),
    ])

    result = subprocess.run(
        cmd,
        cwd=str(UPLOAD_DIR),
        capture_output=True,
        text=True,
        timeout=1800,
        check=False,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or "FFmpeg export failed.")[-2000:])
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise RuntimeError("FFmpeg completed without producing a video file.")


def _cleanup_export(output_path: Path) -> None:
    output_path.unlink(missing_ok=True)


@app.post("/api/parse-srt")
async def parse_srt_endpoint(file: UploadFile = File(...)):
    """Parse an uploaded .srt file and return structured caption data for live preview."""
    content_bytes = await file.read()
    text = content_bytes.decode("utf-8", errors="replace")
    cues = parse_srt(text)
    if not cues:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_srt",
                "message": "The provided SRT file contains no valid subtitle cues.",
                "hint": "Check the SRT format: 1 \\n 00:00:01,000 --> 00:00:03,000 \\n Subtitle text",
            },
        )
    segments = []
    all_words = []
    for idx, cue in enumerate(cues):
        w_list = cue["text"].split()
        seg_duration = cue["end"] - cue["start"]
        cue_words = []
        for w_i, word in enumerate(w_list):
            w_start = cue["start"] + (w_i / len(w_list)) * seg_duration
            w_end = cue["start"] + ((w_i + 1) / len(w_list)) * seg_duration
            w_obj = {"word": word, "start": round(w_start, 3), "end": round(w_end, 3)}
            cue_words.append(w_obj)
            all_words.append(w_obj)
        segments.append({
            "id": idx,
            "start": cue["start"],
            "end": cue["end"],
            "text": cue["text"],
            "words": cue_words,
        })
    return {
        "success": True,
        "filename": file.filename,
        "total_cues": len(cues),
        "total_words": len(all_words),
        "segments": segments,
        "words": all_words,
        "caption_chunks": segments,
        "hormozi_chunks": segments,
        "full_text": " ".join(c["text"] for c in cues),
    }


@app.post("/api/export")
@app.post("/api/export/")
async def export_video(
    request: Request,
):
    """Export video with viral word-by-word highlighted captions.

    Accepts:
    - multipart/form-data: video_file, srt_file (optional), file_id, position, font_size
    - application/json: file_id, position, font_size, captions
    """
    content_type = request.headers.get("content-type", "")
    video_file: Optional[UploadFile] = None
    srt_file: Optional[UploadFile] = None
    file_id: Optional[str] = None
    position: str = "bottom"
    font_size: str = "lg"
    font_name: str = "Montserrat"
    style_id: str = "tharun_classic"
    aspect_ratio: str = "original"
    captions_data: Optional[list] = None

    if "multipart/form-data" in content_type:
        form = await request.form()
        video_field = form.get("video_file") or form.get("file")
        if isinstance(video_field, UploadFile):
            video_file = video_field
        srt_field = form.get("srt_file")
        if isinstance(srt_field, UploadFile) and srt_field.filename:
            srt_file = srt_field
        file_id_val = form.get("file_id")
        if file_id_val and isinstance(file_id_val, str):
            file_id = file_id_val
        position = str(form.get("position") or "bottom")
        font_size = str(form.get("font_size") or "lg")
        font_name = str(form.get("font") or form.get("font_name") or "Montserrat")
        style_id = str(form.get("style_id") or form.get("style") or "tharun_classic")
        aspect_ratio = str(form.get("aspect_ratio") or "original")
        captions_raw = form.get("captions")
        if captions_raw and isinstance(captions_raw, str):
            try:
                captions_data = json.loads(captions_raw)
            except Exception:
                pass
    else:
        json_body = await request.json()
        file_id = json_body.get("file_id")
        position = str(json_body.get("position", "bottom"))
        font_size = str(json_body.get("font_size", "lg"))
        font_name = str(json_body.get("font") or json_body.get("font_name") or "Montserrat")
        style_id = str(json_body.get("style_id") or json_body.get("style") or "tharun_classic")
        aspect_ratio = str(json_body.get("aspect_ratio", "original"))
        captions_data = json_body.get("captions")

    export_id = uuid.uuid4().hex
    video_path: Optional[Path] = None

    if video_file is not None and video_file.filename:
        extension = Path(video_file.filename).suffix.lower()
        if extension not in ALLOWED_EXTENSIONS:
            extension = ".mp4"
        video_path = UPLOAD_DIR / f"{export_id}_upload{extension}"
        await save_upload(video_file, video_path)
    elif file_id:
        video_path = find_video_by_id(file_id)

    if video_path is None or not video_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "video_not_found",
                "message": "Video was not found. Please provide video_file or a valid file_id.",
            },
        )

    # Check if user requested no captions / deselect
    is_no_captions = not style_id or str(style_id).strip().lower() in {"none", "no_captions", "disabled", "raw", "null"}
    if is_no_captions:
        output_path = UPLOAD_DIR / f"{export_id}_raw.mp4"
        try:
            await run_in_threadpool(_burn_ass_to_video, video_path, None, output_path, aspect_ratio)
        except Exception as error:
            logger.error("Raw video export failed: %s", error, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "code": "video_export_failed",
                    "message": f"FFmpeg could not render the raw video: {error}",
                },
            ) from error
        return FileResponse(
            path=str(output_path),
            filename=f"{export_id}_raw_{aspect_ratio}.mp4",
            media_type="video/mp4",
            background=BackgroundTask(_cleanup_export, output_path),
        )

    # 1. If custom SRT file is provided: skip AI transcription entirely
    ass_content: str = ""
    if srt_file is not None:
        srt_bytes = await srt_file.read()
        srt_text = srt_bytes.decode("utf-8", errors="replace")
        cues = parse_srt(srt_text)
        if not cues:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "invalid_srt",
                    "message": "The uploaded .srt file could not be parsed or contains no subtitles.",
                    "hint": "Check that the file contains standard SRT cues (index, timestamp --> timestamp, text).",
                },
            )
        ass_content = generate_word_by_word_ass(
            cues,
            position=position,
            font_size=font_size,
            video_path=video_path,
            font_name=font_name,
            style_id=style_id,
            aspect_ratio=aspect_ratio,
        )

    # 2. If client supplied captions
    elif captions_data and len(captions_data) > 0:
        cues = [
            {"start": float(c.get("start", 0)), "end": float(c.get("end", 0)), "text": str(c.get("text", ""))}
            for c in captions_data
            if c.get("text")
        ]
        ass_content = generate_word_by_word_ass(
            cues,
            position=position,
            font_size=font_size,
            video_path=video_path,
            font_name=font_name,
            style_id=style_id,
            aspect_ratio=aspect_ratio,
        )

    # 3. Check cached transcription
    else:
        cached = None
        if file_id:
            for cache_file in UPLOAD_DIR.glob(f"{file_id}_*.json"):
                try:
                    with cache_file.open("r", encoding="utf-8") as f:
                        cached = json.load(f)
                        break
                except Exception:
                    pass

        if cached and cached.get("words"):
            ass_content = generate_word_by_word_ass_from_words(
                cached["words"],
                position=position,
                font_size=font_size,
                video_path=video_path,
                font_name=font_name,
                style_id=style_id,
                aspect_ratio=aspect_ratio,
            )
        elif cached and cached.get("segments"):
            cues = [{"start": s["start"], "end": s["end"], "text": s["text"]} for s in cached["segments"]]
            ass_content = generate_word_by_word_ass(
                cues,
                position=position,
                font_size=font_size,
                video_path=video_path,
                font_name=font_name,
                style_id=style_id,
                aspect_ratio=aspect_ratio,
            )
        else:
            result = await run_in_threadpool(
                run_transcription, video_path, "groq", "Hinglish", "hormozi", None, "base", None
            )
            if result.get("words"):
                ass_content = generate_word_by_word_ass_from_words(
                    result["words"],
                    position=position,
                    font_size=font_size,
                    video_path=video_path,
                    font_name=font_name,
                    style_id=style_id,
                    aspect_ratio=aspect_ratio,
                )
            else:
                cues = [{"start": s["start"], "end": s["end"], "text": s["text"]} for s in result.get("segments", [])]
                ass_content = generate_word_by_word_ass(
                    cues,
                    position=position,
                    font_size=font_size,
                    video_path=video_path,
                    font_name=font_name,
                    style_id=style_id,
                    aspect_ratio=aspect_ratio,
                )

    output_path = UPLOAD_DIR / f"{export_id}_captioned.mp4"
    subtitle_path = UPLOAD_DIR / f"{export_id}_subtitles.ass"

    try:
        subtitle_path.write_text(ass_content, encoding="utf-8-sig")
        await run_in_threadpool(_burn_ass_to_video, video_path, subtitle_path, output_path, aspect_ratio)
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "ffmpeg_unavailable",
                "message": "FFmpeg executable is unavailable.",
            },
        ) from error
    except subprocess.TimeoutExpired as error:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail={
                "code": "export_timeout",
                "message": "Video export exceeded processing limit.",
            },
        ) from error
    except Exception as error:
        logger.error("Caption export failed: %s", error, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "video_export_failed",
                "message": f"FFmpeg could not render the captioned video: {error}",
            },
        ) from error
    finally:
        subtitle_path.unlink(missing_ok=True)

    return FileResponse(
        output_path,
        media_type="video/mp4",
        filename=f"captioned_{video_path.stem}.mp4",
        background=BackgroundTask(_cleanup_export, output_path),
    )


@app.post("/api/process-video")
async def process_video(
    file: UploadFile = File(...),
    srt_file: Optional[UploadFile] = File(None),
    target_language: str = Form("Hinglish"),
    style: str = Form("hormozi"),
    groq_api_key: Optional[str] = Form(None),
):
    extension = validate_upload(file)
    language = normalise_language(target_language)
    style_id, warnings = normalise_style(style)

    file_id = str(uuid.uuid4())
    stored_filename = f"{file_id}{extension}"
    destination = UPLOAD_DIR / stored_filename

    try:
        size_bytes = await save_upload(file, destination)
        if srt_file is not None and srt_file.filename:
            srt_bytes = await srt_file.read()
            srt_text = srt_bytes.decode("utf-8", errors="replace")
            cues = parse_srt(srt_text)
            if not cues:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "invalid_srt",
                        "message": "The uploaded .srt file could not be parsed.",
                    },
                )
            words = []
            segments = []
            for idx, c in enumerate(cues):
                raw_w = c["text"].split()
                c_dur = max(0.1, c["end"] - c["start"])
                c_words = []
                for wi, w in enumerate(raw_w):
                    ws = c["start"] + (wi / len(raw_w)) * c_dur
                    we = c["start"] + ((wi + 1) / len(raw_w)) * c_dur
                    w_item = {"word": w, "start": round(ws, 3), "end": round(we, 3)}
                    c_words.append(w_item)
                    words.append(w_item)
                segments.append({
                    "id": idx,
                    "start": c["start"],
                    "end": c["end"],
                    "text": c["text"],
                    "words": c_words,
                })
            result = {
                "words": words,
                "segments": segments,
                "caption_chunks": segments,
                "hormozi_chunks": segments,
                "total_words": len(words),
                "total_segments": len(segments),
                "full_text": " ".join(c["text"] for c in cues),
                "language": "English",
                "style": style_id,
                "source": "custom_srt",
                "warnings": ["Custom .srt loaded; AI transcription skipped."],
            }
        else:
            result = await run_in_threadpool(
                run_transcription,
                destination,
                "groq",
                language,
                style_id,
                groq_api_key,
                "base",
                None,
                warnings,
            )
            result = {**result, "warnings": (result.get("warnings") or []) + warnings}
        write_cache(cache_path_for(file_id, "groq", language), result)
    except HTTPException:
        destination.unlink(missing_ok=True)
        raise
    except TranscriptionError:
        destination.unlink(missing_ok=True)
        raise
    except Exception as error:
        destination.unlink(missing_ok=True)
        logger.error("process-video failed: %s", error, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "processing_failed",
                "message": f"Video processing failed: {error}",
                "hint": "Run GET /api/diagnose to check the Groq key and models, "
                        "then retry.",
            },
        ) from error

    return {
        "success": True,
        "file_id": file_id,
        "original_filename": file.filename,
        "stored_filename": stored_filename,
        "content_type": file.content_type,
        "size_bytes": size_bytes,
        "size_mb": round(size_bytes / (1024 * 1024), 2),
        "video_url": f"/uploads/{stored_filename}",
        "target_language": language,
        "style": style_id,
        "warnings": warnings,
        "data": result,
    }


@app.post("/api/transcribe")
async def transcribe(request: TranscribeRequest):
    video_path = find_video_by_id(request.file_id)
    if video_path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "upload_not_found",
                "message": "Uploaded video was not found on the server.",
                "hint": "Re-upload the file — uploads are cleared when the "
                        "backend restarts if UPLOAD_DIR is temporary.",
            },
        )

    engine = normalise_engine(request.engine)
    language = normalise_language(request.target_language)
    style, warnings = normalise_style(request.style)

    cache_path = cache_path_for(request.file_id, engine, language)
    if cache_path.is_file() and not request.force:
        try:
            with cache_path.open("r", encoding="utf-8") as cache_file:
                cached = json.load(cache_file)
            cached.setdefault("warnings", [])
            cached, regrouped = regroup_for_style(cached, style)
            return {
                "success": True,
                "cached": True,
                "regrouped": regrouped,
                "engine": engine,
                "target_language": language,
                "style": style,
                "file_id": request.file_id,
                "warnings": cached.get("warnings", []) + warnings,
                "data": cached,
            }
        except (OSError, json.JSONDecodeError) as error:
            logger.warning("Discarding unreadable cache %s: %s", cache_path, error)
            cache_path.unlink(missing_ok=True)

    result = await run_in_threadpool(
        run_transcription,
        video_path,
        engine,
        language,
        style,
        request.groq_api_key,
        request.model_size or "base",
        request.language,
        warnings,
    )
    result = {**result, "warnings": (result.get("warnings") or []) + warnings}
    write_cache(cache_path, result)

    return {
        "success": True,
        "cached": False,
        "engine": engine,
        "target_language": language,
        "style": style,
        "file_id": request.file_id,
        "warnings": result.get("warnings", []),
        "data": result,
    }


@app.get("/api/transcribe/{file_id}")
async def get_transcription(
    file_id: str,
    engine: str = "groq",
    target_language: str = "Hinglish",
    style: str = "hormozi",
):
    validate_file_id(file_id)
    engine = normalise_engine(engine)
    language = normalise_language(target_language)
    style_id, _warnings = normalise_style(style)

    path = cache_path_for(file_id, engine, language)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "cache_miss",
                "message": "Transcription not found for this configuration.",
                "hint": "POST /api/transcribe first, or change the "
                        "engine/language/style combination.",
            },
        )

    try:
        with path.open("r", encoding="utf-8") as cache_file:
            data = json.load(cache_file)
    except (OSError, json.JSONDecodeError) as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "cache_unreadable",
                "message": "The cached transcription could not be read.",
                "hint": "Re-run POST /api/transcribe with \"force\": true.",
            },
        ) from error

    data, regrouped = regroup_for_style(data, style_id)
    return {
        "success": True,
        "regrouped": regrouped,
        "file_id": file_id,
        "engine": engine,
        "target_language": language,
        "style": style_id,
        "warnings": data.get("warnings", []) if isinstance(data, dict) else [],
        "data": data,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("UVICORN_RELOAD", "1").lower() in {"1", "true", "yes"},
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )
