"""
Unit and integration tests for WeighGuard Trust Decay & MPE Economic Translation Engine.
Uses unittest for zero-dependency standard library execution.
"""

import math
import unittest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

from .app.main import app
from .app.decay import (
    compute_confidence,
    compute_economic_impact,
    calculate_transaction_variance,
    get_decay_parameters,
    compute_lambda,
    THRESHOLD_GREEN,
    THRESHOLD_AMBER,
    MANDATORY_CLARIFICATION_TEXT,
    DECAY_CONSTANTS,
)


class TestDecayEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_decay_constants(self):
        """Verify statutory decay parameters conform to PROJECT_CONTEXT.md."""
        h_fd, mu_fd, mode_fd = get_decay_parameters("fuel_dispenser")
        self.assertEqual(h_fd, 240.0)
        self.assertEqual(mu_fd, 0.15)
        self.assertEqual(mode_fd, "time_and_usage")

        h_sc, mu_sc, mode_sc = get_decay_parameters("scale")
        self.assertEqual(h_sc, 400.0)
        self.assertEqual(mu_sc, 0.0)
        self.assertEqual(mode_sc, "time_only")

        h_wb, mu_wb, mode_wb = get_decay_parameters("weighbridge")
        self.assertEqual(h_wb, 300.0)
        self.assertEqual(mu_wb, 0.10)

        h_tx, mu_tx, mode_tx = get_decay_parameters("taximeter")
        self.assertEqual(h_tx, 350.0)
        self.assertEqual(mu_tx, 0.0)
        self.assertEqual(mode_tx, "time_only")

    def test_lambda_calculation(self):
        """Verify decay constant lambda = ln(2) / H."""
        lam_400 = compute_lambda(400.0)
        expected = math.log(2.0) / 400.0
        self.assertAlmostEqual(lam_400, expected, places=9)

    def test_fresh_instrument_confidence(self):
        """Verify t=0 yields 100% confidence and Green band."""
        now = datetime(2026, 9, 27, 12, 0, 0, tzinfo=timezone.utc)
        res = compute_confidence(
            last_verification_date="2026-09-27T12:00:00Z",
            instrument_type="scale",
            as_of_date=now
        )
        self.assertEqual(res["score"], 100.0)
        self.assertEqual(res["band"], "green")
        self.assertEqual(res["days_since_verification"], 0.0)
        self.assertEqual(res["economic_impact"]["max_drift_pct"], 0.5)
        self.assertEqual(res["economic_impact"]["rupee_risk_per_1000"], 0.0)

    def test_half_life_exact_decay(self):
        """Verify score is exactly 50.0 after exactly H days for time-only scale."""
        verif_dt = datetime(2025, 8, 23, 12, 0, 0, tzinfo=timezone.utc)
        now = verif_dt + timedelta(days=400)  # Exactly H=400 days later

        res = compute_confidence(
            last_verification_date=verif_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            instrument_type="scale",
            as_of_date=now
        )
        self.assertAlmostEqual(res["score"], 50.0, places=1)
        self.assertEqual(res["band"], "amber")

    def test_time_and_usage_decay(self):
        """Verify usage accelerates decay in time+usage mode for fuel dispenser."""
        verif_dt = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        now = verif_dt + timedelta(days=120)  # half of H=240

        # Case A: time only (usage=0)
        res_a = compute_confidence(
            last_verification_date=verif_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            instrument_type="fuel_dispenser",
            confidence_basis="time_and_usage",
            usage_counter=0,
            usage_baseline=15000,
            as_of_date=now
        )

        # Case B: high usage (usage = baseline -> u = 1.0)
        res_b = compute_confidence(
            last_verification_date=verif_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            instrument_type="fuel_dispenser",
            confidence_basis="time_and_usage",
            usage_counter=15000,
            usage_baseline=15000,
            as_of_date=now
        )

        # High usage must yield strictly lower confidence score
        self.assertLess(res_b["score"], res_a["score"])
        # Ratio is exp(-0.15) ~= 0.8607
        expected_ratio = math.exp(-0.15)
        actual_ratio = res_b["raw_score"] / res_a["raw_score"]
        self.assertAlmostEqual(actual_ratio, expected_ratio, places=3)

    def test_band_classification_and_economic_impact(self):
        """Verify band thresholds and economic translation."""
        impact_green = compute_economic_impact(85.0, "green", "scale")
        self.assertEqual(impact_green["max_drift_pct"], 0.5)
        self.assertEqual(impact_green["rupee_risk_per_1000"], 0.0)
        self.assertIn("Within statutory MPE tolerance", impact_green["mpe_status_text"])

        impact_amber = compute_economic_impact(55.0, "amber", "scale")
        self.assertEqual(impact_amber["max_drift_pct"], 1.2)
        self.assertEqual(impact_amber["rupee_risk_per_1000"], 12.0)
        self.assertIn("Elevated drift risk", impact_amber["mpe_status_text"])

        impact_red = compute_economic_impact(25.0, "red", "scale")
        self.assertEqual(impact_red["max_drift_pct"], 2.5)
        self.assertEqual(impact_red["rupee_risk_per_1000"], 25.0)
        self.assertIn("Overdue", impact_red["mpe_status_text"])

    def test_transaction_variance(self):
        """Verify rupee variance calculation."""
        # ₹1,000 transaction with 1.2% drift -> ₹12.0
        var_1000 = calculate_transaction_variance(1000.0, 1.2)
        self.assertEqual(var_1000, 12.0)

        # ₹2,500 transaction with 2.5% drift -> ₹62.5
        var_2500 = calculate_transaction_variance(2500.0, 2.5)
        self.assertEqual(var_2500, 62.5)

    def test_mandatory_clarification_text(self):
        """Verify presence of the statutory clarification text."""
        res = compute_confidence("2026-08-01T00:00:00Z", "scale")
        self.assertIn(MANDATORY_CLARIFICATION_TEXT, res["clarification_text"])
        self.assertIn("Amber — attention due: this instrument's certificate remains legally valid", res["clarification_text"])

    def test_api_decay_constants(self):
        """Test GET /api/decay/constants endpoint."""
        resp = self.client.get("/api/decay/constants")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("fuel_dispenser", data["constants"])
        self.assertEqual(data["thresholds"]["green"], 70.0)
        self.assertEqual(data["thresholds"]["amber"], 40.0)

    def test_api_decay_compute(self):
        """Test POST /api/decay/compute endpoint."""
        payload = {
            "last_verification_date": "2026-06-01T00:00:00Z",
            "instrument_type": "scale",
            "confidence_basis": "time_only",
            "as_of_date": "2026-09-27T00:00:00Z"
        }
        resp = self.client.post("/api/decay/compute", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("score", data)
        self.assertIn(data["band"], ["green", "amber", "red"])
        self.assertIn("economic_impact", data)

    def test_api_decay_instrument(self):
        """Test GET /api/decay/instrument/{id} endpoint."""
        resp = self.client.get("/api/decay/instrument/IND-SC-4401-GZP")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertGreater(data["score"], 80.0)
        self.assertEqual(data["band"], "green")

    def test_api_instruments_triage_sort(self):
        """Test GET /api/instruments?sort_by=confidence_asc for LMO triage."""
        resp = self.client.get("/api/instruments?sort_by=confidence_asc")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertGreaterEqual(len(data), 16)
        # Verify scores are monotonically non-decreasing
        scores = [item["confidence"]["score"] for item in data if item.get("confidence")]
        self.assertEqual(scores, sorted(scores))
        # Lowest score should be at the top (Red / highest priority triage)
        self.assertLess(scores[0], 50.0)


if __name__ == "__main__":
    unittest.main()
