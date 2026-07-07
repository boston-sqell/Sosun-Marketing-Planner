/**
 * Marketing Planner — planner-role permission resolver (pure).
 *
 * Tier 2 of the two-tier model (docs/planner/spec-revisions.md §10.2): the
 * coarse identity claim (admin/internal/agency/…) is the security boundary
 * enforced by requireAuth; the fine-grained planner capability is resolved here
 * from admin-editable config (plannerConfig/roles) keyed by the user's
 * plannerRole. This function touches no Firestore — the middleware loads the
 * config and passes it in — so the grant matrix is unit-testable.
 */

export type Capability =
  | 'createItem'
  | 'editItem'
  | 'deleteItem'
  | 'archiveItem'
  | 'assign'
  | 'comment'
  | 'uploadFile'
  | 'approve'
  | 'manageConfig'
  | 'export';

export interface RoleGrant {
  permissions: Partial<Record<Capability, boolean>>;
  /**
   * Optional per-space overrides (e.g. agency → only the Creative space, only
   * items where they're the assignee). Absent ⇒ the role's grant applies in
   * every space.
   */
  spaces?: Record<string, { onlyAssignee?: boolean }>;
}

export interface RolesConfig {
  roles: Record<string, RoleGrant>;
}

export interface PermissionContext {
  /** The space the action targets, for space-scoped overrides. */
  spaceId?: string;
  /** Whether the actor is an assignee of the target item (for onlyAssignee). */
  isAssignee?: boolean;
}

/**
 * Does `plannerRole` grant `capability`? A missing role, missing grant, or
 * explicit `false` all deny (fail closed). Space overrides can only *narrow* a
 * grant, never widen it: if the role lacks the capability globally, a space
 * override cannot re-grant it.
 */
export function hasPlannerPermission(
  config: RolesConfig | null | undefined,
  plannerRole: string | undefined,
  capability: Capability,
  context: PermissionContext = {},
): boolean {
  if (!config || !plannerRole) return false;

  const grant = config.roles?.[plannerRole];
  if (!grant) return false;

  if (grant.permissions?.[capability] !== true) return false;

  // Space-scoped narrowing.
  const spaceRule = context.spaceId ? grant.spaces?.[context.spaceId] : undefined;
  if (spaceRule?.onlyAssignee && !context.isAssignee) return false;

  return true;
}
