# Sosun Marketing Planner — Deep Dive Follow-Up Audit

**Date:** 2026-07-01
**Scope:** Re-audit against `CODE_AUDIT_2026-06-22.md`, covering the four commits landed since (`f98a766` security hardening, `b8ba91b` App Check/pagination/API migration, `2a3c5d4`, `848c348` npm audit fix). Backend (`backend/src`), `firestore.rules`, and frontend auth/context/services.
**Method:** Manual review of every file touched since the last audit, plus git history for provenance. No tests executed beyond reading `vitest` config; assume `npm test` in backend still needs to be run manually (75 tests reportedly passing per the 848c348 commit message).

---

## Headline finding: a claimed fix does not match the running code

The 2026-06-22 audit's remediation table lists **H5 — email verification enforced in `requireAuth`** as fixed. It was not: commit `f98a766` is titled *"Security Hardening: 17 fixes across files **(without email verification enforcement)**"* — the author explicitly excluded it. `backend/src/middleware/auth.ts` today still never checks `decoded.email_verified`.

The later commit `b8ba91b` resolves the gap a different way: `frontend/src/App.tsx` (L47-49) now carries the comment *"Email verification gate removed — access is controlled entirely by role. All account creation goes through the admin panel... so there is no open public registration to exploit."* That is a product decision (close self-service sign-up), not a code enforcement. Nothing in the code actually closes sign-up:

- `frontend/src/context/AuthContext.tsx` still exports a working `register()` that calls `createUserWithEmailAndPassword` directly against the Firebase client SDK.
- The `onAuthStateChanged` handler (L70-105) auto-provisions **any** first-time authenticated user: creates a Firestore profile and calls `POST /api/users/set-role` with `role: 'agency'`, no admin involved.
- `backend/src/routes/users.ts` `/set-role` still explicitly permits self-service: `isSelf && !isAdmin && role === 'agency'` → allowed.
- The Firebase Web API key in `firebase/config.ts` is necessarily public; if the "Email/Password" sign-in provider is still enabled in the Firebase Console (a setting outside this repo), anyone can call the Identity Toolkit `signUp` REST endpoint directly — bypassing the Login page's "Contact your administrator" messaging entirely — and land inside the app as an authenticated `agency` user with zero verification.

**This is the same vulnerability the 2026-06-22 audit labeled H6**, now defended by an unenforced assumption instead of a code path. Action: confirm in the Firebase Console that Email/Password new-sign-up is disabled (or gated to an allow-listed domain), and separately delete or gate the dead `register()` client code and the `/set-role` self-agency branch so the code doesn't contradict the product decision it's supposedly built on.

---

## Status of the 2026-06-22 findings

| ID | Verdict | Evidence |
|----|---------|----------|
| H1 mass-assignment on task PUT | **Holds** | `tasks.ts` whitelists `writePatch` per update type |
| H2 rules/RBAC split on tasks | **Holds** | `firestore.rules` L55: agency direct writes removed |
| H3 push/calendar endpoints unprotected | **Holds** | `requireRole('admin','internal')` on both routes |
| H4 role from user-writable doc | **Holds** | `AuthContext` reads `claimRole` from `getIdTokenResult()` first |
| H5 email verification | **Not fixed — see above** | `requireAuth` never checks `email_verified` |
| H6 open self-registration → agency | **Not fixed, relabeled** | see above |
| M1 `users` world-readable | **Holds** | rules restrict to self/admin/internal |
| M2 `activities` client-writable | **Partially — reads open, not writes** | rules: `create: isAuth()`, `update/delete: false` (create was always intended per the append-only design; matches audit's own framing) |
| M3 spoofable `displayName` on asset delete | **Holds** | legacy `assets` delete now staff-only |
| M4 `isWithinRoot` unbounded cache | **Not re-verified this pass** | `drive.ts` unchanged since 06-22; not in this session's diff, recommend a direct look at `services/drive.ts` L230-263 |
| M5 error handler leaks `err.message` | **Holds** | `server.ts` honors `err.status`, hides 5xx text in prod |
| M6 media token scope/TTL | **Holds** | 1h TTL, HMAC bound to uid |
| M7 Content-Disposition injection | **Holds** | `safeFilename()` strips quotes/CRLF |
| M8 DAM writes missing role checks | **Holds** | every mutating `/assets*` route now `requireRole('admin','internal')` |
| L1-L10 | **Not re-verified this pass** — none were in the changed-file set since 06-22, so no reason to expect regression, but not confirmed line-by-line this round |

---

## New findings from this pass

### N1 — App Check enforcement silently no-ops outside `NODE_ENV=production`
`backend/src/middleware/auth.ts`: if no `X-Firebase-AppCheck` header is sent, the check is skipped **unless** `process.env.NODE_ENV === 'production'` exactly. A misconfigured Cloud Run revision (unset, `staging`, or a typo) makes App Check a no-op with no warning — same footgun class as the CORS/rate-limit code already guards against elsewhere in `server.ts`. Recommend failing loud (or logging a startup warning, like the existing `CRON_SECRET`/`VAPID` checks) when `NODE_ENV` isn't recognized.

### N2 — App Check and email-verification are enforced inconsistently across routers
`backend/src/routes/users.ts` (`/set-role`, `/create`, `/delete/:uid`, `/roles`) doesn't use the shared `requireAuth` middleware at all — it has its own local `verifyToken()` that checks only the ID token. That means the account-provisioning and role-assignment surface, arguably the most sensitive one in the app, is the **one place App Check is never verified**, regardless of environment. Route it through `requireAuth`/`requireRole` like every other router for consistency.

### N3 — Pagination was added server-side but most frontend call sites immediately undo it
`GET /api/tasks`, `/api/campaigns`, `/api/budget`, `/api/events`, `/api/drive/assets` all now do cursor pagination. But `tasksApi.listAll()` (and equivalents referenced from `Tasks.tsx`, `Dashboard.tsx`, `Campaigns.tsx`, `useCalendarItems.ts`) loop the cursor up to 200 times to fetch the **entire** collection before rendering. Net effect: same total data pulled per page load, just spread across many more sequential HTTP round trips (20-50 rows per request) instead of one larger call — likely a regression in perceived load time for anything with a few hundred+ rows. If the intent was to actually bound payload size, the UI needs real "load more"/virtualized paging, not `listAll`.

### N4 — `events.ts` DELETE leaves orphaned subcollections
Deleting an event doc does not clean up its `packingItems` or `logistics` subcollections (acknowledged in a comment as a known gap). Firestore doesn't cascade-delete subcollections — these become permanently orphaned, invisible storage growth. Low severity, but worth a scheduled cleanup job or a `firebase deploy` extension (`firestore-delete`) since the comment shows the team is aware but hasn't acted.

### N5 — `npm audit fix` (848c348) is clean but incomplete by design
Bumped `form-data`/`protobufjs` transitively, verified against 75 passing tests. 10 moderate `uuid` advisories remain, deferred because the only fix is `firebase-admin@14` (breaking). Not an issue to act on now, just flag it so it doesn't quietly age out of anyone's radar — reassess when a `firebase-admin` major bump is on the roadmap anyway.

---

## Quick wins (highest value / lowest effort)
1. Verify (and if needed, disable) open Email/Password sign-up in the Firebase Console; until confirmed, treat H6 as still open. This is a five-minute check with an outsized payoff.
2. Delete the dead `register()` path in `AuthContext.tsx` and the `role === 'agency'` self-service branch in `users.ts /set-role` — either enforce the "admin-panel-only" story in code, or don't claim it in a comment.
3. Route `users.ts` through the shared `requireAuth` so App Check coverage isn't router-dependent (**N2**).
4. Make the App Check `NODE_ENV` check fail safe/loud instead of silently permissive (**N1**).
5. Swap `listAll`-style eager pagination on `Tasks`/`Dashboard`/`Campaigns` for real incremental loading, or the pagination work delivers no user-facing benefit (**N3**).

## Notes
- M4 (`isWithinRoot` cache) and L1-L10 weren't touched by any commit since 06-22, so no regression is expected, but they weren't re-verified line-by-line in this pass — worth a follow-up if a full re-audit is wanted.
- No new secrets or tracked credentials found; `.gitignore` still covers `.env`/service-account files.
- Repository still has no CI gate running `vitest`/`tsc` on push — the 75 passing tests are only asserted in commit messages, not enforced.
