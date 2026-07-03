/**
 * Marketing Planner — personal to-dos (My Workspace).
 *
 *   GET    /api/planner/todos       list the caller's to-dos
 *   POST   /api/planner/todos       create one
 *   PUT    /api/planner/todos/:id   edit text / done / dueDate (own only)
 *   DELETE /api/planner/todos/:id   delete (own only)
 *
 * These are private scratch items, one collection scoped by uid — deliberately
 * NOT planner work items (no workflow/transitions/approvals) so any role,
 * including agency, can keep a personal list without touching planner RBAC.
 */

import { Router, Response } from 'express';
import { requireAuth, AuthedRequest } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { db } from '../../services/firestore';
import { CreatePersonalTodoSchema, UpdatePersonalTodoSchema } from '../../schemas/planner';

export const PERSONAL_TODOS_COLLECTION = 'plannerPersonalTodos';

const router = Router();
router.use(requireAuth);

const nowIso = () => new Date().toISOString();

// ── List (own only) ──────────────────────────────────────────────────────────

router.get('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    // Single-field filter + client-side sort keeps us free of a composite index.
    const snap = await db
      .collection(PERSONAL_TODOS_COLLECTION)
      .where('uid', '==', req.uid!)
      .limit(500)
      .get();
    const todos = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a: any, b: any) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return res.json({ success: true, todos });
  } catch (err) {
    next(err);
  }
});

// ── Create ───────────────────────────────────────────────────────────────────

router.post('/', validate(CreatePersonalTodoSchema), async (req: AuthedRequest, res: Response, next) => {
  try {
    const now = nowIso();
    const doc = {
      uid: req.uid!,
      text: req.body.text,
      dueDate: req.body.dueDate ?? null,
      list: req.body.list ?? 'todo',
      taskId: req.body.taskId ?? null,
      done: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null as string | null,
    };
    const ref = await db.collection(PERSONAL_TODOS_COLLECTION).add(doc);
    return res.json({ success: true, todo: { id: ref.id, ...doc } });
  } catch (err) {
    next(err);
  }
});

// ── Update (own only) ────────────────────────────────────────────────────────

router.put('/:id', validate(UpdatePersonalTodoSchema), async (req: AuthedRequest, res: Response, next) => {
  try {
    const ref = db.collection(PERSONAL_TODOS_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'To-do not found' });
    if (snap.data()!.uid !== req.uid) return res.status(403).json({ success: false, error: 'Forbidden' });

    const patch: Record<string, unknown> = { ...req.body, updatedAt: nowIso() };
    // Keep completedAt consistent with done so "completed today" style queries work.
    if (typeof req.body.done === 'boolean') {
      patch.completedAt = req.body.done ? nowIso() : null;
    }
    await ref.update(patch);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Delete (own only) ────────────────────────────────────────────────────────

router.delete('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    const ref = db.collection(PERSONAL_TODOS_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'To-do not found' });
    if (snap.data()!.uid !== req.uid) return res.status(403).json({ success: false, error: 'Forbidden' });
    await ref.delete();
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
