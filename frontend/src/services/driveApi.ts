import { auth } from '../firebase/config';
import type { MediaAsset, WorkspaceConfig, DriveFolderRef, ActivityEntry, MediaMetrics, DriveRevision } from '../types';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

async function token(): Promise<string> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not authenticated.');
  return t;
}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND}/api/drive${path}`, {
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

/** Fetches an authed binary endpoint and returns an object URL (caller revokes). */
export async function getBlobUrl(path: string): Promise<string> {
  const res = await fetch(`${BACKEND}/api/drive${path}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`Failed to load (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

// Session-wide media token cache. Lets <img>/<video>/<a> stream directly from the
// backend (which streams from Drive with Range support) — no whole-file blobs.
let _mediaToken = { token: '', exp: 0 };
async function ensureMediaToken(): Promise<string> {
  if (_mediaToken.token && _mediaToken.exp - 60_000 > Date.now()) return _mediaToken.token;
  const r = await api<{ token: string; expiresInMs: number }>('/media-token');
  _mediaToken = { token: r.token, exp: Date.now() + r.expiresInMs };
  return r.token;
}

function buildContentUrl(id: string, tok: string, opts?: { download?: boolean; name?: string }): string {
  const p = new URLSearchParams({ token: tok });
  if (opts?.download) { p.set('download', '1'); if (opts.name) p.set('name', opts.name); }
  return `${BACKEND}/api/drive/files/${id}/content?${p.toString()}`;
}
function buildThumbUrl(id: string, tok: string): string {
  return `${BACKEND}/api/drive/files/${id}/thumbnail?token=${encodeURIComponent(tok)}`;
}

/**
 * Uploads a file to a resumable session URL in chunks, with per-chunk retry.
 * Chunked + resumable means a flaky connection retries only the failed chunk,
 * not the whole multi-GB file. Returns the new Drive file id.
 */
const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB (must be a multiple of 256 KB)
const MAX_RETRIES = 4;

async function uploadResumable(
  file: File,
  uploadUrl: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const total = file.size;
  const mime = file.type || 'application/octet-stream';

  const putChunk = (blob: Blob, start: number, end: number) =>
    new Promise<{ done: boolean; fileId?: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', mime);
      if (total > 0) xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${total}`);
      else xhr.setRequestHeader('Content-Range', `bytes */0`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress && total > 0) {
          onProgress(Math.min(100, Math.round(((start + e.loaded) / total) * 100)));
        }
      };
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 201) {
          try { resolve({ done: true, fileId: JSON.parse(xhr.responseText).id }); }
          catch { reject(new Error('Upload completed but response was unreadable.')); }
        } else if (xhr.status === 308) {
          resolve({ done: false }); // chunk accepted, continue
        } else {
          reject(new Error(`Upload chunk failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload.'));
      xhr.send(blob);
    });

  if (total === 0) {
    const r = await putChunk(file, 0, 0);
    if (r.fileId) return r.fileId;
    throw new Error('Empty upload did not finalize.');
  }

  let start = 0;
  while (start < total) {
    const end = Math.min(start + CHUNK_SIZE, total);
    const blob = file.slice(start, end);
    let attempt = 0;
    // Retry just this chunk on transient failures.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const r = await putChunk(blob, start, end);
        if (r.done && r.fileId) return r.fileId;
        start = end;
        break;
      } catch (e) {
        if (++attempt >= MAX_RETRIES) throw e;
        await new Promise((res) => setTimeout(res, 500 * attempt));
      }
    }
  }
  throw new Error('Upload finished without a file id.');
}

export const driveApi = {
  /* Workspace */
  getWorkspace: () => api<{ workspace: WorkspaceConfig }>('/workspace').then((r) => r.workspace),
  saveWorkspace: (body: {
    rootFolder?: string;
    topLevelFolders?: string[];
    campaignTemplate?: string[];
  }) =>
    api<{ workspace: WorkspaceConfig }>('/workspace', {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((r) => r.workspace),
  // drive.file scope: the app creates its own root folder in the user's Drive
  // (it can't adopt a pre-existing folder it didn't create).
  createWorkspace: (rootFolderName = 'Marketing Assets') =>
    api<{ workspace: WorkspaceConfig }>('/workspace', {
      method: 'POST',
      body: JSON.stringify({ createRoot: true, rootFolderName }),
    }).then((r) => r.workspace),
  provisionWorkspace: () =>
    api<{ workspace: WorkspaceConfig }>('/workspace/provision', { method: 'POST' }).then(
      (r) => r.workspace
    ),

  /* Campaigns */
  provisionCampaign: (campaignId: string) =>
    api<{ driveFolders: DriveFolderRef }>(`/campaigns/${campaignId}/provision`, {
      method: 'POST',
    }).then((r) => r.driveFolders),

  /* Browsing */
  listFolder: (folderId: string) => api<{ files: any[] }>(`/folders/${folderId}/children`).then((r) => r.files),
  createFolder: (name: string, parentId?: string) =>
    api('/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) }),

  /* Assets */
  listAssets: (filters: { campaignId?: string; fileType?: string; status?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v) as [string, string][]
    ).toString();
    return api<{ assets: MediaAsset[] }>(`/assets${qs ? `?${qs}` : ''}`).then((r) => r.assets);
  },
  recordAsset: (body: Record<string, any>) =>
    api<{ asset: MediaAsset }>('/assets', { method: 'POST', body: JSON.stringify(body) }).then(
      (r) => r.asset
    ),
  updateAsset: (id: string, patch: Record<string, any>) =>
    api<{ asset: MediaAsset }>(`/assets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then(
      (r) => r.asset
    ),
  deleteAsset: (id: string) => api(`/assets/${id}`, { method: 'DELETE' }),

  /* Linking & import */
  linkAsset: (body: { fileOrUrl: string; campaignId?: string; tags?: string[]; status?: string }) =>
    api<{ asset: MediaAsset }>('/assets/link', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.asset),
  importFolder: (body: { folderOrUrl: string; campaignId?: string }) =>
    api<{ imported: number }>('/import/folder', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.imported),

  /* Versions, comments, activity */
  addVersion: (baseId: string, fileId: string, versionLabel?: string) =>
    api<{ asset: MediaAsset }>(`/assets/${baseId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ fileId, versionLabel }),
    }).then((r) => r.asset),
  addComment: (id: string, text: string) =>
    api(`/assets/${id}/comments`, { method: 'POST', body: JSON.stringify({ text }) }),
  getActivity: (id: string) =>
    api<{ activity: ActivityEntry[] }>(`/assets/${id}/activity`).then((r) => r.activity),

  /* Sync & metrics */
  sync: () => api<{ updated: number; removed: number; mode: string }>('/sync', { method: 'POST' }),
  getMetrics: () => api<{ metrics: MediaMetrics }>('/metrics').then((r) => r.metrics),

  /* Native Drive revisions */
  listRevisions: (id: string) =>
    api<{ revisions: DriveRevision[] }>(`/assets/${id}/revisions`).then((r) => r.revisions),
  setRevisionKeep: (id: string, revId: string, keepForever: boolean) =>
    api(`/assets/${id}/revisions/${revId}`, { method: 'PATCH', body: JSON.stringify({ keepForever }) }),
  revisionContentUrl: (id: string, revId: string, tok: string, name?: string) => {
    const p = new URLSearchParams({ token: tok, download: '1' });
    if (name) p.set('name', name);
    return `${BACKEND}/api/drive/files/${id}/revisions/${revId}/content?${p.toString()}`;
  },
  /** Uploads a new revision onto the existing file id (chunked) and refreshes the index. */
  async uploadRevision(asset: MediaAsset, file: File, onProgress?: (pct: number) => void): Promise<MediaAsset> {
    const { uploadUrl } = await api<{ uploadUrl: string }>(`/assets/${asset.id}/revision-session`, {
      method: 'POST',
      body: JSON.stringify({ mimeType: file.type || 'application/octet-stream' }),
    });
    await uploadResumable(file, uploadUrl, onProgress);
    return api<{ asset: MediaAsset }>(`/assets/${asset.id}/revision-complete`, { method: 'POST' }).then((r) => r.asset);
  },

  /* Public-link delivery */
  shareAsset: (id: string) =>
    api<{ publicViewUrl: string; webContentLink: string | null }>(`/assets/${id}/share`, { method: 'POST' }),
  unshareAsset: (id: string) => api(`/assets/${id}/share`, { method: 'DELETE' }),

  /* Streaming media URLs (token-based; safe for <img>/<video>/<a>). */
  ensureMediaToken,
  thumbUrl: (id: string, tok: string) => buildThumbUrl(id, tok),
  contentUrl: (id: string, tok: string, opts?: { download?: boolean; name?: string }) =>
    buildContentUrl(id, tok, opts),

  /**
   * Uploads raw bytes: starts a resumable session via the backend, then uploads
   * the bytes straight to Google in chunks (with retry). Returns the new file id.
   */
  async uploadBytes(
    file: File,
    opts: { folderId: string; campaignId?: string; onProgress?: (pct: number) => void }
  ): Promise<string> {
    const { uploadUrl } = await api<{ uploadUrl: string }>('/upload-session', {
      method: 'POST',
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        folderId: opts.folderId,
        campaignId: opts.campaignId,
      }),
    });
    return uploadResumable(file, uploadUrl, opts.onProgress);
  },

  /** Uploads a file and records it as a new asset. */
  async uploadFile(
    file: File,
    opts: { folderId: string; campaignId?: string; onProgress?: (pct: number) => void }
  ): Promise<MediaAsset> {
    const fileId = await this.uploadBytes(file, opts);
    return this.recordAsset({ fileId, campaignId: opts.campaignId });
  },
};
