"""
WeighGuard Applications API Route.
Handles trader re-verification applications and administrative officer/GATC allocation.
"""

from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query

from ..database import get_db
from ..schemas import (
    ApplicationAllocateRequest,
    ApplicationCreateRequest,
    SupportingDocument,
    VerificationApplication,
)

router = APIRouter(prefix="/api/applications", tags=["applications"])


@router.post("", response_model=VerificationApplication)
async def create_application(
    req: ApplicationCreateRequest,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Trader submits application for instrument re-verification."""
    # Verify instrument exists
    async with db.execute("SELECT * FROM instruments WHERE instrument_id = ?", (req.instrument_id,)) as cursor:
        inst = await cursor.fetchone()
        if not inst:
            raise HTTPException(status_code=404, detail=f"Instrument {req.instrument_id} not found")

    app_id = f"APP-2026-{uuid.uuid4().hex[:6].upper()}"
    applied_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    status = "PENDING_ALLOCATION"
    docs_json = json.dumps([doc.model_dump() for doc in (req.supporting_documents or [])])

    await db.execute(
        """
        INSERT INTO applications (
            application_id, trader_id, trader_name, instrument_id, applied_at,
            status, supporting_documents
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (app_id, req.trader_id, req.trader_name, req.instrument_id, applied_at, status, docs_json)
    )
    await db.commit()

    return VerificationApplication(
        application_id=app_id,
        trader_id=req.trader_id,
        trader_name=req.trader_name,
        instrument_id=req.instrument_id,
        applied_at=applied_at,
        status=status,
        supporting_documents=req.supporting_documents
    )


@router.get("", response_model=List[VerificationApplication])
async def list_applications(
    status: Optional[str] = Query(None),
    trader_id: Optional[str] = Query(None),
    allocated_to: Optional[str] = Query(None),
    db: aiosqlite.Connection = Depends(get_db)
):
    """List applications with optional status or user filtering."""
    query = "SELECT * FROM applications WHERE 1=1"
    params = []

    if status:
        query += " AND status = ?"
        params.append(status)
    if trader_id:
        query += " AND trader_id = ?"
        params.append(trader_id)
    if allocated_to:
        query += " AND allocated_to = ?"
        params.append(allocated_to)

    query += " ORDER BY applied_at DESC"

    async with db.execute(query, params) as cursor:
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            docs_raw = r["supporting_documents"]
            docs = [SupportingDocument(**d) for d in json.loads(docs_raw)] if docs_raw else []
            results.append(
                VerificationApplication(
                    application_id=r["application_id"],
                    trader_id=r["trader_id"],
                    trader_name=r["trader_name"],
                    instrument_id=r["instrument_id"],
                    applied_at=r["applied_at"],
                    status=r["status"],
                    allocated_to=r["allocated_to"],
                    allocated_entity_type=r["allocated_entity_type"],
                    assigned_officer_name=r["assigned_officer_name"],
                    scheduled_date=r["scheduled_date"],
                    scheduled_time_slot=r["scheduled_time_slot"],
                    supporting_documents=docs
                )
            )
        return results


@router.post("/allocate", response_model=VerificationApplication)
async def allocate_application(
    req: ApplicationAllocateRequest,
    db: aiosqlite.Connection = Depends(get_db)
):
    """
    Supervisor / Admin allocation desk: Assigns application to LMO or GATC
    with designated scheduled date and time slot.
    """
    async with db.execute("SELECT * FROM applications WHERE application_id = ?", (req.application_id,)) as cursor:
        app = await cursor.fetchone()
        if not app:
            raise HTTPException(status_code=404, detail=f"Application {req.application_id} not found")

    new_status = "INSPECTION_SCHEDULED"

    await db.execute(
        """
        UPDATE applications
        SET status = ?, allocated_to = ?, allocated_entity_type = ?,
            assigned_officer_name = ?, scheduled_date = ?, scheduled_time_slot = ?
        WHERE application_id = ?
        """,
        (
            new_status,
            req.allocated_to,
            req.allocated_entity_type,
            req.assigned_officer_name,
            req.scheduled_date,
            req.scheduled_time_slot,
            req.application_id
        )
    )
    await db.commit()

    docs_raw = app["supporting_documents"]
    docs = [SupportingDocument(**d) for d in json.loads(docs_raw)] if docs_raw else []

    return VerificationApplication(
        application_id=req.application_id,
        trader_id=app["trader_id"],
        trader_name=app["trader_name"],
        instrument_id=app["instrument_id"],
        applied_at=app["applied_at"],
        status=new_status,
        allocated_to=req.allocated_to,
        allocated_entity_type=req.allocated_entity_type,
        assigned_officer_name=req.assigned_officer_name,
        scheduled_date=req.scheduled_date,
        scheduled_time_slot=req.scheduled_time_slot,
        supporting_documents=docs
    )
