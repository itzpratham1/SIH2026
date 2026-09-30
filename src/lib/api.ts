/**
 * WeighGuard Resilient Data & API Layer.
 * Connects to FastAPI backend via /api proxy when available,
 * and falls back seamlessly to local state and bundled seed datasets
 * for 100% offline airplane-mode support.
 */

import type {
  FieldInspectionRecord,
  InstrumentRecord,
  MandiClusterSummary,
  RevocationList,
  VerificationApplication,
} from './types';
import { computeConfidence } from './decay';

import seedInstrumentsRaw from '../data/seed-instruments.json';
import seedApplicationsRaw from '../data/seed-applications.json';
import seedMandisRaw from '../data/seed-mandis.json';
import seedRevocationRaw from '../data/revocation-list.json';

const STORAGE_KEY_INSTRUMENTS = 'weighguard:v3:instruments';
const STORAGE_KEY_APPLICATIONS = 'weighguard:v3:applications';
const STORAGE_KEY_REVOCATIONS = 'weighguard:v3:revocations';
const STORAGE_KEY_INSPECTIONS = 'weighguard:v3:inspections';

// Purge obsolete legacy localStorage keys to ensure new seed distribution takes effect immediately
if (typeof window !== 'undefined') {
  try {
    ['weighguard:instruments', 'weighguard:applications', 'weighguard:mandis', 'weighguard:v2:instruments'].forEach((k) => {
      window.localStorage.removeItem(k);
    });
  } catch {}
}

function safeStorageGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`Failed to write to localStorage for key ${key}:`, err);
  }
}

/** Get master instruments, computing Trust Decay confidence score for each */
export async function getInstruments(params?: {
  mandi_cluster?: string;
  status?: string;
  band?: string;
  sort_by?: 'id_asc' | 'id_desc' | 'confidence_asc' | 'confidence_desc';
}): Promise<InstrumentRecord[]> {
  let list: InstrumentRecord[] = [];

  try {
    const url = new URL('/api/instruments', window.location.origin);
    if (params?.mandi_cluster) url.searchParams.set('mandi_cluster', params.mandi_cluster);
    if (params?.status) url.searchParams.set('status', params.status);
    if (params?.band) url.searchParams.set('band', params.band);
    if (params?.sort_by) url.searchParams.set('sort_by', params.sort_by);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      list = await res.json();
      safeStorageSet(STORAGE_KEY_INSTRUMENTS, list);
      return list;
    }
  } catch {
    // Network unavailable or server down — fallback to offline cached/seed data
  }

  // Fallback to local storage or bundled seed data
  const baseList = safeStorageGet<InstrumentRecord[]>(
    STORAGE_KEY_INSTRUMENTS,
    seedInstrumentsRaw as unknown as InstrumentRecord[]
  );

  // Enrich with client-side Trust Decay computation
  list = baseList.map((inst) => {
    const confidence = computeConfidence({
      lastVerificationDate: inst.last_verification_date,
      instrumentType: inst.instrument_type,
      confidenceBasis: inst.confidence_basis,
      usageCounter: inst.usage_counter,
      usageBaseline: inst.usage_baseline,
    });
    return {
      ...inst,
      confidence,
    };
  });

  if (params?.mandi_cluster) {
    list = list.filter((i) => i.mandi_cluster?.toLowerCase().includes(params.mandi_cluster!.toLowerCase()));
  }
  if (params?.status) {
    list = list.filter((i) => i.status === params.status);
  }
  if (params?.band) {
    list = list.filter((i) => i.confidence?.band === params.band);
  }

  const sortBy = params?.sort_by || 'confidence_asc';
  if (sortBy === 'confidence_asc') {
    list.sort((a, b) => (a.confidence?.score ?? 999) - (b.confidence?.score ?? 999));
  } else if (sortBy === 'confidence_desc') {
    list.sort((a, b) => (b.confidence?.score ?? -1) - (a.confidence?.score ?? -1));
  } else if (sortBy === 'id_desc') {
    list.sort((a, b) => b.instrument_id.localeCompare(a.instrument_id));
  } else {
    list.sort((a, b) => a.instrument_id.localeCompare(b.instrument_id));
  }

  return list;
}

/** Get list of re-verification applications */
export async function getApplications(params?: {
  status?: string;
  trader_id?: string;
  allocated_to?: string;
}): Promise<VerificationApplication[]> {
  try {
    const url = new URL('/api/applications', window.location.origin);
    if (params?.status) url.searchParams.set('status', params.status);
    if (params?.trader_id) url.searchParams.set('trader_id', params.trader_id);
    if (params?.allocated_to) url.searchParams.set('allocated_to', params.allocated_to);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      safeStorageSet(STORAGE_KEY_APPLICATIONS, data);
      return data;
    }
  } catch {
    // offline fallback
  }

  let list = safeStorageGet<VerificationApplication[]>(
    STORAGE_KEY_APPLICATIONS,
    seedApplicationsRaw as unknown as VerificationApplication[]
  );

  if (params?.status) list = list.filter((a) => a.status === params.status);
  if (params?.trader_id) list = list.filter((a) => a.trader_id === params.trader_id);
  if (params?.allocated_to) list = list.filter((a) => a.allocated_to === params.allocated_to);

  return list;
}

/** Submit a new Trader application */
export async function createApplication(data: {
  trader_id: string;
  trader_name: string;
  instrument_id: string;
  supporting_documents?: Array<{
    doc_id: string;
    doc_name: string;
    doc_type: 'PREVIOUS_CERTIFICATE' | 'REPAIRER_MEMO' | 'POSSESSION_PROOF';
    file_url: string;
  }>;
}): Promise<VerificationApplication> {
  const newApp: VerificationApplication = {
    application_id: `APP-2026-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
    trader_id: data.trader_id,
    trader_name: data.trader_name,
    instrument_id: data.instrument_id,
    applied_at: new Date().toISOString(),
    status: 'PENDING_ALLOCATION',
    supporting_documents: data.supporting_documents || [],
  };

  try {
    const res = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const saved = await res.json();
      const current = safeStorageGet<VerificationApplication[]>(STORAGE_KEY_APPLICATIONS, seedApplicationsRaw as unknown as VerificationApplication[]);
      safeStorageSet(STORAGE_KEY_APPLICATIONS, [saved, ...current.filter((a) => a.application_id !== saved.application_id)]);
      return saved;
    }
  } catch {
    // offline mode
  }

  // Save to local storage
  const current = safeStorageGet<VerificationApplication[]>(
    STORAGE_KEY_APPLICATIONS,
    seedApplicationsRaw as unknown as VerificationApplication[]
  );
  const updated = [newApp, ...current];
  safeStorageSet(STORAGE_KEY_APPLICATIONS, updated);
  return newApp;
}

/** Allocate application to LMO Officer or GATC */
export async function allocateApplication(data: {
  application_id: string;
  allocated_to: string;
  allocated_entity_type: 'LMO_OFFICER' | 'GATC';
  assigned_officer_name: string;
  scheduled_date: string;
  scheduled_time_slot: string;
}): Promise<VerificationApplication> {
  try {
    const res = await fetch('/api/applications/allocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const allocated = await res.json();
      const current = safeStorageGet<VerificationApplication[]>(STORAGE_KEY_APPLICATIONS, seedApplicationsRaw as unknown as VerificationApplication[]);
      const updated = current.map((a) => (a.application_id === allocated.application_id ? allocated : a));
      safeStorageSet(STORAGE_KEY_APPLICATIONS, updated);
      return allocated;
    }
  } catch {
    // offline fallback
  }

  // Update in local storage
  const current = safeStorageGet<VerificationApplication[]>(
    STORAGE_KEY_APPLICATIONS,
    seedApplicationsRaw as unknown as VerificationApplication[]
  );
  let updatedApp: VerificationApplication | null = null;
  const updated = current.map((a) => {
    if (a.application_id === data.application_id) {
      updatedApp = {
        ...a,
        status: 'INSPECTION_SCHEDULED',
        allocated_to: data.allocated_to,
        allocated_entity_type: data.allocated_entity_type,
        assigned_officer_name: data.assigned_officer_name,
        scheduled_date: data.scheduled_date,
        scheduled_time_slot: data.scheduled_time_slot,
      };
      return updatedApp;
    }
    return a;
  });

  safeStorageSet(STORAGE_KEY_APPLICATIONS, updated);
  return updatedApp || {
    application_id: data.application_id,
    trader_id: 'TRADER-DEMO',
    trader_name: 'Demo Trader',
    instrument_id: 'IND-DEMO',
    applied_at: new Date().toISOString(),
    status: 'INSPECTION_SCHEDULED',
    ...data,
  };
}

/** Submit Field Inspection with Pass/Fail Branching */
export async function submitInspection(data: {
  application_id?: string;
  instrument_id: string;
  officer_id: string;
  officer_name: string;
  standard_test_mass_g: number;
  observed_reading_g: number;
  mpe_limit_g: number;
  physical_seal_number: string;
  visual_inspection_passed: boolean;
  photo_evidence_url?: string;
  rejection_reason_override?: 'MPE_EXCEEDED' | 'SEAL_TAMPERED' | 'MECHANICAL_DEFECT';
}): Promise<{
  inspection: FieldInspectionRecord;
  certificate?: any;
}> {
  try {
    const res = await fetch('/api/inspections/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const result = await res.json();
      // Sync local instrument status
      const instruments = safeStorageGet<InstrumentRecord[]>(STORAGE_KEY_INSTRUMENTS, seedInstrumentsRaw as unknown as InstrumentRecord[]);
      const isPass = result.inspection.outcome === 'PASS_CERTIFIED';
      const updated = instruments.map((inst) => {
        if (inst.instrument_id === data.instrument_id) {
          return {
            ...inst,
            status: isPass ? ('COMPLIANT' as const) : ('REJECTED' as const),
            physical_seal_number: data.physical_seal_number,
            cert_id: isPass ? result.certificate?.cert_id || inst.cert_id : inst.cert_id,
            last_verification_date: isPass ? new Date().toISOString() : inst.last_verification_date,
          };
        }
        return inst;
      });
      safeStorageSet(STORAGE_KEY_INSTRUMENTS, updated);

      // If rejected, sync into local revocation list
      if (!isPass) {
        const currentInst = instruments.find((i) => i.instrument_id === data.instrument_id);
        if (currentInst?.cert_id) {
          const revList = safeStorageGet<RevocationList>(STORAGE_KEY_REVOCATIONS, seedRevocationRaw as unknown as RevocationList);
          if (!revList.revoked.some((r) => r.cert_id === currentInst.cert_id)) {
            revList.revoked.unshift({
              cert_id: currentInst.cert_id,
              instrument_id: currentInst.instrument_id,
              revoked_at: result.inspection.inspection_date || new Date().toISOString(),
              reason: `Field inspection rejected: ${result.inspection.rejection_reason} (Observed error: ${result.inspection.error_margin_g >= 0 ? '+' : ''}${result.inspection.error_margin_g}g, MPE limit: ±${data.mpe_limit_g}g)`,
            });
            safeStorageSet(STORAGE_KEY_REVOCATIONS, revList);
          }
        }
      }

      // Store in local inspections history
      const storedInsps = safeStorageGet<FieldInspectionRecord[]>(STORAGE_KEY_INSPECTIONS, []);
      safeStorageSet(STORAGE_KEY_INSPECTIONS, [result.inspection, ...storedInsps]);

      return result;
    }
  } catch {
    // offline fallback
  }

  // Local fallback processing
  const nowIso = new Date().toISOString();
  const inspId = `INSP-2026-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const errorMargin = Math.round((data.observed_reading_g - data.standard_test_mass_g) * 1000) / 1000;
  const isMpePass = Math.abs(errorMargin) <= data.mpe_limit_g;
  const isPass = isMpePass && data.visual_inspection_passed;

  const instruments = safeStorageGet<InstrumentRecord[]>(
    STORAGE_KEY_INSTRUMENTS,
    seedInstrumentsRaw as unknown as InstrumentRecord[]
  );
  const currentInst = instruments.find((i) => i.instrument_id === data.instrument_id);

  let newCertRecord: any = null;
  let outcome: 'PASS_CERTIFIED' | 'FAIL_REJECTED' = isPass ? 'PASS_CERTIFIED' : 'FAIL_REJECTED';
  let rejectionReason: 'MPE_EXCEEDED' | 'SEAL_TAMPERED' | 'MECHANICAL_DEFECT' | undefined = undefined;
  let rectificationDeadline: string | undefined = undefined;

  if (isPass) {
    const certId = `CERT-2026-${data.instrument_id.split('-')[2] || 'GEN'}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const validUntil = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

    newCertRecord = {
      cert_id: certId,
      instrument_id: data.instrument_id,
      instrument_type: currentInst?.instrument_type || 'scale',
      physical_seal_number: data.physical_seal_number,
      device_model: currentInst?.device_model || 'Electronic Tabletop Scale',
      mandi_cluster: currentInst?.mandi_cluster || 'APMC Yard',
      owner_name: currentInst?.owner_name || 'Verified Merchant',
      location: currentInst?.location || 'Mandi Yard',
      officer_id: data.officer_id,
      officer_name: data.officer_name,
      last_verification_date: nowIso,
      valid_until: validUntil,
      confidence_basis: currentInst?.confidence_basis || 'time_only',
      key_version: 'v1-ed25519-2026',
      signature: 'mock_local_signature_ed25519',
    };

    // Update instruments in local storage
    const updated = instruments.map((inst) => {
      if (inst.instrument_id === data.instrument_id) {
        return {
          ...inst,
          status: 'COMPLIANT' as const,
          last_verification_date: nowIso,
          valid_until: validUntil,
          physical_seal_number: data.physical_seal_number,
          cert_id: certId,
        };
      }
      return inst;
    });
    safeStorageSet(STORAGE_KEY_INSTRUMENTS, updated);
  } else {
    rejectionReason = data.rejection_reason_override || (!isMpePass ? 'MPE_EXCEEDED' : 'SEAL_TAMPERED');
    rectificationDeadline = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

    // Mark REJECTED in local instruments
    const updated = instruments.map((inst) => {
      if (inst.instrument_id === data.instrument_id) {
        return { ...inst, status: 'REJECTED' as const };
      }
      return inst;
    });
    safeStorageSet(STORAGE_KEY_INSTRUMENTS, updated);

    // Auto-append old cert to local revocation list
    if (currentInst?.cert_id) {
      const revList = safeStorageGet<RevocationList>(STORAGE_KEY_REVOCATIONS, seedRevocationRaw as RevocationList);
      if (!revList.revoked.some((r) => r.cert_id === currentInst.cert_id)) {
        revList.revoked.unshift({
          cert_id: currentInst.cert_id,
          instrument_id: currentInst.instrument_id,
          revoked_at: nowIso,
          reason: `Field inspection rejected: ${rejectionReason} (Observed error: ${errorMargin >= 0 ? '+' : ''}${errorMargin}g, MPE limit: ±${data.mpe_limit_g}g)`,
        });
        safeStorageSet(STORAGE_KEY_REVOCATIONS, revList);
      }
    }
  }

  // Update applications if application_id provided
  if (data.application_id) {
    const apps = safeStorageGet<VerificationApplication[]>(STORAGE_KEY_APPLICATIONS, seedApplicationsRaw as unknown as VerificationApplication[]);
    const updatedApps = apps.map((a) =>
      a.application_id === data.application_id ? { ...a, status: isPass ? ('CERTIFIED' as const) : ('REJECTED' as const) } : a
    );
    safeStorageSet(STORAGE_KEY_APPLICATIONS, updatedApps);
  }

  const inspection: FieldInspectionRecord = {
    inspection_id: inspId,
    application_id: data.application_id,
    instrument_id: data.instrument_id,
    officer_id: data.officer_id,
    inspection_date: nowIso,
    standard_test_mass_g: data.standard_test_mass_g,
    observed_reading_g: data.observed_reading_g,
    error_margin_g: errorMargin,
    mpe_limit_g: data.mpe_limit_g,
    physical_seal_number: data.physical_seal_number,
    visual_inspection_passed: data.visual_inspection_passed,
    photo_evidence_url: data.photo_evidence_url,
    outcome,
    rejection_reason: rejectionReason,
    rectification_deadline: rectificationDeadline,
  };

  const storedInsps = safeStorageGet<FieldInspectionRecord[]>(STORAGE_KEY_INSPECTIONS, []);
  safeStorageSet(STORAGE_KEY_INSPECTIONS, [inspection, ...storedInsps]);

  return { inspection, certificate: newCertRecord };
}

/** Get APMC Mandi Cluster Summaries */
export async function getMandiSummaries(): Promise<MandiClusterSummary[]> {
  try {
    const res = await fetch('/api/mandis', { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // offline calculation from instruments
  }

  const instruments = await getInstruments();
  const mandiDefs = seedMandisRaw as Array<{ mandi_id: string; mandi_name: string; location: string }>;

  return mandiDefs.map((mandi) => {
    const inMandi = instruments.filter(
      (i) => i.mandi_cluster?.toLowerCase().includes(mandi.mandi_name.toLowerCase()) ||
             mandi.mandi_name.toLowerCase().includes((i.mandi_cluster || '').toLowerCase())
    );
    const total = inMandi.length;
    const compliant = inMandi.filter((i) => i.status === 'COMPLIANT').length;
    const pct = total > 0 ? Math.round((compliant / total) * 1000) / 10 : 100;
    const risk = pct >= 80 ? 'LOW' : pct >= 60 ? 'MEDIUM' : 'HIGH';

    return {
      mandi_id: mandi.mandi_id,
      mandi_name: mandi.mandi_name,
      location: mandi.location,
      total_instruments: total,
      compliant_count: compliant,
      trust_index_pct: pct,
      risk_level: risk,
    };
  });
}

/** Get current Revocation List */
export async function getRevocationList(): Promise<RevocationList> {
  try {
    const res = await fetch('/api/revocation-list', { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      safeStorageSet(STORAGE_KEY_REVOCATIONS, data);
      return data;
    }
  } catch {
    // offline fallback
  }

  return safeStorageGet<RevocationList>(STORAGE_KEY_REVOCATIONS, seedRevocationRaw as unknown as RevocationList);
}

/** Reset demo data to pristine seeds */
export function resetDemoData(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY_INSTRUMENTS);
  window.localStorage.removeItem(STORAGE_KEY_APPLICATIONS);
  window.localStorage.removeItem(STORAGE_KEY_REVOCATIONS);
  window.localStorage.removeItem(STORAGE_KEY_INSPECTIONS);
}
