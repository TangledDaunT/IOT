"""Configuration for the edge AI assistant service."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[1] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "IOT Edge Assistant"
    app_env: Literal["development", "production", "test"] = "development"
    log_level: str = "INFO"

    host: str = "0.0.0.0"
    port: int = 8088
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    # Security controls
    security_api_token: str | None = None
    security_mfa_code: str | None = None
    security_mfa_challenge_ttl_seconds: int = 180
    security_mfa_token_ttl_seconds: int = 600
    security_max_audio_bytes: int = 5 * 1024 * 1024
    security_max_image_bytes: int = 1 * 1024 * 1024

    # Existing IoT backend (ESP32/API)
    iot_base_url: str = "http://192.168.1.10"
    iot_timeout_seconds: float = 8.0
    room_sensor_path: str = "/room/status"
    smoke_status_path: str = "/smoke/status"
    relay_status_path: str = "/relays/status"
    relay_toggle_path: str = "/relays/toggle"

    # STT (local Whisper)
    whisper_model: str = "tiny.en"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_beam_size: int = 1
    whisper_vad_filter: bool = True
    whisper_language: str = "en"

    # Groq LLM + TTS
    groq_api_key: str | None = None
    groq_base_url: str = "https://api.groq.com/openai/v1"
    llm_model: str = "llama-3.1-8b-instant"
    tts_model: str = "canopylabs/orpheus-v1-english"
    tts_voice: str = "autumn"
    tts_format: str = "wav"

    # Nebius (optional provider/fallback)
    nebius_api_key: str | None = None
    nebius_base_url: str = "https://api.studio.nebius.com/v1"

    # 24/7 sensor worker
    sensor_worker_enabled: bool = True
    sensor_poll_interval_ms: int = 2000

    # Notifications
    notify_webhook_url: str | None = None

    # Orchestrator policy
    autonomy_enabled: bool = True
    autonomy_safe_actions: set[str] = Field(default_factory=lambda: {"alerts", "fan", "lights"})
    smoke_confirmation_required: bool = True
    smoke_confirm_yes_action: str = "fan_off"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
