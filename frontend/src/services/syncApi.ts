import { auth } from '../firebase/config';
import { appCheckHeader } from './appCheckHeader';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget backup of Firestore → Google Sheets, debounced so rapid
 * consecutive saves trigger one push. Sheets are a backup/reporting mirror —
 * Firestore stays the source of truth, so failures are only logged.
 */
export const triggerSheetsBackup = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        console.warn('Sheets backup skipped: user not authenticated');
        return;
      }
      await fetch(`${BACKEND}/api/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
          ...(await appCheckHeader()),
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? (err as Error).message : String(err);
      console.warn('Sheets backup skipped:', message);
    }
  }, 4000);
};

/**
 * Bulk import: Google Sheets → Firestore. Requires admin/internal role.
 * Returns the response JSON with { success, campaignsImported, postsImported }.
 */
export const bulkImportFromSheets = async (): Promise<{
  success: boolean;
  campaignsImported: number;
  postsImported: number;
}> => {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not authenticated.');

  const response = await fetch(`${BACKEND}/api/sync/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
      ...(await appCheckHeader()),
    },
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Server error during import');
  }
  return data;
};
