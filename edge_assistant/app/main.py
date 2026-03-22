"""FastAPI application entrypoint for the local edge assistant."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers.orchestrator import router as orchestrator_router
from app.routers.room import router as room_router
from app.routers.security import router as security_router
from app.routers.smoke import router as smoke_router
from app.routers.voice import router as voice_router

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-IOT-Token", "X-IOT-MFA-Token"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, __: Exception):
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

app.include_router(security_router)
app.include_router(voice_router)
app.include_router(smoke_router)
app.include_router(orchestrator_router)
app.include_router(room_router, prefix="/room")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": settings.app_name, "env": settings.app_env}
