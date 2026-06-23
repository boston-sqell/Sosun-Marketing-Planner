import { Router, Response } from 'express';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { db } from '../services/firestore';
import { validate } from '../middleware/validate';
import { CreateEventSchema } from '../schemas';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/events
 */
router.get('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    const role = req.role || 'agency';
    if (role !== 'admin' && role !== 'internal') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    // We could add cursor pagination here, but Events list is small in the frontend
    const limit = 100;
    const { cursor } = req.query;

    let queryRef = db.collection('events').orderBy('startDate', 'desc').orderBy('__name__', 'desc');

    if (cursor) {
      const cursorDoc = await db.collection('events').doc(String(cursor)).get();
      if (cursorDoc.exists) {
        queryRef = queryRef.startAfter(cursorDoc);
      }
    }

    const snap = await queryRef.limit(limit).get();
    const eventsList: any[] = [];
    let nextCursor: string | null = null;

    for (const doc of snap.docs) {
      nextCursor = doc.id;
      eventsList.push({ ...doc.data(), id: doc.id });
    }

    if (snap.docs.length < limit) {
      nextCursor = null;
    }

    return res.json({ success: true, events: eventsList, nextCursor });
  } catch (err: any) {
    next(err);
  }
});

/**
 * POST /api/events
 */
router.post('/', validate(CreateEventSchema), async (req: AuthedRequest, res: Response, next) => {
  try {
    const role = req.role || 'agency';
    if (role !== 'admin' && role !== 'internal') {
      return res.status(403).json({ success: false, error: 'Forbidden: cannot create events' });
    }

    const payload = req.body;
    const eventId = db.collection('events').doc().id;

    await db.collection('events').doc(eventId).set({
      ...payload,
      leadsCaptured: 0,
      salesAttributed: 0,
      createdAt: new Date().toISOString(),
      createdBy: req.uid,
    });

    return res.json({ success: true, id: eventId });
  } catch (err: any) {
    next(err);
  }
});

/**
 * PUT /api/events/:id
 */
const UpdateEventSchema = CreateEventSchema.partial().strict();

router.put('/:id', validate(UpdateEventSchema), async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const role = req.role || 'agency';
    if (role !== 'admin' && role !== 'internal') {
      return res.status(403).json({ success: false, error: 'Forbidden: cannot edit events' });
    }

    const docRef = db.collection('events').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const payload = req.body;

    await docRef.set({
      ...payload,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return res.json({ success: true });
  } catch (err: any) {
    next(err);
  }
});

/**
 * DELETE /api/events/:id
 */
router.delete('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const role = req.role || 'agency';
    if (role !== 'admin' && role !== 'internal') {
      return res.status(403).json({ success: false, error: 'Forbidden: cannot delete events' });
    }

    const docRef = db.collection('events').doc(id);
    await docRef.delete();
    
    // Cleanup logistics subcollection? That usually requires a Cloud Function
    // or recursive delete, but for this app deleting the main doc is enough 
    // to hide it from the UI.

    return res.json({ success: true });
  } catch (err: any) {
    next(err);
  }
});

export default router;
