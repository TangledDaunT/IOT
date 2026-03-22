"""Microphone worker using Groq Whisper + Groq emotion classification."""

from __future__ import annotations

import os
import tempfile
import time
import wave
from typing import Any

import numpy as np
import pyaudio
import requests
from dotenv import load_dotenv
from groq import Groq

SAMPLE_RATE = 16000
CHUNK = 1024
SILENCE_THRESHOLD = 500
MIN_SPEECH_SECS = 1.5
MAX_SPEECH_SECS = 30
IOT_BRIDGE = "http://localhost:8088"
GROQ_MODEL = "whisper-large-v3-turbo"
EMOTION_MODEL = "llama-3.1-8b-instant"

load_dotenv()


def _log(message: str) -> None:
    print(f"[AUDIO] {message}", flush=True)


def _rms_int16(audio_bytes: bytes) -> float:
    if not audio_bytes:
        return 0.0
    samples = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(samples))))


def _capture_speech(stream: Any) -> tuple[bytes, float] | tuple[None, float]:
    frames: list[bytes] = []
    started = False
    speech_start = 0.0
    silence_secs = 0.0

    loop_start = time.time()
    while True:
        chunk = stream.read(CHUNK, exception_on_overflow=False)
        rms = _rms_int16(chunk)
        now = time.time()

        if rms > SILENCE_THRESHOLD:
            if not started:
                started = True
                speech_start = now
            frames.append(chunk)
            silence_secs = 0.0
        elif started:
            frames.append(chunk)
            silence_secs += CHUNK / float(SAMPLE_RATE)
            if silence_secs >= 1.5:
                break

        if started and (now - speech_start) >= MAX_SPEECH_SECS:
            break

        if not started and (now - loop_start) > 1.5:
            return None, 0.0

    if not started:
        return None, 0.0

    duration = len(b"".join(frames)) / 2.0 / SAMPLE_RATE
    if duration < MIN_SPEECH_SECS:
        return None, duration
    return b"".join(frames), duration


def _write_temp_wav(audio_bytes: bytes) -> str:
    tmp = tempfile.NamedTemporaryFile(prefix="edge_audio_", suffix=".wav", delete=False)
    tmp.close()

    with wave.open(tmp.name, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_bytes)
    return tmp.name


def _transcribe(client: Groq, wav_path: str) -> str:
    with open(wav_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(model=GROQ_MODEL, file=audio_file)
    text = getattr(response, "text", "")
    return (text or "").strip()


def _classify_emotion(client: Groq, text: str) -> str:
    if not text.strip():
        return "neu"

    response = client.chat.completions.create(
        model=EMOTION_MODEL,
        temperature=0.0,
        messages=[
            {
                "role": "system",
                "content": "You are an emotion classifier. Respond with exactly one word from: ang, hap, sad, neu",
            },
            {"role": "user", "content": text},
        ],
    )
    raw = (response.choices[0].message.content or "").strip().lower()
    token = raw.split()[0] if raw else "neu"
    if token not in {"ang", "hap", "sad", "neu"}:
        return "neu"
    return token


def _post_audio_event(text: str, emotion: str) -> None:
    payload = {
        "text": text,
        "emotion": emotion,
        "timestamp": time.time(),
    }
    try:
        requests.post(f"{IOT_BRIDGE}/room/audio_event", json=payload, timeout=10)
    except Exception as exc:
        _log(f"failed posting audio event: {exc}")


def run() -> None:
    api_key = os.getenv("GROQ_API_KEY", "")
    if not api_key:
        _log("GROQ_API_KEY missing; exiting")
        return

    client = Groq(api_key=api_key)

    pa = pyaudio.PyAudio()
    stream = pa.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=SAMPLE_RATE,
        input=True,
        frames_per_buffer=CHUNK,
    )

    _log("worker started")

    while True:
        try:
            audio_bytes, duration = _capture_speech(stream)
            if not audio_bytes:
                continue

            wav_path = _write_temp_wav(audio_bytes)
            try:
                text = _transcribe(client, wav_path)
                if not text:
                    _log(f"empty transcription for duration={duration:.2f}s")
                    continue
                emotion = _classify_emotion(client, text)
                _post_audio_event(text, emotion)
                _log(f"text={text[:80]!r} emotion={emotion}")
            finally:
                try:
                    os.unlink(wav_path)
                except Exception:
                    pass
        except Exception as exc:
            _log(f"loop error: {exc}")
            time.sleep(0.5)


if __name__ == "__main__":
    run()
