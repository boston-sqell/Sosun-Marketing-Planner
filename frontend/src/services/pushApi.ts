import { auth } from '../firebase/config';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

async function token(): Promise<string> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not authenticated.');
  return t;
}

async function call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND}/api/push${path}`, {
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

export interface BroadcastPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface PushStats {
  subscriberCount: number;
  pushReady: boolean;
}

export interface SendResult {
  sent: number;
  failed: number;
  staleRemoved: number;
}

export const pushApi = {
  /** Fetch the server's VAPID public key. */
  getVapidPublicKey: () =>
    call<{ publicKey: string }>('/vapid-public-key').then((r) => r.publicKey),

  /** Register a new push subscription for the current user. */
  subscribe: (
    subscription: PushSubscriptionJSON,
    meta?: { platform?: string; userAgent?: string; timezone?: string }
  ) =>
    call<{ subscriptionId: string }>('/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription, ...meta }),
    }),

  /** Remove a push subscription by endpoint. */
  unsubscribe: (endpoint: string) =>
    call<{ removed: boolean }>('/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),

  /** Broadcast a manual message to all subscribed users (Admin). */
  broadcast: (payload: BroadcastPayload) =>
    call<SendResult>('/broadcast', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Notify users when a task is assigned. */
  notifyTaskAssignment: (taskId: string, title: string, assignedTo: string, action: 'Assigned' | 'Reassigned' = 'Assigned') =>
    call<{ success: boolean }>('/notify-task', {
      method: 'POST',
      body: JSON.stringify({ taskId, title, assignedTo, action }),
    }),

  /** Admin: send a test notification to the current user only. */
  testPush: () =>
    call<SendResult & { success: boolean }>('/test', { method: 'POST' }),

  /** Admin: get subscriber count and push readiness. */
  getStats: () => call<PushStats & { success: boolean }>('/stats').then((r) => ({
    subscriberCount: r.subscriberCount,
    pushReady: r.pushReady,
  })),
};
