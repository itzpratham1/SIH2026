/**
 * WeighGuard offline storage — IndexedDB queue for offline complaints
 * and cached certificates / scan history.
 * Runs 100% in-browser with zero network dependency.
 */

const DB_NAME = 'weighguard-offline';
const DB_VERSION = 2;

export interface OfflineComplaintRecord {
  complaint_id: string;
  queued_at: string;
  instrument_id: string;
  cert_id?: string;
  physical_seal_number?: string;
  device_model?: string;
  location?: string;
  issue_type:
    | 'TAMPERED_SIGNATURE'
    | 'REVOKED_CERTIFICATE'
    | 'SEAL_MISMATCH'
    | 'EXCESSIVE_DRIFT_RED';
  notes?: string;
  synced: boolean;
}

export interface ScanHistoryRecord {
  scan_id: string;
  scanned_at: string;
  cert_id: string;
  instrument_id: string;
  device_model: string;
  physical_seal_number: string;
  band: 'green' | 'amber' | 'red' | 'tampered' | 'revoked';
  score: number;
  isValid: boolean;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not available in this environment'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('complaints')) {
        db.createObjectStore('complaints', { keyPath: 'complaint_id' });
      }
      if (!db.objectStoreNames.contains('certificates')) {
        db.createObjectStore('certificates', { keyPath: 'cert_id' });
      }
      if (!db.objectStoreNames.contains('scan_history')) {
        db.createObjectStore('scan_history', { keyPath: 'scan_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Queue an offline complaint for later sync or 1915 SMS backup. */
export async function queueOfflineComplaint(
  record: Omit<OfflineComplaintRecord, 'complaint_id' | 'queued_at' | 'synced'> & {
    complaint_id?: string;
    queued_at?: string;
    synced?: boolean;
  }
): Promise<OfflineComplaintRecord> {
  const db = await openDatabase();
  const complaint: OfflineComplaintRecord = {
    complaint_id: record.complaint_id || `CMP-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`,
    queued_at: record.queued_at || new Date().toISOString(),
    instrument_id: record.instrument_id,
    cert_id: record.cert_id,
    physical_seal_number: record.physical_seal_number,
    device_model: record.device_model,
    location: record.location,
    issue_type: record.issue_type,
    notes: record.notes,
    synced: record.synced ?? false,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('complaints', 'readwrite');
    tx.objectStore('complaints').put(complaint);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  // Notify listeners (e.g. Officer dashboard, Citizen verification queue drawer)
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('weighguard:complaints-updated', { detail: complaint }));
      // Also mirror in localStorage for instant cross-tab access
      const existing = JSON.parse(localStorage.getItem('weighguard_offline_complaints') || '[]');
      const filtered = existing.filter((c: OfflineComplaintRecord) => c.complaint_id !== complaint.complaint_id);
      localStorage.setItem('weighguard_offline_complaints', JSON.stringify([complaint, ...filtered]));
    } catch {
      // Ignored
    }
  }

  return complaint;
}

/** Mark an offline complaint as synced with the central Legal Metrology enforcement portal. */
export async function markComplaintSynced(complaint_id: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('complaints', 'readwrite');
      const store = tx.objectStore('complaints');
      const req = store.get(complaint_id);
      req.onsuccess = () => {
        const item = req.result as OfflineComplaintRecord | undefined;
        if (item) {
          item.synced = true;
          store.put(item);
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    db.close();

    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('weighguard:complaints-updated'));
        const existing = JSON.parse(localStorage.getItem('weighguard_offline_complaints') || '[]');
        const updated = existing.map((c: OfflineComplaintRecord) =>
          c.complaint_id === complaint_id ? { ...c, synced: true } : c
        );
        localStorage.setItem('weighguard_offline_complaints', JSON.stringify(updated));
      } catch {
        // Ignored
      }
    }
  } catch (err) {
    console.warn('Failed to mark complaint synced:', err);
  }
}

/** Delete an offline complaint from the local queue. */
export async function deleteOfflineComplaint(complaint_id: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('complaints', 'readwrite');
      tx.objectStore('complaints').delete(complaint_id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('weighguard:complaints-updated'));
        const existing = JSON.parse(localStorage.getItem('weighguard_offline_complaints') || '[]');
        const filtered = existing.filter((c: OfflineComplaintRecord) => c.complaint_id !== complaint_id);
        localStorage.setItem('weighguard_offline_complaints', JSON.stringify(filtered));
      } catch {
        // Ignored
      }
    }
  } catch (err) {
    console.warn('Failed to delete complaint:', err);
  }
}

/** Get all queued offline complaints. */
export async function getOfflineComplaints(): Promise<OfflineComplaintRecord[]> {
  try {
    const db = await openDatabase();
    const fromIdb = await new Promise<OfflineComplaintRecord[]>((resolve, reject) => {
      const tx = db.transaction('complaints', 'readonly');
      const req = tx.objectStore('complaints').getAll();
      req.onsuccess = () => resolve((req.result as OfflineComplaintRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();

    if (fromIdb && fromIdb.length > 0) {
      fromIdb.sort((a, b) => new Date(b.queued_at).getTime() - new Date(a.queued_at).getTime());
      return fromIdb;
    }
    // Fallback to localStorage if IDB is empty
    if (typeof window !== 'undefined') {
      const local = JSON.parse(localStorage.getItem('weighguard_offline_complaints') || '[]');
      local.sort((a: OfflineComplaintRecord, b: OfflineComplaintRecord) =>
        new Date(b.queued_at).getTime() - new Date(a.queued_at).getTime()
      );
      return local;
    }
    return [];
  } catch {
    if (typeof window !== 'undefined') {
      try {
        return JSON.parse(localStorage.getItem('weighguard_offline_complaints') || '[]');
      } catch {
        return [];
      }
    }
    return [];
  }
}

/** Record a scan in local scan history for citizen convenience. */
export async function recordScanHistory(
  record: Omit<ScanHistoryRecord, 'scan_id' | 'scanned_at'>
): Promise<void> {
  try {
    const db = await openDatabase();
    const entry: ScanHistoryRecord = {
      ...record,
      scan_id: `SCN-${Date.now().toString(36).toUpperCase()}`,
      scanned_at: new Date().toISOString(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('scan_history', 'readwrite');
      tx.objectStore('scan_history').put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('Failed to record scan history in IndexedDB:', e);
  }
}

/** Get recent scan history. */
export async function getScanHistory(): Promise<ScanHistoryRecord[]> {
  try {
    const db = await openDatabase();
    return await new Promise<ScanHistoryRecord[]>((resolve, reject) => {
      const tx = db.transaction('scan_history', 'readonly');
      const req = tx.objectStore('scan_history').getAll();
      req.onsuccess = () => {
        const list = (req.result as ScanHistoryRecord[]) || [];
        list.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
        resolve(list.slice(0, 10));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}
