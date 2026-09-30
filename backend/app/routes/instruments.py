"""
WeighGuard Instruments API Route.
Provides listing, filtering, and detail endpoints enriched with live Trust Decay confidence computations.
"""

from __future__ import annotations
from typing import List, Optional
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query

from ..database import get_db
from ..decay import compute_confidence
from ..schemas import InstrumentRecord, ConfidenceResult, ConfidenceBand

router = APIRouter(prefix="/api/instruments", tags=["instruments"])


def _enrich_instrument_row(row: aiosqlite.Row) -> InstrumentRecord:
    """Map DB row to InstrumentRecord enriched with real-time confidence computation."""
    conf_dict = compute_confidence(
        last_verification_date=row["last_verification_date"],
        instrument_type=row["instrument_type"],
        confidence_basis=row["confidence_basis"],
        usage_counter=row["usage_counter"],
        usage_baseline=row["usage_baseline"]
    )
    conf_model = ConfidenceResult(**conf_dict)

    return InstrumentRecord(
        instrument_id=row["instrument_id"],
        instrument_type=row["instrument_type"],
        device_model=row["device_model"],
        owner_name=row["owner_name"],
        location=row["location"],
        mandi_cluster=row["mandi_cluster"],
        physical_seal_number=row["physical_seal_number"],
        last_verification_date=row["last_verification_date"],
        valid_until=row["valid_until"],
        confidence_basis=row["confidence_basis"],
        usage_counter=row["usage_counter"],
        usage_baseline=row["usage_baseline"],
        status=row["status"],
        cert_id=row["cert_id"],
        confidence=conf_model
    )


@router.get("", response_model=List[InstrumentRecord])
async def list_instruments(
    mandi_cluster: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    instrument_type: Optional[str] = Query(None),
    owner_name: Optional[str] = Query(None),
    band: Optional[ConfidenceBand] = Query(None),
    sort_by: Optional[str] = Query("id_asc", pattern="^(id_asc|id_desc|confidence_asc|confidence_desc)$"),
    db: aiosqlite.Connection = Depends(get_db)
):
    """
    List instruments with optional filtering and live Trust Decay calculation.
    Supports sorting by confidence_asc (critical for Legal Metrology Officer priority triage).
    """
    query = "SELECT * FROM instruments WHERE 1=1"
    params = []

    if mandi_cluster:
        query += " AND mandi_cluster LIKE ?"
        params.append(f"%{mandi_cluster}%")
    if status:
        query += " AND status = ?"
        params.append(status)
    if instrument_type:
        query += " AND instrument_type = ?"
        params.append(instrument_type)
    if owner_name:
        query += " AND owner_name LIKE ?"
        params.append(f"%{owner_name}%")

    query += " ORDER BY instrument_id ASC"

    async with db.execute(query, params) as cursor:
        rows = await cursor.fetchall()
        enriched = [_enrich_instrument_row(row) for row in rows]

        # In-memory filter for computed band if requested
        if band:
            enriched = [inst for inst in enriched if inst.confidence and inst.confidence.band == band]

        # Sorting logic
        if sort_by == "confidence_asc":
            enriched.sort(key=lambda x: x.confidence.score if x.confidence else 999.0)
        elif sort_by == "confidence_desc":
            enriched.sort(key=lambda x: x.confidence.score if x.confidence else -1.0, reverse=True)
        elif sort_by == "id_desc":
            enriched.sort(key=lambda x: x.instrument_id, reverse=True)

        return enriched


@router.get("/{instrument_id}", response_model=InstrumentRecord)
async def get_instrument(
    instrument_id: str,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Retrieve details of a single instrument enriched with live confidence and MPE translation."""
    async with db.execute("SELECT * FROM instruments WHERE instrument_id = ?", (instrument_id,)) as cursor:
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Instrument {instrument_id} not found")
        return _enrich_instrument_row(row)
