# Sosun Marketing Planner — Deep Code Audit

**Date:** 2026-06-22
**Scope:** backend (`backend/src`), Firestore rules/indexes, frontend (`frontend/src`)
**Method:** Manual static review of auth/RBAC, routes, services, security rules, and frontend auth/date logic. No tests were executed (the repo ships none).

---

## REMEDIATION STATUS (2026-06-22)

Fixed in this session (verified against the authoritative filesystem; in-sandbox `tsc`
was blocked by the known mount-freeze quirk on edited files):

| ID | Fix | File(s) |
|----|-----|---------|
| H1 | Whitelisted task `PUT` patch (no mass-assignment) | `backend/src/routes/tasks.ts` |
| H2 | Agency direct task writes removed; users read = staff/self; activities append-only; legacy assets delete = staff; user can't change own `role` | `firestore.rules` |
| H3 | `notify-task`/`notify-meeting` require admin/internal; `action` validated | `backend/src/routes/push.ts` |
| H4 | Frontend role from verified token claim, not user doc | `frontend/src/context/AuthContext.tsx` |
| H5 | `requireAuth` rejects unverified email | `backend/src/middleware/auth.ts` |
| H6 | Self-service role provisioning requires verified email | `backend/src/routes/users.ts` |
| M4 | `isWithinRoot` cache now positive-only with 5-min TTL | `backend/src/services/drive.ts` |
| M5 | Error handler honors `err.status`, hides 5xx text in prod | `backend/src/server.ts` |
| M6 | Media token TTL 6h→1h, bound to uid | `backend/src/routes/drive.ts` |
| M7 | `Content-Disposition` filename sanitized | `backend/src/routes/drive.ts` |
| M8 | All DAM mutations (upload/link/version/comment/revision/pin/patch) locked to admin/internal | `backend/src/routes/drive.ts` |
| L1 | Local-day parse for `YYYY-MM-DD`; deadline check in Maldives tz | `frontend/src/utils/dateUtils.ts`, `backend/src/routes/tasks.ts` |
| L2 | `GET /api/tasks` PII console log removed; optional `?limit` | `backend/src/routes/tasks.ts` |
| L3 | Campaign sheet import reads A1:M, maps Asset Links (round-trip safe) | `backend/src/routes/sync.ts` |
| L4 | Comment edit wrapped in a transaction (no lost updates) | `backend/src/routes/tasks.ts` |
| L5 | `own_comment_15m` fails closed on missing/invalid `createdAt` | `backend/src/middleware/rbac.ts` |
| L9 | Media streaming GETs exempt from the global rate limiter | `backend/src/server.ts` |

**Deploy:** `deploy-backend.bat` → `deploy.bat` → `firebase deploy --only firestore:rules`. PWA users must hard-refresh (Ctrl+Shift+R).

**Behavior changes to expect:** unverified users now get `403 EMAIL_NOT_VERIFIED` from the API; agency users see the mock assignee list on the Tasks page (M1 — handled by existing fallback); media URLs refresh hourly instead of every 6h (transparent); **DAM is now read-only for non-staff** (per chosen policy — agencies/partners can view but not upload/version/comment).

**Still open (deferred quality items):** M1 staff-only user reads may warrant a dedicated backend endpoint for the assignee picker (currently falls back to mock list for agency); L7 (push subscription stores role at subscribe time — stale after role change); L8 (default role `'agency'` mislabeled least-privilege); L10 (`VITE_BACKEND_URL` localhost fallback in prod builds). None are vulnerabilities.

---

## Executive summary

The architecture is sound — Admin-SDK backend in front of Firestore, workspace-scoped Drive DAM, condition-aware RBAC engine. But authorization is enforced **inconsistently across two layers** (Firestore rules vs. backend RBAC), and several write endpoints trust the client more than they should. The highest-impact issues are a **mass-assignment hole on task updates**, a **rules/RBAC split that lets agency users bypass the backend entirely**, and **role-unprotected push/calendar endpoints** that let any logged-in user manipulate Google Calendar and spam notifications.

Counts: 6 High · 8 Medium · 10 Low/quality.

---

## HIGH severity

### H1 — Mass-assignment on `PUT /api/tasks/:id`
`backend/src/routes/tasks.ts` (~L242–306). The permission check validates only the *kind* of update (status transition / checklist / edit), but then writes the **entire request body**: `await db.collection('tasks').doc(id).update(patch)`. An `external_agency` user is allowed `status_transition`, so they can send:

```json
{ "statusId": "<any-non-terminal>", "assignedTo": "Internal", "brand": "x", "title": "hijacked", "budget": 0 }
```

`isStatusUpdate` is true, only the transition is checked, and **every other field is persisted**. Same hole on the checklist path. Fix: build an explicit allow-list patch per update type (e.g. status path may only write `status/statusPhase/isTerminal`; checklist path only `checklist`).

### H2 — Firestore rules let agency bypass the backend RBAC entirely
`firestore.rules` L37–41 allows `agency` to **directly update** any task where `resource.data.assignedTo == 'Agency'`, from the client Firebase SDK, with **no field restriction**. All the careful backend logic (no edit, no terminal transition, comment stripping) is moot — an agency user can skip the API and patch the doc directly, including changing `assignedTo`, dates, or status to terminal. The rule also checks the *existing* `assignedTo`, not `request.resource.data`, so they can flip ownership. Decide on one enforcement layer: either route all writes through the backend and make rules deny client writes to `tasks`, or replicate the field-level constraints in rules with `request.resource.data.diff(resource.data)`.

### H3 — Role-unprotected push & calendar endpoints
`backend/src/routes/push.ts`. `POST /notify-task` and `POST /notify-meeting` are behind `requireAuth` but **no `requireRole`**. Consequences for any authenticated user (including agency/sponsor/supplier):
- Blast push notifications to all admins/internal/agency with attacker-controlled `title`/`body`.
- `notify-meeting` reads the whole `users` collection and **creates/updates/deletes Google Calendar events** for an arbitrary `meetingId`. `action:"Deleted"` deletes the linked calendar event; otherwise it (re)creates events inviting all internal emails.

This is broken access control with real side effects on an external system. Restrict both to `admin`/`internal`, and verify the caller is allowed to act on that specific task/meeting.

### H4 — Frontend authorization trusts a user-writable field
`AuthContext.tsx` L237: `role: profile ? profile.role : null` — the app's role comes from the **Firestore `users/{uid}` document**, and `firestore.rules` L18 lets a user **write their own user doc**. A user can set `role:'admin'` on their own doc and the UI will treat them as admin. Server-side checks use the verified token claim (`decoded.role`), so this mostly unlocks UI rather than data — but it's a genuine smell and a foot-gun the moment any sensitive data is read client-side. Use the **verified custom claim** instead: `getIdTokenResult().claims.role`. Also stop storing `role` in a self-writable doc, or lock that field in rules.

### H5 — Email verification is cosmetic
The backend (`requireAuth`) never checks `email_verified`. The verification gate exists only in the client UI. An unverified user holds a valid ID token and can call every API at their role level. Enforce `decoded.email_verified === true` in `requireAuth` (with an allow-list for internal placeholder accounts if needed).

### H6 — Open self-registration grants `agency`
`emailPassword` is enabled (`firebase.json`) and `POST /api/users/set-role` lets a user self-assign `agency` (`users.ts` L36–38); `AuthContext` does this automatically on first login. If sign-up is open, **anyone who can authenticate becomes an agency user** — which (via rules) can read the entire `users` collection, read/write `activities`, write `mediaAssets` indirectly, and update Agency tasks. Confirm sign-up is closed/invite-only, or gate self-provisioning behind an allow-list/domain check.

---

## MEDIUM severity

### M1 — `users` collection world-readable to any authed user
`firestore.rules` L17: `allow read: if isAuth()`. Every authenticated user can enumerate all emails, roles, display names, agency names. Restrict to admin/internal, or expose a minimal projection via the backend.

### M2 — `activities` audit log is fully client-writable
`firestore.rules` L78: `allow read, write: if isAuth()`. Any user can forge, edit, or delete audit entries. Make it backend-write-only (`allow write: if false`).

### M3 — Spoofable `displayName` in `assets` delete rule
`firestore.rules` L51 keys delete permission on `uploadedBy == users/{uid}.displayName`. Since users can write their own `displayName` (M1/H4), they can impersonate another uploader to delete their files. Key on UID, not display name (the newer `mediaAssets` delete in `drive.ts` L803 correctly uses `uploadedByUid`).

### M4 — `isWithinRoot` ancestry cache is permanent and unbounded
`backend/src/services/drive.ts` L230–263. Results (both **true and false**) are cached forever in a `Map` with no TTL/eviction:
- A file later **moved out** of the workspace stays authorized (stale allow).
- A file **moved in** stays denied until restart.
- Memory grows without bound (leak).

Add a TTL + size cap, and don't cache negatives (or invalidate on move).

### M5 — Global error handler discards `err.status` and leaks `err.message`
`server.ts` L122–128 always returns **500** and echoes `err.message`. Deep handlers throw `403`/`401`/`404` (e.g. `assertWithinRoot`, `verifyToken`) that get flattened to 500, and internal error text is sent to clients. Honor `err.status` and return a generic message in production.

### M6 — Media token is not user/file-scoped and rides in the query string
`drive.ts` L42–59. `signMediaToken` signs only an expiry; any holder can stream **any** in-workspace file for 6h. As a `?token=` query param it leaks via `Referer` headers and access/CDN logs. Bind the token to the uid (and ideally the file id), shorten the TTL, and prefer a cookie or short-lived signed Drive URL.

### M7 — `Content-Disposition` filename injection
`drive.ts` L281 & L312: `filename="${req.query.name || 'file'}"` interpolates an unsanitized query param. A `"`-containing value breaks/forges the header. Sanitize (strip quotes/control chars) or use RFC 5987 `filename*=`.

### M8 — Several DAM write routes lack role checks
In `drive.ts`, `POST /assets`, `/assets/link`, `/assets/:id/versions`, `/assets/:id/comments`, `/assets/:id/revision-session`, `/assets/:id/revision-complete`, `PATCH /assets/:id`, `POST /upload-session` are behind `requireAuth` only. Any role (media/sponsor/supplier/agency) can upload, re-version, rename/move, and comment on DAM assets. If that's not intended, add `requireRole('admin','internal')` (or a per-asset ownership check).

---

## LOW / correctness / quality

### L1 — Timezone off-by-one in date handling (matches your dates-convention note)
- `tasks.ts` `check-deadlines` computes "today/tomorrow" with `toISOString().slice(0,10)` (UTC). On a non-UTC deadline this fires a day early/late.
- Frontend `dateUtils.parseDate('YYYY-MM-DD')` uses `new Date(str)` (parsed as **UTC midnight**) while the `DD/MM/YYYY` branch uses the **local** constructor — inconsistent, can display the previous day in tz behind UTC.
- `sync.ts` `formatDateForSheets` uses local `getDate()/getMonth()` on a UTC-parsed date — round-trips can shift by a day off-UTC servers.
Normalize on a single convention (store `YYYY-MM-DD`, parse with explicit Y/M/D parts everywhere).

### L2 — `GET /api/tasks` doesn't actually paginate
Docstring claims pagination, but it loads **all** tasks, runs an `await checkPermission` per doc (N+1), sorts in memory, and **logs the full task list (incl. titles/PII) to console** (L159). Add real cursor pagination, drop the console log, and note `checkPermission` is sync logic wrapped in `async` (no need to await per-row).

### L3 — Sheet round-trip drops a column
`sync.ts`: push writes `CAMPAIGNS!A1:M` (13 cols incl. Asset Links) but import reads `A1:L` (12). `assetLinks` is never re-imported; also a redundant `id` field is written into the doc body. Align ranges and drop the stored `id`.

### L4 — Comment edit is a racy whole-array rewrite
`tasks.ts` `PUT /:id/comments/:commentId` reads `comments`, mutates, and writes the whole array — concurrent edits lose updates. Creation uses `arrayUnion` (safe); edits don't. Use a transaction, or store comments in a subcollection.

### L5 — `own_comment_15m` defaults missing `createdAt` to "now"
`rbac.ts` L147: `resourceData.createdAt ? new Date(...) : new Date()` → a comment with no `createdAt` is **always** within the 15-minute window. Treat missing timestamp as not-editable.

### L6 — `notify-task` crashes on missing `action`
`push.ts` L92: `action.toLowerCase()` with `action` unvalidated → 500. Validate `action` alongside the other required fields.

### L7 — Push subscription stores role at subscribe time
`pushService.saveSubscription` persists `role` once; role changes later mis-route role-based pushes. Resolve role at send time, or refresh on each `lastEngagedAt` update.

### L8 — Default role is `'agency'`, labeled "least-privilege"
`auth.ts` L29 and `pushService.ts` L88. `agency` is **not** the lowest privilege (there's media/sponsor/supplier and `external_agency`). A token missing the claim silently gets agency rights. Default to a true no-privilege role and reject if the claim is absent.

### L9 — Rate limiting is coarse
`server.ts`: global 100 req / 15 min **per IP**, applied to everything including media-streaming routes. A whole office behind one NAT egress IP can be locked out; media playback (range requests) burns the budget fast. Exempt/relax streaming routes; consider per-user limits for authed traffic.

### L10 — `VITE_BACKEND_URL` falls back to `http://localhost:5000`
`AuthContext.tsx` L73/L192. If the env var is missing in a production build, the deployed app calls localhost. Fail loudly at build/runtime if unset in prod.

---

## Quick wins (highest value / lowest effort)
1. Whitelist the patch in `PUT /api/tasks/:id` (**H1**).
2. Add `requireRole('admin','internal')` to `notify-task`/`notify-meeting` (**H3**).
3. Enforce `email_verified` and read role from the **token claim**, not the user doc (**H4/H5**).
4. Tighten `firestore.rules`: lock `users` reads, make `activities` backend-only, key `assets` delete on UID, and resolve the `tasks` client-write split (**M1/M2/M3/H2**).
5. Make the global error handler honor `err.status` and stop leaking `err.message` (**M5**).

## Notes
- Secrets are clean: no `.env`/service-account files are tracked; `.gitignore` covers them.
- Repo has a single "Initial commit" and no tests — adding RBAC unit tests around `checkPermission` and the task/push routes would catch H1/H3 regressions cheaply.
