"""
Pydantic Schemas for WeighGuard REST API.
Mirrors src/lib/types.ts data contracts.
"""

from __future__ import annotations
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

InstrumentType = Literal["fuel_dispenser", "scale", "weighbridge", "taximeter"]
ConfidenceBasis = Literal["time_only", "time_and_usage"]
ConfidenceBand = Literal["green", "amber", "red"]
InstrumentStatus = Literal["COMPLIANT", "DUE_SOON", "OVERDUE", "REJECTED", "REVOKED"]
ApplicationStatus = Literal["PENDING_ALLOCATION", "INSPECTION_SCHEDULED", "CERTIFIED", "REJECTED"]
InspectionOutcome = Literal["PASS_CERTIFIED", "FAIL_REJECTED"]
RejectionReason = Literal["MPE_EXCEEDED", "SEAL_TAMPERED", "MECHANICAL_DEFECT"]


class SupportingDocument(BaseModel):
    doc_id: str
    doc_name: str
    doc_type: Literal["PREVIOUS_CERTIFICATE", "REPAIRER_MEMO", "POSSESSION_PROOF"]
    file_url: str


class EnrichedCertificatePayload(BaseModel):
    cert_id: str
    instrument_id: str
    instrument_type: InstrumentType
    physical_seal_number: str
    device_model: str
    mandi_cluster: Optional[str] = None
    owner_name: str
    location: str
    officer_id: str
    officer_name: str
    last_verification_date: str
    valid_until: str
    confidence_basis: ConfidenceBasis
    usage_counter: Optional[float] = None
    usage_baseline: Optional[float] = None
    key_version: str
    signature: str
    cbor_base64: Optional[str] = None


class EconomicImpact(BaseModel):
    mpe_status_text: str
    max_drift_pct: float
    rupee_risk_per_1000: float
    economic_impact_text: str
    statutory_rule: str
    action_recommendation: str
    band_clarification: str


class ConfidenceResult(BaseModel):
    score: float
    raw_score: Optional[float] = None
    band: ConfidenceBand
    basis: ConfidenceBasis
    days_since_verification: float
    half_life_days: Optional[float] = None
    lambda_val: Optional[float] = None
    mu_val: Optional[float] = None
    usage_ratio: Optional[float] = None
    clarification_text: str
    basis_description: str
    economic_impact: Optional[EconomicImpact] = None


class InstrumentRecord(BaseModel):
    instrument_id: str
    instrument_type: InstrumentType
    device_model: str
    owner_name: str
    location: str
    mandi_cluster: Optional[str] = None
    physical_seal_number: str
    last_verification_date: str
    valid_until: str
    confidence_basis: ConfidenceBasis
    usage_counter: Optional[float] = None
    usage_baseline: Optional[float] = None
    status: InstrumentStatus
    cert_id: Optional[str] = None
    confidence: Optional[ConfidenceResult] = None



class MandiClusterSummary(BaseModel):
    mandi_id: str
    mandi_name: str
    location: str
    total_instruments: int
    compliant_count: int
    trust_index_pct: float
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]


class VerificationApplication(BaseModel):
    application_id: str
    trader_id: str
    trader_name: str
    instrument_id: str
    applied_at: str
    status: ApplicationStatus
    allocated_to: Optional[str] = None
    allocated_entity_type: Optional[Literal["LMO_OFFICER", "GATC"]] = None
    assigned_officer_name: Optional[str] = None
    scheduled_date: Optional[str] = None
    scheduled_time_slot: Optional[str] = None
    supporting_documents: Optional[List[SupportingDocument]] = None


class ApplicationCreateRequest(BaseModel):
    trader_id: str
    trader_name: str
    instrument_id: str
    supporting_documents: Optional[List[SupportingDocument]] = None


class ApplicationAllocateRequest(BaseModel):
    application_id: str
    allocated_to: str
    allocated_entity_type: Literal["LMO_OFFICER", "GATC"]
    assigned_officer_name: str
    scheduled_date: str
    scheduled_time_slot: str


class FieldInspectionRecord(BaseModel):
    inspection_id: str
    application_id: Optional[str] = None
    instrument_id: str
    officer_id: str
    inspection_date: str
    standard_test_mass_g: float
    observed_reading_g: float
    error_margin_g: float
    mpe_limit_g: float
    physical_seal_number: str
    visual_inspection_passed: bool
    photo_evidence_url: Optional[str] = None
    outcome: InspectionOutcome
    rejection_reason: Optional[RejectionReason] = None
    rectification_deadline: Optional[str] = None


class FieldInspectionSubmitRequest(BaseModel):
    application_id: Optional[str] = None
    instrument_id: str
    officer_id: str
    officer_name: str
    standard_test_mass_g: float
    observed_reading_g: float
    mpe_limit_g: float
    physical_seal_number: str
    visual_inspection_passed: bool
    photo_evidence_url: Optional[str] = None
    rejection_reason_override: Optional[RejectionReason] = None


class RevocationEntry(BaseModel):
    cert_id: str
    instrument_id: str
    revoked_at: str
    reason: str


class RevocationListResponse(BaseModel):
    key_version: str
    updated_at: str
    revoked: List[RevocationEntry]
    signature: str


class KeyMetadataResponse(BaseModel):
    key_version: str
    algorithm: str
    public_key_base64: str
    public_key_hex: str
    issuer: str
    description: str
