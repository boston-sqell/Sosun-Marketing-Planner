/**
 * Marketing Planner — workflow engine (pure).
 *
 * The single most important rule (spec §4): statuses hold NO logic. Everything
 * — who may move an item, whether it may move, and what happens when it does —
 * lives on transitions. The only way an item changes status is a transition
 * fired through this engine; direct status edits are forbidden by the routes.
 *
 * planTransition() is a pure function: (workflow, item, transitionId, ctx) → a
 * decision describing either a rejection (with the right HTTP status) or an
 * accepted plan (the new status, an in-transaction patch, async post-functions
 * to enqueue, and the audit entry). It touches no Firestore and no clock — the
 * caller injects `now` — so the whole transition matrix is unit-testable.
 */

import {
  Condition,
  ItemPatch,
  PostFunction,
  Transition,
  TransitionActor,
  TransitionDecision,
  TransitionFacts,
  ValidationError,
  Validator,
  WorkItem,
  Workflow,
} from './types';

// ── Lookups ──────────────────────────────────────────────────────────────────

export function getTransition(workflow: Workflow, transitionId: string): Transition | undefined {
  return workflow.transitions.find((t) => t.id === transitionId);
}

function isDoneStatus(workflow: Workflow, statusId: string): boolean {
  return workflow.statuses.find((s) => s.id === statusId)?.category === 'done';
}

function statusExists(workflow: Workflow, statusId: string): boolean {
  return workflow.statuses.some((s) => s.id === statusId);
}

// ── Conditions (who may fire) ────────────────────────────────────────────────

function conditionPasses(condition: Condition, item: WorkItem, actor: TransitionActor): boolean {
  switch (condition.type) {
    case 'role':
      return actor.roles.some((r) => condition.roles.includes(r));
    case 'assignee':
      return (item.assigneeUids ?? []).includes(actor.uid);
    case 'reporter':
      return item.reporterUid === actor.uid;
    case 'spaceMember':
      return (actor.spaceIds ?? []).includes(item.spaceId);
    default:
      // Exhaustive in practice; unknown condition type fails closed.
      return false;
  }
}

/**
 * Every condition must pass (AND). No conditions ⇒ open to anyone. A
 * system-initiated actor bypasses conditions entirely (validators still apply).
 */
export function evaluateConditions(
  conditions: Condition[] | undefined,
  item: WorkItem,
  actor: TransitionActor,
): boolean {
  if (actor.system) return true;
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => conditionPasses(c, item, actor));
}

// ── Validators (may it fire) ─────────────────────────────────────────────────

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function validatorError(
  validator: Validator,
  item: WorkItem,
  facts: TransitionFacts,
  workflow: Workflow,
): ValidationError | null {
  switch (validator.type) {
    case 'fieldRequired':
      return isEmpty(item.fields?.[validator.fieldId])
        ? { field: validator.fieldId, message: `Field "${validator.fieldId}" is required.` }
        : null;
    case 'descriptionRequired':
      return isEmpty(item.description)
        ? { field: 'description', message: 'A description is required.' }
        : null;
    case 'attachmentRequired':
      return (facts.attachmentsCount ?? 0) < 1
        ? { field: 'attachments', message: 'At least one attachment is required.' }
        : null;
    case 'dueDateRequired':
      return isEmpty(item.dueDate)
        ? { field: 'dueDate', message: 'A due date is required.' }
        : null;
    case 'subtasksDone': {
      const statuses = facts.subtaskStatuses ?? [];
      const allDone = statuses.every((s) => isDoneStatus(workflow, s));
      return allDone ? null : { field: 'subtasks', message: 'All subtasks must be completed first.' };
    }
    case 'dependenciesDone': {
      const statuses = facts.dependencyStatuses ?? [];
      const allDone = statuses.every((s) => isDoneStatus(workflow, s));
      return allDone ? null : { field: 'dependsOn', message: 'All dependencies must be completed first.' };
    }
    case 'approvalComplete':
      return item.approval?.state === 'approved'
        ? null
        : { field: 'approval', message: 'Approval is not complete.' };
    default:
      return { message: 'Unknown validator.' };
  }
}

/** Returns the list of validation errors ([] ⇒ all validators pass). */
export function evaluateValidators(
  validators: Validator[] | undefined,
  item: WorkItem,
  facts: TransitionFacts,
  workflow: Workflow,
): ValidationError[] {
  if (!validators || validators.length === 0) return [];
  const errors: ValidationError[] = [];
  for (const v of validators) {
    const err = validatorError(v, item, facts, workflow);
    if (err) errors.push(err);
  }
  return errors;
}

// ── Post-functions ───────────────────────────────────────────────────────────

const ASYNC_POST_FUNCTIONS = new Set<PostFunction['type']>([
  'assignRole',
  'createWorkItems',
  'notify',
  'webhook',
  'archiveAssets',
]);

export function isAsyncPostFunction(fn: PostFunction): boolean {
  return ASYNC_POST_FUNCTIONS.has(fn.type);
}

/** Add a value to an array patch field without duplicating. */
function addToArray(patch: ItemPatch, key: string, value: string): void {
  const existing = (patch[key] as string[] | undefined) ?? [];
  if (!existing.includes(value)) patch[key] = [...existing, value];
  else patch[key] = existing;
}

/**
 * Fold the inline post-functions into a patch applied in-transaction. Async
 * post-functions are returned untouched for the executor to enqueue.
 */
function applyInlinePostFunctions(
  postFunctions: PostFunction[] | undefined,
  toStatus: string,
  workflow: Workflow,
  facts: TransitionFacts,
): { patch: ItemPatch; asyncOps: PostFunction[] } {
  const patch: ItemPatch = { status: toStatus };
  const asyncOps: PostFunction[] = [];

  // Entering a `done` status stamps completedAt; leaving it clears it.
  if (isDoneStatus(workflow, toStatus)) patch.completedAt = facts.now;

  for (const fn of postFunctions ?? []) {
    if (isAsyncPostFunction(fn)) {
      asyncOps.push(fn);
      continue;
    }
    switch (fn.type) {
      case 'setField':
        patch.fields = { ...((patch.fields as object) ?? {}), [fn.fieldId]: fn.value };
        break;
      case 'assignUser':
        addToArray(patch, 'assigneeUids', fn.uid);
        break;
      case 'setDueDate': {
        const due = new Date(facts.now);
        due.setUTCDate(due.getUTCDate() + fn.relativeDays);
        patch.dueDate = due.toISOString().slice(0, 10); // YYYY-MM-DD
        break;
      }
      case 'lockEditing':
        patch.locked = true;
        break;
      case 'unlockEditing':
        patch.locked = false;
        break;
      case 'startApproval':
        patch.approval = {
          chainId: fn.approvalChainId,
          stageIndex: 0,
          decisions: [],
          state: 'pending',
        };
        break;
    }
  }

  return { patch, asyncOps };
}

// ── The one entry point ──────────────────────────────────────────────────────

export interface TransitionEvalContext {
  actor: TransitionActor;
  facts: TransitionFacts;
}

/**
 * Pure transition planner (spec §4 steps 1–4 + the inline part of 5). Returns a
 * decision; the executor (data.ts) is responsible for the Firestore transaction,
 * appending the returned activity entry, and enqueuing the async ops.
 */
export function planTransition(
  workflow: Workflow,
  item: WorkItem,
  transitionId: string,
  ctx: TransitionEvalContext,
): TransitionDecision {
  const { actor, facts } = ctx;

  // 1–2. Find transition; verify the item's current status is a valid source.
  const transition = getTransition(workflow, transitionId);
  if (!transition) {
    return { ok: false, httpStatus: 404, code: 'transition_not_found' };
  }
  if (!transition.from.includes(item.status)) {
    return { ok: false, httpStatus: 400, code: 'invalid_from_status' };
  }
  // Defensive: a transition pointing at a status the workflow doesn't define is
  // a config error, not a client error — treat as invalid.
  if (!statusExists(workflow, transition.to)) {
    return { ok: false, httpStatus: 400, code: 'invalid_from_status' };
  }

  // 3. Conditions (who may fire) → 403.
  if (!evaluateConditions(transition.conditions, item, actor)) {
    return { ok: false, httpStatus: 403, code: 'forbidden' };
  }

  // 4. Validators (may it fire) → 422 with field-level errors.
  const errors = evaluateValidators(transition.validators, item, facts, workflow);
  if (errors.length > 0) {
    return { ok: false, httpStatus: 422, code: 'validation_failed', errors };
  }

  // 5 (inline part). Build the patch + collect async ops.
  const { patch, asyncOps } = applyInlinePostFunctions(transition.postFunctions, transition.to, workflow, facts);

  const activity = {
    ts: facts.now,
    actorUid: actor.uid,
    kind: 'transition' as const,
    payload: {
      transitionId: transition.id,
      transitionName: transition.name,
      from: item.status,
      to: transition.to,
    },
  };

  return { ok: true, toStatus: transition.to, patch, asyncOps, activity };
}

/**
 * Which transitions the actor may currently see/fire from the item's status
 * (conditions pass; source matches). Validators are NOT evaluated here — the UI
 * uses this to render available buttons, then shows validator failures on click
 * (spec §5 Kanban: invalid targets render disabled with the failing validator).
 */
export function availableTransitions(
  workflow: Workflow,
  item: WorkItem,
  actor: TransitionActor,
): Transition[] {
  return workflow.transitions.filter(
    (t) => t.from.includes(item.status) && evaluateConditions(t.conditions, item, actor),
  );
}
