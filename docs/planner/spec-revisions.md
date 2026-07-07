# Marketing Planner — Spec Revisions (§10, §14 + Absorption)

**Status:** Revised for the *actual* repo · **Date:** 2026-07-02
**Supersedes:** original spec §10 and §14, and the "new planner-namespaced collections / deny-all" parts of §3.
**Unchanged:** the engine (§4 workflow, §5 views, §6 approvals, §7 dependencies, §9 notifications logic, §11 audit *concept*, §13 config). Those modules are transport-agnostic and stand as written.

---

## 0. Why this revision exists

The original spec targets an **Astro SSR + session-cookie** app and proposes an all-new, deny-all, planner-namespaced data model. This repo is none of that. Verified against source:

| Original assumption | Reality (file) |
|---|---|
| Astro SSR, `src/pages/planner/…` | Vite + React SPA (React Router) in `frontend/`; Express API in `backend/` |
| session cookies, `verifyAdminSession` | Bearer **Firebase ID token** + custom claim `role`; [`requireAuth` / `requireRole`](../../backend/src/middleware/auth.ts) |
| `src/lib/admin-data.ts` | [`backend/src/services/firestore.ts`](../../backend/src/services/firestore.ts) + Admin SDK in `backend/src/routes/*.ts` |
| `src/middleware.ts` gate | Express `router.use(requireAuth)`; frontend guards via `useAuth().role` |
| client access "deny-all" | **role-scoped** client reads/writes ([`firestore.rules`](../../firestore.rules)); agency reads blocked to force server-side stripping |
| `scripts/create-admin.mjs` → `set-role.mjs` | provisioning via admin-only `POST /api/users/create` ([`routes/users.ts`](../../backend/src/routes/users.ts)) |
| `npm run check` gate | per-workspace: backend `build` + vitest; frontend `build && lint` (no FE test runner) |
| brand-new `workItems`, `taskStatuses`… | `tasks`, `campaigns`, `events`, `brands`, `activities`, `taskStatuses` **already exist** |

Decision taken: **keep the engine, retarget the plumbing, and absorb the existing collections** rather than build a parallel universe.

---

## 1. Absorption model (replaces §2/§3 "new namespace")

The existing `tasks` collection is already a proto-work-item store: it carries `statusId`, a `taskStatuses/{id}` lookup with `phase` + `isTerminal`, per-status `status_transition` RBAC, `brand`, `comments[]`, `checklist`, `assignedTo`, `dueDate`/`scheduledDate`. We **promote `tasks` to the general work-item store** rather than mint `workItems`, and fold the others in.

### 1.1 Collection mapping

| Spec concept | Real collection | Action |
|---|---|---|
| `workItems/{itemId}` | **`tasks/{id}`** (kept) | Generalize: add `typeId`, `workflowId`, `fields.{fieldId}`, `parentId`, `dependsOn`/`blocks`, `approval`, `brandIds[]`, `watcherUids[]`. Existing fields (`status`, `statusId`, `brand`, `comments[]`, `checklist`, `assignedTo`, `dueDate`) are retained; `brand` (single) is backfilled into `brandIds[]`. |
| Work-item type "Campaign" | **`campaigns/{id}`** | One-time backfill script migrates each campaign into `tasks` as `typeId: "campaign"`, campaign-only fields → `fields.*`. `campaigns` kept read-only during transition, then retired. Financial-stripping logic (agency) moves onto the work-item serializer. |
| Work-item type "Event"/"Sponsorship" | **`events/{id}`** | Same: migrate to `typeId: "event"`. **Keep** `events` `packingItems`/`logistics` subcollections as-is (linked satellite data); `recursiveDelete` pattern preserved. |
| `workflows/{id}` | generalizes **`taskStatuses/{id}`** | `taskStatuses` (name + phase + isTerminal) is a flat proto-workflow. Superseded by `workflows/{id}` (statuses + transitions). Migration maps each existing `phase` → a status `category`. |
| Activity log (§11) | **`activities/{id}`** (kept) | Reuse. **Rules change required** — see §1.3. |
| Brands (§2) | **`brands/{id}`** (kept) | Reuse unchanged; `brandIds[]` on a work item references these doc ids. |
| `plannerConfig/*`, `customFields`, `workItemTypes`, `approvalChains`, `automations`, `templates`, `intakeForms` | **new** | These have no existing equivalent — create as specified in §3. They are config, not work data. |

### 1.2 Roles that already exist vs. planner roles — see §10.

### 1.3 Audit log hardening (amends §11)

`activities` today allows **any authenticated user to `create`** (rules lines 91–95). The spec's §11 promises a *server-written, immutable* audit. To keep that guarantee, tighten the rule to `allow create: if false;` and write every entry through the Admin SDK inside the transition transaction (`src/lib/planner/activity.ts`). `update`/`delete` are already `false`. This is the one intentional rules change; everything else stays role-scoped.

### 1.4 What "absorb" costs

- One backfill script (`backend/scripts/migrate-to-workitems.ts`, modeled on `seedBrands.ts`).
- Existing `campaigns`/`events` routes stay serving reads until the frontend cuts over, then are deleted.
- The `tasks` document grows; no schema migration needed for new optional fields (Firestore is schemaless), but the composite indexes in §14.4 must be added first.

---

## 10. Roles & permissions (REVISED)

### 10.1 Keep the existing security boundary

The transport/identity boundary is the **custom claim `role`**, enforced by [`requireAuth`](../../backend/src/middleware/auth.ts). It is set atomically at user creation and a token with no claim is rejected (fail-closed). Existing claims (`AppRole`):

```
admin | internal | agency | external_agency | media | sponsor | supplier
```

These do **not** map 1:1 to the spec's `manager | management | marketing | creative | readonly`. Rather than mint a claim per marketing sub-role (claims are heavy, must be re-minted, and every existing route already switches on the current set), we **layer planner roles as data** and reuse the repo's existing condition-aware RBAC engine.

### 10.2 Two-tier model

**Tier 1 — claim (who can touch the planner at all):** `requireAuth` + a thin gate that admits staff-class claims (`admin`, `internal`) and, where configured, external claims (`agency`/`external_agency`) scoped to specific spaces. This *replaces* the spec's "add any planner role to middleware" line.

**Tier 2 — planner role (what they can do):** stored on the user profile as `users/{uid}.plannerRole` (one of the configurable roles in `plannerConfig/roles`), resolved server-side into capability checks. Permission keys unchanged from spec §10: `createItem`, `editItem`, `deleteItem`, `archiveItem`, `assign`, `comment`, `uploadFile`, `approve`, `manageConfig`, `export`.

This mirrors the pattern already in [`middleware/rbac.ts`](../../backend/src/middleware/rbac.ts) (`checkPermission(role, resource, action, context)` with conditions like `own_assigned_task`). We extend, not replace:

```ts
// backend/src/middleware/planner-rbac.ts  (new — same shape as rbac.ts)
requirePlannerPermission(capability, { spaceScoped?: boolean })
  1. resolve plannerRole from users/{req.uid}.plannerRole
  2. look up grant in plannerConfig/roles[plannerRole].permissions[capability]
  3. apply space-level override (e.g. agency → only Creative space, only own-assignee items)
  4. 403 on miss
```

`manageConfig` gates the settings UI and all `/api/planner/config/*` routes.

### 10.3 Provisioning (replaces `set-role.mjs`)

There is no `create-admin.mjs`. Extend the existing admin-only `POST /api/users/create` and add `PATCH /api/users/:uid` to also set `plannerRole` on the profile (the Firebase claim stays `internal`/`agency`/etc.). First-admin bootstrap remains the existing out-of-band path. A backend seed script (`backend/scripts/seed-planner.ts`, run via `tsx`, like `seedBrands.ts`) writes default `plannerConfig/roles`, `workflows`, `workItemTypes`, and `customFields`.

### 10.4 Alternative (if you prefer claims)

If marketing sub-roles must live in the token (e.g. for future direct-Firestore reads), extend the `AppRole` union in [`auth.ts`](../../backend/src/middleware/auth.ts) and the `rbac.ts` normalizer instead of using `users.plannerRole`. Costs: re-mint claims on role change, touch every existing role switch. **Recommendation: use 10.2 (data-tier);** the identity claim stays coarse and stable, marketing granularity stays config-editable (which is the whole point of §13).

---

## 14. Integration with this repo (REVISED)

### 14.1 Backend (Express on Cloud Run)

```
backend/src/routes/planner/
  ├── items.ts          CRUD over the work-item store (tasks), typed; reuses validate() + Zod
  ├── transition.ts     POST /api/planner/items/:id/transition  → workflow engine (§4)
  ├── approvals.ts       approve / reject endpoints
  ├── comments.ts        (or reuse tasks comment endpoints — already exist)
  ├── config.ts          types/fields/workflows/chains/automations/templates/forms (manageConfig)
  └── cron.ts            due-soon + recurrence, guarded by schedulerOrAdmin
backend/src/lib/planner/          (pure engine — unchanged from spec §4)
  ├── types.ts  data.ts  workflow.ts  approvals.ts  automations.ts  activity.ts  notify.ts
backend/src/middleware/planner-rbac.ts   §10.2
backend/scripts/
  ├── seed-planner.ts               default config (tsx, like seedBrands.ts)
  └── migrate-to-workitems.ts       one-time campaigns/events → tasks backfill
```

Wire routers in [`server.ts`](../../backend/src/server.ts) alongside the existing ones:

```ts
app.use('/api/planner/items',  plannerItemsRouter);
app.use('/api/planner/config', plannerConfigRouter);   // requirePlannerPermission('manageConfig')
app.use('/api/planner/cron',   plannerCronRouter);      // schedulerOrAdmin
```

All routers do `router.use(requireAuth)` then per-route `requirePlannerPermission(...)`, exactly like [`tasks.ts`](../../backend/src/routes/tasks.ts) does with `checkPermission`.

### 14.2 Frontend (Vite + React + React Router)

No SSR pages. Add client routes + components under `frontend/src/`:

```
frontend/src/pages/planner/     Board.tsx Calendar.tsx List.tsx ItemDetail.tsx Settings/*
frontend/src/planner/           api client (fetch w/ Authorization + X-Firebase-AppCheck), hooks
```

Guard routes with the existing `useAuth()` context (role from verified ID token) — there is no server middleware to add. API calls must attach both the `Authorization: Bearer` header and `X-Firebase-AppCheck` (see the existing app-check header helper).

### 14.3 Cron (replaces "authenticated Cloud Run endpoint")

Reuse the **existing** service-to-service pattern, don't invent one. [`tasks.ts`](../../backend/src/routes/tasks.ts) already ships `schedulerOrAdmin` (accepts `x-scheduler-key: $SCHEDULER_KEY`, else falls back to `requireAuth` + admin/internal). The Drive sync path uses `X-Cron-Secret`/`CRON_SECRET`. Planner `due-soon` (24h) and `recurrence` crons use `schedulerOrAdmin`. Cloud Scheduler → `POST /api/planner/cron/due-soon` with the scheduler key header. (Note: the existing due-deadline job already computes Maldives-local calendar days — reuse that logic for `dueDateApproaching`.)

### 14.4 Firestore rules + indexes

**Rules:** planner work items follow the existing `tasks` rule (staff read; agency/external_agency blocked from direct reads so the API can strip financials/internal comments). New config collections: `allow read: if isAuth()`, `allow write: if false` (Admin-SDK only) — matching how `newsMentions`/`reports` are handled. Tighten `activities` create to `false` per §1.3.

**Indexes** (add to [`firestore.indexes.json`](../../firestore.indexes.json) — note the store is `tasks`, and it uses `brand`/`scheduledDate` today; add the array + status composites):

```jsonc
{ "collectionGroup": "tasks", "fields": [
  { "fieldPath": "spaceId", "order": "ASCENDING" },
  { "fieldPath": "status",  "order": "ASCENDING" },
  { "fieldPath": "dueDate", "order": "ASCENDING" } ] },
{ "collectionGroup": "tasks", "fields": [
  { "fieldPath": "assigneeUids", "arrayConfig": "CONTAINS" },
  { "fieldPath": "status",       "order": "ASCENDING" } ] },
{ "collectionGroup": "tasks", "fields": [
  { "fieldPath": "brandIds", "arrayConfig": "CONTAINS" },
  { "fieldPath": "status",   "order": "ASCENDING" },
  { "fieldPath": "dueDate",  "order": "ASCENDING" } ] }
```

Deploy with `firebase deploy --only firestore:indexes,firestore:rules`.

### 14.5 Quality gate (replaces `npm run check`)

There is no `npm run check`. Per phase, the gate is:
- **backend:** `npm run build` (tsc) + `npm run test` (vitest) — the engine modules (`workflow.ts`, `approvals.ts`, `automations.ts`) are pure functions over config and are the primary vitest targets, sitting alongside the existing `rbac.test.ts` / `schemas.test.ts`.
- **frontend:** `npm run build && npm run lint`. **Gap to close:** there is no FE test runner; if the plan wants component tests, adding vitest to `frontend/` is its own task.

Consider adding a root `check` script that runs both workspaces so the spec's "gates every change" line becomes literally true.

---

## Open items still needing a decision (unchanged from review)

1. **Async post-functions vs. audit atomicity** (§4 steps 5–7) — `notify`/`webhook`/`createWorkItems` run after the transaction; need an outbox/retry so a committed transition can't lose its side effect.
2. **`majority` approval denominator** (§3.5) — define the eligible-set precisely.
3. **`searchTokens`** — array-contains prefix only; confirm it's not reinventing an existing search surface.
