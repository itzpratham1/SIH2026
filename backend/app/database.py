"""
WeighGuard Database Layer.
SQLite database with async support (aiosqlite) and sync fallback for seeding/export scripts.
"""

from __future__ import annotations
import os
import sqlite3
from pathlib import Path
from typing import AsyncGenerator
import aiosqlite

DB_PATH = Path(__file__).resolve().parent.parent / "weighguard.db"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS mandi_clusters (
    mandi_id TEXT PRIMARY KEY,
    mandi_name TEXT NOT NULL,
    location TEXT NOT NULL,
    total_stalls INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS instruments (
    instrument_id TEXT PRIMARY KEY,
    instrument_type TEXT NOT NULL,
    device_model TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    location TEXT NOT NULL,
    mandi_cluster TEXT,
    physical_seal_number TEXT NOT NULL,
    last_verification_date TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    confidence_basis TEXT NOT NULL,
    usage_counter REAL DEFAULT 0,
    usage_baseline REAL DEFAULT 0,
    status TEXT NOT NULL,
    cert_id TEXT
);

CREATE TABLE IF NOT EXISTS certificates (
    cert_id TEXT PRIMARY KEY,
    instrument_id TEXT NOT NULL,
    instrument_type TEXT NOT NULL,
    physical_seal_number TEXT NOT NULL,
    device_model TEXT NOT NULL,
    mandi_cluster TEXT,
    owner_name TEXT NOT NULL,
    location TEXT NOT NULL,
    officer_id TEXT NOT NULL,
    officer_name TEXT NOT NULL,
    last_verification_date TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    confidence_basis TEXT NOT NULL,
    usage_counter REAL,
    usage_baseline REAL,
    key_version TEXT NOT NULL,
    signature TEXT NOT NULL,
    cbor_base64 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(instrument_id) REFERENCES instruments(instrument_id)
);

CREATE TABLE IF NOT EXISTS revocations (
    cert_id TEXT PRIMARY KEY,
    instrument_id TEXT NOT NULL,
    revoked_at TEXT NOT NULL,
    reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
    application_id TEXT PRIMARY KEY,
    trader_id TEXT NOT NULL,
    trader_name TEXT NOT NULL,
    instrument_id TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    status TEXT NOT NULL,
    allocated_to TEXT,
    allocated_entity_type TEXT,
    assigned_officer_name TEXT,
    scheduled_date TEXT,
    scheduled_time_slot TEXT,
    supporting_documents TEXT,
    FOREIGN KEY(instrument_id) REFERENCES instruments(instrument_id)
);

CREATE TABLE IF NOT EXISTS inspections (
    inspection_id TEXT PRIMARY KEY,
    application_id TEXT,
    instrument_id TEXT NOT NULL,
    officer_id TEXT NOT NULL,
    inspection_date TEXT NOT NULL,
    standard_test_mass_g REAL NOT NULL,
    observed_reading_g REAL NOT NULL,
    error_margin_g REAL NOT NULL,
    mpe_limit_g REAL NOT NULL,
    physical_seal_number TEXT NOT NULL,
    visual_inspection_passed INTEGER NOT NULL,
    photo_evidence_url TEXT,
    outcome TEXT NOT NULL,
    rejection_reason TEXT,
    rectification_deadline TEXT,
    FOREIGN KEY(instrument_id) REFERENCES instruments(instrument_id)
);

CREATE INDEX IF NOT EXISTS idx_instruments_mandi ON instruments(mandi_cluster);
CREATE INDEX IF NOT EXISTS idx_instruments_status ON instruments(status);
CREATE INDEX IF NOT EXISTS idx_certificates_instrument ON certificates(instrument_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_inspections_instrument ON inspections(instrument_id);
"""


def get_sync_db() -> sqlite3.Connection:
    """Get a synchronous SQLite connection with row factories enabled."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize database tables and indexes synchronously."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_sync_db() as conn:
        conn.executescript(SCHEMA_SQL)
        conn.commit()


async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """FastAPI dependency for async database connections."""
    async with aiosqlite.connect(str(DB_PATH)) as conn:
        conn.row_factory = aiosqlite.Row
        yield conn
