import { Router, Response, NextFunction } from 'express';
import { requireAuth, requireRole, AuthedRequest, AppRole } from '../middleware/auth';
import { db } from '../services/firestore';
import { sendPushToRoles } from '../services/pushService';
import { checkPermission, isProjectMember } from '../middleware/rbac';
import { firestore } from 'firebase-admin';

const router = Router();

// Cloud Scheduler auth helper
function schedulerOrAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const key = process.env.SCHEDULER_KEY;
  if (key && req.headers['x-scheduler-key'] === key) return next();
  requireAuth(req, res, err => {
    if (err) return next(err);
    requireRole('admin', 'internal')(req, res, next);
  });
}

// Apply auth to all tasks routes (except check-deadlines which has its own auth)
router.get('/check-deadlines', schedulerOrAdmin, async (req, res, next) => {
  try {
    // Compute "today"/"tomorrow" in Maldives local time. dueDate/scheduledDate are
    // stored as YYYY-MM-DD calendar days; using UTC (toISOString) would fire a day
    // early/late for the +05:00 audience. en-CA formats as YYYY-MM-DD.
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Indian/Maldives',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayStr = fmt.format(new Date());
    const tomorrowStr = fmt.format(new Date(Date.now() + 24 * 60 * 60 * 1000));

    const snap = await db.collection('tasks').where('progress', '<', 100).get();

    let agencyCount = 0;
    let internalCount = 0;
    const pushes: Promise<any>[] = [];

    snap.forEach((doc) => {
      const task = doc.data();
      const dueDate = task.dueDate || task.scheduledDate; // handle scheduledDate too
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
        } else if (task.assignedTo === 'Both') {
          agencyCount++;
          internalCount++;
          pushes.push(sendPushToRoles(['agency', 'internal', 'admin'], payload));
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

// Protect all standard routes
router.use(requireAuth);

/**
 * Helper to strip internal comments for agency users.
 */
function stripInternalComments(task: any, role: AppRole) {
  if (role === 'agency' || role === 'external_agency') {
    if (task.comments && Array.isArray(task.comments)) {
      task.comments = task.comments.filter((c: any) => c.internalOnly !== true && c.internal_only !== true);
    }
  }
  return task;
}

/**
 * GET /api/tasks
 * Fetches and filters tasks using condition-aware RBAC, sorts server-side, and supports pagination.
 */
router.get('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    const role = req.role || 'agency';
    const userUid = req.uid!;
    const sortKey = (req.query.sort as string) || 'createdAt';
    const direction = (req.query.direction as string) || 'desc';
    const filterBrandParam = req.query.brand as string;
    const filterPhaseParam = req.query.phase as string; // Feature 2: Calendar Pending Filter

    // Fetch all tasks using Admin SDK
    let queryRef: any = db.collection('tasks');
    if (filterBrandParam) {
      queryRef = queryRef.where('brand', '==', filterBrandParam);
    }
    queryRef = queryRef.orderBy('createdAt', 'desc');
    
    const tasksSnap = await queryRef.get();
    let tasksList: any[] = [];

    // Filter permitted tasks in memory to apply condition-aware RBAC
    for (const doc of tasksSnap.docs) {
      const task = { ...doc.data(), id: doc.id };

      const hasPerm = await checkPermission(role, 'task', 'view', {
        userUid,
        resourceData: task,
      });

      if (hasPerm) {
        // Feature 2 Filter: filter by statusPhase if specified
        if (filterPhaseParam && task.statusPhase !== filterPhaseParam) {
          continue;
        }

        stripInternalComments(task, role);
        tasksList.push(task);
      }
    }

    const terminalToBottom = req.query.terminalToBottom === 'true';

    // Feature 3 Sort: Secondary sort tier server-side (isTerminal ASC) if requested
    tasksList.sort((a, b) => {
      if (terminalToBottom) {
        // 1. Terminal tasks always sorted to the bottom
        const termA = (a.isTerminal || a.statusPhase === 'terminal') ? 1 : 0;
        const termB = (b.isTerminal || b.statusPhase === 'terminal') ? 1 : 0;
        if (termA !== termB) return termA - termB; // false (0) first, true (1) last
      }

      // 2. Primary sort key
      const valA = a[sortKey];
      const valB = b[sortKey];
      if (valA === valB) return 0;
      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      const comparison = valA < valB ? -1 : 1;
      return direction === 'desc' ? -comparison : comparison;
    });

    // Optional cap on returned rows (?limit=N). Defaults to all for backward
    // compatibility. Avoids logging task titles/PII to stdout.
    const limitRaw = Number(req.query.limit);
    const limited = Number.isInteger(limitRaw) && limitRaw > 0 ? tasksList.slice(0, limitRaw) : tasksList;
    return res.json({ success: true, tasks: limited });
  } catch (err: any) {
    next(err);
  }
});

/**
 * GET /api/tasks/:id
 */
router.get('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const role = req.role || 'agency';
    const userUid = req.uid!;

    const doc = await db.collection('tasks').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const task = { ...doc.data(), id: doc.id };

    const hasPerm = await checkPermission(role, 'task', 'view', {
      userUid,
      resourceData: task,
    });

    if (!hasPerm) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions' });
    }

    stripInternalComments(task, role);
    return res.json({ success: true, task });
  } catch (err: any) {
    next(err);
  }
});

/**
 * POST /api/tasks
 */
router.post('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    const role = req.role || 'agency';
    const userUid = req.uid!;

    const hasPerm = await checkPermission(role, 'task', 'create', {
      userUid,
      resourceData: req.body,
    });

    if (!hasPerm) {
      return res.status(403).json({ success: false, error: 'Forbidden: cannot create tasks' });
    }

    const newTask = {
      ...req.body,
      createdAt: new Date().toISOString(),
      submittedBy: req.email || 'System',
    };

    // If status is supplied, populate phase fields
    if (req.body.statusId) {
      const statusDoc = await db.collection('taskStatuses').doc(req.body.statusId).get();
      if (statusDoc.exists) {
        const s = statusDoc.data()!;
        newTask.statusPhase = s.phase;
        newTask.isTerminal = s.phase === 'terminal';
        newTask.status = s.name;
      }
    }

    const docRef = await db.collection('tasks').add(newTask);
    return res.json({ success: true, id: docRef.id });
  } catch (err: any) {
    next(err);
  }
});

/**
 * PUT /api/tasks/:id
 */
router.put('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const role = req.role || 'agency';
    const userUid = req.uid!;

    const taskDoc = await db.collection('tasks').doc(id).get();
    if (!taskDoc.exists) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const task: any = { ...taskDoc.data(), id: taskDoc.id };
    const patch = req.body;

    // Determine type of update
    const isStatusUpdate = patch.statusId && patch.statusId !== task.statusId;
    const isChecklistUpdate = patch.checklist !== undefined;

    if (isStatusUpdate) {
      // Look up target status details
      const statusDoc = await db.collection('taskStatuses').doc(patch.statusId).get();
      if (!statusDoc.exists) {
        return res.status(400).json({ success: false, error: 'Invalid statusId' });
      }
      const s = statusDoc.data()!;
      patch.status = s.name;
      patch.statusPhase = s.phase;
      patch.isTerminal = s.phase === 'terminal';

      const hasPerm = await checkPermission(role, 'task', 'status_transition', {
        userUid,
        resourceData: task,
        targetPhase: s.phase,
      });

      if (!hasPerm) {
        return res.status(403).json({ success: false, error: 'Forbidden: cannot change status to this value' });
      }
    } else if (isChecklistUpdate) {
      const hasPerm = await checkPermission(role, 'checklist', 'check', {
        userUid,
        resourceData: task,
      });

      if (!hasPerm) {
        return res.status(403).json({ success: false, error: 'Forbidden: cannot check/uncheck items' });
      }
    } else {
      // General task update
      const hasPerm = await checkPermission(role, 'task', 'edit', {
        userUid,
        resourceData: task,
      });

      if (!hasPerm) {
        return res.status(403).json({ success: false, error: 'Forbidden: cannot edit this task' });
      }
    }

    // Whitelist what actually gets written. Privileged roles (admin/internal)
    // passed the 'edit' permission and may write the full body; everyone else
    // reached here via a status or checklist update and may ONLY write the
    // fields that update type owns. This prevents mass-assignment, e.g. an
    // agency user smuggling `assignedTo`/`brand`/`budget` alongside a status change.
    const isPrivileged = role === 'admin' || role === 'internal';
    let writePatch: Record<string, any>;
    if (isPrivileged) {
      writePatch = { ...patch };
      delete writePatch.id; // never let the doc id be overwritten
    } else if (isStatusUpdate) {
      writePatch = {
        statusId: patch.statusId,
        status: patch.status,
        statusPhase: patch.statusPhase,
        isTerminal: patch.isTerminal,
      };
    } else if (isChecklistUpdate) {
      writePatch = { checklist: patch.checklist };
    } else {
      // Non-privileged general edit was already rejected above; defensive default.
      return res.status(403).json({ success: false, error: 'Forbidden: cannot edit this task' });
    }

    await db.collection('tasks').doc(id).update(writePatch);
    return res.json({ success: true });
  } catch (err: any) {
    next(err);
  }
});

/**
 * DELETE /api/tasks/:id
 */
router.delete('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const role = req.role || 'agency';
    const userUid = req.uid!;

    const taskDoc = await db.collection('tasks').doc(id).get();
    if (!taskDoc.exists) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const task = { ...taskDoc.data(), id: taskDoc.id };

    const hasPerm = await checkPermission(role, 'task', 'delete', {
      userUid,
      resourceData: task,
    });

    if (!hasPerm) {
      return res.status(403).json({ success: false, error: 'Forbidden: cannot delete this task' });
    }

    await db.collection('tasks').doc(id).delete();
    return res.json({ success: true });
  } catch (err: any) {
    next(err);
  }
});

/* ── Comments API Endpoints ────────────────────────────────────────── */

/**
 * POST /api/tasks/:id/comments
 */
router.post('/:id/comments', async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const role = req.role || 'agency';
    const userUid = req.uid!;
    const { text, internalOnly } = req.body;

    const taskDoc = await db.collection('tasks').doc(id).get();
    if (!taskDoc.exists) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const task = { ...taskDoc.data(), id: taskDoc.id };

    const hasPerm = await checkPermission(role, 'comment', 'create', {
      userUid,
      resourceData: task,
    });

    if (!hasPerm) {
      return res.status(403).json({ success: false, error: 'Forbidden: cannot comment on this task' });
    }

    if (internalOnly && (role === 'agency' || role === 'external_agency')) {
      return res.status(403).json({ success: false, error: 'Forbidden: agency cannot post internal comments' });
    }

    const commentId = db.collection('tasks').doc().id; // generate unique comment id
    const newComment = {
      id: commentId,
      userUid,
      user: req.email || 'System',
      role,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', Today',
      createdAt: new Date().toISOString(),
      internalOnly: internalOnly === true,
    };

    await db.collection('tasks').doc(id).update({
      comments: firestore.FieldValue.arrayUnion(newComment),
    });

    return res.json({ success: true, comment: newComment });
  } catch (err: any) {
    next(err);
  }
});

/**
 * PUT /api/tasks/:id/comments/:commentId
 */
router.put('/:id/comments/:commentId', async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id, commentId } = req.params;
    const role = req.role || 'agency';
    const userUid = req.uid!;
    const { text } = req.body;

    const taskRef = db.collection('tasks').doc(id);
    const taskDoc = await taskRef.get();
    if (!taskDoc.exists) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const task = taskDoc.data()!;
    const comments = task.comments || [];
    const commentIndex = comments.findIndex((c: any) => c.id === commentId);

    if (commentIndex === -1) {
      return res.status(404).json({ success: false, error: 'Comment not found' });
    }

    const hasPerm = await checkPermission(role, 'comment', 'edit', {
      userUid,
      resourceData: comments[commentIndex],
      parentResourceData: task,
    });

    if (!hasPerm) {
      return res.status(403).json({ success: false, error: 'Forbidden: cannot edit this comment' });
    }

    // Re-read and rewrite the array inside a transaction so a concurrent comment
    // add/edit isn't clobbered by a stale whole-array write (read-modify-write race).
    let edited = false;
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(taskRef);
      if (!fresh.exists) return;
      const arr = (fresh.data()!.comments || []) as any[];
      const idx = arr.findIndex((c: any) => c.id === commentId);
      if (idx === -1) return;
      arr[idx] = { ...arr[idx], text, editedAt: new Date().toISOString() };
      tx.update(taskRef, { comments: arr });
      edited = true;
    });

    if (!edited) {
      return res.status(404).json({ success: false, error: 'Comment not found' });
    }
    return res.json({ success: true });
  } catch (err: any) {
    next(err);
  }
});

export default router;
