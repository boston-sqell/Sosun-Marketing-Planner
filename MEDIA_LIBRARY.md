# Media & Asset Library (Google Drive DAM) — Phase 1

A Digital Asset Management module integrated into the existing Sosun Marketing
Planner. Google Drive is the **single source of truth** for files; Firestore
holds **metadata only** (for search, linking, and workflow).

## How it fits the existing app

| Layer | What was added | Reuses |
|-------|----------------|--------|
| Backend | `services/drive.ts`, `services/workspace.ts`, `routes/drive.ts`, `middleware/auth.ts` | Same service account as `sheets.ts`; Firebase ID-token verification pattern from `routes/users.ts` |
| Frontend | `pages/MediaLibrary.tsx`, `services/driveApi.ts`, Media Workspace card in `Configuration.tsx` | `AuthContext`, existing CSS tokens/components, campaign data |
| Data | `mediaAssets` + `settings/workspace` Firestore docs | `campaigns` (folder ids stored on the campaign doc) |
| Nav | "Media Library" (`/media`) replaces "File Manager" in the sidebar | Old `/files` route stays reachable but unlinked |

All Drive operations are **backend-proxied through the service account**. Users
never need direct Drive access and the app never touches Drive outside the
configured root folder.

## One-time setup

1. **Enable the Google Drive API** on the GCP project that owns the service
   account (Sheets sync already uses this account).
2. **Create the root folder** in Google Drive, e.g. `Marketing Hub`.
3. **Share that folder** with the service-account email
   (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) as **Editor**.
4. In the app, go to **Configuration → Media Workspace** (admin only), paste the
   folder's share link or ID, and click **Connect**.
5. Click **Create folder structure** to auto-create
   `Campaigns / Brand Assets / Templates / Agency Uploads / Events / Archive`.

That's it. Creating a campaign now auto-provisions
`Campaigns/<name>/{Briefs, Creative, Photos, Videos, Social Media, Print,
Approved Assets, Archive}` and stores the folder IDs on the campaign document.

## Security model (workspace boundary)

Every backend route validates that the target file/folder's parent chain
resolves to the configured root (`assertWithinRoot`). Any ID outside the
workspace is rejected with `403`. App-created folders/files are also stamped
with a private Drive `appProperties` tag for reliable, name-independent
re-discovery. Firestore rules make `mediaAssets` and `settings` **read-only to
clients** — all writes go through the backend (Admin SDK), so integrity and the
boundary are enforced server-side.

## ⚠️ Important: My Drive + service-account storage quota

You configured a **personal My Drive folder** as the root. Files the service
account uploads are *owned by the service account*, which has a fixed **~15 GB**
Drive quota that cannot be expanded. For a marketing asset library this is fine
to start, but plan for the limit.

**Recommended upgrade path (no code changes):** move the workspace to a Google
**Shared Drive** (Workspace required). Shared Drives have no per-owner quota.
Because every Drive call already passes `supportsAllDrives`, and because we store
**Drive file IDs (not paths)**, migrating is just:

1. Create or use a Shared Drive, share it with the service account as Content Manager.
2. Move the existing `Marketing Hub` folder into the Shared Drive (IDs are preserved).
3. Update the root folder in **Configuration → Media Workspace** if the ID changed.

This is exactly the "future Shared Drive migration" the design anticipates.

## API surface (`/api/drive`, all require a Firebase ID token)

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/workspace` | any | Current workspace config |
| POST | `/workspace` | admin | Set root folder (validates access) |
| POST | `/workspace/provision` | admin | Create top-level folders |
| POST | `/campaigns/:id/provision` | admin/internal | Create campaign folder tree |
| GET | `/folders/:id/children` | any | List a folder (boundary-checked) |
| POST | `/folders` | admin/internal | Create a folder |
| POST | `/upload-session` | any | Start a resumable upload session |
| POST | `/assets` | any | Record metadata for an uploaded/linked file |
| GET | `/assets` | any | List indexed assets (optional filters) |
| PATCH | `/assets/:id` | any | Update metadata / rename / move |
| DELETE | `/assets/:id` | owner or admin/internal | Trash in Drive + remove index |
| GET | `/files/:id/content` | any | Stream bytes (download / preview) |
| GET | `/files/:id/thumbnail` | any | Proxy a fresh Drive thumbnail |

Uploads use a **resumable session**: the backend starts the session (authed),
the browser PUTs bytes **directly to Google**, so large media never streams
through Cloud Run.

## Implemented in Phase 1

- Configurable root workspace + auto top-level + auto campaign folder trees
- Drag-and-drop / multi-file uploads to campaign or workspace folders, with progress
- Grid, List, and Folder (Drive hierarchy) views
- Search + filters (type, status, campaign), inline preview (image/video/PDF)
- Metadata index, approval status workflow, basic versioning fields
- Open in Drive / download / copy link / delete (to trash) / status change

## Implemented in Phase 2

- **Version management** — version chains (`versionGroupId` + `versionNumber`); gallery
  collapses to the current version with a version-count badge; the asset modal lists the
  full history, supports "Upload new version", per-version download, and "Mark approved".
- **Approval workflow & history** — an `activity` subcollection per asset records
  created/linked/version/status/comment events; the modal shows the thread, quick
  status-set buttons, and a comment composer. Status transitions are auto-logged.
- **Tag editor & categories** — add/remove tags, set a category, edit campaign/notes in
  the asset modal (`PATCH /assets/:id`). Tags surface on cards and feed search.
- **Multi-campaign associations** — `campaignIds[]` stored alongside the primary
  `campaignId`; the campaign filter matches either.
- **Link existing / import folder** — `POST /assets/link` indexes an existing Drive file;
  `POST /import/folder` recursively (bounded) imports a folder's files. Both are
  workspace-boundary checked. Exposed via the "Link existing" dialog.
- **Metadata reconciliation** — `POST /sync` refreshes name/size/modified-time for every
  indexed asset and drops entries trashed/deleted in Drive. Wired to the "Sync" button.
- **Dashboard media metrics** — `GET /metrics` returns totals, pending approvals, approved,
  7-day uploads, storage usage, by-type, by-campaign, and recent uploads; rendered as a
  Media & Asset Library panel on the dashboard.

## Implemented in Phase 3 (large-media hardening + scale)

- **Streaming media, no buffering** — `/files/:id/content` now honours HTTP `Range`
  and pipes bytes straight through (`driveMediaFetch` → `Readable.fromWeb` → `res`).
  Video/PDF/image preview and downloads use a direct streamed URL, so a multi-GB
  video never lands in a browser blob or Cloud Run memory, and the player can seek.
- **Media access token** — `GET /media-token` issues a short-lived (6 h), session-wide
  HMAC token so `<img>/<video>/<a>` can stream without an Authorization header.
  It never widens access: the streaming routes still run `assertWithinRoot`. Forged
  tokens fall through to normal Firebase auth.
- **Chunked, resumable uploads with retry** — the client uploads in 8 MB chunks with
  `Content-Range`; a failed chunk retries (up to 4×) instead of restarting the whole
  file. Robust for large videos on flaky connections.
- **Incremental sync** — `POST /sync` now uses the Drive **change feed**
  (`changes.list` + a stored `startPageToken` in the workspace doc). It only touches
  files already in the index. First run (no cursor) does a full scan and records the
  token; `?full=1` forces a full scan.
- **Real-time library** — the gallery subscribes to `mediaAssets` via Firestore
  `onSnapshot`, so uploads/edits/approvals appear without a manual refresh.

### Cost / load profile for large media

| Operation | Path | Cloud Run impact |
|-----------|------|------------------|
| Upload | browser → Google directly (chunked resumable) | only 2 tiny JSON calls; **no bytes** transit Cloud Run |
| Preview / download | browser → Cloud Run → Drive, **streamed with Range** | streaming relay only — constant memory, no full-file buffering; instance held for the transfer |
| Metadata / sync | Firestore + Drive metadata calls | negligible |

The remaining cost to watch is **egress + instance-time** for many concurrent large
downloads/previews (they relay through Cloud Run). If that grows, the next step is to
grant a temporary `anyoneWithLink` permission per-file and serve Drive's `webContentLink`
directly — at the cost of relaxing the private-workspace boundary for those files.

## Implemented in Phase 4 (native revisions, public delivery, scheduled sync)

- **Native Drive revisions** — alongside the new-file-per-version model, a file now
  exposes Google Drive's byte-level revision history on a single id. `GET
  /assets/:id/revisions` lists them; `POST /assets/:id/revision-session` +
  `revision-complete` upload a new revision *in place* (same id/link) via a chunked
  resumable session; `PATCH /assets/:id/revisions/:revId` pins/unpins
  (`keepForever`); `GET /files/:id/revisions/:revId/content` streams a specific
  revision with Range support. Surfaced in the asset modal's **Versions** tab as a
  "File revisions" section (list, download, pin, "Upload new revision (in place)").
- **Per-file public links (opt-in)** — `POST /assets/:id/share` grants
  `anyoneWithLink` read access so large media can be served straight from Drive
  (`uc?export=view` / `webContentLink`), offloading the relay from Cloud Run;
  `DELETE /assets/:id/share` revokes it. Admin/internal only. Surfaced as a
  **Public link** block in the asset modal's **Details** tab (create / copy /
  revoke). This deliberately relaxes the private-workspace boundary for that one
  file, so it is gated to privileged roles and per-file.
- **Scheduled background sync** — `POST /sync/cron` runs the same incremental
  reconcile as the manual button, authenticated by an `X-Cron-Secret` header
  (`CRON_SECRET`) instead of a Firebase token, so Cloud Scheduler can drive it.
  Set up a Cloud Scheduler job hitting this endpoint to retire the manual "Sync".

## Planned for later phases

- Native Google Docs/Sheets/Slides inline preview (requires sharing or export)
- A managed Cloud Scheduler job definition (the `/sync/cron` endpoint exists; the
  schedule itself is still provisioned manually)
