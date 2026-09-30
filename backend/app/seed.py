"""
WeighGuard Seed Data Generator.
Seeds 16 realistic instruments across 3 APMC mandis, including 2 revoked instruments,
active verification applications, field inspection records, and Ed25519-signed CBOR certificates.
"""

from __future__ import annotations
import json
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Any

from .database import get_sync_db, init_db
from .signing import init_keys, sign_certificate_payload, sign_revocation_list

SEED_MANDIS = [
    {
        "mandi_id": "MANDI-DEL-01",
        "mandi_name": "Ghazipur APMC Wholesale Yard",
        "location": "Ghazipur, East Delhi / NCR",
        "total_stalls": 120
    },
    {
        "mandi_id": "MANDI-DEL-02",
        "mandi_name": "Azadpur APMC Fruit & Vegetable Market",
        "location": "Azadpur, North Delhi",
        "total_stalls": 240
    },
    {
        "mandi_id": "MANDI-MUM-01",
        "mandi_name": "Vashi APMC Agricultural Market",
        "location": "Sector 19, Vashi, Navi Mumbai",
        "total_stalls": 180
    }
]

NOW = datetime.now(timezone.utc)

def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

SEED_INSTRUMENTS_RAW = [
    # --- Ghazipur APMC (East Delhi / NCR - Moderate Risk 66.7%) ---
    {
        "instrument_id": "IND-SC-4401-GZP",
        "instrument_type": "scale",
        "device_model": "Essae-Teraoka DS-852 Tabletop Scale",
        "owner_name": "Kishan Lal & Sons Grains",
        "location": "Shed #4, Ghazipur APMC, Delhi",
        "mandi_cluster": "Ghazipur APMC Wholesale Yard",
        "physical_seal_number": "SEAL-DL-88219",
        "days_ago": 45,  # Fresh / Compliant (Green)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-789",
        "officer_name": "A. K. Sharma, Inspector LM"
    },
    {
        "instrument_id": "IND-FD-4410-GZP",
        "instrument_type": "fuel_dispenser",
        "device_model": "Midco SureFill Fuel Dispenser Nozzle #1",
        "owner_name": "Bharat Petroleum Mandi Fuel Station",
        "location": "Fuel Pump Compound, Ghazipur APMC, Delhi",
        "mandi_cluster": "Ghazipur APMC Wholesale Yard",
        "physical_seal_number": "SEAL-DL-88240",
        "days_ago": 80,  # Time & usage (Green)
        "confidence_basis": "time_and_usage",
        "usage_counter": 3200,
        "usage_baseline": 15000,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-789",
        "officer_name": "A. K. Sharma, Inspector LM"
    },
    {
        "instrument_id": "IND-SC-4404-GZP",
        "instrument_type": "scale",
        "device_model": "Avery Weigh-Tronix Bench Scale",
        "owner_name": "Delhi Pulses & Spices Corp",
        "location": "Platform 2, Ghazipur APMC, Delhi",
        "mandi_cluster": "Ghazipur APMC Wholesale Yard",
        "physical_seal_number": "SEAL-DL-88228",
        "days_ago": 55,  # Compliant (Green)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-789",
        "officer_name": "A. K. Sharma, Inspector LM"
    },
    {
        "instrument_id": "IND-SC-4402-GZP",
        "instrument_type": "scale",
        "device_model": "Avery Weigh-Tronix E1010 Counter Scale",
        "owner_name": "Choudhary Onion Traders",
        "location": "Stall #89, Ghazipur APMC, Delhi",
        "mandi_cluster": "Ghazipur APMC Wholesale Yard",
        "physical_seal_number": "SEAL-DL-88225",
        "days_ago": 40,  # Freshly verified (Green)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-789",
        "officer_name": "A. K. Sharma, Inspector LM"
    },
    {
        "instrument_id": "IND-SC-4403-GZP",
        "instrument_type": "scale",
        "device_model": "Essae-Teraoka DS-215 Platform Scale",
        "owner_name": "East Delhi Potato Merchants",
        "location": "Shed #2, Stall #14, Ghazipur APMC, Delhi",
        "mandi_cluster": "Ghazipur APMC Wholesale Yard",
        "physical_seal_number": "SEAL-DL-88231",
        "days_ago": 560,  # Overdue (Red: score ~37.9 < 40)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "OVERDUE",
        "officer_id": "LM-OFFICER-789",
        "officer_name": "A. K. Sharma, Inspector LM"
    },
    {
        "instrument_id": "IND-SC-4405-GZP",
        "instrument_type": "scale",
        "device_model": "Essae-Teraoka DS-852 Bench Scale",
        "owner_name": "Yamuna Fresh Grains Co",
        "location": "Platform 5, Ghazipur APMC, Delhi",
        "mandi_cluster": "Ghazipur APMC Wholesale Yard",
        "physical_seal_number": "SEAL-DL-88248",
        "days_ago": 30,  # Compliant (Green)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-789",
        "officer_name": "A. K. Sharma, Inspector LM"
    },
    {
        "instrument_id": "IND-FD-4411-GZP",
        "instrument_type": "fuel_dispenser",
        "device_model": "Midco SureFill Fuel Dispenser Nozzle #2",
        "owner_name": "Bharat Petroleum Mandi Fuel Station",
        "location": "Fuel Pump Compound, Ghazipur APMC, Delhi",
        "mandi_cluster": "Ghazipur APMC Wholesale Yard",
        "physical_seal_number": "SEAL-DL-88241",
        "days_ago": 210,  # High usage dispenser (Amber)
        "confidence_basis": "time_and_usage",
        "usage_counter": 18500,
        "usage_baseline": 15000,
        "status": "DUE_SOON",
        "officer_id": "LM-OFFICER-789",
        "officer_name": "A. K. Sharma, Inspector LM"
    },
    {
        "instrument_id": "IND-WB-4491-GZP",
        "instrument_type": "weighbridge",
        "device_model": "Fairbanks Titan Pitless Weighbridge 60T",
        "owner_name": "Ghazipur Mandi Freight Association",
        "location": "Gate #2 Weigh Bridge, Ghazipur APMC, Delhi",
        "mandi_cluster": "Ghazipur APMC Wholesale Yard",
        "physical_seal_number": "SEAL-UP-88220",
        "days_ago": 180,  # Revoked during mid-cycle inspection
        "confidence_basis": "time_and_usage",
        "usage_counter": 8450,
        "usage_baseline": 10000,
        "status": "REVOKED",
        "officer_id": "LM-OFFICER-789",
        "officer_name": "A. K. Sharma, Inspector LM",
        "revocation_reason": "MPE tolerance exceeded (+18.5g on 5kg standard); failed verification inspection"
    },

    # --- Azadpur APMC (North Delhi - High Compliance / Low Risk 85.7%) ---
    {
        "instrument_id": "IND-SC-1081-AZD",
        "instrument_type": "scale",
        "device_model": "Avery Berkel FX120 Retail Scale",
        "owner_name": "Aggarwal Fresh Apple Wholesale",
        "location": "Block C-4, Azadpur APMC, Delhi",
        "mandi_cluster": "Azadpur APMC Fruit & Vegetable Market",
        "physical_seal_number": "SEAL-DL-41902",
        "days_ago": 20,  # Very fresh (Green)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-412",
        "officer_name": "V. P. Singh, Inspector LM"
    },
    {
        "instrument_id": "IND-WB-1090-AZD",
        "instrument_type": "weighbridge",
        "device_model": "Avery Weigh-Tronix Pitless Bridge 50T",
        "owner_name": "Azadpur Traders Weighing Syndicate",
        "location": "North Ingate Weighbridge, Azadpur APMC, Delhi",
        "mandi_cluster": "Azadpur APMC Fruit & Vegetable Market",
        "physical_seal_number": "SEAL-DL-41910",
        "days_ago": 60,  # Compliant (Green)
        "confidence_basis": "time_and_usage",
        "usage_counter": 2100,
        "usage_baseline": 12000,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-412",
        "officer_name": "V. P. Singh, Inspector LM"
    },
    {
        "instrument_id": "IND-SC-1085-AZD",
        "instrument_type": "scale",
        "device_model": "Essae-Teraoka DS-852 Tabletop Scale",
        "owner_name": "Delhi Mango Commission Agents",
        "location": "Shed 9, Azadpur APMC, Delhi",
        "mandi_cluster": "Azadpur APMC Fruit & Vegetable Market",
        "physical_seal_number": "SEAL-DL-41922",
        "days_ago": 35,  # Compliant (Green)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-412",
        "officer_name": "V. P. Singh, Inspector LM"
    },
    {
        "instrument_id": "IND-SC-1086-AZD",
        "instrument_type": "scale",
        "device_model": "Eagle Electronic Bench Scale 100kg",
        "owner_name": "Kashmir Valley Fruits",
        "location": "Block D-12, Azadpur APMC, Delhi",
        "mandi_cluster": "Azadpur APMC Fruit & Vegetable Market",
        "physical_seal_number": "SEAL-DL-41925",
        "days_ago": 45,  # Compliant (Green)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-412",
        "officer_name": "V. P. Singh, Inspector LM"
    },
    {
        "instrument_id": "IND-WB-1091-AZD",
        "instrument_type": "weighbridge",
        "device_model": "Fairbanks Titan Heavy Bridge 60T",
        "owner_name": "Kalyan Logistic Hub",
        "location": "South Outgate, Azadpur APMC, Delhi",
        "mandi_cluster": "Azadpur APMC Fruit & Vegetable Market",
        "physical_seal_number": "SEAL-DL-41932",
        "days_ago": 70,  # Compliant (Green)
        "confidence_basis": "time_and_usage",
        "usage_counter": 2800,
        "usage_baseline": 15000,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-412",
        "officer_name": "V. P. Singh, Inspector LM"
    },
    {
        "instrument_id": "IND-TX-1099-AZD",
        "instrument_type": "taximeter",
        "device_model": "Pulsar Auto Rickshaw Electronic Fare Meter",
        "owner_name": "Ramesh Kumar Auto Logistics",
        "location": "Azadpur Mandi Stand, Delhi",
        "mandi_cluster": "Azadpur APMC Fruit & Vegetable Market",
        "physical_seal_number": "SEAL-DL-41930",
        "days_ago": 90,  # Green
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-412",
        "officer_name": "V. P. Singh, Inspector LM"
    },
    {
        "instrument_id": "IND-SC-1087-AZD",
        "instrument_type": "scale",
        "device_model": "Essae-Teraoka DS-215 Platform Scale",
        "owner_name": "Shree Ganesh Potato Traders",
        "location": "Block A-2, Azadpur APMC, Delhi",
        "mandi_cluster": "Azadpur APMC Fruit & Vegetable Market",
        "physical_seal_number": "SEAL-DL-41938",
        "days_ago": 25,  # Fresh / Compliant (Green)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-412",
        "officer_name": "V. P. Singh, Inspector LM"
    },
    {
        "instrument_id": "IND-SC-1088-AZD",
        "instrument_type": "scale",
        "device_model": "Avery Weigh-Tronix Bench Scale 50kg",
        "owner_name": "Punjab Fresh Onion Suppliers",
        "location": "Block C-8, Azadpur APMC, Delhi",
        "mandi_cluster": "Azadpur APMC Fruit & Vegetable Market",
        "physical_seal_number": "SEAL-DL-41940",
        "days_ago": 15,  # Very fresh / Compliant (Green)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-412",
        "officer_name": "V. P. Singh, Inspector LM"
    },
    {
        "instrument_id": "IND-SC-1083-AZD",
        "instrument_type": "scale",
        "device_model": "Essae-Teraoka DS-415 Hanging Crane Scale",
        "owner_name": "Gupta Banana Ripening Chamber",
        "location": "Godown 12, Azadpur APMC, Delhi",
        "mandi_cluster": "Azadpur APMC Fruit & Vegetable Market",
        "physical_seal_number": "SEAL-DL-41914",
        "days_ago": 335,  # Amber / Due soon
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "DUE_SOON",
        "officer_id": "LM-OFFICER-412",
        "officer_name": "V. P. Singh, Inspector LM"
    },
    {
        "instrument_id": "IND-SC-1082-AZD",
        "instrument_type": "scale",
        "device_model": "Essae-Teraoka DS-852 Tabletop Scale",
        "owner_name": "Rajeshwar Mango Depot",
        "location": "Platform 7, Azadpur APMC, Delhi",
        "mandi_cluster": "Azadpur APMC Fruit & Vegetable Market",
        "physical_seal_number": "SEAL-DL-41905",
        "days_ago": 150,  # Revoked for seal tampering
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "REVOKED",
        "officer_id": "LM-OFFICER-412",
        "officer_name": "V. P. Singh, Inspector LM",
        "revocation_reason": "Physical seal wire broken; unauthorized recalibration detected during market squad audit"
    },

    # --- Vashi APMC (Navi Mumbai - High Risk / Squad Deployment 33.3%) ---
    {
        "instrument_id": "IND-SC-7701-VSH",
        "instrument_type": "scale",
        "device_model": "Avery Weigh-Tronix ZM301 Heavy Scale",
        "owner_name": "Maharashtra Spice Emporium",
        "location": "Grain Market Block D, Vashi APMC, Navi Mumbai",
        "mandi_cluster": "Vashi APMC Agricultural Market",
        "physical_seal_number": "SEAL-MH-77101",
        "days_ago": 30,  # Green
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-930",
        "officer_name": "S. M. Patil, Inspector LM"
    },
    {
        "instrument_id": "IND-WB-7710-VSH",
        "instrument_type": "weighbridge",
        "device_model": "Fairbanks Titan Heavy Weighbridge 80T",
        "owner_name": "Konkan Agricultural Logistics Ltd",
        "location": "Truck Terminal Gate 4, Vashi APMC, Navi Mumbai",
        "mandi_cluster": "Vashi APMC Agricultural Market",
        "physical_seal_number": "SEAL-MH-77105",
        "days_ago": 110,  # Green
        "confidence_basis": "time_and_usage",
        "usage_counter": 4300,
        "usage_baseline": 15000,
        "status": "COMPLIANT",
        "officer_id": "LM-OFFICER-930",
        "officer_name": "S. M. Patil, Inspector LM"
    },
    {
        "instrument_id": "IND-FD-7720-VSH",
        "instrument_type": "fuel_dispenser",
        "device_model": "Gilbarco Veeder-Root Horizon Multi-Hose",
        "owner_name": "Indian Oil Mandi Commercial Fuel Station",
        "location": "Plot 14, APMC Market Yard, Vashi, Navi Mumbai",
        "mandi_cluster": "Vashi APMC Agricultural Market",
        "physical_seal_number": "SEAL-MH-77112",
        "days_ago": 230,  # Amber
        "confidence_basis": "time_and_usage",
        "usage_counter": 16200,
        "usage_baseline": 15000,
        "status": "DUE_SOON",
        "officer_id": "LM-OFFICER-930",
        "officer_name": "S. M. Patil, Inspector LM"
    },
    {
        "instrument_id": "IND-TX-7730-VSH",
        "instrument_type": "taximeter",
        "device_model": "Sansui Digital Commercial Meter SM-12",
        "owner_name": "Mahesh Agro Goods Transport",
        "location": "Tempo Stand, Vashi APMC, Navi Mumbai",
        "mandi_cluster": "Vashi APMC Agricultural Market",
        "physical_seal_number": "SEAL-MH-77120",
        "days_ago": 380,  # Overdue (Red)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "OVERDUE",
        "officer_id": "LM-OFFICER-930",
        "officer_name": "S. M. Patil, Inspector LM"
    },
    {
        "instrument_id": "IND-SC-7702-VSH",
        "instrument_type": "scale",
        "device_model": "Eagle Electronic Bench Scale",
        "owner_name": "Navi Mumbai Onion & Potato Merchants",
        "location": "Market Shed 7, Vashi APMC, Navi Mumbai",
        "mandi_cluster": "Vashi APMC Agricultural Market",
        "physical_seal_number": "SEAL-MH-77128",
        "days_ago": 410,  # Overdue (Red)
        "confidence_basis": "time_only",
        "usage_counter": 0,
        "usage_baseline": 0,
        "status": "OVERDUE",
        "officer_id": "LM-OFFICER-930",
        "officer_name": "S. M. Patil, Inspector LM"
    },
    {
        "instrument_id": "IND-WB-7790-VSH",
        "instrument_type": "weighbridge",
        "device_model": "Avery Weigh-Tronix Pitless Bridge 60T",
        "owner_name": "Thane Heavy Freight Syndicate",
        "location": "Gate 1 Outward Weighbridge, Vashi APMC, Navi Mumbai",
        "mandi_cluster": "Vashi APMC Agricultural Market",
        "physical_seal_number": "SEAL-MH-77140",
        "days_ago": 160,  # Revoked
        "confidence_basis": "time_and_usage",
        "usage_counter": 9200,
        "usage_baseline": 10000,
        "status": "REVOKED",
        "officer_id": "LM-OFFICER-930",
        "officer_name": "S. M. Patil, Inspector LM",
        "revocation_reason": "Load cell calibration compromised (+32kg drift on 20T calibration test)"
    }
]


def seed_database():
    """Populate SQLite database with complete seed data."""
    init_db()
    init_keys()
    conn = get_sync_db()

    # Clear existing records
    conn.execute("DELETE FROM inspections")
    conn.execute("DELETE FROM applications")
    conn.execute("DELETE FROM revocations")
    conn.execute("DELETE FROM certificates")
    conn.execute("DELETE FROM instruments")
    conn.execute("DELETE FROM mandi_clusters")

    # 1. Insert Mandis
    for mandi in SEED_MANDIS:
        conn.execute(
            """
            INSERT INTO mandi_clusters (mandi_id, mandi_name, location, total_stalls)
            VALUES (?, ?, ?, ?)
            """,
            (mandi["mandi_id"], mandi["mandi_name"], mandi["location"], mandi["total_stalls"])
        )

    # 2. Insert Instruments and generate signed Certificates
    revoked_entries: List[Dict[str, Any]] = []

    for idx, inst in enumerate(SEED_INSTRUMENTS_RAW):
        last_ver_dt = NOW - timedelta(days=inst["days_ago"])
        valid_until_dt = last_ver_dt + timedelta(days=365)
        cert_id = f"CERT-2026-{inst['instrument_id'].split('-')[2]}-{idx+1001:04d}"

        # Sign certificate with Ed25519 and create CBOR envelope
        cert_payload = {
            "cert_id": cert_id,
            "instrument_id": inst["instrument_id"],
            "instrument_type": inst["instrument_type"],
            "physical_seal_number": inst["physical_seal_number"],
            "device_model": inst["device_model"],
            "mandi_cluster": inst["mandi_cluster"],
            "owner_name": inst["owner_name"],
            "location": inst["location"],
            "officer_id": inst["officer_id"],
            "officer_name": inst["officer_name"],
            "last_verification_date": iso(last_ver_dt),
            "valid_until": iso(valid_until_dt),
            "confidence_basis": inst["confidence_basis"],
            "usage_counter": inst["usage_counter"],
            "usage_baseline": inst["usage_baseline"]
        }
        signed_cert = sign_certificate_payload(cert_payload)

        # Store certificate
        conn.execute(
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
                iso(last_ver_dt)
            )
        )

        # Store instrument
        conn.execute(
            """
            INSERT INTO instruments (
                instrument_id, instrument_type, device_model, owner_name, location,
                mandi_cluster, physical_seal_number, last_verification_date, valid_until,
                confidence_basis, usage_counter, usage_baseline, status, cert_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                inst["instrument_id"],
                inst["instrument_type"],
                inst["device_model"],
                inst["owner_name"],
                inst["location"],
                inst["mandi_cluster"],
                inst["physical_seal_number"],
                iso(last_ver_dt),
                iso(valid_until_dt),
                inst["confidence_basis"],
                inst["usage_counter"],
                inst["usage_baseline"],
                inst["status"],
                cert_id
            )
        )

        # If instrument is REVOKED, record in revocation table
        if inst["status"] == "REVOKED":
            revocation_dt = NOW - timedelta(days=15)
            reason = inst.get("revocation_reason", "Statutory verification revoked by Legal Metrology Officer")
            conn.execute(
                """
                INSERT INTO revocations (cert_id, instrument_id, revoked_at, reason)
                VALUES (?, ?, ?, ?)
                """,
                (cert_id, inst["instrument_id"], iso(revocation_dt), reason)
            )
            revoked_entries.append({
                "cert_id": cert_id,
                "instrument_id": inst["instrument_id"],
                "revoked_at": iso(revocation_dt),
                "reason": reason
            })

    # 3. Seed Trader Applications
    seed_applications = [
        {
            "application_id": "APP-2026-901",
            "trader_id": "TRADER-GZP-101",
            "trader_name": "Choudhary Onion Traders",
            "instrument_id": "IND-SC-4402-GZP",
            "applied_at": iso(NOW - timedelta(days=2)),
            "status": "PENDING_ALLOCATION",
            "supporting_documents": json.dumps([
                {
                    "doc_id": "DOC-901-1",
                    "doc_name": "Previous_Schedule_XI_Certificate.pdf",
                    "doc_type": "PREVIOUS_CERTIFICATE",
                    "file_url": "/sample-docs/cert-prev.pdf"
                },
                {
                    "doc_id": "DOC-901-2",
                    "doc_name": "Annual_Maintenance_Repairer_Memo.pdf",
                    "doc_type": "REPAIRER_MEMO",
                    "file_url": "/sample-docs/repair-memo.pdf"
                }
            ])
        },
        {
            "application_id": "APP-2026-902",
            "trader_id": "TRADER-AZD-204",
            "trader_name": "Gupta Banana Ripening Chamber",
            "instrument_id": "IND-SC-1083-AZD",
            "applied_at": iso(NOW - timedelta(days=3)),
            "status": "PENDING_ALLOCATION",
            "supporting_documents": json.dumps([
                {
                    "doc_id": "DOC-902-1",
                    "doc_name": "APMC_Mandi_Trade_Possession_License.pdf",
                    "doc_type": "POSSESSION_PROOF",
                    "file_url": "/sample-docs/possession.pdf"
                }
            ])
        },
        {
            "application_id": "APP-2026-880",
            "trader_id": "TRADER-GZP-102",
            "trader_name": "East Delhi Potato Merchants",
            "instrument_id": "IND-SC-4403-GZP",
            "applied_at": iso(NOW - timedelta(days=5)),
            "status": "INSPECTION_SCHEDULED",
            "allocated_to": "LM-OFFICER-789",
            "allocated_entity_type": "LMO_OFFICER",
            "assigned_officer_name": "A. K. Sharma (Squad #2)",
            "scheduled_date": "2026-09-28",
            "scheduled_time_slot": "10:30 AM - 11:30 AM",
            "supporting_documents": json.dumps([
                {
                    "doc_id": "DOC-880-1",
                    "doc_name": "Schedule_XI_Renewal_Submission.pdf",
                    "doc_type": "PREVIOUS_CERTIFICATE",
                    "file_url": "/sample-docs/cert-prev.pdf"
                }
            ])
        },
        {
            "application_id": "APP-2026-881",
            "trader_id": "TRADER-AZD-205",
            "trader_name": "Sharma & Co Garlic Suppliers",
            "instrument_id": "IND-SC-1084-AZD",
            "applied_at": iso(NOW - timedelta(days=6)),
            "status": "INSPECTION_SCHEDULED",
            "allocated_to": "GATC-DEL-04",
            "allocated_entity_type": "GATC",
            "assigned_officer_name": "Govt Approved Test Centre Delhi #4",
            "scheduled_date": "2026-09-28",
            "scheduled_time_slot": "02:00 PM - 03:00 PM",
            "supporting_documents": json.dumps([])
        },
        {
            "application_id": "APP-2026-850",
            "trader_id": "TRADER-DEL-010",
            "trader_name": "Aggarwal Fresh Apple Wholesale",
            "instrument_id": "IND-SC-1081-AZD",
            "applied_at": iso(NOW - timedelta(days=22)),
            "status": "CERTIFIED",
            "allocated_to": "LM-OFFICER-412",
            "allocated_entity_type": "LMO_OFFICER",
            "assigned_officer_name": "V. P. Singh, Inspector LM",
            "scheduled_date": "2026-09-08",
            "scheduled_time_slot": "11:00 AM - 12:00 PM",
            "supporting_documents": json.dumps([])
        }
    ]

    for app in seed_applications:
        conn.execute(
            """
            INSERT INTO applications (
                application_id, trader_id, trader_name, instrument_id, applied_at,
                status, allocated_to, allocated_entity_type, assigned_officer_name,
                scheduled_date, scheduled_time_slot, supporting_documents
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                app["application_id"],
                app["trader_id"],
                app["trader_name"],
                app["instrument_id"],
                app["applied_at"],
                app["status"],
                app.get("allocated_to"),
                app.get("allocated_entity_type"),
                app.get("assigned_officer_name"),
                app.get("scheduled_date"),
                app.get("scheduled_time_slot"),
                app["supporting_documents"]
            )
        )

    # 4. Seed Past Inspection Records
    seed_inspections = [
        {
            "inspection_id": "INSP-2026-001",
            "application_id": "APP-2026-850",
            "instrument_id": "IND-SC-1081-AZD",
            "officer_id": "LM-OFFICER-412",
            "inspection_date": iso(NOW - timedelta(days=20)),
            "standard_test_mass_g": 5000.0,
            "observed_reading_g": 5000.5,
            "error_margin_g": 0.5,
            "mpe_limit_g": 5.0,
            "physical_seal_number": "SEAL-DL-41902",
            "visual_inspection_passed": 1,
            "photo_evidence_url": "/sample-photos/inspection-scale-pass.jpg",
            "outcome": "PASS_CERTIFIED",
            "rejection_reason": None,
            "rectification_deadline": None
        },
        {
            "inspection_id": "INSP-2026-002",
            "application_id": None,
            "instrument_id": "IND-SC-1082-AZD",
            "officer_id": "LM-OFFICER-412",
            "inspection_date": iso(NOW - timedelta(days=15)),
            "standard_test_mass_g": 5000.0,
            "observed_reading_g": 4982.0,
            "error_margin_g": -18.0,
            "mpe_limit_g": 5.0,
            "physical_seal_number": "SEAL-DL-41905",
            "visual_inspection_passed": 0,
            "photo_evidence_url": "/sample-photos/inspection-seal-tampered.jpg",
            "outcome": "FAIL_REJECTED",
            "rejection_reason": "SEAL_TAMPERED",
            "rectification_deadline": iso(NOW + timedelta(days=14))
        }
    ]

    for insp in seed_inspections:
        conn.execute(
            """
            INSERT INTO inspections (
                inspection_id, application_id, instrument_id, officer_id, inspection_date,
                standard_test_mass_g, observed_reading_g, error_margin_g, mpe_limit_g,
                physical_seal_number, visual_inspection_passed, photo_evidence_url,
                outcome, rejection_reason, rectification_deadline
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                insp["inspection_id"],
                insp["application_id"],
                insp["instrument_id"],
                insp["officer_id"],
                insp["inspection_date"],
                insp["standard_test_mass_g"],
                insp["observed_reading_g"],
                insp["error_margin_g"],
                insp["mpe_limit_g"],
                insp["physical_seal_number"],
                insp["visual_inspection_passed"],
                insp["photo_evidence_url"],
                insp["outcome"],
                insp["rejection_reason"],
                insp["rectification_deadline"]
            )
        )

    conn.commit()
    conn.close()
    print(f"Database seeded successfully with 16 instruments, 3 mandis, 5 applications, 2 inspections.")


if __name__ == "__main__":
    seed_database()
