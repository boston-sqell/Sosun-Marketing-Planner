import { auth } from '../firebase/config';
import { appCheckHeader } from './appCheckHeader';
import type { TaskData, CommentItem } from '../types';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

async function token(): Promise<string> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not authenticated.');
  return t;
}

async function call<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND}/api/tasks${path}`, {
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

type ListParams = { sort?: string; direction?: string; brand?: string; phase?: string; cursor?: string | null };

export const tasksApi = {
  list: (params: ListParams = {}) => {
    const q = new URLSearchParams();
    if (params.sort) q.set('sort', params.sort);
    if (params.direction) q.set('direction', params.direction);
    if (params.brand) q.set('brand', params.brand);
    if (params.phase) q.set('phase', params.phase);
    if (params.cursor) q.set('cursor', params.cursor);

    const suffix = q.toString() ? `?${q.toString()}` : '';
    return call<{ tasks: TaskData[], nextCursor: string | null }>(`/${suffix}`);
  },
  /**
   * Loads every page by following the server cursor. The UI filters, sorts, and
   * computes stats client-side, so it needs the full permitted list — a single
   * page (limited + RBAC-filtered server-side) would silently drop data.
   */
  listAll: async (params: ListParams = {}): Promise<{ tasks: TaskData[] }> => {
    const tasks: TaskData[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 200; page++) { // hard cap guards against a cursor bug
      const res = await tasksApi.list({ ...params, cursor });
      tasks.push(...res.tasks);
      cursor = res.nextCursor;
      if (!cursor) return { tasks };
    }
    console.warn('tasksApi.listAll hit the 200-page cap; some tasks may be omitted.');
    return { tasks };
  },
  get: (id: string) => call<{ task: TaskData }>(`/${id}`).then(r => r.task),
  create: (task: Partial<TaskData>) => call<{ id: string }>('/', {
    method: 'POST',
    body: JSON.stringify(task),
  }).then(r => r.id),
  update: (id: string, patch: Partial<TaskData>) => call<{ success: boolean }>(`/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  }),
  delete: (id: string) => call<{ success: boolean }>(`/${id}`, {
    method: 'DELETE',
  }),
  addComment: (id: string, text: string, internalOnly?: boolean) => call<{ comment: CommentItem }>(`/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text, internalOnly }),
  }).then(r => r.comment),
  updateComment: (id: string, commentId: string, text: string) => call<{ success: boolean }>(`/${id}/comments/${commentId}`, {
    method: 'PUT',
    body: JSON.stringify({ text }),
  }),
};
