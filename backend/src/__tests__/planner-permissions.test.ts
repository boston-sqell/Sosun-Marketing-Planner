import { describe, it, expect } from 'vitest';
import { hasPlannerPermission, RolesConfig } from '../lib/planner/permissions';

/*
 * Unit tests for the pure planner-role permission resolver.
 * No Firestore — the config is passed in — mirroring rbac.test.ts.
 */

const CONFIG: RolesConfig = {
  roles: {
    admin: {
      permissions: {
        createItem: true, editItem: true, deleteItem: true, archiveItem: true,
        assign: true, comment: true, uploadFile: true, approve: true, manageConfig: true, export: true,
      },
    },
    marketing: {
      permissions: { createItem: true, editItem: true, comment: true },
    },
    agency: {
      permissions: { comment: true, uploadFile: true },
      spaces: { creative: { onlyAssignee: true } },
    },
    readonly: { permissions: {} },
  },
};

describe('hasPlannerPermission', () => {
  it('grants a capability the role explicitly has', () => {
    expect(hasPlannerPermission(CONFIG, 'marketing', 'createItem')).toBe(true);
    expect(hasPlannerPermission(CONFIG, 'admin', 'manageConfig')).toBe(true);
  });

  it('denies a capability the role lacks', () => {
    expect(hasPlannerPermission(CONFIG, 'marketing', 'deleteItem')).toBe(false);
    expect(hasPlannerPermission(CONFIG, 'marketing', 'approve')).toBe(false);
  });

  it('denies everything for a role with an empty grant', () => {
    expect(hasPlannerPermission(CONFIG, 'readonly', 'comment')).toBe(false);
    expect(hasPlannerPermission(CONFIG, 'readonly', 'createItem')).toBe(false);
  });

  it('fails closed on missing config', () => {
    expect(hasPlannerPermission(null, 'admin', 'createItem')).toBe(false);
    expect(hasPlannerPermission(undefined, 'admin', 'createItem')).toBe(false);
  });

  it('fails closed on missing / unknown planner role', () => {
    expect(hasPlannerPermission(CONFIG, undefined, 'comment')).toBe(false);
    expect(hasPlannerPermission(CONFIG, 'ghost', 'comment')).toBe(false);
  });

  // ── Space-scoped narrowing ──────────────────────────────────────────────────

  it('space override narrows to assignee-only', () => {
    // agency can comment globally, but in the creative space only on own items.
    expect(hasPlannerPermission(CONFIG, 'agency', 'comment', { spaceId: 'creative', isAssignee: true })).toBe(true);
    expect(hasPlannerPermission(CONFIG, 'agency', 'comment', { spaceId: 'creative', isAssignee: false })).toBe(false);
  });

  it('space override does not apply outside its space', () => {
    // In a non-creative space the onlyAssignee rule doesn't fire.
    expect(hasPlannerPermission(CONFIG, 'agency', 'comment', { spaceId: 'marketing', isAssignee: false })).toBe(true);
  });

  it('a space override cannot widen a capability the role lacks', () => {
    // agency has no createItem anywhere; a space context can't grant it.
    expect(hasPlannerPermission(CONFIG, 'agency', 'createItem', { spaceId: 'creative', isAssignee: true })).toBe(false);
  });
});
