"""Local faster-whisper engine (used when engine="local").

The heavy imports are deliberately lazy so that importing this module can never
crash the FastAPI app at boot when faster-whisper / torch are not installed.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

_MODEL_CACHE: Dict[str, Any] = {}


def _load_model(model_size: str):
    from faster_whisper import WhisperModel  # lazy: optional dependency

    if model_size not in _MODEL_CACHE:
        device = os.getenv("WHISPER_DEVICE", "cpu")
        compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
        _MODEL_CACHE[model_size] = WhisperModel(
            model_size, device=device, compute_type=compute_type
        )
    return _MODEL_CACHE[model_size]


def transcribe_video(
    video_path: Path,
    model_size: str = "base",
    language: Optional[str] = None,
) -> Dict[str, Any]:
    """Transcribe with faster-whisper and return the same schema as the Groq path."""
    import subprocess

    import imageio_ffmpeg

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    audio_path = Path(video_path).with_suffix(".local16k.wav")
    command = [
        ffmpeg_exe, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(video_path), "-vn", "-acodec", "pcm_s16le",
        "-ar", "16000", "-ac", "1", str(audio_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0 or not audio_path.is_file():
        raise RuntimeError(
            "FFmpeg could not extract an audio track from this file "
            "(it may have no audio stream)."
        )

    try:
        model = _load_model(model_size)
        segments, _info = model.transcribe(
            str(audio_path), language=language, word_timestamps=True
        )
        words: List[Dict[str, Any]] = []
        for segment in segments:
            for word in getattr(segment, "words", None) or []:
                words.append({
                    "word": word.word.strip(),
                    "start": round(float(word.start), 3),
                    "end": round(float(word.end), 3),
                })
    finally:
        audio_path.unlink(missing_ok=True)

    full_text = " ".join(word["word"] for word in words)
    return {
        "words": words,
        "segments": [
            {
                "id": index,
                "start": word["start"],
                "end": word["end"],
                "text": word["word"],
                "words": [word],
            }
            for index, word in enumerate(words)
        ],
        "full_text": full_text,
        "total_words": len(words),
        "total_segments": len(words),
        "total_chunks": len(words),
        "target_language": language or "auto",
        "style": "word_splash",
        "engine": "local",
        "system": f"faster_whisper_{model_size}",
    }
