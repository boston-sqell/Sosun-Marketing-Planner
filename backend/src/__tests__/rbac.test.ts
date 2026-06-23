import { describe, it, expect } from 'vitest';
import { checkPermission } from '../middleware/rbac';

/*
 * Unit tests for the condition-aware RBAC engine (checkPermission).
 * These test the pure-logic permission evaluator without hitting Firestore.
 * The membership helpers (isProjectMember, isCampaignMember) are not exercised
 * here because they require Firestore — those belong in integration tests.
 */

const AGENCY_UID = 'agency-user-001';
const ADMIN_UID = 'admin-user-001';
const INTERNAL_UID = 'internal-user-001';

// ── Admin: unrestricted ──────────────────────────────────────────────────────

describe('checkPermission — admin role', () => {
  it('can view any task', async () => {
    expect(
      await checkPermission('admin', 'task', 'view', {
        userUid: ADMIN_UID,
        resourceData: { assignedTo: 'Internal' },
      }),
    ).toBe(true);
  });

  it('can create tasks', async () => {
    expect(
      await checkPermission('admin', 'task', 'create', { userUid: ADMIN_UID }),
    ).toBe(true);
  });

  it('can edit tasks', async () => {
    expect(
      await checkPermission('admin', 'task', 'edit', {
        userUid: ADMIN_UID,
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(true);
  });

  it('can delete tasks', async () => {
    expect(
      await checkPermission('admin', 'task', 'delete', {
        userUid: ADMIN_UID,
        resourceData: {},
      }),
    ).toBe(true);
  });

  it('can view campaigns', async () => {
    expect(
      await checkPermission('admin', 'campaign', 'view', {
        userUid: ADMIN_UID,
        resourceData: {},
      }),
    ).toBe(true);
  });

  it('can create campaigns', async () => {
    expect(
      await checkPermission('admin', 'campaign', 'create', { userUid: ADMIN_UID }),
    ).toBe(true);
  });

  it('can delete campaigns', async () => {
    expect(
      await checkPermission('admin', 'campaign', 'delete', {
        userUid: ADMIN_UID,
        resourceData: {},
      }),
    ).toBe(true);
  });
});

// ── Internal: unrestricted ───────────────────────────────────────────────────

describe('checkPermission — internal role', () => {
  it('can view any task', async () => {
    expect(
      await checkPermission('internal', 'task', 'view', {
        userUid: INTERNAL_UID,
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(true);
  });

  it('can create tasks', async () => {
    expect(
      await checkPermission('internal', 'task', 'create', { userUid: INTERNAL_UID }),
    ).toBe(true);
  });

  it('can edit tasks', async () => {
    expect(
      await checkPermission('internal', 'task', 'edit', {
        userUid: INTERNAL_UID,
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(true);
  });

  it('can delete tasks', async () => {
    expect(
      await checkPermission('internal', 'task', 'delete', {
        userUid: INTERNAL_UID,
        resourceData: {},
      }),
    ).toBe(true);
  });

  it('can view internal-only comments', async () => {
    expect(
      await checkPermission('internal', 'comment', 'view', {
        userUid: INTERNAL_UID,
        resourceData: { internalOnly: true },
      }),
    ).toBe(true);
  });
});

// ── Agency / External Agency ─────────────────────────────────────────────────

describe('checkPermission — agency role', () => {
  // ── Task visibility ──
  it('can view tasks assigned to Agency', async () => {
    expect(
      await checkPermission('agency', 'task', 'view', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(true);
  });

  it('can view tasks assigned to Both', async () => {
    expect(
      await checkPermission('agency', 'task', 'view', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Both' },
      }),
    ).toBe(true);
  });

  it('cannot view tasks assigned to Internal only', async () => {
    expect(
      await checkPermission('agency', 'task', 'view', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Internal' },
      }),
    ).toBe(false);
  });

  it('can view meetings with agency visibility', async () => {
    expect(
      await checkPermission('agency', 'task', 'view', {
        userUid: AGENCY_UID,
        resourceData: { type: 'meeting', visibility: 'agency' },
      }),
    ).toBe(true);
  });

  it('cannot view meetings with internal visibility', async () => {
    expect(
      await checkPermission('agency', 'task', 'view', {
        userUid: AGENCY_UID,
        resourceData: { type: 'meeting', visibility: 'internal' },
      }),
    ).toBe(false);
  });

  it('returns false when no resourceData for task view', async () => {
    expect(
      await checkPermission('agency', 'task', 'view', {
        userUid: AGENCY_UID,
        resourceData: undefined,
      }),
    ).toBe(false);
  });

  // ── Task CRUD restrictions ──
  it('cannot create tasks', async () => {
    expect(
      await checkPermission('agency', 'task', 'create', { userUid: AGENCY_UID }),
    ).toBe(false);
  });

  it('cannot edit tasks', async () => {
    expect(
      await checkPermission('agency', 'task', 'edit', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(false);
  });

  it('cannot delete tasks', async () => {
    expect(
      await checkPermission('agency', 'task', 'delete', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(false);
  });

  // ── Status transitions ──
  it('can transition status on assigned tasks (non-terminal)', async () => {
    expect(
      await checkPermission('agency', 'task', 'status_transition', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Agency' },
        targetPhase: 'in_progress',
      }),
    ).toBe(true);
  });

  it('cannot transition to terminal phase', async () => {
    expect(
      await checkPermission('agency', 'task', 'status_transition', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Agency' },
        targetPhase: 'terminal',
      }),
    ).toBe(false);
  });

  it('cannot transition status on non-assigned tasks', async () => {
    expect(
      await checkPermission('agency', 'task', 'status_transition', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Internal' },
        targetPhase: 'in_progress',
      }),
    ).toBe(false);
  });

  // ── Campaign restrictions ──
  it('can view campaigns', async () => {
    expect(
      await checkPermission('agency', 'campaign', 'view', {
        userUid: AGENCY_UID,
        resourceData: {},
      }),
    ).toBe(true);
  });

  it('cannot create campaigns', async () => {
    expect(
      await checkPermission('agency', 'campaign', 'create', { userUid: AGENCY_UID }),
    ).toBe(false);
  });

  it('cannot edit campaigns', async () => {
    expect(
      await checkPermission('agency', 'campaign', 'edit', {
        userUid: AGENCY_UID,
        resourceData: {},
      }),
    ).toBe(false);
  });

  it('cannot delete campaigns', async () => {
    expect(
      await checkPermission('agency', 'campaign', 'delete', {
        userUid: AGENCY_UID,
        resourceData: {},
      }),
    ).toBe(false);
  });

  // ── Comment visibility ──
  it('can view public comments', async () => {
    expect(
      await checkPermission('agency', 'comment', 'view', {
        userUid: AGENCY_UID,
        resourceData: { internalOnly: false },
      }),
    ).toBe(true);
  });

  it('cannot view internal-only comments', async () => {
    expect(
      await checkPermission('agency', 'comment', 'view', {
        userUid: AGENCY_UID,
        resourceData: { internalOnly: true },
      }),
    ).toBe(false);
  });

  it('cannot view internal_only comments (snake_case variant)', async () => {
    expect(
      await checkPermission('agency', 'comment', 'view', {
        userUid: AGENCY_UID,
        resourceData: { internal_only: true },
      }),
    ).toBe(false);
  });

  // ── Comment creation ──
  it('can comment on assigned tasks', async () => {
    expect(
      await checkPermission('agency', 'comment', 'create', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(true);
  });

  it('cannot comment on non-assigned tasks', async () => {
    expect(
      await checkPermission('agency', 'comment', 'create', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Internal' },
      }),
    ).toBe(false);
  });

  // ── Comment editing (own, within 15 min) ──
  it('can edit own comment within 15 minutes', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(
      await checkPermission('agency', 'comment', 'edit', {
        userUid: AGENCY_UID,
        resourceData: { userUid: AGENCY_UID, createdAt: fiveMinAgo },
      }),
    ).toBe(true);
  });

  it('cannot edit own comment after 15 minutes', async () => {
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    expect(
      await checkPermission('agency', 'comment', 'edit', {
        userUid: AGENCY_UID,
        resourceData: { userUid: AGENCY_UID, createdAt: twentyMinAgo },
      }),
    ).toBe(false);
  });

  it('cannot edit comment without createdAt', async () => {
    expect(
      await checkPermission('agency', 'comment', 'edit', {
        userUid: AGENCY_UID,
        resourceData: { userUid: AGENCY_UID },
      }),
    ).toBe(false);
  });

  it('cannot edit another user comment', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(
      await checkPermission('agency', 'comment', 'edit', {
        userUid: AGENCY_UID,
        resourceData: { userUid: 'other-user', createdAt: fiveMinAgo },
      }),
    ).toBe(false);
  });

  it('cannot delete comments', async () => {
    expect(
      await checkPermission('agency', 'comment', 'delete', {
        userUid: AGENCY_UID,
        resourceData: { userUid: AGENCY_UID },
      }),
    ).toBe(false);
  });

  // ── Checklist ──
  it('can check items on assigned tasks', async () => {
    expect(
      await checkPermission('agency', 'checklist', 'check', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(true);
  });

  it('cannot check items on non-assigned tasks', async () => {
    expect(
      await checkPermission('agency', 'checklist', 'check', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Internal' },
      }),
    ).toBe(false);
  });

  it('cannot create checklist items', async () => {
    expect(
      await checkPermission('agency', 'checklist', 'create', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(false);
  });
});

// ── external_agency alias ────────────────────────────────────────────────────

describe('checkPermission — external_agency role (alias)', () => {
  it('has the same permissions as agency', async () => {
    // Should be treated identically to 'agency'
    expect(
      await checkPermission('external_agency', 'task', 'view', {
        userUid: AGENCY_UID,
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(true);

    expect(
      await checkPermission('external_agency', 'task', 'create', {
        userUid: AGENCY_UID,
      }),
    ).toBe(false);
  });
});

// ── Unknown roles ────────────────────────────────────────────────────────────

describe('checkPermission — unknown/missing roles', () => {
  it('denies all actions for unknown roles', async () => {
    expect(
      await checkPermission('supplier', 'task', 'view', {
        userUid: 'unknown',
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(false);
  });

  it('denies all actions for empty role', async () => {
    expect(
      await checkPermission('', 'task', 'view', {
        userUid: 'unknown',
        resourceData: { assignedTo: 'Agency' },
      }),
    ).toBe(false);
  });
});
