/**
 * Marketing Planner — data layer (Admin SDK).
 *
 * All reads/writes go through the Admin SDK on the server, exactly like the
 * existing routes/*.ts. Client Firestore access to these collections stays
 * server-mediated (see docs/planner/spec-revisions.md §14.4).
 */

import { firestore } from 'firebase-admin';
import { db } from '../../services/firestore';
import {
  ActivityEntry,
  TransitionActor,
  TransitionDecision,
  TransitionFacts,
  WorkItem,
  Workflow,
} from './types';
import { planTransition } from './workflow';
import { appendActivity } from './activity';
import { recordDecision, canDecide, ApprovalOutcome } from './approvals';
import { selectAutomations, MAX_AUTOMATION_DEPTH } from './automations';
import { computeDueDate } from './templates';
import { enqueue, backoffSeconds, addSeconds, OUTBOX_COLLECTION, OutboxJob, OutboxRecord } from './outbox';
import { ApprovalChain, Automation, AutomationEvent, PostFunction, Template } from './types';
import { RolesConfig } from './permissions';
import { WORK_ITEMS_COLLECTION, WORKFLOWS_COLLECTION, WORK_ITEM_TYPES_COLLECTION } from './constants';

// Collection names live in ./constants so the absorption migration
// (docs/planner/spec-revisions.md §1) is a single-line change. WORK_ITEMS_COLLECTION
// is `workItems` in Phase 1 (non-destructive) and flips to `tasks` on absorption.
export { WORK_ITEMS_COLLECTION };

// ── Config reads ─────────────────────────────────────────────────────────────

export async function getWorkflow(workflowId: string): Promise<Workflow | null> {
  const snap = await db.collection(WORKFLOWS_COLLECTION).doc(workflowId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<Workflow, 'id'>) };
}

export interface WorkItemType {
  id: string;
  name: string;
  icon?: string;
  workflowId: string;
  fieldIds?: string[];
  archived?: boolean;
}

export async function getWorkItemType(typeId: string): Promise<WorkItemType | null> {
  const snap = await db.collection(WORK_ITEM_TYPES_COLLECTION).doc(typeId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<WorkItemType, 'id'>) };
}

export async function listWorkflows(): Promise<Workflow[]> {
  const snap = await db.collection(WORKFLOWS_COLLECTION).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Workflow, 'id'>) }));
}

export async function listWorkItemTypes(): Promise<WorkItemType[]> {
  const snap = await db.collection(WORK_ITEM_TYPES_COLLECTION).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkItemType, 'id'>) }));
}

export interface CustomField {
  id: string;
  label: string;
  type: string;
  options?: unknown[];
  archived?: boolean;
}

export async function listCustomFields(): Promise<CustomField[]> {
  const snap = await db.collection('customFields').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomField, 'id'>) }));
}

export async function listTemplates(): Promise<Array<{ id: string; name: string }>> {
  const snap = await db.collection('templates').get();
  return snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? d.id }));
}

/** The planner-role permission matrix (plannerConfig/roles). Null if unseeded. */
export async function getRolesConfig(): Promise<RolesConfig | null> {
  const snap = await db.collection('plannerConfig').doc('roles').get();
  if (!snap.exists) return null;
  return snap.data() as RolesConfig;
}

/** The user's configured planner role, or undefined if the profile has none. */
export async function getUserPlannerRole(uid: string): Promise<string | undefined> {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return undefined;
  const role = snap.data()?.plannerRole;
  return typeof role === 'string' && role ? role : undefined;
}

// ── Work item reads ──────────────────────────────────────────────────────────

export async function getItem(itemId: string): Promise<WorkItem | null> {
  const snap = await db.collection(WORK_ITEMS_COLLECTION).doc(itemId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<WorkItem, 'id'>) };
}

export interface ListFilter {
  spaceId?: string;
  status?: string;
  brandId?: string;
  assigneeUid?: string;
}

/**
 * List work items, newest first, with cursor pagination. Filters are applied in
 * memory (Phase 1) to avoid requiring composite indexes before the views land;
 * the §14.4 indexes move these into the query when the List view needs scale.
 */
export async function listItems(
  filter: ListFilter,
  cursor?: string,
  pageSize = 20,
): Promise<{ items: WorkItem[]; nextCursor: string | null }> {
  let query = db
    .collection(WORK_ITEMS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .orderBy(firestore.FieldPath.documentId(), 'desc');

  if (cursor) {
    const cursorDoc = await db.collection(WORK_ITEMS_COLLECTION).doc(cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snap = await query.limit(pageSize).get();
  let nextCursor: string | null = null;
  const items: WorkItem[] = [];

  for (const doc of snap.docs) {
    nextCursor = doc.id;
    const item = { id: doc.id, ...(doc.data() as Omit<WorkItem, 'id'>) };
    if (filter.spaceId && item.spaceId !== filter.spaceId) continue;
    if (filter.status && item.status !== filter.status) continue;
    if (filter.brandId && !(item.brandIds ?? []).includes(filter.brandId)) continue;
    if (filter.assigneeUid && !(item.assigneeUids ?? []).includes(filter.assigneeUid)) continue;
    items.push(item);
  }

  if (snap.docs.length < pageSize) nextCursor = null;
  return { items, nextCursor };
}

export async function getApprovalChain(chainId: string): Promise<ApprovalChain | null> {
  const snap = await db.collection('approvalChains').doc(chainId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<ApprovalChain, 'id'>) };
}

export async function getTemplate(templateId: string): Promise<Template | null> {
  const snap = await db.collection('templates').doc(templateId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<Template, 'id'>) };
}

export async function listAutomations(): Promise<Automation[]> {
  const snap = await db.collection('automations').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Automation, 'id'>) }));
}

/** Uids of users whose planner role matches — used by the assignRole action. */
async function getUidsByPlannerRole(role: string): Promise<string[]> {
  const snap = await db.collection('users').where('plannerRole', '==', role).get();
  return snap.docs.map((d) => d.id);
}

/**
 * "My Work" (spec §6): everything assigned to the actor + everything awaiting
 * their approval. Awaiting-approval requires checking each pending item's chain
 * stage against the actor's roles/uid — done here, not client-side, because the
 * chain (approverRoles) isn't carried on the item.
 */
export async function getMyWork(
  uid: string,
  roles: string[],
): Promise<{ assigned: WorkItem[]; awaitingApproval: WorkItem[] }> {
  const [assignedSnap, pendingSnap] = await Promise.all([
    db.collection(WORK_ITEMS_COLLECTION).where('assigneeUids', 'array-contains', uid).limit(100).get(),
    db.collection(WORK_ITEMS_COLLECTION).where('approval.state', '==', 'pending').limit(200).get(),
  ]);

  const assigned = assignedSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkItem, 'id'>) }));

  const chainCache = new Map<string, ApprovalChain | null>();
  const awaitingApproval: WorkItem[] = [];
  for (const doc of pendingSnap.docs) {
    const item: WorkItem = { id: doc.id, ...(doc.data() as Omit<WorkItem, 'id'>) };
    const chainId = item.approval?.chainId;
    if (!chainId) continue;
    if (!chainCache.has(chainId)) chainCache.set(chainId, await getApprovalChain(chainId));
    const chain = chainCache.get(chainId);
    const stage = chain?.stages[item.approval!.stageIndex];
    if (stage && canDecide(stage, roles, uid)) awaitingApproval.push(item);
  }

  return { assigned, awaitingApproval };
}

// ── Work item creation ───────────────────────────────────────────────────────

export interface CreateItemInput {
  typeId: string;
  title: string;
  description?: string;
  spaceId: string;
  brandIds?: string[];
  assigneeUids?: string[];
  priority?: WorkItem['priority'];
  labels?: string[];
  fields?: Record<string, unknown>;
  parentId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
}

/**
 * Create a work item. The type determines the governing workflow, which is
 * snapshotted onto the item (workflow edits don't retroactively break in-flight
 * items). The item starts at the workflow's initialStatus. A `created` activity
 * entry is written in the same transaction.
 */
export async function createItem(
  input: CreateItemInput,
  actor: TransitionActor,
  now: string,
  depth = 0,
): Promise<{ ok: true; item: WorkItem } | { ok: false; httpStatus: 400; message: string }> {
  const type = await getWorkItemType(input.typeId);
  if (!type || type.archived) {
    return { ok: false, httpStatus: 400, message: `Unknown or archived work item type "${input.typeId}".` };
  }
  const workflow = await getWorkflow(type.workflowId);
  if (!workflow) {
    return { ok: false, httpStatus: 400, message: `Work item type "${input.typeId}" references missing workflow "${type.workflowId}".` };
  }

  const ref = db.collection(WORK_ITEMS_COLLECTION).doc();
  const item: WorkItem = {
    id: ref.id,
    typeId: type.id,
    workflowId: workflow.id,
    title: input.title,
    description: input.description ?? '',
    spaceId: input.spaceId,
    brandIds: input.brandIds ?? [],
    status: workflow.initialStatus,
    assigneeUids: input.assigneeUids ?? [],
    reporterUid: actor.uid,
    watcherUids: [],
    priority: input.priority ?? 'normal',
    labels: input.labels ?? [],
    fields: input.fields ?? {},
    parentId: input.parentId ?? null,
    dependsOn: [],
    blocks: [],
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
    approval: null,
    locked: false,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    archivedAt: null,
  };

  const activity: ActivityEntry = {
    ts: now,
    actorUid: actor.uid,
    kind: 'created',
    payload: { typeId: type.id, workflowId: workflow.id, status: workflow.initialStatus },
  };

  await db.runTransaction(async (tx) => {
    tx.set(ref, item);
    appendActivity(tx, db, ref.id, activity);
    // Durable, transactional deferral: itemCreated automations run in the drainer.
    enqueue(tx, db, { type: 'automations', event: { type: 'itemCreated', typeId: type.id }, itemId: ref.id, actorUid: actor.uid, roles: actor.roles, depth }, now);
  });

  return { ok: true, item };
}

// ── Templates (spec §3.8) ────────────────────────────────────────────────────

export interface FromTemplateInput {
  spaceId: string;
  brandIds?: string[];
  titleOverride?: string;
  /** When set, the template root is created as a subtask of this item. */
  parentId?: string | null;
}

/**
 * Instantiate a template as a work-item tree: the root, then each subtask node
 * with parentId = root. Relative `dueInDays` become absolute dates. Reuses
 * createItem so each node gets its workflow snapshot + `created` audit entry
 * (and its own itemCreated automations, depth-guarded).
 */
export async function createFromTemplate(
  templateId: string,
  input: FromTemplateInput,
  actor: TransitionActor,
  now: string,
  depth = 0,
): Promise<{ ok: true; root: WorkItem; subtasks: WorkItem[] } | { ok: false; httpStatus: 400; message: string }> {
  const template = await getTemplate(templateId);
  if (!template) return { ok: false, httpStatus: 400, message: `Unknown template "${templateId}".` };

  const rootRes = await createItem(
    {
      typeId: template.root.typeId,
      title: input.titleOverride || template.root.title,
      description: template.root.description,
      spaceId: input.spaceId,
      brandIds: input.brandIds,
      priority: template.root.priority,
      fields: template.root.fields,
      parentId: input.parentId ?? null,
      dueDate: computeDueDate(now, template.root.dueInDays),
    },
    actor,
    now,
    depth,
  );
  if (!rootRes.ok) return rootRes;

  const subtasks: WorkItem[] = [];
  for (const node of template.subtasks ?? []) {
    const res = await createItem(
      {
        typeId: node.typeId,
        title: node.title,
        description: node.description,
        spaceId: input.spaceId,
        brandIds: input.brandIds,
        priority: node.priority,
        fields: node.fields,
        parentId: rootRes.item.id,
        dueDate: computeDueDate(now, node.dueInDays),
      },
      actor,
      now,
      depth,
    );
    if (res.ok) subtasks.push(res.item);
  }

  return { ok: true, root: rootRes.item, subtasks };
}

/**
 * Update non-status fields of an item. Status is deliberately NOT writable here
 * — the only way status changes is executeTransition() (spec §4). Callers must
 * strip `status`/`workflowId` before calling; this is a defensive backstop.
 */
export async function updateItemFields(
  itemId: string,
  patch: Record<string, unknown>,
  now: string,
): Promise<{ ok: true } | { ok: false; httpStatus: 404 }> {
  const ref = db.collection(WORK_ITEMS_COLLECTION).doc(itemId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, httpStatus: 404 };

  const safe = { ...patch };
  delete safe.status;
  delete safe.workflowId;
  delete safe.id;
  delete safe.createdAt;

  await ref.set({ ...safe, updatedAt: now }, { merge: true });
  return { ok: true };
}

// ── Transition executor (spec §4 steps 5–8) ──────────────────────────────────

/**
 * Gather the derived facts the pure engine can't compute from the item alone.
 * Done before the transaction; small staleness risk is acceptable for Phase 1
 * (a subtask completing in the same instant as a parent transition is rare and
 * non-destructive — worst case the transition is re-attempted).
 */
async function gatherFacts(item: WorkItem, now: string): Promise<TransitionFacts> {
  const facts: TransitionFacts = { now };

  // Attachments live in a subcollection (Storage-backed, same as product images).
  const attachmentsSnap = await db
    .collection(WORK_ITEMS_COLLECTION)
    .doc(item.id)
    .collection('attachments')
    .count()
    .get();
  facts.attachmentsCount = attachmentsSnap.data().count;

  // Subtasks: other items with parentId === this item.
  const subtaskSnap = await db.collection(WORK_ITEMS_COLLECTION).where('parentId', '==', item.id).get();
  facts.subtaskStatuses = subtaskSnap.docs.map((d) => (d.data() as WorkItem).status);

  // Dependencies: the items this one depends on.
  const depIds = item.dependsOn ?? [];
  if (depIds.length > 0) {
    const deps = await Promise.all(depIds.map((id) => getItem(id)));
    facts.dependencyStatuses = deps.filter((d): d is WorkItem => !!d).map((d) => d.status);
  } else {
    facts.dependencyStatuses = [];
  }

  return facts;
}

export interface TransitionOutcome {
  decision: TransitionDecision;
}

/**
 * Fire a transition. Reads the item + snapshotted workflow, gathers facts, then
 * runs the pure engine inside a transaction (re-reading the item so a concurrent
 * status change can't be clobbered), applies the patch, and appends the audit
 * entry atomically. Async post-functions are dispatched only after commit.
 */
export async function executeTransition(
  itemId: string,
  transitionId: string,
  actor: TransitionActor,
  now: string,
  depth = 0,
): Promise<TransitionDecision> {
  const item = await getItem(itemId);
  if (!item) return { ok: false, httpStatus: 404, code: 'transition_not_found' };

  const workflow = await getWorkflow(item.workflowId);
  if (!workflow) return { ok: false, httpStatus: 400, code: 'invalid_from_status' };

  const facts = await gatherFacts(item, now);
  const ref = db.collection(WORK_ITEMS_COLLECTION).doc(itemId);

  const decision = await db.runTransaction<TransitionDecision>(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return { ok: false, httpStatus: 404, code: 'transition_not_found' };

    const freshItem: WorkItem = { id: fresh.id, ...(fresh.data() as Omit<WorkItem, 'id'>) };
    const planned = planTransition(workflow, freshItem, transitionId, { actor, facts });
    if (!planned.ok) return planned;

    tx.update(ref, { ...planned.patch, updatedAt: now });
    appendActivity(tx, db, itemId, planned.activity);

    // Defer side effects transactionally (spec §4 steps 7-8): async post-
    // functions and statusEntered automations run in the outbox drainer, so a
    // committed transition can never lose them.
    if (planned.asyncOps.length > 0) {
      enqueue(tx, db, { type: 'asyncOps', itemId, ops: planned.asyncOps, actorUid: actor.uid, roles: actor.roles, depth }, now);
    }
    enqueue(tx, db, { type: 'automations', event: { type: 'statusEntered', statusId: planned.toStatus, typeId: freshItem.typeId }, itemId, actorUid: actor.uid, roles: actor.roles, depth }, now);
    return planned;
  });

  return decision;
}

/**
 * Run post-commit post-functions (notify, webhook, createWorkItems, assignRole,
 * archiveAssets).
 *
 * PHASE 1 STUB: these are logged, not executed. They are deliberately deferred —
 * notify/webhook land with §9 (Phase 6), createWorkItems/assignRole with the
 * automation + template layer (Phase 4). Critically, running them here (after
 * the transaction commits) is the known atomicity gap called out in the review
 * (open item #1): a committed transition could lose its side effect if this
 * throws. The real implementation must be a durable outbox with retry, not an
 * inline call. Kept as a no-op-with-log so the engine ships honestly.
 */
/**
 * Execute a transition's async post-functions (run by the outbox drainer).
 * assignRole/createWorkItems now actually run; notify/webhook/archiveAssets
 * remain logged stubs until the email/webhook channels land (spec §9).
 */
async function executeAsyncOps(
  itemId: string,
  ops: PostFunction[],
  actor: TransitionActor,
  now: string,
  depth: number,
): Promise<void> {
  const item = await getItem(itemId);
  if (!item) return;
  const ref = db.collection(WORK_ITEMS_COLLECTION).doc(itemId);

  for (const op of ops) {
    switch (op.type) {
      case 'assignRole': {
        const uids = await getUidsByPlannerRole(op.role);
        if (uids.length > 0) {
          const merged = Array.from(new Set([...(item.assigneeUids ?? []), ...uids]));
          await ref.set({ assigneeUids: merged, updatedAt: now }, { merge: true });
        }
        break;
      }
      case 'createWorkItems':
        await createFromTemplate(
          op.templateId,
          { spaceId: item.spaceId, brandIds: item.brandIds, parentId: op.linkAsSubtasks ? itemId : null },
          actor,
          now,
          depth + 1,
        );
        break;
      case 'notify':
      case 'webhook':
      case 'archiveAssets':
        // eslint-disable-next-line no-console
        console.log(`[planner] async op ${op.type} deferred (channel stub): item=${itemId}`);
        break;
      default:
        break;
    }
  }
}

// ── Outbox drainer (spec-revisions §14.3) ────────────────────────────────────

/** Execute one outbox job by dispatching to the right executor. */
async function executeJob(job: OutboxJob, now: string): Promise<void> {
  const actor: TransitionActor = { uid: job.actorUid, roles: job.roles };
  switch (job.type) {
    case 'asyncOps':
      await executeAsyncOps(job.itemId, job.ops, actor, now, job.depth);
      break;
    case 'automations': {
      const item = await getItem(job.itemId);
      if (item) await runAutomations(job.event, item, actor, now, job.depth);
      break;
    }
    case 'transition':
      await executeTransition(job.itemId, job.transitionId, { ...actor, system: job.system }, now, job.depth);
      break;
  }
}

/**
 * Drain due outbox jobs (called by the Cloud Scheduler endpoint). Claims each
 * job (pending → processing) in a transaction so concurrent drainers don't
 * double-run, executes it, then marks done or reschedules with backoff up to
 * maxAttempts. At-least-once: a job may retry, so actions should be idempotent
 * (createWorkItems is not yet — a known limitation tracked for a follow-up).
 */
export async function drainOutbox(
  now: string,
  limit = 50,
): Promise<{ processed: number; done: number; failed: number; retried: number }> {
  const snap = await db
    .collection(OUTBOX_COLLECTION)
    .where('status', '==', 'pending')
    .where('nextAttemptAt', '<=', now)
    .orderBy('nextAttemptAt', 'asc')
    .limit(limit)
    .get();

  let done = 0;
  let failed = 0;
  let retried = 0;

  for (const doc of snap.docs) {
    const claimed = await db.runTransaction<OutboxRecord | null>(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists) return null;
      const rec = fresh.data() as OutboxRecord;
      if (rec.status !== 'pending') return null;
      tx.update(doc.ref, { status: 'processing', updatedAt: now });
      return rec;
    });
    if (!claimed) continue;

    try {
      await executeJob(claimed.job, now);
      await doc.ref.update({ status: 'done', updatedAt: now });
      done++;
    } catch (err: any) {
      const attempts = (claimed.attempts ?? 0) + 1;
      const maxAttempts = claimed.maxAttempts ?? 5;
      const lastError = String(err?.message ?? err).slice(0, 500);
      if (attempts >= maxAttempts) {
        await doc.ref.update({ status: 'failed', attempts, lastError, updatedAt: now });
        failed++;
      } else {
        await doc.ref.update({
          status: 'pending',
          attempts,
          lastError,
          nextAttemptAt: addSeconds(now, backoffSeconds(attempts)),
          updatedAt: now,
        });
        retried++;
      }
    }
  }

  return { processed: snap.size, done, failed, retried };
}

// ── Automations (spec §3.7) ──────────────────────────────────────────────────

/**
 * Evaluate and run automations for an event. Loop-protected by `depth`:
 * automation-initiated creations/transitions increment it, and evaluation stops
 * once MAX_AUTOMATION_DEPTH is reached.
 */
export async function runAutomations(
  event: AutomationEvent,
  item: WorkItem,
  actor: TransitionActor,
  now: string,
  depth: number,
): Promise<void> {
  if (depth >= MAX_AUTOMATION_DEPTH) return;

  const selected = selectAutomations(await listAutomations(), event, item);
  for (const auto of selected) {
    await runAutomationActions(auto, item, actor, now, depth);
  }
}

/**
 * Execute one automation's actions. Item-mutating actions (setField, setDueDate,
 * assignRole) are merged into a single write; createWorkItems instantiates a
 * template (depth + 1); notify/webhook remain the logged stub until the Firestore
 * outbox lands. An `automationRun` audit entry is appended.
 *
 * NOTE: these effects run after the triggering mutation committed and are NOT in
 * the same transaction — the known atomicity gap (the outbox will close it).
 */
async function runAutomationActions(
  auto: Automation,
  item: WorkItem,
  actor: TransitionActor,
  now: string,
  depth: number,
): Promise<void> {
  const ref = db.collection(WORK_ITEMS_COLLECTION).doc(item.id);
  const patch: Record<string, unknown> = {};
  const assigneeAdds: string[] = [];

  for (const action of auto.actions) {
    switch (action.type) {
      case 'setField':
        patch.fields = { ...((patch.fields as object) ?? item.fields ?? {}), [action.fieldId]: action.value };
        break;
      case 'setDueDate':
        patch.dueDate = computeDueDate(now, action.relativeDays);
        break;
      case 'assignRole':
        assigneeAdds.push(...(await getUidsByPlannerRole(action.role)));
        break;
      case 'createWorkItems':
        await createFromTemplate(
          action.templateId,
          { spaceId: item.spaceId, brandIds: item.brandIds, parentId: action.linkAsSubtasks ? item.id : null },
          actor,
          now,
          depth + 1,
        );
        break;
      case 'notify':
      case 'webhook':
        // eslint-disable-next-line no-console
        console.log(`[planner] automation ${auto.id} ${action.type} deferred (outbox stub): item=${item.id}`);
        break;
    }
  }

  if (assigneeAdds.length > 0) {
    patch.assigneeUids = Array.from(new Set([...(item.assigneeUids ?? []), ...assigneeAdds]));
  }
  if (Object.keys(patch).length > 0) {
    await ref.set({ ...patch, updatedAt: now }, { merge: true });
  }

  await ref.collection('activity').add({
    ts: now,
    actorUid: 'system',
    kind: 'automationRun',
    payload: { automationId: auto.id, name: auto.name, actions: auto.actions.map((a) => a.type) },
  });
}

// ── Approval decisions (spec §3.5, §6) ───────────────────────────────────────

export interface ApprovalDecisionInput {
  uid: string;
  /** Actor's roles (identity claim + planner role) for approver eligibility. */
  roles: string[];
  decision: 'approve' | 'reject';
  comment?: string;
}

/**
 * Record an approve/reject decision on an item's in-progress approval. The pure
 * chain logic (eligibility, thresholds, stage progression) lives in
 * approvals.ts; this executor loads the chain, applies the decision + audit
 * entry in a transaction, and — if the chain is rejected — fires the chain's
 * onReject transition as a system-initiated move (bypassing conditions).
 */
export async function executeApprovalDecision(
  itemId: string,
  input: ApprovalDecisionInput,
  now: string,
): Promise<ApprovalOutcome> {
  const item = await getItem(itemId);
  if (!item) return { ok: false, httpStatus: 404, code: 'not_found' };
  if (!item.approval || !item.approval.chainId) {
    return { ok: false, httpStatus: 409, code: 'no_approval_in_progress' };
  }

  const chain = await getApprovalChain(item.approval.chainId);
  if (!chain) return { ok: false, httpStatus: 409, code: 'approval_chain_missing' };

  const ref = db.collection(WORK_ITEMS_COLLECTION).doc(itemId);

  const outcome = await db.runTransaction<ApprovalOutcome>(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return { ok: false, httpStatus: 404, code: 'not_found' };
    const freshItem: WorkItem = { id: fresh.id, ...(fresh.data() as Omit<WorkItem, 'id'>) };
    if (!freshItem.approval || freshItem.approval.state !== 'pending') {
      return { ok: false, httpStatus: 409, code: 'no_approval_in_progress' };
    }

    const result = recordDecision(chain, freshItem.approval, { ...input, now });
    if (!result.ok) return result;

    tx.update(ref, { approval: result.approval, updatedAt: now });
    appendActivity(tx, db, itemId, {
      ts: now,
      actorUid: input.uid,
      kind: 'approvalDecision',
      payload: {
        decision: input.decision,
        stageIndex: freshItem.approval.stageIndex,
        resolution: result.resolution,
        comment: input.comment?.trim() || null,
      },
    });

    // Chain resolution drives the workflow via a system transition, enqueued
    // in THIS transaction so the follow-on move can't be lost: rejection bounces
    // the item (onReject); final approval advances it (onApprove).
    const followOn =
      result.resolution === 'rejected' ? chain.onReject : result.resolution === 'approved' ? chain.onApprove : undefined;
    if (followOn) {
      enqueue(tx, db, { type: 'transition', itemId, transitionId: followOn, actorUid: input.uid, roles: input.roles, system: true, depth: 0 }, now);
    }
    return result;
  });

  return outcome;
}
