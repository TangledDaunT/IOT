"""Orchestrator routes for event ingestion and state access."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.schemas import OrchestratorEvent
from app.security import rate_limit, require_api_token
from app.services.orchestrator import OrchestratorService

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"], dependencies=[Depends(require_api_token)])

_service: OrchestratorService | None = None


def get_orchestrator(settings: Settings = Depends(get_settings)) -> OrchestratorService:
    global _service
    if _service is None:
        _service = OrchestratorService(settings)
    return _service


@router.post("/event")
def ingest_event(
    event: OrchestratorEvent,
    orchestrator: OrchestratorService = Depends(get_orchestrator),
    _: None = Depends(rate_limit(120, 60)),
):
    decision = orchestrator.ingest_event(event.event_type, event.payload)
    return {"ok": True, "decision": decision}


@router.get("/state")
def get_state(
    orchestrator: OrchestratorService = Depends(get_orchestrator),
    _: None = Depends(rate_limit(120, 60)),
):
    return orchestrator.get_state().model_dump()


@router.post("/confirm-smoking")
def confirm_smoking(
    answer: bool,
    orchestrator: OrchestratorService = Depends(get_orchestrator),
    _: None = Depends(rate_limit(20, 60)),
):
    decision = orchestrator.resolve_smoke_confirmation(answer)
    return {"ok": True, "decision": decision}
