/**
 * Marketing Planner — config read routes (Phase 1/2).
 *
 *   GET /api/planner/config/workflows        all workflows
 *   GET /api/planner/config/workflows/:id    one workflow
 *   GET /api/planner/config/types            work item types
 *   GET /api/planner/config/fields           custom field definitions
 *
 * Read-only for now — any authenticated staff member may read config so the UI
 * can render status names/colors, type pickers, field labels. Config WRITES
 * (the Phase 5 settings panel, gated on manageConfig) are a later increment;
 * until then config is seeded by scripts/seed-planner.ts.
 */

import { Router, Response } from 'express';
import { requireAuth, AuthedRequest } from '../../middleware/auth';
import { getWorkflow, listWorkflows, listWorkItemTypes, listCustomFields, listTemplates } from '../../lib/planner/data';

const router = Router();
router.use(requireAuth);

router.get('/workflows', async (_req: AuthedRequest, res: Response, next) => {
  try {
    res.json({ success: true, workflows: await listWorkflows() });
  } catch (err) {
    next(err);
  }
});

router.get('/workflows/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    const workflow = await getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, error: 'Workflow not found' });
    res.json({ success: true, workflow });
  } catch (err) {
    next(err);
  }
});

router.get('/types', async (_req: AuthedRequest, res: Response, next) => {
  try {
    res.json({ success: true, types: await listWorkItemTypes() });
  } catch (err) {
    next(err);
  }
});

router.get('/fields', async (_req: AuthedRequest, res: Response, next) => {
  try {
    res.json({ success: true, fields: await listCustomFields() });
  } catch (err) {
    next(err);
  }
});

router.get('/templates', async (_req: AuthedRequest, res: Response, next) => {
  try {
    res.json({ success: true, templates: await listTemplates() });
  } catch (err) {
    next(err);
  }
});

export default router;
