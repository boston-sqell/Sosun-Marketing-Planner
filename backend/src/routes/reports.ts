import { Router, Response, NextFunction } from 'express';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { runMonthlyReports } from '../services/reporting';
import { sendPushToRoles } from '../services/pushService';

const router = Router();

/** Previous month as 'YYYY-MM' (reports always close a finished month). */
function previousPeriod(): string {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Cloud Scheduler authentication: the job sends a shared secret header.
 * Set SCHEDULER_KEY in the Cloud Run env and configure the Scheduler job with
 * the same value. Falls through to normal admin auth when absent.
 */
function schedulerOrAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const key = process.env.SCHEDULER_KEY;
  if (key && req.headers['x-scheduler-key'] === key) return next();
  // Not the scheduler — require an authenticated admin/internal user.
  requireAuth(req, res, err => {
    if (err) return next(err);
    requireRole('admin', 'internal')(req, res, next);
  });
}

/**
 * POST /api/reports/run
 * Body (all optional):
 *   period:   'YYYY-MM' — defaults to the previous month
 *   combined: true      — one merged all-brands report
 *   brands:   string[]  — per-brand reports for these names only
 * No body (scheduler): per-brand reports for every active brand.
 */
router.post('/run', schedulerOrAdmin, async (req, res, next) => {
  try {
    const period: string =
      typeof req.body?.period === 'string' && /^\d{4}-\d{2}$/.test(req.body.period)
        ? req.body.period
        : previousPeriod();

    const combined = req.body?.combined === true;
    const brands = Array.isArray(req.body?.brands)
      ? req.body.brands.filter((b: unknown): b is string => typeof b === 'string')
      : undefined;
    const results = await runMonthlyReports(period, { combined, brands });

    if (results.length > 0) {
      sendPushToRoles(['admin', 'internal'], {
        title: '📊 Monthly Report Ready',
        body: `The marketing report for ${period} has been generated.`,
        url: '/reports',
        tag: `report-${period}`,
      }).catch(err => console.error('Report push failed:', err));
    }

    res.json({ success: true, period, results });
  } catch (e) {
    next(e);
  }
});

export default router;
