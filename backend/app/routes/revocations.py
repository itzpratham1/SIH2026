"""
WeighGuard Revocation List API Route.
Returns central Ed25519-signed list of revoked certificates for offline check.
"""

from __future__ import annotations
from datetime import datetime, timezone
import aiosqlite
from fastapi import APIRouter, Depends

from ..database import get_db
from ..schemas import RevocationEntry, RevocationListResponse
from ..signing import sign_revocation_list, KEY_VERSION

router = APIRouter(prefix="/api/revocation-list", tags=["revocations"])


@router.get("", response_model=RevocationListResponse)
async def get_revocation_list(
    db: aiosqlite.Connection = Depends(get_db)
):
    """
    Returns signed revocation list containing all revoked certificate records.
    Signed centrally with Ed25519 for tamper-proof distribution to offline clients.
    """
    async with db.execute("SELECT * FROM revocations ORDER BY revoked_at DESC") as cursor:
        rows = await cursor.fetchall()
        revoked_items = [
            {
                "cert_id": row["cert_id"],
                "instrument_id": row["instrument_id"],
                "revoked_at": row["revoked_at"],
                "reason": row["reason"]
            }
            for row in rows
        ]

    updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    signed_list = sign_revocation_list(revoked_items, updated_at)

    return RevocationListResponse(
        key_version=signed_list["key_version"],
        updated_at=signed_list["updated_at"],
        revoked=[RevocationEntry(**item) for item in signed_list["revoked"]],
        signature=signed_list["signature"]
    )
