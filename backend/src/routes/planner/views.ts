import { Router, Response } from 'express';
import { requireAuth, AuthedRequest, AppRole } from '../../middleware/auth';
import { db } from '../../services/firestore';

const router = Router();
router.use(requireAuth);

const STAFF: AppRole[] = ['admin', 'internal'];
const isStaff = (role?: AppRole) => !!role && STAFF.includes(role);

const VIEWS_COLLECTION = 'plannerViews';

// ── CRUD: List ───────────────────────────────────────────────────────────────
router.get('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    const { spaceId } = req.query as { spaceId?: string };
    if (!spaceId) {
      return res.status(400).json({ success: false, error: 'spaceId query parameter is required' });
    }

    let query = db.collection(VIEWS_COLLECTION).where('spaceId', '==', spaceId);
    
    // Non-staff can only see shared views
    const staff = isStaff(req.role);
    if (!staff) {
      query = query.where('shared', '==', true);
    }

    const snap = await query.get();
    const views = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    return res.json({ success: true, views });
  } catch (err) {
    next(err);
  }
});

// ── CRUD: Create ─────────────────────────────────────────────────────────────
router.post('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    if (!isStaff(req.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: Only staff may create views' });
    }

    const { name, spaceId, kind, filters, sort, shared } = req.body;
    if (!name || !spaceId || !kind) {
      return res.status(400).json({ success: false, error: 'name, spaceId, and kind are required' });
    }

    const ref = db.collection(VIEWS_COLLECTION).doc();
    const view = {
      name,
      spaceId,
      kind,
      filters: filters || {},
      sort: sort || {},
      ownerUid: req.uid,
      shared: shared === true,
      createdAt: new Date().toISOString(),
    };

    await ref.set(view);
    return res.json({ success: true, view: { id: ref.id, ...view } });
  } catch (err) {
    next(err);
  }
});

// ── CRUD: Update ─────────────────────────────────────────────────────────────
router.put('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    if (!isStaff(req.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: Only staff may edit views' });
    }

    const ref = db.collection(VIEWS_COLLECTION).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'View not found' });
    }

    const { name, filters, sort, shared } = req.body;
    const patch: Record<string, any> = {};
    if (name !== undefined) patch.name = name;
    if (filters !== undefined) patch.filters = filters;
    if (sort !== undefined) patch.sort = sort;
    if (shared !== undefined) patch.shared = shared;
    
    patch.updatedAt = new Date().toISOString();

    await ref.update(patch);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── CRUD: Delete ─────────────────────────────────────────────────────────────
router.delete('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    if (!isStaff(req.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: Only staff may delete views' });
    }

    const ref = db.collection(VIEWS_COLLECTION).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'View not found' });
    }

    await ref.delete();
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
