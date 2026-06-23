import { auth } from '../firebase/config';
import { appCheckHeader } from './appCheckHeader';
import type { EventData } from '../types';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

async function token(): Promise<string> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not authenticated.');
  return t;
}

async function call<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND}/api/events${path}`, {
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

export const eventsApi = {
  list: (cursor?: string | null) => 
    call<{ events: EventData[], nextCursor: string | null }>(
      `/${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
    ),
  create: (data: Partial<EventData>) => call<{ id: string }>('/', { method: 'POST', body: JSON.stringify(data) }).then(r => r.id),
  update: (id: string, data: Partial<EventData>) => call(`/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => call(`/${id}`, { method: 'DELETE' }),
};
