import { useEffect, useMemo, useState } from 'react';
import type {
  InstrumentRecord,
  MandiClusterSummary,
  Persona,
  VerificationApplication,
} from '../../../lib/types';
import {
  allocateApplication,
  createApplication,
  getApplications,
  getInstruments,
  getMandiSummaries,
} from '../../../lib/api';
import seedInstrumentsRaw from '../../../data/seed-instruments.json';
import seedApplicationsRaw from '../../../data/seed-applications.json';
import seedMandisRaw from '../../../data/seed-mandis.json';
import {
  getOfflineComplaints,
  queueOfflineComplaint,
  markComplaintSynced,
  type OfflineComplaintRecord,
} from '../../../lib/offline-storage';
import styles from './styles.module.css';

interface Props {
  initialPersona?: Persona;
}

export default function Dashboard({ initialPersona }: Props) {
  // Active Persona State
  const [persona, setPersona] = useState<Persona>(() => initialPersona || 'lmo');

  useEffect(() => {
    if (!initialPersona && typeof window !== 'undefined') {
      const urlParam = new URLSearchParams(window.location.search).get('persona') as Persona;
      if (['citizen', 'lmo', 'trader', 'admin'].includes(urlParam)) {
        setPersona(urlParam);
        return;
      }
      const stored = window.localStorage.getItem('weighguard-persona') as Persona;
      if (['citizen', 'lmo', 'trader', 'admin'].includes(stored)) {
        setPersona(stored);
      }
    }
  }, [initialPersona]);

  // Initial computed Mandi cluster summaries
  const initialMandis = useMemo<MandiClusterSummary[]>(() => {
    return (seedMandisRaw as any[]).map((m) => {
      const inMandi = (seedInstrumentsRaw as any[]).filter(
        (i) => i.mandi_cluster?.toLowerCase().includes(m.mandi_name.toLowerCase()) ||
               m.mandi_name.toLowerCase().includes((i.mandi_cluster || '').toLowerCase())
      );
      const total = inMandi.length;
      const compliant = inMandi.filter((i) => i.status === 'COMPLIANT').length;
      const pct = total > 0 ? Math.round((compliant / total) * 1000) / 10 : 100;
      const risk = pct >= 80 ? 'LOW' : pct >= 60 ? 'MEDIUM' : 'HIGH';
      return {
        mandi_id: m.mandi_id,
        mandi_name: m.mandi_name,
        location: m.location,
        total_instruments: total,
        compliant_count: compliant,
        trust_index_pct: pct,
        risk_level: risk as 'LOW' | 'MEDIUM' | 'HIGH',
      };
    });
  }, []);

  // Data states
  const [instruments, setInstruments] = useState<InstrumentRecord[]>(() => seedInstrumentsRaw as unknown as InstrumentRecord[]);
  const [applications, setApplications] = useState<VerificationApplication[]>(() => seedApplicationsRaw as unknown as VerificationApplication[]);
  const [mandis, setMandis] = useState<MandiClusterSummary[]>(() => initialMandis);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);

  // Filters & selections
  const [selectedMandi, setSelectedMandi] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [bandFilter, setBandFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Allocation Modal State (Admin)
  const [allocatingApp, setAllocatingApp] = useState<VerificationApplication | null>(null);
  const [allocOfficer, setAllocOfficer] = useState('A. K. Sharma (Squad #2)');
  const [allocType, setAllocType] = useState<'LMO_OFFICER' | 'GATC'>('LMO_OFFICER');
  const [allocDate, setAllocDate] = useState('2026-09-28');
  const [allocSlot, setAllocSlot] = useState('10:30 AM - 11:30 AM');
  const [isAllocating, setIsAllocating] = useState(false);

  // Application Modal State (Trader)
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyInstrumentId, setApplyInstrumentId] = useState('');
  const [applyTraderName, setApplyTraderName] = useState('East Delhi Potato Merchants');
  const [applyDocsAttached, setApplyDocsAttached] = useState<string[]>([]);
  const [isSubmittingApp, setIsSubmittingApp] = useState(false);

  const [citizenComplaints, setCitizenComplaints] = useState<OfflineComplaintRecord[]>([]);

  // Sync listener with global header PersonaSwitcher
  useEffect(() => {
    function handlePersonaChange(e: Event) {
      const custom = e as CustomEvent<Persona>;
      if (custom.detail) {
        setPersona(custom.detail);
      }
    }
    window.addEventListener('weighguard:persona', handlePersonaChange);
    return () => window.removeEventListener('weighguard:persona', handlePersonaChange);
  }, []);

  // Update persona switcher URL and dispatch
  function switchPersona(p: Persona) {
    setPersona(p);
    try {
      window.localStorage.setItem('weighguard-persona', p);
      window.dispatchEvent(new CustomEvent('weighguard:persona', { detail: p }));
      const url = new URL(window.location.href);
      url.searchParams.set('persona', p);
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }

  // Load initial data
  async function loadData() {
    try {
      const [insts, apps, mnds, cmps] = await Promise.all([
        getInstruments({ sort_by: 'confidence_asc' }),
        getApplications(),
        getMandiSummaries(),
        getOfflineComplaints(),
      ]);
      setInstruments(insts);
      setApplications(apps);
      setMandis(mnds);
      setCitizenComplaints(cmps);
      setSecondsAgo(0);
    } catch (err) {
      console.warn('Failed to load data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();

    const handleComplaintsUpdate = async () => {
      try {
        const cmps = await getOfflineComplaints();
        setCitizenComplaints(cmps);
      } catch {}
    };

    window.addEventListener('weighguard:complaints-updated', handleComplaintsUpdate);

    const timer = setInterval(() => {
      setSecondsAgo((s) => s + 1);
    }, 1000);

    return () => {
      window.removeEventListener('weighguard:complaints-updated', handleComplaintsUpdate);
      clearInterval(timer);
    };
  }, []);

  function handleManualRefresh() {
    setRefreshing(true);
    loadData();
  }

  // Handle Admin Allocation Submission
  async function handleConfirmAllocation() {
    if (!allocatingApp) return;
    setIsAllocating(true);
    try {
      const officerId = allocType === 'LMO_OFFICER' ? 'LM-OFFICER-789' : 'GATC-DEL-04';
      await allocateApplication({
        application_id: allocatingApp.application_id,
        allocated_to: officerId,
        allocated_entity_type: allocType,
        assigned_officer_name: allocOfficer,
        scheduled_date: allocDate,
        scheduled_time_slot: allocSlot,
      });
      // Refresh applications list
      const updatedApps = await getApplications();
      setApplications(updatedApps);
      setAllocatingApp(null);
    } catch (e) {
      console.error('Allocation failed:', e);
    } finally {
      setIsAllocating(false);
    }
  }

  // Handle Trader Application Submission
  async function handleSubmitTraderApplication() {
    if (!applyInstrumentId) return;
    setIsSubmittingApp(true);
    try {
      const docs = applyDocsAttached.map((name, idx) => ({
        doc_id: `DOC-TR-${Date.now()}-${idx}`,
        doc_name: name,
        doc_type: (name.includes('Certificate') ? 'PREVIOUS_CERTIFICATE' : 'REPAIRER_MEMO') as any,
        file_url: '/sample-docs/cert.pdf',
      }));

      await createApplication({
        trader_id: 'TRADER-GZP-102',
        trader_name: applyTraderName,
        instrument_id: applyInstrumentId,
        supporting_documents: docs,
      });

      const updatedApps = await getApplications();
      setApplications(updatedApps);
      setShowApplyModal(false);
      setApplyDocsAttached([]);
    } catch (e) {
      console.error('Failed to submit application:', e);
    } finally {
      setIsSubmittingApp(false);
    }
  }

  // Filtered instruments for LMO Triage Table
  const filteredInstruments = useMemo(() => {
    return instruments.filter((inst) => {
      if (selectedMandi && inst.mandi_cluster !== selectedMandi) return false;
      if (typeFilter !== 'all' && inst.instrument_type !== typeFilter) return false;
      if (bandFilter !== 'all' && inst.confidence?.band !== bandFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = inst.instrument_id.toLowerCase().includes(q);
        const matchesOwner = inst.owner_name.toLowerCase().includes(q);
        const matchesSeal = inst.physical_seal_number.toLowerCase().includes(q);
        const matchesModel = inst.device_model.toLowerCase().includes(q);
        return matchesId || matchesOwner || matchesSeal || matchesModel;
      }
      return true;
    });
  }, [instruments, selectedMandi, typeFilter, bandFilter, searchQuery]);

  // Trader's instruments (mocked for demo trader)
  const traderInstruments = useMemo(() => {
    return instruments.filter(
      (i) => i.owner_name.includes('Potato') || i.owner_name.includes('Onion') || i.instrument_id.includes('4403') || i.instrument_id.includes('4402')
    );
  }, [instruments]);

  // Trader's applications
  const traderApplications = useMemo(() => {
    return applications.filter((a) => a.trader_name.includes('Potato') || a.trader_name.includes('Onion') || a.trader_id.includes('GZP'));
  }, [applications]);

  // LMO Assigned Route Items (Scheduled for today)
  const routeItems = useMemo(() => {
    return applications.filter(
      (a) => a.status === 'INSPECTION_SCHEDULED' && a.assigned_officer_name?.includes('Sharma')
    );
  }, [applications]);

  // Admin pending applications
  const pendingApplications = useMemo(() => {
    return applications.filter((a) => a.status === 'PENDING_ALLOCATION');
  }, [applications]);

  return (
    <div className={styles.container}>
      {/* 1. Header & Section 15 Statutory Notice */}
      <header className={styles.topBar}>
        <div className={styles.syncRow}>
          <div className={styles.syncStatusGroup}>
            <div className={styles.syncIndicator}>
              <span className={styles.pulseDot} />
              <span className={styles.syncTime}>Synced {secondsAgo === 0 ? 'just now' : `${secondsAgo}s ago`}</span>
            </div>
            <span className={styles.authorityBadge}>Ed25519 Authority: DL-01</span>
          </div>
          <button
            type="button"
            onClick={handleManualRefresh}
            className={styles.refreshButton}
            aria-label="Refresh dashboard data"
          >
            <span className={refreshing ? styles.refreshIconRotating : ''}>↻</span>
            <span>{refreshing ? 'Syncing...' : 'Refresh'}</span>
          </button>
        </div>

        <aside className={styles.statutoryNotice} role="note">
          <strong>⚖️ Section 15 Statutory Decision Support:</strong> Algorithmic confidence scores provide
          risk-prioritized triage under Section 15 of the Legal Metrology Act, 2009. Legal enforcement actions require physical
          field inspection by a gazetted Legal Metrology Officer.
        </aside>

        {/* Persona quick tab bar */}
        <nav className={styles.personaNav} aria-label="Dashboard Persona Selector">
          <div className={styles.personaNavHeader}>
            <span className={styles.personaNavLabel}>View As:</span>
            <span className={styles.personaNavSub}>Select Portal Perspective</span>
          </div>
          <div className={styles.personaPillsList}>
            {(['lmo', 'trader', 'admin', 'citizen'] as Persona[]).map((p) => {
              const labels: Record<Persona, { icon: string; name: string }> = {
                lmo: { icon: '👮', name: 'LMO Inspector' },
                trader: { icon: '🏪', name: 'Trader Portal' },
                admin: { icon: '🏛️', name: 'Admin Controller' },
                citizen: { icon: '👤', name: 'Citizen View' },
              };
              return (
                <button
                  key={p}
                  type="button"
                  className={`${styles.personaPill} ${persona === p ? styles.personaPillActive : ''}`}
                  onClick={() => {
                    if (p === 'citizen') {
                      window.location.href = '/verify/';
                    } else {
                      switchPersona(p);
                    }
                  }}
                >
                  <span className={styles.personaIcon} aria-hidden="true">{labels[p].icon}</span>
                  <span className={styles.personaText}>{labels[p].name}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      {/* -------------------- ADMIN / CONTROLLER VIEW -------------------- */}
      {persona === 'admin' && (
        <>
          {/* APMC Mandi Cluster Pods */}
          <section className={styles.section} aria-labelledby="mandi-heading">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="mandi-heading" className={styles.sectionTitle}>
                  🏛️ APMC Mandi Cluster Trust Index
                </h2>
                <p className={styles.sectionSubtitle}>
                  Wholesale market trust scores. Squad deployments recommended for high-risk zones.
                </p>
              </div>
              {selectedMandi && (
                <button
                  type="button"
                  className={styles.refreshButton}
                  onClick={() => setSelectedMandi(null)}
                >
                  ✕ Clear Mandi Filter
                </button>
              )}
            </div>

            <div className={styles.mandiGrid}>
              {mandis.map((m) => {
                const isSelected = selectedMandi === m.mandi_name;
                const isHighRisk = m.risk_level === 'HIGH';
                const meterColor =
                  m.trust_index_pct >= 80 ? 'var(--wg-success-text)' : m.trust_index_pct >= 60 ? 'var(--wg-secondary)' : 'var(--wg-error)';

                return (
                  <article
                    key={m.mandi_id}
                    className={`${styles.mandiCard} ${isSelected ? styles.mandiCardSelected : ''}`}
                    onClick={() => setSelectedMandi(isSelected ? null : m.mandi_name)}
                  >
                    <div className={styles.mandiTop}>
                      <div>
                        <h3 className={styles.mandiName}>{m.mandi_name}</h3>
                        <p className={styles.mandiLocation}>📍 {m.location || 'Delhi / NCR'}</p>
                      </div>
                      <span
                        className={`${styles.scorePill} ${
                          m.risk_level === 'LOW'
                            ? styles.bandGreen
                            : m.risk_level === 'MEDIUM'
                            ? styles.bandAmber
                            : styles.bandRed
                        }`}
                      >
                        {m.risk_level} RISK
                      </span>
                    </div>

                    <div className={styles.mandiScoreBox}>
                      <span className={styles.mandiScoreNumber} style={{ color: meterColor }}>
                        {m.trust_index_pct}%
                      </span>
                      <span className={styles.mandiScoreUnit}>Trust Index</span>
                    </div>

                    <div className={styles.meterTrack}>
                      <div
                        className={styles.meterFill}
                        style={{ width: `${m.trust_index_pct}%`, backgroundColor: meterColor }}
                      />
                    </div>

                    <div className={styles.mandiStats}>
                      <span>Verified: {m.compliant_count} / {m.total_instruments} instruments</span>
                      <span>{isSelected ? '✓ Filtered' : 'Click to filter'}</span>
                    </div>

                    {isHighRisk && (
                      <div className={styles.squadNotice}>
                        <span>⚠️ Priority: Inspection Squad Deployment Recommended</span>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {/* Allocation Desk */}
          <section className={styles.section} aria-labelledby="allocation-heading">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="allocation-heading" className={styles.sectionTitle}>
                  📋 Supervisor Allocation Desk
                </h2>
                <p className={styles.sectionSubtitle}>
                  Pending re-verification applications awaiting officer or GATC assignment.
                </p>
              </div>
              <span className={styles.routeTime}>
                {pendingApplications.length} Applications Pending
              </span>
            </div>

            <div className={styles.allocationCard}>
              {pendingApplications.length === 0 ? (
                <p style={{ color: 'var(--wg-on-surface-variant)', fontStyle: 'italic', margin: 0 }}>
                  No pending applications awaiting allocation.
                </p>
              ) : (
                pendingApplications.map((app) => (
                  <div key={app.application_id} className={styles.appItem}>
                    <div className={styles.appMeta}>
                      <span className={styles.appTrader}>{app.trader_name}</span>
                      <span className={styles.appForensic}>
                        ID: {app.application_id} • Instrument: {app.instrument_id}
                      </span>
                      <div className={styles.docTags}>
                        {app.supporting_documents?.map((d) => (
                          <span key={d.doc_id} className={styles.docTag}>
                            📄 {d.doc_name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      onClick={() => {
                        setAllocatingApp(app);
                        setAllocOfficer('A. K. Sharma (Squad #2)');
                        setAllocSlot('10:30 AM - 11:30 AM');
                      }}
                    >
                      ⚡ Allocate Officer / GATC
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}

      {/* -------------------- LMO INSPECTOR VIEW -------------------- */}
      {persona === 'lmo' && (
        <>
          {/* Officer Identity & Today's Route */}
          <section className={styles.section} aria-labelledby="route-heading">
            <div className={styles.officerHeader}>
              <div>
                <h2 className={styles.officerName}>👮 Inspector A. K. Sharma</h2>
                <p className={styles.officerRole}>Squad #2 • Legal Metrology Division, East Delhi APMC</p>
              </div>
              <span className={styles.routeTime}>
                Today's Route: {routeItems.length} Scheduled
              </span>
            </div>

            {/* Incoming Citizen Field Complaints & High-Alert Dispatches */}
            <div style={{ marginTop: '1.25rem', marginBottom: '1.25rem' }}>
              <div className={styles.sectionHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                  <h3 id="citizen-complaints-heading" className={styles.sectionTitle}>
                    🚨 Incoming Citizen Complaints &amp; Seal Tampering Alerts ({citizenComplaints.length})
                  </h3>
                  <span
                    style={{
                      backgroundColor: citizenComplaints.length > 0 ? '#fee2e2' : '#f0fdf4',
                      color: citizenComplaints.length > 0 ? '#991b1b' : '#166534',
                      border: citizenComplaints.length > 0 ? '1px solid #f87171' : '1px solid #86efac',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      fontSize: '11px',
                      fontWeight: 700,
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    {citizenComplaints.length > 0 ? 'Action Required' : 'Queue Clear'}
                  </span>
                </div>
                <p className={styles.sectionSubtitle}>
                  Live reports submitted via citizen offline verification &amp; physical seal cross-checks (Legal Metrology Act §15).
                </p>
              </div>

              {citizenComplaints.length === 0 ? (
                <div
                  style={{
                    padding: '1.15rem 1.25rem',
                    backgroundColor: 'var(--wg-surface-lowest)',
                    border: '1px dashed var(--wg-outline-variant)',
                    borderRadius: 'var(--wg-radius-lg)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '13.5px', color: 'var(--wg-on-surface)' }}>
                      No pending citizen complaints for Squad #2.
                    </strong>
                    <p style={{ margin: '0.2rem 0 0 0', fontSize: '12px', color: 'var(--wg-on-surface-variant)' }}>
                      When a citizen reports a broken seal or tampered QR on the verification page, it streams directly here.
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    style={{ fontSize: '12px', padding: '0.4rem 0.8rem' }}
                    onClick={async () => {
                      await queueOfflineComplaint({
                        instrument_id: 'IND-SC-4403-GZP',
                        cert_id: 'CERT-2026-4403-1004',
                        physical_seal_number: 'SEAL-DL-88243',
                        device_model: 'Electronic Platform Scale (300kg)',
                        location: 'Ghazipur APMC Wholesale Yard, Shed #4',
                        issue_type: 'SEAL_MISMATCH',
                        notes: 'Citizen reported broken wire seal during APMC wholesale check. Stamped code tampered.',
                      });
                      const cmps = await getOfflineComplaints();
                      setCitizenComplaints(cmps);
                    }}
                  >
                    + Simulate Test Citizen Complaint
                  </button>
                </div>
              ) : (
                <div className={styles.routeGrid}>
                  {citizenComplaints.map((cmp) => (
                    <article
                      key={cmp.complaint_id}
                      className={styles.routeCard}
                      style={{
                        borderLeft: '4px solid #ef4444',
                        backgroundColor: 'var(--wg-surface-lowest)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span
                          style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: '11.5px',
                            fontWeight: 800,
                            color: '#b91c1c',
                          }}
                        >
                          {cmp.complaint_id}
                        </span>
                        <span
                          style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: '10px',
                            fontWeight: 700,
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            padding: '1px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          {cmp.issue_type.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div>
                        <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 700 }}>
                          {cmp.instrument_id} {cmp.device_model ? `(${cmp.device_model})` : ''}
                        </h4>
                        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--wg-on-surface-variant)' }}>
                          📍 {cmp.location || 'Local Market Cluster'}
                        </p>
                      </div>

                      {cmp.physical_seal_number && (
                        <div style={{ fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--wg-on-surface-variant)' }}>
                          Stamped Seal: <strong>{cmp.physical_seal_number}</strong>
                        </div>
                      )}

                      {cmp.notes && (
                        <p
                          style={{
                            margin: 0,
                            fontSize: '12px',
                            backgroundColor: '#fef2f2',
                            color: '#7f1d1d',
                            padding: '0.4rem 0.6rem',
                            borderRadius: '4px',
                            border: '1px solid #fecaca',
                            lineHeight: 1.35,
                          }}
                        >
                          {cmp.notes}
                        </p>
                      )}

                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
                        <a
                          href={`/inspect?instrument_id=${cmp.instrument_id}`}
                          className={styles.btnPrimary}
                          style={{ flex: 1, textAlign: 'center', textDecoration: 'none', fontSize: '12.5px', padding: '0.5rem' }}
                        >
                          ⚡ Start Priority Inspection
                        </a>
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          style={{ fontSize: '12px', padding: '0.5rem' }}
                          onClick={async () => {
                            await markComplaintSynced(cmp.complaint_id);
                            const cmps = await getOfflineComplaints();
                            setCitizenComplaints(cmps);
                          }}
                        >
                          {cmp.synced ? '✅ Synced' : 'Sync'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.sectionHeader}>
              <div>
                <h3 id="route-heading" className={styles.sectionTitle}>
                  🗺️ Today's Assigned Field Route
                </h3>
                <p className={styles.sectionSubtitle}>
                  Scheduled visits allocated by controller. Tap to initiate field stamping.
                </p>
              </div>
            </div>

            <div className={styles.routeGrid}>
              {routeItems.length === 0 ? (
                <div className={styles.routeCard}>
                  <p style={{ margin: 0, color: 'var(--wg-on-surface-variant)' }}>
                    All scheduled inspections for today completed.
                  </p>
                </div>
              ) : (
                routeItems.map((route) => {
                  const inst = instruments.find((i) => i.instrument_id === route.instrument_id);
                  return (
                    <article key={route.application_id} className={styles.routeCard}>
                      <div className={styles.routeTime}>
                        🕒 {route.scheduled_time_slot || '10:30 AM - 11:30 AM'}
                      </div>
                      <div>
                        <h4 style={{ margin: '0 0 4px 0', fontSize: 16, fontWeight: 700 }}>
                          {route.trader_name}
                        </h4>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--wg-on-surface-variant)' }}>
                          📍 {inst?.location || 'Ghazipur APMC Wholesale Yard, Shed #4'}
                        </p>
                      </div>
                      <div style={{ fontSize: 12.5, fontFamily: 'JetBrains Mono', color: 'var(--wg-on-surface-variant)' }}>
                        <div>Device: {inst?.device_model || 'Electronic Platform Scale'}</div>
                        <div>Seal: {inst?.physical_seal_number || 'SEAL-DL-88243'}</div>
                      </div>
                      <a
                        href={`/inspect?instrument_id=${route.instrument_id}&app_id=${route.application_id}`}
                        className={styles.btnPrimary}
                        style={{ textAlign: 'center', textDecoration: 'none' }}
                      >
                        ⚡ Start Field Inspection
                      </a>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          {/* LMO Priority Triage Table */}
          <section className={styles.section} aria-labelledby="triage-heading">
            <div className={styles.sectionHeader}>
              <div>
                <h3 id="triage-heading" className={styles.sectionTitle}>
                  🚨 Risk-Based Priority Triage Table
                </h3>
                <p className={styles.sectionSubtitle}>
                  Sorted ascending by Trust Decay confidence score (highest risk / Red at top).
                </p>
              </div>
            </div>

            <div className={styles.triageCard}>
              {/* Controls */}
              <div className={styles.tableControls}>
                <input
                  type="search"
                  className={styles.searchInput}
                  placeholder="Search by ID, Trader, Model, or Seal #..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />

                <div className={styles.filterChips}>
                  {['all', 'scale', 'fuel_dispenser', 'weighbridge', 'taximeter'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`${styles.filterChip} ${typeFilter === t ? styles.filterChipActive : ''}`}
                      onClick={() => setTypeFilter(t)}
                    >
                      {t === 'all' ? 'All Types' : t.replace('_', ' ')}
                    </button>
                  ))}
                </div>

                <div className={styles.filterChips}>
                  {['all', 'red', 'amber', 'green'].map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={`${styles.filterChip} ${bandFilter === b ? styles.filterChipActive : ''}`}
                      onClick={() => setBandFilter(b)}
                    >
                      {b === 'all' ? 'All Bands' : b.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Table */}
              <div className={styles.tableWrap}>
                <table className={styles.triageTable}>
                  <thead>
                    <tr>
                      <th>Confidence Score</th>
                      <th>Instrument ID & Model</th>
                      <th>Trader & Location</th>
                      <th>Decay Basis</th>
                      <th>Physical Seal</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInstruments.map((inst) => {
                      const score = inst.confidence?.score ?? 0;
                      const band = inst.confidence?.band ?? 'red';
                      const bandClass =
                        band === 'green' ? styles.bandGreen : band === 'amber' ? styles.bandAmber : styles.bandRed;

                      return (
                        <tr key={inst.instrument_id} className={styles.triageRow}>
                          <td>
                            <span className={`${styles.scorePill} ${bandClass}`}>
                              {score.toFixed(1)}% ({band.toUpperCase()})
                            </span>
                          </td>
                          <td>
                            <strong style={{ display: 'block', fontFamily: 'JetBrains Mono' }}>
                              {inst.instrument_id}
                            </strong>
                            <span style={{ fontSize: 12, color: 'var(--wg-on-surface-variant)' }}>
                              {inst.device_model}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{inst.owner_name}</div>
                            <div style={{ fontSize: 12, color: 'var(--wg-on-surface-variant)' }}>
                              {inst.mandi_cluster || inst.location}
                            </div>
                          </td>
                          <td>
                            <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono' }}>
                              {inst.confidence_basis === 'time_and_usage' ? 'Time + Usage' : 'Time-Only'}
                            </span>
                          </td>
                          <td>
                            <code style={{ fontFamily: 'JetBrains Mono', fontSize: 12 }}>
                              {inst.physical_seal_number}
                            </code>
                          </td>
                          <td>
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 700,
                                color: inst.status === 'COMPLIANT' ? 'var(--wg-success-text)' : 'var(--wg-error)',
                              }}
                            >
                              {inst.status}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <a
                                href={`/inspect?instrument_id=${inst.instrument_id}`}
                                className={styles.btnPrimary}
                                style={{
                                  padding: '6px 10px',
                                  fontSize: 12,
                                  minHeight: 32,
                                  textDecoration: 'none',
                                }}
                              >
                                Inspect
                              </a>
                              {inst.cert_id && (
                                <a
                                  href={`/certificate/?id=${inst.cert_id}`}
                                  className={styles.btnSecondary}
                                  style={{
                                    padding: '6px 10px',
                                    fontSize: 12,
                                    minHeight: 32,
                                    textDecoration: 'none',
                                  }}
                                >
                                  Cert
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}

      {/* -------------------- TRADER PORTAL VIEW -------------------- */}
      {persona === 'trader' && (
        <>
          <section className={styles.section} aria-labelledby="trader-heading">
            <div className={styles.traderHeader}>
              <div>
                <h2 id="trader-heading" className={styles.sectionTitle}>
                  🏪 East Delhi Potato Merchants
                </h2>
                <p className={styles.sectionSubtitle}>
                  APMC Mandi Yard Shed #4 • Registration: REG-GZP-2024-8891
                </p>
              </div>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => {
                  setApplyInstrumentId(traderInstruments[0]?.instrument_id || '');
                  setShowApplyModal(true);
                }}
              >
                + Apply for Re-Verification
              </button>
            </div>

            {/* Live Application Tracker */}
            {traderApplications.length > 0 && (
              <div className={styles.stepperContainer}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--wg-primary)' }}>
                    📍 Live Application Status: {traderApplications[0].application_id}
                  </h3>
                  <span className={styles.routeTime}>
                    Status: {traderApplications[0].status.replace('_', ' ')}
                  </span>
                </div>

                {(() => {
                  const app = traderApplications[0];
                  const isAllocated = app.status === 'INSPECTION_SCHEDULED' || app.status === 'CERTIFIED';
                  const isCertified = app.status === 'CERTIFIED';

                  return (
                    <div className={styles.stepper}>
                      <div className={`${styles.step} ${styles.stepCompleted}`}>
                        <span className={styles.stepNumber}>STEP 1</span>
                        <span className={styles.stepTitle}>Application Submitted</span>
                        <span style={{ fontSize: 11, color: 'var(--wg-on-surface-variant)' }}>
                          Applied: {new Date(app.applied_at).toLocaleDateString()}
                        </span>
                      </div>

                      <div className={`${styles.step} ${isAllocated ? styles.stepCompleted : styles.stepActive}`}>
                        <span className={styles.stepNumber}>STEP 2</span>
                        <span className={styles.stepTitle}>Officer / GATC Assigned</span>
                        <span style={{ fontSize: 11, color: 'var(--wg-on-surface-variant)' }}>
                          {app.assigned_officer_name || 'Pending assignment'}
                        </span>
                      </div>

                      <div className={`${styles.step} ${isAllocated ? styles.stepActive : ''}`}>
                        <span className={styles.stepNumber}>STEP 3</span>
                        <span className={styles.stepTitle}>Scheduled Inspection Slot</span>
                        <span style={{ fontSize: 11, color: 'var(--wg-on-surface-variant)' }}>
                          {app.scheduled_date ? `${app.scheduled_date} (${app.scheduled_time_slot})` : 'Awaiting slot'}
                        </span>
                      </div>

                      <div className={`${styles.step} ${isCertified ? styles.stepCompleted : ''}`}>
                        <span className={styles.stepNumber}>STEP 4</span>
                        <span className={styles.stepTitle}>Digitally Certified</span>
                        <span style={{ fontSize: 11, color: 'var(--wg-on-surface-variant)' }}>
                          {isCertified ? 'Schedule XI Issued' : 'Pending verification'}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* My Registered Instruments */}
            <div className={styles.sectionHeader}>
              <div>
                <h3 className={styles.sectionTitle}>⚖️ My Registered Instruments</h3>
                <p className={styles.sectionSubtitle}>
                  Track instrument expiry countdowns and digital stamping status.
                </p>
              </div>
            </div>

            <div className={styles.traderCardGrid}>
              {traderInstruments.map((inst) => {
                const daysRemaining = Math.max(0, Math.ceil((new Date(inst.valid_until).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                return (
                  <article key={inst.instrument_id} className={styles.traderInstrumentCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <h4 style={{ margin: '0 0 2px 0', fontSize: 16, fontWeight: 700 }}>
                          {inst.device_model}
                        </h4>
                        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: 'var(--wg-on-surface-variant)' }}>
                          {inst.instrument_id}
                        </span>
                      </div>
                      <span className={`${styles.expiryBadge} ${daysRemaining <= 10 ? styles.bandAmber : styles.bandGreen}`}>
                        ⏳ Expires in {daysRemaining} days
                      </span>
                    </div>

                    <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div>Physical Seal: <code>{inst.physical_seal_number}</code></div>
                      <div>Last Verified: {new Date(inst.last_verification_date).toLocaleDateString()}</div>
                      <div>Valid Until: {new Date(inst.valid_until).toLocaleDateString()}</div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button
                        type="button"
                        className={styles.btnPrimary}
                        style={{ flex: 1 }}
                        onClick={() => {
                          setApplyInstrumentId(inst.instrument_id);
                          setShowApplyModal(true);
                        }}
                      >
                        Apply for Renewal
                      </button>
                      {inst.cert_id && (
                        <a
                          href={`/certificate/?id=${inst.cert_id}`}
                          className={styles.btnSecondary}
                          style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                        >
                          Print Cert
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* -------------------- ALLOCATION DESK MODAL (ADMIN) -------------------- */}
      {allocatingApp && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Assign Officer / GATC</h3>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setAllocatingApp(null)}
              >
                ✕
              </button>
            </div>

            <div>
              <p style={{ margin: '0 0 4px 0', fontWeight: 600 }}>
                Application: {allocatingApp.application_id}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--wg-on-surface-variant)' }}>
                Trader: {allocatingApp.trader_name} • Instrument: {allocatingApp.instrument_id}
              </p>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Assigned Entity Type</label>
              <select
                className={styles.formSelect}
                value={allocType}
                onChange={(e) => setAllocType(e.target.value as any)}
              >
                <option value="LMO_OFFICER">Legal Metrology Officer (State LMO)</option>
                <option value="GATC">Govt Approved Test Centre (GATC)</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Officer / Centre Name</label>
              <select
                className={styles.formSelect}
                value={allocOfficer}
                onChange={(e) => setAllocOfficer(e.target.value)}
              >
                <option value="A. K. Sharma (Squad #2)">Inspector A. K. Sharma (Squad #2, East Delhi)</option>
                <option value="V. P. Singh (Inspector LM)">Inspector V. P. Singh (North Delhi Division)</option>
                <option value="Govt Approved Test Centre Delhi #4">GATC Delhi #4 (Okhla Testing Lab)</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Inspection Date</label>
              <input
                type="date"
                className={styles.formInput}
                value={allocDate}
                onChange={(e) => setAllocDate(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Time Slot</label>
              <select
                className={styles.formSelect}
                value={allocSlot}
                onChange={(e) => setAllocSlot(e.target.value)}
              >
                <option value="10:30 AM - 11:30 AM">10:30 AM - 11:30 AM (Morning Slot)</option>
                <option value="02:00 PM - 03:00 PM">02:00 PM - 03:00 PM (Afternoon Slot)</option>
                <option value="04:00 PM - 05:00 PM">04:00 PM - 05:00 PM (Evening Slot)</option>
              </select>
            </div>

            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setAllocatingApp(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={isAllocating}
                onClick={handleConfirmAllocation}
              >
                {isAllocating ? 'Saving Allocation...' : 'Confirm Allocation & Schedule Slot'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- TRADER APPLICATION MODAL -------------------- */}
      {showApplyModal && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Apply for Instrument Re-Verification</h3>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setShowApplyModal(false)}
              >
                ✕
              </button>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Instrument to Re-Verify</label>
              <select
                className={styles.formSelect}
                value={applyInstrumentId}
                onChange={(e) => setApplyInstrumentId(e.target.value)}
              >
                {traderInstruments.map((inst) => (
                  <option key={inst.instrument_id} value={inst.instrument_id}>
                    {inst.device_model} ({inst.instrument_id}) — Seal: {inst.physical_seal_number}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Supporting Documents</label>
              <div className={styles.dropzone}>
                <span style={{ fontSize: 24 }}>📄</span>
                <span style={{ fontSize: 13, color: 'var(--wg-on-surface-variant)' }}>
                  Upload previous Schedule XI certificate or repairer memo
                </span>
                <button
                  type="button"
                  className={styles.demoPresetBtn}
                  onClick={() =>
                    setApplyDocsAttached([
                      'Schedule_XI_Prev_Cert_2025.pdf',
                      'Authorized_Repairer_Memo_881.pdf',
                    ])
                  }
                >
                  ⚡ Attach Demo Preset Documents
                </button>
              </div>
              {applyDocsAttached.length > 0 && (
                <div className={styles.docTags}>
                  {applyDocsAttached.map((doc) => (
                    <span key={doc} className={styles.docTag}>
                      ✓ {doc}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setShowApplyModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={isSubmittingApp}
                onClick={handleSubmitTraderApplication}
              >
                {isSubmittingApp ? 'Submitting...' : 'Submit Application'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
