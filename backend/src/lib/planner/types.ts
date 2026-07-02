/**
 * Marketing Planner — engine types.
 *
 * These are the interfaces backing the workflow engine (workflow.ts), the
 * data layer (data.ts), the activity audit (activity.ts) and the routes.
 * They mirror the spec §3 data model, retargeted to this repo's Admin-SDK
 * server-only access pattern. Nothing here touches Firestore — the engine is
 * a set of pure functions over these shapes so it is unit-testable in
 * isolation (see __tests__/planner-workflow.test.ts).
 */

// ── Workflow definition (workflows/{workflowId}) ─────────────────────────────

export type StatusCategory = 'todo' | 'in_progress' | 'done';

export interface WorkflowStatus {
  id: string;
  name: string;
  category: StatusCategory;
  color: string;
  /** Fields the generic `fieldRequired` validator enforces on entry (§4.3). */
  requiredFieldIds?: string[];
}

/** A condition gates who may see / fire a transition. */
export type Condition =
  | { type: 'role'; roles: string[] }
  | { type: 'assignee' }
  | { type: 'reporter' }
  | { type: 'spaceMember' };

/** A validator gates whether a transition may fire given the item's state. */
export type Validator =
  | { type: 'fieldRequired'; fieldId: string }
  | { type: 'descriptionRequired' }
  | { type: 'attachmentRequired' }
  | { type: 'dueDateRequired' }
  | { type: 'subtasksDone' }
  | { type: 'dependenciesDone' }
  | { type: 'approvalComplete' };

/**
 * A post-function is a side effect that runs after a transition fires.
 * `inline` functions mutate the item document inside the same transaction as
 * the status change; `async` functions are enqueued to run after commit.
 * classifyPostFunction() in workflow.ts decides which is which.
 */
export type PostFunction =
  | { type: 'setField'; fieldId: string; value: unknown }
  | { type: 'assignUser'; uid: string }
  | { type: 'setDueDate'; relativeDays: number }
  | { type: 'lockEditing' }
  | { type: 'unlockEditing' }
  | { type: 'startApproval'; approvalChainId: string }
  // async (need a DB round-trip or an external call):
  | { type: 'assignRole'; role: string }
  | { type: 'createWorkItems'; templateId: string; linkAsSubtasks?: boolean }
  | { type: 'notify'; audience: string; template: string }
  | { type: 'webhook'; url: string }
  | { type: 'archiveAssets' };

export interface Transition {
  id: string;
  name: string;
  from: string[];
  to: string;
  conditions?: Condition[];
  validators?: Validator[];
  postFunctions?: PostFunction[];
}

export interface Workflow {
  id: string;
  name: string;
  statuses: WorkflowStatus[];
  transitions: Transition[];
  initialStatus: string;
}

// ── Work item (workItems/{itemId}) ───────────────────────────────────────────

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export interface ApprovalState {
  chainId: string;
  stageIndex: number;
  decisions: Array<{ uid: string; decision: 'approve' | 'reject'; comment?: string; ts: string }>;
  state: 'pending' | 'approved' | 'rejected';
}

export interface WorkItem {
  id: string;
  typeId: string;
  /** Snapshotted at creation — workflow edits don't break in-flight items. */
  workflowId: string;
  title: string;
  description?: string;
  spaceId: string;
  brandIds?: string[];
  /** Current workflow status id. Only ever changed via requestTransition. */
  status: string;
  assigneeUids?: string[];
  reporterUid?: string;
  watcherUids?: string[];
  priority?: Priority;
  labels?: string[];
  fields?: Record<string, unknown>;
  parentId?: string | null;
  dependsOn?: string[];
  blocks?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  approval?: ApprovalState | null;
  locked?: boolean;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  archivedAt?: string | null;
}

// ── Activity audit (workItems/{id}/activity/{entryId}) ───────────────────────

export type ActivityKind =
  | 'created'
  | 'transition'
  | 'fieldChanged'
  | 'commentAdded'
  | 'fileAdded'
  | 'approvalDecision'
  | 'automationRun'
  | 'assigned';

export interface ActivityEntry {
  ts: string;
  actorUid: string;
  kind: ActivityKind;
  payload: Record<string, unknown>;
}

// ── Engine I/O ───────────────────────────────────────────────────────────────

/** Everything the engine knows about the actor firing a transition. */
export interface TransitionActor {
  uid: string;
  /** The coarse identity claim(s) + resolved planner role — matched by `role` conditions. */
  roles: string[];
  /** Space ids the actor belongs to — matched by the `spaceMember` condition. */
  spaceIds?: string[];
}

/**
 * Derived facts the engine cannot compute from the item alone (they require
 * querying other documents). The executor gathers these before calling the
 * engine so the engine stays pure.
 */
export interface TransitionFacts {
  attachmentsCount?: number;
  /** Statuses of this item's subtasks. */
  subtaskStatuses?: string[];
  /** Statuses of the items this one depends on. */
  dependencyStatuses?: string[];
  /** ISO timestamp treated as "now" (injected for determinism/testability). */
  now: string;
}

export interface ValidationError {
  field?: string;
  message: string;
}

/** A patch of fields to merge onto the item document inside the transaction. */
export type ItemPatch = Record<string, unknown>;

export type TransitionDecision =
  | {
      ok: false;
      /** HTTP status the route should return. */
      httpStatus: 400 | 403 | 404 | 422;
      code: 'transition_not_found' | 'invalid_from_status' | 'forbidden' | 'validation_failed';
      errors?: ValidationError[];
    }
  | {
      ok: true;
      toStatus: string;
      /** Inline mutations to apply to the item in-transaction. */
      patch: ItemPatch;
      /** Post-functions to run after commit (notify, webhook, createWorkItems, assignRole). */
      asyncOps: PostFunction[];
      /** Audit entry to append in the same transaction. */
      activity: ActivityEntry;
    };
