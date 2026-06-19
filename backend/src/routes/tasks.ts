import { Router, Response, NextFunction } from 'express';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { db } from '../services/firestore';
import { sendPushToRoles } from '../services/pushService';

const router = Router();

/**
 * Cloud Scheduler authentication.
 * Copied from reports.ts for consistency.
 */
function schedulerOrAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const key = process.env.SCHEDULER_KEY;
  if (key && req.headers['x-scheduler-key'] === key) return next();
  requireAuth(req, res, err => {
    if (err) return next(err);
    requireRole('admin', 'internal')(req, res, next);
  });
}

/**
 * GET /api/tasks/check-deadlines
 * Cron endpoint to find tasks due today or tomorrow and dispatch push notifications.
 */
router.get('/check-deadlines', schedulerOrAdmin, async (req, res, next) => {
  try {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayStr = today.toISOString().slice(0, 10);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    // Fetch all active tasks
    const snap = await db.collection('tasks').where('progress', '<', 100).get();

    let agencyCount = 0;
    let internalCount = 0;

    const pushes: Promise<any>[] = [];

    snap.forEach((doc) => {
      const task = doc.data();
      const dueDate = task.dueDate;
      if (!dueDate) return;

      if (dueDate === todayStr || dueDate === tomorrowStr) {
        const isToday = dueDate === todayStr;
        const urgency = isToday ? '🚨 DUE TODAY' : '⏰ Due Tomorrow';
        
        const payload = {
          title: urgency,
          body: `${task.title} is due ${isToday ? 'today' : 'tomorrow'} (${dueDate}).`,
          url: '/tasks',
          tag: `deadline-${doc.id}`,
        };

        if (task.assignedTo === 'Agency') {
          agencyCount++;
          pushes.push(sendPushToRoles(['agency', 'admin'], payload));
        } else if (task.assignedTo === 'Internal') {
          internalCount++;
          pushes.push(sendPushToRoles(['internal', 'admin'], payload));
        }
      }
    });

    await Promise.allSettled(pushes);

    res.json({
      success: true,
      message: 'Deadlines checked',
      notificationsSent: { agency: agencyCount, internal: internalCount },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
