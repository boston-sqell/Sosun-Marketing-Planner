import { google, drive_v3 } from 'googleapis';

/**
 * Google Drive service for the Sosun Marketing Planner DAM.
 *
 * Design notes:
 * - Authenticates with the SAME service account used by sheets.ts, but with
 *   the Drive scope. Drive is the authoritative store; Firestore only indexes.
 * - Every call passes supportsAllDrives/includeItemsFromAllDrives so the exact
 *   same code works whether the configured root lives in My Drive or a Shared
 *   Drive. Migrating the workspace later is purely a settings change.
 * - The workspace boundary is enforced in `assertWithinRoot()`: no file or
 *   folder outside the configured root may ever be read or mutated.
 */

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Marks every folder/file the app creates so we can re-discover and validate
// ownership without relying on fragile name matching.
export const APP_TAG_KEY = 'sosunWorkspace';
export const APP_TAG_VALUE = 'true';

// Default structure — overridable via the workspace settings doc.
export const DEFAULT_TOP_LEVEL_FOLDERS = [
  'Campaigns',
  'Brand Assets',
  'Templates',
  'Agency Uploads',
  'Events',
  'Archive',
];

export const DEFAULT_CAMPAIGN_TEMPLATE = [
  'Briefs',
  'Creative',
  'Photos',
  'Videos',
  'Social Media',
  'Print',
  'Approved Assets',
  'Archive',
];

export const FILE_FIELDS =
  'id, name, mimeType, size, trashed, thumbnailLink, webViewLink, webContentLink, iconLink, ' +
  'createdTime, modifiedTime, parents, appProperties, fileExtension, ' +
  'imageMediaMetadata(width,height), videoMediaMetadata(durationMillis,width,height)';

let authClient: any = null;

export function getDriveAuth(): any {
  if (authClient) return authClient;

  // Preferred: OAuth user delegation. Files are owned by a real Google user
  // (with normal Drive storage quota), not the service account (which has zero
  // Drive quota and therefore cannot store file bytes). The refresh token's
  // granted scope (drive.file) governs access — the app sees only what it creates.
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    authClient = oauth2;
    console.log('Drive service initialized with OAuth user delegation.');
    return authClient;
  }

  // Fallback: service-account JWT (note: SA has no Drive storage quota — uploads
  // will fail with storageQuotaExceeded; use OAuth delegation above for uploads).
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (email && privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
    authClient = new google.auth.JWT(email, undefined, privateKey, [DRIVE_SCOPE]);
    console.log('Drive service initialized with service account.');
    return authClient;
  }

  // Last resort: Application Default Credentials (Cloud Run runtime SA — also
  // quota-less for Drive file storage).
  console.log('Drive service falling back to Application Default Credentials.');
  authClient = new google.auth.GoogleAuth({ scopes: [DRIVE_SCOPE] });
  return authClient;
}

let driveClient: drive_v3.Drive | null = null;
function drive(): drive_v3.Drive {
  if (!driveClient) {
    driveClient = google.drive({ version: 'v3', auth: getDriveAuth() });
  }
  return driveClient;
}

/** Returns a raw OAuth access token for the service account (used for byte streaming). */
export async function getAccessToken(): Promise<string> {
  const client = getDriveAuth();
  if (typeof client.getAccessToken === 'function') {
    const res = await client.getAccessToken();
    const token = typeof res === 'string' ? res : res?.token;
    if (token) return token;
  }
  // GoogleAuth path
  const c = await client.getClient?.();
  const t = await c?.getAccessToken?.();
  if (t?.token) return t.token;
  throw new Error('Unable to obtain Drive access token');
}

const ALL_DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const;

/** Escapes a value for use inside a Drive query string. */
function q(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function getFile(fileId: string): Promise<drive_v3.Schema$File> {
  const res = await drive().files.get({ fileId, fields: FILE_FIELDS, supportsAllDrives: true });
  return res.data;
}

export async function listChildren(folderId: string): Promise<drive_v3.Schema$File[]> {
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive().files.list({
      q: `'${q(folderId)}' in parents and trashed = false`,
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      pageSize: 200,
      orderBy: 'folder,name',
      pageToken,
      ...ALL_DRIVES,
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return files;
}

/** Finds a direct child folder by name within a parent, or null. */
async function findChildFolder(name: string, parentId: string): Promise<drive_v3.Schema$File | null> {
  const res = await drive().files.list({
    q: `'${q(parentId)}' in parents and name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    pageSize: 1,
    ...ALL_DRIVES,
  });
  return res.data.files?.[0] || null;
}

/**
 * Idempotently ensures a folder named `name` exists under `parentId`.
 * Reuses an existing folder (so manually-created or re-linked folders are not
 * duplicated) and stamps app-created ones with appProperties.
 */
export async function ensureFolder(
  name: string,
  parentId: string,
  appProperties: Record<string, string> = {}
): Promise<drive_v3.Schema$File> {
  const existing = await findChildFolder(name, parentId);
  if (existing) return existing;

  const res = await drive().files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
      appProperties: { [APP_TAG_KEY]: APP_TAG_VALUE, ...appProperties },
    },
    fields: 'id, name, webViewLink',
    ...ALL_DRIVES,
  });
  return res.data;
}

/**
 * Creates a fresh app-owned root folder in the delegated user's My Drive
 * (no parent → Drive root). Required under the drive.file scope, where the app
 * can only access files it creates — so it cannot adopt a pre-existing folder.
 */
export async function createWorkspaceRoot(name: string): Promise<drive_v3.Schema$File> {
  const res = await drive().files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      appProperties: { [APP_TAG_KEY]: APP_TAG_VALUE, kind: 'root' },
    },
    fields: 'id, name, webViewLink',
    ...ALL_DRIVES,
  });
  return res.data;
}

export async function renameFile(fileId: string, name: string): Promise<drive_v3.Schema$File> {
  const res = await drive().files.update({
    fileId,
    requestBody: { name },
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return res.data;
}

export async function moveFile(fileId: string, newParentId: string): Promise<drive_v3.Schema$File> {
  const current = await drive().files.get({ fileId, fields: 'parents', supportsAllDrives: true });
  const previousParents = (current.data.parents || []).join(',');
  const res = await drive().files.update({
    fileId,
    addParents: newParentId,
    removeParents: previousParents,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return res.data;
}

/** Trashes (soft-deletes) a file. We never hard-delete from Drive. */
export async function trashFile(fileId: string): Promise<void> {
  await drive().files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
}

/**
 * Walks the parent chain from `fileId` upward. Returns true iff `rootId` is an
 * ancestor (or the node itself). This is the workspace boundary check — no
 * client-supplied id is trusted without it. Results are cached per process.
 */
// Positive-only, time-bounded ancestry cache. We cache ONLY successful
// "within root" results and only for a short window: caching negatives would
// keep a file denied after it is moved INTO the workspace, and caching forever
// would keep a file allowed after it is moved OUT (stale authorization). The
// TTL bounds both the staleness window and the map's memory growth.
const ANCESTRY_TTL_MS = 5 * 60 * 1000;
const ancestryCache = new Map<string, number>(); // cacheKey -> expiry epoch ms
export async function isWithinRoot(fileId: string, rootId: string): Promise<boolean> {
  if (fileId === rootId) return true;
  const cacheKey = `${rootId}:${fileId}`;
  const cachedExp = ancestryCache.get(cacheKey);
  if (cachedExp !== undefined) {
    if (cachedExp > Date.now()) return true; // fresh positive hit
    ancestryCache.delete(cacheKey); // expired — re-verify below
  }

  const visited = new Set<string>();
  let frontier = [fileId];
  let found = false;

  // Bounded walk (depth guard against cycles / very deep trees).
  for (let depth = 0; depth < 50 && frontier.length > 0 && !found; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      if (id === rootId) {
        found = true;
        break;
      }
      const res = await drive().files.get({ fileId: id, fields: 'parents', supportsAllDrives: true });
      for (const p of res.data.parents || []) {
        if (p === rootId) {
          found = true;
          break;
        }
        next.push(p);
      }
    }
    frontier = next;
  }

  if (found) ancestryCache.set(cacheKey, Date.now() + ANCESTRY_TTL_MS);
  return found;
}

/** Throws if the target is outside the workspace root. */
export async function assertWithinRoot(fileId: string, rootId: string): Promise<void> {
  if (!rootId) throw new Error('Workspace root folder is not configured.');
  const ok = await isWithinRoot(fileId, rootId);
  if (!ok) {
    const err: any = new Error('Access denied: target is outside the application workspace.');
    err.status = 403;
    throw err;
  }
}

/**
 * Initiates a resumable upload session and returns the session URL. The browser
 * PUTs the file bytes directly to this URL, so large media never streams through
 * Cloud Run. The session URL itself authorizes the upload (no token needed by
 * the client).
 */
export async function createResumableUploadSession(opts: {
  name: string;
  mimeType: string;
  parentId: string;
  appProperties?: Record<string, string>;
}): Promise<string> {
  const token = await getAccessToken();
  const url =
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': opts.mimeType || 'application/octet-stream',
    },
    body: JSON.stringify({
      name: opts.name,
      parents: [opts.parentId],
      appProperties: { [APP_TAG_KEY]: APP_TAG_VALUE, ...(opts.appProperties || {}) },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to start upload session (${res.status}): ${text}`);
  }
  const location = res.headers.get('location');
  if (!location) throw new Error('Drive did not return an upload session URL.');
  return location;
}

/** Streams a file's bytes (alt=media). Used for download and image preview. */
export async function getContentStream(fileId: string) {
  const res = await drive().files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  return res.data as NodeJS.ReadableStream;
}

/**
 * Fetches a file's bytes with optional HTTP Range passthrough. Returns the raw
 * fetch Response so the route can stream it (206 + Content-Range) without ever
 * buffering the whole file — this is what keeps large-video downloads/preview
 * from exhausting Cloud Run memory and enables seeking in the browser player.
 */
export async function driveMediaFetch(fileId: string, rangeHeader?: string): Promise<Response> {
  const token = await getAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (rangeHeader) headers.Range = rangeHeader;
  return fetch(url, { headers });
}

/* -------------------------------- Revisions -------------------------------- */

/**
 * Starts a resumable session that PATCHes an EXISTING file — uploading bytes to
 * it creates a new Drive revision (native byte-level history on one file id),
 * as opposed to the new-file-per-version model.
 */
export async function createResumableUpdateSession(fileId: string, mimeType: string): Promise<string> {
  const token = await getAccessToken();
  const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=resumable&supportsAllDrives=true&fields=id`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType || 'application/octet-stream',
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to start revision session (${res.status}): ${text}`);
  }
  const location = res.headers.get('location');
  if (!location) throw new Error('Drive did not return a revision upload session URL.');
  return location;
}

// Note: the Drive v3 `revisions` resource does NOT accept supportsAllDrives — it's
// not a valid parameter there (Shared Drives keep only limited revision history and
// expose it differently). So these two typed calls intentionally omit it; only the
// raw revision-media fetch below carries supportsAllDrives in its URL.
export async function listRevisions(fileId: string): Promise<drive_v3.Schema$Revision[]> {
  const res: { data: drive_v3.Schema$RevisionList } = await drive().revisions.list({
    fileId,
    pageSize: 200,
    fields: 'revisions(id, modifiedTime, size, keepForever, mimeType, lastModifyingUser(displayName))',
  });
  return res.data.revisions || [];
}

/** Pins/unpins a revision so Drive never auto-prunes it (e.g. the approved one). */
export async function setRevisionKeepForever(fileId: string, revisionId: string, keepForever: boolean): Promise<void> {
  await drive().revisions.update({ fileId, revisionId, requestBody: { keepForever } });
}

/** Streams a specific revision's bytes, with Range passthrough. */
export async function driveRevisionFetch(fileId: string, revisionId: string, rangeHeader?: string): Promise<Response> {
  const token = await getAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media&supportsAllDrives=true`;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (rangeHeader) headers.Range = rangeHeader;
  return fetch(url, { headers });
}

/* --------------------------------- Sharing --------------------------------- */

/** Grants anyone-with-link read access (opt-in public delivery). Returns fresh metadata. */
export async function shareAnyone(fileId: string): Promise<drive_v3.Schema$File> {
  await drive().permissions.create({
    fileId,
    requestBody: { type: 'anyone', role: 'reader' },
    supportsAllDrives: true,
  });
  return getFile(fileId);
}

/** Revokes any anyone-with-link permissions on the file. */
export async function unshareAnyone(fileId: string): Promise<void> {
  const res: { data: drive_v3.Schema$PermissionList } = await drive().permissions.list({
    fileId,
    fields: 'permissions(id, type)',
    supportsAllDrives: true,
  });
  for (const p of res.data.permissions || []) {
    if (p.type === 'anyone' && p.id) {
      await drive().permissions.delete({ fileId, permissionId: p.id, supportsAllDrives: true });
    }
  }
}

/* ------------------------------ Change tracking ----------------------------- */

/** Returns a Drive change-feed start token to record for future incremental syncs. */
export async function getStartPageToken(): Promise<string> {
  const res: { data: drive_v3.Schema$StartPageToken } = await drive().changes.getStartPageToken({
    supportsAllDrives: true,
  });
  return res.data.startPageToken || '';
}

export interface DriveChange {
  fileId: string;
  removed: boolean;
  file?: drive_v3.Schema$File;
}

/** Lists all changes since `pageToken`, following pagination. */
export async function listChanges(
  pageToken: string
): Promise<{ changes: DriveChange[]; newStartPageToken: string }> {
  const changes: DriveChange[] = [];
  let token: string | undefined = pageToken;
  let newStartPageToken = pageToken;

  while (token) {
    const res: { data: drive_v3.Schema$ChangeList } = await drive().changes.list({
      pageToken: token,
      spaces: 'drive',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 200,
      fields: 'newStartPageToken, nextPageToken, changes(fileId, removed, file(id, name, mimeType, size, trashed, modifiedTime, webViewLink, parents))',
    });
    for (const c of res.data.changes || []) {
      changes.push({ fileId: c.fileId!, removed: !!c.removed, file: c.file || undefined });
    }
    if (res.data.nextPageToken) {
      token = res.data.nextPageToken;
    } else {
      newStartPageToken = res.data.newStartPageToken || token;
      token = undefined;
    }
  }
  return { changes, newStartPageToken };
}

/**
 * Fetches a Drive thumbnail. thumbnailLink requires the owner's credentials and
 * is short-lived, so we proxy it server-side rather than exposing it to clients.
 */
export async function fetchThumbnail(thumbnailLink: string): Promise<Response> {
  const token = await getAccessToken();
  return fetch(thumbnailLink, { headers: { Authorization: `Bearer ${token}` } });
}
