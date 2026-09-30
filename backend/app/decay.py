"""
WeighGuard Trust Decay & MPE Economic Translation Engine.
Implements dual-mode decay (Time-only and Time+Usage) and Maximum Permissible Error (MPE)
economic translation in strict alignment with PROJECT_CONTEXT.md and Legal Metrology Act, 2009.
"""

from __future__ import annotations
import math
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

# Statutory & Heuristic Decay Constants (PROJECT_CONTEXT.md §Idea 2)
# H = Half-life in days
# mu = Usage-weight coefficient (per normalized usage unit u = usage / baseline)
DECAY_CONSTANTS: Dict[str, Dict[str, Any]] = {
    "fuel_dispenser": {
        "half_life_days": 240.0,
        "mu": 0.15,
        "default_basis": "time_and_usage",
        "description": "Fuel Dispenser (High-wear mechanical meter with volumetric throughput)"
    },
    "scale": {
        "half_life_days": 400.0,
        "mu": 0.0,
        "default_basis": "time_only",
        "description": "Electronic Shop Scale (Static load-cell, standard commercial counter)"
    },
    "weighbridge": {
        "half_life_days": 300.0,
        "mu": 0.10,
        "default_basis": "time_and_usage",
        "description": "Heavy Weighbridge (High-tonnage platform subject to heavy shock loading)"
    },
    "taximeter": {
        "half_life_days": 350.0,
        "mu": 0.0,
        "default_basis": "time_only",
        "description": "Commercial Taximeter / Fare Meter (Pulse transducer and timer)"
    },
    "default": {
        "half_life_days": 365.0,
        "mu": 0.10,
        "default_basis": "time_only",
        "description": "Standard Legal Metrology Verified Instrument"
    }
}

# Statutory Thresholds
THRESHOLD_GREEN = 70.0
THRESHOLD_AMBER = 40.0

# Mandatory Clarification Text (PROJECT_CONTEXT.md)
MANDATORY_CLARIFICATION_TEXT = (
    "Green — recently verified. Amber — attention due: this instrument's certificate remains "
    "legally valid; it is simply due for re-checking sooner based on elapsed time and use. "
    "Red — overdue for re-verification; prioritised for inspector review."
)


def get_decay_parameters(instrument_type: str) -> Tuple[float, float, str]:
    """Retrieve half_life_days, mu, and default_basis for an instrument type."""
    cfg = DECAY_CONSTANTS.get(instrument_type, DECAY_CONSTANTS["default"])
    return cfg["half_life_days"], cfg["mu"], cfg["default_basis"]


def compute_lambda(half_life_days: float) -> float:
    """Compute decay constant lambda = ln(2) / H."""
    return math.log(2.0) / half_life_days


def parse_iso_datetime(dt_str: str) -> datetime:
    """Parse ISO 8601 string to UTC datetime."""
    clean_str = dt_str.replace("Z", "+00:00")
    dt = datetime.fromisoformat(clean_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def compute_confidence(
    last_verification_date: str,
    instrument_type: str = "default",
    confidence_basis: Optional[str] = None,
    usage_counter: Optional[float] = None,
    usage_baseline: Optional[float] = None,
    as_of_date: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Compute trust decay confidence score and band for an instrument.
    
    Formula:
      t = days elapsed since last verification
      lambda = ln(2) / H
      Time-only: C(t) = 100 * exp(-lambda * t)
      Time+usage: C(t, u) = 100 * exp(-(lambda * t + mu * u)) where u = usage / baseline
    """
    half_life_days, mu, default_basis = get_decay_parameters(instrument_type)
    effective_basis = confidence_basis or default_basis

    # Determine reference date
    now = as_of_date or datetime.now(timezone.utc)
    verif_dt = parse_iso_datetime(last_verification_date)
    
    # Days elapsed
    delta_seconds = (now - verif_dt).total_seconds()
    days_elapsed = max(0.0, delta_seconds / 86400.0)

    lam = compute_lambda(half_life_days)
    time_decay = lam * days_elapsed

    usage_decay = 0.0
    usage_ratio = 0.0

    if effective_basis == "time_and_usage" and usage_baseline and usage_baseline > 0 and usage_counter is not None:
        usage_ratio = max(0.0, float(usage_counter) / float(usage_baseline))
        usage_decay = mu * usage_ratio

    total_decay_exponent = time_decay + usage_decay
    raw_score = 100.0 * math.exp(-total_decay_exponent)
    clamped_score = max(0.0, min(100.0, raw_score))
    rounded_score = round(clamped_score, 2)

    # Determine confidence band
    if rounded_score >= THRESHOLD_GREEN:
        band = "green"
    elif rounded_score >= THRESHOLD_AMBER:
        band = "amber"
    else:
        band = "red"

    # Human-readable basis description
    if effective_basis == "time_and_usage" and usage_baseline and usage_counter is not None:
        basis_description = (
            f"Time & usage basis: {int(usage_counter):,} operations recorded against "
            f"{int(usage_baseline):,} baseline across {days_elapsed:.1f} days (H={int(half_life_days)}d, μ={mu})."
        )
    else:
        basis_description = (
            f"Time-only basis: {days_elapsed:.1f} days elapsed since last statutory stamping "
            f"(H={int(half_life_days)}d, λ={lam:.5f})."
        )

    # Economic translation
    economic_impact = compute_economic_impact(rounded_score, band, instrument_type)

    return {
        "score": rounded_score,
        "raw_score": raw_score,
        "band": band,
        "basis": effective_basis,
        "days_since_verification": round(days_elapsed, 1),
        "half_life_days": half_life_days,
        "lambda_val": round(lam, 6),
        "mu_val": mu if effective_basis == "time_and_usage" else 0.0,
        "usage_ratio": round(usage_ratio, 3) if effective_basis == "time_and_usage" else None,
        "clarification_text": MANDATORY_CLARIFICATION_TEXT,
        "basis_description": basis_description,
        "economic_impact": economic_impact
    }


def compute_economic_impact(score: float, band: str, instrument_type: str = "scale") -> Dict[str, Any]:
    """
    Translate confidence score into Maximum Permissible Error (MPE) tolerance status
    and tangible rupee economic impact per ₹1,000 transaction.
    """
    if band == "green":
        mpe_status_text = "Within statutory MPE tolerance (≤ ±0.5%)"
        max_drift_pct = 0.5
        rupee_risk_per_1000 = 0.0
        economic_impact_text = "Negligible variance (~₹0 on ₹1,000 transaction)"
        statutory_rule = "Compliant with Legal Metrology (General) Rules, 2011 (Class III Standard)"
        action_recommendation = "Standard periodic cycle; no immediate inspection required."
        band_clarification = (
            "Green — recently verified: instrument operating within regular verification "
            "cycle and expected legal tolerance."
        )
    elif band == "amber":
        mpe_status_text = "Elevated drift risk (up to ±1.2%)"
        max_drift_pct = 1.2
        rupee_risk_per_1000 = 12.0
        economic_impact_text = "Est. variance on ₹1,000 transaction: ~₹12 (±1.2%)"
        statutory_rule = "Approaching statutory tolerance threshold under Legal Metrology Rules, 2011"
        action_recommendation = "Voluntary re-verification recommended; schedule routine inspection."
        band_clarification = (
            "Amber — attention due: this instrument's certificate remains legally valid; "
            "it is simply due for re-checking sooner based on elapsed time and use."
        )
    else:  # red
        mpe_status_text = "Overdue: potential drift exceeding statutory MPE (±2.5%+)"
        max_drift_pct = 2.5
        rupee_risk_per_1000 = 25.0
        economic_impact_text = "Potential consumer loss up to ~₹25+ per ₹1,000 transaction (±2.5%+)"
        statutory_rule = "Exceeds recommended verification period under Legal Metrology Act, 2009"
        action_recommendation = "High-priority inspector review required; re-stamping due."
        band_clarification = (
            "Red — overdue for re-verification; prioritised for inspector review under "
            "Section 15 of Legal Metrology Act."
        )

    return {
        "mpe_status_text": mpe_status_text,
        "max_drift_pct": max_drift_pct,
        "rupee_risk_per_1000": rupee_risk_per_1000,
        "economic_impact_text": economic_impact_text,
        "statutory_rule": statutory_rule,
        "action_recommendation": action_recommendation,
        "band_clarification": band_clarification
    }


def calculate_transaction_variance(transaction_amount_inr: float, max_drift_pct: float) -> float:
    """Calculate expected maximum rupee variance on any given transaction value."""
    return round(float(transaction_amount_inr) * (float(max_drift_pct) / 100.0), 2)
