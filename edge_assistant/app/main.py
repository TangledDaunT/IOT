"""FastAPI application entrypoint for the local edge assistant."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers.orchestrator import router as orchestrator_router
from app.routers.voice import router as voice_router

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(voice_router)
app.include_router(orchestrator_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": settings.app_name, "env": settings.app_env}
