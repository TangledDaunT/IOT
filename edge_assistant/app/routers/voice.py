"""Voice API routes: STT, intent parsing, response generation, and TTS."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from app.config import Settings, get_settings
from app.schemas import (
    IntentResponse,
    ParseRequest,
    RespondRequest,
    RespondResponse,
    TranscribeResponse,
    TtsRequest,
)
from app.services.groq_client import GroqClient
from app.services.stt import WhisperSttService
from app.security import rate_limit, require_api_token

router = APIRouter(prefix="/api/voice", tags=["voice"], dependencies=[Depends(require_api_token)])
_stt_service: WhisperSttService | None = None


def get_stt_service(settings: Settings = Depends(get_settings)) -> WhisperSttService:
    global _stt_service
    if _stt_service is None:
        _stt_service = WhisperSttService(settings)
    return _stt_service


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    stt: WhisperSttService = Depends(get_stt_service),
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit(20, 60)),
) -> TranscribeResponse:
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=415, detail="Unsupported media type")

    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Audio payload is empty")
    if len(data) > settings.security_max_audio_bytes:
        raise HTTPException(status_code=413, detail="Audio payload too large")

    suffix = f".{audio.filename.rsplit('.', 1)[-1]}" if audio.filename and "." in audio.filename else ".webm"

    transcript, language, duration = stt.transcribe_bytes(data, suffix=suffix)
    return TranscribeResponse(transcript=transcript, language=language, duration_s=duration)


@router.post("/parse", response_model=IntentResponse)
async def parse_intent(
    req: ParseRequest,
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit(40, 60)),
) -> IntentResponse:
    try:
        client = GroqClient(settings)
        parsed = await client.parse_intent(req.transcript, [s.model_dump() for s in req.relay_states])
        return IntentResponse(**parsed)
    except Exception:
        fallback = _parse_intent_fallback(req.transcript)
        return IntentResponse(**fallback)


@router.post("/respond", response_model=RespondResponse)
async def respond_text(
    req: RespondRequest,
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit(40, 60)),
) -> RespondResponse:
    try:
        client = GroqClient(settings)
        reply = await client.respond(
            transcript=req.transcript,
            command_result=req.command_result,
            relay_states=[s.model_dump() for s in req.relay_states],
        )
        return RespondResponse(reply=reply)
    except Exception:
        fallback = _fallback_reply(req.transcript, req.command_result)
        return RespondResponse(reply=fallback)


@router.post("/tts")
async def synthesize_tts(
    req: TtsRequest,
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit(30, 60)),
) -> Response:
    try:
        client = GroqClient(settings)
        audio_bytes, content_type = await client.synthesize_tts(req.text)
        return Response(content=audio_bytes, media_type=content_type)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="TTS synthesis failed") from exc


def _parse_intent_fallback(transcript: str) -> dict:
    t = transcript.lower().strip()

    m = re.search(r"\bturn\s+(on|off)\s+relay\s*(\d+)\b", t)
    if m:
        return {
            "action": "relay_control",
            "relay_id": int(m.group(2)),
            "state": m.group(1),
            "reason": "fallback_parser",
        }

    m = re.search(r"\brelay\s*(\d+)\s+(on|off)\b", t)
    if m:
        return {
            "action": "relay_control",
            "relay_id": int(m.group(1)),
            "state": m.group(2),
            "reason": "fallback_parser",
        }

    if re.search(r"\b(all\s*off|turn\s+off\s+all|everything\s+off)\b", t):
        return {"action": "all_off", "relay_id": None, "state": None, "reason": "fallback_parser"}

    if re.search(r"\b(status|what.?s\s+on|report|show)\b", t):
        return {"action": "status", "relay_id": None, "state": None, "reason": "fallback_parser"}

    return {"action": "unknown", "relay_id": None, "state": None, "reason": "fallback_parser"}


def _fallback_reply(transcript: str, command_result: str | None) -> str:
    if command_result:
        return f"Done. {command_result}."
    return f"I heard you say: {transcript}. Please repeat if you want a specific relay action."
