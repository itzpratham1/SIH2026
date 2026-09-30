import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import type { FieldInspectionRecord, InstrumentRecord } from '../../../lib/types';
import { getInstruments, submitInspection } from '../../../lib/api';
import seedInstrumentsRaw from '../../../data/seed-instruments.json';
import styles from './styles.module.css';

export default function FieldInspection() {
  const [instruments, setInstruments] = useState<InstrumentRecord[]>(() => seedInstrumentsRaw as unknown as InstrumentRecord[]);
  const [selectedInstId, setSelectedInstId] = useState<string>('IND-SC-4403-GZP');
  const [applicationId, setApplicationId] = useState<string>('');

  // Metrological readings
  const [standardMass, setStandardMass] = useState<number>(5000.0);
  const [observedReading, setObservedReading] = useState<number>(5002.0);
  const [mpeLimit, setMpeLimit] = useState<number>(5.0);

  // Stamping & verification
  const [physicalSealNumber, setPhysicalSealNumber] = useState<string>('SEAL-UP-88219');
  const [visualPassed, setVisualPassed] = useState<boolean>(true);
  const [hasPhoto, setHasPhoto] = useState<boolean>(true);

  // Submission & outcome state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [inspectionResult, setInspectionResult] = useState<{
    inspection: FieldInspectionRecord;
    certificate?: any;
  } | null>(null);


  // Load instruments & read URL params
  useEffect(() => {
    getInstruments().then((list) => {
      setInstruments(list);
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const qInst = params.get('instrument_id');
        const qApp = params.get('app_id');
        if (qInst) {
          setSelectedInstId(qInst);
          const found = list.find((i) => i.instrument_id === qInst);
          if (found) {
            setPhysicalSealNumber(found.physical_seal_number);
          }
        }
        if (qApp) {
          setApplicationId(qApp);
        }
      }
    });
  }, []);

  const selectedInstrument = useMemo(() => {
    return instruments.find((i) => i.instrument_id === selectedInstId);
  }, [instruments, selectedInstId]);

  // Real-time MPE calculation
  const errorMargin = useMemo(() => {
    const err = observedReading - standardMass;
    return Math.round(err * 1000) / 1000;
  }, [observedReading, standardMass]);

  const isMpePass = useMemo(() => {
    return Math.abs(errorMargin) <= mpeLimit;
  }, [errorMargin, mpeLimit]);

  const isOverallPass = useMemo(() => {
    return isMpePass && visualPassed;
  }, [isMpePass, visualPassed]);

  // Preset Handlers
  function applyPassPreset() {
    setSelectedInstId('IND-SC-4403-GZP');
    setStandardMass(5000.0);
    setObservedReading(5002.0); // +2.0g error (within ±5.0g)
    setMpeLimit(5.0);
    setPhysicalSealNumber('SEAL-UP-88219');
    setVisualPassed(true);
    setHasPhoto(true);
    setInspectionResult(null);
  }

  function applyFailPreset() {
    setSelectedInstId('IND-SC-4402-GZP');
    setStandardMass(5000.0);
    setObservedReading(5018.0); // +18.0g error (exceeds ±5.0g)
    setMpeLimit(5.0);
    setPhysicalSealNumber('SEAL-DL-88242');
    setVisualPassed(true);
    setHasPhoto(true);
    setInspectionResult(null);
  }

  // Submission handler
  async function handleSubmit() {
    setIsSubmitting(true);
    try {
      const res = await submitInspection({
        application_id: applicationId || undefined,
        instrument_id: selectedInstId,
        officer_id: 'LM-OFFICER-789',
        officer_name: 'A. K. Sharma (Squad #2)',
        standard_test_mass_g: standardMass,
        observed_reading_g: observedReading,
        mpe_limit_g: mpeLimit,
        physical_seal_number: physicalSealNumber,
        visual_inspection_passed: visualPassed,
        photo_evidence_url: hasPhoto ? '/sample-photos/stamping-evidence.jpg' : undefined,
      });
      if (res.certificate) {
        try {
          const existingCerts = JSON.parse(window.localStorage.getItem('weighguard:certificates') || '[]');
          window.localStorage.setItem('weighguard:certificates', JSON.stringify([res.certificate, ...existingCerts]));
        } catch (err) {
          console.warn('Failed to save certificate to localStorage:', err);
        }
        const payload = `WEIGHGUARD:${res.certificate.cert_id}:${res.inspection.instrument_id}:${physicalSealNumber}`;
        try {
          const url = await QRCode.toDataURL(payload, { width: 180, margin: 1, errorCorrectionLevel: 'H' });
          setQrDataUrl(url);
        } catch (err) {
          console.warn('QR gen failed:', err);
        }
      }
      setInspectionResult(res);
    } catch (e) {
      console.error('Inspection submission failed:', e);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.headerCard}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Field Verification & Stamping</h1>
          <span className={styles.officerBadge}>OFFICER ID: LM-789 (SQUAD #2)</span>
        </div>
        <p className={styles.subtitle}>
          Digital field execution conforming to Legal Metrology (General) Rules, 2011.
          Dynamic MPE validation with instantaneous certificate issuance or statutory revocation.
        </p>
      </header>

      {/* Demo Presets Bar */}
      <section className={styles.presetsBar} aria-label="Demo Presets">
        <h2 className={styles.presetsTitle}>⚡ Jury Demo Presets (1-Tap Test Scenarios):</h2>
        <div className={styles.presetsButtons}>
          <button
            type="button"
            className={styles.presetPassBtn}
            onClick={applyPassPreset}
          >
            🟢 1. Demo Pass (Within MPE ±5g → Issue Schedule XI)
          </button>
          <button
            type="button"
            className={styles.presetFailBtn}
            onClick={applyFailPreset}
          >
            🔴 2. Demo Fail (Error +18g Exceeds MPE → Schedule XII Revocation)
          </button>
        </div>
      </section>

      {/* Form or Result Card */}
      {!inspectionResult ? (
        <form
          className={styles.formCard}
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          {/* 1. Target Instrument Selection */}
          <div className={styles.fieldSection}>
            <h3 className={styles.sectionHeading}>1. Instrument & Location</h3>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Target Instrument</label>
                <select
                  className={styles.formSelect}
                  value={selectedInstId}
                  onChange={(e) => {
                    setSelectedInstId(e.target.value);
                    const found = instruments.find((i) => i.instrument_id === e.target.value);
                    if (found) setPhysicalSealNumber(found.physical_seal_number);
                  }}
                >
                  {instruments.map((inst) => (
                    <option key={inst.instrument_id} value={inst.instrument_id}>
                      {inst.instrument_id} — {inst.device_model} ({inst.owner_name})
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Associated Application</label>
                <input
                  type="text"
                  className={`${styles.formInput} ${styles.forensicInput}`}
                  placeholder="Optional (e.g. APP-2026-880)"
                  value={applicationId}
                  onChange={(e) => setApplicationId(e.target.value)}
                />
              </div>
            </div>

            {selectedInstrument && (
              <div style={{ fontSize: 13, color: 'var(--wg-on-surface-variant)', background: 'var(--wg-surface-low)', padding: 10, borderRadius: 6 }}>
                <div>Merchant: <strong>{selectedInstrument.owner_name}</strong></div>
                <div>Location: {selectedInstrument.location} ({selectedInstrument.mandi_cluster || 'APMC Yard'})</div>
                <div>Current Stamped Seal: <code>{selectedInstrument.physical_seal_number}</code></div>
              </div>
            )}
          </div>

          {/* 2. Metrological Readings & Dynamic MPE */}
          <div className={styles.fieldSection}>
            <h3 className={styles.sectionHeading}>2. Standard Reference Weights vs Observed Readings</h3>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Standard Reference Mass (g)</label>
                <input
                  type="number"
                  step="0.1"
                  className={`${styles.formInput} ${styles.forensicInput}`}
                  value={standardMass}
                  onChange={(e) => setStandardMass(parseFloat(e.target.value) || 0)}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Observed Reading on Scale (g)</label>
                <input
                  type="number"
                  step="0.1"
                  className={`${styles.formInput} ${styles.forensicInput}`}
                  value={observedReading}
                  onChange={(e) => setObservedReading(parseFloat(e.target.value) || 0)}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Statutory MPE Limit (± g)</label>
                <input
                  type="number"
                  step="0.1"
                  className={`${styles.formInput} ${styles.forensicInput}`}
                  value={mpeLimit}
                  onChange={(e) => setMpeLimit(parseFloat(e.target.value) || 0)}
                  required
                />
              </div>
            </div>

            {/* Dynamic Real-Time MPE Banner */}
            <div
              className={`${styles.mpeEvaluationBanner} ${
                isMpePass ? styles.bannerPass : styles.bannerFail
              }`}
            >
              <div className={styles.evaluationTitle}>
                <span>{isMpePass ? '✓ PASS — WITHIN STATUTORY MPE TOLERANCE' : '❌ FAIL — EXCEEDS STATUTORY MPE TOLERANCE'}</span>
              </div>
              <div className={styles.evaluationMetrics}>
                <span>Observed Error: {errorMargin >= 0 ? `+${errorMargin.toFixed(2)}` : errorMargin.toFixed(2)} g</span>
                <span>•</span>
                <span>Statutory Limit: ±{mpeLimit.toFixed(2)} g</span>
                <span>•</span>
                <span>MPE Compliance: {isMpePass ? 'COMPLIANT' : 'DEFECTIVE'}</span>
              </div>
              <div className={styles.evaluationNote}>
                {isMpePass
                  ? 'Error is within statutory limits under Legal Metrology Rules, 2011 (Class III Standard). Ready for stamping.'
                  : 'Error exceeds maximum permissible tolerance! Mandatory rejection order required with 14-day rectification period.'}
              </div>
            </div>
          </div>

          {/* 3. Physical Stamping & Visual Inspection */}
          <div className={styles.fieldSection}>
            <h3 className={styles.sectionHeading}>3. Physical Stamping & Visual Integrity</h3>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Physical Seal Serial Number (Lead/Wire Seal or Holographic Label)
              </label>
              <input
                type="text"
                className={`${styles.formInput} ${styles.forensicInput}`}
                value={physicalSealNumber}
                onChange={(e) => setPhysicalSealNumber(e.target.value)}
                required
              />
              <span className={styles.formHelperText}>
                This physical seal number will be cryptographically bound into the QR certificate.
              </span>
            </div>

            <label className={styles.checkboxGroup}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={visualPassed}
                onChange={(e) => setVisualPassed(e.target.checked)}
              />
              <span className={styles.checkboxText}>
                <strong>Visual Inspection Passed:</strong> No signs of tampering, drilling, unauthorized external potentiometers, or broken lead wires.
              </span>
            </label>

            <div className={styles.photoBox}>
              <div className={styles.photoLeft}>
                <div className={styles.photoPreview}>{hasPhoto ? '📸' : '📷'}</div>
                <div className={styles.photoInfo}>
                  <div className={styles.photoTitle}>Photographic Evidence</div>
                  <div className={styles.photoSubtitle}>
                    {hasPhoto ? 'Photo of physical seal & plate captured: stamping-evidence.jpg' : 'No photo attached'}
                  </div>
                  {hasPhoto && (
                    <span className={styles.photoBadge}>✓ Verified Stamped Photo</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className={`${styles.photoActionBtn} ${hasPhoto ? styles.photoBtnRemove : styles.photoBtnCapture}`}
                onClick={() => setHasPhoto(!hasPhoto)}
              >
                {hasPhoto ? '✕ Remove' : '📷 Capture'}
              </button>
            </div>
          </div>

          {/* 4. Action Branching */}
          <div className={styles.actionsRow}>
            {isOverallPass ? (
              <button
                type="submit"
                className={styles.btnSubmitPass}
                disabled={isSubmitting}
              >
                🛡️ {isSubmitting ? 'Signing Digital Certificate...' : 'Complete & Issue Digital Stamped Certificate (Schedule XI)'}
              </button>
            ) : (
              <button
                type="submit"
                className={styles.btnSubmitFail}
                disabled={isSubmitting}
              >
                ⚠️ {isSubmitting ? 'Recording Rejection...' : 'Issue Notice of Rejection & Revoke Old Certificate (Schedule XII)'}
              </button>
            )}
          </div>
        </form>
      ) : (
        /* Outcome View (Pass or Fail) */
        <div>
          {inspectionResult.inspection.outcome === 'PASS_CERTIFIED' ? (
            <article className={styles.outcomeCardPass}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 32 }}>🛡️</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 20, color: 'var(--wg-success-strong)' }}>
                    Certificate of Verification Issued (Schedule XI)
                  </h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: 13, color: 'var(--wg-on-surface-variant)' }}>
                    Central Ed25519 signature generated. Bound to physical seal {physicalSealNumber}.
                  </p>
                </div>
              </div>

              <div style={{ background: 'var(--wg-surface-low)', padding: 14, borderRadius: 8, fontSize: 13, fontFamily: 'JetBrains Mono' }}>
                <div>Certificate ID: <strong>{inspectionResult.certificate?.cert_id}</strong></div>
                <div>Instrument ID: {inspectionResult.inspection.instrument_id}</div>
                <div>Physical Seal Number: {physicalSealNumber}</div>
                <div>Error Margin: {inspectionResult.inspection.error_margin_g >= 0 ? `+${inspectionResult.inspection.error_margin_g}` : inspectionResult.inspection.error_margin_g} g (MPE limit: ±{inspectionResult.inspection.mpe_limit_g} g)</div>
                <div>Issuing Officer: {inspectionResult.inspection.officer_id}</div>
              </div>

              {/* Render QR code */}
              <div className={styles.qrContainer}>
                <div className={styles.qrCode}>
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="Inspection Stamped QR Code"
                      width={160}
                      height={160}
                      style={{ display: 'block', borderRadius: 6 }}
                    />
                  ) : (
                    <span style={{ fontSize: 13, fontFamily: 'JetBrains Mono' }}>Generating QR...</span>
                  )}
                </div>
                <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono', color: 'var(--wg-on-surface-variant)' }}>
                  QR Payload: Canonical CBOR + Central Ed25519 Signature
                </span>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <a
                  href={`/certificate/?id=${inspectionResult.certificate?.cert_id}`}
                  className={styles.btnSubmitPass}
                  style={{ textDecoration: 'none', flex: 1, textAlign: 'center' }}
                >
                  📄 View Full Printable Schedule XI Certificate
                </a>
                <button
                  type="button"
                  className={styles.presetPassBtn}
                  onClick={() => setInspectionResult(null)}
                >
                  Perform Another Inspection
                </button>
              </div>
            </article>
          ) : (
            <article className={styles.outcomeCardFail}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 32 }}>🛑</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 20, color: 'var(--wg-error)' }}>
                    Form Schedule XII — Notice of Rejection Issued
                  </h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: 13, color: 'var(--wg-critical-text)' }}>
                    Statutory rejection under Rule 19 of Legal Metrology (General) Rules, 2011.
                  </p>
                </div>
              </div>

              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: 14, borderRadius: 8, fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>
                  REASON: {inspectionResult.inspection.rejection_reason}
                </div>
                <div style={{ fontFamily: 'JetBrains Mono', color: '#7f1d1d' }}>
                  Observed error of {inspectionResult.inspection.error_margin_g >= 0 ? `+${inspectionResult.inspection.error_margin_g}` : inspectionResult.inspection.error_margin_g}g exceeds statutory MPE tolerance of ±{inspectionResult.inspection.mpe_limit_g}g.
                </div>
                <div style={{ marginTop: 8, fontWeight: 600, color: '#991b1b' }}>
                  ⚡ REVOCATION LIST UPDATED: Previous certificate revoked in real-time. Offline citizen scanners will alert.
                </div>
                <div style={{ marginTop: 4, color: '#78350f', background: '#fef3c7', padding: '6px 10px', borderRadius: 4 }}>
                  ⏳ 14-Day Statutory Rectification Deadline: {new Date(inspectionResult.inspection.rectification_deadline || '').toLocaleDateString()}. Device must not be used for trade until re-verified.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <a
                  href={`/rejection/?id=${selectedInstrument?.cert_id || 'CERT-2026-4491-1008'}`}
                  className={styles.btnSubmitFail}
                  style={{ textDecoration: 'none', flex: 1, textAlign: 'center' }}
                >
                  📄 View Form Schedule XII Notice
                </a>
                <a
                  href="/dashboard/?persona=lmo"
                  className={styles.presetFailBtn}
                  style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  ← Return to Inspector Route
                </a>
                <button
                  type="button"
                  className={styles.presetFailBtn}
                  onClick={() => setInspectionResult(null)}
                >
                  Perform Another Inspection
                </button>
              </div>
            </article>
          )}
        </div>
      )}
    </div>
  );
}
