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
import os
import re
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
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
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
UPLOAD_PATHS = {"/api/upload", "/api/process-video"}
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
    or picking one of the 25 gallery presets — is instant instead of another
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


@app.post("/api/process-video")
async def process_video(
    file: UploadFile = File(...),
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
