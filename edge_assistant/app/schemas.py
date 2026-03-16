"""Pydantic request/response models for edge assistant APIs."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class RelayState(BaseModel):
    id: int
    isOn: bool


class TranscribeResponse(BaseModel):
    transcript: str
    language: str | None = None
    duration_s: float | None = None


class ParseRequest(BaseModel):
    transcript: str = Field(min_length=1)
    relay_states: list[RelayState] = Field(default_factory=list)


class IntentResponse(BaseModel):
    action: Literal["relay_control", "all_off", "status", "unknown"]
    relay_id: int | None = None
    state: Literal["on", "off"] | None = None
    reason: str | None = None


class RespondRequest(BaseModel):
    transcript: str = Field(min_length=1)
    command_result: str | None = None
    relay_states: list[RelayState] = Field(default_factory=list)


class RespondResponse(BaseModel):
    reply: str


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=800)


class OrchestratorEvent(BaseModel):
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class OrchestratorState(BaseModel):
    smoke_active: bool = False
    room: dict[str, Any] = Field(default_factory=dict)
    sensors: dict[str, Any] = Field(default_factory=dict)
    pending_smoke_confirmation: bool = False
    last_actions: list[dict[str, Any]] = Field(default_factory=list)
