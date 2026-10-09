"""Groq-backed two-layer caption engine (Whisper word timestamps -> LLM rewrite).

Rewritten to be failure-proof in three ways the original was not:

1.  **Live model IDs.**  `llama-3.3-70b-versatile` was decommissioned on
    2026-08-16 (Groq docs / deprecations).  The LLM rewrite layer therefore
    uses a *chain* of currently served models (gpt-oss-120b -> qwen3.8-27b ->
    gpt-oss-20b -> llama-3.3-70b for enterprise keys) and remembers which one
    worked for the rest of the job.

2.  **Typed errors, never a bare 500.**  Every upstream failure is translated
    into a `TranscriptionError` sub-class carrying `code` + `hint`, which
    `main.py` turns into a precise JSON error for the UI.

3.  **Graceful degradation.**  Rate limits are retried with backoff, oversized
    chunks are re-split and re-sent, whisper model IDs are swapped when one is
    unavailable, and a failed LLM batch is halved and retried before falling
    back to source text.  Anything that is degraded is reported via `warnings`
    so the UI never silently shows the wrong thing.
"""

from __future__ import annotations

import json
import os
import random
import re
import subprocess
import tempfile
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import imageio_ffmpeg

try:  # optional: fixes TLS cert verification on some Windows/corporate setups
    import truststore

    truststore.inject_into_ssl()
except Exception:  # pragma: no cover - purely optional
    pass

try:  # a missing SDK must not stop the API server from booting
    import groq as groq_sdk
    from groq import Groq

    GROQ_SDK_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    groq_sdk = None  # type: ignore[assignment]
    Groq = None  # type: ignore[assignment,misc]
    GROQ_SDK_AVAILABLE = False


def _connection_error_types() -> Tuple[type, ...]:
    if not GROQ_SDK_AVAILABLE:
        return ()
    return tuple(
        error_type
        for error_type in (
            getattr(groq_sdk, "APIConnectionError", None),
            getattr(groq_sdk, "APITimeoutError", None),
        )
        if isinstance(error_type, type)
    )


# --------------------------------------------------------------------------- #
# Configuration (all overridable through environment variables)
# --------------------------------------------------------------------------- #
def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "") or default)
    except ValueError:
        return default


# Groq's free tier rejects uploads above 25 MB (100 MB on Developer tier).
MAX_GROQ_AUDIO_BYTES = _env_int("GROQ_MAX_AUDIO_BYTES", 20 * 1024 * 1024)
# 16 kHz mono s16le == 32 000 bytes/second, so 20 MB is a little over 10 minutes.
BYTES_PER_SECOND = 2 * 16000
CHUNK_CORE_SECONDS = _env_int("GROQ_CHUNK_SECONDS", 0) or max(
    60, min(600, MAX_GROQ_AUDIO_BYTES // BYTES_PER_SECOND)
)
CHUNK_OVERLAP_SECONDS = _env_float("GROQ_CHUNK_OVERLAP_SECONDS", 1.0)
AUDIO_SAMPLE_RATE = 16000
MIN_SPLIT_SECONDS = _env_float("GROQ_MIN_SPLIT_SECONDS", 45.0)
MAX_SPLIT_DEPTH = _env_int("GROQ_MAX_SPLIT_DEPTH", 4)
MAX_AUDIO_DURATION_SECONDS = _env_int("GROQ_MAX_AUDIO_SECONDS", 4 * 60 * 60)
WHISPER_ATTEMPTS = _env_int("GROQ_WHISPER_ATTEMPTS", 4)
LLM_ATTEMPTS = _env_int("GROQ_LLM_ATTEMPTS", 4)
LLM_BATCH_WORDS = _env_int("GROQ_LLM_BATCH_WORDS", 40)

WHISPER_MODEL = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3").strip()
WHISPER_FALLBACK_MODELS = [
    model.strip()
    for model in os.getenv(
        "GROQ_WHISPER_FALLBACK_MODELS", "whisper-large-v3-turbo"
    ).split(",")
    if model.strip()
]

# Order matters: first model that answers is reused for the whole job.
DEFAULT_LLM_CHAIN = (
    "openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b,llama-3.3-70b-versatile"
)
LLM_MODEL_CHAIN = [
    model.strip()
    for model in os.getenv("GROQ_LLM_MODEL", DEFAULT_LLM_CHAIN).split(",")
    if model.strip()
]

# Models that accept reasoning controls, and what to send them.
REASONING_PROFILES: Dict[str, Dict[str, Any]] = {
    "openai/gpt-oss-120b": {"reasoning_effort": "low", "include_reasoning": False},
    "openai/gpt-oss-20b": {"reasoning_effort": "low", "include_reasoning": False},
    "qwen/qwen3.8-27b": {"reasoning_effort": "none", "reasoning_format": "hidden"},
}

# style id -> words per caption group. Covers the 10 presets AND all 25 template
# ids from CaptionTemplateSystem.tsx so a style mismatch can never 400 again.
STYLE_WORDS_PER_CAPTION: Dict[str, int] = {
    # 10 primary presets
    "hormozi": 2, "karaoke": 4, "ali_abdaal": 4, "typewriter": 4,
    "neon_hacker": 2, "cinematic": 5, "comic": 3, "glitch": 2,
    "word_splash": 1, "news_ticker": 6,
    # 25 gallery templates
    "mrbeast": 2, "tiktok": 2, "shorts": 2, "reels": 2, "netflix": 5,
    "hollywood": 5, "documentary": 5, "typewriter-retro": 4, "fade-classic": 5,
    "cyberpunk": 2, "neon-strike": 2, "rgb-hacker": 2, "pixel-arcade": 2,
    "fire-drop": 2, "glass-float": 4, "liquid-morph": 3, "pastel-bounce": 3,
    "flip-3d": 3, "comic-bubble": 3, "newsroom": 6, "anime": 2, "terminal": 3,
    "vhs": 3, "editorial": 5,
}
DEFAULT_WORDS_PER_CAPTION = 3

SUPPORTED_TARGET_LANGUAGES = {
    "hinglish", "english", "spanish", "hindi", "tamil", "telugu", "bengali",
    "marathi", "punjabi", "gujarati", "malayalam", "kannada", "urdu", "arabic",
    "french", "german", "portuguese", "indonesian", "japanese", "korean",
}


# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #
class TranscriptionError(RuntimeError):
    """Base error that carries a machine code, a hint and an HTTP status."""

    code = "transcription_failed"
    http_status = 500

    def __init__(self, message: str, hint: str = "", code: Optional[str] = None,
                 http_status: Optional[int] = None):
        super().__init__(message)
        self.hint = hint
        if code:
            self.code = code
        if http_status:
            self.http_status = http_status

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": str(self),
            "hint": self.hint,
            "status": self.http_status,
        }


class InvalidApiKeyError(TranscriptionError):
    code = "invalid_api_key"
    http_status = 400


class RateLimitedError(TranscriptionError):
    code = "rate_limited"
    http_status = 429


class ModelUnavailableError(TranscriptionError):
    code = "model_unavailable"
    http_status = 503


class PayloadTooLargeError(TranscriptionError):
    code = "audio_too_large"
    http_status = 413


class NoAudioStreamError(TranscriptionError):
    code = "no_audio_stream"
    http_status = 400


class SilentAudioError(TranscriptionError):
    code = "no_speech_detected"
    http_status = 422


class UpstreamUnavailableError(TranscriptionError):
    code = "groq_unavailable"
    http_status = 503


class QuotaExceededError(TranscriptionError):
    code = "audio_too_long"
    http_status = 413


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _status_of(error: Exception) -> Optional[int]:
    for attribute in ("status_code", "http_status"):
        value = getattr(error, attribute, None)
        if isinstance(value, int):
            return value
    response = getattr(error, "response", None)
    value = getattr(response, "status_code", None)
    return value if isinstance(value, int) else None


def _retry_after_seconds(error: Exception, default: float) -> float:
    response = getattr(error, "response", None)
    headers = getattr(response, "headers", None)
    if headers:
        try:
            return max(0.5, float(headers.get("retry-after")))
        except (TypeError, ValueError):
            pass
    match = re.search(r"try again in ([\d.]+)\s*(ms|s)", str(error), re.I)
    if match:
        value = float(match.group(1))
        return value / 1000 if match.group(2).lower() == "ms" else value
    return default


def _is_rate_limit(message: str, status: Optional[int]) -> bool:
    return status == 429 or "rate limit" in message or "quota" in message


def _is_model_problem(message: str) -> bool:
    lowered = message.lower()
    return any(
        token in lowered
        for token in (
            "decommissioned", "does not exist", "not exist", "no longer available",
            "model_not_found", "unsupported model", "does not support",
        )
    )


def _is_payload_problem(message: str, status: Optional[int]) -> bool:
    lowered = message.lower()
    return status in (413,) or any(
        token in lowered
        for token in ("too large", "payload", "maximum", "file size", "too long")
    )


def _is_auth_problem(message: str, status: Optional[int]) -> bool:
    lowered = message.lower()
    return status in (401, 403) or "invalid api key" in lowered or (
        "authentication" in lowered
    )


def _sleep(attempt: int, error: Optional[Exception] = None) -> None:
    base = min(20.0, 1.6 ** attempt)
    if error is not None:
        base = max(base, _retry_after_seconds(error, base))
    time.sleep(base + random.uniform(0, 0.6))


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


@dataclass
class Warnings:
    """Collects user-visible degradation notes for the API response."""

    items: List[str] = field(default_factory=list)
    _seen: set = field(default_factory=set)

    def add(self, message: str) -> None:
        message = _clean_text(message)
        if message and message not in self._seen:
            self._seen.add(message)
            self.items.append(message)

    def __bool__(self) -> bool:  # pragma: no cover - convenience
        return bool(self.items)


# --------------------------------------------------------------------------- #
# Layer 2 prompt
# --------------------------------------------------------------------------- #
def get_layer2_system_prompt(target_language: str = "Hinglish") -> str:
    if target_language.lower() != "hinglish":
        return (
            f"You are an expert subtitle translator. Translate each input word or short phrase "
            f"into natural {target_language}. Preserve the input order and the exact start/end "
            f"timestamps. Return only a valid JSON array of objects with exactly the keys "
            f"word, start, and end. Do not add, remove, merge, or split entries. "
            f"No markdown or explanation."
        )

    return (
        "You are a Gen-Z Indian social media subtitle editor fluent in natural, "
        "conversational Hinglish. Rewrite the spoken content in everyday Hinglish using "
        "Roman script: a natural mix of English and commonly spoken Hindi, like people "
        "actually talk in Indian reels, YouTube videos, and chats.\n\n"
        "Style rules:\n"
        "- Keep familiar English words, product names, technical terms, and names in English.\n"
        "- Use casual Hindi phrases where they sound natural, such as 'yeh trick dekho', "
        "'samajh gaya', or 'aisa kyun hai'. Use slang like 'bhai' only when it fits the "
        "speaker and context; do not force it into every line.\n"
        "- Avoid formal or literary Hindi. Do not use words like 'prabandhan' or "
        "'sambhavna'; prefer the everyday English words 'management' and 'chance'.\n"
        "- Preserve the speaker's meaning, tone, and intent. Do not invent context, "
        "exaggerate, or add filler words that were not implied.\n"
        "- Keep each translated entry concise and subtitle-friendly. Translate the text "
        "value only; preserve the exact number and order of input objects and their "
        "start/end timestamps.\n\n"
        "Output contract:\n"
        "Return only a valid JSON array. Every object must have exactly these keys: "
        "\"word\", \"start\", and \"end\". Keep each start and end value exactly as supplied. "
        "Do not add, remove, merge, split, or reorder objects. No markdown or explanation. "
        "Never return a single joined sentence; always return one JSON object per input "
        "object, with the same timestamps the input used. Each \"word\" value must be "
        "shorter than 40 characters."
    )


# --------------------------------------------------------------------------- #
# FFmpeg / WAV plumbing
# --------------------------------------------------------------------------- #
def extract_audio_for_groq(video_path: Path, output_audio_path: Path) -> None:
    """Extract mono 16 kHz PCM WAV for predictable chunk sizes and timestamps."""
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg_exe,
        "-y",
        "-hide_banner",
        "-i", str(video_path),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", str(AUDIO_SAMPLE_RATE),
        "-ac", "1",
        "-f", "wav",
        str(output_audio_path),
    ]
    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not output_audio_path.is_file():
        details = (result.stderr or "").strip()
        tail = details[-600:] if details else "no FFmpeg output"
        lowered = tail.lower()
        if "does not contain any stream" in lowered or "no audio" in lowered or (
            "invalid data found" in lowered
        ):
            raise NoAudioStreamError(
                "This file has no readable audio track, so there is nothing to "
                "transcribe.",
                hint="Upload a video that contains speech/audio, or add an audio "
                     "track before captioning.",
            )
        raise NoAudioStreamError(
            f"FFmpeg could not read this file: {tail}",
            code="ffmpeg_failed",
            hint="The container may be corrupt or use a codec FFmpeg cannot "
                 "decode. Re-encode the file (e.g. to MP4/H.264 + AAC) and retry.",
        )

    size = output_audio_path.stat().st_size
    if size <= 1024:
        raise SilentAudioError(
            "No audio data was found in this file.",
            hint="The video looks silent. Captions need an audible speech track.",
        )


def _wav_format(path: Path) -> Tuple[int, int, int, int]:
    with wave.open(str(path), "rb") as handle:
        return (
            handle.getframerate(),
            handle.getnframes(),
            handle.getnchannels(),
            handle.getsampwidth(),
        )


def _write_wav_slice(
    source: wave.Wave_read,
    path: Path,
    start_frame: int,
    end_frame: int,
) -> None:
    source.setpos(start_frame)
    frames = source.readframes(max(0, end_frame - start_frame))
    with wave.open(str(path), "wb") as target:
        target.setnchannels(source.getnchannels())
        target.setsampwidth(source.getsampwidth())
        target.setframerate(source.getframerate())
        target.writeframes(frames)


def _split_wav_in_half(
    audio_path: Path,
    output_dir: Path,
    offset_seconds: float,
    tag: str,
) -> Optional[Tuple[List[Tuple[Path, float, float, float]], float]]:
    """Split one chunk file in half. Returns child chunks or None if too small."""
    sample_rate, frame_count, _, _ = _wav_format(audio_path)
    duration = frame_count / sample_rate
    if duration < MIN_SPLIT_SECONDS * 2:
        return None

    middle = frame_count // 2
    children: List[Tuple[Path, float, float, float]] = []
    with wave.open(str(audio_path), "rb") as source:
        for index, (start, end) in enumerate(
            ((0, middle), (middle, frame_count))
        ):
            child_path = output_dir / f"{tag}_part{index}.wav"
            _write_wav_slice(source, child_path, start, end)
            children.append((
                child_path,
                offset_seconds + start / sample_rate,
                offset_seconds + start / sample_rate,
                offset_seconds + end / sample_rate,
            ))
    return children, duration


def make_wav_chunks(
    audio_path: Path,
    output_dir: Path,
) -> Tuple[List[Tuple[Path, float, float, float, bool]], float]:
    """
    Return (path, chunk_audio_offset, core_start, core_end, is_last) tuples.
    Core intervals partition the source timeline; overlap supplies boundary context.
    """
    chunks: List[Tuple[Path, float, float, float, bool]] = []

    sample_rate, frame_count, channels, sample_width = _wav_format(audio_path)
    if (
        sample_rate != AUDIO_SAMPLE_RATE
        or channels != 1
        or sample_width != 2
    ):
        raise TranscriptionError(
            "Extracted audio has an unexpected WAV format.",
            hint="Re-run extraction; the file was not produced by FFmpeg as "
                 "16 kHz mono PCM.",
            code="bad_wav_format",
        )

    duration = frame_count / sample_rate
    if frame_count == 0:
        return [], 0.0

    if duration > MAX_AUDIO_DURATION_SECONDS:
        raise QuotaExceededError(
            f"Audio is {duration / 60:.0f} minutes long; the configured limit is "
            f"{MAX_AUDIO_DURATION_SECONDS / 60:.0f} minutes.",
            hint="Trim the clip, or raise GROQ_MAX_AUDIO_SECONDS in backend/.env "
                 "(Groq free tier allows ~8 h of audio per day).",
        )

    if audio_path.stat().st_size <= MAX_GROQ_AUDIO_BYTES:
        return [(audio_path, 0.0, 0.0, duration, True)], duration

    overlap_frames = int(CHUNK_OVERLAP_SECONDS * sample_rate)
    # Each request carries core + 2 x overlap seconds, so the *payload* must be
    # budgeted, not the core alone (2 bytes per frame at 16 kHz mono s16le).
    frame_budget = max(sample_rate, MAX_GROQ_AUDIO_BYTES // 2)
    max_core_frames = max(sample_rate, frame_budget - 2 * overlap_frames)
    core_frames = min(max(1, CHUNK_CORE_SECONDS * sample_rate), max_core_frames)
    core_starts = list(range(0, frame_count, core_frames))

    with wave.open(str(audio_path), "rb") as source:
        for index, core_start in enumerate(core_starts):
            core_end = min(core_start + core_frames, frame_count)
            context_start = max(0, core_start - overlap_frames)
            context_end = min(frame_count, core_end + overlap_frames)
            chunk_path = output_dir / f"audio_chunk_{index:05d}.wav"
            _write_wav_slice(source, chunk_path, context_start, context_end)
            chunks.append((
                chunk_path,
                context_start / sample_rate,
                core_start / sample_rate,
                core_end / sample_rate,
                index == len(core_starts) - 1,
            ))

    return chunks, duration


# --------------------------------------------------------------------------- #
# Layer 1: Whisper
# --------------------------------------------------------------------------- #
def _model_word_to_dict(word: Any) -> Dict[str, Any]:
    if isinstance(word, dict):
        return word
    if hasattr(word, "model_dump"):
        return word.model_dump()
    if hasattr(word, "dict"):
        return word.dict()
    try:
        return vars(word)
    except TypeError:
        return {}


def _pick_whisper_models(preferred: Optional[str] = None) -> List[str]:
    ordered = [preferred or WHISPER_MODEL]
    for model in WHISPER_FALLBACK_MODELS:
        if model not in ordered:
            ordered.append(model)
    return [model for model in ordered if model]


def run_layer1_whisper(
    client: Groq,
    audio_path: Path,
    model: Optional[str] = None,
    language: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """One whisper call with retries and automatic model fallback."""
    payload = audio_path.read_bytes()
    attempts = max(1, WHISPER_ATTEMPTS)
    last_error: Optional[Exception] = None
    models = _pick_whisper_models(model)

    for candidate in models:
        for attempt in range(attempts):
            try:
                transcription = client.audio.transcriptions.create(
                    file=(audio_path.name, payload),
                    model=candidate,
                    response_format="verbose_json",
                    timestamp_granularities=["word"],
                    **({"language": language} if language else {}),
                )
                return _parse_transcription_words(transcription, candidate)

            except Exception as error:  # noqa: BLE001 - mapped below
                last_error = error
                message = str(error)
                status = _status_of(error)

                if _is_auth_problem(message, status):
                    raise InvalidApiKeyError(
                        "Groq rejected the API key (HTTP "
                        f"{status or 401}).",
                        hint="Check GROQ_API_KEY in backend/.env, or clear the key "
                             "saved in the browser (localStorage 'groq_api_key').",
                    ) from error

                if _is_model_problem(message):
                    break  # try the next whisper model immediately

                if _is_payload_problem(message, status):
                    raise PayloadTooLargeError(
                        f"Groq rejected the audio chunk ({len(payload)} bytes): "
                        f"{_clean_text(message)[:300]}",
                        hint="Lower GROQ_MAX_AUDIO_BYTES / GROQ_CHUNK_SECONDS in "
                             "backend/.env so each request stays under the upload "
                             "limit (25 MB on the free tier).",
                    ) from error

                if _is_rate_limit(message, status) and attempt < attempts - 1:
                    _sleep(attempt, error)
                    continue

                if (status or 0) >= 500 and attempt < attempts - 1:
                    _sleep(attempt, error)
                    continue

                if isinstance(error, _connection_error_types()) and (
                    attempt < attempts - 1
                ):
                    _sleep(attempt, error)
                    continue

                break  # non-retryable: move to the next model

    raise UpstreamUnavailableError(
        "Groq Whisper could not transcribe the audio: "
        f"{_clean_text(str(last_error))[:300]}",
        hint="Retry in a minute. If this repeats, check the Groq status page and "
             "your remaining daily audio seconds (free tier: 7 200 audio "
             "seconds/hour, 28 800/day).",
    )


def _parse_transcription_words(transcription: Any, model: str) -> List[Dict[str, Any]]:
    words_data = getattr(transcription, "words", None)
    if words_data is None and isinstance(transcription, dict):
        words_data = transcription.get("words")
    if words_data is None:
        # verbose_json sometimes only fills "segments" for short/silent audio.
        segments = getattr(transcription, "segments", None) or []
        words_data = []
        for segment in segments:
            for word in getattr(segment, "words", None) or []:
                words_data.append(word)

    results: List[Dict[str, Any]] = []
    for item in words_data or []:
        word_data = _model_word_to_dict(item)
        text = _clean_text(word_data.get("word", ""))
        if not text:
            continue
        try:
            start = float(word_data.get("start", 0.0))
            end = float(word_data.get("end", start))
        except (TypeError, ValueError):
            continue
        if end <= start:
            end = start + 0.08
        results.append({"word": text, "start": start, "end": end})
    return results


def _own_window(
    local_words: Sequence[Dict[str, Any]],
    chunk_offset: float,
    own_start: float,
    own_end: float,
    is_last: bool,
    duration: float,
) -> List[Dict[str, Any]]:
    owned: List[Dict[str, Any]] = []
    for word in local_words:
        absolute_start = chunk_offset + word["start"]
        absolute_end = chunk_offset + word["end"]
        midpoint = (absolute_start + absolute_end) / 2

        owns_word = own_start <= midpoint < own_end
        if is_last and own_start <= midpoint <= max(own_end, duration):
            owns_word = True
        if not owns_word:
            continue

        absolute_start = max(0.0, min(absolute_start, duration))
        absolute_end = max(absolute_start, min(absolute_end, duration))
        owned.append({
            "word": word["word"],
            "start": round(absolute_start, 3),
            "end": round(absolute_end, 3),
        })
    return owned


def _transcribe_window(
    client: Groq,
    audio_path: Path,
    offset_seconds: float,
    own_start: float,
    own_end: float,
    is_last: bool,
    duration: float,
    warnings: Warnings,
    state: Dict[str, Any],
    output_dir: Path,
    depth: int = 0,
) -> List[Dict[str, Any]]:
    try:
        local_words = run_layer1_whisper(
            client, audio_path, model=state.get("whisper_model")
        )
        return _own_window(
            local_words, offset_seconds, own_start, own_end, is_last, duration
        )
    except (InvalidApiKeyError, NoAudioStreamError, QuotaExceededError):
        raise
    except TranscriptionError as error:
        if depth >= MAX_SPLIT_DEPTH:
            raise
        split = _split_wav_in_half(
            audio_path, output_dir, offset_seconds,
            f"split_{depth}_{audio_path.stem}",
        )
        if split is None:
            raise
        children, _child_duration = split
        warnings.add(
            f"Retrying a {(own_end - own_start) / 60:.1f} min audio block as two "
            f"smaller requests after: {_clean_text(str(error))[:120]}"
        )
        collected: List[Dict[str, Any]] = []
        # Children own contiguous halves of this window, so no word is duplicated.
        middle = own_start + (own_end - own_start) / 2
        windows = [(own_start, middle), (middle, own_end)]
        for index, (child_path, child_offset, _cs, _ce) in enumerate(children):
            window_start, window_end = windows[min(index, len(windows) - 1)]
            collected.extend(
                _transcribe_window(
                    client,
                    child_path,
                    child_offset,
                    window_start,
                    window_end,
                    is_last and index == len(children) - 1,
                    duration,
                    warnings,
                    state,
                    output_dir,
                    depth + 1,
                )
            )
        return collected


def transcribe_audio_chunks(
    client: Groq,
    chunks: List[Tuple[Path, float, float, float, bool]],
    duration: float,
    warnings: Optional[Warnings] = None,
    state: Optional[Dict[str, Any]] = None,
    output_dir: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    warnings = warnings if warnings is not None else Warnings()
    state = state if state is not None else {}
    output_dir = output_dir or (chunks[0][0].parent if chunks else Path("."))

    merged_words: List[Dict[str, Any]] = []
    for chunk_path, chunk_offset, core_start, core_end, is_last in chunks:
        merged_words.extend(
            _transcribe_window(
                client,
                chunk_path,
                chunk_offset,
                core_start,
                core_end,
                is_last,
                duration,
                warnings,
                state,
                output_dir,
            )
        )

    merged_words.sort(key=lambda item: (item["start"], item["end"]))
    return _dedupe_words(merged_words)


def _dedupe_words(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Drop the duplicates that overlap boundaries can produce."""
    result: List[Dict[str, Any]] = []
    for word in words:
        if result and word["word"] == result[-1]["word"] and (
            abs(word["start"] - result[-1]["start"]) < 0.05
        ):
            result[-1]["end"] = max(result[-1]["end"], word["end"])
            continue
        result.append(word)
    return result


# --------------------------------------------------------------------------- #
# JSON parsing for layer 2
# --------------------------------------------------------------------------- #
def _salvage_json_array(text: str) -> Optional[List[Any]]:
    """Best-effort repair of a truncated JSON array of objects."""
    start = text.find("[")
    if start < 0:
        return None
    body = text[start:]
    last_brace = body.rfind("}")
    while last_brace > 0:
        candidate = body[: last_brace + 1].rstrip().rstrip(",") + "]"
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            last_brace = body.rfind("}", 0, last_brace)
    return None


def clean_llm_json_response(raw_text: str) -> List[Dict[str, Any]]:
    text = (raw_text or "").strip()
    if "```" in text:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if match:
            text = match.group(1).strip()

    parsed: Optional[Any] = None
    start, end = text.find("["), text.rfind("]")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            parsed = _salvage_json_array(text)
    if parsed is None:
        # Accept {"items": [...]} / {"words": [...]} wrappers (JSON mode style).
        obj_start, obj_end = text.find("{"), text.rfind("}")
        if obj_start >= 0 and obj_end > obj_start:
            try:
                wrapper = json.loads(text[obj_start:obj_end + 1])
            except json.JSONDecodeError:
                wrapper = None
            if isinstance(wrapper, dict):
                for key in ("items", "words", "data", "result", "results",
                            "translation", "translations"):
                    value = wrapper.get(key)
                    if isinstance(value, list):
                        parsed = value
                        break
    if parsed is None:
        parsed = _salvage_json_array(text)
    if parsed is None or not isinstance(parsed, list):
        raise ValueError("Translation response did not contain a JSON array.")

    normalised: List[Dict[str, Any]] = []
    for item in parsed:
        if isinstance(item, dict):
            normalised.append(item)
        elif isinstance(item, str):
            normalised.append({"word": item})
    if not normalised:
        raise ValueError("Translation response contained an empty JSON array.")
    return normalised


# --------------------------------------------------------------------------- #
# Layer 2: LLM rewrite
# --------------------------------------------------------------------------- #
def _llm_request_kwargs(model: str, system_prompt: str, batch: List[Dict[str, Any]],
                        lean: bool = False) -> Dict[str, Any]:
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(batch, ensure_ascii=False)},
    ]
    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.6 if model in REASONING_PROFILES else 0.2,
        "max_tokens": 8192 if model in REASONING_PROFILES else 4096,
    }
    if not lean:
        kwargs.update(REASONING_PROFILES.get(model, {}))
    return kwargs


def _call_llm(
    client: Groq,
    model: str,
    system_prompt: str,
    batch: List[Dict[str, Any]],
    warnings: Warnings,
) -> List[Dict[str, Any]]:
    """Call one model, retrying rate limits and unsupported params."""
    attempts = max(1, LLM_ATTEMPTS)
    last_error: Optional[Exception] = None
    lean = False

    for attempt in range(attempts):
        try:
            completion = client.chat.completions.create(
                **_llm_request_kwargs(model, system_prompt, batch, lean=lean)
            )
            content = ""
            try:
                content = completion.choices[0].message.content or ""
            except (AttributeError, IndexError):
                content = str(completion)
            if not content.strip():
                raise ValueError("The model returned an empty response.")
            return clean_llm_json_response(content)

        except Exception as error:  # noqa: BLE001 - decision tree below
            last_error = error
            message = str(error)
            status = _status_of(error)

            if _is_auth_problem(message, status):
                raise InvalidApiKeyError(
                    "Groq rejected the API key (HTTP "
                    f"{status or 401}).",
                    hint="Check GROQ_API_KEY in backend/.env, or clear the key "
                         "saved in the browser (localStorage 'groq_api_key').",
                ) from error

            if _is_model_problem(message):
                raise ModelUnavailableError(
                    f"Model '{model}' is not available: "
                    f"{_clean_text(message)[:200]}",
                    hint="Set GROQ_LLM_MODEL in backend/.env to a served model, "
                         "e.g. openai/gpt-oss-120b,qwen/qwen3.8-27b.",
                ) from error

            if not lean and status == 400:
                # Unsupported parameter for this model: retry with a minimal body.
                lean = True
                warnings.add(
                    f"Model '{model}' rejected extra parameters; retrying with a "
                    f"minimal request body."
                )
                continue

            if _is_rate_limit(message, status) and attempt < attempts - 1:
                _sleep(attempt, error)
                continue

            if (status or 0) >= 500 and attempt < attempts - 1:
                _sleep(attempt, error)
                continue

            if isinstance(error, _connection_error_types()) and (
                attempt < attempts - 1
            ):
                _sleep(attempt, error)
                continue

            break

    raise ModelUnavailableError(
        f"Model '{model}' failed: {_clean_text(str(last_error))[:200]}"
    )


def _align_batch(
    batch: List[Dict[str, Any]],
    translated: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    aligned: List[Dict[str, Any]] = []
    for index, source in enumerate(batch):
        text = ""
        if index < len(translated):
            text = _clean_text(translated[index].get("word", ""))
        if len(text) > 60:  # a merged sentence would break word-level captions
            text = source["word"]
        aligned.append({
            "word": text or source["word"],
            "start": source["start"],
            "end": source["end"],
        })
    return aligned


def _translate_batch(
    client: Groq,
    batch: List[Dict[str, Any]],
    system_prompt: str,
    state: Dict[str, Any],
    warnings: Warnings,
    depth: int = 0,
) -> Tuple[List[Dict[str, Any]], int]:
    """Translate one batch. Returns (words, count_of_real_translations)."""
    chain = list(LLM_MODEL_CHAIN)
    preferred = state.get("llm_model")
    if preferred and preferred in chain:
        chain.remove(preferred)
        chain.insert(0, preferred)
    elif preferred:
        chain.insert(0, preferred)

    last_error: Optional[Exception] = None
    for model in chain:
        try:
            translated = _call_llm(client, model, system_prompt, batch, warnings)
            state["llm_model"] = model
            if model != preferred:
                warnings.add(f"Caption rewrite layer is using '{model}'.")

            if len(translated) == len(batch):
                words = _align_batch(batch, translated)
                return words, sum(
                    1 for source, item in zip(batch, words)
                    if item["word"] != source["word"]
                )

            # Wrong length: keep what aligns, re-ask for the remainder.
            paired = _align_batch(batch[:len(translated)], translated)
            if len(translated) < len(batch) and depth < 2:
                remainder = batch[len(translated):]
                warnings.add(
                    f"'{model}' returned {len(translated)} of {len(batch)} entries; "
                    f"re-requesting the remaining {len(remainder)}."
                )
                tail_words, tail_count = _translate_batch(
                    client, remainder, system_prompt, state, warnings, depth + 1
                )
                return paired + tail_words, tail_count

            warnings.add(
                f"'{model}' returned {len(translated)} entries for {len(batch)} "
                f"words; unmatched words kept in the source language."
            )
            return paired, sum(
                1 for source, item in zip(batch, paired)
                if item["word"] != source["word"]
            )

        except InvalidApiKeyError:
            raise
        except TranscriptionError as error:
            last_error = error
            if model != chain[-1]:
                warnings.add(
                    f"Caption rewrite model '{model}' unavailable "
                    f"({_clean_text(str(error))[:100]}); trying the next model."
                )
            continue

    if depth < 2 and len(batch) > 12:
        # Smaller batches are far more likely to come back well-formed.
        middle = len(batch) // 2
        warnings.add(
            "Splitting a caption batch in half after repeated rewrite failures."
        )
        left_words, left_count = _translate_batch(
            client, batch[:middle], system_prompt, state, warnings, depth + 1
        )
        right_words, right_count = _translate_batch(
            client, batch[middle:], system_prompt, state, warnings, depth + 1
        )
        return left_words + right_words, left_count + right_count

    warnings.add(
        "Caption rewrite unavailable for some lines; those lines keep the original "
        f"transcript text. Last error: {_clean_text(str(last_error))[:160]}"
    )
    return _align_batch(batch, []), 0


def run_layer2_translation_cleanup(
    client: Groq,
    raw_words: List[Dict[str, Any]],
    target_language: str = "Hinglish",
    warnings: Optional[Warnings] = None,
    state: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    if not raw_words:
        return []

    warnings = warnings if warnings is not None else Warnings()
    state = state if state is not None else {}

    batch_size = max(5, min(120, LLM_BATCH_WORDS))
    translated_words: List[Dict[str, Any]] = []
    translated_total = 0
    system_prompt = get_layer2_system_prompt(target_language)

    for start_index in range(0, len(raw_words), batch_size):
        batch = raw_words[start_index:start_index + batch_size]
        words, count = _translate_batch(
            client, batch, system_prompt, state, warnings
        )
        translated_words.extend(words)
        translated_total += count

    state["translated_words"] = translated_total
    if raw_words:
        ratio = translated_total / len(raw_words)
        if ratio < 0.6:
            warnings.add(
                f"Only {translated_total}/{len(raw_words)} words were rewritten into "
                f"{target_language}. Captions may appear untranslated."
            )
    return translated_words


# --------------------------------------------------------------------------- #
# Caption grouping
# --------------------------------------------------------------------------- #
def words_per_caption_for_style(style: str) -> int:
    return STYLE_WORDS_PER_CAPTION.get((style or "").strip().lower(),
                                       DEFAULT_WORDS_PER_CAPTION)


def create_caption_chunks(
    words: List[Dict[str, Any]],
    max_words: int,
    max_pause_seconds: float = 0.35,
) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []
    current: List[Dict[str, Any]] = []
    max_words = max(1, int(max_words))

    for word in words:
        should_split = False
        if current:
            pause = word["start"] - current[-1]["end"]
            should_split = pause > max_pause_seconds or len(current) >= max_words

        if should_split:
            chunks.append({
                "id": len(chunks),
                "start": current[0]["start"],
                "end": current[-1]["end"],
                "text": " ".join(item["word"] for item in current),
                "words": current,
            })
            current = []
        current.append(word)

    if current:
        chunks.append({
            "id": len(chunks),
            "start": current[0]["start"],
            "end": current[-1]["end"],
            "text": " ".join(item["word"] for item in current),
            "words": current,
        })

    return chunks


def create_sentence_segments(
    words: List[Dict[str, Any]],
    max_words: int = 8,
    pause_seconds: float = 0.45,
) -> List[Dict[str, Any]]:
    segments: List[Dict[str, Any]] = []
    current: List[Dict[str, Any]] = []
    max_words = max(1, int(max_words))

    for word in words:
        if current:
            pause = word["start"] - current[-1]["end"]
            previous_ends_sentence = current[-1]["word"].endswith((".", "?", "!", "।"))
            if pause > pause_seconds or previous_ends_sentence or len(current) >= max_words:
                segments.append({
                    "id": len(segments),
                    "start": current[0]["start"],
                    "end": current[-1]["end"],
                    "text": " ".join(item["word"] for item in current),
                    "words": current,
                })
                current = []
        current.append(word)

    if current:
        segments.append({
            "id": len(segments),
            "start": current[0]["start"],
            "end": current[-1]["end"],
            "text": " ".join(item["word"] for item in current),
            "words": current,
        })

    return segments


# --------------------------------------------------------------------------- #
# Diagnostics
# --------------------------------------------------------------------------- #
def diagnose_groq(api_key: Optional[str] = None) -> Dict[str, Any]:
    """Live check of the key, the models the key can see and the caption chain."""
    key = api_key or os.getenv("GROQ_API_KEY")
    report: Dict[str, Any] = {
        "api_key_present": bool(key),
        "api_key_looks_valid": bool(key and key.startswith("gsk_")),
        "whisper_model": WHISPER_MODEL,
        "whisper_fallbacks": WHISPER_FALLBACK_MODELS,
        "llm_model_chain": LLM_MODEL_CHAIN,
        "chunk_seconds": CHUNK_CORE_SECONDS,
        "max_audio_bytes": MAX_GROQ_AUDIO_BYTES,
        "available_models": None,
        "whisper_served": None,
        "llm_served": None,
        "chat_ping": None,
        "error": None,
        "hint": None,
    }
    if not key:
        report["error"] = "GROQ_API_KEY is not set."
        report["hint"] = "Add GROQ_API_KEY=gsk_... to backend/.env and restart."
        return report

    client = Groq(api_key=key)
    try:
        models = client.models.list()
        served = sorted(
            getattr(item, "id", "") for item in (getattr(models, "data", None) or [])
        )
        report["available_models"] = served
        report["whisper_served"] = WHISPER_MODEL in served
        report["llm_served"] = LLM_MODEL_CHAIN[0] in served
        if not report["whisper_served"]:
            report["hint"] = (
                f"'{WHISPER_MODEL}' is not in this key's model list. Set "
                f"GROQ_WHISPER_MODEL to one of: "
                f"{', '.join(m for m in served if 'whisper' in m) or 'whisper-large-v3'}"
            )
    except Exception as error:  # noqa: BLE001
        report["error"] = (f"Could not list models: {_clean_text(str(error))[:300]}")
        report["hint"] = (
            "A 401 here means the API key is wrong or was revoked. Clear the key "
            "saved in the browser (localStorage 'groq_api_key') and re-enter it."
        )
        return report

    for model in LLM_MODEL_CHAIN:
        try:
            completion = client.chat.completions.create(
                **_llm_request_kwargs(
                    model, "Reply with the single JSON object {\"ok\": true}.",
                    [{"word": "ping", "start": 0.0, "end": 0.1}],
                )
            )
            content = completion.choices[0].message.content or ""
            report["chat_ping"] = {
                "model": model,
                "reply": _clean_text(content)[:200],
                "ok": True,
            }
            report["llm_served"] = True
            break
        except Exception as error:  # noqa: BLE001
            report["chat_ping"] = {
                "model": model,
                "ok": False,
                "error": _clean_text(str(error))[:300],
            }
    return report


# --------------------------------------------------------------------------- #
# Orchestrator
# --------------------------------------------------------------------------- #
def transcribe_video_double_layer(
    video_path: Path,
    target_language: str = "Hinglish",
    style: str = "hormozi",
    api_key: Optional[str] = None,
    source_language: Optional[str] = None,
) -> Dict[str, Any]:
    video_path = Path(video_path)
    if not video_path.is_file():
        raise TranscriptionError(
            f"Video file not found: {video_path}",
            hint="Upload the file again; the previous upload may have been deleted.",
            code="file_not_found",
            http_status=404,
        )

    groq_key = api_key or os.getenv("GROQ_API_KEY")
    if not groq_key:
        raise InvalidApiKeyError(
            "GROQ_API_KEY is not configured.",
            hint="Set GROQ_API_KEY in backend/.env or enter the key in the app.",
        )

    if not GROQ_SDK_AVAILABLE:
        raise UpstreamUnavailableError(
            "The 'groq' package is not installed in the backend environment.",
            hint="Run: pip install -r backend/requirements.txt",
        )

    client = Groq(api_key=groq_key)
    warnings = Warnings()
    state: Dict[str, Any] = {"llm_model": None, "translated_words": 0}

    with tempfile.TemporaryDirectory(prefix="autocaption_") as temporary_directory:
        working_dir = Path(temporary_directory)
        extracted_audio = working_dir / "source_audio.wav"

        extract_audio_for_groq(video_path, extracted_audio)
        chunks, audio_duration = make_wav_chunks(extracted_audio, working_dir)

        raw_words = transcribe_audio_chunks(
            client, chunks, audio_duration, warnings=warnings, state=state,
            output_dir=working_dir,
        )
        if not raw_words:
            raise SilentAudioError(
                "Whisper found no speech in this file.",
                hint="Check that the clip actually contains dialogue and that the "
                     "audio is not muted or drowned out by music.",
            )

        translated_words = run_layer2_translation_cleanup(
            client, raw_words, target_language, warnings=warnings, state=state
        )

    if len(chunks) > 1:
        warnings.add(
            f"Audio was split into {len(chunks)} chunks of about "
            f"{CHUNK_CORE_SECONDS / 60:.0f} minutes."
        )

    words_per_caption = words_per_caption_for_style(style)
    caption_chunks = create_caption_chunks(
        translated_words, max_words=words_per_caption
    )
    segments = create_sentence_segments(translated_words)
    translated_total = int(state.get("translated_words") or 0)
    translation_applied = translated_total > 0

    return {
        "words": translated_words,
        "segments": segments,
        # `hormozi_chunks` kept for backwards compatibility; same payload.
        "hormozi_chunks": caption_chunks,
        "caption_chunks": caption_chunks,
        "words_per_caption": words_per_caption,
        "full_text": " ".join(word["word"] for word in translated_words),
        "total_words": len(translated_words),
        "total_chunks": len(caption_chunks),
        "total_segments": len(segments),
        "duration": round(audio_duration, 3),
        "audio_chunks": len(chunks),
        "target_language": target_language,
        "style": style,
        "system": "double_layer_groq_chunked",
        "whisper_model": WHISPER_MODEL,
        "llm_model": state.get("llm_model"),
        "translation_applied": translation_applied,
        "translated_words": translated_total,
        "warnings": warnings.items,
        "degraded": not translation_applied,
    }
