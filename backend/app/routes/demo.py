"""
WeighGuard Live Demonstration & Tamper Simulation API Route.
"""

from __future__ import annotations
from typing import Any, Dict
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from ..database import get_db
from ..signing import create_tampered_envelope

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.get("/tamper/{instrument_id}", response_model=Dict[str, Any])
async def get_tampered_demo_payload(
    instrument_id: str,
    db: aiosqlite.Connection = Depends(get_db)
):
    """
    Demonstrates tamper detection.
    Retrieves the authentic signed certificate for an instrument, deliberately mutates
    a single bit in the canonical CBOR payload byte sequence, and returns both
    for side-by-side verification comparison in the Citizen QR scanner.
    """
    async with db.execute(
        """
        SELECT c.* FROM certificates c
        JOIN instruments i ON i.cert_id = c.cert_id
        WHERE i.instrument_id = ?
        ORDER BY c.created_at DESC LIMIT 1
        """,
        (instrument_id,)
    ) as cursor:
        cert = await cursor.fetchone()
        if not cert:
            raise HTTPException(
                status_code=404,
                detail=f"No active certificate found for instrument {instrument_id}"
            )

    genuine_b64 = cert["cbor_base64"]
    tampered_b64 = create_tampered_envelope(genuine_b64)

    return {
        "instrument_id": instrument_id,
        "cert_id": cert["cert_id"],
        "device_model": cert["device_model"],
        "owner_name": cert["owner_name"],
        "genuine_cbor_base64": genuine_b64,
        "tampered_cbor_base64": tampered_b64,
        "tamper_explanation": "A single bit in the canonical CBOR payload was modified while retaining original Ed25519 signature. Scanners will immediately reject this as cryptographically invalid.",
        "expected_verification_result": False
    }
