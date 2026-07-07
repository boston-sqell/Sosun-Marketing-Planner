/**
 * Marketing Planner — planner-role RBAC middleware (spec §10.2, tier 2).
 *
 * Modeled on middleware/rbac.ts. requireAuth (tier 1) has already verified the
 * identity claim and attached { uid, role }. Here we resolve the user's
 * plannerRole and gate fine-grained capabilities against the admin-editable
 * plannerConfig/roles matrix. The pure grant logic lives in
 * lib/planner/permissions.ts; this file only does the Firestore lookups and the
 * Express wiring.
 */

import { Response, NextFunction } from 'express';
import { AuthedRequest, AppRole } from './auth';
import { getRolesConfig, getUserPlannerRole } from '../lib/planner/data';
import { Capability, hasPlannerPermission } from '../lib/planner/permissions';

export interface PlannerRequest extends AuthedRequest {
  plannerRole?: string;
}

/**
 * Fallback planner role when a user profile has no explicit `plannerRole`.
 * Phase 1 default derived from the identity claim; once profiles carry
 * plannerRole (via the extended users API, §10.3) the profile value wins. Kept
 * conservative — external/limited claims map to read-only.
 */
const CLAIM_DEFAULT_PLANNER_ROLE: Record<AppRole, string> = {
  admin: 'admin',
  internal: 'marketing',
  agency: 'agency',
  external_agency: 'agency',
  media: 'readonly',
  sponsor: 'readonly',
  supplier: 'readonly',
};

/**
 * Resolve the actor's planner role and attach it to req.plannerRole. Apply
 * after requireAuth and before requirePlannerPermission / any route that needs
 * the planner role for workflow conditions.
 */
export async function attachPlannerRole(req: PlannerRequest, res: Response, next: NextFunction) {
  try {
    const explicit = req.uid ? await getUserPlannerRole(req.uid) : undefined;
    req.plannerRole = explicit ?? (req.role ? CLAIM_DEFAULT_PLANNER_ROLE[req.role] : undefined);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Gate a route on a planner capability. Reads the (cached-per-request) planner
 * role from req.plannerRole, so attachPlannerRole must run first.
 */
export function requirePlannerPermission(capability: Capability) {
  return async (req: PlannerRequest, res: Response, next: NextFunction) => {
    try {
      // Admin identity claim is the platform superuser — allow even if the
      // roles config is unseeded (matches the admin bypass in rbac.ts).
      if (req.role === 'admin') return next();

      const config = await getRolesConfig();
      const allowed = hasPlannerPermission(config, req.plannerRole, capability, {
        spaceId: (req.body?.spaceId as string) || (req.query?.spaceId as string) || undefined,
      });

      if (!allowed) {
        return res.status(403).json({ success: false, error: `Forbidden: missing planner permission "${capability}"` });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
