"""
WeighGuard Field Inspection & Stamping Route.
Executes metrological tolerance (MPE) validation with Pass/Fail branching,
cryptographic certificate generation, and automated revocation listing on failure.
"""

from __future__ import annotations
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query

from ..database import get_db
from ..schemas import (
    FieldInspectionRecord,
    FieldInspectionSubmitRequest,
)
from ..signing import sign_certificate_payload

router = APIRouter(prefix="/api/inspections", tags=["inspections"])


@router.post("/submit", response_model=Dict[str, Any])
async def submit_field_inspection(
    req: FieldInspectionSubmitRequest,
    db: aiosqlite.Connection = Depends(get_db)
):
    """
    Submit field inspection from LMO mobile device.
    Evaluates observed reading against standard test mass and statutory MPE tolerance:
    - PASS: Issues new Ed25519-signed CBOR certificate and marks instrument COMPLIANT.
    - FAIL: Marks instrument REJECTED, sets 14-day statutory rectification notice,
            and automatically revokes existing certificate in the revocation list.
    """
    # 1. Fetch instrument record
    async with db.execute("SELECT * FROM instruments WHERE instrument_id = ?", (req.instrument_id,)) as cursor:
        inst = await cursor.fetchone()
        if not inst:
            raise HTTPException(status_code=404, detail=f"Instrument {req.instrument_id} not found")

    now_utc = datetime.now(timezone.utc)
    inspection_date = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    insp_id = f"INSP-2026-{uuid.uuid4().hex[:6].upper()}"

    error_margin_g = round(req.observed_reading_g - req.standard_test_mass_g, 3)
    is_mpe_pass = abs(error_margin_g) <= req.mpe_limit_g
    is_pass = is_mpe_pass and req.visual_inspection_passed

    new_certificate_record = None

    if is_pass:
        outcome = "PASS_CERTIFIED"
        rejection_reason = None
        rectification_deadline = None

        # Generate new certificate
        part = req.instrument_id.split("-")[2] if len(req.instrument_id.split("-")) > 2 else "GEN"
        new_cert_id = f"CERT-2026-{part}-{uuid.uuid4().hex[:4].upper()}"
        valid_until = (now_utc + timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%SZ")

        cert_payload = {
            "cert_id": new_cert_id,
            "instrument_id": req.instrument_id,
            "instrument_type": inst["instrument_type"],
            "physical_seal_number": req.physical_seal_number,
            "device_model": inst["device_model"],
            "mandi_cluster": inst["mandi_cluster"],
            "owner_name": inst["owner_name"],
            "location": inst["location"],
            "officer_id": req.officer_id,
            "officer_name": req.officer_name,
            "last_verification_date": inspection_date,
            "valid_until": valid_until,
            "confidence_basis": inst["confidence_basis"],
            "usage_counter": 0.0,
            "usage_baseline": inst["usage_baseline"]
        }

        signed_cert = sign_certificate_payload(cert_payload)

        # Insert new certificate
        await db.execute(
            """
            INSERT INTO certificates (
                cert_id, instrument_id, instrument_type, physical_seal_number,
                device_model, mandi_cluster, owner_name, location, officer_id, officer_name,
                last_verification_date, valid_until, confidence_basis, usage_counter, usage_baseline,
                key_version, signature, cbor_base64, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                signed_cert["cert_id"],
                signed_cert["instrument_id"],
                signed_cert["instrument_type"],
                signed_cert["physical_seal_number"],
                signed_cert["device_model"],
                signed_cert["mandi_cluster"],
                signed_cert["owner_name"],
                signed_cert["location"],
                signed_cert["officer_id"],
                signed_cert["officer_name"],
                signed_cert["last_verification_date"],
                signed_cert["valid_until"],
                signed_cert["confidence_basis"],
                signed_cert["usage_counter"],
                signed_cert["usage_baseline"],
                signed_cert["key_version"],
                signed_cert["signature"],
                signed_cert["cbor_base64"],
                inspection_date
            )
        )

        # Update instrument status to COMPLIANT with new cert_id and seal
        await db.execute(
            """
            UPDATE instruments
            SET status = 'COMPLIANT',
                last_verification_date = ?,
                valid_until = ?,
                physical_seal_number = ?,
                cert_id = ?,
                usage_counter = 0.0
            WHERE instrument_id = ?
            """,
            (inspection_date, valid_until, req.physical_seal_number, new_cert_id, req.instrument_id)
        )

        if req.application_id:
            await db.execute(
                "UPDATE applications SET status = 'CERTIFIED' WHERE application_id = ?",
                (req.application_id,)
            )

        new_certificate_record = signed_cert

    else:
        outcome = "FAIL_REJECTED"
        if req.rejection_reason_override:
            rejection_reason = req.rejection_reason_override
        elif not is_mpe_pass:
            rejection_reason = "MPE_EXCEEDED"
        else:
            rejection_reason = "SEAL_TAMPERED"

        rectification_deadline = (now_utc + timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Update instrument status to REJECTED
        await db.execute(
            "UPDATE instruments SET status = 'REJECTED' WHERE instrument_id = ?",
            (req.instrument_id,)
        )

        # Automatically revoke old active certificate if exists
        old_cert_id = inst["cert_id"]
        if old_cert_id:
            async with db.execute("SELECT 1 FROM revocations WHERE cert_id = ?", (old_cert_id,)) as c:
                already_revoked = await c.fetchone()
            if not already_revoked:
                reason_detail = f"Field inspection rejected: {rejection_reason} (Observed error: {error_margin_g:+.2f}g, MPE limit: ±{req.mpe_limit_g}g)"
                await db.execute(
                    """
                    INSERT INTO revocations (cert_id, instrument_id, revoked_at, reason)
                    VALUES (?, ?, ?, ?)
                    """,
                    (old_cert_id, req.instrument_id, inspection_date, reason_detail)
                )

        if req.application_id:
            await db.execute(
                "UPDATE applications SET status = 'REJECTED' WHERE application_id = ?",
                (req.application_id,)
            )

    # Store inspection record
    await db.execute(
        """
        INSERT INTO inspections (
            inspection_id, application_id, instrument_id, officer_id, inspection_date,
            standard_test_mass_g, observed_reading_g, error_margin_g, mpe_limit_g,
            physical_seal_number, visual_inspection_passed, photo_evidence_url,
            outcome, rejection_reason, rectification_deadline
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            insp_id,
            req.application_id,
            req.instrument_id,
            req.officer_id,
            inspection_date,
            req.standard_test_mass_g,
            req.observed_reading_g,
            error_margin_g,
            req.mpe_limit_g,
            req.physical_seal_number,
            1 if req.visual_inspection_passed else 0,
            req.photo_evidence_url,
            outcome,
            rejection_reason,
            rectification_deadline
        )
    )

    await db.commit()

    inspection_record = {
        "inspection_id": insp_id,
        "application_id": req.application_id,
        "instrument_id": req.instrument_id,
        "officer_id": req.officer_id,
        "inspection_date": inspection_date,
        "standard_test_mass_g": req.standard_test_mass_g,
        "observed_reading_g": req.observed_reading_g,
        "error_margin_g": error_margin_g,
        "mpe_limit_g": req.mpe_limit_g,
        "physical_seal_number": req.physical_seal_number,
        "visual_inspection_passed": req.visual_inspection_passed,
        "photo_evidence_url": req.photo_evidence_url,
        "outcome": outcome,
        "rejection_reason": rejection_reason,
        "rectification_deadline": rectification_deadline
    }

    return {
        "inspection": inspection_record,
        "certificate": new_certificate_record
    }


@router.get("", response_model=List[FieldInspectionRecord])
async def list_inspections(
    instrument_id: Optional[str] = Query(None),
    officer_id: Optional[str] = Query(None),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Retrieve history of field inspections."""
    query = "SELECT * FROM inspections WHERE 1=1"
    params = []

    if instrument_id:
        query += " AND instrument_id = ?"
        params.append(instrument_id)
    if officer_id:
        query += " AND officer_id = ?"
        params.append(officer_id)

    query += " ORDER BY inspection_date DESC"

    async with db.execute(query, params) as cursor:
        rows = await cursor.fetchall()
        return [
            FieldInspectionRecord(
                inspection_id=r["inspection_id"],
                application_id=r["application_id"],
                instrument_id=r["instrument_id"],
                officer_id=r["officer_id"],
                inspection_date=r["inspection_date"],
                standard_test_mass_g=r["standard_test_mass_g"],
                observed_reading_g=r["observed_reading_g"],
                error_margin_g=r["error_margin_g"],
                mpe_limit_g=r["mpe_limit_g"],
                physical_seal_number=r["physical_seal_number"],
                visual_inspection_passed=bool(r["visual_inspection_passed"]),
                photo_evidence_url=r["photo_evidence_url"],
                outcome=r["outcome"],
                rejection_reason=r["rejection_reason"],
                rectification_deadline=r["rectification_deadline"]
            )
            for r in rows
        ]
