import { describe, it, expect } from 'vitest';
import { recordDecision, canDecide, DecisionInput } from '../lib/planner/approvals';
import { ApprovalChain, ApprovalStage, ApprovalState } from '../lib/planner/types';

/*
 * Unit tests for the pure approval-chain evaluator. No Firestore, no clock.
 */

const NOW = '2026-07-02T10:00:00.000Z';

const twoStageAny: ApprovalChain = {
  id: 'chain',
  name: 'Two-stage',
  stages: [
    { name: 'Manager', approverRoles: ['manager'], mode: 'any' },
    { name: 'Management', approverRoles: ['management'], mode: 'any' },
  ],
  onApprove: 'approve',
  onReject: 'reject',
};

const pending = (over: Partial<ApprovalState> = {}): ApprovalState => ({
  chainId: 'chain',
  stageIndex: 0,
  decisions: [],
  state: 'pending',
  ...over,
});

const decide = (o: Partial<DecisionInput>): DecisionInput => ({
  uid: 'u1',
  roles: ['manager'],
  decision: 'approve',
  now: NOW,
  ...o,
});

// ── canDecide ─────────────────────────────────────────────────────────────────

describe('canDecide', () => {
  const stage: ApprovalStage = { name: 'S', approverRoles: ['manager'], approverUids: ['bob'], mode: 'any' };
  it('allows by role', () => expect(canDecide(stage, ['manager'], 'x')).toBe(true));
  it('allows by uid', () => expect(canDecide(stage, ['other'], 'bob')).toBe(true));
  it('denies when neither matches', () => expect(canDecide(stage, ['other'], 'x')).toBe(false));
  it('denies an unassignable stage', () =>
    expect(canDecide({ name: 'S', mode: 'any' }, ['manager'], 'bob')).toBe(false));
});

// ── Rejections / guards ─────────────────────────────────────────────────────

describe('recordDecision — guards', () => {
  it('409 when approval is not pending', () => {
    const r = recordDecision(twoStageAny, pending({ state: 'approved' }), decide({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.httpStatus).toBe(409);
  });

  it('403 when actor is not an approver for the stage', () => {
    const r = recordDecision(twoStageAny, pending(), decide({ roles: ['creative'] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_an_approver');
  });

  it('422 when a rejection has no comment', () => {
    const r = recordDecision(twoStageAny, pending(), decide({ decision: 'reject' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('reject_comment_required');
  });

  it('409 when the same user decides twice at a stage', () => {
    // Use a non-advancing stage (needs 2 approvals) so the first decision is
    // merely "recorded" and the actor is still an eligible approver on retry.
    const needsTwo: ApprovalChain = {
      id: 'c',
      name: 'min2',
      stages: [{ name: 'Team', approverRoles: ['manager'], mode: 'all', minApprovals: 2 }],
    };
    const once = recordDecision(needsTwo, pending({ chainId: 'c' }), decide({ uid: 'm1' }));
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(once.resolution).toBe('recorded');
    const twice = recordDecision(needsTwo, once.approval, decide({ uid: 'm1' }));
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.code).toBe('already_decided');
  });
});

// ── Multi-stage progression ──────────────────────────────────────────────────

describe('recordDecision — progression', () => {
  it('advances to the next stage when stage 0 (any) approves', () => {
    const r = recordDecision(twoStageAny, pending(), decide({ uid: 'm1', roles: ['manager'] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolution).toBe('stage_advanced');
      expect(r.approval.stageIndex).toBe(1);
      expect(r.approval.state).toBe('pending');
    }
  });

  it('final stage approval resolves the whole chain', () => {
    const atStage1 = pending({ stageIndex: 1, decisions: [{ uid: 'm1', decision: 'approve', ts: NOW, stageIndex: 0 }] });
    const r = recordDecision(twoStageAny, atStage1, decide({ uid: 'mgmt1', roles: ['management'] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolution).toBe('approved');
      expect(r.approval.state).toBe('approved');
    }
  });

  it('rejection at any stage fails the chain and returns onReject', () => {
    const r = recordDecision(twoStageAny, pending(), decide({ uid: 'm1', roles: ['manager'], decision: 'reject', comment: 'no' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolution).toBe('rejected');
      expect(r.approval.state).toBe('rejected');
      expect(r.fireTransition).toBe('reject');
    }
  });
});

// ── Modes: all / majority ────────────────────────────────────────────────────

describe('recordDecision — all / majority modes', () => {
  const allByUids: ApprovalChain = {
    id: 'c',
    name: 'all',
    stages: [{ name: 'Board', approverUids: ['a', 'b', 'c'], mode: 'all' }],
    onApprove: 'approve',
  };

  it('`all` with approverUids needs every listed approver', () => {
    let state = pending({ chainId: 'c' });
    const r1 = recordDecision(allByUids, state, decide({ uid: 'a', roles: [] }));
    expect(r1.ok && r1.resolution).toBe('recorded');
    if (!r1.ok) return;
    const r2 = recordDecision(allByUids, r1.approval, decide({ uid: 'b', roles: [] }));
    expect(r2.ok && r2.resolution).toBe('recorded');
    if (!r2.ok) return;
    const r3 = recordDecision(allByUids, r2.approval, decide({ uid: 'c', roles: [] }));
    expect(r3.ok && r3.resolution).toBe('approved');
  });

  const majByUids: ApprovalChain = {
    id: 'c',
    name: 'maj',
    stages: [{ name: 'Panel', approverUids: ['a', 'b', 'c'], mode: 'majority' }],
    onApprove: 'approve',
  };

  it('`majority` resolves once more than half approve', () => {
    let state = pending({ chainId: 'c' });
    const r1 = recordDecision(majByUids, state, decide({ uid: 'a', roles: [] }));
    expect(r1.ok && r1.resolution).toBe('recorded'); // 1 of 3, not > 1.5
    if (!r1.ok) return;
    const r2 = recordDecision(majByUids, r1.approval, decide({ uid: 'b', roles: [] }));
    expect(r2.ok && r2.resolution).toBe('approved'); // 2 of 3 > 1.5
  });

  it('role-based `all` falls back to minApprovals threshold', () => {
    const chain: ApprovalChain = {
      id: 'c',
      name: 'min',
      stages: [{ name: 'Team', approverRoles: ['creative'], mode: 'all', minApprovals: 2 }],
      onApprove: 'approve',
    };
    const r1 = recordDecision(chain, pending({ chainId: 'c' }), decide({ uid: 'x', roles: ['creative'] }));
    expect(r1.ok && r1.resolution).toBe('recorded');
    if (!r1.ok) return;
    const r2 = recordDecision(chain, r1.approval, decide({ uid: 'y', roles: ['creative'] }));
    expect(r2.ok && r2.resolution).toBe('approved');
  });
});
