import { auth } from '../firebase/config';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export interface ScanSummary {
  sources: number;
  keywords: number;
  fetched: number;
  written: number;
  errors: { source: string; error: string }[];
}

/**
 * Trigger a manual scan (admin/internal). The scheduled hourly scan runs the same
 * worker server-side via Cloud Scheduler — this is the "Scan Now" button.
 */
export async function runScanNow(backfillDays?: number): Promise<ScanSummary> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not authenticated.');
  const res = await fetch(`${BACKEND}/api/news/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(backfillDays ? { backfillDays } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Scan failed (${res.status})`);
  }
  return data.summary as ScanSummary;
}
