"""
WeighGuard Decay API Routes.
Exposes trust decay computation, constants, and instrument decay inspection.
"""

from __future__ import annotations
from typing import Any, Dict, Optional
from datetime import datetime
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..database import get_db
from ..decay import (
    DECAY_CONSTANTS,
    THRESHOLD_GREEN,
    THRESHOLD_AMBER,
    MANDATORY_CLARIFICATION_TEXT,
    compute_confidence,
    parse_iso_datetime,
)
from ..schemas import (
    ConfidenceResult,
    ConfidenceBasis,
    InstrumentType,
)

router = APIRouter(prefix="/api/decay", tags=["decay"])


class DecayComputeRequest(BaseModel):
    last_verification_date: str
    instrument_type: Optional[InstrumentType] = "scale"
    confidence_basis: Optional[ConfidenceBasis] = None
    usage_counter: Optional[float] = None
    usage_baseline: Optional[float] = None
    as_of_date: Optional[str] = None


@router.get("/constants")
async def get_constants():
    """Retrieve statutory decay parameters and half-lives."""
    return {
        "constants": DECAY_CONSTANTS,
        "thresholds": {
            "green": THRESHOLD_GREEN,
            "amber": THRESHOLD_AMBER
        },
        "clarification_text": MANDATORY_CLARIFICATION_TEXT
    }


@router.post("/compute", response_model=ConfidenceResult)
async def compute_decay_score(payload: DecayComputeRequest):
    """Compute confidence score and economic impact for arbitrary instrument parameters."""
    as_of = None
    if payload.as_of_date:
        as_of = parse_iso_datetime(payload.as_of_date)

    result = compute_confidence(
        last_verification_date=payload.last_verification_date,
        instrument_type=payload.instrument_type or "scale",
        confidence_basis=payload.confidence_basis,
        usage_counter=payload.usage_counter,
        usage_baseline=payload.usage_baseline,
        as_of_date=as_of
    )
    return result


@router.get("/instrument/{instrument_id}", response_model=ConfidenceResult)
async def get_instrument_decay(
    instrument_id: str,
    as_of_date: Optional[str] = Query(None),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Compute live confidence score and economic impact for a specific registered instrument."""
    async with db.execute("SELECT * FROM instruments WHERE instrument_id = ?", (instrument_id,)) as cursor:
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Instrument {instrument_id} not found")

        as_of = None
        if as_of_date:
            as_of = parse_iso_datetime(as_of_date)

        result = compute_confidence(
            last_verification_date=row["last_verification_date"],
            instrument_type=row["instrument_type"],
            confidence_basis=row["confidence_basis"],
            usage_counter=row["usage_counter"],
            usage_baseline=row["usage_baseline"],
            as_of_date=as_of
        )
        return result
