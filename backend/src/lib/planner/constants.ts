/**
 * Marketing Planner — collection names.
 *
 * Kept in one place so the absorption migration (docs/planner/spec-revisions.md
 * §1) is a single-line change. See the note on WORK_ITEMS_COLLECTION in data.ts.
 */

/**
 * The work-item store. Phase 1: a dedicated `workItems` collection (non-
 * destructive to the security-hardened `tasks` flows). The absorption migration
 * flips this to `'tasks'`.
 */
export const WORK_ITEMS_COLLECTION = 'workItems';
export const WORKFLOWS_COLLECTION = 'workflows';
export const WORK_ITEM_TYPES_COLLECTION = 'workItemTypes';
