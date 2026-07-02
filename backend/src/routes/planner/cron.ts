/**
 * Marketing Planner — scheduled jobs (spec-revisions §14.3).
 *
 *   POST /api/planner/cron/drain-outbox   drains the transactional outbox
 *
 * Auth reuses the repo's existing service-to-service pattern (routes/tasks.ts):
 * a Cloud Scheduler request carrying x-scheduler-key: $SCHEDULER_KEY, or an
 * admin/internal user. Point a Cloud Scheduler job at this every 1-2 minutes.
 */

import { Router, Response, NextFunction } from 'express';
import { requireAuth, requireRole, AuthedRequest } from '../../middleware/auth';
import { drainOutbox } from '../../lib/planner/data';

const router = Router();

function schedulerOrAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const key = process.env.SCHEDULER_KEY;
  if (key && req.headers['x-scheduler-key'] === key) return next();
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    requireRole('admin', 'internal')(req, res, next);
  });
}

router.post('/drain-outbox', schedulerOrAdmin, async (_req: AuthedRequest, res: Response, next) => {
  try {
    const result = await drainOutbox(new Date().toISOString(), 50);
    return res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

export default router;
