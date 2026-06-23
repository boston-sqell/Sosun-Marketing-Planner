import { auth } from '../firebase/config';
import { appCheckHeader } from './appCheckHeader';
import type { BudgetEntry } from '../types';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

async function token(): Promise<string> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not authenticated.');
  return t;
}

async function call<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND}/api/budget${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await token()}`,
      ...(await appCheckHeader()),
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const budgetApi = {
  list: (cursor?: string | null, campaignId?: string) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (campaignId) params.set('campaignId', campaignId);
    const qs = params.toString();
    return call<{ entries: BudgetEntry[], nextCursor: string | null }>(`/${qs ? `?${qs}` : ''}`);
  },
  create: (data: Partial<BudgetEntry>) => call<{ id: string }>('/', { method: 'POST', body: JSON.stringify(data) }).then(r => r.id),
  update: (id: string, data: Partial<BudgetEntry>) => call(`/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => call(`/${id}`, { method: 'DELETE' }),
};
