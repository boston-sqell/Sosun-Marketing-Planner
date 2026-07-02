/**
 * Marketing Planner — work item routes (Phase 1).
 *
 *   GET    /api/planner/items                list (filter + cursor)
 *   POST   /api/planner/items                create (type → workflow → initialStatus)
 *   GET    /api/planner/items/:id            read one
 *   PUT    /api/planner/items/:id            edit non-status fields
 *   DELETE /api/planner/items/:id            delete (+ subcollections)
 *   GET    /api/planner/items/:id/transitions  transitions the actor may fire now
 *   POST   /api/planner/items/:id/transition   fire a transition (the ONLY way status changes)
 *   GET    /api/planner/items/:id/activity   audit stream
 *
 * Auth: reuses requireAuth (Bearer ID token + App Check). Fine-grained planner
 * permissions (§10.2 planner-rbac) are Phase 3 — for now create/edit/delete are
 * gated to staff (admin/internal), and transitions are authorised by the
 * workflow's own `role` conditions (which match the identity claim).
 */

import { Router, Response } from 'express';
import { requireAuth, AuthedRequest, AppRole } from '../../middleware/auth';
import { attachPlannerRole, requirePlannerPermission, PlannerRequest } from '../../middleware/planner-rbac';
import { validate } from '../../middleware/validate';
import { db } from '../../services/firestore';
import {
  CreatePlannerItemSchema,
  UpdatePlannerItemSchema,
  TransitionSchema,
  ApprovalDecisionSchema,
  FromTemplateSchema,
} from '../../schemas/planner';
import {
  createItem,
  createFromTemplate,
  executeApprovalDecision,
  executeTransition,
  getItem,
  getMyWork,
  getWorkflow,
  listItems,
  updateItemFields,
  WORK_ITEMS_COLLECTION,
} from '../../lib/planner/data';
import { availableTransitions } from '../../lib/planner/workflow';
import { TransitionActor } from '../../lib/planner/types';

const router = Router();
router.use(requireAuth);
router.use(attachPlannerRole);

const STAFF: AppRole[] = ['admin', 'internal'];
const isStaff = (role?: AppRole) => !!role && STAFF.includes(role);
const AGENCY_ROLES: AppRole[] = ['agency', 'external_agency'];
const isAgency = (role?: AppRole) => !!role && AGENCY_ROLES.includes(role);

/** Returns true when an agency user may access the given work item. */
function agencyCanAccess(item: { typeId?: string; fields?: Record<string, unknown>; assigneeUids?: string[] }, uid: string): boolean {
  // Campaigns are always visible to agency.
  if (item.typeId === 'campaign') return true;
  // Legacy tasks/meetings: assignedTo and visibility can be at the TOP LEVEL
  // of the Firestore doc (not inside fields:{}) — check both locations.
  const raw = item as unknown as Record<string, unknown>;
  const assignedTo = (raw.assignedTo ?? item.fields?.assignedTo) as string | undefined;
  const visibility = (raw.visibility ?? item.fields?.visibility) as string | undefined;
  if (assignedTo === 'Agency' || assignedTo === 'Both') return true;
  if (visibility === 'agency' || visibility === 'external' || visibility === 'both') return true;
  // Planner-native items: use assigneeUids.
  return (item.assigneeUids ?? []).includes(uid);
}

/**
 * Build the engine actor from the request. Workflow `role` conditions match
 * against BOTH the identity claim (admin/internal/agency…) and the resolved
 * planner role (manager/marketing/creative…), so a transition can be gated on
 * either. attachPlannerRole must have run first.
 */
function actorFrom(req: PlannerRequest): TransitionActor {
  const roles = [req.role!, req.plannerRole].filter((r): r is string => !!r);
  return { uid: req.uid!, roles: Array.from(new Set(roles)), spaceIds: [] };
}

const nowIso = () => new Date().toISOString();

// ── List ─────────────────────────────────────────────────────────────────────

router.get('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    const { spaceId, status, brandId, cursor } = req.query as Record<string, string>;
    const filter = {
      spaceId,
      status,
      brandId,
      // Non-staff only see items they're assigned to (coarse Phase 1 scoping).
      // EXCEPT agency users, who see items according to legacy visibility rules.
      assigneeUid: isStaff(req.role) ? undefined : req.uid,
      forAgency: req.role === 'agency' || req.role === 'external_agency',
    };
    const { items, nextCursor } = await listItems(filter, cursor);
    return res.json({ success: true, items, nextCursor });
  } catch (err) {
    next(err);
  }
});

// ── My Work (assigned + awaiting my approval) ────────────────────────────────
// Defined before "/:id" so "my-work" isn't captured as an item id.

router.get('/my-work', async (req: PlannerRequest, res: Response, next) => {
  try {
    const { assigned, awaitingApproval } = await getMyWork(req.uid!, actorFrom(req).roles);
    return res.json({ success: true, assigned, awaitingApproval });
  } catch (err) {
    next(err);
  }
});

// ── Create ───────────────────────────────────────────────────────────────────

router.post('/', requirePlannerPermission('createItem'), validate(CreatePlannerItemSchema), async (req: PlannerRequest, res: Response, next) => {
  try {
    const result = await createItem(req.body, actorFrom(req), nowIso());
    if (!result.ok) {
      return res.status(result.httpStatus).json({ success: false, error: result.message });
    }
    return res.json({ success: true, item: result.item });
  } catch (err) {
    next(err);
  }
});

// ── Create from template ─────────────────────────────────────────────────────

router.post('/from-template', requirePlannerPermission('createItem'), validate(FromTemplateSchema), async (req: PlannerRequest, res: Response, next) => {
  try {
    const result = await createFromTemplate(
      req.body.templateId,
      { spaceId: req.body.spaceId, brandIds: req.body.brandIds, titleOverride: req.body.titleOverride },
      actorFrom(req),
      nowIso(),
    );
    if (!result.ok) return res.status(result.httpStatus).json({ success: false, error: result.message });
    return res.json({ success: true, root: result.root, subtasks: result.subtasks });
  } catch (err) {
    next(err);
  }
});

// ── Read one ─────────────────────────────────────────────────────────────────

router.get('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    const item = await getItem(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Work item not found' });
    if (!isStaff(req.role)) {
      const ok = isAgency(req.role) ? agencyCanAccess(item, req.uid!) : (item.assigneeUids ?? []).includes(req.uid!);
      if (!ok) return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    return res.json({ success: true, item });
  } catch (err) {
    next(err);
  }
});

// ── Available transitions (for the UI) ───────────────────────────────────────

router.get('/:id/transitions', async (req: AuthedRequest, res: Response, next) => {
  try {
    const item = await getItem(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Work item not found' });
    const workflow = await getWorkflow(item.workflowId);
    if (!workflow) return res.status(400).json({ success: false, error: 'Item references a missing workflow' });

    const transitions = availableTransitions(workflow, item, actorFrom(req)).map((t) => ({
      id: t.id,
      name: t.name,
      to: t.to,
    }));
    return res.json({ success: true, transitions });
  } catch (err) {
    next(err);
  }
});

// ── Edit non-status fields ───────────────────────────────────────────────────

router.put('/:id', requirePlannerPermission('editItem'), validate(UpdatePlannerItemSchema), async (req: PlannerRequest, res: Response, next) => {
  try {
    const item = await getItem(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Work item not found' });
    if (!isStaff(req.role)) {
      const ok = isAgency(req.role) ? agencyCanAccess(item, req.uid!) : (item.assigneeUids ?? []).includes(req.uid!);
      if (!ok) return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (item.locked) {
      return res.status(409).json({ success: false, error: 'Item is locked for editing by its workflow' });
    }
    const result = await updateItemFields(req.params.id, req.body, nowIso());
    if (!result.ok) return res.status(result.httpStatus).json({ success: false, error: 'Work item not found' });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Delete ───────────────────────────────────────────────────────────────────

router.delete('/:id', requirePlannerPermission('deleteItem'), async (req: PlannerRequest, res: Response, next) => {
  try {
    const ref = db.collection(WORK_ITEMS_COLLECTION).doc(req.params.id);
    // recursiveDelete removes the doc AND its activity/attachments/comments
    // subcollections — a plain delete() would orphan them (Firestore doesn't
    // cascade). Same pattern as routes/events.ts.
    await db.recursiveDelete(ref);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Fire a transition (the only path to a status change) ─────────────────────

router.post('/:id/transition', validate(TransitionSchema), async (req: AuthedRequest, res: Response, next) => {
  try {
    const decision = await executeTransition(req.params.id, req.body.transitionId, actorFrom(req), nowIso());
    if (!decision.ok) {
      return res.status(decision.httpStatus).json({
        success: false,
        error: decision.code,
        details: decision.errors,
      });
    }
    return res.json({ success: true, status: decision.toStatus });
  } catch (err) {
    next(err);
  }
});

// ── Approval decision (approve / reject) ─────────────────────────────────────

router.post('/:id/approval', requirePlannerPermission('approve'), validate(ApprovalDecisionSchema), async (req: PlannerRequest, res: Response, next) => {
  try {
    const outcome = await executeApprovalDecision(
      req.params.id,
      { uid: req.uid!, roles: actorFrom(req).roles, decision: req.body.decision, comment: req.body.comment },
      nowIso(),
    );
    if (!outcome.ok) {
      return res.status(outcome.httpStatus).json({ success: false, error: outcome.code });
    }
    return res.json({ success: true, resolution: outcome.resolution, approval: outcome.approval });
  } catch (err) {
    next(err);
  }
});

// ── Activity stream ──────────────────────────────────────────────────────────

router.get('/:id/activity', async (req: AuthedRequest, res: Response, next) => {
  try {
    const item = await getItem(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Work item not found' });
    if (!isStaff(req.role)) {
      const ok = isAgency(req.role) ? agencyCanAccess(item, req.uid!) : (item.assigneeUids ?? []).includes(req.uid!);
      if (!ok) return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const snap = await db
      .collection(WORK_ITEMS_COLLECTION)
      .doc(req.params.id)
      .collection('activity')
      .orderBy('ts', 'desc')
      .limit(100)
      .get();
    const activity = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ success: true, activity });
  } catch (err) {
    next(err);
  }
});

export default router;
