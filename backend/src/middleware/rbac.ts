import { Response, NextFunction } from 'express';
import { AuthedRequest } from './auth';
import { db } from '../services/firestore';

export interface PermissionRule {
  role: string;
  resource: 'task' | 'checklist' | 'comment' | 'campaign';
  action: 'view' | 'create' | 'edit' | 'delete' | 'status_transition' | 'check';
  permitted: boolean;
  condition?: string;
}

/**
 * Checks if a user is a member of a project/brand.
 */
export async function isProjectMember(projectId: string, userUid: string): Promise<boolean> {
  const snap = await db.collection('projectMembers')
    .where('projectId', '==', projectId)
    .where('userUid', '==', userUid)
    .get();
  return !snap.empty;
}

/**
 * Checks if a user is a member of a campaign.
 */
export async function isCampaignMember(campaignId: string, userUid: string): Promise<boolean> {
  const snap = await db.collection('campaignMembers')
    .where('campaignId', '==', campaignId)
    .where('userUid', '==', userUid)
    .get();
  return !snap.empty;
}

/**
 * Condition-Aware RBAC Engine Evaluation.
 */
export async function checkPermission(
  role: string,
  resource: 'task' | 'checklist' | 'comment' | 'campaign',
  action: 'view' | 'create' | 'edit' | 'delete' | 'status_transition' | 'check',
  context: {
    userUid: string;
    resourceData?: any;
    parentResourceData?: any;
    targetPhase?: string; // used for status_transition
  }
): Promise<boolean> {
  // Normalize roles: treat 'agency' as 'external_agency'
  const normRole = (role === 'agency' || role === 'external_agency') ? 'external_agency' : role;

  // Admins have access to everything
  if (normRole === 'admin') return true;

  // Internal users have access to everything except admin-only routes which are guarded separately
  if (normRole === 'internal') return true;

  // Rules for external_agency
  const rules: PermissionRule[] = [
    // Campaigns
    { role: 'external_agency', resource: 'campaign', action: 'view', permitted: true, condition: 'campaign_visibility' },
    { role: 'external_agency', resource: 'campaign', action: 'create', permitted: false },
    { role: 'external_agency', resource: 'campaign', action: 'edit', permitted: false },
    { role: 'external_agency', resource: 'campaign', action: 'delete', permitted: false },

    // Tasks
    { role: 'external_agency', resource: 'task', action: 'view', permitted: true, condition: 'task_visibility' },
    { role: 'external_agency', resource: 'task', action: 'create', permitted: false },
    { role: 'external_agency', resource: 'task', action: 'edit', permitted: false },
    { role: 'external_agency', resource: 'task', action: 'delete', permitted: false },
    { role: 'external_agency', resource: 'task', action: 'status_transition', permitted: true, condition: 'own_assigned_task_status_transition' },

    // Checklists
    { role: 'external_agency', resource: 'checklist', action: 'view', permitted: true, condition: 'task_visibility' },
    { role: 'external_agency', resource: 'checklist', action: 'check', permitted: true, condition: 'own_assigned_task' },
    { role: 'external_agency', resource: 'checklist', action: 'create', permitted: false },
    { role: 'external_agency', resource: 'checklist', action: 'edit', permitted: false },
    { role: 'external_agency', resource: 'checklist', action: 'delete', permitted: false },

    // Comments
    { role: 'external_agency', resource: 'comment', action: 'view', permitted: true, condition: 'comment_visibility' },
    { role: 'external_agency', resource: 'comment', action: 'create', permitted: true, condition: 'own_assigned_task' },
    { role: 'external_agency', resource: 'comment', action: 'edit', permitted: true, condition: 'own_comment_15m' },
    { role: 'external_agency', resource: 'comment', action: 'delete', permitted: false },
  ];

  const rule = rules.find(r => r.role === normRole && r.resource === resource && r.action === action);
  if (!rule) return false;
  if (!rule.permitted) return false;

  if (!rule.condition) return true;

  const { userUid, resourceData, parentResourceData, targetPhase } = context;

  switch (rule.condition) {
    case 'campaign_visibility': {
      return true;
    }

    case 'task_visibility': {
      if (!resourceData) return false;
      
      // Meetings visibility check
      if (resourceData.type === 'meeting') {
        return resourceData.visibility === 'agency' || resourceData.visibility === 'external';
      }

      // Tasks visibility check
      return resourceData.assignedTo === 'Agency' || resourceData.assignedTo === 'Both' || resourceData.visibility === 'agency' || resourceData.visibility === 'both';
    }

    case 'own_assigned_task': {
      const task = parentResourceData || resourceData;
      if (!task) return false;

      return task.assignedTo === 'Agency' || task.assignedTo === 'Both' || task.visibility === 'agency' || task.visibility === 'both';
    }

    case 'own_assigned_task_status_transition': {
      if (!resourceData) return false;

      // Check task is assigned to Agency or Both
      const isAssigned = resourceData.assignedTo === 'Agency' || resourceData.assignedTo === 'Both' || resourceData.visibility === 'agency' || resourceData.visibility === 'both';
      if (!isAssigned) return false;

      // RESTRICTED Status transitions: Cannot set to terminal phase
      if (targetPhase === 'terminal') {
        return false;
      }

      return true;
    }

    case 'comment_visibility': {
      // Exclude internal_only comments
      if (resourceData && (resourceData.internalOnly === true || resourceData.internal_only === true)) {
        return false;
      }
      return true;
    }

    case 'own_comment_15m': {
      if (!resourceData) return false;
      const isOwn = resourceData.uid === userUid || resourceData.userUid === userUid || resourceData.user === userUid;
      if (!isOwn) return false;

      // Without a valid creation timestamp we cannot establish the edit window —
      // fail closed rather than defaulting to "now" (which made such comments
      // permanently editable).
      if (!resourceData.createdAt) return false;
      const createdAt = new Date(resourceData.createdAt);
      if (isNaN(createdAt.getTime())) return false;
      const diffMins = (Date.now() - createdAt.getTime()) / (1000 * 60);
      return diffMins >= 0 && diffMins <= 15;
    }

    default:
      return false;
  }
}

/**
 * Express middleware to enforce RBAC on generic endpoints.
 */
export function requirePermission(
  resource: 'task' | 'checklist' | 'comment' | 'campaign',
  action: 'view' | 'create' | 'edit' | 'delete' | 'status_transition' | 'check'
) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const role = req.role || 'agency';
      const userUid = req.uid;
      if (!userUid) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const hasPerm = await checkPermission(role, resource, action, {
        userUid,
        resourceData: req.body,
      });

      if (!hasPerm) {
        return res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions' });
      }

      next();
    } catch (err: any) {
      next(err);
    }
  };
}
