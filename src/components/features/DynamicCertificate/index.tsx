import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { computeDecay } from '../../../lib/decay';
import type { EnrichedCertificatePayload, InstrumentRecord } from '../../../lib/types';
import seedCertificatesData from '../../../data/seed-certificates.json';
import styles from '../../documents/ScheduleXI/styles.module.css';

interface Props {
  certId?: string;
}

interface StoredCertificate extends EnrichedCertificatePayload {
  cbor_base64?: string;
  created_at?: string;
}

export default function DynamicCertificate({ certId: initialCertId }: Props) {
  const [cert, setCert] = useState<StoredCertificate | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [resolvedId, setResolvedId] = useState<string>(initialCertId || '');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    let targetId = initialCertId;
    if (!targetId && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      targetId = params.get('id') || params.get('cert_id') || params.get('cert') || undefined;
      if (!targetId) {
        const parts = window.location.pathname.split('/').filter(Boolean);
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart !== 'certificate' && !lastPart.includes('.')) {
          targetId = lastPart;
        }
      }
    }

    if (!targetId) {
      setNotFound(true);
      return;
    }

    setResolvedId(targetId);

    // 1. Search in localStorage weighguard:certificates
    try {
      const raw = window.localStorage.getItem('weighguard:certificates');
      if (raw) {
        const certs: StoredCertificate[] = JSON.parse(raw);
        const found = certs.find((c) => c.cert_id === targetId || c.instrument_id === targetId);
        if (found) {
          setCert(found);
          const qrPayload = found.cbor_base64 || `WEIGHGUARD:${found.cert_id}:${found.instrument_id}:${found.physical_seal_number}`;
          QRCode.toDataURL(qrPayload, {
            width: 512,
            margin: 2,
            errorCorrectionLevel: 'M',
          }).then(setQrDataUrl).catch(() => {});
          return;
        }
      }
    } catch {
      // ignore
    }

    // 2. Search in bundled seed certificates
    const seedFound = (seedCertificatesData as unknown as StoredCertificate[]).find(
      (c) => c.cert_id === targetId || c.instrument_id === targetId
    );
    if (seedFound) {
      setCert(seedFound);
      const qrPayload = seedFound.cbor_base64 || `WEIGHGUARD:${seedFound.cert_id}:${seedFound.instrument_id}:${seedFound.physical_seal_number}`;
      QRCode.toDataURL(qrPayload, {
        width: 512,
        margin: 2,
        errorCorrectionLevel: 'M',
      }).then(setQrDataUrl).catch(() => {});
      return;
    }

    // 3. Search in localStorage instruments
    try {
      const rawInst = window.localStorage.getItem('weighguard:v3:instruments');
      if (rawInst) {
        const instList: InstrumentRecord[] = JSON.parse(rawInst);
        const inst = instList.find((i) => i.cert_id === targetId || i.instrument_id === targetId);
        if (inst) {
          const synthesizedCert: StoredCertificate = {
            cert_id: inst.cert_id || targetId,
            instrument_id: inst.instrument_id,
            instrument_type: inst.instrument_type,
            device_model: inst.device_model,
            owner_name: inst.owner_name,
            location: inst.location,
            mandi_cluster: inst.mandi_cluster,
            physical_seal_number: inst.physical_seal_number,
            officer_id: 'LM-OFFICER-789',
            officer_name: 'A. K. Sharma (Squad #2)',
            last_verification_date: inst.last_verification_date,
            valid_until: inst.valid_until,
            key_version: 'v1-ed25519-2026',
            confidence_basis: inst.confidence_basis || 'time_only',
            signature: 'FIELD-OFFICER-ED25519-STAMP',
          };
          setCert(synthesizedCert);
          const qrPayload = `WEIGHGUARD:${synthesizedCert.cert_id}:${synthesizedCert.instrument_id}:${synthesizedCert.physical_seal_number}`;
          QRCode.toDataURL(qrPayload, {
            width: 512,
            margin: 2,
            errorCorrectionLevel: 'M',
          }).then(setQrDataUrl).catch(() => {});
          return;
        }
      }
    } catch {
      // ignore
    }

    setNotFound(true);
  }, [initialCertId]);

  if (notFound) {
    return (
      <div style={{ padding: '3rem 1.5rem', textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📜</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--wg-on-surface, #1e293b)', marginBottom: 8 }}>Certificate Not Found</h2>
        <p style={{ color: 'var(--wg-on-surface-variant, #64748b)', fontSize: 14, marginBottom: 16 }}>
          The certificate identifier <code>{resolvedId || '(none)'}</code> could not be located in local storage or the central registry.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href="/dashboard/"
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              background: 'var(--wg-primary, #047857)',
              color: '#ffffff',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            ← Return to Dashboard
          </a>
          <a
            href="/inspect/"
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              background: 'var(--wg-surface-low, #f1f5f9)',
              color: 'var(--wg-on-surface, #1e293b)',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14,
              border: '1px solid #cbd5e1',
            }}
          >
            Perform Field Inspection
          </a>
        </div>
      </div>
    );
  }

  if (!cert) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--wg-on-surface-variant, #64748b)' }}>
        <p>Loading certificate verification sheet...</p>
      </div>
    );
  }

  const confidence = computeDecay(cert);
  const basisLabel = cert.confidence_basis === 'time_and_usage' ? 'time + usage' : 'time-only';

  function formatDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
    return `${day}-${month}-${d.getUTCFullYear()}`;
  }

  return (
    <article aria-label={`Certificate of Verification ${cert.cert_id}`} className={styles.sheet}>
      <header className={styles.masthead}>
        <p className={styles.govLine}>Government of India · Ministry of Consumer Affairs, Food &amp; Public Distribution</p>
        <p className={styles.deptLine}>Legal Metrology Division</p>
        <h1 className={styles.docTitle}>Certificate of Verification</h1>
        <p className={styles.scheduleLine}>Issued under the Legal Metrology (General) Rules, 2011 — Schedule XI</p>
        <p data-forensic="true" className={styles.certNo}>No. {cert.cert_id}</p>
      </header>

      <dl className={styles.fieldGrid}>
        <div className={styles.field}>
          <dt>Trader / Owner</dt>
          <dd>{cert.owner_name}</dd>
        </div>
        <div className={styles.field}>
          <dt>Premises</dt>
          <dd>{cert.location}</dd>
        </div>
        {cert.mandi_cluster && (
          <div className={styles.field}>
            <dt>Market Cluster</dt>
            <dd>{cert.mandi_cluster}</dd>
          </div>
        )}
        <div className={styles.field}>
          <dt>Instrument</dt>
          <dd>{cert.device_model} ({cert.instrument_type})</dd>
        </div>
        <div className={styles.field}>
          <dt data-forensic="true">Instrument ID</dt>
          <dd data-forensic="true">{cert.instrument_id}</dd>
        </div>
        <div className={styles.field}>
          <dt>Statutory Seal No.</dt>
          <dd data-forensic="true">{cert.physical_seal_number}</dd>
        </div>
        <div className={styles.field}>
          <dt>Accuracy Class</dt>
          <dd>Class III — Legal Metrology (General) Rules, 2011</dd>
        </div>
        <div className={styles.field}>
          <dt>Verifying Officer</dt>
          <dd>{cert.officer_name} ({cert.officer_id})</dd>
        </div>
        <div className={styles.field}>
          <dt>Verified On</dt>
          <dd data-forensic="true">{formatDate(cert.last_verification_date)}</dd>
        </div>
        <div className={styles.field}>
          <dt>Valid Until</dt>
          <dd data-forensic="true">{formatDate(cert.valid_until)}</dd>
        </div>
      </dl>

      {qrDataUrl && (
        <section aria-label="Verification QR code" className={styles.qrBlock}>
          <img src={qrDataUrl} alt={`Signed verification QR for ${cert.cert_id}`} width="512" height="512" className={styles.qrImage} />
          <div className={styles.qrMeta}>
            <p className={styles.qrCaption}>Scan with WeighGuard to verify offline — no network required.</p>
            <p data-forensic="true" className={styles.qrKey}>Key {cert.key_version || 'v1-ed25519-2026'}</p>
          </div>
        </section>
      )}

      <section aria-label="Confidence and tolerance" className={styles.confidence}>
        <p className={styles.confLine}>
          Confidence <strong data-band={confidence.band} className={styles.band}>{confidence.band} · {confidence.score.toFixed(1)}</strong>
          <span className={styles.basis}>({basisLabel})</span>
        </p>
        <p className={styles.basisText}>{confidence.basis_description}</p>
        <p className={styles.mpeText}>{confidence.economic_impact.mpe_status_text}</p>
        <p className={styles.clarification}>{confidence.clarification_text}</p>
      </section>

      <footer className={styles.signOff}>
        <div className={styles.signBox}>
          <p className={styles.signLine}>_________________________</p>
          <p className={styles.signCaption}>Inspector, Legal Metrology</p>
        </div>
        <div className={styles.signBox}>
          <p className={styles.signLine}>_________________________</p>
          <p className={styles.signCaption}>Trader acknowledgement &amp; shop-display copy</p>
        </div>
      </footer>
    </article>
  );
}
