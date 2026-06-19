import { auth } from '../firebase/config';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export interface AppConfig {
  brands: string[];
  platforms: string[];
}

async function token(): Promise<string> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not authenticated.');
  return t;
}

async function call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND}/api/config${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await token()}`,
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const configApi = {
  /** Current brands/platforms (falls back to defaults server-side). */
  get: () => call<{ config: AppConfig }>('/').then((r) => r.config),
  /** Admin-only: persist brands/platforms to Firestore + mirror to the CONFIG sheet. */
  save: (config: Partial<AppConfig>) =>
    call<{ config: AppConfig; sheetSynced: boolean; sheetError?: string }>('/', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
};
