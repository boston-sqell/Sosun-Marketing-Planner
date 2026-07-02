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
import { recordDecision, ApprovalOutcome } from './approvals';
import { ApprovalChain } from './types';
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
  });

  return { ok: true, item };
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
    return planned;
  });

  if (decision.ok && decision.asyncOps.length > 0) {
    await dispatchAsyncOps(itemId, decision.asyncOps, actor);
  }

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
async function dispatchAsyncOps(
  itemId: string,
  ops: import('./types').PostFunction[],
  actor: TransitionActor,
): Promise<void> {
  for (const op of ops) {
    // eslint-disable-next-line no-console
    console.log(`[planner] async post-function deferred (Phase 1 stub): item=${itemId} type=${op.type} actor=${actor.uid}`);
  }
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
    return result;
  });

  // Chain resolution drives the workflow via system-initiated transitions
  // (conditions bypassed, validators still apply). Rejection bounces the item
  // (onReject); final approval advances it (onApprove).
  if (outcome.ok) {
    const sysActor = { uid: input.uid, roles: input.roles, system: true };
    if (outcome.resolution === 'rejected' && outcome.fireTransition) {
      await executeTransition(itemId, outcome.fireTransition, sysActor, now);
    } else if (outcome.resolution === 'approved' && chain.onApprove) {
      await executeTransition(itemId, chain.onApprove, sysActor, now);
    }
  }

  return outcome;
}
