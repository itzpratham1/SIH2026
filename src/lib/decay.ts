/**
 * WeighGuard Trust Decay & MPE Economic Translation Engine (Client-Side Mirror).
 * Computes dual-mode trust decay and Maximum Permissible Error (MPE) economic translation
 * with zero network dependency (100% offline airplane mode in browser / PWA).
 *
 * Mathematically equivalent to backend/app/decay.py within +/- 0.001 margin.
 */

import type {
  ConfidenceBand,
  ConfidenceBasis,
  ConfidenceResult,
  EconomicImpact,
  InstrumentType,
} from './types';

export interface DecayParameters {
  halfLifeDays: number;
  mu: number;
  defaultBasis: ConfidenceBasis;
  description: string;
}

export const DECAY_CONSTANTS: Record<string, DecayParameters> = {
  fuel_dispenser: {
    halfLifeDays: 240.0,
    mu: 0.15,
    defaultBasis: 'time_and_usage',
    description: 'Fuel Dispenser (High-wear mechanical meter with volumetric throughput)',
  },
  scale: {
    halfLifeDays: 400.0,
    mu: 0.0,
    defaultBasis: 'time_only',
    description: 'Electronic Shop Scale (Static load-cell, standard commercial counter)',
  },
  weighbridge: {
    halfLifeDays: 300.0,
    mu: 0.10,
    defaultBasis: 'time_and_usage',
    description: 'Heavy Weighbridge (High-tonnage platform subject to heavy shock loading)',
  },
  taximeter: {
    halfLifeDays: 350.0,
    mu: 0.0,
    defaultBasis: 'time_only',
    description: 'Commercial Taximeter / Fare Meter (Pulse transducer and timer)',
  },
  default: {
    halfLifeDays: 365.0,
    mu: 0.10,
    defaultBasis: 'time_only',
    description: 'Standard Legal Metrology Verified Instrument',
  },
};

export const THRESHOLD_GREEN = 70.0;
export const THRESHOLD_AMBER = 40.0;

export const MANDATORY_CLARIFICATION_TEXT =
  "Green — recently verified. Amber — attention due: this instrument's certificate remains " +
  "legally valid; it is simply due for re-checking sooner based on elapsed time and use. " +
  "Red — overdue for re-verification; prioritised for inspector review.";

/**
 * Retrieve statutory decay parameters for an instrument type.
 */
export function getDecayParameters(instrumentType?: string): DecayParameters {
  if (instrumentType && DECAY_CONSTANTS[instrumentType]) {
    return DECAY_CONSTANTS[instrumentType];
  }
  return DECAY_CONSTANTS.default;
}

/**
 * Compute decay constant lambda = ln(2) / H.
 */
export function computeLambda(halfLifeDays: number): number {
  return Math.LN2 / halfLifeDays;
}

/**
 * Parse ISO 8601 string to Date (safely handles UTC suffix).
 */
export function parseIsoDate(dtStr: string): Date {
  return new Date(dtStr);
}

/**
 * Compute Maximum Permissible Error (MPE) tolerance status and economic impact.
 */
export function computeEconomicImpact(
  score: number,
  band: ConfidenceBand,
  _instrumentType?: InstrumentType | string
): EconomicImpact {
  if (band === 'green') {
    return {
      mpe_status_text: 'Within statutory MPE tolerance (≤ ±0.5%)',
      max_drift_pct: 0.5,
      rupee_risk_per_1000: 0.0,
      economic_impact_text: 'Negligible variance (~₹0 on ₹1,000 transaction)',
      statutory_rule: 'Compliant with Legal Metrology (General) Rules, 2011 (Class III Standard)',
      action_recommendation: 'Standard periodic cycle; no immediate inspection required.',
      band_clarification:
        'Green — recently verified: instrument operating within regular verification cycle and expected legal tolerance.',
    };
  }

  if (band === 'amber') {
    return {
      mpe_status_text: 'Elevated drift risk (up to ±1.2%)',
      max_drift_pct: 1.2,
      rupee_risk_per_1000: 12.0,
      economic_impact_text: 'Est. variance on ₹1,000 transaction: ~₹12 (±1.2%)',
      statutory_rule: 'Approaching statutory tolerance threshold under Legal Metrology Rules, 2011',
      action_recommendation: 'Voluntary re-verification recommended; schedule routine inspection.',
      band_clarification:
        "Amber — attention due: this instrument's certificate remains legally valid; it is simply due for re-checking sooner based on elapsed time and use.",
    };
  }

  return {
    mpe_status_text: 'Overdue: potential drift exceeding statutory MPE (±2.5%+)',
    max_drift_pct: 2.5,
    rupee_risk_per_1000: 25.0,
    economic_impact_text: 'Potential consumer loss up to ~₹25+ per ₹1,000 transaction (±2.5%+)',
    statutory_rule: 'Exceeds recommended verification period under Legal Metrology Act, 2009',
    action_recommendation: 'High-priority inspector review required; re-stamping due.',
    band_clarification:
      'Red — overdue for re-verification; prioritised for inspector review under Section 15 of Legal Metrology Act.',
  };
}

/**
 * Calculate expected maximum rupee variance on any given transaction value.
 */
export function calculateTransactionVariance(
  transactionAmountInr: number,
  maxDriftPct: number
): number {
  return Math.round(Number(transactionAmountInr) * (Number(maxDriftPct) / 100.0) * 100) / 100;
}

/**
 * Compute live Trust Decay confidence score and full economic translation.
 *
 * Formula:
 *   t = days elapsed since last statutory verification
 *   lambda = ln(2) / H
 *   Time-only: C(t) = 100 * exp(-lambda * t)
 *   Time+usage: C(t, u) = 100 * exp(-(lambda * t + mu * u)) where u = usage / baseline
 */
export function computeConfidence(
  lastVerificationDate: string,
  instrumentType: InstrumentType | string = 'default',
  confidenceBasis?: ConfidenceBasis,
  usageCounter?: number | null,
  usageBaseline?: number | null,
  asOfDate?: Date | null
): ConfidenceResult {
  const { halfLifeDays, mu, defaultBasis } = getDecayParameters(instrumentType);
  const effectiveBasis: ConfidenceBasis = confidenceBasis || defaultBasis;

  const now = asOfDate || new Date();
  const verifDate = parseIsoDate(lastVerificationDate);

  // Milliseconds elapsed converted to fractional days
  const deltaMs = now.getTime() - verifDate.getTime();
  const daysElapsed = Math.max(0.0, deltaMs / (1000 * 60 * 60 * 24));

  const lam = computeLambda(halfLifeDays);
  const timeDecay = lam * daysElapsed;

  let usageDecay = 0.0;
  let usageRatio = 0.0;

  if (
    effectiveBasis === 'time_and_usage' &&
    usageBaseline &&
    usageBaseline > 0 &&
    usageCounter !== undefined &&
    usageCounter !== null
  ) {
    usageRatio = Math.max(0.0, Number(usageCounter) / Number(usageBaseline));
    usageDecay = mu * usageRatio;
  }

  const totalExponent = timeDecay + usageDecay;
  const rawScore = 100.0 * Math.exp(-totalExponent);
  const clampedScore = Math.max(0.0, Math.min(100.0, rawScore));
  const roundedScore = Math.round(clampedScore * 100) / 100;

  // Confidence Band classification
  let band: ConfidenceBand;
  if (roundedScore >= THRESHOLD_GREEN) {
    band = 'green';
  } else if (roundedScore >= THRESHOLD_AMBER) {
    band = 'amber';
  } else {
    band = 'red';
  }

  // Basis Description
  let basisDescription: string;
  if (effectiveBasis === 'time_and_usage' && usageBaseline && usageCounter !== undefined && usageCounter !== null) {
    basisDescription =
      `Time & usage basis: ${Math.round(usageCounter).toLocaleString('en-IN')} operations recorded against ` +
      `${Math.round(usageBaseline).toLocaleString('en-IN')} baseline across ${daysElapsed.toFixed(1)} days (H=${Math.round(halfLifeDays)}d, μ=${mu}).`;
  } else {
    basisDescription =
      `Time-only basis: ${daysElapsed.toFixed(1)} days elapsed since last statutory stamping ` +
      `(H=${Math.round(halfLifeDays)}d, λ=${lam.toFixed(5)}).`;
  }

  const economicImpact = computeEconomicImpact(roundedScore, band, instrumentType);

  return {
    score: roundedScore,
    raw_score: rawScore,
    band,
    basis: effectiveBasis,
    days_since_verification: Math.round(daysElapsed * 10) / 10,
    half_life_days: halfLifeDays,
    lambda_val: Math.round(lam * 1000000) / 1000000,
    mu_val: effectiveBasis === 'time_and_usage' ? mu : 0.0,
    usage_ratio: effectiveBasis === 'time_and_usage' ? Math.round(usageRatio * 1000) / 1000 : undefined,
    clarification_text: MANDATORY_CLARIFICATION_TEXT,
    basis_description: basisDescription,
    economic_impact: economicImpact,
  };
}

/**
 * Convenience helper to compute decay directly from an EnrichedCertificatePayload.
 */
export function computeDecay(
  payload: EnrichedCertificatePayload,
  asOfDate?: Date | null
): ConfidenceResult {
  return computeConfidence(
    payload.last_verification_date,
    payload.instrument_type,
    payload.confidence_basis,
    payload.usage_counter,
    payload.usage_baseline,
    asOfDate
  );
}

