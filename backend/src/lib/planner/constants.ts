/**
 * Marketing Planner — collection names.
 *
 * Kept in one place so the absorption migration (docs/planner/spec-revisions.md
 * §1) is a single-line change. See the note on WORK_ITEMS_COLLECTION in data.ts.
 */

/**
 * The work-item store. Phase 1 used a dedicated `workItems` collection; the
 * absorption migration (scripts/migrate-to-workitems.ts) promoted the legacy
 * `tasks` collection to the general work-item store, and this constant now
 * points at it. DO NOT deploy this flipped value before the migration has run
 * (see docs/planner/absorption-runbook.md).
 */
export const WORK_ITEMS_COLLECTION = 'tasks';
export const WORKFLOWS_COLLECTION = 'workflows';
export const WORK_ITEM_TYPES_COLLECTION = 'workItemTypes';
