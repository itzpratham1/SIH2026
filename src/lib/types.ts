/**
 * WeighGuard shared TypeScript schemas.
 * Single source of truth for cross-model data contracts.
 * Source: development_plan.md §3 (Cryptographic & Data Schemas).
 */

/** Evaluation-sandbox persona. Production uses MeriPehchan / e-Pramaan SSO. */
export type Persona = 'citizen' | 'lmo' | 'trader' | 'admin';

export type InstrumentType =
  | 'fuel_dispenser'
  | 'scale'
  | 'weighbridge'
  | 'taximeter';

export type ConfidenceBasis = 'time_only' | 'time_and_usage';

export type ConfidenceBand = 'green' | 'amber' | 'red';

export type InstrumentStatus =
  | 'COMPLIANT'
  | 'DUE_SOON'
  | 'OVERDUE'
  | 'REJECTED'
  | 'REVOKED';

/** Enriched certificate payload — deterministic CBOR (RFC 8949). */
export interface EnrichedCertificatePayload {
  // Core identifiers
  cert_id: string;
  instrument_id: string;
  instrument_type: InstrumentType;

  // Physical-digital anti-swapping binding (statutory seals)
  physical_seal_number: string;
  device_model: string;
  mandi_cluster?: string;

  // Ownership & administrative context
  owner_name: string;
  location: string;
  officer_id: string;
  officer_name: string;

  // Verification dates & validity (ISO 8601 UTC)
  last_verification_date: string;
  valid_until: string;

  // Trust decay parameters
  confidence_basis: ConfidenceBasis;
  usage_counter?: number;
  usage_baseline?: number;

  // Cryptographic signature
  key_version: string;
  signature: string;
}

/** Field inspection & MPE test record. */
export interface FieldInspectionRecord {
  inspection_id: string;
  application_id?: string;
  instrument_id: string;
  officer_id: string;
  inspection_date: string;

  // Metrological test readings
  standard_test_mass_g: number;
  observed_reading_g: number;
  error_margin_g: number;
  mpe_limit_g: number;

  // Physical stamping
  physical_seal_number: string;
  visual_inspection_passed: boolean;
  photo_evidence_url?: string;

  // Outcome & branching
  outcome: 'PASS_CERTIFIED' | 'FAIL_REJECTED';
  rejection_reason?: 'MPE_EXCEEDED' | 'SEAL_TAMPERED' | 'MECHANICAL_DEFECT';
  rectification_deadline?: string;
}

/** Trader supporting document (upload with demo preset). */
export interface SupportingDocument {
  doc_id: string;
  doc_name: string;
  doc_type: 'PREVIOUS_CERTIFICATE' | 'REPAIRER_MEMO' | 'POSSESSION_PROOF';
  file_url: string;
}

/** Trader re-verification application & allocation record. */
export interface VerificationApplication {
  application_id: string;
  trader_id: string;
  trader_name: string;
  instrument_id: string;
  applied_at: string;
  status:
    | 'PENDING_ALLOCATION'
    | 'INSPECTION_SCHEDULED'
    | 'CERTIFIED'
    | 'REJECTED';
  allocated_to?: string;
  allocated_entity_type?: 'LMO_OFFICER' | 'GATC';
  assigned_officer_name?: string;
  scheduled_date?: string;
  scheduled_time_slot?: string;
  supporting_documents?: SupportingDocument[];
}

/** Instrument master record (seeded local DB standing in for eMaap). */
export interface InstrumentRecord {
  instrument_id: string;
  instrument_type: InstrumentType;
  device_model: string;
  owner_name: string;
  location: string;
  mandi_cluster?: string;
  physical_seal_number: string;
  last_verification_date: string;
  valid_until: string;
  confidence_basis: ConfidenceBasis;
  usage_counter?: number;
  usage_baseline?: number;
  status: InstrumentStatus;
  cert_id?: string;
  confidence?: ConfidenceResult;
}

/** APMC mandi cluster trust aggregation. */
export interface MandiClusterSummary {
  mandi_id: string;
  mandi_name: string;
  location?: string;
  total_instruments: number;
  compliant_count: number;
  trust_index_pct: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

/** Bundled offline revocation list entry. */
export interface RevocationEntry {
  cert_id: string;
  instrument_id: string;
  revoked_at: string;
  reason: string;
}

export interface RevocationList {
  key_version: string;
  updated_at: string;
  revoked: RevocationEntry[];
  signature: string;
}

/** Tangible MPE and economic impact translation for citizens and traders. */
export interface EconomicImpact {
  mpe_status_text: string;
  max_drift_pct: number;
  rupee_risk_per_1000: number;
  economic_impact_text: string;
  statutory_rule: string;
  action_recommendation: string;
  band_clarification: string;
}

/** Computed confidence result (decay engine output). */
export interface ConfidenceResult {
  score: number;
  raw_score?: number;
  band: ConfidenceBand;
  basis: ConfidenceBasis;
  days_since_verification: number;
  half_life_days?: number;
  lambda_val?: number;
  mu_val?: number;
  usage_ratio?: number;
  clarification_text: string;
  basis_description: string;
  economic_impact: EconomicImpact;
}

