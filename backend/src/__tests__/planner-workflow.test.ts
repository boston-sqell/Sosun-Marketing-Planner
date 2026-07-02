import { describe, it, expect } from 'vitest';
import {
  planTransition,
  evaluateConditions,
  evaluateValidators,
  availableTransitions,
  getTransition,
  isAsyncPostFunction,
} from '../lib/planner/workflow';
import { WorkItem, Workflow, TransitionActor, TransitionFacts } from '../lib/planner/types';

/*
 * Unit tests for the pure workflow engine (planTransition + helpers).
 * No Firestore, no clock — `now` is injected via facts — so the whole
 * transition matrix is exercised deterministically, the same way rbac.test.ts
 * exercises checkPermission.
 */

const NOW = '2026-07-02T10:00:00.000Z';

const WF: Workflow = {
  id: 'wf_test',
  name: 'Test workflow',
  initialStatus: 'created',
  statuses: [
    { id: 'created', name: 'Created', category: 'todo', color: '#000' },
    { id: 'planning', name: 'Planning', category: 'todo', color: '#000' },
    { id: 'approval', name: 'Pending Approval', category: 'in_progress', color: '#000' },
    { id: 'completed', name: 'Completed', category: 'done', color: '#000' },
  ],
  transitions: [
    {
      id: 'start_planning',
      name: 'Start planning',
      from: ['created'],
      to: 'planning',
      conditions: [{ type: 'role', roles: ['admin', 'internal'] }],
    },
    {
      id: 'submit',
      name: 'Submit for approval',
      from: ['planning'],
      to: 'approval',
      conditions: [{ type: 'role', roles: ['admin', 'internal'] }],
      validators: [
        { type: 'fieldRequired', fieldId: 'budget' },
        { type: 'descriptionRequired' },
      ],
      postFunctions: [
        { type: 'lockEditing' },
        { type: 'setDueDate', relativeDays: 7 },
        { type: 'startApproval', approvalChainId: 'chain_a' },
        { type: 'notify', audience: 'approvers', template: 'approval_requested' },
      ],
    },
    {
      id: 'complete',
      name: 'Complete',
      from: ['approval'],
      to: 'completed',
      validators: [{ type: 'subtasksDone' }, { type: 'approvalComplete' }],
    },
    {
      id: 'assignee_only',
      name: 'Assignee-only move',
      from: ['created'],
      to: 'planning',
      conditions: [{ type: 'assignee' }],
    },
  ],
};

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'item1',
    typeId: 'campaign',
    workflowId: 'wf_test',
    title: 'Test',
    spaceId: 'marketing',
    status: 'created',
    assigneeUids: [],
    reporterUid: 'reporter1',
    fields: {},
    dependsOn: [],
    ...overrides,
  };
}

const admin: TransitionActor = { uid: 'admin1', roles: ['admin'] };
const agency: TransitionActor = { uid: 'agency1', roles: ['agency'] };
const facts = (o: Partial<TransitionFacts> = {}): TransitionFacts => ({ now: NOW, ...o });

// ── Conditions ────────────────────────────────────────────────────────────────

describe('evaluateConditions', () => {
  it('passes when no conditions', () => {
    expect(evaluateConditions(undefined, item(), agency)).toBe(true);
    expect(evaluateConditions([], item(), agency)).toBe(true);
  });

  it('role condition matches any of the actor roles', () => {
    const c = [{ type: 'role' as const, roles: ['admin', 'internal'] }];
    expect(evaluateConditions(c, item(), admin)).toBe(true);
    expect(evaluateConditions(c, item(), agency)).toBe(false);
  });

  it('assignee condition checks membership in assigneeUids', () => {
    const c = [{ type: 'assignee' as const }];
    expect(evaluateConditions(c, item({ assigneeUids: ['agency1'] }), agency)).toBe(true);
    expect(evaluateConditions(c, item({ assigneeUids: ['someone'] }), agency)).toBe(false);
  });

  it('reporter condition checks reporterUid', () => {
    const c = [{ type: 'reporter' as const }];
    expect(evaluateConditions(c, item({ reporterUid: 'agency1' }), agency)).toBe(true);
    expect(evaluateConditions(c, item({ reporterUid: 'other' }), agency)).toBe(false);
  });

  it('spaceMember condition checks actor spaceIds', () => {
    const c = [{ type: 'spaceMember' as const }];
    expect(evaluateConditions(c, item({ spaceId: 'marketing' }), { ...agency, spaceIds: ['marketing'] })).toBe(true);
    expect(evaluateConditions(c, item({ spaceId: 'marketing' }), { ...agency, spaceIds: ['events'] })).toBe(false);
  });

  it('ANDs multiple conditions', () => {
    const c = [
      { type: 'role' as const, roles: ['agency'] },
      { type: 'assignee' as const },
    ];
    expect(evaluateConditions(c, item({ assigneeUids: ['agency1'] }), agency)).toBe(true);
    expect(evaluateConditions(c, item({ assigneeUids: [] }), agency)).toBe(false);
  });
});

// ── Validators ────────────────────────────────────────────────────────────────

describe('evaluateValidators', () => {
  it('fieldRequired fails on missing/empty field', () => {
    const v = [{ type: 'fieldRequired' as const, fieldId: 'budget' }];
    expect(evaluateValidators(v, item({ fields: {} }), facts(), WF)).toHaveLength(1);
    expect(evaluateValidators(v, item({ fields: { budget: '' } }), facts(), WF)).toHaveLength(1);
    expect(evaluateValidators(v, item({ fields: { budget: 0 } }), facts(), WF)).toHaveLength(0);
    expect(evaluateValidators(v, item({ fields: { budget: 25000 } }), facts(), WF)).toHaveLength(0);
  });

  it('descriptionRequired fails on empty description', () => {
    const v = [{ type: 'descriptionRequired' as const }];
    expect(evaluateValidators(v, item({ description: '' }), facts(), WF)).toHaveLength(1);
    expect(evaluateValidators(v, item({ description: '  ' }), facts(), WF)).toHaveLength(1);
    expect(evaluateValidators(v, item({ description: 'A plan' }), facts(), WF)).toHaveLength(0);
  });

  it('dueDateRequired fails without a due date', () => {
    const v = [{ type: 'dueDateRequired' as const }];
    expect(evaluateValidators(v, item({ dueDate: null }), facts(), WF)).toHaveLength(1);
    expect(evaluateValidators(v, item({ dueDate: '2026-08-01' }), facts(), WF)).toHaveLength(0);
  });

  it('attachmentRequired uses the injected attachment count', () => {
    const v = [{ type: 'attachmentRequired' as const }];
    expect(evaluateValidators(v, item(), facts({ attachmentsCount: 0 }), WF)).toHaveLength(1);
    expect(evaluateValidators(v, item(), facts({ attachmentsCount: 2 }), WF)).toHaveLength(0);
  });

  it('subtasksDone requires all subtasks in a done-category status', () => {
    const v = [{ type: 'subtasksDone' as const }];
    expect(evaluateValidators(v, item(), facts({ subtaskStatuses: ['completed', 'planning'] }), WF)).toHaveLength(1);
    expect(evaluateValidators(v, item(), facts({ subtaskStatuses: ['completed', 'completed'] }), WF)).toHaveLength(0);
    expect(evaluateValidators(v, item(), facts({ subtaskStatuses: [] }), WF)).toHaveLength(0);
  });

  it('dependenciesDone requires all dependencies done', () => {
    const v = [{ type: 'dependenciesDone' as const }];
    expect(evaluateValidators(v, item(), facts({ dependencyStatuses: ['planning'] }), WF)).toHaveLength(1);
    expect(evaluateValidators(v, item(), facts({ dependencyStatuses: ['completed'] }), WF)).toHaveLength(0);
  });

  it('approvalComplete requires approval.state === approved', () => {
    const v = [{ type: 'approvalComplete' as const }];
    expect(evaluateValidators(v, item({ approval: null }), facts(), WF)).toHaveLength(1);
    expect(
      evaluateValidators(
        v,
        item({ approval: { chainId: 'c', stageIndex: 0, decisions: [], state: 'pending' } }),
        facts(),
        WF,
      ),
    ).toHaveLength(1);
    expect(
      evaluateValidators(
        v,
        item({ approval: { chainId: 'c', stageIndex: 1, decisions: [], state: 'approved' } }),
        facts(),
        WF,
      ),
    ).toHaveLength(0);
  });

  it('collects multiple validator errors', () => {
    const v = [
      { type: 'fieldRequired' as const, fieldId: 'budget' },
      { type: 'descriptionRequired' as const },
    ];
    expect(evaluateValidators(v, item({ fields: {}, description: '' }), facts(), WF)).toHaveLength(2);
  });
});

// ── Post-function classification ──────────────────────────────────────────────

describe('isAsyncPostFunction', () => {
  it('classifies inline vs async', () => {
    expect(isAsyncPostFunction({ type: 'lockEditing' })).toBe(false);
    expect(isAsyncPostFunction({ type: 'setField', fieldId: 'x', value: 1 })).toBe(false);
    expect(isAsyncPostFunction({ type: 'notify', audience: 'a', template: 't' })).toBe(true);
    expect(isAsyncPostFunction({ type: 'webhook', url: 'http://x' })).toBe(true);
    expect(isAsyncPostFunction({ type: 'createWorkItems', templateId: 't' })).toBe(true);
  });
});

// ── planTransition: rejections ────────────────────────────────────────────────

describe('planTransition — rejections', () => {
  it('404 when the transition id is unknown', () => {
    const d = planTransition(WF, item(), 'nope', { actor: admin, facts: facts() });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.httpStatus).toBe(404);
      expect(d.code).toBe('transition_not_found');
    }
  });

  it('400 when the item is not in a valid source status', () => {
    const d = planTransition(WF, item({ status: 'approval' }), 'start_planning', { actor: admin, facts: facts() });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.httpStatus).toBe(400);
      expect(d.code).toBe('invalid_from_status');
    }
  });

  it('403 when conditions fail', () => {
    const d = planTransition(WF, item(), 'start_planning', { actor: agency, facts: facts() });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.httpStatus).toBe(403);
      expect(d.code).toBe('forbidden');
    }
  });

  it('422 with field errors when validators fail', () => {
    const d = planTransition(WF, item({ status: 'planning', fields: {}, description: '' }), 'submit', {
      actor: admin,
      facts: facts(),
    });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.httpStatus).toBe(422);
      expect(d.code).toBe('validation_failed');
      expect(d.errors?.map((e) => e.field)).toEqual(['budget', 'description']);
    }
  });

  it('checks conditions BEFORE validators (403 wins over 422)', () => {
    // agency can't fire submit AND the item fails validators — must get 403.
    const d = planTransition(WF, item({ status: 'planning', fields: {}, description: '' }), 'submit', {
      actor: agency,
      facts: facts(),
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.httpStatus).toBe(403);
  });
});

// ── planTransition: acceptance + post-functions ───────────────────────────────

describe('planTransition — acceptance', () => {
  it('produces the new status, patch, async ops and audit entry', () => {
    const d = planTransition(
      WF,
      item({ status: 'planning', fields: { budget: 25000 }, description: 'A plan' }),
      'submit',
      { actor: admin, facts: facts() },
    );
    expect(d.ok).toBe(true);
    if (!d.ok) return;

    expect(d.toStatus).toBe('approval');
    // inline post-functions folded into the patch
    expect(d.patch.status).toBe('approval');
    expect(d.patch.locked).toBe(true);
    expect(d.patch.dueDate).toBe('2026-07-09'); // NOW + 7d, YYYY-MM-DD
    expect(d.patch.approval).toEqual({ chainId: 'chain_a', stageIndex: 0, decisions: [], state: 'pending' });
    // async post-functions returned for the executor to enqueue
    expect(d.asyncOps).toEqual([{ type: 'notify', audience: 'approvers', template: 'approval_requested' }]);
    // audit entry
    expect(d.activity.kind).toBe('transition');
    expect(d.activity.actorUid).toBe('admin1');
    expect(d.activity.ts).toBe(NOW);
    expect(d.activity.payload).toMatchObject({ transitionId: 'submit', from: 'planning', to: 'approval' });
  });

  it('stamps completedAt when entering a done-category status', () => {
    const d = planTransition(
      WF,
      item({
        status: 'approval',
        approval: { chainId: 'c', stageIndex: 1, decisions: [], state: 'approved' },
      }),
      'complete',
      { actor: admin, facts: facts({ subtaskStatuses: [] }) },
    );
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.patch.status).toBe('completed');
      expect(d.patch.completedAt).toBe(NOW);
    }
  });

  it('does not stamp completedAt for non-done statuses', () => {
    const d = planTransition(WF, item(), 'start_planning', { actor: admin, facts: facts() });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.patch.completedAt).toBeUndefined();
  });

  it('allows an assignee-gated transition for the assigned user', () => {
    const d = planTransition(WF, item({ assigneeUids: ['agency1'] }), 'assignee_only', {
      actor: agency,
      facts: facts(),
    });
    expect(d.ok).toBe(true);
  });
});

// ── availableTransitions ──────────────────────────────────────────────────────

describe('availableTransitions', () => {
  it('returns only source-matching, condition-passing transitions (validators ignored)', () => {
    // admin on a `planning` item with NO budget/description: submit still shows
    // (validators are evaluated on click, not here).
    const t = availableTransitions(WF, item({ status: 'planning', fields: {}, description: '' }), admin);
    expect(t.map((x) => x.id)).toEqual(['submit']);
  });

  it('hides transitions whose conditions the actor fails', () => {
    const t = availableTransitions(WF, item({ status: 'created' }), agency);
    // start_planning requires admin/internal; assignee_only requires assignee.
    expect(t.map((x) => x.id)).toEqual([]);
  });

  it('shows assignee-gated transition to the assignee', () => {
    const t = availableTransitions(WF, item({ status: 'created', assigneeUids: ['agency1'] }), agency);
    expect(t.map((x) => x.id)).toContain('assignee_only');
  });
});

// ── getTransition ─────────────────────────────────────────────────────────────

describe('getTransition', () => {
  it('finds by id, undefined otherwise', () => {
    expect(getTransition(WF, 'submit')?.name).toBe('Submit for approval');
    expect(getTransition(WF, 'ghost')).toBeUndefined();
  });
});
