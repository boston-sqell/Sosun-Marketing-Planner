import { auth } from '../firebase/config';
import { appCheckHeader } from './appCheckHeader';
import type { CampaignData } from '../types';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

async function token(): Promise<string> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not authenticated.');
  return t;
}

async function call<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND}/api/campaigns${path}`, {
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

export const campaignsApi = {
  list: (cursor?: string | null) =>
    call<{ campaigns: CampaignData[], nextCursor: string | null }>(
      `/${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
    ),
  /**
   * Loads every page by following the server cursor. The UI filters and computes
   * stats client-side, so it needs the full list rather than the first page.
   */
  listAll: async (): Promise<{ campaigns: CampaignData[] }> => {
    const campaigns: CampaignData[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 200; page++) { // hard cap guards against a cursor bug
      const res = await campaignsApi.list(cursor);
      campaigns.push(...res.campaigns);
      cursor = res.nextCursor;
      if (!cursor) return { campaigns };
    }
    console.warn('campaignsApi.listAll hit the 200-page cap; some campaigns may be omitted.');
    return { campaigns };
  },
  get: (id: string) => call<{ campaign: CampaignData }>(`/${id}`).then(r => r.campaign),
  create: (data: Partial<CampaignData>) => call<{ id: string }>('/', { method: 'POST', body: JSON.stringify(data) }).then(r => r.id),
  update: (id: string, data: Partial<CampaignData>) => call(`/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => call(`/${id}`, { method: 'DELETE' }),
};
