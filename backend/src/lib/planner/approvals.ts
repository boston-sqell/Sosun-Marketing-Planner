/**
 * Marketing Planner — approval chain evaluation (pure).
 *
 * Approvals are decoupled from the workflow (spec §3.5): a transition
 * post-function (`startApproval`) seeds item.approval; approvers then submit
 * decisions through the approval endpoint, which calls recordDecision() here;
 * and the workflow's exit transition carries an `approvalComplete` validator so
 * the item can only leave the approval status once the chain resolves.
 *
 * This module is pure — no Firestore, no clock (the caller injects `now`) — so
 * the any/all/majority matrix and the multi-stage progression are unit-testable.
 */

import { ApprovalChain, ApprovalDecision, ApprovalStage, ApprovalState } from './types';

export interface DecisionInput {
  uid: string;
  /** Actor's roles (identity claim + planner role). */
  roles: string[];
  decision: 'approve' | 'reject';
  comment?: string;
  /** ISO timestamp treated as "now". */
  now: string;
}

export type ApprovalOutcome =
  | { ok: false; httpStatus: 403 | 404 | 409 | 422; code: string }
  | {
      ok: true;
      approval: ApprovalState;
      /** What the decision did to the chain. */
      resolution: 'recorded' | 'stage_advanced' | 'approved' | 'rejected';
      /** Set when resolution === 'rejected': the onReject transition to fire (system). */
      fireTransition?: string;
    };

export function stageOf(chain: ApprovalChain, index: number): ApprovalStage | undefined {
  return chain.stages[index];
}

/** May this actor cast a decision on this stage? */
export function canDecide(stage: ApprovalStage, roles: string[], uid: string): boolean {
  const byUid = (stage.approverUids ?? []).includes(uid);
  const byRole = (stage.approverRoles ?? []).some((r) => roles.includes(r));
  // If a stage names neither approvers nor roles it is unassignable → nobody.
  if (!stage.approverUids?.length && !stage.approverRoles?.length) return false;
  return byUid || byRole;
}

/** Approvals cast at a given stage index (for threshold math). */
function approvalsAtStage(decisions: ApprovalDecision[], stageIndex: number): ApprovalDecision[] {
  return decisions.filter((d) => d.stageIndex === stageIndex && d.decision === 'approve');
}

/** Has `uid` already decided at this stage? */
function alreadyDecided(decisions: ApprovalDecision[], stageIndex: number, uid: string): boolean {
  return decisions.some((d) => d.stageIndex === stageIndex && d.uid === uid);
}

/** Does the set of approvals satisfy the stage's mode? */
function stagePasses(stage: ApprovalStage, approvals: ApprovalDecision[]): boolean {
  const count = approvals.length;
  const uids = stage.approverUids ?? [];

  switch (stage.mode) {
    case 'any':
      return count >= 1;
    case 'all':
      if (uids.length) return uids.every((u) => approvals.some((a) => a.uid === u));
      if (stage.minApprovals) return count >= stage.minApprovals;
      return count >= 1; // role-based fallback (documented on ApprovalStage.minApprovals)
    case 'majority':
      if (uids.length) return count > uids.length / 2;
      if (stage.minApprovals) return count >= stage.minApprovals;
      return count >= 1;
    default:
      return false;
  }
}

/**
 * Apply a decision to the current approval state and return the new state plus
 * what resolved. Pure: builds a fresh ApprovalState, never mutates the input.
 */
export function recordDecision(
  chain: ApprovalChain,
  approval: ApprovalState,
  input: DecisionInput,
): ApprovalOutcome {
  if (approval.state !== 'pending') {
    return { ok: false, httpStatus: 409, code: 'approval_not_pending' };
  }
  const stage = stageOf(chain, approval.stageIndex);
  if (!stage) {
    return { ok: false, httpStatus: 409, code: 'approval_stage_missing' };
  }
  if (!canDecide(stage, input.roles, input.uid)) {
    return { ok: false, httpStatus: 403, code: 'not_an_approver' };
  }
  if (input.decision === 'reject' && !input.comment?.trim()) {
    return { ok: false, httpStatus: 422, code: 'reject_comment_required' };
  }
  if (alreadyDecided(approval.decisions, approval.stageIndex, input.uid)) {
    return { ok: false, httpStatus: 409, code: 'already_decided' };
  }

  const decision: ApprovalDecision = {
    uid: input.uid,
    decision: input.decision,
    comment: input.comment?.trim() || undefined,
    ts: input.now,
    stageIndex: approval.stageIndex,
  };
  const decisions = [...approval.decisions, decision];

  // Any rejection fails the whole chain immediately.
  if (input.decision === 'reject') {
    return {
      ok: true,
      approval: { ...approval, decisions, state: 'rejected' },
      resolution: 'rejected',
      fireTransition: chain.onReject,
    };
  }

  // Approval: does this stage now pass?
  const passed = stagePasses(stage, approvalsAtStage(decisions, approval.stageIndex));
  if (!passed) {
    return { ok: true, approval: { ...approval, decisions }, resolution: 'recorded' };
  }

  const isLastStage = approval.stageIndex >= chain.stages.length - 1;
  if (isLastStage) {
    return {
      ok: true,
      approval: { ...approval, decisions, state: 'approved' },
      resolution: 'approved',
    };
  }
  return {
    ok: true,
    approval: { ...approval, decisions, stageIndex: approval.stageIndex + 1 },
    resolution: 'stage_advanced',
  };
}
