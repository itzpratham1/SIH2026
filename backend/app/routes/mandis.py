"""
WeighGuard Mandi Clusters API Route.
Aggregates instrument compliance across APMC wholesale yards to produce Mandi Trust Indexes.
"""

from __future__ import annotations
from typing import List
import aiosqlite
from fastapi import APIRouter, Depends

from ..database import get_db
from ..schemas import MandiClusterSummary

router = APIRouter(prefix="/api/mandis", tags=["mandis"])


@router.get("", response_model=List[MandiClusterSummary])
async def get_mandi_summaries(
    db: aiosqlite.Connection = Depends(get_db)
):
    """
    Computes APMC Mandi Cluster Trust Indexes based on real instrument records.
    Risk Levels:
    - LOW: Trust Index >= 80%
    - MEDIUM: Trust Index between 60% and 79%
    - HIGH: Trust Index < 60%
    """
    async with db.execute("SELECT * FROM mandi_clusters ORDER BY mandi_name ASC") as c_mandi:
        mandis = await c_mandi.fetchall()

    results: List[MandiClusterSummary] = []

    for m in mandis:
        mandi_name = m["mandi_name"]
        async with db.execute(
            """
            SELECT 
                COUNT(*) as total_count,
                SUM(CASE WHEN status = 'COMPLIANT' THEN 1 ELSE 0 END) as compliant_count
            FROM instruments
            WHERE mandi_cluster = ?
            """,
            (mandi_name,)
        ) as c_stat:
            stat = await c_stat.fetchone()
            total = stat["total_count"] if stat else 0
            compliant = stat["compliant_count"] if stat and stat["compliant_count"] else 0

        if total > 0:
            pct = round((compliant / total) * 100.0, 1)
        else:
            pct = 100.0

        if pct >= 80.0:
            risk = "LOW"
        elif pct >= 60.0:
            risk = "MEDIUM"
        else:
            risk = "HIGH"

        results.append(
            MandiClusterSummary(
                mandi_id=m["mandi_id"],
                mandi_name=m["mandi_name"],
                location=m["location"],
                total_instruments=total,
                compliant_count=compliant,
                trust_index_pct=pct,
                risk_level=risk
            )
        )

    return results
