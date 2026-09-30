"""
Automated Cross-Language Mathematical Equivalence Test for WeighGuard Trust Decay.
Verifies that the Python Decay Engine (backend/app/decay.py) and TypeScript Decay Engine
(src/lib/decay.ts) produce mathematically identical results within +/- 0.001 tolerance across
all 16 seed instruments plus boundary and edge cases.
"""

from __future__ import annotations
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.decay import (
    compute_confidence as py_compute_confidence,
    calculate_transaction_variance as py_calculate_transaction_variance,
    parse_iso_datetime,
)

SEED_INSTRUMENTS_PATH = ROOT_DIR / "src" / "data" / "seed-instruments.json"


def generate_test_cases() -> List[Dict[str, Any]]:
    """Build list of test vectors: 16 seed instruments + 8 synthetic boundary cases."""
    # Fixed evaluation timestamp for deterministic comparison
    fixed_as_of = "2026-09-27T10:00:00Z"

    with open(SEED_INSTRUMENTS_PATH, "r", encoding="utf-8") as f:
        seed_instruments = json.load(f)

    cases = []
    for inst in seed_instruments:
        cases.append({
            "test_id": f"SEED:{inst['instrument_id']}",
            "instrument_id": inst["instrument_id"],
            "instrument_type": inst["instrument_type"],
            "last_verification_date": inst["last_verification_date"],
            "confidence_basis": inst["confidence_basis"],
            "usage_counter": inst.get("usage_counter"),
            "usage_baseline": inst.get("usage_baseline"),
            "as_of_date": fixed_as_of,
        })

    # Synthetic Boundary & Edge Cases
    boundary_cases = [
        {
            "test_id": "SYNTH:SCALE_DAY_0",
            "instrument_type": "scale",
            "last_verification_date": fixed_as_of,
            "confidence_basis": "time_only",
            "usage_counter": 0,
            "usage_baseline": 0,
            "as_of_date": fixed_as_of,
        },
        {
            "test_id": "SYNTH:SCALE_HALF_LIFE_400D",
            "instrument_type": "scale",
            "last_verification_date": "2025-08-23T10:00:00Z",  # exactly 400 days prior
            "confidence_basis": "time_only",
            "usage_counter": 0,
            "usage_baseline": 0,
            "as_of_date": fixed_as_of,
        },
        {
            "test_id": "SYNTH:SCALE_EXTREME_1000D",
            "instrument_type": "scale",
            "last_verification_date": "2024-01-01T10:00:00Z",
            "confidence_basis": "time_only",
            "usage_counter": 0,
            "usage_baseline": 0,
            "as_of_date": fixed_as_of,
        },
        {
            "test_id": "SYNTH:FD_HALF_LIFE_ZERO_USAGE",
            "instrument_type": "fuel_dispenser",
            "last_verification_date": "2026-01-30T10:00:00Z",  # 240 days prior
            "confidence_basis": "time_and_usage",
            "usage_counter": 0,
            "usage_baseline": 15000,
            "as_of_date": fixed_as_of,
        },
        {
            "test_id": "SYNTH:FD_HIGH_USAGE_2X",
            "instrument_type": "fuel_dispenser",
            "last_verification_date": "2026-01-30T10:00:00Z",  # 240 days prior + 2.0x baseline
            "confidence_basis": "time_and_usage",
            "usage_counter": 30000,
            "usage_baseline": 15000,
            "as_of_date": fixed_as_of,
        },
        {
            "test_id": "SYNTH:WEIGHBRIDGE_THRESHOLD_GREEN_AMBER",
            "instrument_type": "weighbridge",
            "last_verification_date": "2026-04-15T10:00:00Z",
            "confidence_basis": "time_and_usage",
            "usage_counter": 5000,
            "usage_baseline": 15000,
            "as_of_date": fixed_as_of,
        },
        {
            "test_id": "SYNTH:TAXIMETER_THRESHOLD_AMBER_RED",
            "instrument_type": "taximeter",
            "last_verification_date": "2025-10-15T10:00:00Z",
            "confidence_basis": "time_only",
            "usage_counter": 0,
            "usage_baseline": 0,
            "as_of_date": fixed_as_of,
        },
        {
            "test_id": "SYNTH:UNKNOWN_DEVICE_DEFAULT",
            "instrument_type": "custom_moisture_meter",
            "last_verification_date": "2026-03-01T10:00:00Z",
            "confidence_basis": "time_only",
            "usage_counter": 0,
            "usage_baseline": 0,
            "as_of_date": fixed_as_of,
        },
    ]

    cases.extend(boundary_cases)
    return cases


def run_typescript_engine(cases: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Execute TypeScript decay engine on test cases via Node.js."""
    script_path = ROOT_DIR / "scripts" / "compute_ts_decay.ts"
    cmd = ["node", "--experimental-strip-types", str(script_path)]

    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT_DIR),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8"
    )

    stdout, stderr = proc.communicate(input=json.dumps(cases))
    if proc.returncode != 0:
        print(f"TypeScript execution failed (code {proc.returncode}):\n{stderr}", file=sys.stderr)
        sys.exit(1)

    return json.loads(stdout)


def run_equivalence_test():
    """Run cross-language mathematical equivalence test suite."""
    cases = generate_test_cases()
    print(f"================================================================================")
    print(f" WeighGuard Mathematical Equivalence Test: Python vs TypeScript Decay Engines")
    print(f" Evaluating {len(cases)} test cases (16 seed instruments + 8 boundary cases)")
    print(f" Tolerance: |Delta Score| < 0.001 margin")
    print(f"================================================================================")

    # 1. Run Python calculations
    py_results = []
    for c in cases:
        as_of = parse_iso_datetime(c["as_of_date"])
        res = py_compute_confidence(
            last_verification_date=c["last_verification_date"],
            instrument_type=c.get("instrument_type", "default"),
            confidence_basis=c.get("confidence_basis"),
            usage_counter=c.get("usage_counter"),
            usage_baseline=c.get("usage_baseline"),
            as_of_date=as_of
        )
        variance1000 = py_calculate_transaction_variance(1000.0, res["economic_impact"]["max_drift_pct"])
        py_results.append({
            "test_id": c["test_id"],
            "score": res["score"],
            "raw_score": res["raw_score"],
            "band": res["band"],
            "basis": res["basis"],
            "days_since_verification": res["days_since_verification"],
            "max_drift_pct": res["economic_impact"]["max_drift_pct"],
            "rupee_risk_per_1000": res["economic_impact"]["rupee_risk_per_1000"],
            "clarification_text": res["clarification_text"],
            "variance_at_1000": variance1000
        })

    # 2. Run TypeScript calculations
    ts_results = run_typescript_engine(cases)

    # 3. Compare Results
    failures = []
    print(f"{'Test ID':<35} | {'Py Score':>8} | {'TS Score':>8} | {'Delta':>8} | {'Band':>6} | Status")
    print("-" * 80)

    for i in range(len(cases)):
        py = py_results[i]
        ts = ts_results[i]
        test_id = cases[i]["test_id"]

        delta_score = abs(py["score"] - ts["score"])
        delta_raw = abs(py["raw_score"] - ts["raw_score"])
        band_match = (py["band"] == ts["band"])
        drift_match = (py["max_drift_pct"] == ts["max_drift_pct"])
        rupee_match = (py["rupee_risk_per_1000"] == ts["rupee_risk_per_1000"])
        clarif_match = (py["clarification_text"] == ts["clarification_text"])

        passed = (
            delta_score <= 0.001 and
            delta_raw <= 0.001 and
            band_match and
            drift_match and
            rupee_match and
            clarif_match
        )

        status_str = "PASS [OK]" if passed else "FAIL [MISMATCH]"
        print(f"{test_id:<35} | {py['score']:>8.2f} | {ts['score']:>8.2f} | {delta_score:>8.4f} | {py['band']:>6} | {status_str}")

        if not passed:
            failures.append({
                "test_id": test_id,
                "py": py,
                "ts": ts,
                "delta_score": delta_score,
                "delta_raw": delta_raw,
                "band_match": band_match,
                "drift_match": drift_match,
                "rupee_match": rupee_match
            })

    print("=" * 80)
    if failures:
        print(f"FAILED: {len(failures)} out of {len(cases)} test cases showed discrepancies!", file=sys.stderr)
        for f in failures:
            print(f"\nDiscrepancy in {f['test_id']}:", file=sys.stderr)
            print(f"  Python:     score={f['py']['score']}, band={f['py']['band']}, drift={f['py']['max_drift_pct']}%", file=sys.stderr)
            print(f"  TypeScript: score={f['ts']['score']}, band={f['ts']['band']}, drift={f['ts']['max_drift_pct']}%", file=sys.stderr)
        sys.exit(1)
    else:
        print(f"SUCCESS: All {len(cases)} test cases matched with mathematical equivalence (|delta| <= 0.001)!")
        print(f"Dual-mode trust decay, MPE economic translation, and statutory clarification text verified across Python & TypeScript.")


if __name__ == "__main__":
    run_equivalence_test()
