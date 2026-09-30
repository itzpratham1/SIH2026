import { useEffect, useState } from 'react';
import type { InstrumentRecord, RevocationEntry } from '../../../lib/types';
import defaultRevocationListMeta from '../../../data/revocation-list.json';
import seedInstrumentsData from '../../../data/seed-instruments.json';
import seedCertificatesData from '../../../data/seed-certificates.json';
import styles from '../../documents/ScheduleXII/styles.module.css';

interface Props {
  certId?: string;
}

export default function DynamicRejection({ certId: initialCertId }: Props) {
  const [rejection, setRejection] = useState<{
    noticeNo: string;
    instrumentId: string;
    deviceModel: string;
    ownerName: string;
    location: string;
    mandiCluster?: string;
    oldCertId: string;
    revokedOn: string;
    recordedGrounds: string;
    rectificationDeadline: string;
  } | null>(null);

  useEffect(() => {
    let targetId = initialCertId;
    if (!targetId && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      targetId = params.get('id') || params.get('cert_id') || params.get('cert') || undefined;
      if (!targetId) {
        const parts = window.location.pathname.split('/').filter(Boolean);
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart !== 'rejection' && !lastPart.includes('.')) {
          targetId = lastPart;
        }
      }
    }

    if (!targetId) {
      targetId = 'CERT-2026-4402-1002';
    }

    // 1. Check revocation list from localStorage or seeds
    let entry: RevocationEntry | undefined;
    try {
      const rawRev = window.localStorage.getItem('weighguard:v3:revocations');
      if (rawRev) {
        const parsed = JSON.parse(rawRev);
        entry = (parsed.revoked || []).find((e: RevocationEntry) => e.cert_id === targetId || e.instrument_id === targetId);
      }
    } catch {}

    if (!entry) {
      entry = (defaultRevocationListMeta.revoked as RevocationEntry[]).find(
        (e) => e.cert_id === targetId || e.instrument_id === targetId
      );
    }

    const instList = (seedInstrumentsData as unknown as InstrumentRecord[]);
    let inst = instList.find((i) => i.cert_id === targetId || i.instrument_id === (entry?.instrument_id || targetId));

    if (!entry) {
      entry = {
        cert_id: targetId,
        instrument_id: inst?.instrument_id || 'IND-DEMO',
        revoked_at: new Date().toISOString(),
        reason: 'Statutory rejection: Observed error exceeded statutory MPE tolerance under Rule 19 of Legal Metrology (General) Rules, 2011',
      };
    }

    const oldCert = (seedCertificatesData as any[]).find(
      (c) => c.cert_id === entry!.cert_id || c.instrument_id === entry!.instrument_id
    );

    const revokedDate = new Date(entry.revoked_at);
    const deadline = new Date(revokedDate.getTime() + 14 * 24 * 3600 * 1000);
    const noticeNo = entry.cert_id.replace('CERT', 'REJ-NOTICE');

    function formatDate(iso: string): string {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
      return `${day}-${month}-${d.getUTCFullYear()}`;
    }

    setRejection({
      noticeNo,
      instrumentId: entry.instrument_id,
      deviceModel: oldCert?.device_model ?? inst?.device_model ?? entry.instrument_id,
      ownerName: oldCert?.owner_name ?? inst?.owner_name ?? 'Recorded Trader',
      location: oldCert?.location ?? inst?.location ?? 'Recorded Premises',
      mandiCluster: oldCert?.mandi_cluster ?? inst?.mandi_cluster,
      oldCertId: entry.cert_id,
      revokedOn: formatDate(entry.revoked_at),
      recordedGrounds: entry.reason,
      rectificationDeadline: formatDate(deadline.toISOString()),
    });
  }, [initialCertId]);

  if (!rejection) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading rejection notice...</div>;
  }

  return (
    <article aria-label={`Notice of Rejection ${rejection.noticeNo}`} className={styles.sheet}>
      <header className={styles.masthead}>
        <p className={styles.govLine}>Government of India · Ministry of Consumer Affairs, Food &amp; Public Distribution</p>
        <p className={styles.deptLine}>Legal Metrology Division</p>
        <h1 className={styles.docTitle}>Notice of Rejection</h1>
        <p className={styles.scheduleLine}>Issued under the Legal Metrology (General) Rules, 2011 — Schedule XII</p>
        <p data-forensic="true" className={styles.noticeNo}>No. {rejection.noticeNo}</p>
      </header>

      <section aria-label="Rejection order" className={styles.order}>
        <p className={styles.orderText}>
          The verification stamp / certificate <strong data-forensic="true">{rejection.oldCertId}</strong> issued
          in respect of the instrument described below stands
          <strong className={styles.rejected}> REJECTED and OBLITERATED</strong> with effect from
          <strong data-forensic="true"> {rejection.revokedOn}</strong>. The instrument shall not be used for trade
          until re-verified and re-stamped by a Legal Metrology Officer.
        </p>
      </section>

      <dl className={styles.fieldGrid}>
        <div className={styles.field}>
          <dt>Trader / Owner</dt>
          <dd>{rejection.ownerName}</dd>
        </div>
        <div className={styles.field}>
          <dt>Premises</dt>
          <dd>{rejection.location}</dd>
        </div>
        {rejection.mandiCluster && (
          <div className={styles.field}>
            <dt>Market Cluster</dt>
            <dd>{rejection.mandiCluster}</dd>
          </div>
        )}
        <div className={styles.field}>
          <dt>Instrument</dt>
          <dd>{rejection.deviceModel}</dd>
        </div>
        <div className={styles.field}>
          <dt data-forensic="true">Instrument ID</dt>
          <dd data-forensic="true">{rejection.instrumentId}</dd>
        </div>
        <div className={styles.field}>
          <dt>Recorded Grounds</dt>
          <dd>{rejection.recordedGrounds}</dd>
        </div>
        <div className={styles.field}>
          <dt>Rectification Deadline</dt>
          <dd data-forensic="true">{rejection.rectificationDeadline} (14-day statutory period)</dd>
        </div>
        <div className={styles.field}>
          <dt>Registry</dt>
          <dd>Certificate pushed to signed revocation list; offline verifiers alert on scan.</dd>
        </div>
      </dl>

      <footer className={styles.signOff}>
        <div className={styles.signBox}>
          <p className={styles.signLine}>_________________________</p>
          <p className={styles.signCaption}>Inspector, Legal Metrology (issuing authority)</p>
        </div>
        <div className={styles.signBox}>
          <p className={styles.signLine}>_________________________</p>
          <p className={styles.signCaption}>Trader acknowledgement of receipt</p>
        </div>
      </footer>
    </article>
  );
}
