# Absorption migration — runbook

**What:** promotes `tasks` to the general work-item store and folds `campaigns`, `events` and the Phase-1 `workItems` collection into it (spec-revisions §1). After this, `WORK_ITEMS_COLLECTION = 'tasks'` and the planner engine operates directly on the production task data.

**Code:** `backend/scripts/migrate-to-workitems.ts` (I/O glue) over `backend/src/lib/planner/absorb.ts` (pure, unit-tested in `planner-absorb.test.ts`).

## Design decision worth knowing

Legacy `task.status` holds display names ("In Progress"); the engine treats `status` as an opaque workflow-status id. Rather than rewrite every live doc (and break the legacy Tasks page, calendar and `status_transition` RBAC mid-flight), the absorbed workflow **`wf_task` uses display names as status ids**. Zero rewrites; `statusId`/`statusPhase` stay untouched as legacy parallels. Planner-native workflows (`wf_campaign`, `wf_simple`) keep kebab ids — ids are opaque to the engine, only consistency within a workflow matters.

## Order of operations (strict)

1. **Deploy indexes first** (spec §1.4): `firebase deploy --only firestore:indexes`
   The three `workItems` composites are retargeted to `tasks`; index build must finish before views query them.
2. **Dry run** (from `backend/`): `npx ts-node scripts/migrate-to-workitems.ts --dry-run`
   Review counts + warnings. Warnings mean doc-id collisions — resolve before proceeding.
3. **Live run:** `npx ts-node scripts/migrate-to-workitems.ts`
   Idempotent: re-runs skip anything already migrated (`workflowId` on tasks, `migratedFrom` match on copies, `movedTo` on workItems).
4. **Deploy backend** (this branch: constant flipped to `'tasks'`): `deploy-backend.bat`
   ⚠ Never deploy the flipped backend before step 3 — the planner routes would serve legacy docs with no `workflowId` and transitions would 400. (Remember the inventory-app incident: stale deployed code + new data model = wipe. Same class of hazard.)
5. **Deploy rules:** `firebase deploy --only firestore:rules`
   `workItems` is now deny-all (retired); `tasks` gains the planner subcollection rules (`activity`/`attachments`/`comments`, client-read-only).
6. **Smoke test:** legacy Tasks page lists as before (planner-native items filtered by `typeId` guard); planner List/Kanban now shows absorbed tasks under `wf_task`; a `move-to-*` transition on a legacy task writes an audit entry under `tasks/{id}/activity`.
7. Optional cleanup after a comfortable soak: `npx ts-node scripts/migrate-to-workitems.ts --delete-workitems` removes the retired `workItems` sources.

## What coexists during the transition

- `campaigns` / `events` collections keep serving their legacy pages (marked `absorbedAt`, treated read-only-ish); the planner copies carry `migratedFrom` back-references. Route retirement happens with the frontend cutover.
- Events' `packingItems` / `logistics` subcollections stay on `events/{id}` (satellite data; `recursiveDelete` pattern preserved).
- Legacy surfaces filter planner-native items via the `typeId` guard (`routes/tasks.ts` list, `routes/sync.ts` POSTS sheet). `check-deadlines` and reporting are naturally safe (they filter on `progress`/`brand`, absent on planner-native items).

## Deliberately deferred (do NOT do these yet)

- **§1.3 `activities` create → `false`:** the legacy frontend (`utils/activityLogger.ts`) still writes `activities` client-side. Flip only when that logging moves behind the API (frontend cutover), or legacy activity logging silently dies.
- **Client `tasks` write rules → `false`:** legacy staff UI still writes tasks directly. Tighten at frontend cutover; until then a staff client can technically bypass the engine on absorbed items — accepted, unchanged from today's trust model.
- **`priority` normalization:** legacy values ("High") are left untouched; planner `Priority` ('high') applies to new items only. Normalize at cutover.

## Rollback

The migration is additive: legacy fields are never modified, `status` never rewritten. Rolling back = redeploy the previous backend image (constant `'workItems'`) and previous rules. Copies in `tasks` (campaigns/events/workItems) are inert to legacy surfaces thanks to the `typeId` guards and can be swept by `migratedFrom`/`absorbedAt` if ever needed.
