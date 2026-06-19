const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget backup of Firestore → Google Sheets, debounced so rapid
 * consecutive saves trigger one push. Sheets are a backup/reporting mirror —
 * Firestore stays the source of truth, so failures are only logged.
 */
export const triggerSheetsBackup = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    fetch(`${BACKEND}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(err => console.warn('Sheets backup skipped:', err?.message));
  }, 4000);
};
