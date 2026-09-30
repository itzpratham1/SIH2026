"""
WeighGuard Static Data Exporter.
Exports public key, signed revocation list, and seed datasets directly into src/data/
so the Astro frontend and Service Worker have them bundled for 100% offline airplane-mode operation.
"""

from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app.database import get_sync_db, init_db
from backend.app.signing import init_keys, get_key_metadata, sign_revocation_list
from backend.app.seed import seed_database

SRC_DATA_DIR = Path(__file__).resolve().parent.parent / "src" / "data"
PUBLIC_DATA_DIR = Path(__file__).resolve().parent.parent / "public" / "data"


def _write_json(filename: str, data: any):
    SRC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(SRC_DATA_DIR / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    with open(PUBLIC_DATA_DIR / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def export_all():
    """Export all required static JSON assets into src/data/ and public/data/."""
    init_db()
    init_keys()

    # 1. Export Public Key Metadata
    pub_key_meta = get_key_metadata()
    _write_json("public-key.json", pub_key_meta)
    print(f"[OK] Exported public-key.json to src/data and public/data")

    # Ensure DB is fresh and seeded
    seed_database()
    conn = get_sync_db()

    # 2. Export Revocation List (Ed25519 Signed)
    c_rev = conn.execute("SELECT * FROM revocations ORDER BY revoked_at DESC")
    revoked_rows = c_rev.fetchall()
    revoked_items = [
        {
            "cert_id": r["cert_id"],
            "instrument_id": r["instrument_id"],
            "revoked_at": r["revoked_at"],
            "reason": r["reason"]
        }
        for r in revoked_rows
    ]
    updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    signed_revocation_doc = sign_revocation_list(revoked_items, updated_at)

    _write_json("revocation-list.json", signed_revocation_doc)
    print(f"[OK] Exported revocation-list.json ({len(revoked_items)} revoked records)")

    # 3. Export Instruments (enriched with confidence)
    c_inst = conn.execute("SELECT * FROM instruments ORDER BY instrument_id ASC")
    instruments = []
    from backend.app.decay import compute_confidence
    for r in c_inst.fetchall():
        d = dict(r)
        d["confidence"] = compute_confidence(
            last_verification_date=d["last_verification_date"],
            instrument_type=d["instrument_type"],
            confidence_basis=d["confidence_basis"],
            usage_counter=d["usage_counter"],
            usage_baseline=d["usage_baseline"]
        )
        instruments.append(d)
    _write_json("seed-instruments.json", instruments)
    print(f"[OK] Exported seed-instruments.json ({len(instruments)} instruments with decay metadata)")


    # 4. Export Certificates
    c_cert = conn.execute("SELECT * FROM certificates ORDER BY cert_id ASC")
    certificates = [dict(r) for r in c_cert.fetchall()]
    _write_json("seed-certificates.json", certificates)
    print(f"[OK] Exported seed-certificates.json ({len(certificates)} certificates)")

    # 5. Export Mandis
    c_mandi = conn.execute("SELECT * FROM mandi_clusters ORDER BY mandi_name ASC")
    mandis = [dict(r) for r in c_mandi.fetchall()]
    _write_json("seed-mandis.json", mandis)
    print(f"[OK] Exported seed-mandis.json ({len(mandis)} mandis)")

    # 6. Export Applications
    c_app = conn.execute("SELECT * FROM applications ORDER BY applied_at DESC")
    apps = []
    for r in c_app.fetchall():
        d = dict(r)
        if d.get("supporting_documents"):
            try:
                d["supporting_documents"] = json.loads(d["supporting_documents"])
            except Exception:
                d["supporting_documents"] = []
        apps.append(d)
    _write_json("seed-applications.json", apps)
    print(f"[OK] Exported seed-applications.json ({len(apps)} applications)")

    conn.close()
    print("All static assets successfully exported.")


if __name__ == "__main__":
    export_all()
