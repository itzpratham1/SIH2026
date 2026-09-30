"""
WeighGuard build-time static data exporter (Phase 6 entry point).

Queries the backend (SQLite seed DB + Ed25519 signing service) and bundles
`public-key.json` and `revocation-list.json` — plus all seed datasets — into
both `src/data/` (bundled at Astro build time) and `public/data/` (served
statically and cached by the service worker for offline airplane mode).

Usage:
    python scripts/export_static_data.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.export_static import export_all


if __name__ == "__main__":
    export_all()
