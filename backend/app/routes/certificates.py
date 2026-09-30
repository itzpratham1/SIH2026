"""
WeighGuard Certificates API Route.
Provides certificate retrieval for rendering Schedule XI certificates and QR verification.
"""

from __future__ import annotations
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from ..database import get_db
from ..schemas import EnrichedCertificatePayload

router = APIRouter(prefix="/api/certificates", tags=["certificates"])


@router.get("/{cert_id}", response_model=EnrichedCertificatePayload)
async def get_certificate(
    cert_id: str,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Retrieve full certificate details by certificate ID."""
    async with db.execute("SELECT * FROM certificates WHERE cert_id = ?", (cert_id,)) as cursor:
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Certificate {cert_id} not found")
        return EnrichedCertificatePayload(
            cert_id=row["cert_id"],
            instrument_id=row["instrument_id"],
            instrument_type=row["instrument_type"],
            physical_seal_number=row["physical_seal_number"],
            device_model=row["device_model"],
            mandi_cluster=row["mandi_cluster"],
            owner_name=row["owner_name"],
            location=row["location"],
            officer_id=row["officer_id"],
            officer_name=row["officer_name"],
            last_verification_date=row["last_verification_date"],
            valid_until=row["valid_until"],
            confidence_basis=row["confidence_basis"],
            usage_counter=row["usage_counter"],
            usage_baseline=row["usage_baseline"],
            key_version=row["key_version"],
            signature=row["signature"],
            cbor_base64=row["cbor_base64"]
        )


@router.get("/instrument/{instrument_id}", response_model=EnrichedCertificatePayload)
async def get_instrument_certificate(
    instrument_id: str,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Retrieve active certificate for an instrument."""
    async with db.execute(
        """
        SELECT c.* FROM certificates c
        JOIN instruments i ON i.cert_id = c.cert_id
        WHERE i.instrument_id = ?
        ORDER BY c.created_at DESC LIMIT 1
        """,
        (instrument_id,)
    ) as cursor:
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"No active certificate found for instrument {instrument_id}")
        return EnrichedCertificatePayload(
            cert_id=row["cert_id"],
            instrument_id=row["instrument_id"],
            instrument_type=row["instrument_type"],
            physical_seal_number=row["physical_seal_number"],
            device_model=row["device_model"],
            mandi_cluster=row["mandi_cluster"],
            owner_name=row["owner_name"],
            location=row["location"],
            officer_id=row["officer_id"],
            officer_name=row["officer_name"],
            last_verification_date=row["last_verification_date"],
            valid_until=row["valid_until"],
            confidence_basis=row["confidence_basis"],
            usage_counter=row["usage_counter"],
            usage_baseline=row["usage_baseline"],
            key_version=row["key_version"],
            signature=row["signature"],
            cbor_base64=row["cbor_base64"]
        )
