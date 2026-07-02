/**
 * Marketing Planner — absorption helpers (docs/planner/spec-revisions.md §1).
 *
 * Pure functions used by scripts/migrate-to-workitems.ts to promote the legacy
 * `tasks` collection to the general work-item store and to fold `campaigns`,
 * `events` and the Phase-1 `workItems` collection into it. Nothing here touches
 * Firestore — unit-tested in __tests__/planner-absorb.test.ts.
 *
 * DESIGN NOTE — legacy status ids ARE the display names.
 * Legacy task docs carry `status` as a human-readable name ("In Progress") and
 * `statusId` as a kebab id ("in-progress", added by migrateTaskStatuses.ts).
 * The engine treats `WorkItem.status` as an opaque workflow-status id, so the
 * absorbed workflow (`wf_task`) uses the display names themselves as status
 * ids. That means NO rewrite of any live task's `status` field, and every
 * legacy surface (Tasks page, calendar, RBAC status_transition) keeps working
 * untouched during the transition. This matches the repo's existing
 * "human-readable string as identifier" convention (see `brand`).
 */

import { Priority, StatusCategory, Transition, Workflow, WorkflowStatus, WorkItem } from './types';

// ── Canonical legacy statuses (mirrors scripts/migrateTaskStatuses.ts) ──────

export type LegacyPhase = 'not_started' | 'pending' | 'in_progress' | 'terminal';

export interface LegacyStatus {
  /** Kebab id kept on the doc as `statusId` (untouched by absorption). */
  id: string;
  /** Display name — used as the wf_task workflow-status id AND name. */
  name: string;
  phase: LegacyPhase;
  color: string;
}

export const LEGACY_STATUSES: LegacyStatus[] = [
  // not_started
  { id: 'to-do', name: 'To Do', phase: 'not_started', color: '#6c757d' },
  { id: 'backlog', name: 'Backlog', phase: 'not_started', color: '#495057' },
  { id: 'draft', name: 'Draft', phase: 'not_started', color: '#adb5bd' },
  { id: 'idea', name: 'Idea', phase: 'not_started', color: '#6c757d' },
  { id: 'brief-needed', name: 'Brief Needed', phase: 'not_started', color: '#adb5bd' },
  // pending
  { id: 'pending', name: 'Pending', phase: 'pending', color: '#f1c40f' },
  { id: 'requested', name: 'Requested', phase: 'pending', color: '#f1c40f' },
  { id: 'brief-sent', name: 'Brief Sent', phase: 'pending', color: '#adb5bd' },
  { id: 'in-review', name: 'In Review', phase: 'pending', color: '#17a2b8' },
  { id: 'draft-ready', name: 'Draft Ready', phase: 'pending', color: '#17a2b8' },
  { id: 'awaiting-review', name: 'Awaiting Review', phase: 'pending', color: '#fd7e14' },
  { id: 'blocked', name: 'Blocked', phase: 'pending', color: '#e74c3c' },
  { id: 'submitted-for-review', name: 'Submitted for Review', phase: 'pending', color: '#e67e22' },
  { id: 'revision-needed', name: 'Revision Needed', phase: 'pending', color: '#d35400' },
  // in_progress
  { id: 'in-progress', name: 'In Progress', phase: 'in_progress', color: '#007bff' },
  { id: 'approved', name: 'Approved', phase: 'in_progress', color: '#2ecc71' },
  { id: 'scheduled', name: 'Scheduled', phase: 'in_progress', color: '#28a745' },
  // terminal
  { id: 'completed', name: 'Completed', phase: 'terminal', color: '#28a745' },
  { id: 'published', name: 'Published', phase: 'terminal', color: '#27ae60' },
  { id: 'cancelled', name: 'Cancelled', phase: 'terminal', color: '#dc3545' },
  { id: 'archived', name: 'Archived', phase: 'terminal', color: '#6c757d' },
];

export const LEGACY_TASK_WORKFLOW_ID = 'wf_task';
export const DEFAULT_SPACE_ID = 'marketing';
export const DEFAULT_LEGACY_STATUS = 'To Do';

export function phaseToCategory(phase: LegacyPhase): StatusCategory {
  switch (phase) {
    case 'not_started':
      return 'todo';
    case 'terminal':
      return 'done';
    default:
      return 'in_progress';
  }
}

/** Guess a category for a status name seen in the wild but not in the canon. */
export function guessCategory(name: string): StatusCategory {
  const s = name.toLowerCase();
  if (/(complete|done|publish|cancel|archiv|closed)/.test(s)) return 'done';
  if (/(progress|active|review|schedul|approv|live|confirm)/.test(s)) return 'in_progress';
  return 'todo';
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build the wf_task workflow: the 20 canonical legacy statuses plus any
 * observed status names not in the canon (deduped case-insensitively). Every
 * status is reachable from every other via a role-gated "Move to X" transition,
 * mirroring the free status dropdown the legacy UI offers staff today.
 */
export function buildLegacyTaskWorkflow(observedStatusNames: string[] = []): Workflow {
  const statuses: WorkflowStatus[] = LEGACY_STATUSES.map((s) => ({
    id: s.name,
    name: s.name,
    category: phaseToCategory(s.phase),
    color: s.color,
  }));

  const known = new Set(statuses.map((s) => s.id.toLowerCase()));
  for (const raw of observedStatusNames) {
    const name = (raw ?? '').trim();
    if (!name || known.has(name.toLowerCase())) continue;
    known.add(name.toLowerCase());
    statuses.push({ id: name, name, category: guessCategory(name), color: '#8b8b8b' });
  }

  const allIds = statuses.map((s) => s.id);
  const transitions: Transition[] = statuses.map((s) => ({
    id: `move-to-${slugify(s.name)}`,
    name: `Move to ${s.name}`,
    from: allIds.filter((id) => id !== s.id),
    to: s.id,
    conditions: [{ type: 'role', roles: ['admin', 'internal'] }],
  }));

  return {
    id: LEGACY_TASK_WORKFLOW_ID,
    name: 'Task workflow (absorbed)',
    initialStatus: DEFAULT_LEGACY_STATUS,
    statuses,
    transitions,
  };
}

// ── Legacy task upgrade (in-place, non-destructive merge) ────────────────────

/** Remove undefined values — Firestore rejects them. */
export function prune<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * Compute the merge patch that upgrades a legacy task doc into a valid work
 * item. Returns null when the doc already carries a workflowId (idempotent
 * re-runs, and planner-native items already living in `tasks`). Existing
 * values are never clobbered; `status` is never rewritten (see design note).
 */
export function upgradeLegacyTaskPatch(
  task: Record<string, any>,
  now: string,
  nameToUid: Map<string, string> = new Map(),
): Record<string, unknown> | null {
  if (task.workflowId) return null;

  const isMeeting = task.type === 'meeting';
  const isTerminal = task.isTerminal === true || task.statusPhase === 'terminal';
  const assigneeUid = nameToUid.get(String(task.assignedTo ?? '').toLowerCase().trim());

  return prune({
    typeId: task.typeId ?? (isMeeting ? 'meeting' : 'task'),
    workflowId: LEGACY_TASK_WORKFLOW_ID,
    status: typeof task.status === 'string' && task.status.trim() ? undefined : DEFAULT_LEGACY_STATUS,
    spaceId: task.spaceId ?? DEFAULT_SPACE_ID,
    brandIds: task.brandIds ?? (task.brand ? [task.brand] : []),
    assigneeUids: task.assigneeUids ?? (assigneeUid ? [assigneeUid] : []),
    watcherUids: task.watcherUids ?? [],
    labels: task.labels ?? [],
    fields: task.fields ?? {},
    parentId: task.parentId ?? null,
    dependsOn: task.dependsOn ?? [],
    blocks: task.blocks ?? [],
    // Legacy tasks track draftDueDate/scheduledDate (YYYY-MM-DD); the engine's
    // dueDateRequired validator and views read `dueDate`.
    dueDate: task.dueDate ?? task.draftDueDate ?? task.scheduledDate ?? null,
    approval: task.approval ?? null,
    locked: task.locked ?? false,
    completedAt: task.completedAt ?? (isTerminal ? task.publishedDate ?? task.createdAt ?? now : null),
    archivedAt: task.archivedAt ?? (task.statusId === 'archived' ? now : null),
    updatedAt: now,
    absorbedAt: now,
  });
}

// ── Campaign → work item (copy; source stays read-only until cutover) ────────

/** Legacy campaign display status → wf_campaign status id (seed-planner.ts). */
export function mapCampaignStatus(raw: unknown): string {
  const s = String(raw ?? '').toLowerCase().trim();
  const table: Record<string, string> = {
    draft: 'created',
    created: 'created',
    idea: 'created',
    planning: 'planning',
    planned: 'planning',
    'pending approval': 'approval',
    approval: 'approval',
    approved: 'approved',
    active: 'inprogress',
    live: 'inprogress',
    ongoing: 'inprogress',
    'in progress': 'inprogress',
    review: 'review',
    'in review': 'review',
    scheduled: 'scheduled',
    completed: 'completed',
    done: 'completed',
    finished: 'completed',
    archived: 'archived',
    cancelled: 'archived',
  };
  return table[s] ?? 'created';
}

const CAMPAIGN_MAPPED_KEYS = new Set([
  'id', 'name', 'brand', 'status', 'startDate', 'endDate', 'objective',
]);

export function campaignToWorkItem(id: string, data: Record<string, any>, now: string): WorkItem {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!CAMPAIGN_MAPPED_KEYS.has(k) && v !== undefined) fields[k] = v;
  }
  // The wf_campaign validators require these two on submit_for_approval.
  if (data.budget !== undefined) fields.budget = data.budget;
  if (data.objective !== undefined) fields.objective = data.objective;

  return prune({
    id,
    typeId: 'campaign',
    workflowId: 'wf_campaign',
    title: data.name ?? 'Untitled campaign',
    description: data.objective ?? '',
    spaceId: DEFAULT_SPACE_ID,
    brandIds: data.brand ? [data.brand] : [],
    status: mapCampaignStatus(data.status),
    assigneeUids: [],
    watcherUids: [],
    priority: 'normal' as Priority,
    labels: [],
    fields,
    parentId: null,
    dependsOn: [],
    blocks: [],
    startDate: data.startDate ?? null,
    dueDate: data.endDate ?? null,
    approval: null,
    locked: false,
    createdAt: data.createdAt ?? now,
    updatedAt: now,
    completedAt: mapCampaignStatus(data.status) === 'completed' ? now : null,
    archivedAt: mapCampaignStatus(data.status) === 'archived' ? now : null,
    migratedFrom: `campaigns/${id}`,
    absorbedAt: now,
  }) as unknown as WorkItem;
}

// ── Event → work item (copy; packingItems/logistics stay on events/{id}) ─────

const EVENT_MAPPED_KEYS = new Set([
  'id', 'name', 'title', 'brand', 'brands', 'status', 'startDate', 'endDate', 'description',
]);

export function eventToWorkItem(id: string, data: Record<string, any>, now: string): WorkItem {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!EVENT_MAPPED_KEYS.has(k) && v !== undefined) fields[k] = v;
  }
  // Satellite subcollections (packingItems, logistics) intentionally remain on
  // events/{id} — the work item links back via migratedFrom.

  const status = typeof data.status === 'string' && data.status.trim() ? data.status.trim() : DEFAULT_LEGACY_STATUS;

  return prune({
    id,
    typeId: 'event',
    workflowId: LEGACY_TASK_WORKFLOW_ID,
    title: data.name ?? data.title ?? 'Untitled event',
    description: data.description ?? '',
    spaceId: DEFAULT_SPACE_ID,
    brandIds: data.brands ?? (data.brand ? [data.brand] : []),
    status,
    assigneeUids: [],
    watcherUids: [],
    priority: 'normal' as Priority,
    labels: [],
    fields,
    parentId: null,
    dependsOn: [],
    blocks: [],
    startDate: data.startDate ?? null,
    dueDate: data.endDate ?? data.startDate ?? null,
    approval: null,
    locked: false,
    createdAt: data.createdAt ?? now,
    updatedAt: now,
    completedAt: null,
    archivedAt: null,
    migratedFrom: `events/${id}`,
    absorbedAt: now,
  }) as unknown as WorkItem;
}
