import { auth } from '../firebase/config';
import { appCheckHeader } from '../services/appCheckHeader';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

/**
 * Append an entry to the global activities feed via the backend API.
 *
 * Direct client writes to /activities are blocked by firestore.rules
 * (`allow create: if false` — CODE_AUDIT_2026-07-04 §S1), so this MUST go
 * through POST /api/activities. The `user` and `role` arguments are kept for
 * call-site compatibility but are intentionally NOT sent — the server derives
 * both from the verified ID token (they were spoofable from the client).
 *
 * Fire-and-forget: activity logging must never break the action it records.
 */
export const logActivity = async (
  _user: string,
  _role: string,
  type: 'campaign' | 'task' | 'comment' | 'approval' | 'media',
  action: string,
  target: string,
  targetId: string,
  text?: string
) => {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const res = await fetch(`${BACKEND}/api/activities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(await appCheckHeader()),
      },
      body: JSON.stringify({ type, action, target, targetId, text: text || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('Failed to log activity:', data.error || `HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
};
