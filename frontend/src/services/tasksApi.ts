import { auth } from '../firebase/config';
import type { TaskData, CommentItem } from '../types';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

async function token(): Promise<string> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not authenticated.');
  return t;
}

async function call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND}/api/tasks${path}`, {
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

export const tasksApi = {
  list: (params: { sort?: string; direction?: string; brand?: string; phase?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.sort) q.set('sort', params.sort);
    if (params.direction) q.set('direction', params.direction);
    if (params.brand) q.set('brand', params.brand);
    if (params.phase) q.set('phase', params.phase);

    const suffix = q.toString() ? `?${q.toString()}` : '';
    return call<{ tasks: TaskData[] }>(`/${suffix}`).then(r => r.tasks);
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
