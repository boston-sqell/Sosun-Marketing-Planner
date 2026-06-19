import { Router, Response, NextFunction } from 'express';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { runNewsScan } from '../services/newsScan';

const router = Router();

/**
 * Auth: either Cloud Scheduler (shared secret in `x-scheduler-key`, matching the
 * SCHEDULER_KEY env — same convention as reports.ts) OR an admin/internal user
 * token (the manual "Scan Now" / "Backfill" buttons).
 */
function schedulerOrAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const key = process.env.SCHEDULER_KEY;
  if (key && req.headers['x-scheduler-key'] === key) return next();
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    requireRole('admin', 'internal')(req, res, next);
  });
}

/**
 * POST /api/news/scan   body: { backfillDays?: number }
 * - No body / scheduler  → normal scan (latest items only).
 * - backfillDays (1–90)  → paginate JSON sources back N days to populate the app.
 */
router.post('/scan', schedulerOrAdmin, async (req, res, next) => {
  try {
    const raw = req.body && (req.body as any).backfillDays;
    const backfillDays = typeof raw === 'number' && raw > 0 ? Math.min(raw, 90) : undefined;
    const summary = await runNewsScan(backfillDays ? { backfillDays } : {});
    res.json({ success: true, summary });
  } catch (e) {
    next(e);
  }
});

export default router;
