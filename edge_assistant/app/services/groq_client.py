"""Groq API client for intent parsing, response generation, and TTS."""

from __future__ import annotations

import json

import httpx

from app.config import Settings


class GroqClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _headers(self) -> dict[str, str]:
        if not self._settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")
        return {
            "Authorization": f"Bearer {self._settings.groq_api_key}",
            "Content-Type": "application/json",
        }

    async def parse_intent(self, transcript: str, relay_states: list[dict]) -> dict:
        relay_lines = []
        for relay in relay_states:
            relay_lines.append(f"- Relay {relay['id']}: {'ON' if relay['isOn'] else 'OFF'}")

        prompt = (
            "You are an IoT command parser. Return only valid JSON.\\n"
            "Schema: {\"action\":\"relay_control|all_off|status|unknown\",\"relay_id\":number|null,\"state\":\"on|off\"|null,\"reason\":string|null}\\n"
            f"Relay states:\\n{chr(10).join(relay_lines)}"
        )

        payload = {
            "temperature": 0.1,
            "max_tokens": 80,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": transcript},
            ],
        }

        content = await self._chat_with_fallback(payload)

        clean = content.replace("```json", "").replace("```", "").strip()
        return json.loads(clean)

    async def respond(self, transcript: str, command_result: str | None, relay_states: list[dict]) -> str:
        context = ", ".join(
            f"relay {r['id']} is {'ON' if r['isOn'] else 'OFF'}" for r in relay_states
        ) or "no relay state available"

        user_content = (
            f"User said: {transcript}. Command result: {command_result}."
            if command_result
            else f"User said: {transcript}."
        )

        payload = {
            "temperature": 0.6,
            "max_tokens": 80,
            "messages": [
                {
                    "role": "system",
                    "content": "You are Buddy, a smart home assistant. Keep responses short, clear, and safe.",
                },
                {
                    "role": "system",
                    "content": f"Current home state: {context}",
                },
                {"role": "user", "content": user_content},
            ],
        }

        return await self._chat_with_fallback(payload)

    async def synthesize_tts(self, text: str) -> tuple[bytes, str]:
        model_candidates = [self._settings.tts_model]
        errors: list[str] = []

        async with httpx.AsyncClient(timeout=6) as client:
            for model in model_candidates:
                voice_candidates = [self._settings.tts_voice, "autumn", "diana", "hannah", "austin", "daniel", "troy"]

                # De-duplicate while preserving order.
                seen: set[str | None] = set()
                uniq_voices = []
                for voice in voice_candidates:
                    if voice in seen:
                        continue
                    seen.add(voice)
                    uniq_voices.append(voice)

                for voice in uniq_voices:
                    payload = {
                        "model": model,
                        "input": text,
                        "response_format": self._settings.tts_format,
                    }
                    payload["voice"] = voice

                    try:
                        resp = await client.post(
                            f"{self._settings.groq_base_url}/audio/speech",
                            headers=self._headers(),
                            json=payload,
                        )
                    except Exception as exc:
                        errors.append(f"{model}/{voice}: {exc}")
                        continue

                    if resp.status_code >= 400:
                        detail = (resp.text or "")[:180]
                        errors.append(f"{model}/{voice}: HTTP {resp.status_code} {detail}")
                        continue

                    content_type = resp.headers.get("content-type", "audio/mpeg")
                    return resp.content, content_type

        raise RuntimeError("all tts models failed: " + " | ".join(errors))

    async def _chat_with_fallback(self, payload: dict) -> str:
        model_candidates = [self._settings.llm_model, "llama-3.1-8b-instant"]
        errors: list[str] = []

        async with httpx.AsyncClient(timeout=6) as client:
            for model in model_candidates:
                req = {**payload, "model": model}
                try:
                    resp = await client.post(
                        f"{self._settings.groq_base_url}/chat/completions",
                        headers=self._headers(),
                        json=req,
                    )
                except Exception as exc:
                    errors.append(f"{model}: {exc}")
                    continue

                if resp.status_code >= 400:
                    errors.append(f"{model}: HTTP {resp.status_code} {(resp.text or '')[:160]}")
                    continue

                return resp.json()["choices"][0]["message"]["content"].strip()

        raise RuntimeError("chat completion failed: " + " | ".join(errors))
