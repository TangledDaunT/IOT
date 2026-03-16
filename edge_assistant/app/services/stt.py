"""Local Whisper STT service wrapper."""

from __future__ import annotations

import tempfile
from pathlib import Path

from faster_whisper import WhisperModel

from app.config import Settings


class WhisperSttService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._model: WhisperModel | None = None

    def _ensure_model(self) -> WhisperModel:
        if self._model is None:
            self._model = WhisperModel(
                self._settings.whisper_model,
                device=self._settings.whisper_device,
                compute_type=self._settings.whisper_compute_type,
            )
        return self._model

    def transcribe_bytes(self, audio_bytes: bytes, suffix: str = ".webm") -> tuple[str, str | None, float | None]:
        model = self._ensure_model()

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(audio_bytes)
            temp_path = Path(tmp.name)

        try:
            segments, info = model.transcribe(
                str(temp_path),
                language=self._settings.whisper_language,
                vad_filter=self._settings.whisper_vad_filter,
                beam_size=self._settings.whisper_beam_size,
            )
            transcript = " ".join(seg.text.strip() for seg in segments).strip()
            duration = float(info.duration) if info.duration is not None else None
            return transcript, info.language, duration
        finally:
            temp_path.unlink(missing_ok=True)
