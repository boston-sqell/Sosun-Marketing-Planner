import { auth } from '../firebase/config';
import { appCheckHeader } from './appCheckHeader';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

// ── Types (co-located with the planner API; mirrors backend lib/planner/types) ─

export type PlannerPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface PlannerWorkItem {
  id: string;
  typeId: string;
  workflowId: string;
  title: string;
  description?: string;
  spaceId: string;
  brandIds?: string[];
  status: string;
  assigneeUids?: string[];
  reporterUid?: string;
  priority?: PlannerPriority;
  labels?: string[];
  fields?: Record<string, unknown>;
  parentId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  locked?: boolean;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
}

export interface PlannerTransition {
  id: string;
  name: string;
  to: string;
}

export interface PlannerActivityEntry {
  id: string;
  ts: string;
  actorUid: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface CreatePlannerItemInput {
  typeId: string;
  title: string;
  description?: string;
  spaceId: string;
  brandIds?: string[];
  priority?: PlannerPriority;
  dueDate?: string | null;
}

/** Error thrown by the API layer; carries field-level validator details (422). */
export interface ApiError extends Error {
  status?: number;
  details?: Array<{ field?: string; message: string }>;
}

async function token(): Promise<string> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not authenticated.');
  return t;
}

async function call<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND}/api/planner/items${path}`, {
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
    const err: ApiError = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data.details;
    throw err;
  }
  return data as T;
}

type ListParams = { spaceId?: string; status?: string; brandId?: string; cursor?: string | null };

export const plannerApi = {
  list: (params: ListParams = {}) => {
    const q = new URLSearchParams();
    if (params.spaceId) q.set('spaceId', params.spaceId);
    if (params.status) q.set('status', params.status);
    if (params.brandId) q.set('brandId', params.brandId);
    if (params.cursor) q.set('cursor', params.cursor);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return call<{ items: PlannerWorkItem[]; nextCursor: string | null }>(`/${suffix}`);
  },

  /** Follows the server cursor to load every permitted page (the list view
   *  filters/sorts client-side, same as tasksApi.listAll). */
  listAll: async (params: ListParams = {}): Promise<{ items: PlannerWorkItem[] }> => {
    const items: PlannerWorkItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 200; page++) {
      const res: { items: PlannerWorkItem[]; nextCursor: string | null } = await plannerApi.list({ ...params, cursor });
      items.push(...res.items);
      cursor = res.nextCursor;
      if (!cursor) return { items };
    }
    console.warn('plannerApi.listAll hit the 200-page cap; some items may be omitted.');
    return { items };
  },

  get: (id: string) => call<{ item: PlannerWorkItem }>(`/${id}`).then((r) => r.item),

  create: (input: CreatePlannerItemInput) =>
    call<{ item: PlannerWorkItem }>('/', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.item),

  update: (id: string, patch: Partial<PlannerWorkItem>) =>
    call<{ success: boolean }>(`/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),

  remove: (id: string) => call<{ success: boolean }>(`/${id}`, { method: 'DELETE' }),

  transitions: (id: string) =>
    call<{ transitions: PlannerTransition[] }>(`/${id}/transitions`).then((r) => r.transitions),

  /** Fire a transition. Throws an ApiError with `.details` on validator failure. */
  transition: (id: string, transitionId: string) =>
    call<{ status: string }>(`/${id}/transition`, { method: 'POST', body: JSON.stringify({ transitionId }) }),

  activity: (id: string) =>
    call<{ activity: PlannerActivityEntry[] }>(`/${id}/activity`).then((r) => r.activity),
};
