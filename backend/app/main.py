"""
WeighGuard FastAPI Core Backend Application.
Legal Metrology Digital Verification & Ed25519 Signing Service.
"""

from __future__ import annotations
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db, get_sync_db
from .signing import init_keys, get_key_metadata
from .schemas import KeyMetadataResponse
from .seed import seed_database
from .routes import (
    instruments,
    certificates,
    revocations,
    applications,
    inspections,
    mandis,
    demo,
    decay,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle startup: initialize database, keys, and seed data if empty."""
    init_db()
    init_keys()

    # Check if database has instruments, if not seed it automatically
    with get_sync_db() as conn:
        cursor = conn.execute("SELECT COUNT(*) FROM instruments")
        count = cursor.fetchone()[0]
        if count == 0:
            print("[WeighGuard] Empty database detected. Running seed...")
            seed_database()

    yield


app = FastAPI(
    title="WeighGuard Legal Metrology Signing & Verification Service",
    description="Central authority API for SIH 2026 PS 26036 digital certification and offline trust infrastructure.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for local Astro dev server and production origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "service": "WeighGuard Legal Metrology API",
        "version": "1.0.0",
        "documentation": "/docs",
        "authority": "Ministry of Consumer Affairs, Food & Public Distribution | Legal Metrology Division"
    }


@app.get("/api/health")
def health_check():
    return {
        "status": "UP",
        "subsystems": {
            "database": "sqlite_ready",
            "crypto_signing": "ed25519_ready",
            "cbor_codec": "rfc8949_canonical"
        }
    }


@app.get("/api/public-key", response_model=KeyMetadataResponse)
def get_public_key():
    """Returns statutory verification public key metadata for offline verification bundles."""
    return KeyMetadataResponse(**get_key_metadata())


# Register route modules
app.include_router(instruments.router)
app.include_router(certificates.router)
app.include_router(revocations.router)
app.include_router(applications.router)
app.include_router(inspections.router)
app.include_router(mandis.router)
app.include_router(demo.router)
app.include_router(decay.router)
