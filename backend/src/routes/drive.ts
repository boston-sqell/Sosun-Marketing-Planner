import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Readable } from 'stream';
import { db } from '../services/firestore';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import {
  ensureFolder,
  createWorkspaceRoot,
  listChildren,
  getFile,
  assertWithinRoot,
  createResumableUploadSession,
  createResumableUpdateSession,
  driveMediaFetch,
  driveRevisionFetch,
  listRevisions,
  setRevisionKeepForever,
  shareAnyone,
  unshareAnyone,
  fetchThumbnail,
  renameFile,
  moveFile,
  trashFile,
  getStartPageToken,
  listChanges,
  FOLDER_MIME,
} from '../services/drive';
import { getWorkspace, saveWorkspace, extractFolderId, extractFileId, WorkspaceConfig } from '../services/workspace';

const router = Router();

/* ----------------------------- Media access token --------------------------- */
// Short-lived, session-wide token that lets <img>/<video>/<a> tags stream media
// without an Authorization header (which those elements can't send). It only
// proves "an authenticated app user, recently" — the streaming routes still run
// assertWithinRoot, so it never widens access beyond the workspace boundary.

// MEDIA_TOKEN_SECRET is validated at startup in server.ts — it will never be undefined here.
const MEDIA_TOKEN_SECRET = process.env.MEDIA_TOKEN_SECRET as string;
const MEDIA_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour — shorter leak window; the
// client auto-refreshes off the returned expiresInMs, so this is transparent.

// Token format: `${exp}.${uid}.${sig}` where sig = HMAC(`${exp}.${uid}`). Binding
// the uid makes a leaked token attributable to a single user (and lets it be
// revoked/enforced per-user later) rather than an anonymous app-wide pass.
function signMediaToken(uid: string): string {
  const exp = Date.now() + MEDIA_TOKEN_TTL_MS;
  const payload = `${exp}.${uid}`;
  const sig = crypto.createHmac('sha256', MEDIA_TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyMediaToken(token: string): boolean {
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const [expStr, uid, sig] = parts;
  if (!expStr || !uid || !sig) return false;
  const exp = Number(expStr);
  if (!exp || exp < Date.now()) return false;
  const expected = crypto.createHmac('sha256', MEDIA_TOKEN_SECRET).update(`${expStr}.${uid}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Sanitize a user-supplied download filename before putting it in a
// Content-Disposition header: strip quotes, backslashes and control chars so a
// crafted `?name=` can't break out of the quoted-string / inject header bytes.
function safeFilename(name: unknown, fallback: string): string {
  const cleaned = String(name ?? '')
    .replace(/[\r\n"\\]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 255);
  return cleaned || fallback;
}

// Shared secret for Cloud Scheduler (or any cron) to trigger background sync.
// If unset, the cron endpoint returns 401 on every call (safe failure).
// Startup warning is emitted in server.ts.
const CRON_SECRET = process.env.CRON_SECRET || '';

// Accept a media token (query param) ONLY for GET streaming routes, or a cron
// secret for POST /sync/cron; everything else uses Firebase ID-token verification.
const STREAM_PATH = /^\/files\/[^/]+\/(content|thumbnail)$|^\/files\/[^/]+\/revisions\/[^/]+\/content$/;
router.use((req, res, next: NextFunction) => {
  const token = req.query.token;
  if (token && req.method === 'GET' && STREAM_PATH.test(req.path) && verifyMediaToken(String(token))) {
    return next();
  }
  if (req.method === 'POST' && req.path === '/sync/cron') {
    const secret = req.headers['x-cron-secret'];
    if (CRON_SECRET && secret === CRON_SECRET) {
      (req as AuthedRequest).role = 'admin';
      return next();
    }
    return res.status(401).json({ success: false, error: 'Unauthorized cron request.' });
  }
  return requireAuth(req as AuthedRequest, res, next);
});

// Issue a media token to the authenticated client (bound to their uid).
router.get('/media-token', (req: AuthedRequest, res) => {
  res.json({ success: true, token: signMediaToken(req.uid || ''), expiresInMs: MEDIA_TOKEN_TTL_MS });
});

const MEDIA = db.collection('mediaAssets');

type FileType =
  | 'image' | 'video' | 'document' | 'gdoc' | 'gsheet' | 'gslide'
  | 'pdf' | 'archive' | 'folder' | 'other';

function classify(mimeType?: string | null): FileType {
  const m = mimeType || '';
  if (m === FOLDER_MIME) return 'folder';
  if (m === 'application/vnd.google-apps.document') return 'gdoc';
  if (m === 'application/vnd.google-apps.spreadsheet') return 'gsheet';
  if (m === 'application/vnd.google-apps.presentation') return 'gslide';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (/zip|x-rar|x-7z|x-tar|gzip/.test(m)) return 'archive';
  if (m.startsWith('application/') || m.startsWith('text/')) return 'document';
  return 'other';
}

function sizeLabel(bytes?: string | number | null): string {
  const n = Number(bytes || 0);
  if (!n) return '—';
  if (n > 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

async function displayNameFor(uid?: string, email?: string): Promise<string> {
  if (!uid) return email || 'User';
  try {
    const snap = await db.collection('users').doc(uid).get();
    return (snap.data()?.displayName as string) || email || 'User';
  } catch {
    return email || 'User';
  }
}

type ActivityType = 'created' | 'comment' | 'status' | 'version' | 'linked' | 'imported';

/** Appends an entry to an asset's activity/approval history. */
async function logActivity(
  assetId: string,
  entry: { type: ActivityType; user: string; role?: string; text?: string; meta?: any }
): Promise<void> {
  const time = new Date().toISOString();
  await MEDIA.doc(assetId).collection('activity').add({
    ...entry,
    time,
  });

  // Determine global action label
  let actionLabel = 'performed action on';
  switch (entry.type) {
    case 'created':
      actionLabel = 'uploaded media';
      break;
    case 'linked':
      actionLabel = 'linked media';
      break;
    case 'comment':
      actionLabel = 'commented on media';
      break;
    case 'status':
      actionLabel = 'updated status of';
      break;
    case 'version':
      actionLabel = 'uploaded new version of';
      break;
    case 'imported':
      actionLabel = 'imported media';
      break;
  }

  // Best-effort attempt to get asset name for context
  let assetName = 'media asset';
  try {
    const assetSnap = await MEDIA.doc(assetId).get();
    if (assetSnap.exists) {
      assetName = assetSnap.data()?.name || 'media asset';
    }
  } catch (e) {
    console.error('Error fetching asset name for global activity:', e);
  }

  try {
    const activityId = db.collection('activities').doc().id;
    await db.collection('activities').doc(activityId).set({
      id: activityId,
      type: 'media',
      user: entry.user,
      role: entry.role || 'internal',
      action: actionLabel,
      target: assetName,
      targetId: assetId,
      text: entry.text || null,
      time,
    });
  } catch (err) {
    console.error('Failed to log global media activity:', err);
  }
}

async function requireConfigured(res: Response): Promise<WorkspaceConfig | null> {
  const ws = await getWorkspace();
  if (!ws.configured || !ws.rootFolderId) {
    res.status(409).json({ success: false, error: 'Workspace root folder is not configured yet.' });
    return null;
  }
  return ws;
}

/* ----------------------------- Workspace config ---------------------------- */

// GET current workspace settings
router.get('/workspace', async (_req, res, next) => {
  try {
    res.json({ success: true, workspace: await getWorkspace() });
  } catch (e) {
    next(e);
  }
});

// Configure root folder (admin only). Validates the folder is reachable.
router.post('/workspace', requireRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const { rootFolder, createRoot, rootFolderName, topLevelFolders, campaignTemplate } = req.body || {};
    const patch: Partial<WorkspaceConfig> = {};

    if (createRoot) {
      // drive.file scope: the app cannot adopt a pre-existing folder, so it
      // creates its own root in the delegated user's Drive. Reset folder ids
      // since any previously-stored ids belonged to a different (SA) root.
      const folder = await createWorkspaceRoot(String(rootFolderName || 'Marketing Assets'));
      patch.rootFolderId = folder.id!;
      patch.rootFolderName = folder.name || 'Marketing Assets';
      patch.rootFolderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`;
      patch.topLevelFolderIds = {};
      patch.configured = true;
    } else if (rootFolder) {
      const rootFolderId = extractFolderId(String(rootFolder));
      // Confirm the service account can actually see this folder.
      let meta;
      try {
        meta = await getFile(rootFolderId);
      } catch {
        return res.status(400).json({
          success: false,
          error:
            'Could not access that folder. Make sure the folder id/URL is correct and the folder ' +
            'is shared with the service account as Editor.',
        });
      }
      if (meta.mimeType !== FOLDER_MIME) {
        return res.status(400).json({ success: false, error: 'That id is not a folder.' });
      }
      patch.rootFolderId = rootFolderId;
      patch.rootFolderName = meta.name || 'Marketing Hub';
      patch.rootFolderUrl = meta.webViewLink || `https://drive.google.com/drive/folders/${rootFolderId}`;
      patch.configured = true;
    }
    if (Array.isArray(topLevelFolders)) patch.topLevelFolders = topLevelFolders;
    if (Array.isArray(campaignTemplate)) patch.campaignTemplate = campaignTemplate;

    res.json({ success: true, workspace: await saveWorkspace(patch) });
  } catch (e) {
    next(e);
  }
});

// Create the top-level folder structure (admin only). Idempotent.
router.post('/workspace/provision', requireRole('admin'), async (req, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;

    const ids: Record<string, string> = { ...ws.topLevelFolderIds };
    for (const name of ws.topLevelFolders) {
      const folder = await ensureFolder(name, ws.rootFolderId, { kind: 'top-level' });
      ids[name] = folder.id!;
    }
    const saved = await saveWorkspace({ topLevelFolderIds: ids });
    res.json({ success: true, workspace: saved });
  } catch (e) {
    next(e);
  }
});

/* --------------------------- Campaign provisioning -------------------------- */

// Ensure Campaigns/<campaign>/<template...> exists, store ids on the campaign.
router.post(
  '/campaigns/:campaignId/provision',
  requireRole('admin', 'internal'),
  async (req, res, next) => {
    try {
      const ws = await requireConfigured(res);
      if (!ws) return;

      const { campaignId } = req.params;
      const campSnap = await db.collection('campaigns').doc(campaignId).get();
      if (!campSnap.exists) {
        return res.status(404).json({ success: false, error: 'Campaign not found.' });
      }
      const campaignName = (campSnap.data()?.name as string) || campaignId;

      // Campaigns parent folder (ensure it exists even if provision wasn't run).
      const campaignsParent =
        ws.topLevelFolderIds['Campaigns'] ||
        (await ensureFolder('Campaigns', ws.rootFolderId, { kind: 'top-level' })).id!;

      const campaignFolder = await ensureFolder(campaignName, campaignsParent, {
        kind: 'campaign',
        campaignId,
      });

      const subfolders: Record<string, string> = {};
      for (const sub of ws.campaignTemplate) {
        const f = await ensureFolder(sub, campaignFolder.id!, { kind: 'campaign-sub', campaignId });
        subfolders[sub] = f.id!;
      }

      const driveFolders = {
        root: campaignFolder.id!,
        url: campaignFolder.webViewLink || `https://drive.google.com/drive/folders/${campaignFolder.id}`,
        subfolders,
      };
      await db.collection('campaigns').doc(campaignId).set({ driveFolders }, { merge: true });

      res.json({ success: true, driveFolders });
    } catch (e) {
      next(e);
    }
  }
);

/* -------------------------------- Browsing --------------------------------- */

// List children of a folder (must be inside the workspace root).
router.get('/folders/:id/children', async (req, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const folderId = req.params.id === 'root' ? ws.rootFolderId : req.params.id;
    await assertWithinRoot(folderId, ws.rootFolderId);
    const files = await listChildren(folderId);
    res.json({
      success: true,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        fileType: classify(f.mimeType),
        isFolder: f.mimeType === FOLDER_MIME,
        size: sizeLabel(f.size),
        webViewLink: f.webViewLink,
        modifiedTime: f.modifiedTime,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// Create a folder inside the workspace.
router.post('/folders', requireRole('admin', 'internal'), async (req, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const { name, parentId } = req.body || {};
    if (!name) return res.status(400).json({ success: false, error: 'Folder name required.' });
    const parent = parentId || ws.rootFolderId;
    await assertWithinRoot(parent, ws.rootFolderId);
    const folder = await ensureFolder(String(name), parent, { kind: 'custom' });
    res.json({ success: true, folder: { id: folder.id, name: folder.name, webViewLink: folder.webViewLink } });
  } catch (e) {
    next(e);
  }
});

/* --------------------------------- Uploads --------------------------------- */

// Start a resumable upload session; the browser PUTs bytes to the returned URL.
router.post('/upload-session', requireRole('admin', 'internal'), async (req: AuthedRequest, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const { name, mimeType, folderId, campaignId } = req.body || {};
    if (!name || !folderId) {
      return res.status(400).json({ success: false, error: 'name and folderId are required.' });
    }
    await assertWithinRoot(folderId, ws.rootFolderId);

    const appProperties: Record<string, string> = { uploadedByUid: req.uid || '' };
    if (campaignId) appProperties.campaignId = String(campaignId);

    const uploadUrl = await createResumableUploadSession({
      name: String(name),
      mimeType: String(mimeType || 'application/octet-stream'),
      parentId: String(folderId),
      appProperties,
    });
    res.json({ success: true, uploadUrl });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ Asset metadata ----------------------------- */

/**
 * Builds + writes a mediaAssets index record from an authoritative Drive file.
 * Shared by upload, link-existing, import and add-version flows.
 */
async function indexDriveFile(
  f: Awaited<ReturnType<typeof getFile>>,
  opts: {
    uploadedBy: string;
    uploadedByUid?: string | null;
    campaignId?: string | null;
    tags?: string[];
    status?: string;
    notes?: string;
    category?: string | null;
    versionGroupId?: string;
    versionNumber?: number;
    versionLabel?: string;
  }
) {
  const campaignId = opts.campaignId || f.appProperties?.campaignId || null;
  const versionNumber = opts.versionNumber || 1;
  const asset = {
    id: f.id!,
    driveFileId: f.id!,
    driveFolderId: f.parents?.[0] || '',
    name: f.name || 'Untitled',
    mimeType: f.mimeType || '',
    fileType: classify(f.mimeType),
    sizeBytes: Number(f.size || 0),
    size: sizeLabel(f.size),
    campaignId,
    campaignIds: campaignId ? [campaignId] : [],
    tags: Array.isArray(opts.tags) ? opts.tags : [],
    category: opts.category || null,
    version: opts.versionLabel || `v${versionNumber}`,
    versionNumber,
    versionGroupId: opts.versionGroupId || f.id!,
    status: opts.status || 'Draft',
    uploadedBy: opts.uploadedBy,
    uploadedByUid: opts.uploadedByUid || null,
    uploadedAt: new Date().toISOString(),
    driveModifiedTime: f.modifiedTime || null,
    webViewLink: f.webViewLink || null,
    iconLink: f.iconLink || null,
    notes: opts.notes || '',
    syncedAt: new Date().toISOString(),
  };
  await MEDIA.doc(asset.id).set(asset, { merge: true });
  return asset;
}

// Record metadata for an uploaded Drive file (Drive stays authoritative).
router.post('/assets', requireRole('admin', 'internal'), async (req: AuthedRequest, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const { fileId, campaignId, tags, status, notes, version, category } = req.body || {};
    if (!fileId) return res.status(400).json({ success: false, error: 'fileId required.' });

    await assertWithinRoot(fileId, ws.rootFolderId);
    const f = await getFile(fileId); // authoritative metadata, never trust client
    const uploadedBy = await displayNameFor(req.uid, req.email);

    const asset = await indexDriveFile(f, {
      uploadedBy,
      uploadedByUid: req.uid,
      campaignId,
      tags,
      status,
      notes,
      category,
      versionLabel: version,
    });
    await logActivity(asset.id, { type: 'created', user: uploadedBy, role: req.role });
    res.json({ success: true, asset });
  } catch (e) {
    next(e);
  }
});

// Link an existing Drive file (by id or URL) into the library.
router.post('/assets/link', requireRole('admin', 'internal'), async (req: AuthedRequest, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const { fileOrUrl, campaignId, tags, status } = req.body || {};
    if (!fileOrUrl) return res.status(400).json({ success: false, error: 'fileOrUrl required.' });

    const fileId = extractFileId(String(fileOrUrl));
    await assertWithinRoot(fileId, ws.rootFolderId);
    const f = await getFile(fileId);
    if (f.mimeType === FOLDER_MIME) {
      return res.status(400).json({ success: false, error: 'That is a folder — use Import folder instead.' });
    }
    const uploadedBy = await displayNameFor(req.uid, req.email);
    const asset = await indexDriveFile(f, { uploadedBy, uploadedByUid: req.uid, campaignId, tags, status });
    await logActivity(asset.id, { type: 'linked', user: uploadedBy, role: req.role });
    res.json({ success: true, asset });
  } catch (e) {
    next(e);
  }
});

// Import an existing folder's contents (recursively, bounded) into the library.
router.post('/import/folder', requireRole('admin', 'internal'), async (req: AuthedRequest, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const { folderOrUrl, campaignId } = req.body || {};
    if (!folderOrUrl) return res.status(400).json({ success: false, error: 'folderOrUrl required.' });

    const folderId = extractFileId(String(folderOrUrl));
    await assertWithinRoot(folderId, ws.rootFolderId);
    const uploadedBy = await displayNameFor(req.uid, req.email);

    let imported = 0;
    const queue: string[] = [folderId];
    const seen = new Set<string>();
    // Bounded breadth-first import (guards against pathological trees).
    for (let i = 0; i < 200 && queue.length > 0; i++) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const children = await listChildren(current);
      for (const child of children) {
        if (child.mimeType === FOLDER_MIME) {
          queue.push(child.id!);
        } else {
          await indexDriveFile(child, { uploadedBy, uploadedByUid: req.uid, campaignId });
          imported++;
        }
      }
    }
    res.json({ success: true, imported });
  } catch (e) {
    next(e);
  }
});

// Add a new version to an existing asset's version group.
router.post('/assets/:id/versions', requireRole('admin', 'internal'), async (req: AuthedRequest, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const baseSnap = await MEDIA.doc(req.params.id).get();
    if (!baseSnap.exists) return res.status(404).json({ success: false, error: 'Base asset not found.' });
    const base = baseSnap.data()!;

    const { fileId, versionLabel } = req.body || {};
    if (!fileId) return res.status(400).json({ success: false, error: 'fileId required.' });
    await assertWithinRoot(fileId, ws.rootFolderId);
    const f = await getFile(fileId);

    const groupId = base.versionGroupId || base.id;
    // Determine next version number across the group.
    const groupSnap = await MEDIA.where('versionGroupId', '==', groupId).get();
    const maxNum = groupSnap.docs.reduce((m, d) => Math.max(m, Number(d.data().versionNumber || 1)), 0);

    const uploadedBy = await displayNameFor(req.uid, req.email);
    const asset = await indexDriveFile(f, {
      uploadedBy,
      uploadedByUid: req.uid,
      campaignId: base.campaignId,
      tags: base.tags,
      category: base.category,
      versionGroupId: groupId,
      versionNumber: maxNum + 1,
      versionLabel,
      status: 'Draft',
    });
    await logActivity(asset.id, {
      type: 'version',
      user: uploadedBy,
      role: req.role,
      text: `Uploaded ${asset.version}`,
      meta: { versionGroupId: groupId },
    });
    res.json({ success: true, asset });
  } catch (e) {
    next(e);
  }
});

// Add an approval/comment entry to an asset.
router.post('/assets/:id/comments', requireRole('admin', 'internal'), async (req: AuthedRequest, res, next) => {
  try {
    const id = req.params.id;
    const snap = await MEDIA.doc(id).get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'Asset not found.' });
    const { text } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ success: false, error: 'Comment text required.' });
    }
    const user = await displayNameFor(req.uid, req.email);
    await logActivity(id, { type: 'comment', user, role: req.role, text: String(text).trim() });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// Get an asset's activity / approval history (newest first).
router.get('/assets/:id/activity', async (req, res, next) => {
  try {
    const snap = await MEDIA.doc(req.params.id).collection('activity').orderBy('time', 'desc').limit(100).get();
    res.json({ success: true, activity: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (e) {
    next(e);
  }
});

/* ----------------------- Native Drive revisions (byte history) ------------- */

// List the file's native Drive revisions.
router.get('/assets/:id/revisions', async (req, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    await assertWithinRoot(req.params.id, ws.rootFolderId);
    const revisions = await listRevisions(req.params.id);
    res.json({
      success: true,
      revisions: revisions.map((r) => ({
        id: r.id,
        modifiedTime: r.modifiedTime,
        size: sizeLabel(r.size),
        keepForever: !!r.keepForever,
        modifiedBy: r.lastModifyingUser?.displayName || '—',
      })),
    });
  } catch (e) {
    next(e);
  }
});

// Start a resumable session that uploads a NEW revision onto the same file id.
router.post('/assets/:id/revision-session', requireRole('admin', 'internal'), async (req: AuthedRequest, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const id = req.params.id;
    await assertWithinRoot(id, ws.rootFolderId);
    const { mimeType } = req.body || {};
    const uploadUrl = await createResumableUpdateSession(id, String(mimeType || 'application/octet-stream'));
    res.json({ success: true, uploadUrl });
  } catch (e) {
    next(e);
  }
});

// After a revision upload completes, refresh the index entry and log it.
router.post('/assets/:id/revision-complete', requireRole('admin', 'internal'), async (req: AuthedRequest, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const id = req.params.id;
    const snap = await MEDIA.doc(id).get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'Asset not found.' });
    await assertWithinRoot(id, ws.rootFolderId);

    const f = await getFile(id);
    await MEDIA.doc(id).set(
      {
        name: f.name || snap.data()!.name,
        sizeBytes: Number(f.size || 0),
        size: sizeLabel(f.size),
        driveModifiedTime: f.modifiedTime || null,
        syncedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    const user = await displayNameFor(req.uid, req.email);
    await logActivity(id, { type: 'version', user, role: req.role, text: 'Uploaded a new file revision' });
    res.json({ success: true, asset: (await MEDIA.doc(id).get()).data() });
  } catch (e) {
    next(e);
  }
});

// Pin/unpin a revision (e.g. keep the approved one forever).
router.patch('/assets/:id/revisions/:revId', requireRole('admin', 'internal'), async (req, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    await assertWithinRoot(req.params.id, ws.rootFolderId);
    await setRevisionKeepForever(req.params.id, req.params.revId, !!req.body?.keepForever);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/* ----------------------- Public-link delivery (opt-in) --------------------- */

// Make a file readable by anyone-with-link (offloads delivery from Cloud Run).
router.post('/assets/:id/share', requireRole('admin', 'internal'), async (req, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const id = req.params.id;
    await assertWithinRoot(id, ws.rootFolderId);
    const f = await shareAnyone(id);
    const publicViewUrl = `https://drive.google.com/uc?export=view&id=${id}`;
    await MEDIA.doc(id).set(
      { isPublic: true, publicViewUrl, webContentLink: f.webContentLink || null },
      { merge: true }
    );
    res.json({ success: true, isPublic: true, publicViewUrl, webContentLink: f.webContentLink || null });
  } catch (e) {
    next(e);
  }
});

// Revoke public access.
router.delete('/assets/:id/share', requireRole('admin', 'internal'), async (req, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const id = req.params.id;
    await assertWithinRoot(id, ws.rootFolderId);
    await unshareAnyone(id);
    await MEDIA.doc(id).set({ isPublic: false, publicViewUrl: null, webContentLink: null }, { merge: true });
    res.json({ success: true, isPublic: false });
  } catch (e) {
    next(e);
  }
});

// List indexed assets (filterable). Reads the Firestore index, not Drive.
router.get('/assets', async (req, res, next) => {
  try {
    const { campaignId, fileType, status } = req.query;
    let qref: FirebaseFirestore.Query = MEDIA;
    if (campaignId) qref = qref.where('campaignId', '==', String(campaignId));
    if (fileType) qref = qref.where('fileType', '==', String(fileType));
    if (status) qref = qref.where('status', '==', String(status));
    const snap = await qref.limit(500).get();
    res.json({ success: true, assets: snap.docs.map((d) => d.data()) });
  } catch (e) {
    next(e);
  }
});

// Update metadata; optionally rename or move the underlying Drive file.
router.patch('/assets/:id', requireRole('admin', 'internal'), async (req: AuthedRequest, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const id = req.params.id;
    const docRef = MEDIA.doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'Asset not found.' });

    await assertWithinRoot(id, ws.rootFolderId);
    const prev = snap.data()!;
    const { name, newFolderId, tags, status, notes, campaignId, campaignIds, category, version } = req.body || {};
    const patch: Record<string, any> = { syncedAt: new Date().toISOString() };

    if (typeof name === 'string' && name.trim()) {
      const f = await renameFile(id, name.trim());
      patch.name = f.name;
    }
    if (newFolderId) {
      await assertWithinRoot(newFolderId, ws.rootFolderId);
      const f = await moveFile(id, newFolderId);
      patch.driveFolderId = f.parents?.[0] || newFolderId;
    }
    if (Array.isArray(tags)) patch.tags = tags;
    if (typeof status === 'string') patch.status = status;
    if (typeof notes === 'string') patch.notes = notes;
    if (campaignId !== undefined) patch.campaignId = campaignId || null;
    if (Array.isArray(campaignIds)) patch.campaignIds = campaignIds;
    if (typeof category === 'string') patch.category = category;
    if (typeof version === 'string') patch.version = version;

    await docRef.set(patch, { merge: true });

    // Record status transitions in the approval history.
    if (typeof status === 'string' && status !== prev.status) {
      const user = await displayNameFor(req.uid, req.email);
      await logActivity(id, {
        type: 'status',
        user,
        role: req.role,
        text: `Status changed: ${prev.status || '—'} → ${status}`,
      });
    }

    res.json({ success: true, asset: (await docRef.get()).data() });
  } catch (e) {
    next(e);
  }
});

// Remove an asset: trash in Drive + delete the index entry.
router.delete('/assets/:id', async (req: AuthedRequest, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const id = req.params.id;
    const snap = await MEDIA.doc(id).get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'Asset not found.' });

    const data = snap.data()!;
    const isPrivileged = req.role === 'admin' || req.role === 'internal';
    const isOwner = data.uploadedByUid === req.uid;
    if (!isPrivileged && !isOwner) {
      return res.status(403).json({ success: false, error: 'Not allowed to delete this asset.' });
    }

    await assertWithinRoot(id, ws.rootFolderId);
    await trashFile(id);
    await MEDIA.doc(id).delete();
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/* --------------------------- Sync & reconciliation -------------------------- */

// Full reconcile: re-read every indexed file and drop trashed/deleted entries.
async function fullReconcile(): Promise<{ updated: number; removed: number }> {
  const snap = await MEDIA.limit(1000).get();
  let updated = 0;
  let removed = 0;
  for (const docSnap of snap.docs) {
    const id = docSnap.id;
    try {
      const f = await getFile(id);
      if (f.trashed) {
        await MEDIA.doc(id).delete();
        removed++;
        continue;
      }
      await MEDIA.doc(id).set(
        {
          name: f.name || docSnap.data().name,
          sizeBytes: Number(f.size || 0),
          size: sizeLabel(f.size),
          driveFolderId: f.parents?.[0] || docSnap.data().driveFolderId,
          driveModifiedTime: f.modifiedTime || null,
          webViewLink: f.webViewLink || null,
          syncedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      updated++;
    } catch {
      await MEDIA.doc(id).delete();
      removed++;
    }
  }
  return { updated, removed };
}

// Core reconcile routine shared by the manual button and the cron endpoint.
async function runSync(ws: WorkspaceConfig, full: boolean) {
  if (full || !ws.drivePageToken) {
    const result = await fullReconcile();
    const startToken = await getStartPageToken();
    await saveWorkspace({ drivePageToken: startToken });
    return { mode: 'full' as const, ...result };
  }

  // Incremental: only act on changes to files we already index.
  const { changes, newStartPageToken } = await listChanges(ws.drivePageToken);
  let updated = 0;
  let removed = 0;
  for (const c of changes) {
    const ref = MEDIA.doc(c.fileId);
    const existing = await ref.get();
    if (!existing.exists) continue; // not part of our library — ignore
    if (c.removed || c.file?.trashed) {
      await ref.delete();
      removed++;
      continue;
    }
    if (c.file) {
      await ref.set(
        {
          name: c.file.name || existing.data()!.name,
          sizeBytes: Number(c.file.size || 0),
          size: sizeLabel(c.file.size),
          driveFolderId: c.file.parents?.[0] || existing.data()!.driveFolderId,
          driveModifiedTime: c.file.modifiedTime || null,
          webViewLink: c.file.webViewLink || null,
          syncedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      updated++;
    }
  }
  await saveWorkspace({ drivePageToken: newStartPageToken });
  return { mode: 'incremental' as const, scanned: changes.length, updated, removed };
}

// Manual reconcile. Incremental by default; ?full=1 forces a full scan.
router.post('/sync', requireRole('admin', 'internal'), async (req, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    res.json({ success: true, ...(await runSync(ws, !!req.query.full)) });
  } catch (e) {
    next(e);
  }
});

// Scheduled reconcile for Cloud Scheduler (auth via X-Cron-Secret in middleware).
router.post('/sync/cron', async (_req, res, next) => {
  try {
    const ws = await getWorkspace();
    if (!ws.configured || !ws.rootFolderId) {
      return res.status(409).json({ success: false, error: 'Workspace not configured.' });
    }
    const result = await runSync(ws, false);
    console.log('Scheduled sync:', result);
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

/* -------------------------------- Dashboard -------------------------------- */

// Aggregated media metrics for the dashboard.
router.get('/metrics', async (_req, res, next) => {
  try {
    const snap = await MEDIA.limit(2000).get();
    const docs = snap.docs.map((d) => d.data());

    // Collapse to current version per group for logical counts.
    const groups = new Map<string, any>();
    for (const a of docs) {
      const g = a.versionGroupId || a.id;
      const cur = groups.get(g);
      if (!cur || Number(a.versionNumber || 1) > Number(cur.versionNumber || 1)) groups.set(g, a);
    }
    const current = [...groups.values()];

    const byType: Record<string, number> = {};
    const byCampaign: Record<string, number> = {};
    let storageBytes = 0;
    for (const a of docs) storageBytes += Number(a.sizeBytes || 0);
    for (const a of current) {
      byType[a.fileType] = (byType[a.fileType] || 0) + 1;
      if (a.campaignId) byCampaign[a.campaignId] = (byCampaign[a.campaignId] || 0) + 1;
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentUploads = [...current]
      .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))
      .slice(0, 6)
      .map((a) => ({ id: a.id, name: a.name, fileType: a.fileType, uploadedBy: a.uploadedBy, uploadedAt: a.uploadedAt, status: a.status }));

    res.json({
      success: true,
      metrics: {
        totalAssets: current.length,
        totalFiles: docs.length,
        recentUploads7d: current.filter((a) => String(a.uploadedAt) >= weekAgo).length,
        pendingApprovals: current.filter((a) => a.status === 'Review' || a.status === 'Changes Requested').length,
        approved: current.filter((a) => a.status === 'Approved').length,
        storageBytes,
        byType,
        byCampaign,
        recentUploads,
      },
    });
  } catch (e) {
    next(e);
  }
});

/* ----------------------------- Content / preview --------------------------- */

// Stream raw bytes with Range support. Bytes are piped, never buffered, so a
// multi-GB video costs Cloud Run only a streaming relay (and the browser can seek).
router.get('/files/:id/content', async (req, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const id = req.params.id;
    await assertWithinRoot(id, ws.rootFolderId);

    const range = req.headers.range as string | undefined;
    const upstream = await driveMediaFetch(id, range);
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status === 416 ? 416 : 502).end();
    }

    // Relay relevant headers (status 206 + Content-Range when a range was served).
    res.status(upstream.status);
    const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
    if (req.query.download) {
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(req.query.name, 'file')}"`);
    }

    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body as any)
      .on('error', next)
      .pipe(res);
  } catch (e) {
    next(e);
  }
});

// Stream a specific revision's bytes (Range-supported), for revision history download.
router.get('/files/:id/revisions/:revId/content', async (req, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const { id, revId } = req.params;
    await assertWithinRoot(id, ws.rootFolderId);

    const range = req.headers.range as string | undefined;
    const upstream = await driveRevisionFetch(id, revId, range);
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status === 416 ? 416 : 502).end();
    }
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (req.query.download) {
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(req.query.name, 'revision')}"`);
    }
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body as any).on('error', next).pipe(res);
  } catch (e) {
    next(e);
  }
});

// Proxy a fresh thumbnail (thumbnailLink is short-lived & owner-scoped).
router.get('/files/:id/thumbnail', async (req, res, next) => {
  try {
    const ws = await requireConfigured(res);
    if (!ws) return;
    const id = req.params.id;
    await assertWithinRoot(id, ws.rootFolderId);
    const meta = await getFile(id);
    if (!meta.thumbnailLink) return res.status(404).end();
    const upstream = await fetchThumbnail(meta.thumbnailLink);
    if (!upstream.ok || !upstream.body) return res.status(404).end();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (e) {
    next(e);
  }
});

export default router;
