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
  approval?: PlannerApprovalState | null;
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

export interface PlannerApprovalDecision {
  uid: string;
  decision: 'approve' | 'reject';
  comment?: string;
  ts: string;
  stageIndex: number;
}

export interface PlannerApprovalState {
  chainId: string;
  stageIndex: number;
  decisions: PlannerApprovalDecision[];
  state: 'pending' | 'approved' | 'rejected';
}

export interface PlannerActivityEntry {
  id: string;
  ts: string;
  actorUid: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface PlannerWorkflowStatus {
  id: string;
  name: string;
  category: 'todo' | 'in_progress' | 'done';
  color: string;
}

export interface PlannerWorkflow {
  id: string;
  name: string;
  statuses: PlannerWorkflowStatus[];
  initialStatus: string;
}

export interface PlannerWorkItemType {
  id: string;
  name: string;
  icon?: string;
  workflowId: string;
  fieldIds?: string[];
  archived?: boolean;
}

export interface PlannerCustomField {
  id: string;
  label: string;
  type: string;
  options?: unknown[];
  archived?: boolean;
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

/** Calls the planner API. `path` is relative to /api/planner (e.g. "/items/123"). */
async function call<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND}/api/planner${path}`, {
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
    return call<{ items: PlannerWorkItem[]; nextCursor: string | null }>(`/items/${suffix}`);
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

  get: (id: string) => call<{ item: PlannerWorkItem }>(`/items/${id}`).then((r) => r.item),

  myWork: () =>
    call<{ assigned: PlannerWorkItem[]; awaitingApproval: PlannerWorkItem[] }>('/items/my-work'),

  create: (input: CreatePlannerItemInput) =>
    call<{ item: PlannerWorkItem }>('/items/', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.item),

  update: (id: string, patch: Partial<PlannerWorkItem>) =>
    call<{ success: boolean }>(`/items/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),

  remove: (id: string) => call<{ success: boolean }>(`/items/${id}`, { method: 'DELETE' }),

  transitions: (id: string) =>
    call<{ transitions: PlannerTransition[] }>(`/items/${id}/transitions`).then((r) => r.transitions),

  /** Fire a transition. Throws an ApiError with `.details` on validator failure. */
  transition: (id: string, transitionId: string) =>
    call<{ status: string }>(`/items/${id}/transition`, { method: 'POST', body: JSON.stringify({ transitionId }) }),

  activity: (id: string) =>
    call<{ activity: PlannerActivityEntry[] }>(`/items/${id}/activity`).then((r) => r.activity),

  /** Submit an approval decision. Throws ApiError (403 not_an_approver,
   *  422 reject_comment_required, 409 already_decided, …) on failure. */
  decide: (id: string, decision: 'approve' | 'reject', comment?: string) =>
    call<{ resolution: string; approval: PlannerApprovalState }>(`/items/${id}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment }),
    }),

  // ── Config (read-only) ──────────────────────────────────────────────────────
  config: {
    workflows: () => call<{ workflows: PlannerWorkflow[] }>('/config/workflows').then((r) => r.workflows),
    workflow: (id: string) => call<{ workflow: PlannerWorkflow }>(`/config/workflows/${id}`).then((r) => r.workflow),
    types: () => call<{ types: PlannerWorkItemType[] }>('/config/types').then((r) => r.types),
    fields: () => call<{ fields: PlannerCustomField[] }>('/config/fields').then((r) => r.fields),
  },
};

// ── Status display helpers (config-driven) ────────────────────────────────────

/** Turn a status/label id ("in_progress") into a display label ("In Progress"). */
export const prettyStatus = (s: string) =>
  s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Build a lookup: workflowId → statusId → {name,color}, from a list of workflows. */
export function buildStatusIndex(workflows: PlannerWorkflow[]): Map<string, Map<string, PlannerWorkflowStatus>> {
  const index = new Map<string, Map<string, PlannerWorkflowStatus>>();
  for (const wf of workflows) {
    const inner = new Map<string, PlannerWorkflowStatus>();
    for (const s of wf.statuses) inner.set(s.id, s);
    index.set(wf.id, inner);
  }
  return index;
}
