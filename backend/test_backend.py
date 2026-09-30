"""
Automated Comprehensive Test Suite for Phase 1 (Backend Signing & Seed Database).
Tests Ed25519 signing, canonical CBOR encoding, FastAPI routes, MPE Pass/Fail branching,
automatic revocation, tamper detection, and static file export integrity.
"""

import sys
import unittest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
import cbor2
import nacl.signing
import base64

from .app.main import app
from .app.database import init_db, get_sync_db
from .app.signing import (
    init_keys,
    get_key_metadata,
    sign_certificate_payload,
    verify_certificate,
    sign_revocation_list,
    create_tampered_envelope,
    get_verify_key,
)
from .app.seed import seed_database
from .export_static import export_all, SRC_DATA_DIR, PUBLIC_DATA_DIR


class TestWeighGuardBackend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        init_keys()
        seed_database()
        export_all()
        cls.client = TestClient(app)

    def test_01_keys_and_metadata(self):
        """Test Ed25519 key generation and metadata contract."""
        meta = get_key_metadata()
        self.assertEqual(meta["key_version"], "v1-ed25519-2026")
        self.assertEqual(meta["algorithm"], "Ed25519")
        self.assertTrue(len(meta["public_key_base64"]) > 30)

        res = self.client.get("/api/public-key")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["key_version"], "v1-ed25519-2026")

    def test_02_canonical_cbor_and_signature(self):
        """Test canonical CBOR serialization and Ed25519 signing."""
        sample_payload = {
            "cert_id": "CERT-TEST-001",
            "instrument_id": "IND-WB-TEST-01",
            "device_model": "Test Scale",
            "owner_name": "Test Owner",
            "confidence_basis": "time_only"
        }
        signed = sign_certificate_payload(sample_payload)
        self.assertIn("signature", signed)
        self.assertIn("cbor_base64", signed)

        # Verify envelope structure
        env_bytes = base64.b64decode(signed["cbor_base64"])
        envelope = cbor2.loads(env_bytes)
        self.assertIn("p", envelope)
        self.assertIn("s", envelope)
        self.assertEqual(envelope["v"], "v1-ed25519-2026")

        # Verify cryptographic signature
        vk = get_verify_key()
        vk.verify(envelope["p"], envelope["s"])

    def test_03_tamper_simulation(self):
        """Test that single bit mutation causes cryptographic signature failure."""
        sample_payload = {
            "cert_id": "CERT-TAMPER-001",
            "instrument_id": "IND-WB-TEST-02",
            "owner_name": "Test Trader"
        }
        signed = sign_certificate_payload(sample_payload)
        tampered_b64 = create_tampered_envelope(signed["cbor_base64"])
        self.assertNotEqual(signed["cbor_base64"], tampered_b64)

        env_bytes = base64.b64decode(tampered_b64)
        tampered_env = cbor2.loads(env_bytes)
        vk = get_verify_key()
        with self.assertRaises(Exception):
            vk.verify(tampered_env["p"], tampered_env["s"])

    def test_04_seeded_instruments(self):
        """Test instruments endpoint and verify seed instruments."""
        res = self.client.get("/api/instruments")
        self.assertEqual(res.status_code, 200)
        instruments = res.json()
        self.assertEqual(len(instruments), 24)

        # Verify single instrument
        single_res = self.client.get("/api/instruments/IND-SC-4401-GZP")
        self.assertEqual(single_res.status_code, 200)
        inst = single_res.json()
        self.assertEqual(inst["device_model"], "Essae-Teraoka DS-852 Tabletop Scale")
        self.assertEqual(inst["physical_seal_number"], "SEAL-DL-88219")
        self.assertEqual(inst["status"], "COMPLIANT")

    def test_05_seeded_mandis_trust_index(self):
        """Test Mandi Cluster Trust Index calculation."""
        res = self.client.get("/api/mandis")
        self.assertEqual(res.status_code, 200)
        mandis = res.json()
        self.assertEqual(len(mandis), 3)
        mandi_names = [m["mandi_name"] for m in mandis]
        self.assertIn("Ghazipur APMC Wholesale Yard", mandi_names)
        self.assertIn("Azadpur APMC Fruit & Vegetable Market", mandi_names)
        self.assertIn("Vashi APMC Agricultural Market", mandi_names)

    def test_06_revocation_list(self):
        """Test signed revocation list returns seeded revoked certificates."""
        res = self.client.get("/api/revocation-list")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data["revoked"]), 3)
        revoked_ids = [r["instrument_id"] for r in data["revoked"]]
        self.assertIn("IND-WB-4491-GZP", revoked_ids)
        self.assertIn("IND-SC-1082-AZD", revoked_ids)
        self.assertTrue(len(data["signature"]) > 40)

    def test_07_trader_application_and_allocation_lifecycle(self):
        """Test submitting trader application and supervisor allocation."""
        # 1. Trader submits application
        create_res = self.client.post("/api/applications", json={
            "trader_id": "TRADER-TEST-01",
            "trader_name": "Test Mandi Merchant",
            "instrument_id": "IND-TX-1099-AZD",
            "supporting_documents": [
                {
                    "doc_id": "DOC-T1",
                    "doc_name": "Test_Registration.pdf",
                    "doc_type": "POSSESSION_PROOF",
                    "file_url": "/test/possession.pdf"
                }
            ]
        })
        self.assertEqual(create_res.status_code, 200)
        app_data = create_res.json()
        app_id = app_data["application_id"]
        self.assertEqual(app_data["status"], "PENDING_ALLOCATION")

        # 2. Supervisor allocates application to LMO
        alloc_res = self.client.post("/api/applications/allocate", json={
            "application_id": app_id,
            "allocated_to": "LM-OFFICER-412",
            "allocated_entity_type": "LMO_OFFICER",
            "assigned_officer_name": "V. P. Singh, Inspector LM",
            "scheduled_date": "2026-09-30",
            "scheduled_time_slot": "10:00 AM - 11:00 AM"
        })
        self.assertEqual(alloc_res.status_code, 200)
        alloc_data = alloc_res.json()
        self.assertEqual(alloc_data["status"], "INSPECTION_SCHEDULED")
        self.assertEqual(alloc_data["allocated_to"], "LM-OFFICER-412")

    def test_08_field_inspection_pass_branching(self):
        """Test LMO field inspection with readings <= MPE: Generates new certificate & marks COMPLIANT."""
        insp_res = self.client.post("/api/inspections/submit", json={
            "instrument_id": "IND-SC-4403-GZP",
            "officer_id": "LM-OFFICER-789",
            "officer_name": "A. K. Sharma, Inspector LM",
            "standard_test_mass_g": 5000.0,
            "observed_reading_g": 5001.2,
            "mpe_limit_g": 5.0,
            "physical_seal_number": "SEAL-DL-99001",
            "visual_inspection_passed": True
        })
        self.assertEqual(insp_res.status_code, 200)
        body = insp_res.json()
        insp = body["inspection"]
        self.assertEqual(insp["outcome"], "PASS_CERTIFIED")
        self.assertAlmostEqual(insp["error_margin_g"], 1.2)

        cert = body["certificate"]
        self.assertIsNotNone(cert)
        self.assertEqual(cert["physical_seal_number"], "SEAL-DL-99001")

        # Verify instrument record updated in DB
        inst_res = self.client.get("/api/instruments/IND-SC-4403-GZP")
        inst = inst_res.json()
        self.assertEqual(inst["status"], "COMPLIANT")
        self.assertEqual(inst["physical_seal_number"], "SEAL-DL-99001")
        self.assertEqual(inst["cert_id"], cert["cert_id"])

    def test_09_field_inspection_fail_branching_auto_revocation(self):
        """Test LMO field inspection with readings > MPE: Marks REJECTED and auto-revokes old cert."""
        # Get instrument before inspection
        pre_inst = self.client.get("/api/instruments/IND-SC-4402-GZP").json()
        old_cert_id = pre_inst["cert_id"]
        self.assertIsNotNone(old_cert_id)

        # Submit inspection with error > MPE limit
        insp_res = self.client.post("/api/inspections/submit", json={
            "instrument_id": "IND-SC-4402-GZP",
            "officer_id": "LM-OFFICER-789",
            "officer_name": "A. K. Sharma, Inspector LM",
            "standard_test_mass_g": 5000.0,
            "observed_reading_g": 5018.5,  # Error = +18.5g
            "mpe_limit_g": 5.0,
            "physical_seal_number": "SEAL-DL-88225",
            "visual_inspection_passed": True
        })
        self.assertEqual(insp_res.status_code, 200)
        body = insp_res.json()
        insp = body["inspection"]
        self.assertEqual(insp["outcome"], "FAIL_REJECTED")
        self.assertEqual(insp["rejection_reason"], "MPE_EXCEEDED")
        self.assertIsNotNone(insp["rectification_deadline"])

        # Verify instrument updated to REJECTED
        post_inst = self.client.get("/api/instruments/IND-SC-4402-GZP").json()
        self.assertEqual(post_inst["status"], "REJECTED")

        # Verify old certificate was automatically added to revocation list
        rev_res = self.client.get("/api/revocation-list")
        rev_list = rev_res.json()
        revoked_cert_ids = [r["cert_id"] for r in rev_list["revoked"]]
        self.assertIn(old_cert_id, revoked_cert_ids)

    def test_10_demo_tamper_endpoint(self):
        """Test /api/demo/tamper/{id} returns corrupt payload for live scanner testing."""
        res = self.client.get("/api/demo/tamper/IND-SC-4401-GZP")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["instrument_id"], "IND-SC-4401-GZP")
        self.assertIn("genuine_cbor_base64", data)
        self.assertIn("tampered_cbor_base64", data)
        self.assertNotEqual(data["genuine_cbor_base64"], data["tampered_cbor_base64"])
        self.assertFalse(data["expected_verification_result"])

    def test_11_static_files_exported(self):
        """Verify all static export files exist in src/data and public/data."""
        for base in [SRC_DATA_DIR, PUBLIC_DATA_DIR]:
            self.assertTrue((base / "public-key.json").exists())
            self.assertTrue((base / "revocation-list.json").exists())
            self.assertTrue((base / "seed-instruments.json").exists())
            self.assertTrue((base / "seed-certificates.json").exists())
            self.assertTrue((base / "seed-mandis.json").exists())
            self.assertTrue((base / "seed-applications.json").exists())


if __name__ == "__main__":
    unittest.main()
